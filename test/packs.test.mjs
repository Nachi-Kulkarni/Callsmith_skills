import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadProviders, loadMenu } from '../src/lib/resolver.mjs';

test('every pack declares a non-empty directions array with valid values', () => {
  for (const [id, pack] of Object.entries(loadProviders())) {
    assert.ok(Array.isArray(pack.directions) && pack.directions.length > 0,
      `${id} must declare a non-empty directions array`);
    for (const d of pack.directions) {
      assert.ok(['inbound', 'outbound'].includes(d),
        `${id} has invalid direction "${d}" (must be inbound or outbound)`);
    }
  }
});

test('every pack declares a native_capabilities array (may be empty)', () => {
  for (const [id, pack] of Object.entries(loadProviders())) {
    assert.ok(Array.isArray(pack.native_capabilities),
      `${id} must declare a native_capabilities array (use [] if none)`);
  }
});

test('audio_normalization is expressed via native_capabilities, not a boolean flag', () => {
  for (const [id, pack] of Object.entries(loadProviders())) {
    assert.equal(pack.audio_normalization, undefined,
      `${id} must not use the legacy audio_normalization boolean — move it to native_capabilities`);
  }
});

test('every menu option that maps to a provider has an installed pack (no dangling refs)', () => {
  const menu = loadMenu();
  const providers = loadProviders();
  const missing = [];
  for (const g of menu.groups) {
    for (const opt of g.options) {
      const providerId = opt.maps?.provider;
      const kind = opt.maps?.kind;
      if (providerId && !providers[providerId]) {
        missing.push(`${g.id}="${opt.id}" → provider "${providerId}"`);
      }
    }
  }
  assert.deepEqual(missing, [],
    'menu references providers without installed packs:\n' + missing.join('\n'));
});

test('all provider model names are pinned — staleness guard', () => {
  const providers = loadProviders();
  const pinned = {
    'gemini-live': 'gemini-3.1-flash-live-preview',
    'openai-realtime': 'gpt-realtime-2',
    'deepgram': 'nova-3',
    'assemblyai': 'universal-3-5-pro',
    'elevenlabs': 'eleven_v3',
    'cartesia': 'sonic-3.5',
    'sarvam': 'bulbul:v3',
    'openai': 'gpt-5.5',
    'anthropic': 'claude-sonnet-4-6',
    'gemini': 'gemini-3.5-flash',
  };
  for (const [id, expectedModel] of Object.entries(pinned)) {
    assert.ok(providers[id], `${id} pack must exist`);
    assert.equal(providers[id].model, expectedModel,
      `${id} model name drifted — verify against live docs and update`);
  }
});

test('telephony audio contracts match verified docs — staleness guard', () => {
  const providers = loadProviders();
  // μ-law 8kHz providers (verified via Context7 + live docs)
  const mulawProviders = ['exotel', 'twilio', 'plivo', 'telnyx'];
  for (const id of mulawProviders) {
    assert.equal(providers[id].egress.format, 'mulaw', `${id} egress must be mulaw`);
    assert.equal(providers[id].egress.sample_rate, 8000, `${id} egress must be 8kHz`);
    assert.equal(providers[id].ingest.format, 'mulaw', `${id} ingest must be mulaw`);
  }
  // Vonage streams raw L16 PCM, NOT μ-law (verified via developer.vonage.com)
  assert.equal(providers['vonage'].egress.format, 'pcm', 'Vonage egress must be pcm (L16), not mulaw');
  assert.equal(providers['vonage'].egress.sample_rate, 16000, 'Vonage default rate must be 16kHz');
  assert.equal(providers['vonage'].ingest.format, 'pcm', 'Vonage ingest must be pcm (L16), not mulaw');
});
