import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../../bin/callsmith.mjs', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export function forge(fixtureName, opts = {}) {
  const out = mkdtempSync(join(tmpdir(), 'cs-test-'));
  const fixture = join(FIXTURES, fixtureName);
  try {
    execFileSync('node', [BIN, 'forge', '--answers', fixture, '--out', out], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (e) {
    e.outDir = out;
    e.stdout = e.stdout?.toString() ?? '';
    e.stderr = e.stderr?.toString() ?? '';
    throw e;
  }
  const lockRaw = readFileSync(join(out, 'callsmith.lock.json'), 'utf8');
  return {
    outDir: out,
    recipeRaw: readFileSync(join(out, 'callsmith.recipe.md'), 'utf8'),
    lockRaw,
    lock: JSON.parse(lockRaw),
    file: (name) => readFileSync(join(out, name), 'utf8'),
    hasFile: (name) => existsSync(join(out, name)),
  };
}

export function runCli(args, opts = {}) {
  const out = mkdtempSync(join(tmpdir(), 'cs-test-'));
  const fullArgs = [BIN, ...args];
  if (opts.out !== false) fullArgs.push('--out', out);
  try {
    const stdout = execFileSync('node', fullArgs, { encoding: 'utf8', stdio: 'pipe' });
    return { exitCode: 0, stdout, stderr: '', outDir: out };
  } catch (e) {
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      outDir: out,
    };
  }
}

export const BIN_PATH = BIN;

export function fixturePath(name) {
  return join(FIXTURES, name);
}

export function writeAnswers(answers) {
  const dir = mkdtempSync(join(tmpdir(), 'cs-answers-'));
  const file = join(dir, 'answers.json');
  writeFileSync(file, JSON.stringify(answers, null, 2));
  return file;
}
