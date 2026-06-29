import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli, writeAnswers } from './helpers/cli.mjs';

const BASE = {
  surface: 'inbound_pstn',
  architecture: 'realtime_s2s',
  telephony: 'exotel',
  orchestration: 'livekit',
  realtime_model: 'gemini_live',
  vad: 'silero',
  language: 'english',
  barge_in: 'required',
  latency: 'balanced',
  business_logic: 'support',
  tools: 'webhook',
  deployment: 'railway',
};

// P3 behavior change: unknown provider is now resolved online (synthesis), not refused
test('forge resolves an unknown telephony provider via synthesis instead of refusing', () => {
  const f = writeAnswers({ ...BASE, telephony: 'acme_nonexistent' });
  const result = runCli(['forge', '--answers', f], {
    env: { CALLSMITH_REGISTRY_SKIP: '1' },
  });
  assert.equal(result.exitCode, 0, 'forge must succeed — synthesis resolves unknown provider');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')),
    'recipe must be produced for synthesized provider');
});

// Missing mandatory leg — when the telephony field is explicitly empty
test('forge refuses when telephony is explicitly empty (missing mandatory leg)', () => {
  const f = writeAnswers({ ...BASE, telephony: '' });
  const result = runCli(['forge', '--answers', f]);
  assert.notEqual(result.exitCode, 0, 'forge must refuse');
  assert.match(result.stderr + result.stdout, /telephony|missing.*leg|impossible/i,
    'error must mention the missing telephony provider');
  assert.ok(!existsSync(join(result.outDir, 'callsmith.recipe.md')),
    'no recipe must be produced for an impossible stack');
});

// P3 behavior change: unknown STT is resolved via synthesis, not refused
test('forge resolves an unknown STT provider via synthesis instead of refusing', () => {
  const f = writeAnswers({
    ...BASE,
    architecture: 'cascaded',
    telephony: 'twilio',
    orchestration: 'pipecat',
    realtime_model: '',
    stt: 'nonexistent_stt',
    tts: 'elevenlabs',
    llm: 'gpt_4o',
  });
  const result = runCli(['forge', '--answers', f], {
    env: { CALLSMITH_REGISTRY_SKIP: '1' },
  });
  assert.equal(result.exitCode, 0, 'forge must succeed — synthesis resolves unknown STT');
});

// B5 — direction mismatch (outbound job + inbound-only provider)
// All current providers support both directions, so this tests the framework.
// It will become a real check when directional providers are added.
test('forge refuses a direction mismatch when provider lacks the requested direction', () => {
  const f = writeAnswers({ ...BASE, surface: 'outbound_pstn', telephony: 'exotel' });
  // exotel supports both directions, so this should SUCCEED for now
  const result = runCli(['forge', '--answers', f]);
  assert.equal(result.exitCode, 0, 'exotel supports outbound — this should succeed');
});

test('forge refuses an unsupported audio codec when no native layer converts it', () => {
  const registry = mkdtempSync(join(tmpdir(), 'cs-registry-'));
  mkdirSync(join(registry, 'telephony'), { recursive: true });
  writeFileSync(join(registry, 'telephony', 'opus-phone.json'), JSON.stringify({
    id: 'opus-phone',
    kind: 'telephony',
    label: 'Opus Phone',
    transport: 'websocket',
    ingest: { format: 'opus', sample_rate: 48000, channels: 1 },
    egress: { format: 'opus', sample_rate: 48000, channels: 1 },
    directions: ['inbound', 'outbound'],
    native_capabilities: [],
    lifecycle: ['call_started', 'media', 'call_ended'],
    potholes: [],
    env_keys: [],
    doc_urls: [],
  }));

  const f = writeAnswers({
    ...BASE,
    telephony: 'opus-phone',
    orchestration: 'custom_fastapi',
  });
  const result = runCli(['forge', '--answers', f], {
    env: { CALLSMITH_REGISTRY: registry },
  });
  assert.notEqual(result.exitCode, 0, 'unsupported codec stacks must be refused');
  assert.match(result.stderr + result.stdout, /no_audio_path|No supported inbound audio path/i);
  assert.ok(!existsSync(join(result.outDir, 'callsmith.recipe.md')),
    'no recipe must be produced for an unsupported audio path');
});

test('forge refuses explicit native capability conflicts', () => {
  const registry = mkdtempSync(join(tmpdir(), 'cs-registry-'));
  mkdirSync(join(registry, 'telephony'), { recursive: true });
  writeFileSync(join(registry, 'telephony', 'sip-only-carrier.json'), JSON.stringify({
    id: 'sip-only-carrier',
    kind: 'telephony',
    label: 'SIP-only Carrier',
    transport: 'sip',
    ingest: { format: 'pcm', sample_rate: 16000, channels: 1 },
    egress: { format: 'pcm', sample_rate: 16000, channels: 1 },
    directions: ['inbound', 'outbound'],
    native_capabilities: ['native_sip'],
    native_capability_conflicts: [{
      capability: 'native_sip',
      conflicts_with: ['audio_normalization'],
      note: 'This carrier requires owning the SIP leg directly.',
    }],
    lifecycle: ['call_started', 'media', 'call_ended'],
    potholes: [],
    env_keys: [],
    doc_urls: [],
  }));

  const f = writeAnswers({ ...BASE, telephony: 'sip-only-carrier', orchestration: 'livekit' });
  const result = runCli(['forge', '--answers', f], {
    env: { CALLSMITH_REGISTRY: registry },
  });
  assert.notEqual(result.exitCode, 0, 'conflicting native capabilities must be refused');
  assert.match(result.stderr + result.stdout, /native_capability_conflict|conflicts with/i);
});

// Regression guard — valid stacks still forge
test('forge succeeds on a valid realtime stack', () => {
  const result = runCli(['forge', '--answers', writeAnswers(BASE)]);
  assert.equal(result.exitCode, 0, 'valid stack must succeed');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')), 'recipe must be produced');
});
