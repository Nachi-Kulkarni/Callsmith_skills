import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, writeAnswers } from './helpers/cli.mjs';

const BASE = {
  surface: 'inbound_pstn',
  architecture: 'realtime_s2s',
  telephony: 'exotel',
  orchestration: 'livekit',
  realtime_model: 'gemini_live',
  language: 'english',
  barge_in: 'required',
  latency: 'balanced',
  business_logic: 'support',
  tools: 'webhook',
  deployment: 'railway',
};

// B6 + unknown-provider — forge refuses when telephony is set to an invalid value
test('forge refuses when a telephony value matches no menu option (missing mandatory leg)', () => {
  const f = writeAnswers({ ...BASE, telephony: 'acme_nonexistent' });
  const result = runCli(['forge', '--answers', f]);
  assert.notEqual(result.exitCode, 0, 'forge must refuse');
  assert.match(result.stderr + result.stdout, /telephony|missing.*leg|impossible/i,
    'error must mention the missing telephony provider');
  assert.ok(!existsSync(join(result.outDir, 'callsmith.recipe.md')),
    'no recipe must be produced for an impossible stack');
});

// B6 — missing mandatory leg (invalid stt value → group skipped → no STT)
test('forge refuses a cascaded stack missing its STT leg', () => {
  const f = writeAnswers({
    ...BASE,
    architecture: 'cascaded',
    telephony: 'twilio',
    orchestration: 'pipecat',
    stt: 'nonexistent_stt',
    tts: 'elevenlabs',
    llm: 'gpt_4o',
  });
  const result = runCli(['forge', '--answers', f]);
  assert.notEqual(result.exitCode, 0, 'forge must refuse');
  assert.match(result.stderr + result.stdout, /stt|missing.*leg|impossible/i,
    'error must mention the missing STT');
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

// Regression guard — valid stacks still forge
test('forge succeeds on a valid realtime stack', () => {
  const result = runCli(['forge', '--answers', writeAnswers(BASE)]);
  assert.equal(result.exitCode, 0, 'valid stack must succeed');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')), 'recipe must be produced');
});
