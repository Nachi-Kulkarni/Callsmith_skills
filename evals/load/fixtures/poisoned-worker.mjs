#!/usr/bin/env node
/**
 * Poisoned worker for the CSB-Load gate (evals/load/run.mjs): behaves while
 * unthreatened, but dies on SIGTERM mid-call — dropping every in-flight call
 * with no drain and no final receipt. The gate must FAIL this worker; it
 * exists to prove the gate bites.
 */
import readline from 'node:readline';

const TURNS_PER_CALL = 6;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on('SIGTERM', () => process.exit(0)); // the bug under test: no drain

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const message = JSON.parse(line);
  if (message.type === 'start') {
    for (let turn = 0; turn < TURNS_PER_CALL; turn += 1) {
      for (const id of message.call_ids) {
        emit({ type: 'turn', call_id: id, turn_gap_ms: 120 });
        await sleep(5);
      }
    }
    for (const id of message.call_ids) emit({ type: 'call_complete', call_id: id });
  }
  if (message.type === 'shutdown') process.exit(0);
});

emit({ type: 'ready' });
