import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as callsmith from '../src/lib/index.mjs';

test('package entry point exports public library APIs', () => {
  for (const name of [
    'compile',
    'scaffold',
    'hydrate',
    'loadMenu',
    'loadProviders',
    'expandAnswers',
    'resolve',
    'resolveOperationsConfig',
    'detectImpossibilities',
    'validatePacks',
    'simulate',
    'verifyPacks',
    'runReleaseCheck',
  ]) {
    assert.equal(typeof callsmith[name], 'function', `${name} must be exported`);
  }
});

test('package metadata is publishable under the scoped CLI name', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.name, '@callsmith/cli');
  assert.equal(pkg.bin.callsmith, 'bin/callsmith.mjs');
  assert.equal(pkg.publishConfig.access, 'public');
  assert.ok(pkg.files.includes('SKILL.md'), 'npm package should include the agent skill');
  assert.ok(pkg.files.includes('scripts'), 'npm package should include release QA scripts');
});

test('npm pack dry-run includes CLI, library, packs, and skill files', () => {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    encoding: 'utf8',
    stdio: 'pipe',
    env: {
      ...process.env,
      npm_config_cache: mkdtempSync(join(tmpdir(), 'callsmith-npm-cache-')),
    },
  });
  const pack = JSON.parse(raw)[0];
  const files = new Set(pack.files.map(f => f.path));
  for (const file of [
    'package.json',
    'README.md',
    'LICENSE',
    'SKILL.md',
    'bin/callsmith.mjs',
    'src/lib/index.mjs',
    'src/lib/release-check.mjs',
    'scripts/release-qa.mjs',
    'data/menu.json',
    'providers/_schema.json',
  ]) {
    assert.ok(files.has(file), `npm package missing ${file}`);
  }
});
