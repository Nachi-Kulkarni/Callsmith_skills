import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli, fixturePath, writeAnswers } from './helpers/cli.mjs';

const FIXTURES = dirname(fileURLToPath(import.meta.url)) + '/fixtures';
const REGISTRY_DIR = join(FIXTURES, 'registry');

const BASE = {
  surface: 'inbound_pstn',
  architecture: 'realtime_s2s',
  orchestration: 'livekit',
  realtime_model: 'gemini_live',
  language: 'english',
  barge_in: 'required',
  latency: 'balanced',
  business_logic: 'support',
  tools: 'webhook',
  deployment: 'railway',
};

// ---- Tier 1: Registry lookup ----

test('forge resolves an unknown provider via local registry', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('registry-lookup.answers.json')],
    { env: { CALLSMITH_REGISTRY: REGISTRY_DIR } },
  );
  assert.equal(result.exitCode, 0, 'forge must succeed with registry-resolved provider');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')), 'recipe must be produced');
  const recipe = readFileSync(join(result.outDir, 'callsmith.recipe.md'), 'utf8');
  assert.match(recipe, /Acme Telephony/, 'recipe must use the registry pack label');
  assert.doesNotMatch(recipe, /UNVERIFIED/i, 'registry pack must NOT be stamped UNVERIFIED');
});

test('lock records registry-resolved provider as verified', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('registry-lookup.answers.json')],
    { env: { CALLSMITH_REGISTRY: REGISTRY_DIR } },
  );
  assert.equal(result.exitCode, 0);
  const lock = JSON.parse(readFileSync(join(result.outDir, 'callsmith.lock.json'), 'utf8'));
  assert.ok(Array.isArray(lock.resolved_providers), 'lock must have resolved_providers array');
  const entry = lock.resolved_providers.find(p => p.id === 'acme-telephony');
  assert.ok(entry, 'lock must record acme-telephony');
  assert.equal(entry.verified, true, 'registry pack must be verified');
  assert.equal(entry.source, 'registry');
});

// ---- Tier 2: Dynamic synthesis fallback ----

test('forge synthesizes a pack when provider is not in registry', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  assert.equal(result.exitCode, 0, 'forge must succeed — synthesis prevents impossibility');
  assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')), 'recipe must be produced');
  const recipe = readFileSync(join(result.outDir, 'callsmith.recipe.md'), 'utf8');
  assert.match(recipe, /UNVERIFIED/i, 'synthesized provider must be stamped UNVERIFIED');
  assert.match(recipe, /globex-voice/i, 'synthesized provider id must appear in recipe');
});

test('lock records synthesized provider as unverified', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  assert.equal(result.exitCode, 0);
  const lock = JSON.parse(readFileSync(join(result.outDir, 'callsmith.lock.json'), 'utf8'));
  const entry = lock.resolved_providers.find(p => p.id === 'globex-voice');
  assert.ok(entry, 'lock must record globex-voice');
  assert.equal(entry.verified, false, 'synthesized pack must be unverified');
  assert.equal(entry.source, 'synthesized');
});

test('recipe contains a prominent UNVERIFIED warning section for synthesized providers', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  assert.equal(result.exitCode, 0);
  const recipe = readFileSync(join(result.outDir, 'callsmith.recipe.md'), 'utf8');
  assert.match(recipe, /UNVERIFIED PROVIDERS?/i, 'must have a prominent UNVERIFIED header');
  assert.match(recipe, /validate.*before shipping/i, 'must instruct validation before shipping');
});

test('synthesized pack pothole appears in recipe blockers', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  assert.equal(result.exitCode, 0);
  const recipe = readFileSync(join(result.outDir, 'callsmith.recipe.md'), 'utf8');
  assert.match(recipe, /BLOCKER.*globex-voice|globex-voice.*BLOCKER/i,
    'synthesized pack blocker pothole must surface');
});

// ---- Determinism ----

test('synthesized provider produces byte-identical lock across runs', () => {
  const r1 = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  const r2 = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1' } },
  );
  const l1 = readFileSync(join(r1.outDir, 'callsmith.lock.json'), 'utf8');
  const l2 = readFileSync(join(r2.outDir, 'callsmith.lock.json'), 'utf8');
  assert.equal(l1, l2, 'locks must be byte-identical for same synthesized provider');
});

// ---- check also resolves ----

test('check resolves unknown providers instead of refusing', () => {
  const result = runCli(
    ['check', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY_SKIP: '1', CALLSMITH_CHECK_NO_EXIT_1: '1' } },
  );
  assert.equal(result.exitCode, 0, 'check must succeed when synthesis resolves the provider');
  assert.match(result.stdout, /globex-voice/i, 'synthesized provider must appear in matrix');
  assert.match(result.stdout, /UNVERIFIED/i, 'check output must warn about unverified provider');
});

// ---- Registry miss still synthesizes (no crash on 404) ----

test('registry miss falls through to synthesis without crashing', () => {
  const result = runCli(
    ['forge', '--answers', fixturePath('synthesis-fallback.answers.json')],
    { env: { CALLSMITH_REGISTRY: REGISTRY_DIR } },
  );
  assert.equal(result.exitCode, 0, 'forge must succeed via synthesis fallback');
  const lock = JSON.parse(readFileSync(join(result.outDir, 'callsmith.lock.json'), 'utf8'));
  const entry = lock.resolved_providers.find(p => p.id === 'globex-voice');
  assert.equal(entry.source, 'synthesized', 'must fall through to synthesis when registry misses');
});

// ---- Known providers are unaffected (no resolved_providers entry) ----

test('forge with all-known providers has empty resolved_providers', () => {
  const answers = writeAnswers({ ...BASE, telephony: 'exotel' });
  const result = runCli(['forge', '--answers', answers]);
  assert.equal(result.exitCode, 0);
  const lock = JSON.parse(readFileSync(join(result.outDir, 'callsmith.lock.json'), 'utf8'));
  assert.deepEqual(lock.resolved_providers || [], [], 'no resolved providers when all are known');
});
