import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(ROOT, 'install-callsmith.sh');
const MANAGED_PATHS = [
  'bin',
  'src',
  'data',
  'providers',
  'reference',
  'examples',
  'package.json',
  'SKILL.md',
  'product_decisions.md',
  'product.md',
  'subtraction.md',
];

function makeArchive(temp, { complete = true } = {}) {
  const archiveRoot = path.join(temp, 'Callsmith_skills-main');
  fs.mkdirSync(archiveRoot, { recursive: true });
  const paths = complete ? MANAGED_PATHS : ['package.json'];
  for (const entry of paths) {
    fs.cpSync(path.join(ROOT, entry), path.join(archiveRoot, entry), { recursive: true });
  }
  const archive = path.join(temp, complete ? 'complete.tgz' : 'incomplete.tgz');
  const packed = spawnSync('tar', ['-czf', archive, path.basename(archiveRoot)], {
    cwd: temp,
    encoding: 'utf8',
  });
  assert.equal(packed.status, 0, packed.stderr);
  return archive;
}

function runManualInstaller(temp, archive) {
  const home = path.join(temp, 'home');
  const install = path.join(temp, 'install');
  const bin = path.join(temp, 'custom-bin');
  fs.mkdirSync(home, { recursive: true });
  const result = spawnSync('bash', [INSTALLER], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      CALLSMITH_HOME: install,
      CALLSMITH_BIN: bin,
      CALLSMITH_INSTALL_METHOD: 'manual',
      CALLSMITH_ARCHIVE: archive,
    },
    timeout: 30_000,
  });
  return { result, home, install, bin };
}

describe('manual installer', () => {
  it('discovers a GitHub-shaped archive, validates staging, and replaces only managed content', { timeout: 30_000 }, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-installer-'));
    try {
      const archive = makeArchive(temp);
      const install = path.join(temp, 'install');
      fs.mkdirSync(path.join(install, 'src', 'lib'), { recursive: true });
      fs.mkdirSync(path.join(install, 'data'), { recursive: true });
      fs.mkdirSync(path.join(install, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(install, 'src', 'lib', 'scaffold.mjs'), 'stale generation engine\n');
      fs.writeFileSync(path.join(install, 'data', 'presets.json'), '{}\n');
      fs.writeFileSync(path.join(install, 'bin', 'legacy-generator'), 'stale\n');
      fs.writeFileSync(path.join(install, 'user-notes.txt'), 'preserve me\n');

      const outcome = runManualInstaller(temp, archive);
      const output = `${outcome.result.stdout}\n${outcome.result.stderr}`;
      assert.equal(outcome.result.status, 0, output);

      const wrapper = path.join(outcome.bin, 'callsmith');
      assert.ok(fs.existsSync(wrapper), 'CALLSMITH_BIN wrapper missing');
      assert.notEqual(fs.statSync(wrapper).mode & 0o111, 0, 'wrapper is not executable');
      assert.ok(fs.existsSync(path.join(outcome.install, 'reference', 'latency.md')));
      assert.ok(fs.existsSync(path.join(outcome.install, 'examples', 'clinic-triage', 'callsmith.recipe.md')));
      assert.ok(fs.existsSync(path.join(outcome.install, 'user-notes.txt')), 'unmanaged user file was removed');
      assert.equal(fs.existsSync(path.join(outcome.install, 'src', 'lib', 'scaffold.mjs')), false);
      assert.equal(fs.existsSync(path.join(outcome.install, 'data', 'presets.json')), false);
      assert.equal(fs.existsSync(path.join(outcome.install, 'bin', 'legacy-generator')), false);

      const doctor = spawnSync(wrapper, ['doctor'], { encoding: 'utf8' });
      assert.equal(doctor.status, 0, doctor.stderr + doctor.stdout);
      assert.match(doctor.stdout, /status: OK/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('does not modify an existing installation when the archive is incomplete', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-installer-bad-'));
    try {
      const archive = makeArchive(temp, { complete: false });
      const marker = path.join(temp, 'install', 'src', 'lib', 'existing.mjs');
      fs.mkdirSync(path.dirname(marker), { recursive: true });
      fs.writeFileSync(marker, 'existing installation\n');

      const outcome = runManualInstaller(temp, archive);
      assert.notEqual(outcome.result.status, 0);
      assert.match(outcome.result.stderr, /archive is incomplete: missing bin/i);
      assert.equal(fs.readFileSync(marker, 'utf8'), 'existing installation\n');
      assert.equal(fs.existsSync(path.join(outcome.bin, 'callsmith')), false);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
