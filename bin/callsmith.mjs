#!/usr/bin/env node
/**
 * callsmith — thin verification CLI
 * Constitution: the agent compiles; this CLI validates physics, packs, and health.
 * Deterministic generation (forge/scaffold/simulate/init) has been removed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  loadMenu,
  loadProviders,
  expandAnswers,
  resolve,
  detectImpossibilities,
} from '../src/lib/resolver.mjs';
import { validatePacks } from '../src/lib/validate.mjs';
import { verifyPacks, packRefreshReport } from '../src/lib/verify-packs.mjs';
import { validateContract, validateContractAnswers } from '../src/lib/contract.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

const [cmd, ...rest] = process.argv.slice(2);
let args;
let positional;
try {
  ({ values: args, positionals: positional } = parseArgs({
    args: rest,
    options: {
      json: { type: 'boolean' },
      file: { type: 'string' },
      answers: { type: 'string' },
      domain: { type: 'string' },
      due: { type: 'boolean' },
      within: { type: 'string' },
      version: { type: 'boolean' },
      help: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  }));
} catch (e) {
  console.error(`error: ${e.message}\nRun: callsmith --help`);
  process.exit(2);
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
  callsmith verify-packs --due [--within N]  Packs needing re-verification soon
  callsmith check --answers <file>         Physics report from pack data
  callsmith contract validate --file <f>   Semantic receipt + handoff contract
       [--answers voice.answers.json]
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
  if (args.due === true) {
    const within = args.within === undefined ? 30 : Number(args.within);
    if (!Number.isInteger(within) || within < 0) die('--within must be a non-negative integer (days)');
    const report = packRefreshReport(providers, { withinDays: within });
    if (args.json === true) {
      console.log(JSON.stringify(report, null, 2));
    } else if (!report.due.length) {
      console.log(`No pack evidence expires within ${within} days (${report.generated_at.slice(0, 10)}).`);
    } else {
      console.log(`Pack refresh treadmill — ${report.due.length} pack(s) expiring within ${within} days:\n`);
      for (const item of report.due) {
        const left = item.days_left < 0 ? `EXPIRED ${-item.days_left}d ago` : `${item.days_left}d left`;
        console.log(`  ${item.expires_at}  ${String(left).padEnd(16)} ${item.pack}  (${item.sources[0] ?? 'no source'})`);
      }
      console.log('\nRe-verify against primary sources, then bump verified_at/expires_at (MAINTENANCE.md).');
    }
    return;
  }
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
  if (!file) die('--answers <file> is required');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`could not parse answers file "${file}": ${e.message}`);
  }
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    die(`answers file "${file}" must contain a JSON object of answer fields, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'an array' : `a ${typeof parsed}`}`);
  }
  return parsed;
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
  const blockers = impossible.filter((item) => item.severity !== 'advisory');
  const advisories = impossible.filter((item) => item.severity === 'advisory');
  if (blockers.length) {
    if (args.json === true) {
      console.log(JSON.stringify({ impossible, advisories, resolve: null }, null, 2));
    } else {
      console.error('\nStack is impossible (from pack physics):\n');
      for (const i of blockers) console.error(`  [${i.code}] ${i.message}`);
    }
    process.exitCode = 1;
    return;
  }

  const r = resolve(expanded, providers);

  if (args.json === true) {
    console.log(JSON.stringify({ impossible: [], advisories, resolve: r }, null, 2));
  } else {
    console.log('\n=== callsmith check (physics from packs) ===\n');
    console.log('Impossibilities: none');
    for (const item of advisories) console.log(`Advisory [${item.code}] ${item.message}`);
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
    if (r.operations) {
      const ops = r.operations;
      console.log(`\nOperations: ${ops.hosting_label} (requested: ${ops.requested_hosting_model}) — owner: ${ops.infrastructure_owner}`);
      for (const a of ops.adjustments || []) console.log(`  adjust: ${a}`);
      for (const resp of ops.responsibilities || []) console.log(`  - ${resp}`);
    }
    if (r.envKeys?.length) {
      console.log(`\nEnv keys (secrets manager, never the repo): ${r.envKeys.join(', ')}`);
    }
    console.log();
  }
  process.exitCode = 0;
}

function cmdContractValidate() {
  const file = args.file || positional[1];
  if (!file) die('usage: callsmith contract validate --file <handoff.md> [--answers voice.answers.json] [--domain medical|...]');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    die(`could not read contract file "${file}": ${e.message}`);
  }
  const domain = args.domain;
  const report = validateContract(text, { domain, providers: loadProviders() });
  if (args.answers) {
    let answers;
    try {
      answers = JSON.parse(fs.readFileSync(args.answers, 'utf8'));
    } catch (e) {
      die(`could not read answers file "${args.answers}": ${e.message}`);
    }
    report.answers_consistency = validateContractAnswers(report.receipt, answers, loadMenu());
    report.errors.push(...report.answers_consistency.errors);
    report.status = report.errors.length ? 'FAIL' : 'PASS';
  }
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
    for (const check of report.answers_consistency?.checks || []) {
      console.log(`  answers ${check.ok ? 'OK' : 'MISS'}  ${check.id}`);
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
  // Canon completeness: every playbook the skill routes to must exist, plus the
  // non-routed canon (policy/contract/workflow/current-docs, deploy subtree, trace
  // schemas). Derived from SKILL.md so adding a routing row updates doctor for free.
  const skill = fs.existsSync(skillPath) ? fs.readFileSync(skillPath, 'utf8') : '';
  const routed = [...skill.matchAll(/reference\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
  const canon = new Set([
    ...routed,
    'policy.md', 'contract.md', 'workflow.md', 'current-docs.md',
    'deploy-capacity.md', 'deploy-workload.md', 'deploy-evidence.md',
    'turn-trace.schema.json', 'turn-trace.v2.schema.json',
  ]);
  for (const playbook of [...canon].sort()) {
    if (!fs.existsSync(path.join(ROOT, 'reference', playbook))) {
      issues.push(`reference/${playbook} missing`);
    }
  }
  if (routed.length < 8) issues.push('SKILL.md routes fewer than 8 playbooks — routing table looks broken');
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
// A corrupt pack file or unexpected crash must print one clean line, not a stack
// trace — this CLI's output is consumed by agents and CI, not debugged by eye.
let routed = false;
try {
  routed = route();
} catch (e) {
  die(e.message || String(e));
}
if (!routed) die(`unknown command "${cmd}". Run: callsmith --help`);

function route() {
if (!cmd || cmd === 'help' || cmd === '--help' || args.help === true) {
  console.log(HELP);
  process.exit(0);
}
if (cmd === '--version' || cmd === 'version' || args.version === true) {
  console.log(VERSION);
  process.exit(0);
}

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
  else die('usage: callsmith contract validate --file <handoff.md> [--answers voice.answers.json] [--domain medical|...]');
} else if (cmd === 'doctor') {
  cmdDoctor();
} else if (
  ['init', 'forge', 'scaffold', 'simulate', 'docs', 'intake', 'spec', 'explain', 'context', 'release-check', 'execute'].includes(cmd)
) {
  cmdGone(cmd);
} else {
  return false;
}
return true;
}
