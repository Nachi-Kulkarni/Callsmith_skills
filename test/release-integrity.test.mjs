import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('release integrity', () => {
  it('ships every file referenced by the primary skill', () => {
    for (const file of [
      'SKILL.md',
      'reference/audit.md',
      'reference/critique.md',
      'reference/ttft.md',
      'reference/harden.md',
      'examples/clinic-triage/callsmith.recipe.md',
      'examples/clinic-triage/voice.answers.json',
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} missing`);
    }
  });

  it('keeps committed contracts visible to normal git staging', () => {
    const ignore = read('.gitignore');
    assert.doesNotMatch(ignore, /^callsmith\.recipe\.md$/m);
    assert.doesNotMatch(ignore, /^voice\.answers\.json$/m);
  });

  it('keeps public product documentation internally linked and aligned', () => {
    const docs = [
      'README.md',
      'product_decisions.md',
      'product.md',
      'subtraction.md',
      'evidence/README.md',
      'evidence/HONEST-NUMBERS.md',
      'evidence/diagnostics/README.md',
    ];
    for (const doc of docs) {
      const body = read(doc);
      for (const match of body.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]+)?\)/g)) {
        const target = path.resolve(ROOT, path.dirname(doc), match[1]);
        assert.ok(fs.existsSync(target), `${doc} links to missing ${match[1]}`);
      }
    }
    assert.doesNotMatch(read('product_decisions.md'), /minimal keyword shape/i);
    assert.match(read('reference/workflow.md'), /must not duplicate floors, provider facts, contract schemas/i);
  });

  it('manual installer copies the complete skill product', () => {
    const installer = read('install-callsmith.sh');
    for (const required of ['reference', 'examples', 'product_decisions.md']) {
      assert.match(installer, new RegExp(`\\n\\s+${required.replace('.', '\\.')}\\n`));
    }
    assert.doesNotMatch(installer, /cp\s+[^\n]*2>\/dev\/null/);
  });

  it('package scripts only advertise shipped product surfaces', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts['eval:opencode'], undefined);
    assert.equal(pkg.scripts['release:check'], undefined);
    assert.ok(pkg.files.includes('reference'));
    assert.ok(pkg.files.includes('examples'));
    assert.ok(pkg.files.includes('evidence'));
    assert.ok(pkg.files.includes('evals/csb/scripts'));
  });

  it('CI does not invoke deleted generation release checks', () => {
    const ci = read('.github/workflows/ci.yml');
    assert.doesNotMatch(ci, /release-check|scaffold tests|pip install/);
    assert.match(ci, /npm test/);
    assert.match(ci, /npm pack --dry-run/);
  });

  it('checkout entrypoints are executable', () => {
    for (const file of ['bin/callsmith.mjs', 'install-callsmith.sh']) {
      const mode = fs.statSync(path.join(ROOT, file)).mode;
      assert.notEqual(mode & 0o111, 0, `${file} is not executable`);
    }
  });

  it('exports the Git index, installs its packed artifact, and runs the complete verification journey', { timeout: 30_000 }, () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-release-'));
    try {
      const npmEnv = { ...process.env, npm_config_cache: path.join(temp, 'npm-cache') };
      const source = path.join(temp, 'index-export');
      fs.mkdirSync(source);
      const exported = spawnSync('git', ['checkout-index', '--all', `--prefix=${source}${path.sep}`], {
        cwd: ROOT,
        encoding: 'utf8',
      });
      assert.equal(exported.status, 0, exported.stderr || exported.stdout);
      for (const file of [
        'src/lib/contract.mjs',
        'reference/contract.md',
        'reference/latency.md',
        'evals/csb/latency/score.mjs',
        'evals/csb/scripts/build-evidence.mjs',
        'evidence/HONEST-NUMBERS.md',
        'examples/clinic-triage/callsmith.recipe.md',
      ]) {
        assert.ok(fs.existsSync(path.join(source, file)), `Git index export missing ${file}`);
      }
      const packed = spawnSync('npm', ['pack', '--json', '--pack-destination', temp], {
        cwd: source,
        encoding: 'utf8',
        env: npmEnv,
      });
      assert.equal(packed.status, 0, packed.stderr || packed.stdout);
      const [{ filename }] = JSON.parse(packed.stdout);
      const tarball = path.join(temp, filename);
      const prefix = path.join(temp, 'consumer');
      const installed = spawnSync('npm', ['install', '--ignore-scripts', '--prefix', prefix, tarball], {
        encoding: 'utf8',
        env: npmEnv,
      });
      assert.equal(installed.status, 0, installed.stderr || installed.stdout);

      const cli = path.join(prefix, 'node_modules', '.bin', 'callsmith');
      const pkgRoot = path.join(prefix, 'node_modules', '@callsmith', 'cli');
      for (const file of ['reference/contract.md', 'reference/workflow.md', 'examples/clinic-triage/callsmith.recipe.md']) {
        assert.ok(fs.existsSync(path.join(pkgRoot, file)), `packed install missing ${file}`);
      }

      const journeys = [
        ['doctor'],
        ['check', '--answers', path.join(pkgRoot, 'examples/clinic-triage/voice.answers.json')],
        ['contract', 'validate', '--file', path.join(pkgRoot, 'examples/clinic-triage/callsmith.recipe.md'), '--domain', 'medical'],
      ];
      for (const args of journeys) {
        const result = spawnSync(cli, args, { cwd: temp, encoding: 'utf8' });
        assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stderr}${result.stdout}`);
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
