import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadProviders() {
  const dir = path.join(ROOT, 'providers');
  const out = {};
  for (const kindDir of fs.readdirSync(dir)) {
    if (kindDir.startsWith('_')) continue;
    const kindPath = path.join(dir, kindDir);
    if (!fs.statSync(kindPath).isDirectory()) continue;
    for (const f of fs.readdirSync(kindPath).filter(f => f.endsWith('.json'))) {
      const p = JSON.parse(fs.readFileSync(path.join(kindPath, f), 'utf8'));
      out[p.id] = p;
    }
  }
  return out;
}

export function loadMenu() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'menu.json'), 'utf8'));
}

// Does a group's `when` predicate hold against the flags accumulated so far?
function whenMatches(when, flags) {
  if (!when) return true;
  for (const [k, v] of Object.entries(when)) {
    const fv = flags[k];
    if (Array.isArray(v)) { if (!v.includes(fv)) return false; }
    else { if (fv !== v) return false; }
  }
  return true;
}

// Walk the menu in order, honoring each group's `when` predicate against flags
// accumulated so far, and split each chosen option's `maps` into flags + provider selections.
export function expandAnswers(raw, menu) {
  const flags = {};
  const providers = {};
  const labels = {};
  for (const g of menu.groups) {
    if (!whenMatches(g.when, flags)) continue;
    const choice = raw[g.id] ?? g.default;
    const opt = g.options.find(o => o.id === choice);
    if (!opt) continue;
    labels[g.id] = opt.label;
    const maps = opt.maps || {};
    if (maps.provider) providers[maps.kind] = { id: maps.provider, selectedVia: g.id };
    for (const [k, v] of Object.entries(maps)) {
      if (k === 'provider' || k === 'kind') continue;
      flags[k] = v;
    }
  }
  return { flags, providers, labels, raw };
}

// Compute the audio transforms needed to get from `from.egress` to `to.ingest`.
function audioDiff(from, to) {
  const e = from.egress || {};
  const i = to.ingest || {};
  if (!e.format || !i.format || e.format === 'text' || e.format === 'selectable' || i.format === 'text' || i.format === 'selectable') return [];
  const steps = [];
  if (e.format !== i.format) {
    if (e.format === 'mulaw' && (i.format === 'pcm' || i.format === 'linear16')) steps.push('decode mulaw -> PCM');
    else steps.push(`transcode ${e.format} -> ${i.format}`);
  }
  if (e.sample_rate && i.sample_rate && e.sample_rate !== i.sample_rate) {
    steps.push(`resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz`);
  }
  return steps;
}

// The core: reconcile the selected stack into an explicit audio contract + transform list.
export function resolve(answers, providers) {
  const { flags, providers: sel, labels } = answers;
  const mode = flags.mode;
  const needsTelephony = flags.needs_telephony;

  // Build the ordered pipeline of audio-relevant nodes.
  const pipeline = [];
  const telephony = needsTelephony ? providers[sel.telephony.id] : null;
  const orch = sel.orchestration ? providers[sel.orchestration.id] : null;
  if (telephony) pipeline.push({ role: 'telephony', pack: telephony });
  if (orch) pipeline.push({ role: 'orchestration', pack: orch });
  if (mode === 'realtime' || mode === 'hybrid') {
    pipeline.push({ role: 'realtime', pack: providers[sel.realtime.id] });
  }
  if (mode === 'cascaded' || mode === 'hybrid') {
    if (sel.stt) pipeline.push({ role: 'stt', pack: providers[sel.stt.id] });
    if (sel.tts) pipeline.push({ role: 'tts', pack: providers[sel.tts.id] });
  }

  // Adjacent transform computation, honoring native capabilities that absorb work.
  const transforms = [];
  const blockers = [];
  const notes = [];
  const potholes = [];

  for (const node of pipeline) {
    if (!node.pack) continue;
    for (const p of node.pack.potholes || []) potholes.push({ source: node.pack.id, ...p });
  }

  // Inbound path: telephony -> ... -> model/stt
  const head = pipeline[0];
  const sink = pipeline.find(n => n.role === 'realtime' || n.role === 'stt');
  if (telephony && sink) {
    const orchNormalizes = orch && (orch.audio_normalization || (orch.native_capabilities || []).includes('audio_normalization'));
    if (orchNormalizes) {
      notes.push(`Audio normalization (μ-law decode + resample) is handled by ${orch.label} at the edge. Your worker sees ${sink.pack.ingest.sample_rate || ''} ${sink.pack.ingest.format?.toUpperCase()} directly.`);
    } else {
      const steps = audioDiff(telephony, sink.pack);
      for (const s of steps) {
        transforms.push({ direction: 'inbound', step: s, from: telephony.id, to: sink.pack.id });
        if (s.includes('resample') || s.includes('decode')) blockers.push({ severity: 'blocker', note: `Inbound: your bridge must ${s} (${telephony.id} -> ${sink.pack.id}). Without this the model receives malformed audio.` });
      }
    }
  }

  // Outbound path: model/tts -> telephony
  const source = pipeline.find(n => n.role === 'realtime' || n.role === 'tts');
  if (telephony && source) {
    const orchNormalizes = orch && (orch.audio_normalization || (orch.native_capabilities || []).includes('audio_normalization'));
    const ttsEmitsMulaw = source.pack.native_capabilities && source.pack.native_capabilities.includes('emit_mulaw_8000');
    if (orchNormalizes) {
      notes.push(`Outbound resample + μ-law encode is handled by ${orch.label}.`);
    } else if (ttsEmitsMulaw) {
      notes.push(`${source.pack.label} can emit μ-law 8 kHz directly (output_format=ulaw_8000_8). Request it to skip your own encode stage for the ${telephony.id} leg.`);
    } else {
      const steps = audioDiff(source.pack, telephony);
      for (const s of steps) {
        transforms.push({ direction: 'outbound', step: s, from: source.pack.id, to: telephony.id });
        blockers.push({ severity: 'blocker', note: `Outbound: your bridge must ${s} (${source.pack.id} -> ${telephony.id}). Raw ${source.pack.egress.sample_rate} Hz output will corrupt the telephony playback.` });
      }
    }
  }

  // Realtime asymmetry check
  if (mode === 'realtime' || mode === 'hybrid') {
    const rt = providers[sel.realtime.id];
    if (rt && rt.ingest && rt.egress && rt.ingest.sample_rate !== rt.egress.sample_rate) {
      notes.push(`${rt.label} uses asymmetric rates (${rt.ingest.sample_rate} Hz in, ${rt.egress.sample_rate} Hz out). Build two independent resamplers.`);
    }
  }

  // Env keys
  const envKeys = [];
  for (const node of pipeline) if (node.pack) envKeys.push(...(node.pack.env_keys || []));

  // barge-in
  if (flags.barge_in === true || flags.barge_in === 'optional') {
    notes.push('Barge-in enabled: on interruption, flush outbound buffer and cancel in-flight model/TTS output before resuming.');
  }

  return {
    stack: { flags, providers: sel, labels },
    pipeline: pipeline.map(n => ({ role: n.role, id: n.pack?.id, label: n.pack?.label })),
    transforms,
    potholes,
    blockers,
    notes,
    envKeys: [...new Set(envKeys)],
  };
}

// Detect stacks that are genuinely impossible — forge refuses these.
export function detectImpossibilities(answers, providers) {
  const { flags, providers: sel } = answers;
  const impossible = [];

  for (const [role, selection] of Object.entries(sel)) {
    if (role === 'llm') continue;
    if (selection && selection.id && !providers[selection.id]) {
      impossible.push({
        code: 'unknown_provider',
        message: `"${selection.id}" was selected for ${role} but no provider pack is installed.`,
      });
    }
  }

  if (flags.needs_telephony && !sel.telephony) {
    impossible.push({ code: 'missing_leg', message: 'This surface requires a telephony provider but none was selected.' });
  }
  if ((flags.mode === 'realtime' || flags.mode === 'hybrid') && !sel.realtime) {
    impossible.push({ code: 'missing_leg', message: 'Realtime architecture requires a realtime model but none was selected.' });
  }
  if (flags.mode === 'cascaded' || flags.mode === 'hybrid') {
    if (!sel.stt) impossible.push({ code: 'missing_leg', message: 'Cascaded architecture requires an STT provider but none was selected.' });
    if (!sel.tts) impossible.push({ code: 'missing_leg', message: 'Cascaded architecture requires a TTS provider but none was selected.' });
  }

  if (flags.needs_telephony && sel.telephony && providers[sel.telephony.id]) {
    const telPack = providers[sel.telephony.id];
    if (telPack.directions && flags.direction && !telPack.directions.includes(flags.direction)) {
      impossible.push({ code: 'direction_mismatch', message: `${telPack.label} does not support ${flags.direction} calls (supports: ${telPack.directions.join(', ')}).` });
    }
  }

  return impossible;
}
