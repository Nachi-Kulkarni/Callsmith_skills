import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { forge, fixturePath, runCli, writeAnswers } from './helpers/cli.mjs';

// ─── LLM in pipeline ────────────────────────────────────────────────

test('cascaded recipe includes the LLM in the selected stack', () => {
  const { recipeRaw, lock } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /\*\*llm:\*\*/, 'recipe must list the LLM in selected stack');
  assert.ok(lock.providers.llm, 'lock must include the LLM provider');
});

test('cascaded lock pins the verified OpenAI model name', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  const models = Object.fromEntries(lock.provider_models.map(p => [p.id, p.model]));
  assert.equal(models['openai'], 'gpt-4o', 'lock must pin GPT-4o model');
});

test('cascaded recipe includes OPENAI_API_KEY in env', () => {
  const result = forge('twilio-cascaded.answers.json');
  const env = result.file('.env.example');
  assert.match(env, /OPENAI_API_KEY/, 'must list OPENAI_API_KEY');
});

test('detectImpossibilities refuses cascaded stack without LLM', () => {
  const answers = writeAnswers({
    surface: 'inbound_pstn',
    architecture: 'cascaded',
    telephony: 'twilio',
    orchestration: 'pipecat',
    stt: 'deepgram',
    tts: 'elevenlabs',
    vad: 'silero',
    llm: '',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'webhook',
    deployment: 'railway',
  });
  const result = runCli(['forge', '--answers', answers]);
  assert.notEqual(result.exitCode, 0, 'forge must refuse cascaded stack without LLM');
});

// ─── VAD in pipeline ────────────────────────────────────────────────

test('recipe includes VAD in the selected stack', () => {
  const { recipeRaw, lock } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /\*\*vad:\*\*/, 'recipe must list the VAD in selected stack');
  assert.match(recipeRaw, /Silero/i, 'default VAD must be Silero');
  assert.ok(lock.providers.vad, 'lock must include the VAD provider');
});

test('lock includes VAD in provider_models', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  const vadEntry = lock.provider_models.find(p => p.role === 'vad');
  assert.ok(vadEntry, 'lock provider_models must include vad');
});

// ─── Interruption resolution ────────────────────────────────────────

test('recipe has an Interruption & turn-taking section', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /## Interruption & turn-taking/i);
});

test('interruption section lists multiple layers', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /Speech Detection/i, 'must mention VAD/speech detection layer');
  assert.match(recipeRaw, /Media Playback Stop|Pipeline Cancellation|Realtime Model/i,
    'must mention a cancellation/playback layer');
});

test('interruption section includes code hints', () => {
  const { recipeRaw } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /code/i, 'should include code hints for interruption');
});

test('interruption context file is produced', () => {
  const result = forge('exotel-gemini.answers.json');
  assert.ok(result.hasFile('.callsmith/context/interruption.md'),
    'must produce interruption.md context file');
  const int = result.file('.callsmith/context/interruption.md');
  assert.match(int, /End-to-end interruption flow/i);
});

test('barge-in disabled produces half-duplex note', () => {
  const result = forge('grid/94-no-bargein-twilio-livekit-gemini.answers.json');
  assert.match(result.recipeRaw, /half-duplex/i, 'must note half-duplex mode when barge-in is disabled');
});

// ─── Latency budget ─────────────────────────────────────────────────

test('recipe has a Latency budget section', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /## Latency budget/i);
});

test('latency budget includes a total estimate', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /Total estimated/i);
  assert.match(recipeRaw, /\d+\s*ms/i, 'must include a numeric latency estimate');
});

test('latency budget context file is produced', () => {
  const result = forge('exotel-gemini.answers.json');
  assert.ok(result.hasFile('.callsmith/context/latency-budget.md'),
    'must produce latency-budget.md context file');
  const lat = result.file('.callsmith/context/latency-budget.md');
  assert.match(lat, /Optimization tips/i);
});

test('lock includes latency budget data', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  assert.ok(lock.latency, 'lock must include latency data');
  assert.ok(lock.latency.legs.length > 0, 'latency must have at least one leg');
  assert.ok(lock.latency.total_ms > 0, 'total_ms must be positive');
  assert.equal(typeof lock.latency.target_ms, 'number');
  assert.ok(lock.latency.verdict, 'must include a verdict');
});

test('cascaded latency includes STT + LLM + TTS legs', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  const labels = lock.latency.legs.map(l => l.label);
  assert.ok(labels.some(l => /STT/i.test(l)), 'must include STT latency leg');
  assert.ok(labels.some(l => /LLM/i.test(l)), 'must include LLM latency leg');
  assert.ok(labels.some(l => /TTS/i.test(l)), 'must include TTS latency leg');
});

// ─── Recipe structure updates ───────────────────────────────────────

test('recipe references interruption.md and latency-budget.md in agent instructions', () => {
  const { recipeRaw } = forge('exotel-gemini.answers.json');
  assert.match(recipeRaw, /\.callsmith\/context\/interruption\.md/);
  assert.match(recipeRaw, /\.callsmith\/context\/latency-budget\.md/);
});

test('build-order includes VAD wiring step', () => {
  const result = forge('exotel-gemini.answers.json');
  const buildOrder = result.file('.callsmith/context/build-order.md');
  assert.match(buildOrder, /VAD/i, 'build order must mention VAD wiring');
});
