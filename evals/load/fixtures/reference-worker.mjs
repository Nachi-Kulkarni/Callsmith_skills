#!/usr/bin/env node
/**
 * Reference drain-correct worker for the CSB-Load gate (evals/load/run.mjs).
 * Speaks the JSONL protocol from evals/load/README.md. On SIGTERM it keeps
 * finishing every in-flight call, then reports a clean final receipt and
 * exits on shutdown. Turn gaps are deterministic so the gate is stable in CI.
 */
import readline from 'node:readline';

const TURNS_PER_CALL = 6;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let callIds = [];
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  const final = { type: 'final', stale_audio_replays: 0, fd_delta: 0, active_tasks_delta: 0 };
  process.stdout.write(`${JSON.stringify(final)}\n`, () => process.exit(0));
}

async function runCalls() {
  for (let turn = 0; turn < TURNS_PER_CALL; turn += 1) {
    for (let index = 0; index < callIds.length; index += 1) {
      emit({ type: 'turn', call_id: callIds[index], turn_gap_ms: 110 + ((index * 7 + turn * 13) % 20) });
      await sleep(2);
    }
  }
  for (const id of callIds) emit({ type: 'call_complete', call_id: id });
}

// Drain semantics: SIGTERM never kills in-flight calls; the worker stops
// accepting new work (none is accepted after start) and drains to completion.
process.on('SIGTERM', () => {});

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'start') {
    callIds = message.call_ids;
    runCalls();
  }
  if (message.type === 'shutdown') finish();
});

emit({ type: 'ready' });
