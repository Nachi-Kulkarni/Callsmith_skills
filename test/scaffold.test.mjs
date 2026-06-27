import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCli, fixturePath } from './helpers/cli.mjs';

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
