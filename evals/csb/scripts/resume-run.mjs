#!/usr/bin/env node
/**
 * Resume an interrupted CSB run without re-invoking the actor for arms that
 * already completed validly in a source run.
 *
 * This orchestrator lives OUTSIDE evals/csb/harness/ on purpose: it must not
 * change the harness_sha256 that every arm's reproducibility receipt pins. It
 * reuses the harness's exported functions (no duplicated scoring/trace logic),
 * copies completed arms verbatim from the source, and invokes the actor only
 * for the missing trial/scenario/arm positions on the seeded schedule.
 *
 * The resulting run directory has the same shape as a fresh run-arms.mjs run
 * and is publication-eligible if it completes all scheduled pairs validly.
 */
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actorSpec,
  createIsolatedActorWorkspace,
  modelFamilyFor,
  prepareActorWorkspace,
  prepareCodexActorHome,
  prepareGrokActorHome,
  resolveActorExecutable,
  retainActorTrace,
  runActor,
} from '../harness/actors.mjs';
import { prepareArmWorkspace, readArmArtifacts, REPO_ROOT } from '../harness/prepare.mjs';
import { buildActorPrompt } from '../harness/prompts.mjs';
import { loadScenario, listScenarioIds, scoreArm, pairDelta } from '../harness/score.mjs';
import {
  hashFile,
  seededSchedule,
  sha256,
  snapshotArtifacts,
  summarizeValidPairs,
  taskSuccess,
  validateActorTrial,
} from '../harness/validity.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = parseArgs(process.argv.slice(2));
const sourceRoot = args['resume-from'] ? resolve(String(args['resume-from'])) : null;
if (!sourceRoot) fail('Usage: resume-run.mjs --resume-from <partial-run> --actor-tool grok --actor-model grok-4.5 --actor-reasoning high [--runs 3] [--seed <seed>] [--out <dir>]');
if (!existsSync(sourceRoot)) fail(`Resume source does not exist: ${sourceRoot}`);

// Inherit the run design from the source config so the resumed run is identical.
const sourceConfig = JSON.parse(readFileSync(join(sourceRoot, 'config.json'), 'utf8'));
if (sourceConfig.schema_version !== 2 || sourceConfig.mode !== 'live') {
  fail('Resume source must be a schema-v2 live run.');
}
const { runs, seed, scenarios: scenarioIds, arms: armsWanted, budget, schedule, source } = sourceConfig;
const actorTool = String(sourceConfig.actor.tool);
const actorModel = sourceConfig.actor.model;
const actorReasoning = sourceConfig.actor.reasoning;
const runId = args['run-id'] || `resumed-${basename(sourceRoot)}`;
const outRoot = resolve(args.out || join(dirname(sourceRoot), runId));
const timeoutMs = budget.timeout_ms_per_arm;

let actor;
try {
  actor = actorSpec({
    tool: actorTool,
    binary: sourceConfig.actor.binary,
    model: actorModel,
    reasoning: actorReasoning,
  });
} catch (error) {
  fail(error.message);
}
const actorFamily = modelFamilyFor(actorModel);

if (existsSync(outRoot)) fail(`Refusing reused run directory: ${outRoot}`);

const git = gitState();
if (git.dirty) fail('Live benchmark requires a clean git worktree so its source can be reproduced.');

actor.binary = resolveActorExecutable(actor.binary, REPO_ROOT);
// Pin the actor version/binary-hash from the source config so resumed and fresh
// arms carry identical actor receipts. The binary itself is unchanged across a
// resume; pinning from source keeps the run internally consistent even if the
// orchestrator is invoked from a later commit.
const toolVersion = sourceConfig.actor.version;
const actorBinarySha256 = sourceConfig.actor.binary_sha256;

// Reuse the source config verbatim so every receipt matches. Only the run_id/out
// change; the schedule, hashes, actor, seed, and budget are frozen from the source.
const config = { ...sourceConfig, run_id: runId };

mkdirSync(outRoot, { recursive: true });
writeJson(join(outRoot, 'config.json'), config);
console.log(`\nCallsmithBench resume: ${schedule.length} scheduled pair(s)/arm set`);
console.log(`  source: ${sourceRoot}`);
console.log(`  model: ${actorModel} · ${actorTool} · ${actorReasoning || 'no reasoning'}`);
console.log(`  seed: ${seed}; repeated runs: ${runs}`);
console.log(`  out: ${outRoot}\n`);

const results = [];
for (const scheduled of schedule) {
  const scenario = loadScenario(scheduled.scenarioId);
  const trialRoot = join(outRoot, `trial-${String(scheduled.trial).padStart(3, '0')}`, scenario.id);
  const result = { trial: scheduled.trial, scenarioId: scenario.id, arm_order: scheduled.arms, arms: {}, pair: null };

  for (const arm of scheduled.arms) {
    const persistedRunDir = join(trialRoot, arm);

    // Resume: reuse a valid completed arm from the source instead of re-invoking.
    const resumed = tryResumeArm(sourceRoot, scheduled.trial, scenario.id, arm, persistedRunDir);
    if (resumed) {
      result.arms[arm] = resumed;
      console.log(`  trial ${scheduled.trial} ${scenario.id} ${arm}: resumed`);
      continue;
    }

    // Fresh arm: mirror run-arms.mjs exactly so receipts are consistent.
    const isolated = createIsolatedActorWorkspace(`${scheduled.trial}-${scenario.id}-${arm}`);
    const runDir = isolated.cwd;
    prepareArmWorkspace(arm, scenario, runDir);
    const prompt = buildActorPrompt(arm, scenario, runDir);
    const promptPath = join(runDir, 'actor-prompt.md');
    writeFileSync(promptPath, prompt);
    const artifactPaths = {
      answers: join(runDir, 'voice.answers.json'),
      recipe: join(runDir, 'callsmith.recipe.md'),
    };
    if (existsSync(artifactPaths.answers)) {
      writeFileSync(join(runDir, 'input-seed.answers.json'), readFileSync(artifactPaths.answers));
    }
    const controlledInputs = {
      brief: join(runDir, 'brief.md'),
      scenario: join(runDir, 'scenario.json'),
      output_schema: join(runDir, 'OUTPUT_SCHEMA.md'),
      actor_prompt: promptPath,
      input_seed: join(runDir, 'input-seed.answers.json'),
    };
    const before = snapshotArtifacts([
      ...Object.values(artifactPaths),
      ...Object.values(controlledInputs),
    ]);
    const armRepro = {
      prompt_sha256: hashFile(promptPath),
      scenario_sha256: source.scenarios[scenario.id],
      provider_packs_sha256: source.provider_packs_sha256,
      harness_sha256: source.harness_sha256,
      scorer_sha256: source.scorer_sha256,
      product_sha256: source.product_sha256,
      model: actorModel || null,
      model_family: actorFamily || null,
      actor_tool: actor.tool,
      actor_reasoning: actor.reasoning,
      tool_version: toolVersion,
      actor_binary_sha256: actorBinarySha256,
      git_commit: sourceConfig.git.commit,
      seed,
      arm,
      budget,
    };
    writeJson(join(runDir, 'reproducibility.json'), armRepro);

    process.stdout.write(`  trial ${scheduled.trial} ${scenario.id} ${arm}: actor ... `);
    prepareActorWorkspace(actor, runDir);
    prepareCodexActorHome(actor, isolated.home, isolated.bin);
    prepareGrokActorHome(actor, isolated.home, isolated.bin);
    const startedAtMs = Date.now();
    const processResult = await runActor(actor, {
      prompt, cwd: runDir, arm, timeout: timeoutMs,
      actorHome: isolated.home, actorBin: isolated.bin,
    });
    try {
      assertIsolatedWorkspace(isolated.root, runDir);
    } catch (error) {
      rmSync(isolated.root, { recursive: true, force: true });
      fail(`Actor workspace boundary violated: ${error.message}`);
    }
    writeFileSync(join(runDir, 'actor.stdout.txt'), processResult.stdout || '');
    writeFileSync(join(runDir, 'actor.stderr.txt'), processResult.stderr || '');
    const trace = retainActorTrace(actor, processResult, runDir, () => ({ retained: false }));
    const validity = validateActorTrial({
      actor: {
        ...processResult,
        traceRequired: ['codex', 'grok'].includes(actor.tool),
        trace,
      },
      artifacts: artifactPaths,
      immutable: controlledInputs,
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
        commandLog: ['codex', 'grok'].includes(actor.tool)
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

const finalGit = gitState();
const sourceStable = finalGit.commit === git.commit && finalGit.dirty === false;
const summary = buildSummary(results, config, { sourceStable });
writeJson(join(outRoot, 'summary.json'), summary);
writeFileSync(join(outRoot, 'report.md'), renderReport(summary, results));
console.log(`\nWrote ${join(outRoot, 'summary.json')}`);
console.log(`Primary success-rate lift: ${summary.metrics?.task_success?.lift ?? 'unpublished'}`);
if (summary.invalid_arms.length) {
  console.error(`Invalid live arms: ${summary.invalid_arms.length}; run is not publishable.`);
  process.exitCode = 1;
}
if (!sourceStable) {
  console.error('Benchmark source drifted during the live run; results are not publishable.');
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Resume helper
// ---------------------------------------------------------------------------

function tryResumeArm(source, trial, scenarioId, arm, persistedRunDir) {
  const trialName = `trial-${String(trial).padStart(3, '0')}`;
  const sourceArmDir = join(source, trialName, scenarioId, arm);
  if (!existsSync(join(sourceArmDir, 'actor.status.json'))) return null;
  if (!existsSync(join(sourceArmDir, 'score.json'))) return null;
  const status = JSON.parse(readFileSync(join(sourceArmDir, 'actor.status.json'), 'utf8'));
  if (status.status !== 0 || status.valid !== true) return null;
  mkdirSync(persistedRunDir, { recursive: true });
  cpSync(sourceArmDir, persistedRunDir, { recursive: true });
  const score = JSON.parse(readFileSync(join(persistedRunDir, 'score.json'), 'utf8'));
  const repro = JSON.parse(readFileSync(join(persistedRunDir, 'reproducibility.json'), 'utf8'));
  return { runDir: persistedRunDir, actor: status, score, reproducibility: repro };
}

// ---------------------------------------------------------------------------
// Summary + report (mirror run-arms.mjs so receipts are interchangeable)
// ---------------------------------------------------------------------------

function buildSummary(results, configValue, { sourceStable = true } = {}) {
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
  const expectedPairs = configValue.runs * configValue.scenarios.length;
  const runValid = configValue.mode === 'live'
    && invalidArms.length === 0
    && metricPairs.length === expectedPairs
    && sourceStable;
  const repeatedCore10 = configValue.runs >= 3
    && configValue.scenarios.length === 10
    && ['BASE', 'WITH'].every((arm) => configValue.arms.includes(arm));
  const namedModelFamily = typeof configValue.actor.family === 'string' && configValue.actor.family.length > 0;
  const actorIsolationEligible = ['codex', 'grok'].includes(configValue.actor.tool)
    && [
      'ephemeral_session', 'ignore_user_config', 'ignore_user_rules', 'auth_only_home',
      'plugins_disabled', 'hooks_disabled', 'memories_disabled',
    ].every((key) => configValue.actor.isolation?.[key] === true);
  const regulatedScenarioIds = configValue.scenarios.filter((id) => {
    const domain = loadScenario(id).manifest.domain;
    return ['medical', 'banking', 'collections'].includes(domain);
  });
  const traces = results.flatMap((result) => Object.values(result.arms)
    .map((arm) => arm.actor?.session_trace)
    .filter(Boolean));
  return {
    schema_version: 2,
    run_id: configValue.run_id,
    run_valid: runValid,
    publishable: runValid && repeatedCore10 && actorIsolationEligible && namedModelFamily,
    publication_requirements: {
      repeated_core10: repeatedCore10,
      actor_isolation_eligible: actorIsolationEligible,
      named_model_family: namedModelFamily,
      source_stable_through_run: sourceStable,
      second_model_family_required_for_product_claim: true,
      product_claim_eligible_from_this_run_alone: false,
    },
    primary_metric: 'paired task-success-rate lift',
    metrics: configValue.mode === 'live'
      ? summarizeValidPairs(metricPairs, { runs: configValue.runs, regulatedScenarioIds })
      : null,
    trace_sanitization: {
      retained_traces: traces.length,
      sanitized_traces: traces.filter((trace) => trace.sanitized === true).length,
      all_retained_traces_sanitized: traces.length > 0 && traces.every((trace) => trace.sanitized === true),
      note: 'Raw run traces are local diagnostics. Sanitize copies before adding a public evidence bundle.',
    },
    invalid_arms: invalidArms,
    n_scheduled_pairs: expectedPairs,
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
  const lines = ['# CallsmithBench run (resumed)', '', `Run: \`${summary.run_id}\``, ''];
  if (!summary.metrics) {
    lines.push('**Primary metric: not published**.', '');
  } else {
    const metric = summary.metrics.task_success;
    lines.push(
      `**Paired task-success lift:** ${format(metric.lift)} `
      + `(WITH ${format(metric.WITH)} vs BASE ${format(metric.BASE)}, n=${summary.n_valid_pairs})`,
      '',
      `95% interval: ${format(metric.lift_95ci?.low)} to ${format(metric.lift_95ci?.high)} (${metric.lift_95ci?.method}).`,
      '',
      `Floor lift ${format(summary.metrics.floor_lift)} · physics lift ${format(summary.metrics.physics_lift)} · BASE floor/physics fail rate ${format(summary.metrics.base_fail)}`,
      '',
      'Task success requires every machine gate; G_REAL is a hard veto.',
      '',
    );
  }
  lines.push('| Trial | Scenario | BASE success | WITH success | Gate Δ (diagnostic) |', '|---:|---|---:|---:|---:|');
  for (const result of results) {
    lines.push(`| ${result.trial} | ${result.scenarioId} | ${bool(result.pair?.task_success?.BASE)} | ${bool(result.pair?.task_success?.WITH)} | ${result.pair?.delta ?? '—'} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function assertIsolatedWorkspace(root, runDir) {
  if (lstatSync(runDir).isSymbolicLink()) throw new Error('workspace root became a symlink');
  const realRoot = realpathSync(root);
  const realRunDir = realpathSync(runDir);
  if (!realRunDir.startsWith(`${realRoot}${sep}`)) throw new Error('workspace escaped its isolated root');
}

function gitState() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return {
    commit: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status !== 0 || Boolean(status.stdout.trim()),
  };
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

function parseArgs(items) {
  const parsed = {};
  for (let i = 0; i < items.length; i += 1) {
    if (!items[i].startsWith('--')) continue;
    const key = items[i].slice(2);
    parsed[key] = items[i + 1] && !items[i + 1].startsWith('--') ? items[++i] : true;
  }
  return parsed;
}
