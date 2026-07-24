#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { nearestRank } from '../csb/latency/score.mjs';

const fail = (message) => { throw new Error(message); };
function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--config', '--out'].includes(argv[i])) out[argv[i].slice(2)] = argv[++i];
    else if (argv[i] === '--help') out.help = true;
    else fail(`unknown argument: ${argv[i]}`);
  }
  return out;
}

function cohort(config, concurrency, drain) {
  return new Promise((resolve, reject) => {
    const child = spawn(config.worker[0], config.worker.slice(1), { stdio: ['pipe', 'pipe', 'pipe'], env: process.env });
    const expected = Array.from({ length: concurrency }, (_, i) => `call-${i + 1}`);
    const turns = [], completed = new Set(), events = [], stderr = [];
    let buffer = '', signalled = false, shutdownSent = false, settled = false, timer;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ concurrency, drain, signal: signalled ? 'SIGTERM' : null, completed: [...completed], dropped: expected.filter((id) => !completed.has(id)), turns, events, stderr: stderr.join('') });
    };
    const handle = (event) => {
      events.push(event);
      if (event.type === 'ready') child.stdin.write(`${JSON.stringify({ type: 'start', call_ids: expected })}\n`);
      if (event.type === 'turn' && expected.includes(event.call_id) && Number.isFinite(event.turn_gap_ms)) {
        turns.push(event.turn_gap_ms);
        if (drain && !signalled && turns.length >= (config.signal_after_turns || 1)) {
          signalled = child.kill('SIGTERM');
        }
      }
      if (event.type === 'call_complete') completed.add(event.call_id);
      if (completed.size === expected.length && !shutdownSent) {
        shutdownSent = true;
        child.stdin.write('{"type":"shutdown"}\n');
      }
    };
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line) { try { handle(JSON.parse(line)); } catch { child.kill('SIGKILL'); finish(new Error(`worker emitted invalid JSONL: ${line}`)); } }
      }
    });
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.on('error', finish);
    child.on('close', () => finish());
    timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('worker timed out')); }, config.timeout_ms || 30000);
  });
}

async function main(argv = process.argv.slice(2)) {
  const options = args(argv);
  if (options.help) { console.log('Usage: run.mjs --config load.json --out fresh-dir'); return 0; }
  if (!options.config || !options.out) fail('--config and --out are required');
  const config = JSON.parse(fs.readFileSync(options.config, 'utf8'));
  if (!Array.isArray(config.worker) || !config.worker.length) fail('config.worker must be argv');
  if (!Number.isInteger(config.concurrency) || config.concurrency < 2) fail('config.concurrency must be >= 2');
  if (fs.existsSync(options.out)) fail('output directory must not exist');
  fs.mkdirSync(options.out);

  const baseline = await cohort(config, 1, false);
  const candidate = await cohort(config, config.concurrency, true);
  const p95 = (run) => run.turns.length ? nearestRank(run.turns, 0.95) : null;
  const baselineP95 = p95(baseline), candidateP95 = p95(candidate);
  const final = candidate.events.findLast((event) => event.type === 'final') || {};
  const degradation = baselineP95 > 0 && candidateP95 !== null ? ((candidateP95 - baselineP95) / baselineP95) * 100 : Infinity;
  const failures = [];
  if (!candidate.signal) failures.push('worker did not receive SIGTERM');
  if (candidate.dropped.length) failures.push(`dropped calls: ${candidate.dropped.join(', ')}`);
  if (degradation > (config.max_p95_degradation_pct ?? 25)) failures.push(`p95 degradation ${degradation.toFixed(2)}% exceeds bound`);
  for (const key of ['stale_audio_replays', 'fd_delta', 'active_tasks_delta']) if ((final[key] || 0) > 0) failures.push(`${key}=${final[key]}`);
  const receipt = { schema_version: 1, passed: !failures.length, baseline_p95_turn_gap_ms: baselineP95, drain_p95_turn_gap_ms: candidateP95, degradation_pct: Number.isFinite(degradation) ? Number(degradation.toFixed(2)) : null, failures, baseline, candidate };
  fs.writeFileSync(path.join(options.out, 'drain-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt, null, 2));
  return receipt.passed ? 0 : 1;
}

try { process.exitCode = await main(); } catch (error) { console.error(error.message); process.exitCode = 2; }
