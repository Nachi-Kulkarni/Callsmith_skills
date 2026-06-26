import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePacks, validatePack } from '../src/lib/validate.mjs';

test('every provider pack validates against _schema.json', () => {
  const errors = validatePacks();
  assert.deepEqual(errors, [],
    'all packs must validate against the schema. Errors:\n' + errors.join('\n'));
});

test('validator catches a pack missing a required field', () => {
  const broken = { id: 'broken', kind: 'telephony', label: 'Broken' };
  const errors = validatePack(broken);
  assert.ok(errors.length > 0, 'a pack missing transport/ingest/egress/directions must fail');
  assert.ok(errors.some(e => e.includes('transport')), 'error mentions missing transport');
});
