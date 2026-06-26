import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';

function w(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

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

export async function hydrate(rawAnswers, outDir) {
  const menu = loadMenu();
  const providers = loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const root = path.resolve(outDir);
  const docsDir = path.join(root, '.callsmith', 'docs');

  const ids = result.pipeline.filter(p => p.id).map(p => p.id);
  const written = [];

  // Index
  const indexLines = ['# Hydrated docs index', '', 'Per-provider context for the selected stack.', ''];
  for (const id of ids) {
    const pack = providers[id];
    if (!pack) continue;
    const md = renderProviderDoc(pack, answers.flags);
    const file = path.join(docsDir, `${id}.md`);
    w(file, md);
    written.push(`.callsmith/docs/${id}.md`);

    // best-effort live fetch of the first doc url
    if (pack.doc_urls && pack.doc_urls[0]) {
      const fetched = await tryFetch(pack.doc_urls[0]);
      if (fetched) w(path.join(docsDir, `${id}.fetched.md`), `<!-- fetched from ${pack.doc_urls[0]} -->\n\n${fetched}\n`);
    }

    indexLines.push(`- [${pack.label}](${id}.md) — ${pack.kind}`);
  }
  w(path.join(docsDir, 'README.md'), indexLines.join('\n') + '\n');
  written.push('.callsmith/docs/README.md');
  return { written, ids };
}

function renderProviderDoc(pack, flags) {
  const L = [];
  L.push(`# ${pack.label}`);
  L.push('');
  L.push(`> Contract slice frozen by callsmith at hydration time. Verify against the live API before shipping.`);
  L.push('');
  L.push('## Audio contract');
  L.push('');
  L.push(`- **ingest:** ${fmt(pack.ingest)}`);
  L.push(`- **egress:** ${fmt(pack.egress)}`);
  L.push(`- **transport:** ${pack.transport}`);
  if (pack.model) L.push(`- **model:** \`${pack.model}\``);
  L.push('');
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
  L.push('## Required env');
  L.push('');
  L.push('```bash');
  for (const k of pack.env_keys || []) L.push(`${k}=`);
  L.push('```');
  L.push('');
  if (pack.doc_urls && pack.doc_urls.length) {
    L.push('## Official docs');
    L.push('');
    for (const u of pack.doc_urls) L.push(`- ${u}`);
    L.push('');
  }
  if (pack.context7 && pack.context7.library_id) {
    L.push('## Context7 hydration (run at build time for fresh docs)');
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
