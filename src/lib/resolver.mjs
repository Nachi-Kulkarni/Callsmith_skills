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

function whenMatches(when, flags) {
  if (!when) return true;
  for (const [k, v] of Object.entries(when)) {
    const fv = flags[k];
    if (Array.isArray(v)) { if (!v.includes(fv)) return false; }
    else { if (fv !== v) return false; }
  }
  return true;
}

export function expandAnswers(raw, menu) {
  const flags = {};
  const providers = {};
  const labels = {};
  for (const g of menu.groups) {
    if (!whenMatches(g.when, flags)) continue;
    const choice = raw[g.id] ?? g.default;
    const opt = g.options.find(o => o.id === choice);
    if (!opt) {
      const kindHolder = g.options.find(o => o.maps?.kind);
      if (kindHolder && typeof choice === 'string' && choice) {
        providers[kindHolder.maps.kind] = { id: choice, selectedVia: g.id };
        labels[g.id] = choice;
      }
      continue;
    }
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

function audioDiff(from, to) {
  const e = from.egress || {};
  const i = to.ingest || {};
  if (!e.format || !i.format || e.format === 'text' || e.format === 'selectable' || i.format === 'text' || i.format === 'selectable' || e.format === 'pcm-events' || i.format === 'pcm-events') return [];
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

export function resolve(answers, providers) {
  const { flags, providers: sel, labels } = answers;
  const mode = flags.mode;
  const needsTelephony = flags.needs_telephony;

  const pipeline = [];
  const telephony = needsTelephony && sel.telephony ? providers[sel.telephony.id] : null;
  const orch = sel.orchestration ? providers[sel.orchestration.id] : null;
  const vad = sel.vad ? providers[sel.vad.id] : null;
  if (telephony) pipeline.push({ role: 'telephony', pack: telephony });
  if (orch) pipeline.push({ role: 'orchestration', pack: orch });
  if (vad) pipeline.push({ role: 'vad', pack: vad });
  if (mode === 'realtime' || mode === 'hybrid') {
    pipeline.push({ role: 'realtime', pack: providers[sel.realtime.id] });
  }
  if (mode === 'cascaded' || mode === 'hybrid') {
    if (sel.stt) pipeline.push({ role: 'stt', pack: providers[sel.stt.id] });
    if (sel.llm) pipeline.push({ role: 'llm', pack: providers[sel.llm.id] });
    if (sel.tts) pipeline.push({ role: 'tts', pack: providers[sel.tts.id] });
  }

  const transforms = [];
  const blockers = [];
  const notes = [];
  const potholes = [];

  for (const node of pipeline) {
    if (!node.pack) continue;
    for (const p of node.pack.potholes || []) potholes.push({ source: node.pack.id, ...p });
  }

  const head = pipeline[0];
  const sink = pipeline.find(n => n.role === 'realtime' || n.role === 'stt');
  if (telephony && sink) {
    const orchNormalizes = orch && (orch.native_capabilities || []).includes('audio_normalization');
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

  const source = pipeline.find(n => n.role === 'realtime' || n.role === 'tts');
  if (telephony && source) {
    const orchNormalizes = orch && (orch.native_capabilities || []).includes('audio_normalization');
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

  if (mode === 'realtime' || mode === 'hybrid') {
    const rt = providers[sel.realtime.id];
    if (rt && rt.ingest && rt.egress && rt.ingest.sample_rate !== rt.egress.sample_rate) {
      notes.push(`${rt.label} uses asymmetric rates (${rt.ingest.sample_rate} Hz in, ${rt.egress.sample_rate} Hz out). Build two independent resamplers.`);
    }
  }

  const envKeys = [];
  for (const node of pipeline) if (node.pack) envKeys.push(...(node.pack.env_keys || []));

  if (flags.barge_in === true || flags.barge_in === 'optional') {
    notes.push('Barge-in enabled: on interruption, flush outbound buffer and cancel in-flight model/TTS output before resuming.');
  }

  const interruption = resolveInterruption(sel, providers, flags);
  const latency = computeLatencyBudget(sel, providers, flags);

  return {
    stack: { flags, providers: sel, labels },
    pipeline: pipeline.map(n => ({ role: n.role, id: n.pack?.id, label: n.pack?.label })),
    transforms,
    potholes,
    blockers,
    notes,
    envKeys: [...new Set(envKeys)],
    interruption,
    latency,
  };
}

export function resolveInterruption(sel, providers, flags) {
  if (flags.barge_in === false) {
    return { enabled: false, steps: [] };
  }
  const steps = [];
  const order = ['vad', 'realtime', 'stt', 'orchestration', 'llm', 'tts', 'telephony'];
  const layerLabels = {
    vad: 'Speech Detection',
    realtime: 'Realtime Model',
    stt: 'Turn Endpointing',
    orchestration: 'Pipeline Cancellation',
    llm: 'LLM Stream Cancel',
    tts: 'TTS Output Stop',
    telephony: 'Media Playback Stop',
  };
  for (const role of order) {
    const selection = sel[role];
    if (!selection || !selection.id) continue;
    const pack = providers[selection.id];
    if (!pack || !pack.interruption) continue;
    steps.push({
      layer: layerLabels[role] || role,
      provider: pack.id,
      mechanism: pack.interruption.mechanism,
      detail: pack.interruption.description,
      code: pack.interruption.code_hint,
    });
  }
  return { enabled: true, steps };
}

export function computeLatencyBudget(sel, providers, flags) {
  const legs = [];
  let total_ms = 0;

  const add = (label, ms) => {
    if (ms && ms > 0) {
      legs.push({ label, ms });
      total_ms += ms;
    }
  };

  const tel = sel.telephony ? providers[sel.telephony.id] : null;
  const orch = sel.orchestration ? providers[sel.orchestration.id] : null;
  const vad = sel.vad ? providers[sel.vad.id] : null;
  const rt = sel.realtime ? providers[sel.realtime.id] : null;
  const stt = sel.stt ? providers[sel.stt.id] : null;
  const llm = sel.llm ? providers[sel.llm.id] : null;
  const tts = sel.tts ? providers[sel.tts.id] : null;

  if (tel?.latency_estimates?.media_rtt_ms) add('Telephony media round-trip', tel.latency_estimates.media_rtt_ms);
  if (orch?.latency_estimates?.pipeline_overhead_ms) add('Orchestration pipeline overhead', orch.latency_estimates.pipeline_overhead_ms);
  if (vad?.latency_estimates?.processing_ms) add('VAD processing', vad.latency_estimates.processing_ms);

  if (flags.mode === 'realtime' || flags.mode === 'hybrid') {
    if (rt?.latency_estimates?.response_start_ms) add('Realtime model response start', rt.latency_estimates.response_start_ms);
  }
  if (flags.mode === 'cascaded' || flags.mode === 'hybrid') {
    if (stt?.latency_estimates?.ttf_transcript_ms) add('STT time to first transcript', stt.latency_estimates.ttf_transcript_ms);
    if (llm?.latency_estimates?.ttft_ms) add('LLM time to first token', llm.latency_estimates.ttft_ms);
    if (tts?.latency_estimates?.ttfa_ms) add('TTS time to first audio', tts.latency_estimates.ttfa_ms);
  }

  const target = flags.latency === 'ultra' ? 500 : flags.latency === 'balanced' ? 800 : 1200;
  const verdict = total_ms <= target ? 'within target' : total_ms <= target * 1.5 ? 'borderline' : 'exceeds target';

  return { legs, total_ms, target_ms: target, verdict };
}

export function detectImpossibilities(answers, providers) {
  const { flags, providers: sel } = answers;
  const impossible = [];

  for (const [role, selection] of Object.entries(sel)) {
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
    if (!sel.llm) impossible.push({ code: 'missing_leg', message: 'Cascaded architecture requires an LLM provider but none was selected.' });
  }

  if (flags.needs_telephony && sel.telephony && providers[sel.telephony.id]) {
    const telPack = providers[sel.telephony.id];
    if (telPack.directions && flags.direction && !telPack.directions.includes(flags.direction)) {
      impossible.push({ code: 'direction_mismatch', message: `${telPack.label} does not support ${flags.direction} calls (supports: ${telPack.directions.join(', ')}).` });
    }
  }

  return impossible;
}
