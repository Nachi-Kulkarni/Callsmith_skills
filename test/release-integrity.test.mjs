import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const filesUnder = (directory) => fs.readdirSync(path.join(ROOT, directory), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.join(entry.parentPath.slice(path.join(ROOT, directory).length + 1), entry.name))
  .sort();

describe('release integrity', () => {
  it('ships every file referenced by the primary skill', () => {
    for (const file of [
      'SKILL.md',
      'reference/audit.md',
      'reference/critique.md',
      'reference/ttft.md',
      'reference/harden.md',
      'reference/deploy-capacity.md',
      'reference/deploy-workload.md',
      'reference/deploy-evidence.md',
      'examples/clinic-triage/callsmith.recipe.md',
      'examples/clinic-triage/voice.answers.json',
    ]) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} missing`);
    }
  });

  it('ships one lean, self-contained universal skill', () => {
    assert.equal(read('skills/callsmith/SKILL.md'), read('SKILL.md'));
    assert.equal(read('skills/callsmith/product_decisions.md'), read('product_decisions.md'));
    for (const directory of ['providers', 'reference', 'examples']) {
      const rootFiles = filesUnder(directory);
      assert.deepEqual(filesUnder(`skills/callsmith/${directory}`), rootFiles);
      for (const file of rootFiles) {
        assert.equal(read(`skills/callsmith/${directory}/${file}`), read(`${directory}/${file}`));
      }
    }
    assert.deepEqual(
      filesUnder('skills/callsmith').filter((file) => file.endsWith('.mjs')),
      [],
      'skill-only install must not include benchmark or CLI scripts',
    );
  });

  it('ships noise cancellation as a routed Callsmith reference', () => {
    assert.match(read('SKILL.md'), /`noise-cancellation`.*reference\/noise-cancellation\.md/);
    assert.equal(read('skills/callsmith/reference/noise-cancellation.md'), read('reference/noise-cancellation.md'));
    assert.match(read('reference/noise-cancellation.md'), /ca64b7d3638fc70f/);
  });

  it('keeps the public provider-pack count derived from the shipped library', () => {
    const count = filesUnder('providers').filter((file) => file.endsWith('.json') && file !== '_schema.json').length;
    assert.match(read('README.md'), new RegExp(`${count} voice providers`));
    assert.match(read('SKILL.md'), new RegExp(`Provider packs \\(${count}\\)`));
  });

  it('ships a root-native marketplace plugin with Context7', () => {
    const codex = JSON.parse(read('.codex-plugin/plugin.json'));
    const claude = JSON.parse(read('.claude-plugin/plugin.json'));
    const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
    const mcp = JSON.parse(read('.mcp.json'));

    assert.equal(codex.name, 'callsmith');
    assert.equal(codex.skills, './skills/');
    assert.equal(codex.mcpServers, './.mcp.json');
    assert.equal(claude.name, codex.name);
    assert.equal(marketplace.name, 'callsmith-marketplace');
    assert.equal(marketplace.plugins[0].source, './');
    assert.equal(marketplace.plugins[0].name, codex.name);
    assert.deepEqual(mcp.mcpServers.context7.args, ['-y', '@upstash/context7-mcp']);
    assert.ok(fs.existsSync(path.join(ROOT, 'skills/callsmith/SKILL.md')));
  });

  it('ships native manifests for the supported coding agents', () => {
    const manifests = [
      '.cursor-plugin/plugin.json',
      '.kimi-plugin/plugin.json',
      '.kimi-plugin/marketplace.json',
      '.devin-plugin/plugin.json',
      '.grok-plugin/plugin.json',
      'plugin.json',
      '.agy/plugin.json',
    ];
    for (const file of manifests) {
      const manifest = JSON.parse(read(file));
      assert.ok(manifest.name === 'callsmith' || manifest.plugins?.[0]?.id === 'callsmith', `${file} has wrong plugin id`);
    }

    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.main, '.opencode/plugins/callsmith.js');
    assert.deepEqual(pkg.pi.skills, ['./skills']);
    assert.ok(fs.existsSync(path.join(ROOT, '.opencode/plugins/callsmith.js')));
    assert.ok(fs.existsSync(path.join(ROOT, '.pi/extensions/callsmith.ts')));
  });

  it('keeps every shipped manifest version in lockstep with package.json', () => {
    const pkg = JSON.parse(read('package.json'));
    // .kimi-plugin/marketplace.json is excluded: its top-level "version": "2" is the
    // marketplace format marker, not a plugin version; it carries no plugin version.
    const versioned = [
      'plugin.json',
      '.agy/plugin.json',
      '.claude-plugin/plugin.json',
      '.claude-plugin/marketplace.json',
      '.kimi-plugin/plugin.json',
      '.cursor-plugin/plugin.json',
      '.devin-plugin/plugin.json',
      '.grok-plugin/plugin.json',
      '.codex-plugin/plugin.json',
    ];
    for (const file of versioned) {
      const manifest = JSON.parse(read(file));
      const versions = [manifest.version, manifest.metadata?.version, manifest.plugins?.[0]?.version]
        .filter((version) => version !== undefined);
      assert.ok(versions.length > 0, `${file} carries no version`);
      for (const version of versions) assert.equal(version, pkg.version, `${file} version drift from package.json`);
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

  it('package scripts only advertise shipped product surfaces', () => {
    const pkg = JSON.parse(read('package.json'));
    assert.equal(pkg.scripts.test, 'node --test');
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
  });

  it('checkout entrypoints are executable', () => {
    for (const file of ['bin/callsmith.mjs']) {
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
