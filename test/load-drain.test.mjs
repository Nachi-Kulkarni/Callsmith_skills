/**
 * CSB-Load drain gate proof (WS3): a drain-correct worker passes under a real
 * SIGTERM mid-call; a worker that drops in-flight calls on SIGTERM fails.
 * Both run locally in milliseconds, no credentials.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'evals', 'load', 'run.mjs');
const FIXTURES = path.join(ROOT, 'evals', 'load', 'fixtures');

function runGate(fixture) {
  const config = JSON.parse(fs.readFileSync(path.join(FIXTURES, fixture), 'utf8'));
  config.worker = [process.execPath, path.join(ROOT, config.worker[1])];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-load-'));
  const configFile = path.join(dir, 'load.json');
  fs.writeFileSync(configFile, JSON.stringify(config));
  const out = path.join(dir, 'run');
  const r = spawnSync(process.execPath, [RUNNER, '--config', configFile, '--out', out], { encoding: 'utf8', cwd: ROOT });
  const receiptFile = path.join(out, 'drain-receipt.json');
  const receipt = fs.existsSync(receiptFile) ? JSON.parse(fs.readFileSync(receiptFile, 'utf8')) : null;
  return { r, receipt };
}

describe('CSB-Load drain gate', () => {
  it('passes a drain-correct worker under SIGTERM mid-call', () => {
    const { r, receipt } = runGate('reference.json');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(receipt, 'drain receipt written');
    assert.equal(receipt.passed, true, JSON.stringify(receipt.failures));
    assert.equal(receipt.candidate.signal, 'SIGTERM');
    assert.deepEqual(receipt.candidate.dropped, []);
    assert.equal(receipt.candidate.completed.length, 8);
    assert.ok(
      receipt.drain_p95_turn_gap_ms <= receipt.baseline_p95_turn_gap_ms * 1.25,
      `p95 degradation bounded: baseline=${receipt.baseline_p95_turn_gap_ms} drain=${receipt.drain_p95_turn_gap_ms}`,
    );
  });

  it('fails a worker that drops in-flight calls on SIGTERM', () => {
    const { r, receipt } = runGate('poisoned.json');
    assert.equal(r.status, 1, r.stderr);
    assert.ok(receipt, 'drain receipt written even on failure');
    assert.equal(receipt.passed, false);
    assert.match(receipt.failures.join('; '), /dropped calls/);
    assert.equal(receipt.candidate.dropped.length, 8);
  });
});
