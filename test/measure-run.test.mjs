/**
 * Measurement runner proof (WS1): replay a recorded trace through the
 * honest-evidence boundary — corpus hash receipt, cohort pins, nearest-rank
 * percentiles, quality vetoes, and directional p99 below 100 samples.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeTrace } from '../evals/csb/latency/score.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'evals', 'measure', 'run.mjs');
const CONFIG = path.join(ROOT, 'evals', 'measure', 'fixtures', 'replay-stack.json');
const TRACE = path.join(ROOT, 'evals', 'measure', 'fixtures', 'replay-trace.json');
const MANIFEST = path.join(ROOT, 'evals', 'measure', 'utterances', 'manifest.json');

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-measure-'));
const run = (args) => spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', cwd: ROOT });

describe('measurement runner (replay)', () => {
  it('scores a recorded trace into callsmith_measurement evidence', () => {
    const out = path.join(tmp(), 'run');
    const r = run(['--config', CONFIG, '--out', out, '--trace', TRACE]);
    assert.equal(r.status, 0, r.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(out, 'measurement.json'), 'utf8'));
    const trace = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
    const summary = summarizeTrace(trace);
    assert.equal(receipt.schema_version, 1);
    assert.equal(receipt.stack, 'replay-fixture');
    assert.equal(receipt.region, 'us');
    assert.equal(receipt.cohort, 'warm');
    assert.equal(receipt.sample_size, trace.turns.length);
    assert.equal(receipt.p99_status, 'directional', 'under 100 valid turns p99 must stay directional');
    assert.equal(receipt.corpus_sha256, sha256(MANIFEST));
    assert.deepEqual(receipt.metrics, summary.metrics);
    assert.deepEqual(receipt.quality, summary.quality);
    const evidence = receipt.pack_evidence['gemini-live'];
    assert.equal(evidence.source, 'callsmith_measurement');
    assert.equal(evidence.region, 'us');
    assert.equal(evidence.sample_size, trace.turns.length);
    // percentiles_ms is the clean percentile subset; coverage lives on the metric.
    assert.deepEqual(evidence.percentiles_ms, { p50: summary.metrics.turn_gap_ms.p50, p95: summary.metrics.turn_gap_ms.p95, p99: summary.metrics.turn_gap_ms.p99 });
    assert.match(evidence.methodology, /warm cohort/);
    assert.match(evidence.methodology, /raw trace retained/);
  });

  it('is byte-deterministic across runs', () => {
    const a = path.join(tmp(), 'run');
    const b = path.join(tmp(), 'run');
    assert.equal(run(['--config', CONFIG, '--out', a, '--trace', TRACE]).status, 0);
    assert.equal(run(['--config', CONFIG, '--out', b, '--trace', TRACE]).status, 0);
    assert.equal(
      fs.readFileSync(path.join(a, 'measurement.json'), 'utf8'),
      fs.readFileSync(path.join(b, 'measurement.json'), 'utf8'),
    );
  });

  it('fails closed on quality vetoes', () => {
    const trace = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
    trace.turns[0].quality.audio_underruns = 2;
    const dir = tmp();
    const veto = path.join(dir, 'veto.json');
    fs.writeFileSync(veto, JSON.stringify(trace));
    const r = run(['--config', CONFIG, '--out', path.join(dir, 'run'), '--trace', veto]);
    assert.equal(r.status, 1, r.stderr);
  });

  it('refuses a tampered corpus receipt', () => {
    const dir = tmp();
    const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    for (const item of manifest.utterances) {
      item.file = path.join(ROOT, 'evals', 'measure', 'utterances', item.file);
    }
    manifest.utterances[3].sha256 = '0'.repeat(64);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const config = { region: 'us', cohort: 'warm', corpus: path.join(dir, 'manifest.json') };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', TRACE]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /corpus receipt failed/);
  });

  it('preflights required environment keys before any spend', () => {
    const dir = tmp();
    const config = { region: 'us', cohort: 'warm', corpus: MANIFEST, required_env: ['CALLSMITH_TEST_MISSING_ENV'] };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', TRACE]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing required environment keys/);
  });

  it('rejects a metric advertised under a profile that cannot observe it', () => {
    const dir = tmp();
    const s2sTrace = {
      schema_version: 2, track: 'live', run_id: 'replay-s2s',
      environment: {
        architecture: 'realtime_s2s', instrumentation_profile: 's2s_transport',
        surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'replay',
        network_profile: 'recorded', audio_format: 'pcm16-16000-mono',
        providers: { realtime: 'gemini-live' },
      },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [{
        turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector',
        provider_first_output_ms: 1300, audio_first_playout_ms: 1340, audio_first_audible_ms: 1370,
        quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 },
      }],
    };
    const traceFile = path.join(dir, 's2s.json');
    fs.writeFileSync(traceFile, JSON.stringify(s2sTrace));
    // An S2S profile advertising a cascaded-only metric (llm_ttft_ms) must fail closed.
    const config = {
      stack: 's2s-replay', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 's2s_transport',
      pack_metrics: { 'gemini-live': { metric: 'llm_ttft_ms', trace_metric: 'llm_ttft_ms' } },
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not observable under profile "s2s_transport"/);
  });

  it('emits stack metrics for an s2s_transport trace and keeps pack evidence empty', () => {
    const dir = tmp();
    const s2sTrace = {
      schema_version: 2, track: 'live', run_id: 'replay-s2s-stack',
      environment: {
        architecture: 'realtime_s2s', instrumentation_profile: 's2s_transport',
        surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'replay',
        network_profile: 'recorded', audio_format: 'pcm16-16000-mono',
        providers: { realtime: 'gemini-live' },
      },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [{
        turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector',
        provider_first_output_ms: 1300, audio_first_playout_ms: 1340, audio_first_audible_ms: 1370,
        quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 },
      }],
    };
    const traceFile = path.join(dir, 's2s.json');
    fs.writeFileSync(traceFile, JSON.stringify(s2sTrace));
    const config = {
      stack: 's2s-replay', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 's2s_transport',
      stack_metrics: ['turn_gap_ms', 'speech_end_to_provider_output_ms'],
      pack_metrics: {},
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 0, r.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'measurement.json'), 'utf8'));
    assert.equal(receipt.instrumentation_profile, 's2s_transport');
    const stackMetrics = Object.fromEntries(receipt.stack_evidence.map((e) => [e.metric, e]));
    assert.ok(stackMetrics.turn_gap_ms);
    assert.ok(stackMetrics.speech_end_to_provider_output_ms);
    assert.deepEqual(receipt.pack_evidence, {});
  });

  it('requires --live approval to cover config.max_spend_usd and rejects invalid ceilings', () => {
    const dir = tmp();
    const config = { stack: 'live-probe', region: 'us', cohort: 'warm', corpus: MANIFEST, max_spend_usd: 5, adapter: ['node', 'evals/measure/adapters/livekit-gemini-live.mjs'] };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    // No approval at all -> rejected.
    const noApproval = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'a'), '--live']);
    assert.equal(noApproval.status, 2);
    assert.match(noApproval.stderr, /requires --approve-spend-usd/);
    // Approval BELOW the ceiling leaves no enforceable cap -> rejected (the old
    // behavior incorrectly accepted this and let spend run).
    const underCeiling = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'b'), '--live', '--approve-spend-usd', '1']);
    assert.equal(underCeiling.status, 2);
    assert.match(underCeiling.stderr, /covering config\.max_spend_usd/);
    // Negative ceiling -> rejected.
    const negConfig = { ...config, max_spend_usd: -1 };
    fs.writeFileSync(path.join(dir, 'neg.json'), JSON.stringify(negConfig));
    const negCeiling = run(['--config', path.join(dir, 'neg.json'), '--out', path.join(dir, 'c'), '--live', '--approve-spend-usd', '1']);
    assert.equal(negCeiling.status, 2);
    assert.match(negCeiling.stderr, /max_spend_usd must be a non-negative number/);
  });

  it('rejects an unobservable metric BEFORE the adapter runs (no provider spend on a bad config)', () => {
    const dir = tmp();
    // Sentinel adapter: if it ever executes, it writes a marker file.
    const sentinel = path.join(dir, 'sentinel.mjs');
    fs.writeFileSync(sentinel, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(path.join(dir, 'SENTINEL_RAN'))}, 'yes');\n`);
    const config = {
      stack: 'bad-metric', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 's2s_transport', max_spend_usd: 10,
      adapter: ['node', sentinel],
      pack_metrics: { 'gemini-live': { metric: 'llm_ttft_ms', trace_metric: 'llm_ttft_ms' } },
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--live', '--approve-spend-usd', '10']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not observable under profile "s2s_transport"/);
    // The adapter must never have executed.
    assert.equal(fs.existsSync(path.join(dir, 'SENTINEL_RAN')), false, 'adapter executed before preflight rejected the config');
    assert.equal(fs.existsSync(path.join(dir, 'run')), false, 'output directory was created before preflight');
  });

  it('rejects a v2 trace whose instrumentation_profile differs from the config', () => {
    const dir = tmp();
    const s2sTrace = {
      schema_version: 2, track: 'live', run_id: 'r',
      environment: {
        architecture: 'realtime_s2s', instrumentation_profile: 's2s_transport',
        surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'replay',
        network_profile: 'n', audio_format: 'a', providers: { realtime: 'g' },
      },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [{ turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector', provider_first_output_ms: 1200, audio_first_playout_ms: 1240, audio_first_audible_ms: 1270, quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 } }],
    };
    const traceFile = path.join(dir, 's2s.json');
    fs.writeFileSync(traceFile, JSON.stringify(s2sTrace));
    // Config pins end_to_end but the trace declares s2s_transport -> mismatch.
    const config = { stack: 'mismatch', region: 'us', cohort: 'warm', corpus: MANIFEST, instrumentation_profile: 'end_to_end', stack_metrics: ['turn_gap_ms'], pack_metrics: {} };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /does not match config/);
  });

  it('suppresses publishable evidence and marks the receipt when a quality gate is vetoed', () => {
    const dir = tmp();
    const vetoTrace = {
      schema_version: 2, track: 'live', run_id: 'r',
      environment: { architecture: 'realtime_s2s', instrumentation_profile: 's2s_transport', surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'replay', network_profile: 'n', audio_format: 'a', providers: { realtime: 'g' } },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [{ turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector', provider_first_output_ms: 1200, audio_first_playout_ms: 1240, audio_first_audible_ms: 1270, quality: { premature_cutoff: false, false_interruption: true, response_correct: true, audio_underruns: 0 } }],
    };
    const traceFile = path.join(dir, 'veto.json');
    fs.writeFileSync(traceFile, JSON.stringify(vetoTrace));
    const config = { stack: 'veto', region: 'us', cohort: 'warm', corpus: MANIFEST, instrumentation_profile: 's2s_transport', stack_metrics: ['turn_gap_ms'], pack_metrics: {} };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 1, 'a vetoed run exits non-zero');
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'measurement.json'), 'utf8'));
    assert.equal(receipt.publishable, false);
    assert.deepEqual(receipt.pack_evidence, {});
    assert.deepEqual(receipt.stack_evidence, []);
  });
});
