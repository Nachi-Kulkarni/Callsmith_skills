import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forge } from './helpers/cli.mjs';

// B12 — LiveKit stack: no custom transcoding needed
test('a LiveKit stack recipe states no custom transcoding is needed', () => {
  const { recipeRaw, lock } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /No custom transcoding/i);
  assert.equal(lock.compatibility.requires_custom_bridge, false);
});

// B13 — custom-FastAPI stack: audio bridge with specific transforms
test('a custom-FastAPI stack recipe requires decoding mulaw and resampling', () => {
  const { recipeRaw, lock } = forge('exotel-custom-gemini.answers.json');
  assert.match(recipeRaw, /custom audio bridge is required/i);
  assert.match(recipeRaw, /decode mulaw/i);
  assert.match(recipeRaw, /resample 8000 Hz -> 16000 Hz/i);
  assert.match(recipeRaw, /resample 24000 Hz -> 8000 Hz/i);
  assert.equal(lock.compatibility.requires_custom_bridge, true);
});

// B9 — architecture gating: when-groups keep stacks clean
test('a realtime stack lock names no STT or TTS provider', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  assert.equal(lock.providers.stt, undefined, 'realtime lock must not list an STT');
  assert.equal(lock.providers.tts, undefined, 'realtime lock must not list a TTS');
  assert.ok(lock.providers.realtime, 'realtime lock must list a realtime provider');
});

test('a cascaded stack lock names no realtime provider', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  assert.equal(lock.providers.realtime, undefined, 'cascaded lock must not list a realtime model');
  assert.ok(lock.providers.stt && lock.providers.tts, 'cascaded lock must list STT + TTS');
});

// B11 — staleness guard: verified current model names pinned in lock
test('lock pins the verified Gemini Live model name', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  const models = Object.fromEntries(lock.provider_models.map(p => [p.id, p.model]));
  assert.equal(models['gemini-live'], 'gemini-3.1-flash-live-preview');
});

test('cascaded lock pins the verified Deepgram model name', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  const models = Object.fromEntries(lock.provider_models.map(p => [p.id, p.model]));
  assert.equal(models['deepgram'], 'nova-3');
});

// Observability — asymmetric rates + barge-in surface in the recipe text
test('Gemini Live asymmetric rates are called out in the recipe', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /asymmetric rates/i);
});

test('barge-in is noted in the recipe when enabled', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /barge-in enabled/i);
});

// B14/B25 — every recipe contains the agent-required structural sections
const ALL_FIXTURES = [
  'exotel-gemini.answers.json',
  'exotel-custom-gemini.answers.json',
  'twilio-cascaded.answers.json',
];

for (const fixture of ALL_FIXTURES) {
  test(`recipe from ${fixture} contains all agent-required sections`, () => {
    const { recipeRaw } = forge(fixture);
    assert.match(recipeRaw, /## Audio contract/i, 'must have an Audio contract section');
    assert.match(recipeRaw, /## Interruption & turn-taking/i, 'must have an Interruption section');
    assert.match(recipeRaw, /## Latency budget/i, 'must have a Latency budget section');
    assert.match(recipeRaw, /## Build order/i, 'must have a Build order section');
    assert.match(recipeRaw, /## Blockers/i, 'must have a Blockers & potholes section');
    assert.match(recipeRaw, /## Intent/i, 'must have an Intent section');
    assert.match(recipeRaw, /## Selected stack/i, 'must have a Selected stack section');
  });
}

// B25 — recipe references context files that forge actually produces
test('recipe references context files that forge actually produces', () => {
  const result = forge('exotel-gemini.answers.json');
  const contextFiles = [
    '.callsmith/context/architecture.md',
    '.callsmith/context/audio-contract.md',
    '.callsmith/context/potholes.md',
    '.callsmith/context/build-order.md',
    '.callsmith/context/interruption.md',
    '.callsmith/context/latency-budget.md',
  ];
  for (const f of contextFiles) {
    assert.ok(result.recipeRaw.includes(f),
      `recipe must reference ${f}`);
    assert.ok(result.hasFile(f),
      `forge must produce ${f}`);
  }
});
