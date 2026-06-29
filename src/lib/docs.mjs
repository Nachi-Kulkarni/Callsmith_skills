import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';
import { createSafeWriter } from './safe-write.mjs';

const FETCH_TIMEOUT_MS = 4000;

async function tryFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) return null;
    const text = await res.text();
    // SPA doc sites dump giant nav HTML; skip if it looks like that.
    if (text.length > 60000 && (text.match(/<a /g) || []).length > 200) return null;
    return text.slice(0, 8000);
  } catch {
    return null;
  }
}

export async function hydrate(rawAnswers, outDir, opts = {}) {
  const menu = loadMenu();
  const providers = opts.providers ?? loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const writer = createSafeWriter(outDir, { force: opts.force === true, dryRun: opts.dryRun === true });
  const w = (rel, content) => writer.w(rel, content);

  const ids = result.pipeline.filter(p => p.id).map(p => p.id);
  const written = [];

  // Index
  const indexLines = ['# Provider Docs Context', '', 'Per-provider frozen facts, official links, and Context7 prompts for the selected stack.', ''];
  for (const id of ids) {
    const pack = providers[id];
    if (!pack) continue;
    const md = renderProviderDoc(pack, answers.flags);
    w(`.callsmith/docs/${id}.md`, md);
    written.push(`.callsmith/docs/${id}.md`);

    // best-effort live fetch of the first doc url
    if (!writer.dryRun && pack.doc_urls && pack.doc_urls[0]) {
      const fetched = await tryFetch(pack.doc_urls[0]);
      if (fetched) w(`.callsmith/docs/${id}.fetched.md`, `<!-- fetched from ${pack.doc_urls[0]} -->\n\n${fetched}\n`);
    }

    indexLines.push(`- [${pack.label}](${id}.md) — ${pack.kind}`);
  }
  w('.callsmith/docs/README.md', indexLines.join('\n') + '\n');
  written.push('.callsmith/docs/README.md');
  return {
    written,
    ids,
    root: writer.root,
    collisions: writer.collisions,
    overwritten: writer.overwritten,
    manifest: writer.manifest,
    dryRun: writer.dryRun,
  };
}

function renderProviderDoc(pack, flags) {
  const L = [];
  L.push(`# ${pack.label}`);
  L.push('');
  L.push(`> Contract slice frozen by callsmith. Use the official links and Context7 commands below to verify against the live API before shipping.`);
  L.push('');
  L.push('## Audio contract');
  L.push('');
  L.push(`- **ingest:** ${fmt(pack.ingest)}`);
  L.push(`- **egress:** ${fmt(pack.egress)}`);
  L.push(`- **transport:** ${pack.transport}`);
  if (pack.model) L.push(`- **model:** \`${pack.model}\``);
  L.push('');
  if (pack.latency_estimates) {
    L.push('## Latency estimate');
    L.push('');
    const le = pack.latency_estimates;
    const entries = Object.entries(le);
    for (const [k, v] of entries) L.push(`- **${k}:** ${v} ms`);
    L.push('');
  }
  if (pack.interruption) {
    L.push('## Interruption');
    L.push('');
    L.push(`- **mechanism:** \`${pack.interruption.mechanism}\``);
    L.push(`- **description:** ${pack.interruption.description}`);
    if (pack.interruption.code_hint) L.push(`- **code:** \`${pack.interruption.code_hint}\``);
    L.push('');
  }
  L.push('## Lifecycle events');
  L.push('');
  for (const e of pack.lifecycle || []) L.push(`- \`${e}\``);
  L.push('');
  if (pack.potholes && pack.potholes.length) {
    L.push('## Potholes (from the pack)');
    L.push('');
    for (const p of pack.potholes) L.push(`- **[${p.severity}]** ${p.note}`);
    L.push('');
  }
  if (pack.env_keys && pack.env_keys.length) {
    L.push('## Required env');
    L.push('');
    L.push('```bash');
    for (const k of pack.env_keys) L.push(`${k}=`);
    L.push('```');
    L.push('');
  }
  if (pack.doc_urls && pack.doc_urls.length) {
    L.push('## Official docs');
    L.push('');
    for (const u of pack.doc_urls) L.push(`- ${u}`);
    L.push('');
  }
  if (pack.context7 && pack.context7.library_id) {
    L.push('## Context7 prompts (run at build time for fresh docs)');
    L.push('');
    L.push('```bash');
    L.push(`# resolve once`);
    L.push(`ctx7 library "${pack.context7.library_id}" "<topic>"`);
    for (const t of pack.context7.topics || []) {
      L.push(`ctx7 docs ${pack.context7.library_id} "${t}"`);
    }
    L.push('```');
  }
  return L.join('\n') + '\n';
}

function fmt(a) {
  if (!a) return '—';
  if (a.format === 'text') return 'text (no audio)';
  if (a.format === 'selectable') return 'selectable format (see pack)';
  return `${a.format} @ ${a.sample_rate} Hz, ${a.channels}ch` + (a.bit_depth ? `, ${a.bit_depth}-bit` : '');
}
