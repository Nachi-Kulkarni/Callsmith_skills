import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './helpers/cli.mjs';

const GRID_DIR = fileURLToPath(new URL('./fixtures/grid/', import.meta.url));

const gridFixtures = readdirSync(GRID_DIR)
  .filter(f => f.endsWith('.answers.json'))
  .sort();

// B2/B26-B32 — every grid fixture forges a valid recipe + lock
for (const f of gridFixtures) {
  const name = basename(f).replace('.answers.json', '');
  const fixturePath = join(GRID_DIR, f);

  test(`grid "${name}" forges successfully`, () => {
    const result = runCli(['forge', '--answers', fixturePath]);
    assert.equal(result.exitCode, 0,
      `forge failed for ${name}:\n${result.stderr || result.stdout}`);
    assert.ok(existsSync(join(result.outDir, 'callsmith.recipe.md')),
      `${name} must produce a recipe`);
    assert.ok(existsSync(join(result.outDir, 'callsmith.lock.json')),
      `${name} must produce a lock`);
  });
}
