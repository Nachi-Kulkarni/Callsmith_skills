import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './helpers/cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

function fixturePath(name) {
  return join(FIXTURES, name);
}

// B-docs-1: docs produces a stub per provider in the pipeline
test('docs generates one .md per selected provider', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const docsDir = join(result.outDir, '.callsmith', 'docs');
  assert.ok(existsSync(join(docsDir, 'exotel.md')), 'must produce exotel.md');
  assert.ok(existsSync(join(docsDir, 'livekit.md')), 'must produce livekit.md');
  assert.ok(existsSync(join(docsDir, 'gemini-live.md')), 'must produce gemini-live.md');
  assert.ok(existsSync(join(docsDir, 'README.md')), 'must produce docs index');
});

// B-docs-2: stub contains the frozen audio contract
test('exotel doc stub contains the frozen audio contract', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const doc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'exotel.md'), 'utf8');
  assert.match(doc, /mulaw/i, 'must mention mulaw format');
  assert.match(doc, /8000/i, 'must mention 8kHz sample rate');
  assert.match(doc, /websocket/i, 'must mention transport');
});

test('gemini-live doc stub contains the frozen audio contract', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const doc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'gemini-live.md'), 'utf8');
  assert.match(doc, /pcm/i, 'must mention PCM format');
  assert.match(doc, /16000/i, 'must mention 16kHz ingest rate');
  assert.match(doc, /24000/i, 'must mention 24kHz egress rate');
  assert.match(doc, /gemini-3.1-flash-live-preview/i, 'must pin the verified model name');
});

// B-docs-3: stub contains required env keys
test('doc stubs list required env keys', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const exotelDoc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'exotel.md'), 'utf8');
  assert.match(exotelDoc, /EXOTEL_API_KEY/i, 'must list EXOTEL_API_KEY');
  assert.match(exotelDoc, /EXOTEL_ACCOUNT_SID/i, 'must list EXOTEL_ACCOUNT_SID');
});

// B-docs-4: stub contains official doc URLs
test('doc stubs contain official doc URLs', () => {
  const result = runCli(['docs', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.equal(result.exitCode, 0);
  const twilioDoc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'twilio.md'), 'utf8');
  assert.match(twilioDoc, /https:\/\/.*twilio/i, 'must link to Twilio docs');
});

// B-docs-5: stub contains Context7 hydration commands when library_id is set
test('gemini-live doc stub contains Context7 commands', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const doc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'gemini-live.md'), 'utf8');
  assert.match(doc, /ctx7|context7/i, 'must contain Context7 commands');
});

test('telnyx pack has a verified Context7 library_id', () => {
  const telnyxPack = JSON.parse(readFileSync(
    join(HERE, '..', 'providers', 'telephony', 'telnyx.json'), 'utf8',
  ));
  assert.ok(telnyxPack.context7?.library_id, 'Telnyx must have a context7 library_id');
  assert.equal(telnyxPack.context7.library_id, '/websites/developers_telnyx');
});

// B-docs-6: cascaded stack produces STT + TTS doc stubs
test('cascaded stack docs include STT and TTS stubs', () => {
  const result = runCli(['docs', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.equal(result.exitCode, 0);
  const docsDir = join(result.outDir, '.callsmith', 'docs');
  assert.ok(existsSync(join(docsDir, 'deepgram.md')), 'must produce deepgram.md');
  assert.ok(existsSync(join(docsDir, 'elevenlabs.md')), 'must produce elevenlabs.md');
  assert.ok(existsSync(join(docsDir, 'twilio.md')), 'must produce twilio.md');
  assert.ok(existsSync(join(docsDir, 'pipecat.md')), 'must produce pipecat.md');
});

// B-docs-7: doc stubs contain lifecycle events
test('doc stub contains lifecycle events', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const exotelDoc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'exotel.md'), 'utf8');
  assert.match(exotelDoc, /Lifecycle/i, 'must have a lifecycle section');
  assert.match(exotelDoc, /call_started|call_initiated|media/i, 'must list at least one lifecycle event');
});

// B-docs-8: potholes from the pack appear in the doc stub
test('doc stub contains pack potholes', () => {
  const result = runCli(['docs', '--answers', fixturePath('exotel-gemini.answers.json')]);
  assert.equal(result.exitCode, 0);
  const exotelDoc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'exotel.md'), 'utf8');
  assert.match(exotelDoc, /Potholes/i, 'must have a potholes section');
  assert.match(exotelDoc, /blocker/i, 'must include blocker-level potholes');
});

// B-docs-9: vonage doc stub reflects PCM (not mulaw) after the verification fix
test('vonage doc stub contains PCM contract, not mulaw', () => {
  const result = runCli(['docs', '--answers', fixturePath('grid/82-vonage-pipecat-deepgram-cartesia.answers.json')]);
  assert.equal(result.exitCode, 0);
  const vonageDoc = readFileSync(join(result.outDir, '.callsmith', 'docs', 'vonage.md'), 'utf8');
  assert.match(vonageDoc, /pcm/i, 'Vonage doc must say PCM');
  assert.match(vonageDoc, /16000/i, 'Vonage doc must mention 16kHz');
  assert.doesNotMatch(vonageDoc, /mulaw/i, 'Vonage doc must NOT mention mulaw');
});
