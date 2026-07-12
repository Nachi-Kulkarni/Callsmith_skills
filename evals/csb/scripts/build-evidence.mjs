#!/usr/bin/env node
/** Build a reviewable, sanitized, content-addressed CSB evidence bundle. */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const ROOT_FILES = new Set(['config.json', 'summary.json', 'report.md']);
const RECEIPT_FILES = new Set([
  'actor-prompt.md',
  'actor.status.json',
  'reproducibility.json',
  'score.json',
  'voice.answers.json',
  'callsmith.recipe.md',
  'pair.json',
]);
const SECRET_KEY = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie|secret)$/i;

export function sanitizeString(value, roots = []) {
  let result = String(value);
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    if (root) result = result.replaceAll(root, '$RUN_SOURCE');
  }
  result = result
    .replace(/\/(?:Users|home)\/[^/\s"']+/g, '$HOME')
    .replace(/\/private\/tmp\/callsmith-csb-[^/\s"']+\/workspace/g, '$WORKSPACE')
    .replace(/\/tmp\/callsmith-csb-[^/\s"']+\/workspace/g, '$WORKSPACE')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|sess|key)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_CREDENTIAL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]');
  return result;
}

export function sanitizeJsonValue(value, roots = [], key = '') {
  if (SECRET_KEY.test(key) && typeof value === 'string') return '[REDACTED]';
  if (['thread_id', 'session_id'].includes(key) && value) return '[REDACTED_TRACE_ID]';
  if (typeof value === 'string') {
    if (key === 'file' && value === 'actor.events.jsonl') return 'actor.events.sanitized.jsonl';
    if (key === 'file' && value === 'actor.stderr.txt') return 'actor.stderr.sanitized.txt';
    return sanitizeString(value, roots);
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeJsonValue(item, roots));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
    childKey,
    sanitizeJsonValue(child, roots, childKey),
  ]));
}

export function sanitizeTrace(jsonl, roots = []) {
  const output = [];
  for (const [index, line] of String(jsonl).split('\n').entries()) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`Trace line ${index + 1} is not valid JSONL; refusing partial publication.`);
    }
    if (event.item && typeof event.item === 'object') {
      delete event.item.aggregated_output;
    }
    output.push(JSON.stringify(sanitizeJsonValue(event, roots)));
  }
  return `${output.join('\n')}\n`;
}

export function buildEvidenceBundle({ source, out }) {
  const sourceRoot = resolve(source);
  const outRoot = resolve(out);
  if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
    throw new Error(`Run source is not a directory: ${sourceRoot}`);
  }
  if (existsSync(outRoot)) throw new Error(`Refusing existing evidence directory: ${outRoot}`);
  if (outRoot === sourceRoot || outRoot.startsWith(`${sourceRoot}${sep}`)) {
    throw new Error('Evidence output must be outside the raw run directory.');
  }
  for (const required of ['config.json', 'summary.json', 'report.md']) {
    if (!existsSync(join(sourceRoot, required))) throw new Error(`Raw run is missing ${required}`);
  }
  const sourceSummary = JSON.parse(readFileSync(join(sourceRoot, 'summary.json'), 'utf8'));
  if (sourceSummary.publishable !== true) {
    throw new Error('Raw run is not publication-eligible; keep it in diagnostics instead.');
  }

  mkdirSync(outRoot, { recursive: true });
  const roots = [sourceRoot, dirname(sourceRoot)];
  for (const file of walk(sourceRoot)) {
    const rel = relative(sourceRoot, file);
    const name = basename(file);
    if (ROOT_FILES.has(rel) || RECEIPT_FILES.has(name)) {
      writeSanitized(file, join(outRoot, rel), roots);
    } else if (name === 'actor.events.jsonl') {
      const target = join(outRoot, dirname(rel), 'actor.events.sanitized.jsonl');
      ensureParent(target);
      writeFileSync(target, sanitizeTrace(readFileSync(file, 'utf8'), roots));
    } else if (name === 'actor.stderr.txt') {
      const target = join(outRoot, dirname(rel), 'actor.stderr.sanitized.txt');
      ensureParent(target);
      writeFileSync(target, sanitizeString(readFileSync(file, 'utf8'), roots));
    }
  }

  const redaction = [
    '# Redaction receipt',
    '',
    `Source run id: \`${basename(sourceRoot)}\``,
    '',
    '- Raw traces remain local and are not copied.',
    '- Absolute user/run paths, trace identifiers, email addresses, bearer credentials, and common secret fields are redacted.',
    '- Command output is removed from JSONL traces; commands and event outcomes remain.',
    '- `auth.json`, raw stdout, caches, Git metadata, and unrecognized files are excluded by allowlist.',
    '- Every published file is covered by `MANIFEST.sha256`.',
    '',
  ].join('\n');
  writeFileSync(join(outRoot, 'REDACTION.md'), redaction);
  writeReproduction(outRoot, JSON.parse(readFileSync(join(sourceRoot, 'config.json'), 'utf8')));
  const publishedSummaryPath = join(outRoot, 'summary.json');
  const publishedSummary = JSON.parse(readFileSync(publishedSummaryPath, 'utf8'));
  publishedSummary.evidence_publication = {
    sanitized: true,
    raw_trace_included: false,
    manifest: 'MANIFEST.sha256',
    redaction_receipt: 'REDACTION.md',
  };
  writeFileSync(publishedSummaryPath, `${JSON.stringify(publishedSummary, null, 2)}\n`);
  writeManifest(outRoot);
  return { out: outRoot, files: walk(outRoot).map((file) => relative(outRoot, file)).sort() };
}

function writeReproduction(outRoot, config) {
  const args = [
    '--actor-tool', config.actor?.tool,
    '--actor-model', config.actor?.model,
    ...(config.actor?.reasoning ? ['--actor-reasoning', config.actor.reasoning] : []),
    '--runs', config.runs,
    '--seed', config.seed,
    '--timeout-ms', config.budget?.timeout_ms_per_arm,
  ].filter((value) => value !== null && value !== undefined);
  if (config.scenarios?.length === 1) args.push('--scenario', config.scenarios[0]);
  args.push('--out', `evals/csb/runs/${config.run_id}-reproduction`);
  const body = [
    '# Reproduce this run',
    '',
    `Source commit: \`${config.git?.commit || 'unknown'}\``,
    '',
    'Use the recorded Codex/OpenCode subscription or provider account. Model services are nondeterministic;',
    'the command reproduces the controlled design, not byte-identical model output.',
    '',
    '```bash',
    `git checkout ${config.git?.commit || '<commit>'}`,
    `npm run bench:csb -- ${args.map(shellWord).join(' ')}`,
    '```',
    '',
    'Compare the new `config.json` hashes before comparing scores.',
    '',
  ].join('\n');
  writeFileSync(join(outRoot, 'REPRODUCE.md'), body);
}

function shellWord(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:@+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

function writeSanitized(source, target, roots) {
  ensureParent(target);
  const raw = readFileSync(source, 'utf8');
  if (source.endsWith('.json')) {
    const parsed = JSON.parse(raw);
    writeFileSync(target, `${JSON.stringify(sanitizeJsonValue(parsed, roots), null, 2)}\n`);
  } else {
    writeFileSync(target, sanitizeString(raw, roots));
  }
}

function writeManifest(root) {
  const files = walk(root)
    .filter((file) => basename(file) !== 'MANIFEST.sha256')
    .sort();
  const rows = files.map((file) => `${sha256(readFileSync(file))}  ${relative(root, file)}`);
  writeFileSync(join(root, 'MANIFEST.sha256'), `${rows.join('\n')}\n`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ensureParent(file) {
  mkdirSync(dirname(file), { recursive: true });
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function parseArgs(items) {
  const result = {};
  for (let index = 0; index < items.length; index += 1) {
    if (!items[index].startsWith('--')) continue;
    const key = items[index].slice(2);
    result[key] = items[index + 1] && !items[index + 1].startsWith('--')
      ? items[++index]
      : true;
  }
  return result;
}

if (resolve(process.argv[1] || '') === HERE) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.source || !args.out) throw new Error('Usage: build-evidence.mjs --source <raw-run> --out <evidence-dir>');
    const result = buildEvidenceBundle({ source: args.source, out: args.out });
    console.log(`Wrote sanitized evidence: ${result.out} (${result.files.length} files)`);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
