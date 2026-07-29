#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeTrace } from '../csb/latency/score.mjs';
import { PROFILE_METRICS, INSTRUMENTATION_PROFILES, ARCH_PROFILE_COMPAT } from '../csb/latency/metrics.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (message) => { throw new Error(message); };
const sha256File = (file) => hash(fs.readFileSync(file));

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--live') out.live = true;
    else if (key === '--approve-spend-usd') out.approveSpendUsd = Number(argv[++i]);
    else if (['--config', '--trace', '--out'].includes(key)) out[key.slice(2)] = argv[++i];
    else if (key === '--help') out.help = true;
    else fail(`unknown argument: ${key}`);
  }
  return out;
}

function verifyCorpus(file) {
  const manifest = read(file);
  if (!Array.isArray(manifest.utterances) || manifest.utterances.length < 20) fail('corpus needs at least 20 utterances');
  const base = path.dirname(file);
  for (const item of manifest.utterances) {
    const audio = path.resolve(base, item.file);
    if (!item.license || !fs.existsSync(audio) || sha256File(audio) !== item.sha256) fail(`corpus receipt failed: ${item.id}`);
  }
  return sha256File(file);
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

// Live provenance pins. Every field below is required and cross-checked; a run
// missing any is rejected. Built at run time by the adapter, never typed into a
// tracked config template. The adapter hash is computed by the runner.
const PROVENANCE_FIELDS = [
  'target_commit', 'runtime_version', 'sdk_versions', 'model_ids',
  'machine_class', 'region', 'audio_format', 'network_profile',
];
function validateProvenance(provenance, adapterSha256) {
  if (!provenance || typeof provenance !== 'object') fail('provenance.json is required for a live run');
  for (const field of PROVENANCE_FIELDS) {
    const value = provenance[field];
    if (value === undefined || value === null || value === '') fail(`provenance.${field} is required`);
  }
  if (!adapterSha256) fail('adapter source could not be hashed; a resolvable adapter path is required');
}

function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) {
    console.log('Usage: run.mjs --config config.json --out fresh-dir [--trace trace.json | --live] [--approve-spend-usd N]');
    return 0;
  }
  if (!options.config || !options.out) fail('--config and --out are required');
  const configFile = path.resolve(options.config);
  const config = read(configFile);
  if (!config.region || !['warm', 'cold'].includes(config.cohort)) fail('config requires region and cohort=warm|cold');
  if (fs.existsSync(options.out)) fail('output directory must not exist');
  const corpus = path.resolve(path.dirname(configFile), config.corpus || 'utterances/manifest.json');
  const corpusSha256 = verifyCorpus(corpus);
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

  fs.mkdirSync(options.out, { recursive: false });
  const rawTrace = path.join(options.out, 'raw-trace.json');

  let provenance = null;
  let spend = null;
  let adapterSha256 = null;
  if (options.trace) {
    fs.copyFileSync(options.trace, rawTrace);
  } else {
    if (!options.live || !Array.isArray(config.adapter) || !config.adapter.length) fail('provider execution requires --live and config.adapter argv');
    // Resolve and hash the adapter BEFORE spawning. A missing adapter file fails closed here.
    const adapterPath = config.adapter[1] && config.adapter[1].endsWith('.mjs') ? path.resolve(config.adapter[1]) : null;
    if (!adapterPath || !fs.existsSync(adapterPath)) fail(`adapter source not found: ${config.adapter.slice(1).join(' ')}`);
    adapterSha256 = sha256File(adapterPath);
    const run = spawnSync(config.adapter[0], [...config.adapter.slice(1), '--corpus', corpus, '--trace', rawTrace], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) fail(`adapter failed (${run.status ?? run.error?.message})`);
    const provenanceFile = path.join(options.out, 'provenance.json');
    const spendFile = path.join(options.out, 'spend.json');
    if (!fs.existsSync(provenanceFile)) fail('live run produced no provenance.json');
    provenance = read(provenanceFile);
    spend = fs.existsSync(spendFile) ? read(spendFile) : null;
    validateProvenance(provenance, adapterSha256);
  }

  const trace = read(rawTrace);
  // The produced trace must declare the same profile the config pinned.
  assertTraceProfile(trace, configProfile);
  const summary = summarizeTrace(trace);
  const configSha256 = sha256File(configFile);

  // A quality veto makes the run diagnostic: never publish usable evidence.
  const vetoed = Object.values(summary.quality).some(Boolean);
  const stackMetrics = config.stack_metrics || [];
  const packMetrics = config.pack_metrics || {};

  const stackEvidence = stackMetrics
    .filter((name) => summary.metrics[name])
    .filter(() => !vetoed) // suppress publishable evidence on a vetoed run
    .map((name) => ({
      metric: name,
      source: 'callsmith_measurement',
      region: config.region,
      profile: configProfile,
      sample_size: summary.samples,
      percentiles_ms: { p50: summary.metrics[name].p50, p95: summary.metrics[name].p95, p99: summary.metrics[name].p99 },
      n_applicable: summary.metrics[name].n_applicable,
      n_observed: summary.metrics[name].n_observed,
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; profile ${configProfile}; nearest-rank percentiles; raw trace retained.`,
    }));

  // Per-provider attribution requires n_applicable === n_observed (defense-in-depth
  // against a partial trace slipping past the strict profile validator).
  const packEvidence = Object.fromEntries(Object.entries(packMetrics).map(([pack, spec]) => {
    const m = summary.metrics[spec.trace_metric];
    if (!m) fail(`unknown trace metric for ${pack}: ${spec.trace_metric} (not observed under profile ${configProfile})`);
    if (m.n_applicable !== m.n_observed) {
      fail(`${pack} trace_metric "${spec.trace_metric}" not publishable: observed ${m.n_observed} of ${m.n_applicable} applicable turns (cherry-pick guard)`);
    }
    return [pack, {
      metric: spec.metric,
      source: 'callsmith_measurement',
      region: config.region,
      profile: configProfile,
      sample_size: m.n_observed,
      percentiles_ms: { p50: m.p50, p95: m.p95, p99: m.p99 },
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; profile ${configProfile}; nearest-rank percentiles; raw trace retained.`,
    }];
  }).filter(() => !vetoed));

  const receipt = {
    schema_version: trace.schema_version || 1,
    stack: config.stack,
    region: config.region,
    cohort: config.cohort,
    instrumentation_profile: configProfile,
    publishable: !vetoed,
    corpus_sha256: corpusSha256,
    config_sha256: configSha256,
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
  fs.writeFileSync(path.join(options.out, 'measurement.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return vetoed ? 1 : 0;
}

try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
