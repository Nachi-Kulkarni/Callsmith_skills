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

test('unknown command exits non-zero', () => {
  const result = runCli(['froge'], { out: false });
  assert.notEqual(result.exitCode, 0, 'unknown command must not exit 0');
});
