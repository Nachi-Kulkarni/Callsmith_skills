#!/usr/bin/env node
/** Review two or more sanitized CSB bundles before any README product claim. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario, scoreArm } from '../harness/score.mjs';
import { meanConfidenceInterval, summarizeValidPairs, taskSuccess } from '../harness/validity.mjs';
import {
  isPublicationIsolation,
  validateCanonicalInputs,
  validatePairReceipt,
  validatePublicationConfig,
  validateReproducibility,
  validateScore,
  verifyCheckoutProvenance,
} from './build-evidence.mjs';

const HERE = fileURLToPath(import.meta.url);
const ROOT_ARTIFACTS = [
  'config.json', 'summary.json', 'REDACTION.md', 'REPRODUCE.md', 'report.md',
  'case-studies/README.md', 'MANIFEST.sha256',
];
const ARM_ARTIFACTS = [
  'actor.status.json', 'reproducibility.json', 'score.json', 'voice.answers.json',
  'callsmith.recipe.md', 'actor.events.sanitized.jsonl', 'input-seed.answers.json',
  'brief.md', 'scenario.json', 'OUTPUT_SCHEMA.md', 'actor-prompt.md', 'command-policy.json',
];

export function reviewPublication(bundleDirs, { provenanceVerifier = verifyCheckoutProvenance } = {}) {
  if (!Array.isArray(bundleDirs) || bundleDirs.length < 2) {
    throw new Error('Product publication requires at least two sanitized model bundles.');
  }
  const bundles = bundleDirs.map((dir) => loadBundle(dir, provenanceVerifier));
  const models = new Set(bundles.map((bundle) => bundle.config.actor.model));
  const families = new Set(bundles.map((bundle) => bundle.config.actor.family));
  const failures = [];
  if (models.size < 2) failures.push('at least two distinct pinned model IDs are required');
  if (families.size < 2) failures.push('at least two distinct named model families are required');

  const scenarioSets = new Set(bundles.map((bundle) => JSON.stringify([...bundle.config.scenarios].sort())));
  if (scenarioSets.size !== 1) failures.push('all model bundles must use the identical scenario set');
  const frozen = bundles[0].config;
  for (const bundle of bundles.slice(1)) {
    const current = bundle.config;
    for (const [label, left, right] of [
      ['Git commit', current.git.commit, frozen.git.commit],
      ['seed', current.seed, frozen.seed],
      ['run count', current.runs, frozen.runs],
      ['arms', current.arms, frozen.arms],
      ['budget', current.budget, frozen.budget],
      ['source hashes', current.source, frozen.source],
      ['schedule', current.schedule, frozen.schedule],
      ['actor tool', current.actor.tool, frozen.actor.tool],
      ['actor version', current.actor.version, frozen.actor.version],
      ['actor binary', current.actor.binary_sha256, frozen.actor.binary_sha256],
      ['reasoning effort', current.actor.reasoning, frozen.actor.reasoning],
      ['isolation policy', current.actor.isolation, frozen.actor.isolation],
    ]) {
      if (JSON.stringify(left) !== JSON.stringify(right)) failures.push(`${current.actor.model}: ${label} differs from the frozen comparison`);
    }
  }

  for (const bundle of bundles) {
    const label = bundle.config.actor?.model || bundle.config.run_id;
    const metrics = bundle.derived;
    const claimed = bundle.summary.metrics || {};
    if (bundle.summary.publishable !== true) failures.push(`${label}: run is not publication-eligible`);
    if (bundle.summary.run_valid !== true) failures.push(`${label}: source run is not valid`);
    if (bundle.summary.evidence_publication?.sanitized !== true) failures.push(`${label}: bundle is not marked sanitized`);
    if (bundle.summary.evidence_publication?.source_checkout_verified !== true
      || bundle.summary.evidence_publication?.scores_recomputed !== true) {
      failures.push(`${label}: publication verification receipts are missing`);
    }
    if (bundle.config.git?.dirty !== false) failures.push(`${label}: source worktree was not clean`);
    if (!['codex', 'grok'].includes(bundle.config.actor?.tool) || !isPublicationIsolation(bundle.config.actor.tool, bundle.config.actor.isolation)) {
      failures.push(`${label}: actor lacks the publication isolation boundary`);
    }
    // core10 suite or a superset that includes it (suite grew past 10 with deploy-managed-cloud-pilot).
    if (bundle.config.runs < 3 || (bundle.config.scenarios?.length ?? 0) < 10) failures.push(`${label}: repeated core10 is incomplete`);
    if (bundle.summary.invalid_arms?.length) failures.push(`${label}: invalid arms are present`);
    if (!(metrics.task_success?.lift > 0)) failures.push(`${label}: task-success lift is not positive`);
    if (!(metrics.floor_lift >= 0.5)) failures.push(`${label}: floor lift is below +0.5`);
    if (!(metrics.physics_lift >= 0.4)) failures.push(`${label}: physics lift is below +0.4`);
    if (!(metrics.base_fail >= 0.6)) failures.push(`${label}: BASE floor/physics failure rate is below 0.6`);
    const expected = bundle.config.runs * bundle.config.scenarios.length;
    if (bundle.pairs.length !== expected) failures.push(`${label}: score receipt count does not match schedule`);
    if (bundle.summary.n_valid_pairs !== expected) failures.push(`${label}: claimed valid pair count does not match schedule`);
    if (JSON.stringify(claimed) !== JSON.stringify(metrics)) failures.push(`${label}: published metrics disagree with score receipts`);
  }

  const pairs = bundles.flatMap((bundle) => bundle.pairs.map((pair) => ({
      model: bundle.config.actor.model,
      scenario: pair.scenarioId,
      trial: pair.trial,
      WITH: Number(taskSuccess(pair.WITH)),
      BASE: Number(taskSuccess(pair.BASE)),
    })));
  const lifts = pairs.map((pair) => pair.WITH - pair.BASE);
  const WITH = mean(pairs.map((pair) => pair.WITH));
  const BASE = mean(pairs.map((pair) => pair.BASE));
  const lift = mean(lifts);

  return {
    schema_version: 1,
    product_claim_eligible: failures.length === 0,
    failures,
    model_ids: [...models],
    model_families: [...families],
    bundles: bundles.map((bundle) => ({
      run_id: bundle.config.run_id,
      model: bundle.config.actor.model,
      reasoning: bundle.config.actor.reasoning,
      family: bundle.config.actor.family,
      commit: bundle.config.git?.commit,
      n_valid_pairs: bundle.summary.n_valid_pairs,
      metrics: bundle.derived,
    })),
    combined: {
      n_valid_pairs: pairs.length,
      WITH,
      BASE,
      lift,
      lift_95ci: meanConfidenceInterval(lifts),
    },
  };
}

export function writePublicationReview(bundleDirs, outDir, options = {}) {
  const root = resolve(outDir);
  if (existsSync(root)) throw new Error(`Refusing existing publication review directory: ${root}`);
  const review = reviewPublication(bundleDirs, options);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'product-claim.json'), `${JSON.stringify(review, null, 2)}\n`);
  const lines = [
    '# CallsmithBench product-claim review',
    '',
    `**Eligible:** ${review.product_claim_eligible ? 'yes' : 'no'}`,
    '',
    `Combined paired task-success lift: **${format(review.combined.lift)}** `
      + `(WITH ${format(review.combined.WITH)} vs BASE ${format(review.combined.BASE)}, n=${review.combined.n_valid_pairs})`,
    '',
    `95% interval: ${format(review.combined.lift_95ci?.low)} to ${format(review.combined.lift_95ci?.high)}.`,
    '',
    '| Model | Valid pairs | Lift | Floor lift | Physics lift | BASE fail |',
    '|---|---:|---:|---:|---:|---:|',
    ...review.bundles.map((bundle) => `| ${bundle.model} | ${bundle.n_valid_pairs} | ${format(bundle.metrics.task_success?.lift)} | ${format(bundle.metrics.floor_lift)} | ${format(bundle.metrics.physics_lift)} | ${format(bundle.metrics.base_fail)} |`),
    '',
  ];
  if (review.failures.length) {
    lines.push('## Publication blockers', '', ...review.failures.map((failure) => `- ${failure}`), '');
  }
  writeFileSync(join(root, 'RESULTS.md'), `${lines.join('\n')}\n`);
  if (review.product_claim_eligible) {
    const snippet = [
      '## Measured evidence',
      '',
      `**CSB task-success lift ${signed(review.combined.lift)} · WITH ${percent(review.combined.WITH)} · BASE ${percent(review.combined.BASE)} · n=${review.combined.n_valid_pairs} paired trials**`,
      '',
      `95% paired-bootstrap interval: ${signed(review.combined.lift_95ci?.low)} to ${signed(review.combined.lift_95ci?.high)}. `
        + `Measured on core10 with three repetitions across ${review.model_ids.map((model) => `\`${model}\``).join(' and ')}.`,
      '',
      'Task success requires every floor, physics, contract, and reality gate; `G_REAL` is a hard veto.',
      '',
      '<!-- Copy this reviewed block into the repository root README, then keep its existing evidence links immediately below. -->',
    ].join('\n');
    writeFileSync(join(root, 'README-SNIPPET.md'), snippet);
  }
  return review;
}

function loadBundle(dir, provenanceVerifier) {
  const root = resolve(dir);
  verifyManifest(root);
  const expectedFiles = new Set(ROOT_ARTIFACTS);
  const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
  const summary = JSON.parse(readFileSync(join(root, 'summary.json'), 'utf8'));
  validatePublicationConfig(config);
  provenanceVerifier(config);
  for (const file of ['REDACTION.md', 'REPRODUCE.md', 'report.md', 'case-studies/README.md']) {
    requireRegularFile(join(root, file), root);
  }
  const pairs = [];
  for (let trial = 1; trial <= config.runs; trial += 1) {
    for (const scenarioId of config.scenarios) {
      const pairRoot = join(root, `trial-${String(trial).padStart(3, '0')}`, scenarioId);
      assertInside(root, pairRoot);
      requireRegularFile(join(pairRoot, 'pair.json'), root);
      expectedFiles.add(relative(root, join(pairRoot, 'pair.json')));
      const scores = {};
      const scenario = loadScenario(scenarioId);
      for (const arm of ['BASE', 'WITH']) {
        const armRoot = join(pairRoot, arm);
        for (const file of ARM_ARTIFACTS) {
          requireRegularFile(join(armRoot, file), root);
          expectedFiles.add(relative(root, join(armRoot, file)));
        }
        const status = JSON.parse(readFileSync(join(armRoot, 'actor.status.json'), 'utf8'));
        if (status.status !== 0 || status.valid !== true || status.session_trace?.valid !== true
          || status.session_trace?.sanitized !== true
          || status.session_trace?.file !== 'actor.events.sanitized.jsonl') {
          throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: invalid actor receipt`);
        }
        const traceText = readFileSync(join(armRoot, 'actor.events.sanitized.jsonl'), 'utf8');
        if (/"(?:command|command_log|output|aggregated_output)"\s*:/.test(traceText)) {
          throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: trace exposes command text or output`);
        }
        if (/"(?:thread_id|session_id)"\s*:\s*"(?!\[REDACTED_TRACE_ID\])/.test(traceText)) {
          throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: trace identifier is not redacted`);
        }
        const traceLines = traceText.trim().split('\n');
        if (!traceLines.length) throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: empty trace`);
        for (const line of traceLines) JSON.parse(line);
        validateReproducibility(
          armRoot,
          config,
          scenarioId,
          arm,
          `${config.run_id}/${trial}/${scenarioId}/${arm}`,
        );
        validateCanonicalInputs(armRoot, arm, scenario);
        const commandPolicy = JSON.parse(readFileSync(join(armRoot, 'command-policy.json'), 'utf8'));
        if (commandPolicy.schema_version !== 1 || typeof commandPolicy.deleted_generator_used !== 'boolean') {
          throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: invalid command-policy receipt`);
        }
        const recomputed = scoreArm({
          scenario,
          answers: JSON.parse(readFileSync(join(armRoot, 'voice.answers.json'), 'utf8')),
          recipe: readFileSync(join(armRoot, 'callsmith.recipe.md'), 'utf8'),
          commandLog: commandPolicy.deleted_generator_used ? 'callsmith init' : '',
          arm,
        });
        const score = JSON.parse(readFileSync(join(armRoot, 'score.json'), 'utf8'));
        validateScore(score, scenarioId, arm);
        for (const key of ['gates', 'gateScore', 'maxGates', 'task_success']) {
          if (JSON.stringify(score[key]) !== JSON.stringify(recomputed[key])) {
            throw new Error(`${config.run_id}/${trial}/${scenarioId}/${arm}: score disagrees with published artifacts`);
          }
        }
        scores[arm] = recomputed;
      }
      const caseStudy = join(root, 'case-studies', `trial-${String(trial).padStart(3, '0')}-${scenarioId}.md`);
      requireRegularFile(caseStudy, root);
      expectedFiles.add(relative(root, caseStudy));
      validatePairReceipt(join(pairRoot, 'pair.json'), trial, scenarioId, scores);
      pairs.push({ trial, scenarioId, WITH: scores.WITH, BASE: scores.BASE });
    }
  }
  const actualFiles = walk(root).map((file) => relative(root, file)).sort();
  const allowedFiles = [...expectedFiles].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(allowedFiles)) {
    throw new Error(`${config.run_id}: publication bundle contains missing or unrecognized artifacts`);
  }
  assertNoObviousSecrets(root);
  const regulatedScenarioIds = config.scenarios.filter((id) => ['medical', 'banking', 'collections']
    .includes(loadScenario(id).manifest.domain));
  return {
    root,
    config,
    summary,
    pairs,
    derived: summarizeValidPairs(pairs, { runs: config.runs, regulatedScenarioIds }),
  };
}

function verifyManifest(root) {
  assertDirectory(root);
  const manifestPath = join(root, 'MANIFEST.sha256');
  requireRegularFile(manifestPath, root);
  const rows = readFileSync(manifestPath, 'utf8').trim().split('\n').filter(Boolean);
  const covered = new Set();
  for (const row of rows) {
    const match = row.match(/^([a-f0-9]{64})  (.+)$/);
    if (!match) throw new Error(`${root}: invalid manifest row`);
    const [, expected, rel] = match;
    const file = resolve(root, rel);
    assertInside(root, file);
    requireRegularFile(file, root);
    if (covered.has(rel)) throw new Error(`${root}: duplicate manifest entry ${rel}`);
    const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (actual !== expected) throw new Error(`${root}: manifest mismatch for ${rel}`);
    covered.add(rel);
  }
  const actualFiles = walk(root)
    .map((file) => relative(root, file))
    .filter((file) => file !== 'MANIFEST.sha256');
  for (const file of actualFiles) {
    if (!covered.has(file)) throw new Error(`${root}: unmanifested file ${file}`);
  }
  if (covered.size !== actualFiles.length) throw new Error(`${root}: manifest contains missing or duplicate files`);
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symlink in publication bundle: ${file}`);
    if (stat.isDirectory()) return walk(file);
    if (stat.isFile()) return [file];
    throw new Error(`Refusing non-regular publication artifact: ${file}`);
  });
}

function assertDirectory(dir) {
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Expected a real publication directory: ${dir}`);
  }
}

function assertInside(root, file) {
  if (file !== root && !file.startsWith(`${root}${sep}`)) {
    throw new Error(`${root}: path escapes publication bundle: ${file}`);
  }
}

function requireRegularFile(file, root) {
  const resolved = resolve(file);
  assertInside(root, resolved);
  assertNoSymlinkedParents(root, resolved);
  const stat = lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Expected a regular publication artifact: ${resolved}`);
  }
  const realRoot = realpathSync(root);
  const realFile = realpathSync(resolved);
  if (!realFile.startsWith(`${realRoot}${sep}`)) {
    throw new Error(`Publication artifact escapes its real root: ${resolved}`);
  }
}

function assertNoSymlinkedParents(root, file) {
  const parts = relative(root, file).split(sep).slice(0, -1);
  let current = resolve(root);
  for (const part of parts) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`Publication artifact has a symlinked parent: ${current}`);
    }
  }
}

function assertNoObviousSecrets(root) {
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
    const value = readFileSync(file, 'utf8');
    if (leaks.some((pattern) => pattern.test(value))) {
      throw new Error(`${root}: publication bundle contains an obvious secret or private identifier`);
    }
  }
}

function mean(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10_000) / 10_000;
}

function format(value) {
  return value === null || value === undefined ? '—' : Number(value).toFixed(3);
}

function signed(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value) >= 0 ? '+' : ''}${Number(value).toFixed(3)}`;
}

function percent(value) {
  return value === null || value === undefined ? '—' : `${Math.round(Number(value) * 100)}%`;
}

function parseArgs(items) {
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    if (!items[index].startsWith('--')) continue;
    const key = items[index].slice(2);
    result[key] = items[index + 1] && !items[index + 1].startsWith('--') ? items[++index] : true;
  }
  return result;
}

if (resolve(process.argv[1] || '') === HERE) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const bundles = String(args.bundles || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (!bundles.length || !args.out) {
      throw new Error('Usage: review-publication.mjs --bundles <bundle-a,bundle-b> --out <review-dir>');
    }
    const review = writePublicationReview(bundles, args.out);
    console.log(review.product_claim_eligible ? 'Publication review: ELIGIBLE' : 'Publication review: BLOCKED');
    if (!review.product_claim_eligible) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
