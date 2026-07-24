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
    assert.deepEqual(evidence.percentiles_ms, summary.metrics.turn_gap_ms);
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
});
