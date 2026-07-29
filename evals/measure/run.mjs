#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeTrace } from '../csb/latency/score.mjs';
import { PROFILE_METRICS, INSTRUMENTATION_PROFILES } from '../csb/latency/metrics.mjs';

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

// For a v2 trace the instrumentation profile lives on trace.environment; v1 has
// none and is treated as cascaded_full (the historical set).
function runProfile(trace, config) {
  if (trace?.schema_version === 2) return trace.environment?.instrumentation_profile || null;
  if (config.instrumentation_profile) return config.instrumentation_profile;
  return 'cascaded_full';
}

function assertMetricPermitted(specName, traceMetric, profile) {
  const allowed = PROFILE_METRICS[profile] || [];
  if (!INSTRUMENTATION_PROFILES.includes(profile)) fail(`unknown instrumentation_profile: ${profile}`);
  if (!allowed.includes(traceMetric)) {
    fail(`${specName} advertises trace_metric "${traceMetric}" which is not observable under profile "${profile}" (allowed: ${allowed.join(', ')})`);
  }
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

  // max_spend_usd is an APPROVAL CEILING, not an enforced provider bill cap.
  // An explicit --approve-spend-usd authorizes spend at or below the config ceiling;
  // provider billing remains externally measured.
  const ceiling = Number(config.max_spend_usd || 0);
  if (options.live) {
    if (!Number.isFinite(options.approveSpendUsd)) {
      fail('--live requires --approve-spend-usd N (explicit authorization at or below config.max_spend_usd)');
    }
    if (options.approveSpendUsd > ceiling) {
      fail(`--approve-spend-usd ${options.approveSpendUsd} exceeds config.max_spend_usd ${ceiling}; lower the approval or raise the config ceiling`);
    }
    console.error(`live measurement: approved $${options.approveSpendUsd} of ceiling $${ceiling.toFixed(2)} (provider billing measured externally)`);
  }

  fs.mkdirSync(options.out, { recursive: false });
  const rawTrace = path.join(options.out, 'raw-trace.json');

  let provenance = null;
  let spend = null;
  let adapterSha256 = null;
  if (options.trace) {
    fs.copyFileSync(options.trace, rawTrace);
  } else {
    if (!options.live || !Array.isArray(config.adapter) || !config.adapter.length) fail('provider execution requires --live and config.adapter argv');
    const run = spawnSync(config.adapter[0], [...config.adapter.slice(1), '--corpus', corpus, '--trace', rawTrace], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) fail(`adapter failed (${run.status ?? run.error?.message})`);
    // Provenance is produced by the adapter into the out dir at run time, not
    // typed into the config. The runner computes the adapter hash itself.
    const adapterPath = config.adapter[1] && config.adapter[1].endsWith('.mjs') ? path.resolve(config.adapter[1]) : null;
    adapterSha256 = adapterPath && fs.existsSync(adapterPath) ? sha256File(adapterPath) : null;
    const provenanceFile = path.join(options.out, 'provenance.json');
    const spendFile = path.join(options.out, 'spend.json');
    if (!fs.existsSync(provenanceFile)) fail('live run produced no provenance.json; target commit, runtime/SDK, and model pins are required');
    provenance = read(provenanceFile);
    spend = fs.existsSync(spendFile) ? read(spendFile) : null;
    if (!provenance.target_commit || !provenance.machine_class) fail('provenance.json requires target_commit and machine_class');
  }

  const trace = read(rawTrace);
  const summary = summarizeTrace(trace);
  const configSha256 = sha256File(configFile);
  const profile = runProfile(trace, config);

  // Verify every advertised metric (stack or pack) is observable under the
  // run's profile BEFORE emitting evidence. This is the fail-closed path for an
  // S2S config that advertises a cascaded-only metric (e.g. pre_llm_queue_ms).
  const stackMetrics = config.stack_metrics || [];
  const packMetrics = config.pack_metrics || {};
  for (const name of stackMetrics) {
    if (typeof name === 'string') assertMetricPermitted(`stack_metrics "${name}"`, name, profile);
  }
  for (const [pack, spec] of Object.entries(packMetrics)) {
    assertMetricPermitted(`pack_metrics.${pack}`, spec.trace_metric, profile);
  }

  // Stack metrics: emit whatever the trace observed under the profile. A stack
  // span crosses multiple providers, so it is never copied into a provider pack.
  const stackEvidence = stackMetrics
    .filter((name) => summary.metrics[name])
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

  // Pack evidence: per-provider attribution requires that EVERY applicable turn
  // observed the metric's boundaries (n_applicable === n_observed). Anything less
  // is cherry-picking and may not be published.
  const packEvidence = Object.fromEntries(Object.entries(packMetrics).map(([pack, spec]) => {
    const m = summary.metrics[spec.trace_metric];
    if (!m) fail(`unknown trace metric for ${pack}: ${spec.trace_metric} (not observed under profile ${profile})`);
    if (m.n_applicable !== m.n_observed) {
      fail(`${pack} trace_metric "${spec.trace_metric}" not publishable: observed ${m.n_observed} of ${m.n_applicable} applicable turns (cherry-pick guard)`);
    }
    return [pack, {
      metric: spec.metric,
      source: 'callsmith_measurement',
      region: config.region,
      profile,
      sample_size: m.n_observed,
      percentiles_ms: { p50: m.p50, p95: m.p95, p99: m.p99 },
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; profile ${profile}; nearest-rank percentiles; raw trace retained.`,
    }];
  }));

  const receipt = {
    schema_version: trace.schema_version || 1,
    stack: config.stack,
    region: config.region,
    cohort: config.cohort,
    instrumentation_profile: profile,
    corpus_sha256: corpusSha256,
    config_sha256: configSha256,
    sample_size: summary.samples,
    p99_status: summary.samples >= 100 ? 'measured' : 'directional',
    quality: summary.quality,
    metrics: summary.metrics,
    stack_evidence: stackEvidence,
    pack_evidence: packEvidence,
    provenance: provenance || undefined,
    spend: spend || undefined,
    adapter_sha256: adapterSha256 || undefined,
  };
  fs.writeFileSync(path.join(options.out, 'measurement.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return Object.values(summary.quality).some(Boolean) ? 1 : 0;
}

try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
