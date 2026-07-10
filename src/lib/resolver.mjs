import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Provider ids enter check output and agent-facing notes. A malicious answers.json
// is the realistic attack vector, so ids are validated at this boundary.
// Lowercase-kebab is the documented pack convention; we permit digits and dashes.
const PROVIDER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function validateProviderId(id) {
  if (typeof id !== 'string' || !PROVIDER_ID_RE.test(id)) {
    throw new Error(
      `Invalid provider id "${safeEcho(id)}". ` +
      `Provider ids must be 1-64 characters of [A-Za-z0-9_-] (no spaces, slashes, quotes, or control chars).`
    );
  }
  return id;
}

// Strip control chars (incl. ANSI escapes / newlines) so untrusted input echoed into
// Error messages and CLI output cannot spoof logs or clear the terminal.
function safeEcho(value) {
  return String(value).replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 80);
}

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

export function expandAnswers(raw, menu, opts = {}) {
  const strict = opts.strict === true;
  const flags = {};
  const providers = {};
  const labels = {};
  const visible = new Set();
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(raw, key);
  for (const g of menu.groups) {
    if (!whenMatches(g.when, flags)) continue;
    visible.add(g.id);
    const hasChoice = hasOwn(g.id);
    if (strict && !hasChoice && g.required !== false) {
      throw new Error(`Missing required answer for "${g.id}" (needed for check expand). Provide the group or relax to non-strict answers.`);
    }
    const choice = hasChoice ? raw[g.id] : g.default;
    if (strict && g.required !== false && (choice === '' || choice === null || choice === undefined)) {
      throw new Error(`Missing required answer for "${g.id}".`);
    }
    const opt = g.options.find(o => o.id === choice);
    if (!opt) {
      const kindHolder = g.options.find(o => o.maps?.kind);
      if (kindHolder && typeof choice === 'string' && choice) {
        validateProviderId(choice);
        providers[kindHolder.maps.kind] = { id: choice, selectedVia: g.id };
        labels[g.id] = choice;
      }
      if (!kindHolder && choice !== '' && choice !== null && choice !== undefined) {
        throw new Error(`Invalid answer for "${safeEcho(g.id)}": "${safeEcho(choice)}". Expected one of: ${g.options.map(o => o.id).join(', ')}`);
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
  if (strict) {
    const known = new Set(menu.groups.map(g => g.id));
    for (const [key, value] of Object.entries(raw)) {
      if (!known.has(key)) {
        throw new Error(`Unknown answer key "${safeEcho(key)}". Expected one of: ${menu.groups.map(g => g.id).join(', ')}`);
      }
      if (!visible.has(key) && value !== '' && value !== null && value !== undefined) {
        throw new Error(`Answer "${safeEcho(key)}" is not valid for the selected route. Remove it or change the earlier choices that make this group visible.`);
      }
    }
  }
  return { flags, providers, labels, raw };
}

const PCM_FORMATS = new Set(['pcm', 'linear16']);
const AUDIO_SENTINELS = new Set(['text', 'selectable', 'pcm-events']);

function isPcm(format) {
  return PCM_FORMATS.has(format);
}

function isAudioSentinel(format) {
  return !format || AUDIO_SENTINELS.has(format);
}

function planAudioDiff(from, to) {
  const e = from.egress || {};
  const i = to.ingest || {};
  if (isAudioSentinel(e.format) || isAudioSentinel(i.format)) return { steps: [], unsupported: [] };
  const steps = [];
  const unsupported = [];
  const ratesDiffer = e.sample_rate && i.sample_rate && e.sample_rate !== i.sample_rate;

  if (e.format === 'mulaw' && isPcm(i.format)) {
    steps.push('decode mulaw -> PCM');
    if (ratesDiffer) steps.push(`resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz`);
  } else if (isPcm(e.format) && i.format === 'mulaw') {
    if (ratesDiffer) steps.push(`resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz`);
    steps.push('encode PCM -> mulaw');
  } else if (isPcm(e.format) && isPcm(i.format)) {
    if (ratesDiffer) steps.push(`resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz`);
    if (e.format !== i.format) steps.push(`normalize ${e.format} -> ${i.format}`);
  } else if (e.format !== i.format) {
    const step = `transcode ${e.format} -> ${i.format}`;
    steps.push(step);
    unsupported.push(step);
  } else if (ratesDiffer) {
    const step = `resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz for ${e.format}`;
    steps.push(`resample ${e.sample_rate} Hz -> ${i.sample_rate} Hz`);
    unsupported.push(step);
  }

  return { steps, unsupported };
}

// Single source of truth for the telephony audio-path gate. Consumed by both resolve()
// (transforms/blockers view) and detectImpossibilities() (impossibility view) so the
// inbound/outbound gate logic cannot drift between them.
function audioPathGate({ telephony, orch, sink, source }) {
  const orchNormalizes = !!(orch && (orch.native_capabilities || []).includes('audio_normalization'));
  const telephonyAcceptsMulaw8k = !!telephony
    && telephony.ingest?.format === 'mulaw'
    && telephony.ingest?.sample_rate === 8000;
  const sourceEmitsMulaw = !!(source
    && (source.native_capabilities || []).includes('emit_mulaw_8000')
    && telephonyAcceptsMulaw8k);
  const inbound = (!orchNormalizes && telephony && sink)
    ? planAudioDiff(telephony, sink)
    : { steps: [], unsupported: [] };
  const outbound = (!orchNormalizes && !sourceEmitsMulaw && telephony && source)
    ? planAudioDiff(source, telephony)
    : { steps: [], unsupported: [] };
  return { orchNormalizes, sourceEmitsMulaw, telephonyAcceptsMulaw8k, inbound, outbound };
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

  // Compute active native capabilities across the selected stack so potholes can be
  // downgraded to 'mitigated' when a native layer resolves the concern they warn about.
  // This separates "still required in user code" from "resolved by the orchestration layer"
  // and is the single mechanism that prevents audio-contract contradictions.
  const activeCapabilities = new Map();
  for (const node of pipeline) {
    if (!node.pack) continue;
    for (const cap of node.pack.native_capabilities || []) {
      if (!activeCapabilities.has(cap)) activeCapabilities.set(cap, []);
      activeCapabilities.get(cap).push({ role: node.role, id: node.pack.id, label: node.pack.label });
    }
  }
  for (const p of potholes) {
    const caps = p.mitigated_by || [];
    if (!caps.length) continue;
    const match = caps.find(c => activeCapabilities.has(c));
    if (match) {
      const layer = activeCapabilities.get(match)[0];
      p.mitigated = true;
      p.mitigatedBy = layer.label;
      p.mitigatedByCapability = match;
    }
  }

  const head = pipeline[0];
  const sink = pipeline.find(n => n.role === 'realtime' || n.role === 'stt');
  const source = pipeline.find(n => n.role === 'realtime' || n.role === 'tts');
  const gate = (telephony && (sink || source))
    ? audioPathGate({ telephony, orch, sink: sink?.pack, source: source?.pack })
    : { orchNormalizes: false, sourceEmitsMulaw: false, telephonyAcceptsMulaw8k: false, inbound: { steps: [], unsupported: [] }, outbound: { steps: [], unsupported: [] } };
  if (telephony && (sink || source)) {
    if (sink) {
      if (gate.orchNormalizes) {
        notes.push(`Audio normalization (μ-law decode + resample) is handled by ${orch.label} at the edge. Your worker sees ${sink.pack.ingest.sample_rate || ''} ${sink.pack.ingest.format?.toUpperCase()} directly.`);
      } else {
        for (const s of gate.inbound.steps) {
          transforms.push({ direction: 'inbound', step: s, from: telephony.id, to: sink.pack.id });
          blockers.push({ severity: 'blocker', note: `Inbound: your bridge must ${s} (${telephony.id} -> ${sink.pack.id}). Without this the model receives malformed audio.` });
        }
      }
    }

    if (source) {
      if (gate.orchNormalizes) {
        notes.push(`Outbound resample + μ-law encode is handled by ${orch.label}.`);
      } else if (gate.sourceEmitsMulaw) {
        notes.push(`${source.pack.label} can emit μ-law 8 kHz directly (output_format=ulaw_8000_8). Request it to skip your own encode stage for the ${telephony.id} leg.`);
      } else {
        for (const s of gate.outbound.steps) {
          transforms.push({ direction: 'outbound', step: s, from: source.pack.id, to: telephony.id });
          blockers.push({ severity: 'blocker', note: `Outbound: your bridge must ${s} (${source.pack.id} -> ${telephony.id}). Raw ${source.pack.egress.sample_rate} Hz output will corrupt the telephony playback.` });
        }
      }
    }
  }

  if (mode === 'realtime' || mode === 'hybrid') {
    const rt = providers[sel.realtime.id];
    if (rt && rt.ingest && rt.egress && rt.ingest.sample_rate !== rt.egress.sample_rate) {
      // Do not contradict the native-layer message above. When the orchestration layer
      // normalizes audio, the asymmetric rate conversion is handled internally by its
      // plugin; the user does NOT build resamplers. Only emit the action item otherwise.
      if (gate.orchNormalizes) {
        notes.push(`${rt.label} uses asymmetric rates (${rt.ingest.sample_rate} Hz in, ${rt.egress.sample_rate} Hz out); the ${orch.label} plugin converts between them internally — no resamplers in your code.`);
      } else {
        notes.push(`${rt.label} uses asymmetric rates (${rt.ingest.sample_rate} Hz in, ${rt.egress.sample_rate} Hz out). Build two independent resamplers.`);
      }
    }
  }

  const envKeys = [];
  for (const node of pipeline) if (node.pack) envKeys.push(...(node.pack.env_keys || []));

  if (flags.barge_in === true || flags.barge_in === 'optional') {
    notes.push('Barge-in enabled: on interruption, flush outbound buffer and cancel in-flight model/TTS output before resuming.');
  }

  const interruption = resolveInterruption(sel, providers, flags);
  const latency = computeLatencyBudget(sel, providers, flags);
  const operations = resolveOperationsConfig(sel, providers, flags);
  const cost = computeCost(sel, providers, flags, operations);

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
    operations,
    cost,
  };
}

export function resolveOperationsConfig(sel, providers, flags) {
  const requestedHosting = flags.hosting_model || 'managed_cloud';
  const orchId = sel.orchestration?.id || null;
  const orch = orchId ? providers[orchId] : null;
  let effectiveHosting = requestedHosting;
  const adjustments = [];

  if (orchId === 'custom-fastapi' && requestedHosting !== 'self_hosted') {
    effectiveHosting = 'self_hosted';
    adjustments.push('Custom FastAPI forces self-hosted ownership: your app owns the media WebSocket, codecs, resampling, cleanup, and incident debugging.');
  } else if (orchId === 'pipecat' && requestedHosting === 'managed_cloud') {
    effectiveHosting = 'hybrid_worker';
    adjustments.push('Pipecat runs as your worker process. Provider APIs can be hosted, but deploys, scaling, traces, and frame-level debugging belong to your team.');
  }

  const hostingLabels = {
    managed_cloud: 'Managed cloud',
    hybrid_worker: 'Cloud edge + self-hosted worker',
    self_hosted: 'Self-hosted',
  };
  const ownerLabels = {
    managed_cloud: 'provider/cloud',
    hybrid_worker: 'shared: provider edge, your worker',
    self_hosted: 'your application/team',
  };

  const responsibilities = [];
  if (effectiveHosting === 'managed_cloud') {
    responsibilities.push('Use provider/framework-native media features first; keep app code focused on business logic, tools, safety, and observability.');
    responsibilities.push('Validate provider-side settings for SIP/WebRTC routing, recording, noise suppression, turn detection, and billing before launch.');
  } else if (effectiveHosting === 'hybrid_worker') {
    responsibilities.push('Own worker deploys, autoscaling, health checks, trace retention, and framework upgrades.');
    responsibilities.push('Use the orchestration framework for audio normalization and interruption, but keep provider event traces for every call.');
  } else {
    responsibilities.push('Own media WebSocket lifecycle, audio codecs, resampling, VAD, noise/echo cleanup, outbound queue flushing, and scaling.');
    responsibilities.push('Add load tests and frame-level diagnostics before connecting production numbers.');
  }

  const audioOwner = effectiveHosting === 'managed_cloud'
    ? 'provider/framework native layer'
    : effectiveHosting === 'hybrid_worker'
    ? 'framework in your worker, with provider edge support'
    : 'your application code';
  const audioEnhancement = flags.audio_enhancement || 'provider_native';
  const audioFeatures = [
    {
      feature: 'Noise suppression',
      mode: flags.noise_cancellation || 'standard',
      owner: audioOwner,
      action: audioEnhancement === 'raw_low_latency'
        ? 'Keep disabled unless real calls show noise problems.'
        : 'Enable the native provider/framework option when available; otherwise document the fallback in voice_ux.py.',
    },
    {
      feature: 'Echo cancellation',
      mode: flags.echo_cancellation || 'provider_native',
      owner: audioOwner,
      action: effectiveHosting === 'self_hosted'
        ? 'Add explicit echo-cancellation/DSP middleware or constrain devices to headset/browser WebRTC paths.'
        : 'Prefer WebRTC/provider acoustic echo cancellation for browser/app calls; PSTN echo mostly depends on carrier path and playback buffering.',
    },
    {
      feature: 'Automatic gain control',
      mode: flags.automatic_gain_control || 'provider_native',
      owner: audioOwner,
      action: 'Keep gain changes observable; sudden AGC shifts can create false VAD/barge-in triggers.',
    },
  ];

  const debugProfile = flags.debug_profile || 'production_trace';
  const traceLevel = flags.trace_level || 'timeline';
  const retainDebugAudioSec = flags.retain_debug_audio_sec ?? 0;
  const traceSampling = flags.trace_sampling ?? 1;
  const debugNotes = {
    production_trace: 'Per-call timeline traces are required for launch: turn starts/ends, barge-in, media clear, STT/LLM/TTS first latency, tools, reconnects, dropped frames, and cost.',
    forensic: 'Frame-level and short-window audio capture are enabled for hard production bugs. Gate this behind consent, retention, and PII controls.',
    lean: 'Lean metrics reduce cost/noise, but make barge-in, echo, and provider timing bugs harder to reproduce.',
  };

  return {
    requested_hosting_model: requestedHosting,
    effective_hosting_model: effectiveHosting,
    hosting_label: hostingLabels[effectiveHosting] || effectiveHosting,
    infrastructure_owner: ownerLabels[effectiveHosting] || 'unknown',
    orchestration: orch?.label || orchId,
    adjustments,
    responsibilities,
    debug_profile: debugProfile,
    trace_level: traceLevel,
    trace_sampling: traceSampling,
    retain_debug_audio_sec: retainDebugAudioSec,
    debug_note: debugNotes[debugProfile] || debugNotes.production_trace,
    audio_enhancement: audioEnhancement,
    audio_features: audioFeatures,
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

  const add = (label, ms, pack, metric) => {
    if (ms && ms > 0) {
      const evidence = pack?.latency_evidence?.find((item) => item.metric === metric) || null;
      legs.push({ label, ms, evidence });
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

  if (tel?.latency_estimates?.media_rtt_ms) add('Telephony media round-trip', tel.latency_estimates.media_rtt_ms, tel, 'media_rtt_ms');
  if (orch?.latency_estimates?.pipeline_overhead_ms) add('Orchestration pipeline overhead', orch.latency_estimates.pipeline_overhead_ms, orch, 'pipeline_overhead_ms');
  if (vad?.latency_estimates?.processing_ms) add('VAD processing', vad.latency_estimates.processing_ms, vad, 'processing_ms');

  if (flags.mode === 'realtime' || flags.mode === 'hybrid') {
    if (rt?.latency_estimates?.response_start_ms) add('Realtime model response start', rt.latency_estimates.response_start_ms, rt, 'response_start_ms');
  }
  if (flags.mode === 'cascaded' || flags.mode === 'hybrid') {
    if (stt?.latency_estimates?.ttf_transcript_ms) add('STT time to first transcript', stt.latency_estimates.ttf_transcript_ms, stt, 'ttf_transcript_ms');
    if (llm?.latency_estimates?.ttft_ms) add('LLM time to first token', llm.latency_estimates.ttft_ms, llm, 'ttft_ms');
    if (tts?.latency_estimates?.ttfa_ms) add('TTS time to first audio', tts.latency_estimates.ttfa_ms, tts, 'ttfa_ms');
  }

  const target = flags.latency === 'ultra' ? 500 : flags.latency === 'balanced' ? 800 : 1200;
  const sources = new Set(legs.map((leg) => leg.evidence?.source || 'unproven'));
  const evidence_class = sources.has('unproven') || sources.has('planning_estimate')
    ? 'planning_unmeasured'
    : sources.has('vendor_claim')
      ? 'vendor_claim'
      : 'callsmith_measurement';
  const verdict = evidence_class === 'callsmith_measurement'
    ? total_ms <= target ? 'within target' : total_ms <= target * 1.5 ? 'borderline' : 'exceeds target'
    : null;

  return {
    legs,
    total_ms,
    target_ms: target,
    verdict,
    evidence_class,
    note: evidence_class === 'planning_unmeasured'
      ? 'Architecture-planning allowance only; unmeasured and not an SLO. Capture a Turn Gap trace.'
      : evidence_class === 'vendor_claim'
        ? 'Vendor-claimed inputs; benchmark the deployment path before setting an SLO.'
        : 'Computed from Callsmith-measured evidence for the tagged pack environments.',
  };
}

export function computeCost(sel, providers, flags = {}, operations = null) {
  const legs = [];
  let total = 0;
  const ops = operations || resolveOperationsConfig(sel, providers, flags);

  const roleOrder = ['telephony', 'orchestration', 'vad', 'realtime', 'stt', 'llm', 'tts'];
  for (const role of roleOrder) {
    const selection = sel[role];
    if (!selection || !selection.id) continue;
    const pack = providers[selection.id];
    if (!pack) continue;
    const ce = pack.cost_estimates;
    if (!ce) continue;

    let perMin = ce.per_minute_usd || 0;
    let notes = ce.notes || '';
    if (role === 'orchestration' && pack.id === 'livekit' && ops.effective_hosting_model === 'self_hosted') {
      perMin = 0;
      notes = 'Self-hosted LiveKit removes the modeled LiveKit Cloud per-minute fee; infrastructure cost is not included.';
    }
    legs.push({
      role,
      provider: pack.id,
      label: pack.label,
      billing: ce.billing || 'unknown',
      per_minute_usd: perMin,
      raw_rate: ce.rate_usd || 0,
      notes,
    });
    total += perMin;
  }

  const round = (n, d = 4) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);

  return {
    legs,
    total_per_minute_usd: round(total),
    per_hour_usd: round(total * 60, 2),
    per_1k_calls_usd: round(total * 5 * 1000, 2),
    assumptions: '~250 tokens/min LLM, ~800 chars/min TTS, 5-min avg call',
  };
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

  const telephony = flags.needs_telephony && sel.telephony ? providers[sel.telephony.id] : null;
  const orch = sel.orchestration ? providers[sel.orchestration.id] : null;
  if (telephony) {
    const sinkSelection = (flags.mode === 'realtime' || flags.mode === 'hybrid') ? sel.realtime : sel.stt;
    const sourceSelection = (flags.mode === 'realtime' || flags.mode === 'hybrid') ? sel.realtime : sel.tts;
    const sink = sinkSelection ? providers[sinkSelection.id] : null;
    const source = sourceSelection ? providers[sourceSelection.id] : null;
    const gate = audioPathGate({ telephony, orch, sink, source });
    for (const step of gate.inbound.unsupported) {
      impossible.push({ code: 'no_audio_path', message: `No supported inbound audio path: ${step} (${telephony.id} -> ${sink?.id}).` });
    }
    for (const step of gate.outbound.unsupported) {
      impossible.push({ code: 'no_audio_path', message: `No supported outbound audio path: ${step} (${source?.id} -> ${telephony.id}).` });
    }
  }

  const selectedPacks = Object.entries(sel)
    .map(([role, selection]) => ({ role, pack: selection?.id ? providers[selection.id] : null }))
    .filter(item => item.pack);
  const selectedCapabilities = new Map();
  for (const { role, pack } of selectedPacks) {
    for (const capability of pack.native_capabilities || []) {
      if (!selectedCapabilities.has(capability)) selectedCapabilities.set(capability, []);
      selectedCapabilities.get(capability).push({ role, id: pack.id });
    }
  }
  // native_capability_conflicts guard. NOTE: no installed pack currently declares a
  // conflict — this is a reserved guard for future SIP-direct carriers or similar
  // incompatibilities. The shape is exercised by test/impossibility.test.mjs (sip-only-carrier).
  // Dedupe symmetric declarations (A declares "X vs Y" and B declares "Y vs X") by a canonical key.
  const conflictKeys = new Set();
  for (const { role, pack } of selectedPacks) {
    for (const conflict of pack.native_capability_conflicts || []) {
      if (!(pack.native_capabilities || []).includes(conflict.capability)) continue;
      for (const otherCapability of conflict.conflicts_with || []) {
        for (const other of selectedCapabilities.get(otherCapability) || []) {
          if (other.id === pack.id) continue;
          const key = [pack.id, conflict.capability, other.id, otherCapability].sort().join('|');
          if (conflictKeys.has(key)) continue;
          conflictKeys.add(key);
          impossible.push({
            code: 'native_capability_conflict',
            message: `${pack.label || pack.id} (${role}) capability "${conflict.capability}" conflicts with ${other.id} (${other.role}) capability "${otherCapability}"${conflict.note ? `: ${conflict.note}` : '.'}`,
          });
        }
      }
    }
  }

  return impossible;
}
