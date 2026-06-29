import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, fixturePath } from './helpers/cli.mjs';

// B15 — check exit codes are a public contract

test('check exits zero on a clean (no-blocker) stack', () => {
  const result = runCli(['check', '--answers', fixturePath('exotel-gemini.answers.json')], { out: false });
  assert.equal(result.exitCode, 0,
    'check must exit 0 on a clean stack. stderr was: ' + result.stderr);
});

test('check exits non-zero when blockers are present', () => {
  const result = runCli(['check', '--answers', fixturePath('exotel-custom-gemini.answers.json')], { out: false });
  assert.notEqual(result.exitCode, 0,
    'check must exit non-zero when the stack has unresolved blockers');
  assert.match(result.stdout + result.stderr, /blocker/i,
    'check output should mention blockers');
});

// B17/B19 — bad input handling

test('forge exits non-zero on malformed JSON answers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
  const file = join(dir, 'broken.json');
  writeFileSync(file, '{ not valid json }}}');
  const result = runCli(['forge', '--answers', file]);
  assert.notEqual(result.exitCode, 0, 'malformed JSON must not exit 0');
  assert.match(result.stderr + result.stdout, /json|parse|error/i,
    'error message should mention JSON/parse');
});

test('forge exits non-zero on invalid non-provider answers', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cs-test-')), 'answers.json');
  writeFileSync(file, JSON.stringify({
    surface: 'inbound_pstn',
    architecture: 'not_a_real_architecture',
    telephony: 'twilio',
    orchestration: 'livekit',
    realtime_model: 'gemini_live',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'webhook',
    deployment: 'railway',
  }, null, 2));
  const result = runCli(['forge', '--answers', file]);
  assert.notEqual(result.exitCode, 0, 'invalid MCQ answers must not forge');
  assert.match(result.stderr + result.stdout, /invalid answer.*architecture/i,
    'error message should name the invalid group');
});

test('forge exits non-zero when a visible required answer is omitted', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cs-test-')), 'answers.json');
  writeFileSync(file, JSON.stringify({
    surface: 'inbound_pstn',
    architecture: 'realtime_s2s',
    telephony: 'twilio',
    orchestration: 'livekit',
    realtime_model: 'gemini_live',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'webhook',
    deployment: 'railway',
  }, null, 2));
  const result = runCli(['forge', '--answers', file]);
  assert.notEqual(result.exitCode, 0, 'missing visible answers must not forge');
  assert.match(result.stderr + result.stdout, /missing required answer.*vad/i);
});

test('forge exits non-zero on hidden conflicting answers', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cs-test-')), 'answers.json');
  writeFileSync(file, JSON.stringify({
    surface: 'inbound_pstn',
    architecture: 'realtime_s2s',
    telephony: 'twilio',
    orchestration: 'livekit',
    realtime_model: 'gemini_live',
    stt: 'deepgram',
    llm: 'gpt_4o',
    tts: 'elevenlabs',
    vad: 'silero',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'webhook',
    deployment: 'railway',
  }, null, 2));
  const result = runCli(['forge', '--answers', file]);
  assert.notEqual(result.exitCode, 0, 'hidden conflicting answers must not forge');
  assert.match(result.stderr + result.stdout, /not valid for the selected route|stt/i);
});

test('unknown command exits non-zero', () => {
  const result = runCli(['froge'], { out: false });
  assert.notEqual(result.exitCode, 0, 'unknown command must not exit 0');
});

test('spec --answers writes an executable route-specific template', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
  const file = join(dir, 'voice.answers.json');
  const spec = runCli(['spec', '--answers', file], { out: false });
  assert.equal(spec.exitCode, 0, 'spec template command must succeed');
  const forge = runCli(['forge', '--answers', file]);
  assert.equal(forge.exitCode, 0,
    'fresh template should forge without hidden conflicting answers:\n' + forge.stderr);
});
