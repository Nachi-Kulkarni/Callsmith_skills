import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { validateProviderId } from '../src/lib/resolver.mjs';
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

function walkDir(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkDir(p, acc);
    else acc.push({ path: p, content: readFileSync(p, 'utf8') });
  }
  return acc;
}

// Unit: validateProviderId accepts safe custom ids (hyphens and underscores)
test('validateProviderId accepts safe lowercase-kebab and snake ids', () => {
  for (const id of ['exotel', 'acme-telephony', 'acme_nonexistent', 'globex-voice', 'a', 'A1-2_3']) {
    assert.equal(validateProviderId(id), id, `${id} should be accepted`);
  }
});

// Unit: validateProviderId rejects breakout / path-traversal / prompt-injection payloads
test('validateProviderId rejects dangerous ids', () => {
  const malicious = [
    'x"""y',                 // Python docstring breakout
    '"; import os',          // Python string breakout
    '../../tmp/pwned',       // path traversal
    'a/b',                   // path separator
    'a b',                   // space
    'a\nb',                  // newline (prompt injection / log spoof)
    'a\x1b[2Jb',            // ANSI clear
    'IGNORE_ALL\n\nbash',    // prompt injection
    '',                      // empty
    'a'.repeat(65),          // too long
    '#$%',                   // special chars
  ];
  for (const id of malicious) {
    assert.throws(() => validateProviderId(id), `${JSON.stringify(id)} should be rejected`);
  }
});

// E2E: forge refuses a malicious telephony id at the boundary
test('forge refuses a provider id containing Python docstring breakout', () => {
  const f = writeAnswers({ ...BASE, telephony: 'x"""y' });
  const result = runCli(['forge', '--answers', f], { env: { CALLSMITH_REGISTRY_SKIP: '1' } });
  assert.notEqual(result.exitCode, 0, 'forge must refuse the malicious id');
  assert.match(result.stderr, /Invalid provider id/i, 'error must explain the id was rejected');
  assert.ok(!existsSync(join(result.outDir, 'callsmith.recipe.md')), 'no recipe must be produced');
});

// E2E: path-traversal id is blocked before docs can write outside outDir
test('forge refuses a path-traversal provider id', () => {
  const f = writeAnswers({ ...BASE, telephony: '../../tmp/cs-pwned' });
  const result = runCli(['forge', '--answers', f], { env: { CALLSMITH_REGISTRY_SKIP: '1' } });
  assert.notEqual(result.exitCode, 0, 'forge must refuse the traversal id');
  assert.match(result.stderr, /Invalid provider id/i);
});

// E2E: a legitimate custom id still forges successfully (no false positives)
test('forge accepts a legitimate custom provider id', () => {
  const f = writeAnswers({ ...BASE, telephony: 'acme-telephony' });
  const result = runCli(['forge', '--answers', f], { env: { CALLSMITH_REGISTRY_SKIP: '1' } });
  assert.equal(result.exitCode, 0, 'legitimate custom id must forge');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')));
});

// E2E: generated artifacts contain no injected executable statements
test('forged recipe + scaffold contain no injected python from the provider id', () => {
  const f = writeAnswers({ ...BASE, telephony: 'safe-custom', orchestration: 'custom_fastapi' });
  // Forge
  const forged = runCli(['forge', '--answers', f], { env: { CALLSMITH_REGISTRY_SKIP: '1' } });
  assert.equal(forged.exitCode, 0);
  for (const file of walkDir(forged.outDir)) {
    assert.ok(!file.content.includes('os.system('), `${file.path} must not contain os.system()`);
    assert.ok(!file.content.includes('__import__'), `${file.path} must not contain __import__`);
    assert.ok(!file.content.includes('subprocess.'), `${file.path} must not contain subprocess.`);
  }
});
