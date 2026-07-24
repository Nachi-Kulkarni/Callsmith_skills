#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeTrace } from '../csb/latency/score.mjs';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fail = (message) => { throw new Error(message); };

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--live') out.live = true;
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
    if (!item.license || !fs.existsSync(audio) || hash(fs.readFileSync(audio)) !== item.sha256) fail(`corpus receipt failed: ${item.id}`);
  }
  return hash(fs.readFileSync(file));
}

function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) {
    console.log('Usage: run.mjs --config config.json --out fresh-dir [--trace trace.json | --live]');
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
  fs.mkdirSync(options.out, { recursive: false });
  const rawTrace = path.join(options.out, 'raw-trace.json');

  if (options.trace) {
    fs.copyFileSync(options.trace, rawTrace);
  } else {
    if (!options.live || !Array.isArray(config.adapter) || !config.adapter.length) fail('provider execution requires --live and config.adapter argv');
    console.error(`live measurement: max spend $${Number(config.max_spend_usd || 0).toFixed(2)}`);
    const run = spawnSync(config.adapter[0], [...config.adapter.slice(1), '--corpus', corpus, '--trace', rawTrace], { stdio: 'inherit', env: process.env });
    if (run.status !== 0) fail(`adapter failed (${run.status ?? run.error?.message})`);
  }

  const trace = read(rawTrace);
  const summary = summarizeTrace(trace);
  const configSha256 = hash(fs.readFileSync(configFile));
  const evidence = Object.fromEntries(Object.entries(config.pack_metrics || {}).map(([pack, spec]) => {
    if (!summary.metrics[spec.trace_metric]) fail(`unknown trace metric for ${pack}: ${spec.trace_metric}`);
    return [pack, {
      metric: spec.metric,
      source: 'callsmith_measurement',
      region: config.region,
      sample_size: summary.samples,
      percentiles_ms: summary.metrics[spec.trace_metric],
      methodology: `Callsmith controlled corpus ${corpusSha256}; config ${configSha256}; ${config.cohort} cohort; nearest-rank percentiles; raw trace retained.`,
    }];
  }));
  const receipt = {
    schema_version: 1,
    stack: config.stack,
    region: config.region,
    cohort: config.cohort,
    corpus_sha256: corpusSha256,
    config_sha256: configSha256,
    sample_size: summary.samples,
    p99_status: summary.samples >= 100 ? 'measured' : 'directional',
    quality: summary.quality,
    metrics: summary.metrics,
    pack_evidence: evidence,
  };
  fs.writeFileSync(path.join(options.out, 'measurement.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return Object.values(summary.quality).some(Boolean) ? 1 : 0;
}

try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
