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
const run = (args, env = {}) => spawnSync(process.execPath, [RUNNER, ...args], { encoding: 'utf8', cwd: ROOT, env: { ...process.env, ...env } });
// A one-utterance probe schedule + matching turn annotation, for single-turn
// replay tests. Every measurement run now declares the exact utterance IDs it
// must cover; a probe is a one-ID schedule.
const PROBE_UTTERANCE = 'digit-0-clean';
const probeSchedule = () => ({ utterance_ids: [PROBE_UTTERANCE] });
const probeTurn = (turn) => ({ ...turn, utterance_id: PROBE_UTTERANCE });

describe('measurement runner (replay)', () => {
  it('scores a recorded trace into callsmith_measurement evidence', () => {
    const out = path.join(tmp(), 'run');
    const r = run(['--config', CONFIG, '--out', out, '--trace', TRACE]);
    assert.equal(r.status, 0, r.stderr);
    const receipt = JSON.parse(fs.readFileSync(path.join(out, 'measurement.json'), 'utf8'));
    const trace = JSON.parse(fs.readFileSync(TRACE, 'utf8'));
    const summary = summarizeTrace(trace);
    assert.equal(receipt.schema_version, 2);
    assert.equal(receipt.instrumentation_profile, 'cascaded_full');
    assert.equal(receipt.stack, 'replay-fixture');
    assert.equal(receipt.region, 'us');
    assert.equal(receipt.cohort, 'warm');
    assert.equal(receipt.scheduled_turns, trace.turns.length);
    assert.equal(receipt.sample_size, trace.turns.length);
    assert.equal(receipt.p99_status, 'directional', 'under 100 valid turns p99 must stay directional');
    assert.equal(receipt.corpus_sha256, sha256(MANIFEST));
    assert.deepEqual(receipt.metrics, summary.metrics);
    assert.deepEqual(receipt.quality, summary.quality);
    // Honest cascaded pack attribution: a genuine per-leg span (OpenAI TTFT).
    const evidence = receipt.pack_evidence['openai'];
    assert.equal(evidence.source, 'callsmith_measurement');
    assert.equal(evidence.region, 'us');
    assert.equal(evidence.sample_size, trace.turns.length);
    // percentiles_ms is the clean percentile subset; coverage lives on the metric.
    assert.deepEqual(evidence.percentiles_ms, { p50: summary.metrics.llm_ttft_ms.p50, p95: summary.metrics.llm_ttft_ms.p95, p99: summary.metrics.llm_ttft_ms.p99 });
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
      turns: [probeTurn({
        turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector',
        provider_first_output_ms: 1300, audio_first_playout_ms: 1340, audio_first_audible_ms: 1370,
        quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 },
      })],
    };
    const traceFile = path.join(dir, 's2s.json');
    fs.writeFileSync(traceFile, JSON.stringify(s2sTrace));
    const config = {
      stack: 's2s-replay', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 's2s_transport', schedule: probeSchedule(),
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
      turns: [probeTurn({ turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector', provider_first_output_ms: 1200, audio_first_playout_ms: 1240, audio_first_audible_ms: 1270, quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 } })],
    };
    const traceFile = path.join(dir, 's2s.json');
    fs.writeFileSync(traceFile, JSON.stringify(s2sTrace));
    // Config pins end_to_end but the trace declares s2s_transport -> mismatch.
    const config = { stack: 'mismatch', region: 'us', cohort: 'warm', corpus: MANIFEST, instrumentation_profile: 'end_to_end', schedule: probeSchedule(), stack_metrics: ['turn_gap_ms'], pack_metrics: {} };
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
      turns: [probeTurn({ turn_id: 't1', speech_end_ms: 1000, speech_end_source: 'detector', provider_first_output_ms: 1200, audio_first_playout_ms: 1240, audio_first_audible_ms: 1270, quality: { premature_cutoff: false, false_interruption: true, response_correct: true, audio_underruns: 0 } })],
    };
    const traceFile = path.join(dir, 'veto.json');
    fs.writeFileSync(traceFile, JSON.stringify(vetoTrace));
    const config = { stack: 'veto', region: 'us', cohort: 'warm', corpus: MANIFEST, instrumentation_profile: 's2s_transport', schedule: probeSchedule(), stack_metrics: ['turn_gap_ms'], pack_metrics: {} };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 1, 'a vetoed run exits non-zero');
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'run', 'measurement.json'), 'utf8'));
    assert.equal(receipt.publishable, false);
    assert.deepEqual(receipt.pack_evidence, {});
    assert.deepEqual(receipt.stack_evidence, []);
  });

  // ---- Gate 1A.1 regression: the five evidence-integrity holes ----

  it('requires exactly one of --trace or --live (both at once must be rejected)', () => {
    const dir = tmp();
    const trace = path.join(ROOT, 'evals', 'csb', 'latency', 'fixtures', 's2s-valid.json');
    const config = {
      stack: 'xor', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 's2s_transport', schedule: probeSchedule(),
      stack_metrics: ['turn_gap_ms'], pack_metrics: {},
      max_spend_usd: 5, adapter: ['node', path.join(dir, 'noop.mjs')],
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    // Both flags: previously the trace branch won and skipped live provenance,
    // producing publishable evidence with no adapter hash. Now it must fail closed.
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', trace, '--live', '--approve-spend-usd', '5']);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /exactly one of --trace or --live/);
    assert.equal(fs.existsSync(path.join(dir, 'run')), false, 'output dir created despite mode rejection');
  });

  it('requires a declared schedule and proves corpus coverage (20 utterances, 12 turns is not covered)', () => {
    const dir = tmp();
    const trace = path.join(ROOT, 'evals', 'measure', 'fixtures', 'replay-trace.json');
    // No schedule: previously a 12-turn trace produced publishable evidence against
    // a 20-utterance corpus. Now the run must declare and prove coverage.
    const config = { stack: 'nosched', region: 'us', cohort: 'warm', corpus: MANIFEST, instrumentation_profile: 'cascaded_full' };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', trace]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /schedule\.utterance_ids is required/);
  });

  it('rejects a turn set that does not match the declared schedule (dropped utterance)', () => {
    const dir = tmp();
    // A 2-id schedule but a trace with only one of them covered.
    const trace = {
      schema_version: 2, track: 'live', run_id: 'cov',
      environment: { architecture: 'cascaded', instrumentation_profile: 'cascaded_full', surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'r', network_profile: 'n', audio_format: 'a', providers: { stt: 'd' } },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [probeTurn(cascadedTurn('only-one'))],
    };
    const traceFile = path.join(dir, 'cov.json');
    fs.writeFileSync(traceFile, JSON.stringify(trace));
    const config = {
      stack: 'cov', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 'cascaded_full',
      schedule: { utterance_ids: [PROBE_UTTERANCE, 'digit-1-clean'] },
      pack_metrics: {},
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', traceFile]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /coverage mismatch for "digit-1-clean"/);
  });

  it('rejects ambiguous schedule repeats before execution', () => {
    const dir = tmp();
    const config = {
      stack: 'bad-schedule', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 'cascaded_full',
      schedule: { utterance_ids: [PROBE_UTTERANCE], repeats: 1.5 },
      pack_metrics: {},
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--trace', TRACE]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /schedule\.repeats must be a positive integer/);
    assert.equal(fs.existsSync(path.join(dir, 'run')), false);
  });

  it('rejects bogus live provenance (empty sdk/model maps, junk target_commit, mismatched region)', () => {
    const dir = tmp();
    // A fake adapter that writes a valid cascaded trace but BOGUS provenance.
    const adapter = path.join(dir, 'fake.mjs');
    fs.writeFileSync(adapter, `import fs from 'node:fs'; import path from 'node:path';
const a = process.argv.slice(2); const tracePath = a[a.indexOf('--trace') + 1]; const outDir = path.dirname(tracePath);
const trace = JSON.parse(process.env.CALLSMITH_FAKE_TRACE);
trace.turns.forEach(t => { t.utterance_id = ${JSON.stringify(PROBE_UTTERANCE)}; });
fs.writeFileSync(tracePath, JSON.stringify(trace));
fs.writeFileSync(path.join(outDir, 'provenance.json'), JSON.stringify({
  target_commit: 'x', runtime_version: 'node-1', sdk_versions: {}, model_ids: {},
  machine_class: 'calculator', region: 'mars', audio_format: 'wrong', network_profile: 'pigeon',
}));
`);
    const baseTrace = {
      schema_version: 2, track: 'live', run_id: 'fake',
      environment: { architecture: 'cascaded', instrumentation_profile: 'cascaded_full', surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'fake', network_profile: 'n', audio_format: 'a', providers: { stt: 'd' } },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [cascadedTurn('fake-1')],
    };
    const config = {
      stack: 'fake', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 'cascaded_full', schedule: probeSchedule(),
      pack_metrics: {}, max_spend_usd: 5, adapter: ['node', adapter],
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--live', '--approve-spend-usd', '5'], { CALLSMITH_FAKE_TRACE: JSON.stringify(baseTrace) });
    // Structural check fails first on the junk target_commit / empty maps.
    assert.equal(r.status, 2);
    assert.match(r.stderr, /target_commit must be an immutable 40-hex git SHA|sdk_versions must be a non-empty|model_ids must be a non-empty/);
  });

  it('rejects live provenance whose region/audio/network do not match the measured run', () => {
    const dir = tmp();
    const adapter = path.join(dir, 'fake2.mjs');
    fs.writeFileSync(adapter, `import fs from 'node:fs'; import path from 'node:path';
const a = process.argv.slice(2); const configPath = a[a.indexOf('--config') + 1]; const tracePath = a[a.indexOf('--trace') + 1]; const outDir = path.dirname(tracePath);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (!config.schedule?.utterance_ids?.includes(${JSON.stringify(PROBE_UTTERANCE)})) process.exit(3);
const trace = JSON.parse(process.env.CALLSMITH_FAKE_TRACE);
trace.turns.forEach(t => { t.utterance_id = ${JSON.stringify(PROBE_UTTERANCE)}; });
fs.writeFileSync(tracePath, JSON.stringify(trace));
// Structurally valid provenance, but region mismatched vs config (us vs eu).
fs.writeFileSync(path.join(outDir, 'provenance.json'), JSON.stringify({
  target_commit: '0123456789abcdef0123456789abcdef01234567',
  runtime_version: 'node-20', sdk_versions: { x: '1' }, model_ids: { y: 'm' },
  machine_class: 'm5.large', region: 'eu', audio_format: 'a', network_profile: 'n',
}));
`);
    const baseTrace = {
      schema_version: 2, track: 'live', run_id: 'fake2',
      environment: { architecture: 'cascaded', instrumentation_profile: 'cascaded_full', surface: 'webrtc_app', transport: 'webrtc', region: 'us', runtime: 'fake', network_profile: 'n', audio_format: 'a', providers: { stt: 'd' } },
      clock: { type: 'monotonic', unit: 'ms', origin_id: 'c' },
      turns: [cascadedTurn('fake2-1')],
    };
    const config = {
      stack: 'fake2', region: 'us', cohort: 'warm', corpus: MANIFEST,
      instrumentation_profile: 'cascaded_full', schedule: probeSchedule(),
      pack_metrics: {}, max_spend_usd: 5, adapter: ['node', adapter],
    };
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
    const r = run(['--config', path.join(dir, 'config.json'), '--out', path.join(dir, 'run'), '--live', '--approve-spend-usd', '5'], { CALLSMITH_FAKE_TRACE: JSON.stringify(baseTrace) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /provenance\.region "eu" does not match/);
  });
});

// A minimal valid cascaded_full turn for live-provenance regression tests.
function cascadedTurn(turnId) {
  return {
    turn_id: turnId, speech_end_ms: 1000, speech_end_source: 'detector',
    eou_detected_ms: 1100, transcript_final_ms: 1150, llm_request_ms: 1160,
    llm_first_token_ms: 1300, text_committed_ms: 1350, tts_request_ms: 1360,
    tts_first_chunk_ms: 1500, audio_first_playout_ms: 1550, audio_first_audible_ms: 1580,
    quality: { premature_cutoff: false, false_interruption: false, response_correct: true, audio_underruns: 0 },
  };
}
