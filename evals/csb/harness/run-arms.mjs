#!/usr/bin/env node
/** Reproducible BASE/WITH CallsmithBench runner. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, listScenarioIds, scoreArm, pairDelta } from './score.mjs';
import { prepareArmWorkspace, readArmArtifacts, REPO_ROOT } from './prepare.mjs';
import { buildActorPrompt } from './prompts.mjs';
import {
  actorSpec,
  createIsolatedActorWorkspace,
  prepareActorWorkspace,
  retainActorTrace,
  runActor,
} from './actors.mjs';
import {
  hashFile,
  seededSchedule,
  sha256,
  snapshotArtifacts,
  summarizeValidPairs,
  taskSuccess,
  validateActorTrial,
} from './validity.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const dryRun = args['dry-run'] === true;
const scoreFixtures = args['score-fixtures'] === true;
const actorTool = String(args['actor-tool'] || process.env.CSB_ACTOR_TOOL || 'opencode').toLowerCase();
let actor;
try {
  actor = actorSpec({
    tool: actorTool,
    binary: args['actor-bin'] || args['opencode-bin']
      || (actorTool === 'codex' ? process.env.CODEX_BIN : process.env.OPENCODE_BIN),
    model: args['actor-model']
      || (actorTool === 'codex' ? process.env.CODEX_ACTOR_MODEL : process.env.OPENCODE_ACTOR_MODEL)
      || '',
    reasoning: args['actor-reasoning'] || process.env.CODEX_ACTOR_REASONING || null,
  });
} catch (error) {
  fail(error.message);
}
const actorModel = actor.model;
const runId = args['run-id'] || new Date().toISOString().replace(/[:.]/g, '-');
const outRoot = resolve(args.out || join(HERE, '..', 'runs', runId));
const runs = parsePositiveInt(args.runs || '1', '--runs');
const seed = String(args.seed || 'callsmith-csb-v1');
const timeoutMs = parsePositiveInt(
  args['timeout-ms'] || process.env.OPENCODE_EVAL_TIMEOUT_MS || '600000',
  '--timeout-ms',
);

let scenarioIds = listScenarioIds();
if (args.scenario || args.only) {
  const id = args.scenario || args.only;
  scenarioIds = scenarioIds.filter((candidate) => candidate === id);
}
if (args.exclude) {
  const excluded = new Set(String(args.exclude).split(',').map((id) => id.trim()).filter(Boolean));
  scenarioIds = scenarioIds.filter((id) => !excluded.has(id));
}
if (args.limit) scenarioIds = scenarioIds.slice(0, parsePositiveInt(args.limit, '--limit'));
const armsWanted = parseArms(args.arms || 'both');

if (!scenarioIds.length) fail('No scenarios selected.');
if (!armsWanted.length) fail('No valid arms selected.');
if (!dryRun && !scoreFixtures && !actorModel) {
  fail('Live publishable runs require --actor-model (or the selected actor model environment variable).');
}
if (!dryRun && !scoreFixtures && actor.tool === 'codex' && !actor.reasoning) {
  fail('Live Codex runs require --actor-reasoning so reasoning effort is reproducible.');
}
if (existsSync(outRoot)) fail(`Refusing reused run directory: ${outRoot}`);

const git = gitState();
if (!dryRun && !scoreFixtures && git.dirty) {
  fail('Live benchmark requires a clean git worktree so its source can be reproduced.');
}

const schedule = seededSchedule(scenarioIds, scoreFixtures ? 1 : runs, armsWanted, seed);
const source = sourceManifest(scenarioIds);
const toolVersion = scoreFixtures || dryRun ? toolVersionFor(actor.binary) : requireToolVersion(actor.binary);
const config = {
  schema_version: 2,
  run_id: runId,
  mode: scoreFixtures ? 'fixtures' : dryRun ? 'dry-run' : 'live',
  actor: {
    tool: actor.tool,
    binary: actor.binary,
    version: toolVersion,
    model: actorModel || null,
    reasoning: actor.reasoning,
  },
  git,
  seed,
  runs,
  scenarios: scenarioIds,
  arms: armsWanted,
  budget: { timeout_ms_per_arm: timeoutMs, max_captured_output_bytes_per_stream: 20 * 1024 * 1024 },
  source,
  schedule,
};

mkdirSync(outRoot, { recursive: false });
writeJson(join(outRoot, 'config.json'), config);
console.log(`\nCallsmithBench ${config.mode}: ${schedule.length} scheduled pair(s)/arm set`);
console.log(`  model: ${actorModel || 'not applicable'}`);
console.log(`  seed: ${seed}; repeated runs: ${runs}`);
console.log(`  out: ${outRoot}\n`);

const results = [];
for (const scheduled of schedule) {
  const scenario = loadScenario(scheduled.scenarioId);
  const trialRoot = join(outRoot, `trial-${String(scheduled.trial).padStart(3, '0')}`, scenario.id);
  const result = { trial: scheduled.trial, scenarioId: scenario.id, arm_order: scheduled.arms, arms: {}, pair: null };

  if (scoreFixtures) {
    result.pair = scoreFixturePair(scenario, trialRoot);
    results.push(result);
    continue;
  }

  for (const arm of scheduled.arms) {
    const persistedRunDir = join(trialRoot, arm);
    const isolated = dryRun
      ? null
      : createIsolatedActorWorkspace(`${scheduled.trial}-${scenario.id}-${arm}`);
    const runDir = dryRun
      ? persistedRunDir
      : isolated.cwd;
    prepareArmWorkspace(arm, scenario, runDir);
    const prompt = buildActorPrompt(arm, scenario, runDir);
    const promptPath = join(runDir, 'actor-prompt.md');
    writeFileSync(promptPath, prompt);
    const artifactPaths = {
      answers: join(runDir, 'voice.answers.json'),
      recipe: join(runDir, 'callsmith.recipe.md'),
    };
    const before = snapshotArtifacts(Object.values(artifactPaths));
    const armRepro = {
      prompt_sha256: hashFile(promptPath),
      scenario_sha256: source.scenarios[scenario.id],
      provider_packs_sha256: source.provider_packs_sha256,
      model: actorModel || null,
      actor_tool: actor.tool,
      actor_reasoning: actor.reasoning,
      tool_version: toolVersion,
      budget: config.budget,
    };
    writeJson(join(runDir, 'reproducibility.json'), armRepro);

    if (dryRun) {
      const actorStatus = { status: 'DRY_RUN', valid: false, reasons: ['dry runs are never scored'] };
      writeJson(join(runDir, 'actor.status.json'), actorStatus);
      result.arms[arm] = { runDir, actor: actorStatus, score: null, reproducibility: armRepro };
      console.log(`  trial ${scheduled.trial} ${scenario.id} ${arm}: prepared`);
      continue;
    }

    process.stdout.write(`  trial ${scheduled.trial} ${scenario.id} ${arm}: actor ... `);
    prepareActorWorkspace(actor, runDir);
    const sessionsBefore = actor.tool === 'opencode' ? listSessions(actor.binary, runDir) : [];
    const startedAtMs = Date.now();
    const processResult = await runActor(actor, {
      prompt, cwd: runDir, arm, timeout: timeoutMs,
    });
    writeFileSync(join(runDir, 'actor.stdout.txt'), processResult.stdout || '');
    writeFileSync(join(runDir, 'actor.stderr.txt'), processResult.stderr || '');
    const trace = retainActorTrace(
      actor,
      processResult,
      runDir,
      () => exportNewestSession(actor.binary, sessionsBefore, runDir),
    );
    const validity = validateActorTrial({
      actor: {
        ...processResult,
        traceRequired: actor.tool === 'codex',
        trace,
      },
      artifacts: artifactPaths,
      before,
      startedAtMs,
    });
    const actorStatus = {
      status: processResult.status,
      signal: processResult.signal || null,
      duration_ms: processResult.durationMs,
      timed_out: processResult.timedOut,
      error: processResult.error,
      stdout_bytes: processResult.stdoutBytes,
      stderr_bytes: processResult.stderrBytes,
      stdout_truncated: processResult.stdoutTruncated,
      stderr_truncated: processResult.stderrTruncated,
      started_at: new Date(startedAtMs).toISOString(),
      finished_at: new Date().toISOString(),
      valid: validity.valid,
      invalid_reasons: validity.reasons,
      session_trace: trace,
    };
    writeJson(join(runDir, 'actor.status.json'), actorStatus);

    let score = null;
    if (validity.valid) {
      const { answers, recipe } = readArmArtifacts(runDir);
      score = scoreArm({
        scenario,
        answers,
        recipe,
        commandLog: actor.tool === 'codex'
          ? trace.command_log || ''
          : `${processResult.stdout || ''}\n${processResult.stderr || ''}`,
        arm,
      });
      score.task_success = taskSuccess(score);
      writeJson(join(runDir, 'score.json'), score);
    }
    rmSync(join(runDir, '.git'), { recursive: true, force: true });
    mkdirSync(trialRoot, { recursive: true });
    cpSync(runDir, persistedRunDir, { recursive: true });
    rmSync(isolated.root, { recursive: true, force: true });
    result.arms[arm] = { runDir: persistedRunDir, actor: actorStatus, score, reproducibility: armRepro };
    console.log(validity.valid ? 'valid' : `INVALID (${validity.reasons.join('; ')})`);
  }

  const withScore = result.arms.WITH?.score;
  const baseScore = result.arms.BASE?.score;
  if (withScore && baseScore) {
    result.pair = {
      ...pairDelta(withScore, baseScore),
      trial: scheduled.trial,
      valid: true,
      task_success: { WITH: taskSuccess(withScore), BASE: taskSuccess(baseScore) },
    };
    writeJson(join(trialRoot, 'pair.json'), result.pair);
  }
  results.push(result);
}

const summary = buildSummary(results, config);
writeJson(join(outRoot, 'summary.json'), summary);
writeFileSync(join(outRoot, 'report.md'), renderReport(summary, results));
console.log(`\nWrote ${join(outRoot, 'summary.json')}`);
console.log(`Primary success-rate lift: ${summary.metrics?.task_success?.lift ?? 'unpublished'}`);
if (summary.invalid_arms.length) {
  console.error(`Invalid live arms: ${summary.invalid_arms.length}; run is not publishable.`);
  process.exitCode = 1;
}

function buildSummary(results, configValue) {
  const fixturePairs = results.map((r) => r.pair).filter(Boolean);
  if (configValue.mode === 'fixtures') {
    return {
      schema_version: 2,
      run_id: configValue.run_id,
      publishable: false,
      reason: 'fixtures demonstrate scorer causality only',
      metrics: null,
      fixture_demo_deltas: fixturePairs.map((pair) => ({ scenario: pair.scenario_id, delta: pair.delta })),
      invalid_arms: [],
    };
  }

  const invalidArms = results.flatMap((result) => Object.entries(result.arms)
    .filter(([, arm]) => arm.actor?.status !== 'DRY_RUN' && !arm.actor?.valid)
    .map(([armName, arm]) => ({
      trial: result.trial,
      scenario: result.scenarioId,
      arm: armName,
      reasons: arm.actor.invalid_reasons,
    })));
  const metricPairs = results.filter((r) => r.pair).map((r) => ({
    scenarioId: r.scenarioId,
    trial: r.trial,
    WITH: r.arms.WITH.score,
    BASE: r.arms.BASE.score,
  }));
  return {
    schema_version: 2,
    run_id: configValue.run_id,
    publishable: configValue.mode === 'live'
      && invalidArms.length === 0
      && metricPairs.length === configValue.runs * configValue.scenarios.length,
    primary_metric: 'paired task-success-rate lift',
    metrics: configValue.mode === 'live' ? summarizeValidPairs(metricPairs, { runs: configValue.runs }) : null,
    invalid_arms: invalidArms,
    n_scheduled_pairs: configValue.runs * configValue.scenarios.length,
    n_valid_pairs: metricPairs.length,
    trials: results.map((r) => ({
      trial: r.trial,
      scenario: r.scenarioId,
      arm_order: r.arm_order,
      paired: Boolean(r.pair),
      task_success: r.pair?.task_success || null,
      diagnostic_gate_delta: r.pair?.delta ?? null,
    })),
  };
}

function renderReport(summary, results) {
  const lines = ['# CallsmithBench run', '', `Run: \`${summary.run_id}\``, ''];
  if (!summary.metrics) {
    lines.push('**Primary metric: not published** (dry run or fixture-only scorer demo).', '');
  } else {
    const metric = summary.metrics.task_success;
    lines.push(
      `**Paired task-success lift:** ${format(metric.lift)} `
      + `(WITH ${format(metric.WITH)} vs BASE ${format(metric.BASE)}, n=${summary.n_valid_pairs})`,
      '',
      `95% interval: ${format(metric.lift_95ci?.low)} to ${format(metric.lift_95ci?.high)} (${metric.lift_95ci?.method}).`,
      '',
      `**pass^${summary.metrics.pass_power_k.k}:** ${format(summary.metrics.pass_power_k.rate)}`,
      '',
      'Task success requires every machine gate; G_REAL is a hard veto. Gate-score delta is diagnostic only.',
      '',
    );
  }
  lines.push('| Trial | Scenario | BASE success | WITH success | Gate Δ (diagnostic) |', '|---:|---|---:|---:|---:|');
  for (const result of results) {
    lines.push(`| ${result.trial} | ${result.scenarioId} | ${bool(result.pair?.task_success?.BASE)} | ${bool(result.pair?.task_success?.WITH)} | ${result.pair?.delta ?? '—'} |`);
  }
  lines.push('');
  if (summary.invalid_arms?.length) {
    lines.push('## Invalid, unscored arms', '');
    for (const invalid of summary.invalid_arms) {
      lines.push(`- Trial ${invalid.trial} ${invalid.scenario} ${invalid.arm}: ${invalid.reasons.join('; ')}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function scoreFixturePair(scenario, outDir) {
  mkdirSync(outDir, { recursive: true });
  const fixtures = join(scenario.dir, 'fixtures');
  const withAnswersPath = firstExisting(fixtures, ['with-pass.answers.json', 'honest-heavy.answers.json']);
  const withRecipePath = firstExisting(fixtures, ['with-pass.recipe.md', 'honest-heavy.recipe.md']);
  if (!withAnswersPath || !withRecipePath) return null;
  const withScore = scoreArm({
    scenario,
    answers: JSON.parse(readFileSync(withAnswersPath, 'utf8')),
    recipe: readFileSync(withRecipePath, 'utf8'),
    arm: 'WITH',
  });
  const baseAnswersPath = firstExisting(fixtures, ['base-fail.answers.json']);
  const baseRecipePath = firstExisting(fixtures, ['keyword-theater.recipe.md']);
  const baseScore = scoreArm({
    scenario,
    answers: baseAnswersPath ? JSON.parse(readFileSync(baseAnswersPath, 'utf8')) : scenario.poison || {},
    recipe: baseRecipePath ? readFileSync(baseRecipePath, 'utf8') : '# Invalid fixture baseline\n',
    arm: 'BASE',
  });
  writeJson(join(outDir, 'with.score.json'), withScore);
  writeJson(join(outDir, 'base.score.json'), baseScore);
  const pair = { ...pairDelta(withScore, baseScore), source: 'fixtures_only_not_publishable' };
  writeJson(join(outDir, 'pair.json'), pair);
  return pair;
}

function sourceManifest(ids) {
  return {
    provider_packs_sha256: hashTree(join(REPO_ROOT, 'providers')),
    harness_sha256: hashTree(HERE),
    scenarios: Object.fromEntries(ids.map((id) => [id, hashTree(join(HERE, '..', 'scenarios', id))])),
  };
}

function hashTree(dir) {
  const files = walk(dir).sort();
  return sha256(files.map((file) => `${relative(dir, file)}\0${hashFile(file)}`).join('\n'));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function gitState() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status !== 0 || Boolean(status.stdout.trim()),
  };
}

function toolVersionFor(binary) {
  const result = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 30000 });
  return result.status === 0 ? (result.stdout || result.stderr).trim() : null;
}

function requireToolVersion(binary) {
  const version = toolVersionFor(binary);
  if (!version) fail(`Cannot identify actor tool version: ${binary} --version failed.`);
  return version;
}

function listSessions(binary, cwd) {
  const result = spawnSync(binary, ['session', 'list', '--format', 'json', '--max-count', '20'], {
    cwd, encoding: 'utf8', timeout: 30000,
  });
  if (result.status !== 0) return [];
  try {
    const sessions = JSON.parse(result.stdout);
    return Array.isArray(sessions) ? sessions : [];
  } catch { return []; }
}

function exportNewestSession(binary, before, runDir) {
  const after = listSessions(binary, runDir);
  const previous = new Set(before.map(sessionId));
  const newest = after.find((session) => !previous.has(sessionId(session)));
  const id = sessionId(newest);
  if (!id) return { retained: false, reason: 'actor tool exposed no session id' };
  const result = spawnSync(binary, ['export', id, '--sanitize'], {
    cwd: runDir, encoding: 'utf8', timeout: 60000, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout) {
    if (result.stderr) writeFileSync(join(runDir, 'session-export.err.txt'), result.stderr);
    return { retained: false, session_id: id, reason: 'session export failed' };
  }
  writeFileSync(join(runDir, 'session-export.json'), result.stdout);
  return { retained: true, session_id: id, file: 'session-export.json', sanitized: true };
}

function sessionId(session) {
  return session?.id || session?.sessionID || session?.sessionId || session?.uuid || null;
}

function firstExisting(dir, names) {
  return names.map((name) => join(dir, name)).find(existsSync) || null;
}

function parseArms(value) {
  if (value === 'both' || value === true) return ['BASE', 'WITH'];
  return String(value).split(',').map((arm) => arm.trim().toUpperCase())
    .filter((arm, index, all) => ['BASE', 'WITH'].includes(arm) && all.indexOf(arm) === index);
}

function parseArgs(items) {
  const parsed = {};
  for (let i = 0; i < items.length; i += 1) {
    if (!items[i].startsWith('--')) continue;
    const key = items[i].slice(2);
    parsed[key] = items[i + 1] && !items[i + 1].startsWith('--') ? items[++i] : true;
  }
  return parsed;
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) fail(`${label} must be a positive integer.`);
  return parsed;
}

function writeJson(file, value) {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

function format(value) { return value === null || value === undefined ? '—' : Number(value).toFixed(3); }
function bool(value) { return value === undefined ? '—' : value ? '1' : '0'; }
