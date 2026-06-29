import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, fixturePath, BIN_PATH } from './helpers/cli.mjs';

test('spec template exposes operational profile, safety, and handoff levers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cs-spec-'));
  const file = join(dir, 'answers.json');
  execFileSync('node', [BIN_PATH, 'spec', '--answers', file], { encoding: 'utf8', stdio: 'pipe' });
  const answers = JSON.parse(readFileSync(file, 'utf8'));
  // The 8 voice-UX knobs collapse into one operational_profile preset.
  for (const key of [
    'hosting_model',
    'operational_profile',
    'audio_enhancement',
    'debug_profile',
    'human_handoff',
    'recording_consent',
    'transcript_retention',
  ]) {
    assert.ok(Object.hasOwn(answers, key), `template missing ${key}`);
  }
  // Forging the default template still resolves the full UX/safety values via the preset.
  const forged = runCli(['forge', '--answers', file]);
  assert.equal(forged.exitCode, 0, forged.stderr);
  const lock = JSON.parse(readFileSync(join(forged.outDir, 'callsmith.lock.json'), 'utf8'));
  assert.equal(lock.voice_ux.endpointing, 'balanced');
  assert.equal(lock.voice_ux.endpointing_ms, 600);
  assert.equal(lock.voice_ux.voice_profile, 'warm');
  assert.equal(lock.voice_ux.echo_cancellation, 'provider_native');
  assert.equal(lock.operations.effective_hosting_model, 'managed_cloud');
  assert.equal(lock.operations.debug_profile, 'production_trace');
  assert.equal(lock.safety.recording_consent, 'announce');
});

test('forge writes operational context files and lock policy', () => {
  const result = runCli(['forge', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.equal(result.exitCode, 0, result.stderr);
  const lock = JSON.parse(readFileSync(join(result.outDir, 'callsmith.lock.json'), 'utf8'));
  assert.equal(lock.voice_ux.endpointing, 'balanced');
  assert.equal(lock.operations.effective_hosting_model, 'hybrid_worker');
  assert.equal(lock.operations.audio_enhancement, 'provider_native');
  assert.equal(lock.safety.recording_consent, 'announce');
  assert.equal(lock.handoff, 'ticket');
  for (const file of [
    '.callsmith/context/operations.md',
    '.callsmith/context/voice-ux.md',
    '.callsmith/context/tool-calling.md',
    '.callsmith/context/observability.md',
    '.callsmith/context/safety-compliance.md',
    '.callsmith/context/handoff.md',
    '.callsmith/context/local-testing.md',
    '.callsmith/context/simulation.md',
  ]) {
    assert.ok(existsSync(join(result.outDir, file)), `missing ${file}`);
  }
});

test('scaffold generates operational modules and wires observers/tools', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json')]);
  assert.equal(result.exitCode, 0, result.stderr);
  for (const file of [
    'observability.py',
    'operations.py',
    'tools.py',
    'voice_ux.py',
    'safety.py',
    'handoff.py',
    'local_test.py',
    'simulate_call.py',
    'tests/test_operational_modules.py',
  ]) {
    assert.ok(existsSync(join(result.outDir, file)), `missing ${file}`);
  }
  const bot = readFileSync(join(result.outDir, 'bot.py'), 'utf8');
  assert.match(bot, /PipelineWorker/, 'Pipecat scaffold must use PipelineWorker');
  assert.match(bot, /PipecatTraceObserver/, 'Pipecat scaffold must attach trace observer');
  assert.match(bot, /get_operations_config/, 'Pipecat scaffold must load operations contract');
  assert.match(bot, /build_default_registry/, 'Pipecat scaffold must wire tool registry');
});

test('simulate command emits fake call report and validates scaffold when provided', () => {
  const scaffolded = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.equal(scaffolded.exitCode, 0, scaffolded.stderr);
  const sim = runCli([
    'simulate',
    '--answers', fixturePath('twilio-cascaded.answers.json'),
    '--scaffold', scaffolded.outDir,
  ]);
  assert.equal(sim.exitCode, 0, sim.stderr);
  const report = JSON.parse(readFileSync(join(sim.outDir, '.callsmith/simulation/report.json'), 'utf8'));
  assert.equal(report.status, 'PASS');
  assert.ok(report.events.some(e => e.event === 'tool_started'), 'tool event should be simulated');
  assert.ok(report.events.some(e => e.event === 'dtmf'), 'DTMF event should be simulated');
  assert.ok(report.events.some(e => e.event === 'reconnect_started'), 'reconnect event should be simulated');
});

test('verify-packs command reports pack freshness checks without failures', () => {
  const result = runCli(['verify-packs', '--json'], { out: false });
  assert.equal(result.exitCode, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(['PASS', 'WARN'].includes(report.status));
  assert.equal(report.failures.length, 0);
  assert.ok(report.counts.packs > 0);
  assert.ok(report.counts.checks > report.counts.packs);
});
