#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeTrace } from '../csb/latency/score.mjs';
import { PROFILE_METRICS, INSTRUMENTATION_PROFILES, ARCH_PROFILE_COMPAT } from '../csb/latency/metrics.mjs';
import { assertNoSecrets, sanitizeJsonValue, writeManifest } from '../csb/scripts/build-evidence.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (message) => { throw new Error(message); };
const sha256File = (file) => hash(fs.readFileSync(file));

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--live') out.live = true;
    else if (key === '--publish') out.publish = true;
    else if (key === '--approve-spend-usd') out.approveSpendUsd = Number(argv[++i]);
    else if (['--config', '--trace', '--source', '--out'].includes(key)) out[key.slice(2)] = argv[++i];
    else if (key === '--help') out.help = true;
    else fail(`unknown argument: ${key}`);
  }
  return out;
}

// Verify the corpus and return the manifest so the runner can build the
// measurement schedule (the set of utterance IDs a run must cover). A corpus
// hash alone proves the files are intact; it does NOT prove which were played.
function verifyCorpus(file) {
  const manifest = read(file);
  if (!Array.isArray(manifest.utterances) || manifest.utterances.length < 20) fail('corpus needs at least 20 utterances');
  const base = path.dirname(file);
  for (const item of manifest.utterances) {
    const audio = path.resolve(base, item.file);
    if (!item.license || !fs.existsSync(audio) || sha256File(audio) !== item.sha256) fail(`corpus receipt failed: ${item.id}`);
  }
  return { sha256: sha256File(file), manifest };
}

// Fail closed if the config advertises a metric the run's profile cannot observe.
// Must run BEFORE the adapter is spawned (no provider spend until validated).
function preflightMetrics(config, profile) {
  if (!INSTRUMENTATION_PROFILES.includes(profile)) fail(`unknown instrumentation_profile: ${profile}`);
  const allowed = PROFILE_METRICS[profile];
  const assert = (label, traceMetric) => {
    if (!allowed.includes(traceMetric)) {
      fail(`${label} advertises trace_metric "${traceMetric}" which is not observable under profile "${profile}" (allowed: ${allowed.join(', ')})`);
    }
  };
  for (const name of config.stack_metrics || []) {
    if (typeof name === 'string') assert(`stack_metrics "${name}"`, name);
  }
  for (const [pack, spec] of Object.entries(config.pack_metrics || {})) {
    assert(`pack_metrics.${pack}`, spec.trace_metric);
  }
}

// A v2 trace declares its own profile; require it to match what the config pinned.
function assertTraceProfile(trace, configProfile) {
  if (trace.schema_version === 2) {
    const traceProfile = trace.environment?.instrumentation_profile;
    if (traceProfile !== configProfile) {
      fail(`trace instrumentation_profile "${traceProfile}" does not match config "${configProfile}"`);
    }
    const arch = trace.environment?.architecture;
    if (arch && ARCH_PROFILE_COMPAT[arch] && !ARCH_PROFILE_COMPAT[arch].includes(traceProfile)) {
      fail(`trace architecture "${arch}" is not compatible with profile "${traceProfile}"`);
    }
  }
}

// Live provenance pins. Every field is required and cross-checked; a run missing
// any is rejected. Built at run time by the adapter, never typed into a tracked
// config template. The adapter hash is computed by the runner.
const PROVENANCE_FIELDS = [
  'target_commit', 'runtime_version', 'sdk_versions', 'model_ids',
  'machine_class', 'region', 'audio_format', 'network_profile',
];
// ponytail: structural + cross-check validation is O(fields); no schema lib needed.
// target_commit must be an immutable 40-hex git SHA. A branch or tag can move.
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

function validatePinnedMap(value, field, description) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    fail(`provenance.${field} must be a non-empty object (${description})`);
  }
  for (const [key, item] of Object.entries(value)) {
    if (!nonEmptyString(key) || !nonEmptyString(item)) {
      fail(`provenance.${field} keys and values must be non-empty strings`);
    }
  }
}

// Structural provenance check (pre-trace): non-empty strings, sdk/model maps with
// at least one pinned entry, and an immutable target commit. Presence-only is not enough.
function validateProvenanceStructure(provenance) {
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) fail('provenance.json is required for a live run');
  for (const field of PROVENANCE_FIELDS.filter((name) => !['sdk_versions', 'model_ids'].includes(name))) {
    if (!nonEmptyString(provenance[field])) fail(`provenance.${field} must be a non-empty string`);
  }
  if (!COMMIT_RE.test(provenance.target_commit)) fail(`provenance.target_commit must be an immutable 40-hex git SHA, got "${provenance.target_commit}"`);
  validatePinnedMap(provenance.sdk_versions, 'sdk_versions', 'provider SDK -> pinned version');
  validatePinnedMap(provenance.model_ids, 'model_ids', 'role -> pinned model id');
}

// Cross-check provenance against the config and trace environment. The adapter
// must observe the same region, audio format, and network profile the run pinned;
// a mismatch means provenance describes a different stack than what was measured.
function validateProvenanceConsistency(provenance, config, trace) {
  const env = trace.environment || {};
  const checks = [
    ['region', provenance.region, config.region],
    ['audio_format', provenance.audio_format, env.audio_format],
    ['network_profile', provenance.network_profile, env.network_profile],
  ];
  for (const [field, provValue, expected] of checks) {
    if (provValue !== expected) {
      fail(`provenance.${field} "${provValue}" does not match the measured ${field === 'region' ? 'config' : 'trace'} value "${expected}"`);
    }
  }
}

// Resolve the declared measurement schedule: the exact set of utterance IDs a run
// must cover, expanded by repeats. A `probe` is a one-ID schedule; a `cohort` is
// the explicit ID list (no "play everything" default — coverage must be provable).
// ponytail: O(ids×repeats); the manifest is always small (<100 utterances).
function resolveSchedule(config, corpus) {
  const known = new Set(corpus.manifest.utterances.map((u) => u.id));
  const ids = config.schedule?.utterance_ids;
  if (!Array.isArray(ids) || ids.length === 0) fail('config.schedule.utterance_ids is required: declare the exact utterance IDs this run must cover (probe = one id; cohort = full list)');
  for (const id of ids) {
    if (!known.has(id)) fail(`config.schedule.utterance_ids contains unknown utterance "${id}" (not in corpus)`);
  }
  const repeats = config.schedule?.repeats ?? 1;
  if (!Number.isInteger(repeats) || repeats < 1) fail('config.schedule.repeats must be a positive integer');
  if (new Set(ids).size !== ids.length) fail('config.schedule.utterance_ids must not contain duplicates; use schedule.repeats');
  // Multiset: each declared id must appear `repeats` times across turns.
  const expected = {};
  for (const id of ids) expected[id] = (expected[id] || 0) + repeats;
  return { expected, count: ids.length * repeats };
}

// Every trace turn must carry the utterance_id it measured, and the observed
// multiset must equal the declared schedule exactly (no dropped, no extras).
function assertCoverage(schedule, trace) {
  const observed = {};
  trace.turns.forEach((turn, i) => {
    const uid = turn.utterance_id;
    if (typeof uid !== 'string' || uid.length === 0) fail(`turns[${i}].utterance_id is required to prove corpus coverage`);
    observed[uid] = (observed[uid] || 0) + 1;
  });
  const allIds = new Set([...Object.keys(schedule.expected), ...Object.keys(observed)]);
  for (const id of allIds) {
    if (schedule.expected[id] !== observed[id]) {
      fail(`corpus coverage mismatch for "${id}": declared ${schedule.expected[id] ?? 0} turn(s), observed ${observed[id] ?? 0}`);
    }
  }
}

function buildMeasurementReceipt({ config, configSha256, corpusSha256, trace, schedule, provenance, spend, adapterSha256 }) {
  const profile = config.instrumentation_profile || 'cascaded_full';
  const summary = summarizeTrace(trace);
  const vetoed = Object.values(summary.quality).some(Boolean);
  const stackEvidence = (config.stack_metrics || [])
    .filter((name) => summary.metrics[name])
    .filter(() => !vetoed)
    .map((name) => ({
      metric: name,
      source: 'callsmith_measurement',
      region: config.region,
      profile,
      sample_size: summary.samples,
      percentiles_ms: { p50: summary.metrics[name].p50, p95: summary.metrics[name].p95, p99: summary.metrics[name].p99 },
      n_applicable: summary.metrics[name].n_applicable,
      n_observed: summary.metrics[name].n_observed,
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; profile ${profile}; nearest-rank percentiles; raw trace retained.`,
    }));

  const packEvidence = Object.fromEntries(Object.entries(config.pack_metrics || {}).map(([pack, spec]) => {
    const metric = summary.metrics[spec.trace_metric];
    if (!metric) fail(`unknown trace metric for ${pack}: ${spec.trace_metric} (not observed under profile ${profile})`);
    if (metric.n_applicable !== metric.n_observed) {
      fail(`${pack} trace_metric "${spec.trace_metric}" not publishable: observed ${metric.n_observed} of ${metric.n_applicable} applicable turns (cherry-pick guard)`);
    }
    return [pack, {
      metric: spec.metric,
      source: 'callsmith_measurement',
      region: config.region,
      profile,
      sample_size: metric.n_observed,
      percentiles_ms: { p50: metric.p50, p95: metric.p95, p99: metric.p99 },
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; profile ${profile}; nearest-rank percentiles; raw trace retained.`,
    }];
  }).filter(() => !vetoed));

  return {
    schema_version: trace.schema_version || 1,
    stack: config.stack,
    region: config.region,
    cohort: config.cohort,
    instrumentation_profile: profile,
    publishable: !vetoed,
    corpus_sha256: corpusSha256,
    config_sha256: configSha256,
    scheduled_turns: schedule.count,
    sample_size: summary.samples,
    p99_status: summary.samples >= 100 ? 'measured' : 'directional',
    quality: summary.quality,
    metrics: summary.metrics,
    stack_evidence: stackEvidence,
    pack_evidence: vetoed ? {} : packEvidence,
    provenance: provenance || undefined,
    spend: spend || undefined,
    adapter_sha256: adapterSha256 || undefined,
  };
}

const TRACE_KEYS = ['schema_version', 'track', 'run_id', 'environment', 'clock', 'turns'];
const ENV_KEYS = ['architecture', 'instrumentation_profile', 'surface', 'transport', 'region', 'runtime', 'providers', 'network_profile', 'audio_format', 'commit_sha'];
const CLOCK_KEYS = ['type', 'unit', 'origin_id', 'synchronization_error_ms'];
const TURN_KEYS = [
  'turn_id', 'utterance_id', 'speech_end_ms', 'speech_end_source', 'eou_detected_ms',
  'transcript_final_ms', 'llm_request_ms', 'llm_first_token_ms', 'text_committed_ms',
  'tts_request_ms', 'tts_first_chunk_ms', 'provider_first_output_ms', 'audio_first_playout_ms',
  'audio_first_audible_ms', 'playback_completed_ms', 'barge_in_detected_ms',
  'cancellation_sent_ms', 'cancellation_ack_ms', 'quality',
];
const QUALITY_KEYS = ['premature_cutoff', 'false_interruption', 'response_correct', 'audio_underruns'];

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) fail(`${label} contains unexpected field "${key}"`);
  }
}

function assertPublishableTraceShape(trace) {
  if (trace.schema_version !== 2) fail('operational publication requires a schema-v2 trace');
  assertKnownKeys(trace, TRACE_KEYS, 'trace');
  assertKnownKeys(trace.environment, ENV_KEYS, 'trace.environment');
  assertKnownKeys(trace.clock, CLOCK_KEYS, 'trace.clock');
  trace.turns.forEach((turn, index) => {
    assertKnownKeys(turn, TURN_KEYS, `trace.turns[${index}]`);
    assertKnownKeys(turn.quality, QUALITY_KEYS, `trace.turns[${index}].quality`);
  });
}

function assertRegularFile(file, root, label) {
  const resolved = path.resolve(file);
  if (!resolved.startsWith(`${root}${path.sep}`) || !fs.existsSync(resolved)) fail(`${label} is missing`);
  const stat = fs.lstatSync(resolved);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a regular file`);
}

function publishMeasurement(options) {
  if (!options.config || !options.source || !options.out) fail('--publish requires --config, --source, and --out');
  if (options.live || options.trace || options.approveSpendUsd !== undefined) {
    fail('--publish cannot be combined with live, replay, or spend-execution options');
  }
  const sourceRoot = path.resolve(options.source);
  const outRoot = path.resolve(options.out);
  if (!fs.existsSync(sourceRoot) || !fs.lstatSync(sourceRoot).isDirectory() || fs.lstatSync(sourceRoot).isSymbolicLink()) {
    fail('measurement source must be a real directory');
  }
  if (fs.existsSync(outRoot)) fail('output directory must not exist');
  if (outRoot === sourceRoot || outRoot.startsWith(`${sourceRoot}${path.sep}`)) fail('publication output must be outside the raw run directory');

  const allowed = new Set(['raw-trace.json', 'measurement.json', 'provenance.json', 'spend.json']);
  for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink() || !allowed.has(entry.name)) fail(`unknown measurement source artifact: ${entry.name}`);
  }
  const traceFile = path.join(sourceRoot, 'raw-trace.json');
  const measurementFile = path.join(sourceRoot, 'measurement.json');
  assertRegularFile(traceFile, sourceRoot, 'raw-trace.json');
  assertRegularFile(measurementFile, sourceRoot, 'measurement.json');

  const configFile = path.resolve(options.config);
  const config = read(configFile);
  const trace = read(traceFile);
  const sourceMeasurement = read(measurementFile);
  const profile = config.instrumentation_profile || 'cascaded_full';
  const corpusFile = path.resolve(path.dirname(configFile), config.corpus || 'utterances/manifest.json');
  const corpus = verifyCorpus(corpusFile);
  const schedule = resolveSchedule(config, corpus);
  preflightMetrics(config, profile);
  assertTraceProfile(trace, profile);
  assertCoverage(schedule, trace);
  assertPublishableTraceShape(trace);

  const provenanceFile = path.join(sourceRoot, 'provenance.json');
  const spendFile = path.join(sourceRoot, 'spend.json');
  const provenance = fs.existsSync(provenanceFile) ? read(provenanceFile) : null;
  const spend = fs.existsSync(spendFile) ? read(spendFile) : null;
  if (provenance) {
    assertRegularFile(provenanceFile, sourceRoot, 'provenance.json');
    validateProvenanceStructure(provenance);
    validateProvenanceConsistency(provenance, config, trace);
  }
  if (Boolean(sourceMeasurement.provenance) !== Boolean(provenance)) fail('measurement provenance does not match the retained source');
  if (Boolean(sourceMeasurement.spend) !== Boolean(spend)) fail('measurement spend does not match the retained source');

  let adapterSha256 = null;
  if (sourceMeasurement.adapter_sha256) {
    const adapterPath = config.adapter?.[1] && config.adapter[1].endsWith('.mjs') ? path.resolve(config.adapter[1]) : null;
    if (!adapterPath || !fs.existsSync(adapterPath)) fail('pinned adapter source is unavailable');
    adapterSha256 = sha256File(adapterPath);
  }
  const recomputed = buildMeasurementReceipt({
    config,
    configSha256: sha256File(configFile),
    corpusSha256: corpus.sha256,
    trace,
    schedule,
    provenance,
    spend,
    adapterSha256,
  });
  const expected = `${JSON.stringify(recomputed, null, 2)}\n`;
  if (fs.readFileSync(measurementFile, 'utf8') !== expected) fail('measurement receipt does not match recomputed trace metrics and provenance');
  if (!recomputed.publishable) fail('quality-vetoed measurements cannot be published');

  const roots = [sourceRoot, path.dirname(sourceRoot)];
  const publishedConfig = sanitizeJsonValue(config, roots);
  const publishedTrace = sanitizeJsonValue(trace, roots);
  // Replay is useful for proving the publication machinery, but it is not provider
  // evidence. Keep that distinction in the artifact people will actually read.
  const evidenceScope = provenance ? 'provider_operational' : 'replay_fixture';
  const publicReceipt = {
    ...recomputed,
    evidence_scope: evidenceScope,
    publishable: recomputed.publishable && Boolean(provenance),
    stack_evidence: provenance ? recomputed.stack_evidence : [],
    pack_evidence: provenance ? recomputed.pack_evidence : {},
  };
  const publishedMeasurement = sanitizeJsonValue(publicReceipt, roots);
  fs.mkdirSync(outRoot, { recursive: false });
  fs.writeFileSync(path.join(outRoot, 'config.json'), `${JSON.stringify(publishedConfig, null, 2)}\n`);
  fs.writeFileSync(path.join(outRoot, 'timing-trace.json'), `${JSON.stringify(publishedTrace, null, 2)}\n`);
  fs.writeFileSync(path.join(outRoot, 'measurement.json'), `${JSON.stringify(publishedMeasurement, null, 2)}\n`);
  fs.writeFileSync(path.join(outRoot, 'METHODOLOGY.md'), [
    '# Measurement methodology', '',
    `Stack: \`${config.stack}\``, `Region: \`${config.region}\``, `Cohort: \`${config.cohort}\``,
    `Instrumentation profile: \`${profile}\``, `Valid turns: ${recomputed.sample_size}`,
    `Evidence scope: \`${evidenceScope}\``, '',
    'Metrics were recomputed from the retained schema-v2 timing trace using nearest-rank percentiles.',
    'The publisher verified the frozen config, corpus, schedule, adapter when present, provenance, quality gates, and original receipt.',
    ...(provenance ? [] : ['This bundle is a replay-fixture proof of the publisher and is not provider-backed evidence.']),
    'The public trace contains timing and quality events only; raw provider output, audio, transcripts, credentials, and local paths are excluded.', '',
  ].join('\n'));
  fs.writeFileSync(path.join(outRoot, 'REDACTION.md'), [
    '# Redaction receipt', '',
    '- The unsanitized source run remains private and was not copied.',
    '- Common credentials, email addresses, trace identifiers, and local paths were redacted.',
    '- Unexpected source artifacts and unexpected trace fields fail publication.',
    '- Every public artifact is covered by `MANIFEST.sha256`.', '',
  ].join('\n'));
  assertNoSecrets(outRoot);
  writeManifest(outRoot);
  console.log(`Wrote sanitized measurement evidence: ${outRoot}`);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) {
    console.log('Usage:\n  run.mjs --config config.json --out fresh-dir (--trace trace.json | --live --approve-spend-usd N)\n  run.mjs --publish --source raw-run --config config.json --out public-evidence');
    return 0;
  }
  if (options.publish) return publishMeasurement(options);
  if (!options.config || !options.out) fail('--config and --out are required');
  // Execution modes are mutually exclusive: --trace replays a recorded trace;
  // --live runs the adapter. Both at once let --trace win and skip provenance,
  // producing publishable evidence with no adapter hash or pins.
  if (options.trace && options.live) fail('pass exactly one of --trace or --live (not both)');
  if (!options.trace && !options.live) fail('pass --trace <trace.json> or --live');
  const configFile = path.resolve(options.config);
  const config = read(configFile);
  if (!config.region || !['warm', 'cold'].includes(config.cohort)) fail('config requires region and cohort=warm|cold');
  if (fs.existsSync(options.out)) fail('output directory must not exist');
  const corpusFile = path.resolve(path.dirname(configFile), config.corpus || 'utterances/manifest.json');
  const corpus = verifyCorpus(corpusFile);
  const missing = (config.required_env || []).filter((key) => !process.env[key]);
  if (missing.length) fail(`missing required environment keys: ${missing.join(', ')}`);

  // The config profile is the contract for this run.
  const configProfile = config.instrumentation_profile || 'cascaded_full';

  // Spend authorization: the approval must COVER the configured maximum (an
  // approval below the ceiling leaves the adapter with no enforceable lower cap).
  // max_spend_usd is an approval ceiling, not an enforced provider bill cap;
  // provider billing remains externally measured.
  const ceiling = Number(config.max_spend_usd);
  if (options.live) {
    if (!Number.isFinite(ceiling) || ceiling < 0) fail('config.max_spend_usd must be a non-negative number for a live run');
    if (!Number.isFinite(options.approveSpendUsd) || options.approveSpendUsd < ceiling) {
      fail(`--live requires --approve-spend-usd N covering config.max_spend_usd ${ceiling} (got ${options.approveSpendUsd}); provider billing is externally measured`);
    }
  }

  // Preflight: validate config profile and every advertised metric BEFORE any
  // spend or directory creation. A misconfigured config must never reach the adapter.
  preflightMetrics(config, configProfile);
  // The declared schedule must resolve against the corpus before any execution.
  const schedule = resolveSchedule(config, corpus);

  fs.mkdirSync(options.out, { recursive: false });
  const rawTrace = path.join(options.out, 'raw-trace.json');

  let provenance = null;
  let spend = null;
  let adapterSha256 = null;
  if (options.trace) {
    fs.copyFileSync(options.trace, rawTrace);
  } else {
    if (!Array.isArray(config.adapter) || !config.adapter.length) fail('provider execution requires config.adapter argv');
    // Resolve and hash the adapter BEFORE spawning. A missing adapter file fails closed here.
    const adapterPath = config.adapter[1] && config.adapter[1].endsWith('.mjs') ? path.resolve(config.adapter[1]) : null;
    if (!adapterPath || !fs.existsSync(adapterPath)) fail(`adapter source not found: ${config.adapter.slice(1).join(' ')}`);
    adapterSha256 = sha256File(adapterPath);
    const run = spawnSync(config.adapter[0], [...config.adapter.slice(1), '--config', configFile, '--corpus', corpusFile, '--trace', rawTrace], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) fail(`adapter failed (${run.status ?? run.error?.message})`);
    const provenanceFile = path.join(options.out, 'provenance.json');
    const spendFile = path.join(options.out, 'spend.json');
    if (!fs.existsSync(provenanceFile)) fail('live run produced no provenance.json');
    provenance = read(provenanceFile);
    spend = fs.existsSync(spendFile) ? read(spendFile) : null;
    // Structural provenance pins as soon as the file is read.
    validateProvenanceStructure(provenance);
  }

  const trace = read(rawTrace);
  // The produced trace must declare the same profile the config pinned.
  assertTraceProfile(trace, configProfile);
  // Coverage: the observed turns must equal the declared schedule exactly.
  assertCoverage(schedule, trace);
  // For a live run, provenance must describe the same stack the trace measured.
  if (provenance) validateProvenanceConsistency(provenance, config, trace);
  const configSha256 = sha256File(configFile);
  const receipt = buildMeasurementReceipt({
    config,
    configSha256,
    corpusSha256: corpus.sha256,
    trace,
    schedule,
    provenance,
    spend,
    adapterSha256,
  });
  fs.writeFileSync(path.join(options.out, 'measurement.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return receipt.publishable ? 0 : 1;
}

try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
