import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
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

test('custom-bridge scaffold (4-transform) passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('exotel-custom-gemini.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('cascaded scaffold with Cartesia TTS passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('grid/50-twilio-pipecat-deepgram-cartesia.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});

test('cascaded scaffold with Sarvam TTS passes pytest', { skip: !hasPython ? 'python3 not available' : undefined }, () => {
  const output = scaffoldAndPytest('grid/50-twilio-pipecat-deepgram-sarvam.answers.json');
  assert.match(output, /passed/i, 'scaffolded tests must pass:\n' + output);
});
