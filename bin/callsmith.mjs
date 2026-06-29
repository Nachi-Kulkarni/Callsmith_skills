#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { compile } from '../src/lib/compile.mjs';
import { loadMenu, loadProviders, expandAnswers, resolve, detectImpossibilities } from '../src/lib/resolver.mjs';
import { resolveUnknowns } from '../src/lib/registry.mjs';
import { scaffold } from '../src/lib/scaffold.mjs';
import { hydrate } from '../src/lib/docs.mjs';
import { simulate } from '../src/lib/simulate.mjs';
import { verifyPacks } from '../src/lib/verify-packs.mjs';
import { runReleaseCheck } from '../src/lib/release-check.mjs';

const VERSION = '1.3.0';

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i];
    if (k.startsWith('--')) { o[k.slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; }
    else o._ = (o._ || []).concat(k);
  }
  return o;
}

function readAnswers(file) {
  if (!file) { console.error('error: --answers <file> is required (or run `callsmith spec` interactively)'); process.exit(1); }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`error: could not parse answers file "${file}": ${e.message}`);
    process.exit(1);
  }
}

function expandOrExit(raw, menu) {
  try {
    return expandAnswers(raw, menu, { strict: true });
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}

function reportWriteResult(res, label) {
  if (res.dryRun) {
    console.log(`\n[dry-run] ${label} would write ${res.manifest.length} file(s) into ${res.root}:`);
    for (const f of res.manifest) console.log(`  ${f}`);
    console.log('\nNothing was written. Re-run without --dry-run to write, or add --force to overwrite existing files.\n');
    return;
  }
  if (res.collisions.length) {
    console.error(`\n${res.collisions.length} existing file(s) would be overwritten in ${res.root}:`);
    for (const f of res.collisions) console.error(`  ${f}`);
    console.error('\nRefusing to overwrite. Re-run with --force to overwrite, or --out <new-dir> to write elsewhere.');
    process.exit(1);
  }
  if (res.overwritten && res.overwritten.length) {
    console.log(`  (overwrote ${res.overwritten.length} existing file(s) via --force)`);
  }
}

function whenMatches(when, flags) {
  if (!when) return true;
  for (const [k, v] of Object.entries(when)) {
    const fv = flags[k];
    if (Array.isArray(v)) { if (!v.includes(fv)) return false; }
    else { if (fv !== v) return false; }
  }
  return true;
}

const HELP = `callsmith v${VERSION} — compile a voice-agent implementation recipe.

Usage:
  callsmith spec [--answers <out.json>]     Interactive MCQ intake (writes an answers file)
  callsmith init [--preset <id>] [--answers <out.json>]  One-shot intake with a preset
  callsmith forge --answers <file> [--out dir] [--force] [--dry-run]   Compile answers into a recipe + lock + context
  callsmith check --answers <file>          Print the compatibility matrix (no files written)
  callsmith scaffold --answers <file> [--out dir] [--force] [--dry-run]  Generate the framework-native repo skeleton
  callsmith docs --answers <file> [--out dir] [--force] [--dry-run]  Write provider doc stubs + Context7 prompts into .callsmith/docs/
  callsmith simulate --answers <file> [--out dir] [--scaffold dir] [--force] [--dry-run]  Run a deterministic fake call lifecycle
  callsmith explain --answers <file>        Plain-English summary of the selected stack (no files written)
  callsmith verify-packs [--json]          Check provider pack freshness and CI safety
  callsmith release-check [--full-installs] [--skip-tests] [--json]  Run publish/readiness checks
  callsmith context                         Preflight: report whether a recipe is loaded here
  callsmith --version                       Print version
  callsmith --help                          Show this help

Write-protection:
  --force        Overwrite existing files instead of refusing
  --dry-run      Report what would be written; write nothing
  Without --force, scaffold/forge/docs refuse to overwrite existing files.

Environment:
  CALLSMITH_REGISTRY=<url|path>   Community pack registry (default: GitHub raw)
  CALLSMITH_REGISTRY_SKIP=1       Skip registry lookup, always synthesize unknown providers
`;

async function interactiveSpec(menu) {
  const rl = readline.createInterface({ input, output });
  const answers = {};
  const flags = {};
  console.log('\ncallsmith intake — type a number or id, Enter for the default.\n');
  for (const g of menu.groups) {
    if (!whenMatches(g.when, flags)) continue;
    console.log(`■ ${g.title}`);
    if (g.help) console.log(`  ${g.help}`);
    g.options.forEach((o, i) => {
      const d = o.id === g.default ? ' (default)' : '';
      console.log(`  ${i + 1}. ${o.label}${d}  [${o.id}]`);
    });
    const ans = await rl.question(`Choice [${g.default}]: `);
    let choice = ans.trim();
    if (/^\d+$/.test(choice)) {
      const idx = parseInt(choice, 10) - 1;
      choice = g.options[idx] ? g.options[idx].id : g.default;
    } else if (!g.options.find(o => o.id === choice)) {
      choice = g.default;
    }
    answers[g.id] = choice;
    const opt = g.options.find(o => o.id === choice);
    for (const [k, v] of Object.entries(opt.maps || {})) if (k !== 'provider' && k !== 'kind') flags[k] = v;
    console.log('');
  }
  rl.close();
  return answers;
}

switch (cmd) {
  case undefined:
  case '--help':
  case '-h':
  case 'help': {
    process.stdout.write(HELP);
    process.exit(0);
  }
  case '--version':
  case '-v': {
    console.log(`callsmith v${VERSION}`);
    break;
  }
  case 'init': {
    const presetsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'presets.json');
    const presets = JSON.parse(fs.readFileSync(presetsPath, 'utf8'));
    if (args.preset) {
      const p = presets.presets[args.preset];
      if (!p) {
        console.error(`error: unknown preset "${args.preset}". Available: ${Object.keys(presets.presets).join(', ')}`);
        process.exit(1);
      }
      const outFile = args.answers || 'voice.answers.json';
      fs.writeFileSync(outFile, JSON.stringify(p.answers, null, 2) + '\n');
      console.log(`\nInitialized ${args.preset}: ${p.label}`);
      console.log(`  ${p.blurb}`);
      console.log(`\nWrote ${outFile}`);
      console.log('\nNext: callsmith forge --answers ' + outFile + ' --out ./voice-agent\n');
    } else {
      const ids = Object.keys(presets.presets);
      console.log('\nAvailable presets (callsmith init --preset <id>):\n');
      for (const id of ids) {
        const p = presets.presets[id];
        console.log(`  ${id}  — ${p.label}`);
        console.log(`    ${p.blurb}`);
      }
      console.log('\nOr run `callsmith spec --answers voice.answers.json` for the full interactive intake.\n');
    }
    break;
  }
  case 'explain': {
    const raw = readAnswers(args.answers);
    const menu = loadMenu();
    const providers = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers: resolvedProviders, resolved } = await resolveUnknowns(providers, expanded);
    const result = resolve(expanded, resolvedProviders);
    const stackLabels = result.pipeline.map(p => p.label || p.id);
    const ops = result.operations;
    console.log('\n' + stackLabels.join(' -> '));
    console.log('');
    console.log(`Architecture: ${result.stack.flags.mode}  |  Language: ${result.stack.flags.language}  |  Barge-in: ${result.stack.flags.barge_in}`);
    console.log(`Operations: ${ops.hosting_label} (${ops.infrastructure_owner})  |  Debug: ${ops.debug_profile}/${ops.trace_level}`);
    if (ops.adjustments.length) {
      for (const item of ops.adjustments) console.log(`  adjustment: ${item}`);
    }
    if (result.transforms.length) {
      console.log(`\nAudio bridge: REQUIRED (${result.transforms.length} transform(s))`);
      for (const t of result.transforms) console.log(`  [${t.direction}] ${t.step}  (${t.from} -> ${t.to})`);
    } else {
      console.log('\nAudio bridge: none — a native layer normalizes the audio path.');
    }
    const mitigated = result.potholes.filter(p => p.mitigated);
    const activeBlockers = result.potholes.filter(p => p.severity === 'blocker' && !p.mitigated);
    console.log(`\nPotholes: ${activeBlockers.length} active blocker(s), ${mitigated.length} mitigated by native layer.`);
    console.log(`Latency: ${result.latency.total_ms}ms estimated / ${result.latency.target_ms}ms target — ${result.latency.verdict}.`);
    console.log(`Cost: $${result.cost.total_per_minute_usd.toFixed(4)}/min (~$${result.cost.per_hour_usd}/hr).`);
    console.log(`Audio cleanup: ${ops.audio_enhancement}; debug audio window ${ops.retain_debug_audio_sec}s.`);
    if (resolved.length) {
      console.log(`\nResolved providers (online):`);
      for (const r of resolved) console.log(`  ${r.id} (${r.role}) — ${r.verified ? 'registry (verified)' : 'UNVERIFIED — synthesized'}`);
    }
    console.log('\nNext: callsmith forge --answers ' + args.answers + ' --out ./voice-agent\n');
    break;
  }
  case 'spec': {
    const menu = loadMenu();
    if (process.stdin.isTTY) {
      const answers = await interactiveSpec(menu);
      const json = JSON.stringify(answers, null, 2);
      const outFile = args.answers;
      if (outFile) {
        fs.writeFileSync(outFile, json + '\n');
        console.log(`\nSaved interactive answers to ${outFile}`);
        console.log('Next: callsmith forge --answers ' + outFile + ' --out ./voice-agent');
      } else {
        console.log('\nAnswers:\n' + json);
        console.log('\nSave these to a file, or re-run: callsmith spec --answers voice.answers.json');
      }
    } else if (args.answers) {
      const answers = templateAnswers(menu);
      fs.writeFileSync(args.answers, JSON.stringify(answers, null, 2) + '\n');
      console.log(`Wrote a fillable template to ${args.answers}. Edit it, then: callsmith forge --answers ${args.answers}`);
    } else {
      console.log('Interactive intake needs a TTY. Run `callsmith spec --answers voice.answers.json` for a template.');
    }
    break;
  }
  case 'forge': {
    const raw = readAnswers(args.answers);
    const menu = loadMenu();
    const providers = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers: resolvedProviders, resolved } = await resolveUnknowns(providers, expanded);
    const impossible = detectImpossibilities(expanded, resolvedProviders);
    if (impossible.length) {
      console.error('\nCannot forge — the selected stack is impossible:');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
      console.error('\nRun `callsmith check` or fix your answers file.');
      process.exit(1);
    }
    const out = args.out || process.cwd();
    const opts = { providers: resolvedProviders, resolved, force: args.force === true, dryRun: args["dry-run"] === true };
    const compiled = compile(raw, out, opts);
    if (compiled.dryRun) { reportWriteResult(compiled, 'forge'); break; }
    if (compiled.collisions.length) { reportWriteResult(compiled, 'forge'); break; }
    const { result, files } = compiled;
    console.log(`\nForged recipe into ${compiled.root}`);
    console.log('  ' + files.join('\n  '));
    console.log(`\n  stack: ${result.pipeline.map(p => p.label || p.id).join(' -> ')}`);
    console.log(`  custom bridge required: ${result.transforms.length ? 'YES (' + result.transforms.length + ' transforms)' : 'no'}`);
    console.log(`  blockers: ${result.blockers.length}   potholes: ${result.potholes.filter(p => !p.mitigated).length} active + ${result.potholes.filter(p => p.mitigated).length} mitigated`);
    if (resolved.length) {
      console.log(`  resolved providers:`);
      for (const r of resolved) {
        const tag = r.verified ? 'registry (verified)' : 'UNVERIFIED — synthesized';
        console.log(`    ${r.id} (${r.role}) — ${tag}`);
      }
    }
    console.log('\nNext: hand callsmith.recipe.md to your coding agent, or run `callsmith scaffold`.\n');
    break;
  }
  case 'check': {
    const raw = readAnswers(args.answers);
    const menu = loadMenu();
    const providers = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers: resolvedProviders, resolved } = await resolveUnknowns(providers, expanded);
    const impossible = detectImpossibilities(expanded, resolvedProviders);
    if (impossible.length) {
      console.error('\nImpossible stack:');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
      console.error('');
      process.exit(1);
    }
    const result = resolve(expanded, resolvedProviders);
    const ops = result.operations;
    console.log('\nCompatibility matrix');
    console.log('  stack:', result.pipeline.map(p => p.label || p.id).join(' -> '));
    console.log(`  operations: ${ops.hosting_label} (${ops.infrastructure_owner}); debug=${ops.debug_profile}/${ops.trace_level}; audio=${ops.audio_enhancement}`);
    for (const item of ops.adjustments) console.log('    [adjustment]', item);
    for (const feature of ops.audio_features) console.log(`    ${feature.feature}: ${feature.mode} [owner: ${feature.owner}]`);
    console.log('  transforms:', result.transforms.length ? result.transforms.map(t => `[${t.direction}] ${t.step}`).join('; ') : 'none');
    console.log('  blockers:', result.blockers.length);
    for (const b of result.blockers) console.log('    [BLOCKER]', b.note);
    console.log('  notes:', result.notes.length);
    for (const n of result.notes) console.log('    -', n);
    if (result.interruption.enabled) {
      console.log('  interruption:', `${result.interruption.steps.length} layers (${result.interruption.steps.map(s => s.layer).join(' -> ')})`);
    } else {
      console.log('  interruption: disabled (half-duplex)');
    }
    const lat = result.latency;
    console.log(`  latency: ${lat.total_ms}ms estimated / ${lat.target_ms}ms target — ${lat.verdict}`);
    for (const leg of lat.legs) console.log(`    ${leg.label}: ${leg.ms}ms`);
    const cost = result.cost;
    console.log(`  cost: $${cost.total_per_minute_usd.toFixed(4)}/min ($${cost.per_hour_usd}/hr, $${cost.per_1k_calls_usd}/1k calls)`);
    for (const leg of cost.legs) console.log(`    ${leg.role} (${leg.label}): $${leg.per_minute_usd.toFixed(4)}/min [${leg.billing}]`);
    if (resolved.length) {
      console.log('  resolved providers:');
      for (const r of resolved) {
        const tag = r.verified ? 'registry (verified)' : 'UNVERIFIED — synthesized';
        console.log(`    ${r.id} (${r.role}) — ${tag}`);
      }
    }
    console.log('');
    if (result.blockers.length && process.env.CALLSMITH_CHECK_NO_EXIT_1 !== '1') process.exit(1);
    break;
  }
  case 'scaffold': {
    const raw = readAnswers(args.answers);
    const menu = loadMenu();
    const baseProviders = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers } = await resolveUnknowns(baseProviders, expanded);
    const out = args.out || path.join(process.cwd(), 'voice-agent');
    const res = scaffold(raw, out, { providers, force: args.force === true, dryRun: args["dry-run"] === true });
    if (res.dryRun || res.collisions.length) { reportWriteResult(res, 'scaffold'); break; }
    console.log(`\nScaffolded ${res.files} entries into ${res.root}`);
    console.log(`  custom audio bridge: ${res.needBridge ? 'YES (' + res.transformCount + ' transforms in audio/bridge.py)' : 'no (passthrough)'}`);
    console.log('\nFast verify: cd ' + res.root + ' && bash install.sh test && . .venv/bin/activate && pytest tests/');
    console.log('Full deps: bash install.sh full (uses uv for parallel downloads when available)');
    console.log('Then implement the TODOs using callsmith.recipe.md + .callsmith/docs/.\n');
    break;
  }
  case 'docs': {
    const raw = readAnswers(args.answers);
    const out = args.out || process.cwd();
    const menu = loadMenu();
    const baseProviders = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers } = await resolveUnknowns(baseProviders, expanded);
    const h = await hydrate(raw, out, { providers, force: args.force === true, dryRun: args["dry-run"] === true });
    if (h.dryRun || h.collisions.length) { reportWriteResult(h, 'docs'); break; }
    const { written, ids } = h;
    console.log(`\nWrote docs context for: ${ids.join(', ')}`);
    console.log('  ' + written.join('\n  '));
    console.log('\nEach file includes frozen pack facts, official links, and Context7 commands for fresh build-time docs.\n');
    break;
  }
  case 'simulate': {
    const raw = readAnswers(args.answers);
    const menu = loadMenu();
    const baseProviders = loadProviders();
    const expanded = expandOrExit(raw, menu);
    const { providers } = await resolveUnknowns(baseProviders, expanded);
    const impossible = detectImpossibilities(expanded, providers);
    if (impossible.length) {
      console.error('\nCannot simulate — the selected stack is impossible:');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
      process.exit(1);
    }
    const out = args.out || process.cwd();
    const report = simulate(raw, out, { providers, scaffoldDir: args.scaffold, force: args.force === true, dryRun: args["dry-run"] === true });
    if (report.dryRun) { console.log('\n[dry-run] simulate would write trace + report into', path.resolve(out), '\nNothing was written.\n'); break; }
    console.log(`\nSimulation ${report.status}: ${report.summary}`);
    console.log(`  trace: ${report.files.trace}`);
    console.log(`  report: ${report.files.report}`);
    console.log(`  first response: ${report.metrics.first_response_ms}ms`);
    console.log(`  events: ${report.events.length}`);
    if (report.failures.length) {
      for (const f of report.failures) console.error(`  [FAIL] ${f}`);
      process.exit(1);
    }
    for (const w of report.warnings) console.log(`  [warn] ${w}`);
    console.log('');
    break;
  }
  case 'verify-packs': {
    const providers = loadProviders();
    const menu = loadMenu();
    const report = verifyPacks(providers, menu);
    if (args.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\nProvider pack verification: ${report.status}`);
      console.log(`  packs: ${report.counts.packs}`);
      console.log(`  checks: ${report.counts.checks}`);
      console.log(`  failures: ${report.failures.length}`);
      console.log(`  warnings: ${report.warnings.length}`);
      for (const f of report.failures) console.error(`  [FAIL] ${f.pack}: ${f.message}`);
      for (const w of report.warnings) console.log(`  [warn] ${w.pack}: ${w.message}`);
      console.log('');
    }
    if (report.failures.length) process.exit(1);
    break;
  }
  case 'release-check': {
    const report = runReleaseCheck({
      fullInstalls: args["full-installs"] === true,
      skipTests: args["skip-tests"] === true,
      skipGeneratedInstall: args["skip-generated-install"] === true,
      dryRun: args["dry-run"] === true,
      json: args.json === true,
    });
    if (args.json) console.log(JSON.stringify(report, null, 2));
    if (report.status === 'FAIL') process.exit(1);
    break;
  }
  case 'context': {
    const recipe = path.join(process.cwd(), 'callsmith.recipe.md');
    const lock = path.join(process.cwd(), 'callsmith.lock.json');
    const has = fs.existsSync(recipe);
    console.log(has
      ? `preflight: PASS — callsmith.recipe.md present (${fs.existsSync(lock) ? 'lock ok' : 'lock MISSING'})`
      : 'preflight: NO_RECIPE — run `callsmith forge --answers <file>` before scaffolding or coding.');
    break;
  }
  default:
    console.error(`error: unknown command "${cmd}". Run \`callsmith --help\` for usage.\n`);
    process.exit(1);
}

function templateAnswers(menu) {
  const answers = {};
  const flags = {};
  for (const g of menu.groups) {
    const visible = whenMatches(g.when, flags);
    answers[g.id] = visible ? g.default : '';
    if (!visible) continue;
    const opt = g.options.find(o => o.id === g.default);
    for (const [k, v] of Object.entries(opt?.maps || {})) {
      if (k !== 'provider' && k !== 'kind') flags[k] = v;
    }
  }
  return answers;
}
