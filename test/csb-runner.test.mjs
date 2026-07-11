/**
 * Phase 2 runner: prepare workspaces without oracle leak; dry-run + score-fixtures.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario } from '../evals/csb/harness/score.mjs';
import { prepareArmWorkspace } from '../evals/csb/harness/prepare.mjs';
import { buildActorPrompt } from '../evals/csb/harness/prompts.mjs';
import {
  actorSpec,
  buildActorInvocation,
  codexThreadId,
  createIsolatedActorWorkspace,
  parseCodexTrace,
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
  it('allocates a fresh external root with a non-existent workspace child', () => {
    const isolated = createIsolatedActorWorkspace('test');
    try {
      assert.ok(fs.existsSync(isolated.root));
      assert.equal(fs.existsSync(isolated.cwd), false);
      assert.equal(isolated.cwd.startsWith(ROOT), false);
    } finally {
      fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  });

  it('builds an isolated subscription-backed Codex invocation with pinned reasoning', () => {
    const spec = actorSpec({
      tool: 'codex', binary: 'codex', model: 'gpt-5.6-luna', reasoning: 'xhigh',
    });
    const invocation = buildActorInvocation(spec, { prompt: 'do the work', cwd: '/tmp/arm' });
    assert.equal(invocation.binary, 'codex');
    assert.deepEqual(invocation.args.slice(0, 4), ['exec', '--strict-config', '--model', 'gpt-5.6-luna']);
    assert.ok(invocation.args.includes('--ephemeral'));
    assert.ok(invocation.args.includes('--ignore-user-config'));
    assert.ok(invocation.args.includes('--ignore-rules'));
    assert.ok(invocation.args.includes('--json'));
    assert.ok(invocation.args.includes('approval_policy="never"'));
    assert.ok(invocation.args.includes('model_reasoning_effort="xhigh"'));
    assert.equal(invocation.args.at(-2), '/tmp/arm');
    assert.equal(invocation.args.at(-1), 'do the work');
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

  it('rejects reasoning controls on non-Codex actors', () => {
    assert.throws(
      () => actorSpec({ tool: 'opencode', model: 'model', reasoning: 'xhigh' }),
      /only supported by the codex actor/,
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
    assert.equal(config.scenarios.length, 9);
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
    const summary = summarizeValidPairs(pairs, { runs: 2 });
    assert.equal(summary.n_valid_pairs, 4);
    assert.equal(summary.task_success.WITH, 0.75);
    assert.equal(summary.task_success.BASE, 0.25);
    assert.equal(summary.task_success.lift, 0.5);
    assert.ok(summary.task_success.lift_95ci.low < summary.task_success.lift_95ci.high);
    assert.equal(summary.pass_power_k.k, 2);
    assert.equal(summary.pass_power_k.rate, 0.5);
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
