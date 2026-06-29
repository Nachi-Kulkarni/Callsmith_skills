import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = path.join(ROOT, 'bin', 'callsmith.mjs');

export function runReleaseCheck(options = {}) {
  const python = findPython();
  const opts = {
    fullInstalls: options.fullInstalls === true,
    skipTests: options.skipTests === true,
    skipGeneratedInstall: options.skipGeneratedInstall === true,
    dryRun: options.dryRun === true,
    json: options.json === true,
    python,
  };
  const report = {
    status: 'PASS',
    root: ROOT,
    options: opts,
    steps: [],
    package: null,
    full_installs: [],
  };

  const planned = [
    'npm pack --dry-run --json',
    'npm install -g . into a temp prefix + callsmith --help',
    'node bin/callsmith.mjs verify-packs --json',
    'generate + forge/check/scaffold/docs/simulate a golden stack',
  ];
  if (!opts.skipGeneratedInstall) planned.push('bash install.sh test + generated pytest');
  if (!opts.skipTests) planned.push('npm test');
  if (opts.fullInstalls) planned.push('install every unique generated requirements.txt set');

  if (opts.dryRun) {
    report.status = 'DRY_RUN';
    report.planned = planned;
    return report;
  }

  try {
    const pack = runStep(report, 'package dry-run', 'npm', ['pack', '--dry-run', '--json'], {
      cwd: ROOT,
      env: { npm_config_cache: fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-npm-cache-')) },
    });
    report.package = validatePackageDryRun(pack.stdout);
    runPackageInstallSmoke(report);

    runStep(report, 'provider pack verification', process.execPath, [BIN, 'verify-packs', '--json'], { cwd: ROOT });
    runGeneratedGoldenPath(report, opts);

    if (!opts.skipTests) {
      runStep(report, 'repository test suite', 'npm', ['test'], { cwd: ROOT, timeoutMs: 120000 });
    }

    if (opts.fullInstalls) {
      runFullRequirementInstalls(report);
    }
  } catch (error) {
    report.status = 'FAIL';
    report.error = error.message;
    if (!opts.json) printReport(report);
    return report;
  }

  if (!opts.json) printReport(report);
  return report;
}

function runPackageInstallSmoke(report) {
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-prefix-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-npm-cache-'));
  runStep(report, 'package install smoke', 'npm', ['install', '-g', '.', '--prefix', prefix], {
    cwd: ROOT,
    timeoutMs: 120000,
    env: { npm_config_cache: cache },
  });
  runStep(report, 'installed binary smoke', path.join(prefix, 'bin', 'callsmith'), ['--help'], {
    cwd: ROOT,
    timeoutMs: 60000,
  });
}

function runGeneratedGoldenPath(report, opts) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-release-'));
  const answers = path.join(root, 'voice.answers.json');
  const agent = path.join(root, 'voice-agent');

  runStep(report, 'spec template', process.execPath, [BIN, 'spec', '--answers', answers], { cwd: ROOT });
  runStep(report, 'forge golden stack', process.execPath, [BIN, 'forge', '--answers', answers, '--out', agent, '--force'], { cwd: ROOT });
  runStep(report, 'check golden stack', process.execPath, [BIN, 'check', '--answers', answers], { cwd: ROOT });
  runStep(report, 'scaffold golden stack', process.execPath, [BIN, 'scaffold', '--answers', answers, '--out', agent, '--force'], { cwd: ROOT });
  runStep(report, 'docs golden stack', process.execPath, [BIN, 'docs', '--answers', answers, '--out', agent, '--force'], { cwd: ROOT });
  runStep(report, 'simulate golden stack', process.execPath, [BIN, 'simulate', '--answers', answers, '--out', agent, '--scaffold', agent, '--force'], { cwd: ROOT });

  if (!opts.skipGeneratedInstall) {
    runStep(report, 'generated fast install', 'bash', ['install.sh', 'test'], {
      cwd: agent,
      timeoutMs: 120000,
      env: { PYTHON: opts.python },
    });
    runStep(report, 'generated pytest', path.join(agent, '.venv', 'bin', 'python'), ['-m', 'pytest', 'tests/', '-q'], { cwd: agent, timeoutMs: 120000 });
  }
}

function runFullRequirementInstalls(report) {
  const fixtures = collectAnswerFixtures(path.join(ROOT, 'test', 'fixtures'));
  const unique = new Map();
  const scaffoldRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'callsmith-full-reqs-'));

  for (const fixture of fixtures) {
    const name = path.basename(fixture, '.answers.json');
    const out = path.join(scaffoldRoot, sanitizeName(name));
    const res = spawnSync(process.execPath, [BIN, 'scaffold', '--answers', fixture, '--out', out, '--force'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (res.status !== 0) continue;
    const reqPath = path.join(out, 'requirements.txt');
    if (!fs.existsSync(reqPath)) continue;
    const normalized = normalizeRequirements(fs.readFileSync(reqPath, 'utf8'));
    if (!unique.has(normalized)) unique.set(normalized, { fixture, requirements: normalized });
  }

  for (const [i, item] of [...unique.values()].entries()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `callsmith-req-${i + 1}-`));
    fs.writeFileSync(path.join(dir, 'requirements.txt'), item.requirements + '\n');
    installRequirementSet(report, dir, item);
  }
}

function installRequirementSet(report, dir, item) {
  const uv = findUv();
  const python = findPython();
  const label = `full requirements install (${path.basename(item.fixture)})`;
  if (uv) {
    runStep(report, `${label}: create venv`, uv, ['venv', '.venv', '--python', python], { cwd: dir, timeoutMs: 120000 });
    runStep(report, label, uv, ['pip', 'install', '--python', path.join(dir, '.venv', 'bin', 'python'), '-r', 'requirements.txt'], {
      cwd: dir,
      timeoutMs: 300000,
    });
  } else {
    runStep(report, `${label}: create venv`, python, ['-m', 'venv', '.venv'], { cwd: dir, timeoutMs: 120000 });
    runStep(report, label, path.join(dir, '.venv', 'bin', 'python'), ['-m', 'pip', 'install', '-r', 'requirements.txt'], {
      cwd: dir,
      timeoutMs: 300000,
    });
  }
  report.full_installs.push({
    fixture: path.basename(item.fixture),
    requirements: item.requirements.split('\n'),
  });
}

function findPython() {
  const bundled = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'bin', 'python3');
  const candidates = [
    process.env.PYTHON,
    'python3.13',
    'python3.12',
    'python3.11',
    'python3.10',
    bundled,
    'python3',
  ].filter(Boolean);
  for (const cmd of candidates) {
    const res = spawnSync(cmd, ['-c', 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    if (res.status !== 0) continue;
    const [major, minor] = res.stdout.trim().split('.').map(Number);
    if (major > 3 || (major === 3 && minor >= 10)) return cmd;
  }
  return process.env.PYTHON || 'python3';
}

function validatePackageDryRun(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error('npm pack --dry-run did not return JSON');
  }
  const pkg = parsed[0];
  if (!pkg) throw new Error('npm pack --dry-run returned no package payload');
  const files = new Set((pkg.files || []).map(f => f.path));
  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    'SKILL.md',
    'bin/callsmith.mjs',
    'src/lib/index.mjs',
    'src/lib/release-check.mjs',
    'data/menu.json',
    'providers/_schema.json',
  ];
  const missing = required.filter(f => !files.has(f));
  if (missing.length) throw new Error(`npm package is missing required files: ${missing.join(', ')}`);
  return {
    name: pkg.name,
    version: pkg.version,
    filename: pkg.filename,
    files: pkg.files?.length || 0,
    unpackedSize: pkg.unpackedSize,
  };
}

function runStep(report, label, command, args, opts = {}) {
  const commandLine = [command, ...args].join(' ');
  const start = Date.now();
  const res = spawnSync(command, args, {
    cwd: opts.cwd || ROOT,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, ...(opts.env || {}) },
    timeout: opts.timeoutMs || 60000,
  });
  const step = {
    label,
    command: commandLine,
    cwd: opts.cwd || ROOT,
    status: res.status === 0 ? 'PASS' : 'FAIL',
    duration_ms: Date.now() - start,
    stdout_tail: tail(res.stdout || ''),
    stderr_tail: tail(res.stderr || ''),
  };
  report.steps.push(step);
  if (res.error) {
    throw new Error(`${label} failed: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new Error(`${label} failed with exit ${res.status}\n${step.stderr_tail || step.stdout_tail}`);
  }
  return { stdout: res.stdout || '', stderr: res.stderr || '' };
}

function collectAnswerFixtures(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...collectAnswerFixtures(p));
    else if (name.endsWith('.answers.json')) out.push(p);
  }
  return out.sort();
}

function normalizeRequirements(raw) {
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .sort()
    .join('\n');
}

function sanitizeName(name) {
  return name.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80);
}

function findUv() {
  const candidates = [
    process.env.UV,
    'uv',
    path.join(os.homedir(), '.local', 'bin', 'uv'),
  ].filter(Boolean);
  for (const cmd of candidates) {
    const res = spawnSync(cmd, ['--version'], { encoding: 'utf8', stdio: 'pipe' });
    if (res.status === 0) return cmd;
  }
  return null;
}

function tail(text, max = 4000) {
  return text.length > max ? text.slice(text.length - max) : text;
}

function printReport(report) {
  console.log(`\nRelease check: ${report.status}`);
  if (report.package) {
    console.log(`  package: ${report.package.name}@${report.package.version} (${report.package.files} files)`);
  }
  for (const step of report.steps) {
    console.log(`  [${step.status}] ${step.label} (${step.duration_ms}ms)`);
  }
  if (report.full_installs.length) {
    console.log(`  full requirement sets installed: ${report.full_installs.length}`);
  }
  if (report.error) console.error(`\n${report.error}`);
  console.log('');
}
