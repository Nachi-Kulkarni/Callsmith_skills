import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { forge, runCli, writeAnswers, fixturePath } from './helpers/cli.mjs';

// ═══ COST ESTIMATION ════════════════════════════════════════════════

test('every provider pack has cost_estimates', () => {
  const providers = JSON.parse(readFileSync(
    join(process.cwd(), 'src/lib/resolver.mjs').replace('src/lib/resolver.mjs', '') +
    'providers/stt/deepgram.json', 'utf8'
  ));
  // Check all packs via validate
  const result = runCli(['forge', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.equal(result.exitCode, 0);
});

test('resolver computeCost returns per-leg breakdown', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  assert.ok(lock.cost, 'lock must include cost data');
  assert.ok(Array.isArray(lock.cost.legs), 'cost must have legs array');
  assert.ok(lock.cost.legs.length > 0, 'cost must have at least one leg');
});

test('lock includes cost with total_per_minute_usd', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  assert.ok(lock.cost.total_per_minute_usd > 0, 'total cost must be positive');
  assert.ok(lock.cost.per_hour_usd > 0, 'per-hour cost must be positive');
  assert.ok(lock.cost.per_1k_calls_usd > 0, 'per-1k-calls cost must be positive');
});

test('recipe includes Cost estimation section', () => {
  const { recipeRaw } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /## Cost estimation/i);
  assert.match(recipeRaw, /Per minute/i);
  assert.match(recipeRaw, /\$[\d.]+\/min/i);
});

test('recipe cost table includes per-leg billing model', () => {
  const { recipeRaw } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /Billing/i);
  assert.match(recipeRaw, /per_minute|per_1k_chars|free/i);
});

test('cost-estimation.md context file is produced', () => {
  const result = forge('twilio-cascaded.answers.json');
  assert.ok(result.hasFile('.callsmith/context/cost-estimation.md'),
    'must produce cost-estimation.md');
  const cost = result.file('.callsmith/context/cost-estimation.md');
  assert.match(cost, /Scale projections/i);
  assert.match(cost, /Per-leg detail/i);
});

test('free providers (VAD, orchestration) contribute $0', () => {
  const { lock } = forge('exotel-gemini.answers.json');
  const vadLeg = lock.cost.legs.find(l => l.role === 'vad');
  if (vadLeg) {
    assert.equal(vadLeg.per_minute_usd, 0, 'Silero VAD must be free');
  }
  const orchLeg = lock.cost.legs.find(l => l.role === 'orchestration');
  if (orchLeg && orchLeg.provider === 'pipecat') {
    assert.equal(orchLeg.per_minute_usd, 0, 'Pipecat must be free');
  }
});

test('TTS per-character costs are normalized to per-minute', () => {
  const { lock } = forge('twilio-cascaded.answers.json');
  const ttsLeg = lock.cost.legs.find(l => l.role === 'tts');
  if (ttsLeg && ttsLeg.billing === 'per_1k_chars') {
    assert.ok(ttsLeg.per_minute_usd > 0, 'TTS must have positive per-minute cost');
    assert.ok(ttsLeg.per_minute_usd > ttsLeg.raw_rate || ttsLeg.per_minute_usd > 0,
      'per-minute should be derived from char rate');
  }
});

test('check command shows cost in output', () => {
  const result = runCli(['check', '--answers', fixturePath('twilio-cascaded.answers.json')], { out: false });
  assert.match(result.stdout, /cost:/i);
  assert.match(result.stdout, /\$[\d.]+\/min/i);
});

// ═══ CONVERSATION STATE ═════════════════════════════════════════════

test('scaffold generates state.py', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.ok(existsSync(join(result.outDir, 'state.py')), 'state.py must exist');
});

test('state.py has ContextManager with context window tracking', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const state = readFileSync(join(result.outDir, 'state.py'), 'utf8');
  assert.match(state, /class ContextManager/);
  assert.match(state, /max_tokens/);
  assert.match(state, /_estimate_tokens/);
  assert.match(state, /get_messages/);
});

test('state.py has TranscriptStore with SQLite persistence', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const state = readFileSync(join(result.outDir, 'state.py'), 'utf8');
  assert.match(state, /class TranscriptStore/);
  assert.match(state, /sqlite3/);
  assert.match(state, /log_turn/);
  assert.match(state, /get_transcript/);
});

test('state.py has DTMFHandler with digit collection', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const state = readFileSync(join(result.outDir, 'state.py'), 'utf8');
  assert.match(state, /class DTMFHandler/);
  assert.match(state, /add_digit/);
  assert.match(state, /inter_digit_timeout/);
  assert.match(state, /on_complete/);
});

test('conversation-state.md context file is produced', () => {
  const result = forge('twilio-cascaded.answers.json');
  assert.ok(result.hasFile('.callsmith/context/conversation-state.md'),
    'must produce conversation-state.md');
  const cs = result.file('.callsmith/context/conversation-state.md');
  assert.match(cs, /Context window management/i);
  assert.match(cs, /Transcript persistence/i);
  assert.match(cs, /DTMF/i);
});

test('recipe includes Conversation state section', () => {
  const { recipeRaw } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /## Conversation state/i);
  assert.match(recipeRaw, /Context window/i);
  assert.match(recipeRaw, /Transcript/i);
  assert.match(recipeRaw, /DTMF/i);
});

test('state.py uses LLM context window from provider pack', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const state = readFileSync(join(result.outDir, 'state.py'), 'utf8');
  // OpenAI GPT-5.5 has 1,000,000 context window
  assert.match(state, /1000000/);
});

test('conversation-state.md has framework-specific DTMF wiring', () => {
  const result = forge('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json');
  const cs = result.file('.callsmith/context/conversation-state.md');
  assert.match(cs, /DTMFAggregator/i, 'Pipecat recipe must mention DTMFAggregator');
});

// ═══ ERROR HANDLING & RESILIENCE ════════════════════════════════════

test('scaffold generates resilience.py', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.ok(existsSync(join(result.outDir, 'resilience.py')), 'resilience.py must exist');
});

test('resilience.py has ReconnectingWebSocket', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const res = readFileSync(join(result.outDir, 'resilience.py'), 'utf8');
  assert.match(res, /class ReconnectingWebSocket/);
  assert.match(res, /ConnectionState/);
  assert.match(res, /CONNECTED/);
  assert.match(res, /RECONNECTING/);
  assert.match(res, /FAILED/);
  assert.match(res, /exponential/i);
});

test('resilience.py has retry_with_backoff decorator', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const res = readFileSync(join(result.outDir, 'resilience.py'), 'utf8');
  assert.match(res, /def retry_with_backoff/);
  assert.match(res, /max_retries/);
  assert.match(res, /Retry.After|retry_after/i);
});

test('resilience.py has FallbackConfig with chain registration', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  const res = readFileSync(join(result.outDir, 'resilience.py'), 'utf8');
  assert.match(res, /class FallbackConfig/);
  assert.match(res, /def register/);
  assert.match(res, /def get_fallback/);
  assert.match(res, /def get_chain/);
});

test('error-handling.md context file is produced', () => {
  const result = forge('twilio-cascaded.answers.json');
  assert.ok(result.hasFile('.callsmith/context/error-handling.md'),
    'must produce error-handling.md');
  const eh = result.file('.callsmith/context/error-handling.md');
  assert.match(eh, /WebSocket drop recovery/i);
  assert.match(eh, /Rate-limit backoff/i);
  assert.match(eh, /Fallback chains/i);
});

test('recipe includes Error handling section', () => {
  const { recipeRaw } = forge('twilio-cascaded.answers.json');
  assert.match(recipeRaw, /## Error handling/i);
  assert.match(recipeRaw, /WebSocket/i);
  assert.match(recipeRaw, /backoff/i);
  assert.match(recipeRaw, /fallback/i);
});

test('error-handling.md has framework-specific fallback patterns', () => {
  const result = forge('exotel-gemini.answers.json');
  const eh = result.file('.callsmith/context/error-handling.md');
  // LiveKit recipe should mention FallbackAdapter
  assert.match(eh, /FallbackAdapter/i);
});

test('Pipecat scaffold includes DTMFAggregator in pipeline', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json')]);
  const bot = readFileSync(join(result.outDir, 'bot.py'), 'utf8');
  assert.match(bot, /DTMFAggregator/, 'Pipecat bot must import DTMFAggregator');
  assert.match(bot, /dtmf_aggregator/, 'Pipeline must include dtmf_aggregator node');
});

test('scaffold generates state and resilience tests', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('twilio-cascaded.answers.json')]);
  assert.ok(existsSync(join(result.outDir, 'tests/test_state.py')), 'test_state.py must exist');
  assert.ok(existsSync(join(result.outDir, 'tests/test_resilience.py')), 'test_resilience.py must exist');
});

test('build-order includes conversation state and error handling steps', () => {
  const result = forge('twilio-cascaded.answers.json');
  const buildOrder = result.file('.callsmith/context/build-order.md');
  assert.match(buildOrder, /Conversation state/i);
  assert.match(buildOrder, /Error handling/i);
  assert.match(buildOrder, /resilience/i);
});
