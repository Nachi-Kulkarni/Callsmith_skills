import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forge } from './helpers/cli.mjs';

test('same answers produce byte-identical lock.json', () => {
  const a = forge('exotel-gemini.answers.json');
  const b = forge('exotel-gemini.answers.json');
  assert.equal(a.lockRaw, b.lockRaw,
    'lock.json must be byte-identical for the same answers (no timestamps, no nondeterminism)');
});

test('lock.json contains no generated_at or timestamp field', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  assert.equal(lock.generated_at, undefined, 'generated_at must not appear in lock');
  assert.equal(lock.timestamp, undefined, 'no timestamp field');
});
