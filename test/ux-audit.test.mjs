// UX-audit regression tests: covers help exit codes, simulate tool events,
// audio-contract mitigation (no contradictions), overwrite protection,
// init presets, explain, Makefile/.env polish, and safe-write unit tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, forge, fixturePath } from './helpers/cli.mjs';
import { scaffold } from '../src/lib/scaffold.mjs';
import { compile } from '../src/lib/compile.mjs';
import { loadProviders } from '../src/lib/resolver.mjs';
import { createSafeWriter } from '../src/lib/safe-write.mjs';

// ── Fix #5: help / exit codes ────────────────────────────────────────

test('--help exits 0', () => {
  const r = runCli(['--help'], { out: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage:/);
});

test('help subcommand exits 0', () => {
  const r = runCli(['help'], { out: false });
  assert.equal(r.exitCode, 0);
});

test('no-arg exits 0 and prints help', () => {
  const r = runCli([], { out: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Usage:/);
});

test('unknown command exits 1', () => {
  const r = runCli(['bogus'], { out: false });
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /unknown command/);
});

// ── Fix #2: simulate tool events in realtime mode ────────────────────

test('simulate passes on the default realtime template (tool events emitted)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-sim-'));
  const file = join(dir, 'voice.answers.json');
  runCli(['spec', '--answers', file], { out: false });
  // scaffold into the same dir so --scaffold check passes
  runCli(['scaffold', '--answers', file, '--out', dir], { out: false });
  const r = runCli(['simulate', '--answers', file, '--out', dir, '--scaffold', dir], { out: false });
  assert.equal(r.exitCode, 0, 'simulate must pass on default template. stderr: ' + r.stderr);
  assert.match(r.stdout, /PASS/);
});

test('simulate failure message explains missing tool events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-sim-msg-'));
  const file = join(dir, 'voice.answers.json');
  runCli(['spec', '--answers', file], { out: false });
  // do NOT scaffold -> scaffold check fails with a helpful message
  const r = runCli(['simulate', '--answers', file, '--out', dir, '--scaffold', dir], { out: false });
  assert.notEqual(r.exitCode, 0);
  assert.match(r.stderr + r.stdout, /callsmith scaffold/);
});

// ── Fix #3: audio-contract mitigation (no contradiction) ─────────────

test('LiveKit+Gemini: no "Build two independent resamplers" in audio contract', () => {
  const f = forge('exotel-gemini.answers.json');
  const audioContract = f.file('.callsmith/context/audio-contract.md');
  assert.doesNotMatch(audioContract, /Build two independent resamplers/,
    'LiveKit normalizes audio; the asymmetric-rate note must NOT tell the user to build resamplers');
});

test('LiveKit+Gemini: potholes.md separates mitigated concerns', () => {
  const f = forge('exotel-gemini.answers.json');
  const potholes = f.file('.callsmith/context/potholes.md');
  assert.match(potholes, /Mitigated by native layer/, 'must have a mitigation section');
  assert.match(potholes, /mitigated by LiveKit/);
  // The blocker-level audio transcoding potholes must NOT appear in the active blocker section
  const blockerSection = potholes.split('## warning')[0];
  assert.doesNotMatch(blockerSection, /mandatory before any model/,
    'mitigated transcoding potholes must not appear as active blockers');
});

test('LiveKit+Gemini: result.potholes marks mitigated entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-mit-'));
  const providers = loadProviders();
  const compiled = compile(
    JSON.parse(readFileSync(fixturePath('exotel-gemini.answers.json'), 'utf8')),
    dir,
    { providers },
  );
  const mitigated = compiled.result.potholes.filter(p => p.mitigated);
  assert.ok(mitigated.length >= 3, 'at least 3 potholes should be mitigated by LiveKit normalization; got ' + mitigated.length);
  for (const p of mitigated) {
    assert.equal(p.mitigatedBy, 'LiveKit (Agents framework + SIP trunk)');
  }
  const active = compiled.result.potholes.filter(p => !p.mitigated);
  assert.ok(active.some(p => p.severity === 'blocker'), 'interruption-flush blocker should remain active');
});

test('custom-fastapi bridge: transcoding blockers still appear (no false mitigation)', () => {
  const f = forge('exotel-custom-gemini.answers.json');
  const audioContract = f.file('.callsmith/context/audio-contract.md');
  assert.match(audioContract, /Required transforms/, 'custom bridge must still require transforms');
  const potholes = f.file('.callsmith/context/potholes.md');
  // Without a native normalizer, the blocker potholes must remain active
  assert.match(potholes.split('## Mitigated')[0], /mandatory before any model|decode and resample/i);
});

// ── Fix #4: overwrite protection ─────────────────────────────────────

test('scaffold refuses to overwrite existing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-ow-'));
  const file = fixturePath('exotel-gemini.answers.json');
  // pre-create a README.md that should not be clobbered
  writeFileSync(join(dir, 'README.md'), 'MY PRECIOUS README');
  const r = runCli(['scaffold', '--answers', file, '--out', dir], { out: false });
  assert.equal(r.exitCode, 1, 'must refuse to overwrite');
  assert.match(r.stderr, /README.md/);
  assert.equal(readFileSync(join(dir, 'README.md'), 'utf8'), 'MY PRECIOUS README',
    'original file must be untouched');
});

test('scaffold --force overwrites existing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-owf-'));
  const file = fixturePath('exotel-gemini.answers.json');
  writeFileSync(join(dir, 'README.md'), 'OLD');
  const r = runCli(['scaffold', '--answers', file, '--out', dir, '--force'], { out: false });
  assert.equal(r.exitCode, 0, '--force must succeed');
  const content = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.notEqual(content, 'OLD', 'file must be overwritten');
});

test('scaffold --dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-dr-'));
  const file = fixturePath('exotel-gemini.answers.json');
  const r = runCli(['scaffold', '--answers', file, '--out', dir, '--dry-run'], { out: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /would write/);
  assert.equal(existsSync(join(dir, 'README.md')), false, 'dry-run must not write files');
});

// ── Fix #6: init presets + explain ───────────────────────────────────

test('init lists presets', () => {
  const r = runCli(['init'], { out: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /india-support/);
  assert.match(r.stdout, /cheap-cascaded/);
});

test('init --preset writes a forgeable answers file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-init-'));
  const file = join(dir, 'a.json');
  const r = runCli(['init', '--preset', 'global-support', '--answers', file], { out: false });
  assert.equal(r.exitCode, 0);
  assert.equal(existsSync(file), true);
  // it must forge cleanly
  const forgeResult = runCli(['forge', '--answers', file], { out: true });
  assert.equal(forgeResult.exitCode, 0, 'preset answers must forge. stderr: ' + forgeResult.stderr);
});

test('init --preset rejects unknown preset', () => {
  const r = runCli(['init', '--preset', 'nope'], { out: false });
  assert.equal(r.exitCode, 1);
  assert.match(r.stderr, /unknown preset/);
});

test('explain prints a stack summary without writing files', () => {
  const r = runCli(['explain', '--answers', fixturePath('exotel-gemini.answers.json')], { out: false });
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /Exotel/);
  assert.match(r.stdout, /Latency:/);
  assert.match(r.stdout, /Cost:/);
  assert.match(r.stdout, /mitigated by native layer/);
});

// ── Fix #9: scaffold polish (Makefile + .env.example) ────────────────

test('scaffold writes a Makefile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-mf-'));
  scaffold({}, dir, {}); // {} answers use all defaults
  assert.equal(existsSync(join(dir, 'Makefile')), true, 'Makefile must be generated');
  const make = readFileSync(join(dir, 'Makefile'), 'utf8');
  assert.match(make, /^test:/m);
  assert.match(make, /pytest/);
  assert.match(make, /^simulate:/m);
});

test('forge .env.example includes dashboard links', () => {
  const f = forge('exotel-gemini.answers.json');
  const env = f.file('.env.example');
  assert.match(env, /Get this from: https:\/\/my.exotel.com/);
  assert.match(env, /LIVEKIT_URL=/);
});

// ── safe-write unit tests ────────────────────────────────────────────

test('safe-writer records collisions and skips without force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-sw-'));
  writeFileSync(join(dir, 'existing.txt'), 'OLD');
  const w = createSafeWriter(dir, { force: false });
  w.w('existing.txt', 'NEW');
  w.w('fresh.txt', 'FRESH');
  assert.deepEqual(w.collisions, ['existing.txt']);
  assert.deepEqual(w.manifest, ['fresh.txt']);
  assert.equal(readFileSync(join(dir, 'existing.txt'), 'utf8'), 'OLD');
  assert.equal(readFileSync(join(dir, 'fresh.txt'), 'utf8'), 'FRESH');
});

test('safe-writer overwrites with force', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-swf-'));
  writeFileSync(join(dir, 'x.txt'), 'OLD');
  const w = createSafeWriter(dir, { force: true });
  w.w('x.txt', 'NEW');
  assert.deepEqual(w.collisions, []);
  assert.deepEqual(w.overwritten, ['x.txt']);
  assert.equal(readFileSync(join(dir, 'x.txt'), 'utf8'), 'NEW');
});

test('safe-writer dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-swd-'));
  const w = createSafeWriter(dir, { dryRun: true });
  w.w('a.txt', 'A');
  assert.deepEqual(w.manifest, ['a.txt']);
  assert.equal(existsSync(join(dir, 'a.txt')), false);
  assert.equal(w.summary.dryRun, true);
});
