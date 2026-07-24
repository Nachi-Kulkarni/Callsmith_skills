#!/usr/bin/env node
/** Reproducible BASE/WITH CallsmithBench runner. */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  cpSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, listScenarioIds, scoreArm, pairDelta } from './score.mjs';
import { prepareArmWorkspace, readArmArtifacts, REPO_ROOT } from './prepare.mjs';
import { buildActorPrompt } from './prompts.mjs';
import {
  actorSpec,
  createIsolatedActorWorkspace,
  modelFamilyFor,
  prepareActorWorkspace,
  prepareCodexActorHome,
  prepareGrokActorHome,
  retainActorTrace,
  resolveActorExecutable,
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
const actorToolEnvBin = {
  codex: 'CODEX_BIN',
  opencode: 'OPENCODE_BIN',
  grok: 'GROK_BIN',
}[actorTool];
const actorToolEnvModel = {
  codex: 'CODEX_ACTOR_MODEL',
  opencode: 'OPENCODE_ACTOR_MODEL',
  grok: 'GROK_ACTOR_MODEL',
}[actorTool];
const actorToolEnvReasoning = {
  codex: 'CODEX_ACTOR_REASONING',
  grok: 'GROK_ACTOR_REASONING',
}[actorTool];
let actor;
try {
  actor = actorSpec({
    tool: actorTool,
    binary: args['actor-bin'] || args['opencode-bin']
      || (actorToolEnvBin ? process.env[actorToolEnvBin] : undefined),
    model: args['actor-model']
      || (actorToolEnvModel ? process.env[actorToolEnvModel] : undefined)
      || '',
    reasoning: args['actor-reasoning'] || (actorToolEnvReasoning ? process.env[actorToolEnvReasoning] : undefined) || null,
  });
} catch (error) {
  fail(error.message);
}
const actorModel = actor.model;
const derivedActorFamily = modelFamilyFor(actorModel);
const actorFamily = derivedActorFamily;
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
if (!dryRun && !scoreFixtures && ['codex', 'grok'].includes(actor.tool) && !actor.reasoning) {
  fail(`Live ${actor.tool} runs require --actor-reasoning so reasoning effort is reproducible.`);
}
if (!dryRun && !scoreFixtures && ['codex', 'grok'].includes(actor.tool) && !derivedActorFamily) {
  fail(`Live ${actor.tool} publication requires a model ID with a reviewed family mapping.`);
}
if (existsSync(outRoot)) fail(`Refusing reused run directory: ${outRoot}`);

const git = gitState();
if (!dryRun && !scoreFixtures && git.dirty) {
  fail('Live benchmark requires a clean git worktree so its source can be reproduced.');
}

const schedule = seededSchedule(scenarioIds, scoreFixtures ? 1 : runs, armsWanted, seed);
const source = sourceManifest(scenarioIds);
if (!dryRun && !scoreFixtures) actor.binary = resolveActorExecutable(actor.binary, REPO_ROOT);
const toolVersion = scoreFixtures || dryRun ? toolVersionFor(actor.binary) : requireToolVersion(actor.binary);
const actorBinarySha256 = !dryRun && !scoreFixtures ? hashFile(actor.binary) : null;
const config = {
  schema_version: 2,
  run_id: runId,
  mode: scoreFixtures ? 'fixtures' : dryRun ? 'dry-run' : 'live',
  actor: {
    tool: actor.tool,
    binary: actor.binary,
    binary_sha256: actorBinarySha256,
    version: toolVersion,
    model: actorModel || null,
    family: actorFamily || null,
    reasoning: actor.reasoning,
    isolation: ['codex', 'grok'].includes(actor.tool) ? {
      ephemeral_session: true,
      ignore_user_config: true,
      ignore_user_rules: true,
      auth_only_home: true,
      plugins_disabled: true,
      hooks_disabled: true,
      memories_disabled: true,
    } : null,
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

mkdirSync(outRoot, { recursive: true });
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
      git_commit: git.commit,
      seed,
      arm,
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
    prepareCodexActorHome(actor, isolated.home, isolated.bin);
    prepareGrokActorHome(actor, isolated.home, isolated.bin);
    const sessionsBefore = actor.tool === 'opencode' ? listSessions(actor.binary, runDir) : [];
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
    const trace = retainActorTrace(
      actor,
      processResult,
      runDir,
      () => exportNewestSession(actor.binary, sessionsBefore, runDir),
    );
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

const finalGit = config.mode === 'live' ? gitState() : git;
const finalSource = config.mode === 'live' ? sourceManifest(scenarioIds) : source;
const finalActorBinarySha256 = config.mode === 'live' ? hashFile(actor.binary) : actorBinarySha256;
const sourceStable = config.mode !== 'live'
  || (finalGit.commit === git.commit && finalGit.dirty === false
    && JSON.stringify(finalSource) === JSON.stringify(source)
    && finalActorBinarySha256 === actorBinarySha256);
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

function buildSummary(results, configValue, { sourceStable = true } = {}) {
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
  const expectedPairs = configValue.runs * configValue.scenarios.length;
  const runValid = configValue.mode === 'live'
    && invalidArms.length === 0
    && metricPairs.length === expectedPairs
    && sourceStable;
  // core10 suite or a superset that includes it (the suite grew past 10 scenarios
  // when deploy-managed-cloud-pilot was added; a full-suite run remains required).
  const repeatedCore10 = configValue.runs >= 3
    && configValue.scenarios.length >= 10
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
      `**regulated pass^${summary.metrics.regulated_pass_power_k.k}:** ${format(summary.metrics.regulated_pass_power_k.rate)}`,
      '',
      `Floor lift ${format(summary.metrics.floor_lift)} · physics lift ${format(summary.metrics.physics_lift)} · BASE floor/physics fail rate ${format(summary.metrics.base_fail)}`,
      '',
      'Task success requires every machine gate; G_REAL is a hard veto. Gate-score delta is diagnostic only.',
      '',
    );
  }
  if (summary.run_valid && !summary.publishable) {
    lines.push('**Valid diagnostic run, not a publication run:** publication requires repeated core10; the product claim additionally requires a second model family.', '');
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
    scorer_sha256: hashPaths([
      join(REPO_ROOT, 'evals/csb/oracles'),
      join(REPO_ROOT, 'src/lib'),
      join(REPO_ROOT, 'data'),
    ]),
    product_sha256: hashPaths([
      join(REPO_ROOT, 'SKILL.md'),
      join(REPO_ROOT, 'bin'),
      join(REPO_ROOT, 'src'),
      join(REPO_ROOT, 'data'),
      join(REPO_ROOT, 'reference'),
    ]),
    scenarios: Object.fromEntries(ids.map((id) => [id, hashTree(join(HERE, '..', 'scenarios', id))])),
  };
}

function hashTree(dir) {
  const files = walk(dir).sort();
  return sha256(files.map((file) => `${relative(dir, file)}\0${hashFile(file)}`).join('\n'));
}

function hashPaths(paths) {
  const files = paths.flatMap((path) => (lstatSync(path).isDirectory() ? walk(path) : [path])).sort();
  return sha256(files.map((file) => `${relative(REPO_ROOT, file)}\0${hashFile(file)}`).join('\n'));
}

function assertIsolatedWorkspace(root, runDir) {
  if (lstatSync(runDir).isSymbolicLink()) throw new Error('workspace root became a symlink');
  const realRoot = realpathSync(root);
  const realRunDir = realpathSync(runDir);
  if (!realRunDir.startsWith(`${realRoot}${sep}`)) throw new Error('workspace escaped its isolated root');
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
