import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, fixturePath, writeAnswers } from './helpers/cli.mjs';

const hasPython = (() => {
  try { execSync('python3 --version', { stdio: 'pipe' }); return true; } catch { return false; }
})();

function scaffoldAndPytest(fixtureName) {
  const result = runCli(['scaffold', '--answers', fixturePath(fixtureName)]);
  const dir = result.outDir;
  execSync('pip3 install -q -r requirements-test.txt 2>&1', { cwd: dir, stdio: 'pipe' });
  return execSync('python3 -m pytest tests/ -q 2>&1', { cwd: dir, encoding: 'utf8', stdio: 'pipe' });
}

// B21/B23 — scaffolded repos pass their own tests
test('golden-path scaffold (LiveKit passthrough) passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('exotel-gemini.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('Pipecat cascaded scaffold passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('custom-bridge scaffold (4-transform) passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('exotel-custom-gemini.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('cascaded scaffold with Cartesia TTS passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('grid/50-twilio-pipecat-deepgram-cartesia.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('LiveKit scaffold generates agent.py with AgentSession', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  scaffoldAndPytest('exotel-gemini.answers.json');
  // Re-run scaffold to get the files
  const result = runCli(['scaffold', '--answers', fixturePath('exotel-gemini.answers.json')]);
  const agent = readFileSync(join(result.outDir, 'agent.py'), 'utf8');
  assert.match(agent, /AgentSession/, 'must use AgentSession');
  assert.match(agent, /TurnHandlingOptions/, 'must configure turn handling');
  assert.match(agent, /silero\.VAD\.load/, 'must load Silero VAD');
});

test('scaffold documents a fast uv-first install path', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('exotel-gemini.answers.json')]);
  const installer = readFileSync(join(result.outDir, 'install.sh'), 'utf8');
  const readme = readFileSync(join(result.outDir, 'README.md'), 'utf8');
  const dockerfile = readFileSync(join(result.outDir, 'Dockerfile'), 'utf8');
  const pytestIni = readFileSync(join(result.outDir, 'pytest.ini'), 'utf8');

  assert.match(installer, /uv venv/, 'install.sh should use uv when available');
  assert.match(installer, /UV_CACHE_DIR/, 'install.sh should keep uv cache configurable');
  assert.match(installer, /requirements-test\.txt/, 'install.sh should support fast test deps');
  assert.match(installer, /requirements\.txt/, 'install.sh should support full runtime deps');
  assert.match(readme, /bash install\.sh test/, 'README should make fast validation the default path');
  assert.match(readme, /bash install\.sh full/, 'README should make full SDK install explicit');
  assert.match(dockerfile, /uv pip install --system/, 'Dockerfile should use uv for faster dependency install');
  assert.match(pytestIni, /pythonpath = \./, 'pytest should import generated top-level modules from a fresh venv');
});

test('Pipecat scaffold generates bot.py with Pipeline', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  scaffoldAndPytest('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json');
  const result = runCli(['scaffold', '--answers', fixturePath('grid/03-twilio-pipecat-deepgram-elevenlabs.answers.json')]);
  const bot = readFileSync(join(result.outDir, 'bot.py'), 'utf8');
  assert.match(bot, /Pipeline\(/, 'must construct Pipeline');
  assert.match(bot, /DeepgramSTTService/, 'must use DeepgramSTTService');
  assert.match(bot, /OpenAILLMService/, 'must use OpenAILLMService');
  assert.match(bot, /ElevenLabsTTSService/, 'must use ElevenLabsTTSService');
  assert.match(bot, /TwilioFrameSerializer/, 'must use TwilioFrameSerializer');
  assert.match(bot, /SileroVADAnalyzer/, 'must use SileroVADAnalyzer');
});

test('custom bridge emits direction-specific resample rates', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('grid/96-vonage-custom-gemini.answers.json')]);
  const bridge = readFileSync(join(result.outDir, 'audio', 'bridge.py'), 'utf8');
  assert.doesNotMatch(bridge, /resampler\.resample\(audio, 8000, 16000\)/,
    'Vonage already sends 16k PCM inbound, so inbound must not be resampled from 8k');
  assert.match(bridge, /resampler\.resample\(audio, 24000, 16000\)/,
    'Gemini 24k output must be resampled to Vonage 16k PCM');
  assert.doesNotMatch(bridge, /pcm_to_mulaw_bytes/,
    'Vonage PCM output must not be encoded to mulaw');
});

test('custom bridge resamples outbound PCM before mulaw encoding', () => {
  const result = runCli(['scaffold', '--answers', fixturePath('exotel-custom-gemini.answers.json')]);
  const bridge = readFileSync(join(result.outDir, 'audio', 'bridge.py'), 'utf8');
  const outboundResample = bridge.indexOf('resampler.resample(audio, 24000, 8000)');
  const encode = bridge.indexOf('pcm_to_mulaw_bytes(audio)');
  assert.ok(outboundResample > -1, 'must resample Gemini 24k output to 8k first');
  assert.ok(encode > outboundResample, 'must encode to mulaw after resampling');
});

test('mulaw-native TTS does not skip PCM telephony transforms', () => {
  const answers = writeAnswers({
    surface: 'inbound_pstn',
    architecture: 'cascaded',
    telephony: 'vonage',
    orchestration: 'custom_fastapi',
    stt: 'deepgram',
    llm: 'gpt_4o',
    tts: 'cartesia',
    vad: 'silero',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'webhook',
    deployment: 'railway',
  });
  const result = runCli(['scaffold', '--answers', answers]);
  const bridge = readFileSync(join(result.outDir, 'audio', 'bridge.py'), 'utf8');
  assert.match(bridge, /resampler\.resample\(audio, 24000, 16000\)/,
    'Cartesia 24k PCM must be resampled to Vonage 16k PCM');
  assert.doesNotMatch(bridge, /pcm_to_mulaw_bytes/,
    'Vonage PCM output must not use Cartesia mulaw shortcut');
});
