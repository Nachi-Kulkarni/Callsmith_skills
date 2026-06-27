#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { compile } from '../src/lib/compile.mjs';
import { loadMenu, loadProviders, expandAnswers, resolve, detectImpossibilities } from '../src/lib/resolver.mjs';
import { resolveUnknowns } from '../src/lib/registry.mjs';
import { scaffold } from '../src/lib/scaffold.mjs';
import { hydrate } from '../src/lib/docs.mjs';

const VERSION = '1.1.0';

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
  callsmith forge --answers <file> [--out dir]   Compile answers into a recipe + lock + context
  callsmith check --answers <file>          Print the compatibility matrix (no files written)
  callsmith scaffold --answers <file> [--out dir]  Generate the framework-native repo skeleton
  callsmith docs --answers <file> [--out dir]  Hydrate provider docs into .callsmith/docs/
  callsmith context                         Preflight: report whether a recipe is loaded here
  callsmith --version                       Print version

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
      console.log(`  ${i + 1}. ${o.label}${d}`);
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
  case '--version':
  case '-v': {
    console.log(`callsmith v${VERSION}`);
    break;
  }
  case 'spec': {
    const menu = loadMenu();
    if (process.stdin.isTTY && !args.answers) {
      const answers = await interactiveSpec(menu);
      const json = JSON.stringify(answers, null, 2);
      console.log('\nAnswers:\n' + json);
      console.log('\nNext: callsmith forge --answers <file>   (save the JSON above to a file first)');
    } else if (args.answers) {
      const lines = ['{'];
      for (const g of menu.groups) lines.push(`  "${g.id}": "${g.default}",`);
      lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
      lines.push('}');
      fs.writeFileSync(args.answers, lines.join('\n') + '\n');
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
    const expanded = expandAnswers(raw, menu);
    const { providers: resolvedProviders, resolved } = await resolveUnknowns(providers, expanded);
    const impossible = detectImpossibilities(expanded, resolvedProviders);
    if (impossible.length) {
      console.error('\nCannot forge — the selected stack is impossible:');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
      console.error('\nRun `callsmith check` or fix your answers file.');
      process.exit(1);
    }
    const out = args.out || process.cwd();
    const { result, files } = compile(raw, out, { providers: resolvedProviders, resolved });
    console.log(`\nForged recipe into ${path.resolve(out)}`);
    console.log('  ' + files.join('\n  '));
    console.log(`\n  stack: ${result.pipeline.map(p => p.label || p.id).join(' -> ')}`);
    console.log(`  custom bridge required: ${result.transforms.length ? 'YES (' + result.transforms.length + ' transforms)' : 'no'}`);
    console.log(`  blockers: ${result.blockers.length}   potholes: ${result.potholes.length}`);
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
    const expanded = expandAnswers(raw, menu);
    const { providers: resolvedProviders, resolved } = await resolveUnknowns(providers, expanded);
    const impossible = detectImpossibilities(expanded, resolvedProviders);
    if (impossible.length) {
      console.error('\nImpossible stack:');
      for (const i of impossible) console.error(`  [${i.code}] ${i.message}`);
      console.error('');
      process.exit(1);
    }
    const result = resolve(expanded, resolvedProviders);
    console.log('\nCompatibility matrix');
    console.log('  stack:', result.pipeline.map(p => p.label || p.id).join(' -> '));
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
    const expanded = expandAnswers(raw, menu);
    const { providers } = await resolveUnknowns(baseProviders, expanded);
    const out = args.out || path.join(process.cwd(), 'voice-agent');
    const res = scaffold(raw, out, { providers });
    console.log(`\nScaffolded ${res.files} top-level entries into ${path.resolve(out)}`);
    console.log(`  custom audio bridge: ${res.needBridge ? 'YES (' + res.transformCount + ' transforms in audio/bridge.py)' : 'no (passthrough)'}`);
    console.log('\nVerify with: pip install -r requirements-test.txt && pytest tests/');
    console.log('Full deps: pip install -r requirements.txt (includes provider SDKs)');
    console.log('Then implement the TODOs using callsmith.recipe.md + .callsmith/docs/.\n');
    break;
  }
  case 'docs': {
    const raw = readAnswers(args.answers);
    const out = args.out || process.cwd();
    const menu = loadMenu();
    const baseProviders = loadProviders();
    const expanded = expandAnswers(raw, menu);
    const { providers } = await resolveUnknowns(baseProviders, expanded);
    const { written, ids } = await hydrate(raw, out, { providers });
    console.log(`\nHydrated docs for: ${ids.join(', ')}`);
    console.log('  ' + written.join('\n  '));
    console.log('\nThe Context7 commands inside each file fetch fresh docs at build time.\n');
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
    if (cmd) console.error(`error: unknown command "${cmd}"\n`);
    process.stdout.write(HELP);
    process.exit(1);
}
