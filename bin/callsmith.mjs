#!/usr/bin/env node
/**
 * callsmith — thin verification CLI
 * Constitution: the agent compiles; this CLI validates physics, packs, and health.
 * Deterministic generation (forge/scaffold/simulate/init) has been removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadMenu,
  loadProviders,
  expandAnswers,
  resolve,
  detectImpossibilities,
} from '../src/lib/resolver.mjs';
import { validatePacks } from '../src/lib/validate.mjs';
import { verifyPacks } from '../src/lib/verify-packs.mjs';
import { validateContract } from '../src/lib/contract.mjs';

const VERSION = '1.6.0-agent-compiler';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k.startsWith('--')) {
      o[k.slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    } else {
      o._ = (o._ || []).concat(k);
    }
  }
  return o;
}

function die(msg, code = 1) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

const HELP = `callsmith v${VERSION}

The agent compiles. This CLI validates packs, physics, floors, and contracts.
Generation (forge / scaffold / simulate / init) was removed — see product_decisions.md.

Usage:
  callsmith packs                          List installed provider packs
  callsmith pack show <id>                 Show one pack (JSON)
  callsmith pack validate [--json]         Schema-validate all packs
  callsmith verify-packs [--json]          Evidence provenance/date/expiry checks
  callsmith check --answers <file>         Physics report from pack data
  callsmith contract validate --file <f>   Semantic receipt + handoff contract
       [--domain medical|banking|collections|legal|insurance]
  callsmith doctor                         Install + pack health
  callsmith --version | --help

P0 wedge: pack inspect + floor receipts + contract validate + eval gate

Skill (primary product):
  npx skills add Nachi-Kulkarni/Callsmith_skills
  then invoke /callsmith in your coding agent
`;

function cmdPacks() {
  const providers = loadProviders();
  const byKind = {};
  for (const p of Object.values(providers)) {
    (byKind[p.kind] ||= []).push(p);
  }
  console.log(`\n${Object.keys(providers).length} provider packs\n`);
  for (const kind of Object.keys(byKind).sort()) {
    console.log(`${kind}:`);
    for (const p of byKind[kind].sort((a, b) => a.id.localeCompare(b.id))) {
      const model = p.model ? `  model=${p.model}` : '';
      console.log(`  ${p.id.padEnd(22)} ${p.label}${model}`);
    }
    console.log();
  }
}

function cmdPackShow(id) {
  if (!id) die('usage: callsmith pack show <id>');
  const providers = loadProviders();
  const pack = providers[id];
  if (!pack) die(`unknown pack "${id}". Run: callsmith packs`);
  console.log(JSON.stringify(pack, null, 2));
}

function cmdPackValidate() {
  const errors = validatePacks();
  if (args.json === true) {
    console.log(JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', errors }, null, 2));
  } else if (errors.length) {
    console.error(`pack validate FAIL (${errors.length} error(s))`);
    for (const e of errors) console.error(`  ${e}`);
  } else {
    console.log('pack validate PASS');
  }
  process.exitCode = errors.length ? 1 : 0;
}

function cmdVerifyPacks() {
  const providers = loadProviders();
  const menu = loadMenu();
  const report = verifyPacks(providers, menu);
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`verify-packs ${report.status} — ${report.counts.packs} packs, ${report.counts.checks} checks`);
    for (const f of report.failures) console.error(`  FAIL [${f.pack}] ${f.message}`);
    for (const w of report.warnings) console.warn(`  WARN [${w.pack}] ${w.message}`);
  }
  process.exitCode = report.failures.length ? 1 : 0;
}

function readAnswers(file) {
  if (!file || file === true) die('--answers <file> is required');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`could not parse answers file "${file}": ${e.message}`);
  }
}

function cmdCheck() {
  const raw = readAnswers(args.answers);
  const menu = loadMenu();
  let expanded;
  try {
    expanded = expandAnswers(raw, menu, { strict: true });
  } catch (e) {
    die(e.message);
  }
  const providers = loadProviders();
  // Constitution: never synthesize unknown providers — surface missing packs only.
  // expandAnswers stores { id, selectedVia } objects, not bare strings.
  const missing = [];
  for (const [kind, entry] of Object.entries(expanded.providers || {})) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (id && !providers[id]) missing.push({ kind, id });
  }
  if (missing.length) {
    console.error('Unknown provider pack(s) — research and add a pack; synthesis is forbidden:');
    for (const m of missing) console.error(`  ${m.kind}: ${m.id}`);
    process.exitCode = 1;
    return;
  }

  const impossible = detectImpossibilities(expanded, providers);
  if (impossible.length) {
    if (args.json === true) {
      console.log(JSON.stringify({ impossible }, null, 2));
    } else {
      console.error('\nStack is impossible (from pack physics):\n');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const r = resolve(expanded, providers);

  if (args.json === true) {
    console.log(JSON.stringify({ impossible: [], resolve: r }, null, 2));
  } else {
    console.log('\n=== callsmith check (physics from packs) ===\n');
    console.log('Impossibilities: none');
    if (r.pipeline?.length) {
      console.log('\nPipeline:');
      for (const n of r.pipeline) console.log(`  ${n.role}: ${n.id}`);
    }
    if (r.transforms?.length) {
      console.log('\nTransforms:');
      for (const t of r.transforms) {
        const step = typeof t === 'string' ? t : `${t.direction}: ${t.step} (${t.from} → ${t.to})`;
        console.log(`  ${step}`);
      }
    } else {
      console.log('\nTransforms: none (or handled natively)');
    }
    if (r.blockers?.length) {
      console.log('\nBlockers:');
      for (const b of r.blockers) {
        console.log(`  [${b.severity || 'note'}] ${b.note || JSON.stringify(b)}`);
      }
    }
    if (r.notes?.length) {
      console.log('\nNotes:');
      for (const n of r.notes) console.log(`  - ${n}`);
    }
    if (r.latency) {
      const total = r.latency.total_ms ?? r.latency.total ?? '?';
      if (r.latency.verdict) {
        console.log(`\nLatency (${r.latency.evidence_class}): total≈${total}ms verdict=${r.latency.verdict}`);
      } else {
        console.log(`\nLatency planning allowance: ≈${total}ms (unmeasured; not an SLO)`);
      }
      if (r.latency.note) console.log(`  ${r.latency.note}`);
    }
    if (r.cost) {
      console.log(`Cost planning allowance: ≈$${r.cost.per_minute_usd ?? r.cost.total_per_minute_usd ?? '?'}/min (verify current account pricing)`);
    }
    console.log();
  }
  process.exitCode = 0;
}

function cmdContractValidate() {
  const file = args.file || args.f || positional[1];
  if (!file || file === true) die('usage: callsmith contract validate --file <handoff.md> [--domain medical|...]');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    die(`could not read contract file "${file}": ${e.message}`);
  }
  const domain = args.domain === true ? undefined : args.domain;
  const report = validateContract(text, { domain, providers: loadProviders() });
  if (args.json === true) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`contract validate ${report.status}${report.domain ? ` (domain=${report.domain})` : ''}`);
    for (const s of report.sections) {
      console.log(`  section ${s.present ? 'OK' : 'MISS'}  ${s.id}`);
    }
    for (const f of report.floors) {
      console.log(`  floor   ${f.present ? 'OK' : 'MISS'}  ${f.domain}/${f.id}`);
    }
    for (const w of report.warnings) console.warn(`  WARN  ${w}`);
    for (const e of report.errors) console.error(`  FAIL  ${e}`);
  }
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

function cmdDoctor() {
  const issues = [];
  const skillPath = path.join(ROOT, 'SKILL.md');
  if (!fs.existsSync(skillPath)) issues.push('SKILL.md missing');
  for (const playbook of [
    'audit.md',
    'critique.md',
    'ttft.md',
    'harden.md',
    'contract.md',
    'policy.md',
    'workflow.md',
    'latency.md',
    'turn-trace.schema.json',
  ]) {
    if (!fs.existsSync(path.join(ROOT, 'reference', playbook))) {
      issues.push(`reference/${playbook} missing`);
    }
  }
  const providers = loadProviders();
  const n = Object.keys(providers).length;
  if (n < 1) issues.push('no provider packs loaded');
  const errors = validatePacks();
  if (errors.length) issues.push(`${errors.length} pack schema error(s)`);
  const verification = verifyPacks(providers, loadMenu());
  if (verification.failures.length) issues.push(`${verification.failures.length} pack evidence verification failure(s)`);
  const menuPath = path.join(ROOT, 'data', 'menu.json');
  if (!fs.existsSync(menuPath)) issues.push('data/menu.json missing (optional hints / check expand)');

  console.log(`callsmith doctor v${VERSION}`);
  console.log(`  root: ${ROOT}`);
  console.log(`  packs: ${n}`);
  console.log(`  skill: ${fs.existsSync(skillPath) ? 'ok' : 'MISSING'}`);
  console.log(`  references: ${issues.some((i) => i.startsWith('reference/')) ? 'MISSING' : 'ok'}`);
  if (issues.length) {
    console.log('  status: FAIL');
    for (const i of issues) console.log(`  - ${i}`);
    process.exit(1);
  }
  console.log('  status: OK');
  console.log('\nPrimary path: install skill, invoke /callsmith in your coding agent.');
  console.log('CLI validates packs, physics (check), and contracts (contract validate).\n');
}

function cmdGone(name) {
  console.error(`error: \`${name}\` was removed.`);
  console.error('Deterministic generation is not the product.');
  console.error('Use /callsmith in your coding agent to design; use pack/check/doctor to verify.');
  console.error('See product_decisions.md and subtraction.md.');
  process.exit(2);
}

// --- route ---
if (!cmd || cmd === 'help' || cmd === '--help' || args.help === true) {
  console.log(HELP);
  process.exit(0);
}
if (cmd === '--version' || cmd === 'version' || args.version === true) {
  console.log(VERSION);
  process.exit(0);
}

const positional = args._ || [];

if (cmd === 'packs') {
  cmdPacks();
} else if (cmd === 'pack') {
  const sub = positional[0];
  if (sub === 'show') cmdPackShow(positional[1]);
  else if (sub === 'validate' || sub === 'list') {
    if (sub === 'list') cmdPacks();
    else cmdPackValidate();
  } else if (!sub) {
    cmdPacks();
  } else {
    die(`unknown pack subcommand "${sub}". Use: show | validate`);
  }
} else if (cmd === 'validate-packs' || cmd === 'pack-validate') {
  cmdPackValidate();
} else if (cmd === 'verify-packs') {
  cmdVerifyPacks();
} else if (cmd === 'check') {
  cmdCheck();
} else if (cmd === 'contract') {
  const sub = positional[0];
  if (sub === 'validate') cmdContractValidate();
  else die('usage: callsmith contract validate --file <handoff.md> [--domain medical|...]');
} else if (cmd === 'doctor') {
  cmdDoctor();
} else if (
  ['init', 'forge', 'scaffold', 'simulate', 'docs', 'intake', 'spec', 'explain', 'context', 'release-check', 'execute'].includes(cmd)
) {
  cmdGone(cmd);
} else {
  die(`unknown command "${cmd}". Run: callsmith --help`);
}
