/**
 * Phase 2 runner: prepare workspaces without oracle leak; dry-run + score-fixtures.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, listScenarioIds } from '../evals/csb/harness/score.mjs';
import { prepareArmWorkspace } from '../evals/csb/harness/prepare.mjs';
import { buildActorPrompt } from '../evals/csb/harness/prompts.mjs';
import {
  actorSpec,
  actorEnvironment,
  buildActorInvocation,
  codexThreadId,
  createIsolatedActorWorkspace,
  grokThreadId,
  parseCodexTrace,
  parseGrokTrace,
  prepareCodexActorHome,
  prepareGrokActorHome,
} from '../evals/csb/harness/actors.mjs';
import {
  seededSchedule,
  snapshotArtifacts,
  summarizeValidPairs,
  taskSuccess,
  validateActorTrial,
} from '../evals/csb/harness/validity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'evals/csb/harness/run-arms.mjs');

describe('CSB prepareArmWorkspace', () => {
  const scenario = loadScenario('clinic-floor-poison');
  const baseDir = path.join(ROOT, 'evals/csb/runs/_test-prepare-BASE');
  const withDir = path.join(ROOT, 'evals/csb/runs/_test-prepare-WITH');

  it('BASE has brief+seed, no skill/packs/cli, no oracle leak', () => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    prepareArmWorkspace('BASE', scenario, baseDir);
    assert.ok(fs.existsSync(path.join(baseDir, 'brief.md')));
    assert.ok(fs.existsSync(path.join(baseDir, 'voice.answers.json')));
    assert.ok(fs.existsSync(path.join(baseDir, 'OUTPUT_SCHEMA.md')));
    assert.equal(fs.existsSync(path.join(baseDir, 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'providers')), false);
    assert.equal(fs.existsSync(path.join(baseDir, '.bin')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'oracle.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'tags.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'manifest.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'poisoned.answers.json')), false);
    const seed = JSON.parse(fs.readFileSync(path.join(baseDir, 'voice.answers.json'), 'utf8'));
    assert.equal(seed.recording_consent, 'none');
  });

  it('WITH has skill+packs+cli shim, still no oracle leak', () => {
    fs.rmSync(withDir, { recursive: true, force: true });
    prepareArmWorkspace('WITH', scenario, withDir);
    assert.ok(fs.existsSync(path.join(withDir, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(withDir, 'providers')));
    assert.ok(fs.existsSync(path.join(withDir, '.bin', 'callsmith')));
    assert.ok(fs.existsSync(path.join(withDir, '.callsmith-runtime', 'bin', 'callsmith.mjs')));
    assert.ok(fs.existsSync(path.join(withDir, '.callsmith-runtime', 'package.json')));
    assert.equal(fs.existsSync(path.join(withDir, 'bin')), false);
    assert.equal(fs.existsSync(path.join(withDir, 'src')), false);
    assert.equal(fs.existsSync(path.join(withDir, 'data')), false);
    const shim = fs.readFileSync(path.join(withDir, '.bin', 'callsmith'), 'utf8');
    assert.equal(shim.includes(ROOT), false);
    assert.match(shim, /^#!\/bin\/sh/);
    assert.doesNotMatch(shim, /NODE_OPTIONS|experimental-default-type/);
    const doctor = spawnSync(path.join(withDir, '.bin', 'callsmith'), ['doctor'], {
      cwd: withDir, encoding: 'utf8',
    });
    assert.equal(doctor.status, 0, doctor.stderr + doctor.stdout);
    assert.equal(fs.existsSync(path.join(withDir, 'oracle.json')), false);
    assert.equal(fs.existsSync(path.join(withDir, 'tags.json')), false);
  });

  it('materializes an explicit empty seed for scenarios without poison input', () => {
    const isolated = createIsolatedActorWorkspace('empty-seed');
    try {
      prepareArmWorkspace('BASE', { id: 'empty-seed', brief: 'Design it.', poison: null }, isolated.cwd);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(isolated.cwd, 'voice.answers.json'), 'utf8')), {});
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('WITH CLI runs in an external workspace with no parent package metadata', () => {
    const isolated = createIsolatedActorWorkspace('self-contained-cli');
    try {
      prepareArmWorkspace('WITH', scenario, isolated.cwd);
      const doctor = spawnSync(path.join(isolated.cwd, '.bin', 'callsmith'), ['doctor'], {
        cwd: isolated.cwd, encoding: 'utf8',
      });
      assert.equal(doctor.status, 0, doctor.stderr + doctor.stdout);
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('refuses a reused or dirty actor workspace', () => {
    assert.throws(
      () => prepareArmWorkspace('WITH', scenario, withDir),
      /refusing reused actor workspace/,
    );
  });

  it('prompts do not leak rubric point ids or target anchors', () => {
    const withP = buildActorPrompt('WITH', scenario, withDir);
    const baseP = buildActorPrompt('BASE', scenario, baseDir);
    for (const p of [withP, baseP]) {
      assert.doesNotMatch(p, /G_FLOOR|verify_1_|targetAnswers|oracle\.json/i);
      assert.doesNotMatch(p, /mcq_1_|judge-rubric/i);
    }
    assert.match(withP, /SKILL\.md|provider/i);
    assert.match(withP, /Canonical|canonical option ids|whatsapp_voice|Omit/i);
    assert.match(withP, /non-empty/i);
    assert.match(baseP, /do \*\*not\*\* have a Callsmith skill/i);
    // BASE must not receive full Callsmith sealed enum dump (keeps ablation honest)
    assert.doesNotMatch(baseP, /Canonical answers vocabulary|gemini_live|custom_fastapi/i);
  });
});

describe('CSB run-arms CLI', () => {
  it('creates a first run when the output parent does not exist', () => {
    const isolated = createIsolatedActorWorkspace('missing-run-parent');
    const out = path.join(isolated.root, 'missing', 'dry-run');
    try {
      const result = spawnSync(process.execPath, [
        RUNNER,
        '--dry-run',
        '--scenario', 'clinic-floor-poison',
        '--out', out,
      ], { encoding: 'utf8', cwd: ROOT });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.ok(fs.existsSync(path.join(out, 'summary.json')));
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('allocates a fresh external root with a non-existent workspace child', () => {
    const isolated = createIsolatedActorWorkspace('test');
    try {
      assert.ok(fs.existsSync(isolated.root));
      assert.equal(fs.existsSync(isolated.cwd), false);
      assert.equal(fs.existsSync(isolated.home), false);
      assert.equal(fs.existsSync(isolated.bin), false);
      assert.equal(isolated.cwd.startsWith(ROOT), false);
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('gives Codex an auth-only home and hides personal agent skills', () => {
    const isolated = createIsolatedActorWorkspace('auth-only-home');
    const sourceHome = path.join(isolated.root, 'source-codex-home');
    const spec = actorSpec({ tool: 'codex', model: 'gpt-5.6-luna', reasoning: 'xhigh' });
    try {
      fs.mkdirSync(sourceHome);
      fs.writeFileSync(path.join(sourceHome, 'auth.json'), '{"token":"test-only"}\n');
      fs.writeFileSync(path.join(sourceHome, 'config.toml'), 'model="personal"\n');
      fs.mkdirSync(path.join(sourceHome, 'skills'));
      fs.writeFileSync(path.join(sourceHome, 'skills', 'personal.md'), 'must not leak\n');

      prepareCodexActorHome(spec, isolated.home, isolated.bin, sourceHome);
      assert.deepEqual(fs.readdirSync(isolated.home), ['auth.json']);
      assert.equal(fs.existsSync(path.join(isolated.home, 'config.toml')), false);
      assert.equal(fs.existsSync(path.join(isolated.home, 'skills')), false);
      assert.equal(fs.realpathSync(path.join(isolated.bin, 'node')), process.execPath);

      const env = actorEnvironment(spec, {
        cwd: '/tmp/arm', arm: 'BASE', actorHome: isolated.home, actorBin: isolated.bin,
      });
      assert.equal(env.HOME, isolated.home);
      assert.equal(env.CODEX_HOME, isolated.home);
      assert.equal(env.ZDOTDIR, isolated.home);
      assert.equal(env.PATH.includes(process.env.PATH), false);
      assert.equal(env.PATH.includes('.npm-global'), false);
      assert.equal(env.PATH.includes('/tmp/arm/.bin'), false);
      assert.equal(env.CODEX_THREAD_ID, undefined);
      const globalCliProbe = spawnSync('/bin/sh', ['-c', 'command -v callsmith'], {
        env, encoding: 'utf8',
      });
      assert.notEqual(globalCliProbe.status, 0, globalCliProbe.stdout);

      const withEnv = actorEnvironment(spec, {
        cwd: '/tmp/arm', arm: 'WITH', actorHome: isolated.home, actorBin: isolated.bin,
      });
      assert.equal(withEnv.PATH.split(path.delimiter)[0], '/tmp/arm/.bin');
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('builds an isolated subscription-backed Codex invocation with pinned reasoning', () => {
    const spec = actorSpec({
      tool: 'codex', binary: process.execPath, model: 'gpt-5.6-luna', reasoning: 'xhigh',
    });
    const invocation = buildActorInvocation(spec, { prompt: 'do the work', cwd: '/tmp/arm' });
    assert.equal(invocation.binary, process.execPath);
    assert.deepEqual(invocation.args.slice(0, 4), ['exec', '--strict-config', '--model', 'gpt-5.6-luna']);
    assert.ok(invocation.args.includes('--ephemeral'));
    assert.ok(invocation.args.includes('--ignore-user-config'));
    assert.ok(invocation.args.includes('--ignore-rules'));
    for (const feature of ['plugins', 'remote_plugin', 'plugin_sharing', 'hooks', 'memories']) {
      assert.ok(invocation.args.includes(feature));
    }
    assert.ok(invocation.args.includes('--json'));
    assert.ok(invocation.args.includes('approval_policy="never"'));
    assert.ok(invocation.args.includes('model_reasoning_effort="xhigh"'));
    assert.equal(invocation.args.at(-2), '/tmp/arm');
    assert.equal(invocation.args.at(-1), 'do the work');
  });

  it('builds an isolated subscription-backed Grok invocation with fail-closed isolation', () => {
    const spec = actorSpec({
      tool: 'grok', binary: process.execPath, model: 'grok-4.5', reasoning: 'high',
    });
    const invocation = buildActorInvocation(spec, { prompt: 'do the work', cwd: '/tmp/arm' });
    assert.equal(invocation.binary, process.execPath);
    assert.deepEqual(invocation.args.slice(0, 2), ['-m', 'grok-4.5']);
    assert.ok(invocation.args.includes('--permission-mode'));
    assert.equal(invocation.args[invocation.args.indexOf('--permission-mode') + 1], 'bypassPermissions');
    assert.ok(invocation.args.includes('--always-approve'));
    // fail-closed isolation flags
    for (const flag of ['--no-memory', '--no-subagents', '--no-plan', '--disable-web-search']) {
      assert.ok(invocation.args.includes(flag), `missing ${flag}`);
    }
    assert.ok(invocation.args.includes('--sandbox'));
    assert.equal(invocation.args[invocation.args.indexOf('--sandbox') + 1], 'workspace');
    assert.ok(invocation.args.includes('--output-format'));
    assert.equal(invocation.args[invocation.args.indexOf('--output-format') + 1], 'streaming-json');
    assert.ok(invocation.args.includes('--reasoning-effort'));
    assert.equal(invocation.args[invocation.args.indexOf('--reasoning-effort') + 1], 'high');
    assert.equal(invocation.args.at(-2), '-p');
    assert.equal(invocation.args.at(-1), 'do the work');
  });

  it('gives Grok an auth-only home with .grok/auth.json and hides personal config', () => {
    const isolated = createIsolatedActorWorkspace('grok-auth-only-home');
    // sourceGrokHome models the real ~/.grok directory: auth.json lives at its root,
    // alongside config.toml/plugins that must NOT be copied into the isolated home.
    const sourceGrokHome = path.join(isolated.root, 'source-grok-home');
    const spec = actorSpec({ tool: 'grok', model: 'grok-4.5', reasoning: 'high' });
    try {
      fs.mkdirSync(sourceGrokHome, { recursive: true });
      fs.writeFileSync(path.join(sourceGrokHome, 'auth.json'), '{"token":"test-only"}\n');
      fs.writeFileSync(path.join(sourceGrokHome, 'config.toml'), 'permission_mode="ask"\n');

      prepareGrokActorHome(spec, isolated.home, isolated.bin, sourceGrokHome);
      assert.deepEqual(fs.readdirSync(isolated.home), ['.grok']);
      assert.deepEqual(fs.readdirSync(path.join(isolated.home, '.grok')), ['auth.json']);
      assert.equal(fs.existsSync(path.join(isolated.home, '.grok', 'config.toml')), false);
      assert.equal(fs.realpathSync(path.join(isolated.bin, 'node')), process.execPath);

      const env = actorEnvironment(spec, {
        cwd: '/tmp/arm', arm: 'BASE', actorHome: isolated.home, actorBin: isolated.bin,
      });
      assert.equal(env.HOME, isolated.home);
      assert.equal(env.CODEX_HOME, undefined);
      assert.equal(env.PATH.includes(process.env.PATH), false);
      const withEnv = actorEnvironment(spec, {
        cwd: '/tmp/arm', arm: 'WITH', actorHome: isolated.home, actorBin: isolated.bin,
      });
      assert.equal(withEnv.PATH.split(path.delimiter)[0], '/tmp/arm/.bin');
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('extracts the Grok session id from the retained streaming-json end event', () => {
    assert.equal(grokThreadId([
      JSON.stringify({ type: 'thought', data: 'hi' }),
      JSON.stringify({ type: 'end', stopReason: 'EndTurn', sessionId: 'sess-456' }),
    ].join('\n')), 'sess-456');
    assert.equal(grokThreadId('not-json\n'), null);
  });

  it('fails Grok traces closed on malformed, missing end, or non-EndTurn stop', () => {
    const complete = [
      { type: 'thought', data: 'thinking' },
      { type: 'text', data: 'done' },
      { type: 'end', stopReason: 'EndTurn', sessionId: 'sess-1' },
    ].map(JSON.stringify).join('\n');
    assert.equal(parseGrokTrace(complete).valid, true);
    assert.equal(parseGrokTrace(complete).threadId, 'sess-1');
    assert.equal(parseGrokTrace('{bad').valid, false);
    assert.equal(parseGrokTrace(JSON.stringify({ type: 'thought', data: 'no end' })).valid, false);
    const aborted = [
      { type: 'thought', data: 'started' },
      { type: 'end', stopReason: 'ToolFailure', sessionId: 'sess-2' },
    ].map(JSON.stringify).join('\n');
    assert.equal(parseGrokTrace(aborted).valid, false);
  });

  it('extracts the Codex thread id from retained JSONL events', () => {
    assert.equal(codexThreadId([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' }),
      JSON.stringify({ type: 'turn.completed' }),
    ].join('\n')), 'thread-123');
    assert.equal(codexThreadId('not-json\n'), null);
  });

  it('fails Codex traces closed on malformed, failed, or incomplete JSONL', () => {
    const complete = [
      { type: 'thread.started', thread_id: 'thread-123' },
      { type: 'item.completed', item: { type: 'command_execution', command: 'callsmith check' } },
      { type: 'turn.completed' },
    ].map(JSON.stringify).join('\n');
    assert.equal(parseCodexTrace(complete).valid, true);
    assert.equal(parseCodexTrace(complete).commandLog, 'callsmith check');
    assert.equal(parseCodexTrace('{bad').valid, false);
    assert.equal(parseCodexTrace(JSON.stringify({ type: 'thread.started', thread_id: 'x' })).valid, false);
    const failed = [
      { type: 'thread.started', thread_id: 'x' },
      { type: 'turn.failed' },
    ].map(JSON.stringify).join('\n');
    assert.equal(parseCodexTrace(failed).valid, false);
  });

  it('accepts a transient error when a later turn.completed proves recovery', () => {
    const recovered = [
      { type: 'thread.started', thread_id: 'thread-123' },
      { type: 'error', message: 'Reconnecting... request timed out' },
      { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
      { type: 'turn.completed' },
    ].map(JSON.stringify).join('\n');
    const trace = parseCodexTrace(recovered);
    assert.equal(trace.valid, true, trace.reasons.join('; '));
    assert.equal(trace.terminalEvent, 'turn.completed');
    assert.equal(trace.recoveredErrorCount, 1);

    const terminalError = `${recovered}\n${JSON.stringify({ type: 'error', message: 'terminal' })}`;
    assert.equal(parseCodexTrace(terminalError).valid, false);
  });

  it('rejects reasoning controls on actors that do not support it', () => {
    assert.throws(
      () => actorSpec({ tool: 'opencode', model: 'model', reasoning: 'xhigh' }),
      /only supported by the codex or grok actor/,
    );
  });

  it('dry-run prepares both arms and does not publish CSB-Δ', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-dry-run');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [RUNNER, '--dry-run', '--scenario', 'clinic-floor-poison', '--out', out],
      { encoding: 'utf8', cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const trial = path.join(out, 'trial-001', 'clinic-floor-poison');
    assert.ok(fs.existsSync(path.join(trial, 'BASE', 'brief.md')));
    assert.ok(fs.existsSync(path.join(trial, 'WITH', 'SKILL.md')));
    assert.equal(fs.existsSync(path.join(trial, 'WITH', 'oracle.json')), false);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.publishable, false);
    assert.equal(summary.metrics, null);
    const config = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
    assert.equal(config.runs, 1);
    assert.ok(config.git.commit);
    assert.ok(config.source.provider_packs_sha256);
    assert.ok(config.source.scenarios['clinic-floor-poison']);
    assert.ok(config.schedule[0].arms.length === 2);
  });

  it('score-fixtures emits demo deltas but marks unpublished', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-fixtures');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [RUNNER, '--score-fixtures', '--scenario', 'clinic-floor-poison', '--out', out],
      { encoding: 'utf8', cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.publishable, false);
    assert.equal(summary.metrics, null);
    assert.ok(summary.fixture_demo_deltas?.length >= 1);
    assert.ok(summary.fixture_demo_deltas[0].delta >= 2);
  });

  it('excludes solved scenarios from low-cost screening schedules', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-exclude');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [
      RUNNER, '--dry-run', '--arms', 'WITH', '--exclude', 'clinic-floor-poison', '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
    assert.equal(config.scenarios.includes('clinic-floor-poison'), false);
    // Exactly one scenario excluded from the current suite (core10 or superset).
    assert.equal(config.scenarios.length, listScenarioIds().length - 1);
    assert.deepEqual(config.arms, ['WITH']);
  });

  it('requires an explicit model pin before a live run', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-no-model');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [RUNNER, '--scenario', 'clinic-floor-poison', '--out', out], {
      encoding: 'utf8', cwd: ROOT,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /require --actor-model/i);
    assert.equal(fs.existsSync(out), false);
  });

  it('requires a Codex reasoning pin before a live run', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-no-reasoning');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [
      RUNNER,
      '--actor-tool', 'codex',
      '--actor-model', 'gpt-5.6-luna',
      '--scenario', 'clinic-floor-poison',
      '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /require --actor-reasoning/i);
    assert.equal(fs.existsSync(out), false);
  });

  it('requires a Grok reasoning pin before a live run', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-no-grok-reasoning');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [
      RUNNER,
      '--actor-tool', 'grok',
      '--actor-model', 'grok-4.5',
      '--scenario', 'clinic-floor-poison',
      '--out', out,
    ], { encoding: 'utf8', cwd: ROOT });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /require --actor-reasoning/i);
    assert.equal(fs.existsSync(out), false);
  });

  it('refuses to overwrite an existing run root', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-reused-root');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const r = spawnSync(process.execPath, [RUNNER, '--dry-run', '--scenario', 'clinic-floor-poison', '--out', out], {
      encoding: 'utf8', cwd: ROOT,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing reused run directory/i);
  });
});

describe('CSB validity and repeated-run statistics', () => {
  it('builds deterministic randomized, counterbalanced schedules', () => {
    const ids = ['a', 'b', 'c'];
    const first = seededSchedule(ids, 4, ['BASE', 'WITH'], 'fixed-seed');
    const second = seededSchedule(ids, 4, ['BASE', 'WITH'], 'fixed-seed');
    assert.deepEqual(first, second);
    assert.equal(first.length, 12);
    assert.ok(first.some((entry) => entry.arms[0] === 'BASE'));
    assert.ok(first.some((entry) => entry.arms[0] === 'WITH'));
    for (const id of ids) {
      const firstArms = first.filter((entry) => entry.scenarioId === id).map((entry) => entry.arms[0]);
      assert.equal(firstArms.filter((arm) => arm === 'BASE').length, 2);
      assert.equal(firstArms.filter((arm) => arm === 'WITH').length, 2);
    }
  });

  it('invalidates failed actors even when artifacts exist', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-invalid-actor');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{}\n');
    fs.writeFileSync(recipe, '# recipe\n');
    const validity = validateActorTrial({
      actor: { status: 1, timedOut: false, error: null },
      artifacts: { answers, recipe },
      before: {},
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /exit status/);
  });

  it('invalidates truncated output or a required invalid trace', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-invalid-trace');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{}\n');
    fs.writeFileSync(recipe, '# recipe\n');
    const validity = validateActorTrial({
      actor: {
        status: 0,
        timedOut: false,
        stdoutTruncated: true,
        traceRequired: true,
        trace: { valid: false, invalid_reasons: ['Codex trace is missing turn.completed'] },
      },
      artifacts: { answers, recipe },
      before: {},
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /truncated/);
    assert.match(validity.reasons.join(' '), /turn\.completed/);
  });

  it('invalidates stale or unchanged artifacts', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-stale-artifacts');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{}\n');
    fs.writeFileSync(recipe, '# old\n');
    const before = snapshotArtifacts([answers, recipe]);
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false, error: null },
      artifacts: { answers, recipe },
      before,
      startedAtMs: Date.now() + 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /stale/);
    assert.match(validity.reasons.join(' '), /untouched/);
  });

  it('rejects symlinked actor artifacts', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-symlink-artifact');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'target.json');
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(target, '{}\n');
    fs.symlinkSync(target, answers);
    fs.writeFileSync(recipe, '# recipe\n');
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false },
      artifacts: { answers, recipe },
      before: {},
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /must not be a symlink/);
  });

  it('rejects directory artifacts without attempting to read them', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-directory-artifact');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.mkdirSync(answers);
    fs.writeFileSync(recipe, '# recipe\n');
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false },
      artifacts: { answers, recipe },
      before: {},
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /answers artifact must be a regular file/);
  });

  it('does not treat an mtime-only touch as rewriting seeded output', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-touched-seed');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{"seed":true}\n');
    const before = snapshotArtifacts([answers, recipe]);
    const now = new Date();
    fs.utimesSync(answers, now, now);
    fs.writeFileSync(recipe, '# new recipe\n');
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false },
      artifacts: { answers, recipe },
      before,
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /answers artifact was untouched/);
  });

  it('invalidates an actor that changes a controlled benchmark input', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-mutated-input');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    const brief = path.join(dir, 'brief.md');
    fs.writeFileSync(answers, '{"before":true}\n');
    fs.writeFileSync(recipe, '# before\n');
    fs.writeFileSync(brief, '# controlled brief\n');
    const before = snapshotArtifacts([answers, recipe, brief]);
    fs.writeFileSync(answers, '{"after":true}\n');
    fs.writeFileSync(recipe, '# after\n');
    fs.writeFileSync(brief, '# actor changed the brief\n');
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false, error: null },
      artifacts: { answers, recipe },
      immutable: { brief },
      before,
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /brief control was modified/);
  });

  it('uses all-gates task success with G_REAL as a veto', () => {
    assert.equal(taskSuccess(score(true, true, true, true)), true);
    assert.equal(taskSuccess(score(true, true, true, false)), false);
  });

  it('reports paired success lift, variance, diagnostic gate lift, and pass^k', () => {
    const pairs = [
      pair('a', score(true, true, true, true), score(false, true, true, true)),
      pair('a', score(true, true, true, true), score(true, true, true, true)),
      pair('b', score(false, true, true, true), score(false, true, true, true)),
      pair('b', score(true, true, true, true), score(false, true, true, true)),
    ];
    const summary = summarizeValidPairs(pairs, { runs: 2, regulatedScenarioIds: ['a'] });
    assert.equal(summary.n_valid_pairs, 4);
    assert.equal(summary.task_success.WITH, 0.75);
    assert.equal(summary.task_success.BASE, 0.25);
    assert.equal(summary.task_success.lift, 0.5);
    assert.ok(summary.task_success.lift_95ci.low < summary.task_success.lift_95ci.high);
    assert.equal(summary.pass_power_k.k, 2);
    assert.equal(summary.pass_power_k.rate, 0.5);
    assert.equal(summary.regulated_pass_power_k.rate, 1);
    assert.deepEqual(summary.gate_rates.G_FLOOR, { WITH: 0.75, BASE: 0.25, lift: 0.5 });
    assert.equal(summary.floor_lift, 0.5);
    assert.equal(summary.physics_lift, 0);
    assert.equal(summary.base_fail, 0.75);
    assert.equal(summary.diagnostic_gate_lift.G_FLOOR, 0.5);
  });
});

function score(floor, physics, contract, real) {
  const gates = { G_FLOOR: floor, G_PHYS: physics, G_CON: contract, G_REAL: real };
  return { gates, gateScore: Object.values(gates).filter(Boolean).length };
}

function pair(scenarioId, WITH, BASE) {
  return { scenarioId, WITH, BASE };
}
