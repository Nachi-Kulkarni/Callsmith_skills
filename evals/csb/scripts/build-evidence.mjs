#!/usr/bin/env node
/** Build a reviewable, sanitized, content-addressed CSB evidence bundle. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { modelFamilyFor, parseActorTrace } from '../harness/actors.mjs';
import { outputSchemaText, REPO_ROOT } from '../harness/prepare.mjs';
import { buildActorPrompt } from '../harness/prompts.mjs';
import { listScenarioIds, loadScenario, pairDelta, scoreArm } from '../harness/score.mjs';
import { summarizeValidPairs, taskSuccess } from '../harness/validity.mjs';

const HERE = fileURLToPath(import.meta.url);
const ROOT_FILES = ['config.json', 'summary.json'];
const ARM_FILES = [
  'brief.md',
  'scenario.json',
  'OUTPUT_SCHEMA.md',
  'input-seed.answers.json',
  'actor-prompt.md',
  'actor.status.json',
  'reproducibility.json',
  'score.json',
  'voice.answers.json',
  'callsmith.recipe.md',
];
const GATES = ['G_FLOOR', 'G_PHYS', 'G_CON', 'G_REAL'];
const SECRET_KEY = /^(?:api[_-]?key|.*[_-]?token|authorization|auth|cookie|secret|password|private[_-]?key)$/i;
const SAFE_TOKEN = /^[A-Za-z0-9._:/+-]+$/;

export function sanitizeString(value, roots = []) {
  let result = String(value);
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    if (root) result = result.replaceAll(root, '$RUN_SOURCE');
  }
  result = result
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '$HOME')
    .replace(/\/private\/tmp\/callsmith-csb-[^/\s"']+\/workspace/g, '$WORKSPACE')
    .replace(/\/tmp\/callsmith-csb-[^/\s"']+\/workspace/g, '$WORKSPACE')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{12,}\b/gi, '[REDACTED_CREDENTIAL]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[=:]\s*[^\s"']+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  return result;
}

export function sanitizeJsonValue(value, roots = [], key = '') {
  if (SECRET_KEY.test(key) && typeof value === 'string') return '[REDACTED]';
  if (['thread_id', 'session_id'].includes(key) && value) return '[REDACTED_TRACE_ID]';
  if (['command', 'command_log'].includes(key) && typeof value === 'string') return '[REDACTED_COMMAND]';
  if (typeof value === 'string') {
    if (key === 'file' && value === 'actor.events.jsonl') return 'actor.events.sanitized.jsonl';
    if (key === 'file' && value === 'actor.stderr.txt') return 'actor.stderr.sanitized.txt';
    return sanitizeString(value, roots);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item, roots));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    sanitizeJsonValue(child, roots, childKey),
  ]));
}

export function sanitizeTrace(jsonl, roots = []) {
  const output = [];
  for (const [index, line] of String(jsonl).split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Trace line ${index + 1} is not valid JSONL; refusing partial publication.`);
    }
    output.push(JSON.stringify(publicTraceEvent(event, roots)));
  }
  return `${output.join('\n')}\n`;
}

export function buildEvidenceBundle({ source, out, provenanceVerifier = verifyCheckoutProvenance }) {
  const sourceRoot = resolve(source);
  const outRoot = resolve(out);
  assertDirectory(sourceRoot, 'Run source');
  if (existsSync(outRoot)) throw new Error(`Refusing existing evidence directory: ${outRoot}`);
  if (outRoot === sourceRoot || outRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('Evidence output must be outside the raw run directory.');
  }
  for (const required of ROOT_FILES) assertRegularFile(join(sourceRoot, required), sourceRoot);
  const config = JSON.parse(readFileSync(join(sourceRoot, 'config.json'), 'utf8'));
  const sourceSummary = JSON.parse(readFileSync(join(sourceRoot, 'summary.json'), 'utf8'));
  provenanceVerifier(config);
  const validation = validateSourceRun(sourceRoot, config, sourceSummary);

  mkdirSync(outRoot, { recursive: true });
  const roots = [sourceRoot, dirname(sourceRoot)];
  for (const name of ROOT_FILES) writeSanitized(join(sourceRoot, name), join(outRoot, name), roots, sourceRoot);
  for (const pair of validation.pairs) {
    const pairRel = join(`trial-${String(pair.trial).padStart(3, '0')}`, pair.scenarioId);
    const rawPairRoot = join(sourceRoot, pairRel);
    writeSanitized(
      join(rawPairRoot, 'pair.json'),
      join(outRoot, pairRel, 'pair.json'),
      roots,
      sourceRoot,
    );
    for (const arm of ['BASE', 'WITH']) {
      const rawArm = join(rawPairRoot, arm);
      const publishedArm = join(outRoot, pairRel, arm);
      for (const name of ARM_FILES) {
        writeSanitized(join(rawArm, name), join(publishedArm, name), roots, sourceRoot);
      }
      const publishedPrompt = join(publishedArm, 'actor-prompt.md');
      const publishedRepro = join(publishedArm, 'reproducibility.json');
      const repro = JSON.parse(readFileSync(publishedRepro, 'utf8'));
      repro.prompt_sha256 = sha256(readFileSync(publishedPrompt));
      writeFileSync(publishedRepro, `${JSON.stringify(repro, null, 2)}\n`);
      const deletedGenerator = pair[arm].details?.G_REAL?.checks
        ?.find((check) => check.id === 'no_deleted_generators')?.ok === false;
      writeFileSync(join(publishedArm, 'command-policy.json'), `${JSON.stringify({
        schema_version: 1,
        deleted_generator_used: deletedGenerator,
      }, null, 2)}\n`);
      const traceSource = join(rawArm, 'actor.events.jsonl');
      assertRegularFile(traceSource, sourceRoot);
      const target = join(publishedArm, 'actor.events.sanitized.jsonl');
      ensureParent(target);
      writeFileSync(target, sanitizeTrace(readFileSync(traceSource, 'utf8'), roots));
    }
  }

  writeCaseStudies({
    sourceRoot,
    outRoot,
    config,
    pairs: validation.pairs,
    roots,
  });
  writeValidatedReport(outRoot, config, validation);

  const redaction = [
    '# Redaction receipt',
    '',
    `Source run id: \`${sanitizeString(basename(sourceRoot), roots)}\``,
    '',
    '- Raw traces remain local and are not copied.',
    '- Absolute user/run paths, trace identifiers, email addresses, authorization headers, and common secret fields are redacted.',
    '- Command text and command output are removed from JSONL traces; event outcomes remain.',
    '- `auth.json`, raw stdout/stderr, caches, Git metadata, and unrecognized files are excluded by allowlist.',
    '- Every published file is covered by `MANIFEST.sha256`.',
    '',
  ].join('\n');
  writeFileSync(join(outRoot, 'REDACTION.md'), redaction);
  writeReproduction(outRoot, config);
  const publishedSummaryPath = join(outRoot, 'summary.json');
  const publishedSummary = JSON.parse(readFileSync(publishedSummaryPath, 'utf8'));
  publishedSummary.metrics = validation.metrics;
  publishedSummary.trials = validation.pairs.map((pair) => ({
    trial: pair.trial,
    scenario: pair.scenarioId,
    arm_order: pair.armOrder,
    paired: true,
    task_success: { WITH: taskSuccess(pair.WITH), BASE: taskSuccess(pair.BASE) },
    diagnostic_gate_delta: pair.WITH.gateScore - pair.BASE.gateScore,
  }));
  publishedSummary.evidence_publication = {
    sanitized: true,
    source_checkout_verified: true,
    scores_recomputed: true,
    raw_trace_included: false,
    manifest: 'MANIFEST.sha256',
    redaction_receipt: 'REDACTION.md',
  };
  writeFileSync(publishedSummaryPath, `${JSON.stringify(publishedSummary, null, 2)}\n`);
  assertNoSecrets(outRoot);
  writeManifest(outRoot);
  return { out: outRoot, files: walk(outRoot).map((file) => relative(outRoot, file)).sort() };
}

export function verifyCheckoutProvenance(config) {
  const commit = config.git?.commit;
  const exists = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
  });
  if (exists.status !== 0) throw new Error(`Recorded benchmark commit is unavailable: ${commit}`);
  const sourcePaths = [
    'SKILL.md', 'bin', 'providers', 'reference', 'evals/csb/harness', 'evals/csb/oracles',
    'evals/csb/scenarios', 'src', 'data',
  ];
  const diff = spawnSync('git', ['diff', '--quiet', commit, '--', ...sourcePaths], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
  });
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths], {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 30000,
  });
  if (diff.status !== 0 || status.status !== 0 || status.stdout.trim()) {
    throw new Error(`Checkout does not match frozen benchmark source at ${commit}.`);
  }
  const actual = checkoutSourceManifest(config.scenarios || []);
  if (JSON.stringify(actual) !== JSON.stringify(config.source)) {
    throw new Error('Recorded source hashes do not match the frozen checkout.');
  }
  return actual;
}

function checkoutSourceManifest(ids) {
  const harness = join(REPO_ROOT, 'evals/csb/harness');
  return {
    provider_packs_sha256: hashTreeAt(join(REPO_ROOT, 'providers')),
    harness_sha256: hashTreeAt(harness),
    scorer_sha256: hashPathsAt([
      join(REPO_ROOT, 'evals/csb/oracles'),
      join(REPO_ROOT, 'src/lib'),
      join(REPO_ROOT, 'data'),
    ]),
    product_sha256: hashPathsAt([
      join(REPO_ROOT, 'SKILL.md'),
      join(REPO_ROOT, 'bin'),
      join(REPO_ROOT, 'src'),
      join(REPO_ROOT, 'data'),
      join(REPO_ROOT, 'reference'),
    ]),
    scenarios: Object.fromEntries(ids.map((id) => [
      id,
      hashTreeAt(join(REPO_ROOT, 'evals/csb/scenarios', id)),
    ])),
  };
}

function hashTreeAt(dir) {
  const files = walk(dir).sort();
  return sha256(files.map((file) => `${relative(dir, file)}\0${sha256(readFileSync(file))}`).join('\n'));
}

function hashPathsAt(paths) {
  const files = paths.flatMap((path) => (lstatSync(path).isDirectory() ? walk(path) : [path])).sort();
  return sha256(files.map((file) => `${relative(REPO_ROOT, file)}\0${sha256(readFileSync(file))}`).join('\n'));
}

function writeCaseStudies({ sourceRoot, outRoot, config, pairs, roots }) {
  const entries = [];
  for (const pair of pairs) {
    const trialName = `trial-${String(pair.trial).padStart(3, '0')}`;
    const rawPairRoot = join(sourceRoot, trialName, pair.scenarioId);
    const withScorePath = join(rawPairRoot, 'WITH', 'score.json');
    const baseScorePath = join(rawPairRoot, 'BASE', 'score.json');
    const withAnswersPath = join(rawPairRoot, 'WITH', 'voice.answers.json');
    const baseAnswersPath = join(rawPairRoot, 'BASE', 'voice.answers.json');
    for (const file of [withScorePath, baseScorePath, withAnswersPath, baseAnswersPath]) {
      assertRegularFile(file, sourceRoot);
    }

    const WITH = sanitizeJsonValue(JSON.parse(readFileSync(withScorePath, 'utf8')), roots);
    const BASE = sanitizeJsonValue(JSON.parse(readFileSync(baseScorePath, 'utf8')), roots);
    const withAnswers = sanitizeJsonValue(JSON.parse(readFileSync(withAnswersPath, 'utf8')), roots);
    const baseAnswers = sanitizeJsonValue(JSON.parse(readFileSync(baseAnswersPath, 'utf8')), roots);
    const withStatus = readOptionalJson(join(rawPairRoot, 'WITH', 'actor.status.json'), roots);
    const baseStatus = readOptionalJson(join(rawPairRoot, 'BASE', 'actor.status.json'), roots);
    const name = `${trialName}-${pair.scenarioId}.md`;
    const target = join(outRoot, 'case-studies', name);
    ensureParent(target);
    const gateRows = ['G_FLOOR', 'G_PHYS', 'G_CON', 'G_REAL']
      .map((gate) => `| ${gate} | ${BASE.gates?.[gate] === true ? 'pass' : 'fail'} | ${WITH.gates?.[gate] === true ? 'pass' : 'fail'} |`);
    const body = [
      `# ${pair.scenarioId}: BASE vs WITH`,
      '',
      `Trial ${pair.trial} · \`${config.actor.model}\` / \`${config.actor.reasoning}\` · ${config.actor.tool} \`${config.actor.version}\` · commit \`${config.git.commit}\``,
      '',
      `Task success: BASE **${taskSuccess(BASE) ? 'pass' : 'fail'}** · WITH **${taskSuccess(WITH) ? 'pass' : 'fail'}**`,
      '',
      '| Gate | BASE | WITH |',
      '|---|---|---|',
      ...gateRows,
      '',
      `Actor duration: BASE ${formatMs(baseStatus?.duration_ms)} · WITH ${formatMs(withStatus?.duration_ms)}. Duration is diagnostic; a failed design may finish early or late.`,
      '',
      '## BASE final answers',
      '',
      '```json',
      JSON.stringify(baseAnswers, null, 2),
      '```',
      '',
      '## WITH final answers',
      '',
      '```json',
      JSON.stringify(withAnswers, null, 2),
      '```',
      '',
      '## Receipts',
      '',
      `- [Common input seed](../${trialName}/${pair.scenarioId}/BASE/input-seed.answers.json) · [brief](../${trialName}/${pair.scenarioId}/BASE/brief.md) · [schema](../${trialName}/${pair.scenarioId}/BASE/OUTPUT_SCHEMA.md)`,
      `- [BASE contract](../${trialName}/${pair.scenarioId}/BASE/callsmith.recipe.md) · [score](../${trialName}/${pair.scenarioId}/BASE/score.json) · [sanitized trace](../${trialName}/${pair.scenarioId}/BASE/actor.events.sanitized.jsonl)`,
      `- [WITH contract](../${trialName}/${pair.scenarioId}/WITH/callsmith.recipe.md) · [score](../${trialName}/${pair.scenarioId}/WITH/score.json) · [sanitized trace](../${trialName}/${pair.scenarioId}/WITH/actor.events.sanitized.jsonl)`,
      '',
      'Both arms received the same brief, seed, model, budget, and output schema. Only WITH received Callsmith.',
      '',
    ].join('\n');
    writeFileSync(target, body);
    entries.push({
      name,
      scenario: pair.scenarioId,
      trial: pair.trial,
      BASE: taskSuccess(BASE),
      WITH: taskSuccess(WITH),
    });
  }
  if (entries.length !== pairs.length) throw new Error('Case-study count does not match paired receipts.');
  const index = [
    '# Paired case studies',
    '',
    'Generated from the sanitized receipts in this evidence bundle.',
    '',
    '| Trial | Scenario | BASE | WITH | Receipt |',
    '|---:|---|---|---|---|',
    ...entries.map((entry) => `| ${entry.trial} | ${entry.scenario} | ${entry.BASE ? 'pass' : 'fail'} | ${entry.WITH ? 'pass' : 'fail'} | [open](./${entry.name}) |`),
    '',
  ].join('\n');
  writeFileSync(join(outRoot, 'case-studies', 'README.md'), index);
}

function writeValidatedReport(outRoot, config, validation) {
  const metric = validation.metrics.task_success;
  const lines = [
    '# CallsmithBench validated publication report',
    '',
    `Run: \`${config.run_id}\``,
    '',
    `Model: \`${config.actor.model}\` · family: \`${config.actor.family}\` · reasoning: \`${config.actor.reasoning}\``,
    '',
    `**Paired task-success lift:** ${metric.lift.toFixed(3)} (WITH ${metric.WITH.toFixed(3)} vs BASE ${metric.BASE.toFixed(3)}, n=${validation.pairs.length})`,
    '',
    `95% interval: ${metric.lift_95ci.low.toFixed(3)} to ${metric.lift_95ci.high.toFixed(3)} (${metric.lift_95ci.method}).`,
    '',
    `Floor lift ${validation.metrics.floor_lift.toFixed(3)} · physics lift ${validation.metrics.physics_lift.toFixed(3)} · BASE floor/physics fail rate ${validation.metrics.base_fail.toFixed(3)}`,
    '',
    'Task success requires all four binary gates; G_REAL is a hard veto.',
    '',
    '[Paired case studies](./case-studies/README.md) · [Reproduce](./REPRODUCE.md) · [Redaction receipt](./REDACTION.md)',
    '',
  ];
  writeFileSync(join(outRoot, 'report.md'), lines.join('\n'));
}

export function validatePublicationConfig(config) {
  const canonical = listScenarioIds().sort();
  const scenarios = Array.isArray(config.scenarios) ? [...config.scenarios].sort() : [];
  if (config.schema_version !== 2 || config.mode !== 'live') throw new Error('Only schema-v2 live runs can be published.');
  if (JSON.stringify(scenarios) !== JSON.stringify(canonical)) throw new Error('Publication requires the canonical core10 scenario set.');
  requireSafeToken(config.run_id, 'run id');
  requireSafeToken(config.actor?.model, 'actor model');
  requireSafeToken(config.actor?.family, 'actor model family');
  if (modelFamilyFor(config.actor.model) !== config.actor.family) {
    throw new Error('Actor model family does not match the reviewed model-ID mapping.');
  }
  if (!/^[a-f0-9]{40}$/.test(config.git?.commit || '') || config.git?.dirty !== false) {
    throw new Error('Publication requires a clean, full Git commit pin.');
  }
  if (!['codex', 'grok'].includes(config.actor?.tool) || !config.actor?.version || !config.actor?.reasoning) {
    throw new Error('Publication requires a pinned Codex or Grok actor, version, and reasoning effort.');
  }
  requireHash(config.actor?.binary_sha256, 'actor binary');
  if (!isPublicationIsolation(config.actor.tool, config.actor.isolation)) {
    throw new Error('Actor isolation receipt is incomplete.');
  }
  if (JSON.stringify([...(config.arms || [])].sort()) !== JSON.stringify(['BASE', 'WITH'])) {
    throw new Error('Publication requires exactly BASE and WITH arms.');
  }
  if (!Number.isInteger(config.runs) || config.runs < 3) throw new Error('Publication requires at least three repetitions.');
  if (!config.seed || !config.budget?.timeout_ms_per_arm) throw new Error('Publication requires seed and budget controls.');
  requireHash(config.source?.provider_packs_sha256, 'provider packs');
  requireHash(config.source?.harness_sha256, 'harness');
  requireHash(config.source?.scorer_sha256, 'scorer');
  requireHash(config.source?.product_sha256, 'Callsmith product');
  if (JSON.stringify(Object.keys(config.source?.scenarios || {}).sort()) !== JSON.stringify(canonical)) {
    throw new Error('Scenario hash receipt does not cover canonical core10.');
  }
  for (const id of canonical) requireHash(config.source.scenarios[id], `scenario ${id}`);

  const expected = config.runs * canonical.length;
  if (!Array.isArray(config.schedule) || config.schedule.length !== expected) {
    throw new Error('Schedule does not cover every repeated core10 pair.');
  }
  const schedule = new Map();
  for (const item of config.schedule) {
    const key = `${item.trial}:${item.scenarioId}`;
    if (schedule.has(key)) throw new Error(`Duplicate schedule entry: ${key}`);
    if (!canonical.includes(item.scenarioId) || !Number.isInteger(item.trial) || item.trial < 1 || item.trial > config.runs) {
      throw new Error(`Invalid schedule entry: ${key}`);
    }
    if (JSON.stringify([...(item.arms || [])].sort()) !== JSON.stringify(['BASE', 'WITH'])) {
      throw new Error(`Schedule entry ${key} does not contain both arms.`);
    }
    schedule.set(key, item.arms);
  }
  for (const scenarioId of canonical) {
    const orders = [];
    for (let trial = 1; trial <= config.runs; trial += 1) {
      const order = schedule.get(`${trial}:${scenarioId}`);
      if (!order) throw new Error(`Schedule is missing ${trial}:${scenarioId}`);
      orders.push(order[0]);
    }
    for (let index = 1; index < orders.length; index += 1) {
      if (orders[index] === orders[index - 1]) throw new Error(`${scenarioId} arm order is not counterbalanced.`);
    }
  }
  return { canonical, schedule, expected };
}

export function isPublicationIsolation(tool, isolation) {
  if (!['codex', 'grok'].includes(tool)) return false;
  return [
    'ephemeral_session', 'ignore_user_config', 'ignore_user_rules', 'auth_only_home',
    'plugins_disabled', 'hooks_disabled', 'memories_disabled',
  ].every((key) => isolation?.[key] === true);
}

function validateSourceRun(sourceRoot, config, summary) {
  const { canonical, schedule, expected } = validatePublicationConfig(config);
  if (summary.run_valid !== true || summary.publishable !== true || summary.invalid_arms?.length) {
    throw new Error('Raw run is not publication-eligible; keep it in diagnostics instead.');
  }

  const pairs = [];
  for (let trial = 1; trial <= config.runs; trial += 1) {
    for (const scenarioId of canonical) {
      const trialName = `trial-${String(trial).padStart(3, '0')}`;
      const pairRoot = join(sourceRoot, trialName, scenarioId);
      const scenario = loadScenario(scenarioId);
      assertInside(sourceRoot, pairRoot);
      assertRegularFile(join(pairRoot, 'pair.json'), sourceRoot);
      const scores = {};
      const inputHashes = { BASE: {}, WITH: {} };
      for (const arm of ['BASE', 'WITH']) {
        const armRoot = join(pairRoot, arm);
        for (const name of ARM_FILES) assertRegularFile(join(armRoot, name), sourceRoot);
        assertRegularFile(join(armRoot, 'actor.events.jsonl'), sourceRoot);
        const status = JSON.parse(readFileSync(join(armRoot, 'actor.status.json'), 'utf8'));
        if (status.status !== 0 || status.valid !== true || status.session_trace?.valid !== true
          || status.session_trace?.file !== 'actor.events.jsonl') {
          throw new Error(`${trialName}/${scenarioId}/${arm}: actor status is not valid.`);
        }
        sanitizeTrace(readFileSync(join(armRoot, 'actor.events.jsonl'), 'utf8'), [sourceRoot]);
        validateReproducibility(armRoot, config, scenarioId, arm, `${trialName}/${scenarioId}/${arm}`);
        validateCanonicalInputs(armRoot, arm, scenario);
        const rawTrace = readFileSync(join(armRoot, 'actor.events.jsonl'), 'utf8');
        const parsedTrace = parseActorTrace(config.actor.tool, rawTrace);
        if (!parsedTrace.valid) throw new Error(`${trialName}/${scenarioId}/${arm}: trace cannot be rescored.`);
        const answers = JSON.parse(readFileSync(join(armRoot, 'voice.answers.json'), 'utf8'));
        const recipe = readFileSync(join(armRoot, 'callsmith.recipe.md'), 'utf8');
        const recomputed = scoreArm({ scenario, answers, recipe, commandLog: parsedTrace.commandLog, arm });
        const score = JSON.parse(readFileSync(join(armRoot, 'score.json'), 'utf8'));
        validateScore(score, scenarioId, arm);
        if (JSON.stringify(score) !== JSON.stringify(recomputed)) {
          throw new Error(`${trialName}/${scenarioId}/${arm}: score receipt disagrees with independent re-score.`);
        }
        scores[arm] = recomputed;
        for (const name of ['brief.md', 'scenario.json', 'OUTPUT_SCHEMA.md', 'input-seed.answers.json']) {
          inputHashes[arm][name] = sha256(readFileSync(join(armRoot, name)));
        }
      }
      if (JSON.stringify(inputHashes.BASE) !== JSON.stringify(inputHashes.WITH)) {
        throw new Error(`${trialName}/${scenarioId}: BASE/WITH input controls differ.`);
      }
      validatePairReceipt(join(pairRoot, 'pair.json'), trial, scenarioId, scores);
      pairs.push({
        trial,
        scenarioId,
        armOrder: schedule.get(`${trial}:${scenarioId}`),
        WITH: scores.WITH,
        BASE: scores.BASE,
      });
    }
  }
  if (summary.n_valid_pairs !== expected || pairs.length !== expected) throw new Error('Valid pair count does not match schedule.');
  const regulatedScenarioIds = canonical.filter((id) => ['medical', 'banking', 'collections']
    .includes(loadScenario(id).manifest.domain));
  const metrics = summarizeValidPairs(pairs, { runs: config.runs, regulatedScenarioIds });
  for (const [label, claimed, derived] of [
    ['task-success WITH', summary.metrics?.task_success?.WITH, metrics.task_success.WITH],
    ['task-success BASE', summary.metrics?.task_success?.BASE, metrics.task_success.BASE],
    ['task-success lift', summary.metrics?.task_success?.lift, metrics.task_success.lift],
    ['floor lift', summary.metrics?.floor_lift, metrics.floor_lift],
    ['physics lift', summary.metrics?.physics_lift, metrics.physics_lift],
    ['BASE fail', summary.metrics?.base_fail, metrics.base_fail],
  ]) {
    if (!sameNumber(claimed, derived)) throw new Error(`Claimed ${label} disagrees with score receipts.`);
  }
  return { pairs, metrics };
}

function publicTraceEvent(event, roots) {
  const clean = { type: sanitizeString(event?.type || 'unknown', roots) };
  for (const key of ['status', 'exit_code', 'duration_ms', 'timestamp']) {
    if (['string', 'number', 'boolean'].includes(typeof event?.[key])) {
      clean[key] = typeof event[key] === 'string' ? sanitizeString(event[key], roots) : event[key];
    }
  }
  if (event?.thread_id) clean.thread_id = '[REDACTED_TRACE_ID]';
  if (event?.session_id) clean.session_id = '[REDACTED_TRACE_ID]';
  if (event?.item && typeof event.item === 'object') {
    clean.item = {};
    for (const key of ['type', 'status', 'exit_code']) {
      if (['string', 'number', 'boolean'].includes(typeof event.item[key])) {
        clean.item[key] = typeof event.item[key] === 'string'
          ? sanitizeString(event.item[key], roots)
          : event.item[key];
      }
    }
  }
  if (event?.usage && typeof event.usage === 'object') clean.usage = numericTree(event.usage);
  return clean;
}

function numericTree(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value)
    .map(([key, child]) => [key, numericTree(child)])
    .filter(([, child]) => child !== undefined));
}

export function validateReproducibility(armRoot, config, scenarioId, arm, label = `${scenarioId}/${arm}`) {
  const repro = JSON.parse(readFileSync(join(armRoot, 'reproducibility.json'), 'utf8'));
  const expected = {
    scenario_sha256: config.source.scenarios[scenarioId],
    provider_packs_sha256: config.source.provider_packs_sha256,
    harness_sha256: config.source.harness_sha256,
    scorer_sha256: config.source.scorer_sha256,
    product_sha256: config.source.product_sha256,
    model: config.actor.model,
    model_family: config.actor.family,
    actor_tool: config.actor.tool,
    actor_reasoning: config.actor.reasoning,
    tool_version: config.actor.version,
    actor_binary_sha256: config.actor.binary_sha256,
    git_commit: config.git.commit,
    seed: config.seed,
    arm,
    budget: config.budget,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(repro[key]) !== JSON.stringify(value)) {
      throw new Error(`${label}: reproducibility ${key} mismatch.`);
    }
  }
  requireHash(repro.prompt_sha256, `${label} prompt`);
  if (sha256(readFileSync(join(armRoot, 'actor-prompt.md'))) !== repro.prompt_sha256) {
    throw new Error(`${label}: prompt hash does not match actor-prompt.md.`);
  }
  return repro;
}

export function validateCanonicalInputs(armRoot, arm, scenario) {
  const expected = {
    'brief.md': scenario.brief + (scenario.brief.endsWith('\n') ? '' : '\n'),
    'scenario.json': `${JSON.stringify({ id: scenario.id, brief: scenario.brief }, null, 2)}\n`,
    'OUTPUT_SCHEMA.md': outputSchemaText(),
    'input-seed.answers.json': `${JSON.stringify(scenario.poison || {}, null, 2)}\n`,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (readFileSync(join(armRoot, name), 'utf8') !== value) {
      throw new Error(`${scenario.id}/${arm}: ${name} does not match the frozen canonical input.`);
    }
  }
  const prompt = normalizePromptWorkspace(readFileSync(join(armRoot, 'actor-prompt.md'), 'utf8'));
  const canonicalPrompt = normalizePromptWorkspace(buildActorPrompt(arm, scenario, '$WORKSPACE'));
  if (prompt !== canonicalPrompt) throw new Error(`${scenario.id}/${arm}: actor prompt differs from the frozen harness prompt.`);
}

function normalizePromptWorkspace(value) {
  return String(value).split('\n').map((line) => (
    /^-?\s*Work only inside /.test(line) ? 'Work only inside $WORKSPACE.' : line
  )).join('\n');
}

export function validatePairReceipt(file, trial, scenarioId, scores) {
  const receipt = JSON.parse(readFileSync(file, 'utf8'));
  const expected = pairDelta(scores.WITH, scores.BASE);
  expected.task_success = {
    WITH: taskSuccess(scores.WITH),
    BASE: taskSuccess(scores.BASE),
  };
  for (const key of ['schema_version', 'scenario_id', 'with_score', 'base_score', 'delta', 'task_success', 'gates']) {
    if (JSON.stringify(receipt[key]) !== JSON.stringify(expected[key])) {
      throw new Error(`${trial}/${scenarioId}: pair receipt ${key} disagrees with re-scored arms.`);
    }
  }
  if (receipt.trial !== trial || receipt.valid !== true) {
    throw new Error(`${trial}/${scenarioId}: pair receipt lacks valid trial identity.`);
  }
}

export function validateScore(score, scenarioId, arm) {
  if (score?.schema_version !== 1 || score?.maxGates !== 4) throw new Error(`${scenarioId}/${arm}: unsupported score schema.`);
  if (score?.scenario_id !== scenarioId || score?.arm !== arm) throw new Error(`${scenarioId}/${arm}: score identity mismatch.`);
  if (JSON.stringify(Object.keys(score.gates || {}).sort()) !== JSON.stringify([...GATES].sort())) {
    throw new Error(`${scenarioId}/${arm}: score must contain exactly four gates.`);
  }
  if (!GATES.every((gate) => typeof score.gates[gate] === 'boolean')) {
    throw new Error(`${scenarioId}/${arm}: score gates must be boolean.`);
  }
  const gateScore = GATES.filter((gate) => score.gates[gate]).length;
  if (typeof score.task_success !== 'boolean' || score.gateScore !== gateScore
    || score.task_success !== taskSuccess(score)) {
    throw new Error(`${scenarioId}/${arm}: score totals disagree with gates.`);
  }
}

function requireSafeToken(value, label) {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value) || value.includes('..')) {
    throw new Error(`Invalid ${label}.`);
  }
}

function requireHash(value, label) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(`Invalid ${label} SHA-256.`);
}

function sameNumber(left, right) {
  return Number.isFinite(Number(left)) && Number.isFinite(Number(right))
    && Math.abs(Number(left) - Number(right)) < 0.00001;
}

function readOptionalJson(file, roots) {
  if (!existsSync(file)) return null;
  return sanitizeJsonValue(JSON.parse(readFileSync(file, 'utf8')), roots);
}

function formatMs(value) {
  return Number.isFinite(Number(value)) ? `${(Number(value) / 1000).toFixed(1)} s` : 'not recorded';
}

function writeReproduction(outRoot, config) {
  const args = [
    '--actor-tool', config.actor?.tool,
    '--actor-model', config.actor?.model,
    ...(config.actor?.reasoning ? ['--actor-reasoning', config.actor.reasoning] : []),
    '--runs', config.runs,
    '--seed', config.seed,
    '--timeout-ms', config.budget?.timeout_ms_per_arm,
  ].filter((value) => value !== null && value !== undefined);
  if (config.scenarios?.length === 1) args.push('--scenario', config.scenarios[0]);
  args.push('--out', `evals/csb/runs/${config.run_id}-reproduction`);
  const body = [
    '# Reproduce this run',
    '',
    `Source commit: \`${config.git?.commit || 'unknown'}\``,
    '',
    'Use the recorded Codex/Grok/OpenCode subscription or provider account. Model services are nondeterministic;',
    'the command reproduces the controlled design, not byte-identical model output.',
    '',
    '```bash',
    `git checkout ${config.git?.commit || '<commit>'}`,
    `npm run bench:csb -- ${args.map(shellWord).join(' ')}`,
    '```',
    '',
    'Compare the new `config.json` hashes before comparing scores.',
    '',
  ].join('\n');
  writeFileSync(join(outRoot, 'REPRODUCE.md'), body);
}

function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function writeSanitized(source, target, roots, sourceRoot) {
  assertRegularFile(source, sourceRoot);
  ensureParent(target);
  const raw = readFileSync(source, 'utf8');
  if (source.endsWith('.json')) {
    const parsed = sanitizeJsonValue(JSON.parse(raw), roots);
    if (basename(source) === 'actor.status.json' && parsed.session_trace) {
      parsed.session_trace.sanitized = true;
      parsed.session_trace.command_log = '[REDACTED_COMMAND]';
      parsed.session_trace.file = 'actor.events.sanitized.jsonl';
    }
    writeFileSync(target, `${JSON.stringify(parsed, null, 2)}\n`);
  } else {
    writeFileSync(target, sanitizeString(raw, roots));
  }
}

export function writeManifest(root) {
  const files = walk(root)
    .filter((file) => basename(file) !== 'MANIFEST.sha256')
    .sort();
  const rows = files.map((file) => `${sha256(readFileSync(file))}  ${relative(root, file)}`);
  writeFileSync(join(root, 'MANIFEST.sha256'), `${rows.join('\n')}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ensureParent(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Evidence tree contains symlink: ${path}`);
    if (stat.isDirectory()) return walk(path);
    if (stat.isFile()) return [path];
    throw new Error(`Evidence tree contains a non-regular artifact: ${path}`);
  });
}

function assertDirectory(dir, label) {
  if (!existsSync(dir)) throw new Error(`${label} is not a directory: ${dir}`);
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`${label} must be a real directory: ${dir}`);
}

function assertInside(root, file) {
  const resolvedRoot = resolve(root);
  const resolvedFile = resolve(file);
  if (!resolvedFile.startsWith(`${resolvedRoot}${sep}`)) throw new Error(`Path escapes evidence root: ${file}`);
}

function assertRegularFile(file, root) {
  assertInside(root, file);
  if (!existsSync(file)) throw new Error(`Required evidence receipt is missing: ${relative(root, file)}`);
  assertNoSymlinkedParents(root, file);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Evidence receipt must be a regular file: ${relative(root, file)}`);
  const realRoot = realpathSync(root);
  const realFile = realpathSync(file);
  if (!realFile.startsWith(`${realRoot}${sep}`)) throw new Error(`Evidence receipt escapes its real root: ${relative(root, file)}`);
}

function assertNoSymlinkedParents(root, file) {
  const parts = relative(root, file).split(sep).slice(0, -1);
  let current = resolve(root);
  for (const part of parts) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Evidence receipt has a symlinked parent: ${relative(root, current)}`);
    }
  }
}

export function assertNoSecrets(root) {
  const leaks = [
    /\/(?:Users|home)\/[^/\s"']+/,
    /\bBearer\s+(?!\[REDACTED\])\S+/i,
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bAIza[A-Za-z0-9_-]{20,}\b/,
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  ];
  for (const file of walk(root)) {
    const text = readFileSync(file, 'utf8');
    if (leaks.some((pattern) => pattern.test(text))) {
      throw new Error(`Sanitization failed closed for ${relative(root, file)}.`);
    }
  }
}

function parseArgs(items) {
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    if (!items[index].startsWith('--')) continue;
    const key = items[index].slice(2);
    result[key] = items[index + 1] && !items[index + 1].startsWith('--')
      ? items[++index]
      : true;
  }
  return result;
}

if (resolve(process.argv[1] || '') === HERE) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.source || !args.out) throw new Error('Usage: build-evidence.mjs --source <raw-run> --out <evidence-dir>');
    const result = buildEvidenceBundle({ source: args.source, out: args.out });
    console.log(`Wrote sanitized evidence: ${result.out} (${result.files.length} files)`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
