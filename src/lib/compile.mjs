import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';
import { createSafeWriter } from './safe-write.mjs';

const VERSION = '1.3.0';

// Maps each known env key to the dashboard where a developer can retrieve it.
// Shown as comments in the generated .env.example so a stranger can fill it in
// without hunting for the right console.
const ENV_DASHBOARDS = {
  EXOTEL_API_KEY: 'https://my.exotel.com/settings/api-key',
  EXOTEL_ACCOUNT_SID: 'https://my.exotel.com/settings/api-key',
  EXOTEL_SUBDOMAIN: 'https://my.exotel.com',
  TWILIO_ACCOUNT_SID: 'https://console.twilio.com',
  TWILIO_AUTH_TOKEN: 'https://console.twilio.com',
  TWILIO_APP_SID: 'https://console.twilio.com/us1/develop/voice/manage/apps',
  PLIVO_AUTH_ID: 'https://console.plivo.com/account/',
  PLIVO_AUTH_TOKEN: 'https://console.plivo.com/account/',
  TELNYX_API_KEY: 'https://portal.telnyx.com/#/app/api-keys',
  VONAGE_API_KEY: 'https://dashboard.nexmo.com/settings',
  VONAGE_API_SECRET: 'https://dashboard.nexmo.com/settings',
  VONAGE_APPLICATION_ID: 'https://dashboard.nexmo.com/applications',
  LIVEKIT_URL: 'https://cloud.livekit.io/projects',
  LIVEKIT_API_KEY: 'https://cloud.livekit.io/projects/p/settings/keys',
  LIVEKIT_API_SECRET: 'https://cloud.livekit.io/projects/p/settings/keys',
  DEEPGRAM_API_KEY: 'https://console.deepgram.com/api-keys',
  ASSEMBLYAI_API_KEY: 'https://www.assemblyai.com/app/account',
  OPENAI_API_KEY: 'https://platform.openai.com/api-keys',
  ANTHROPIC_API_KEY: 'https://console.anthropic.com/settings/keys',
  GOOGLE_API_KEY: 'https://aistudio.google.com/apikey',
  GEMINI_API_KEY: 'https://aistudio.google.com/apikey',
  ELEVENLABS_API_KEY: 'https://elevenlabs.io/app/settings/api-keys',
  CARTESIA_API_KEY: 'https://app.cartesia.ai/keys',
  SARVAM_API_KEY: 'https://dashboard.sarvam.ai/api-keys',
};

function renderEnvExample(envKeys) {
  const lines = ['# Callsmith-generated environment template.', '# Fill in values from the linked dashboards, then: cp .env.example .env', ''];
  for (const key of envKeys) {
    const url = ENV_DASHBOARDS[key];
    if (url) lines.push(`# Get this from: ${url}`);
    lines.push(`${key}=`);
    lines.push('');
  }
  return lines.join('\n');
}

export function compile(rawAnswers, outDir, opts = {}) {
  const menu = loadMenu();
  const providers = opts.providers ?? loadProviders();
  const resolved = opts.resolved ?? [];
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const { flags, providers: sel, labels } = answers;
  const writer = createSafeWriter(outDir, { force: opts.force === true, dryRun: opts.dryRun === true });
  const write = (rel, content) => writer.w(rel, content);

  write('.callsmith/context/architecture.md', renderArchitecture(result, flags, sel, labels));
  write('.callsmith/context/audio-contract.md', renderAudioContract(result));
  write('.callsmith/context/potholes.md', renderPotholes(result));
  write('.callsmith/context/build-order.md', renderBuildOrder(result, sel, flags));
  write('.callsmith/context/interruption.md', renderInterruption(result));
  write('.callsmith/context/latency-budget.md', renderLatencyBudget(result));
  write('.callsmith/context/cost-estimation.md', renderCostEstimation(result));
  write('.callsmith/context/conversation-state.md', renderConversationState(result, sel, providers));
  write('.callsmith/context/error-handling.md', renderErrorHandling(result, sel));
  write('.callsmith/context/operations.md', renderOperations(result));
  write('.callsmith/context/voice-ux.md', renderVoiceUx(flags));
  write('.callsmith/context/tool-calling.md', renderToolCalling(flags, sel, providers));
  write('.callsmith/context/observability.md', renderObservability(result, flags, sel));
  write('.callsmith/context/safety-compliance.md', renderSafetyCompliance(flags));
  write('.callsmith/context/handoff.md', renderHandoff(flags));
  write('.callsmith/context/local-testing.md', renderLocalTesting(flags, sel));
  write('.callsmith/context/simulation.md', renderSimulationPlan(result, flags, sel));

  write('.env.example', renderEnvExample(result.envKeys));

  const lock = {
    callsmith_version: VERSION,
    architecture: { ...flags },
    providers: Object.fromEntries(Object.entries(sel).map(([k, v]) => [k, v.id])),
    provider_models: result.pipeline.filter(p => p.id).map(p => {
      const pk = providers[p.id] || {};
      return { role: p.role, id: p.id, model: pk.model || null };
    }),
    compatibility: {
      requires_custom_bridge: result.transforms.length > 0,
      transform_count: result.transforms.length,
      blockers: result.blockers.length,
    },
    latency: result.latency,
    cost: result.cost,
    operations: result.operations,
    voice_ux: voiceUxConfig(flags),
    safety: safetyConfig(flags),
    handoff: flags.handoff || 'ticket',
    local_testing: {
      ngrok: flags.needs_telephony ? 'required for local PSTN webhook testing' : 'optional for browser/app callbacks',
      port: 8000,
    },
    resolved_providers: resolved,
  };
  write('callsmith.lock.json', JSON.stringify(lock, null, 2) + '\n');

  write('callsmith.recipe.md', renderRecipe(result, flags, sel, labels, lock, resolved, providers));

  const fileList = [
    'callsmith.recipe.md', 'callsmith.lock.json', '.env.example',
    '.callsmith/context/architecture.md', '.callsmith/context/audio-contract.md',
    '.callsmith/context/potholes.md', '.callsmith/context/build-order.md',
    '.callsmith/context/interruption.md', '.callsmith/context/latency-budget.md',
    '.callsmith/context/cost-estimation.md', '.callsmith/context/conversation-state.md',
    '.callsmith/context/error-handling.md',
    '.callsmith/context/operations.md',
    '.callsmith/context/voice-ux.md', '.callsmith/context/tool-calling.md',
    '.callsmith/context/observability.md', '.callsmith/context/safety-compliance.md',
    '.callsmith/context/handoff.md', '.callsmith/context/local-testing.md',
    '.callsmith/context/simulation.md',
  ];
  return {
    lock,
    result,
    files: fileList,
    root: writer.root,
    collisions: writer.collisions,
    overwritten: writer.overwritten,
    manifest: writer.manifest,
    dryRun: writer.dryRun,
  };
}

export function voiceUxConfig(flags) {
  return {
    endpointing: flags.endpointing || 'balanced',
    endpointing_ms: flags.endpointing_ms ?? 600,
    interruption_sensitivity: flags.interruption_sensitivity || 'normal',
    audio_enhancement: flags.audio_enhancement || 'provider_native',
    noise_cancellation: flags.noise_cancellation || 'standard',
    echo_cancellation: flags.echo_cancellation || 'provider_native',
    automatic_gain_control: flags.automatic_gain_control || 'provider_native',
    silence_timeout_ms: flags.silence_timeout_ms ?? 15000,
    max_call_duration_sec: flags.max_call_duration_sec ?? 1800,
    greeting_mode: flags.greeting_mode || 'immediate',
    voice_profile: flags.voice_profile || 'warm',
    speaking_speed: flags.speaking_speed ?? 1.0,
    language_fallback: flags.language_fallback || 'auto_then_confirm',
  };
}

export function safetyConfig(flags) {
  return {
    recording_consent: flags.recording_consent || 'announce',
    transcript_retention_days: flags.transcript_retention_days ?? 30,
    pii_redaction: true,
    audit_tool_actions: !!(flags.tools && flags.tools !== 'none'),
  };
}

function stackLine(labels, key, fallback) { return labels[key] || fallback || '—'; }

function renderRecipe(result, flags, sel, labels, lock, resolved = [], providers = {}) {
  const { transforms, blockers, notes, potholes } = result;
  const ops = result.operations;
  const needsBridge = transforms.length > 0;
  const unverified = (resolved || []).filter(r => !r.verified);
  const lines = [];
  lines.push(`# Callsmith Recipe`);
  lines.push('');

  if (unverified.length) {
    lines.push('> ⚠ **UNVERIFIED PROVIDERS** — The following were resolved online, not from verified packs.');
    lines.push('> Validate their audio contracts against live documentation before shipping:');
    for (const r of unverified) lines.push(`> - **${r.id}** (${r.role})`);
    lines.push('');
  }

  lines.push(`A compiled implementation contract for a ${stackLine(labels,'business_logic','voice')} agent.`);
  lines.push(`Generated by callsmith v${VERSION}. Reproduce from \`callsmith.lock.json\`.`);
  lines.push('');
  lines.push('## Intent');
  lines.push('');
  lines.push(`- **Surface:** ${stackLine(labels,'surface')}`);
  lines.push(`- **Architecture:** ${stackLine(labels,'architecture')}`);
  lines.push(`- **Direction:** ${flags.direction || 'n/a'}`);
  lines.push(`- **Language:** ${flags.language || 'en'}`);
  lines.push(`- **Barge-in:** ${flags.barge_in}`);
  lines.push(`- **Hosting model:** ${ops.hosting_label} (${ops.infrastructure_owner})`);
  if (ops.requested_hosting_model !== ops.effective_hosting_model) {
    lines.push(`- **Requested hosting:** ${ops.requested_hosting_model} -> effective ${ops.effective_hosting_model}`);
  }
  lines.push(`- **Debug profile:** ${ops.debug_profile} (${ops.trace_level})`);
  lines.push(`- **Endpointing:** ${flags.endpointing || 'balanced'} (${flags.endpointing_ms ?? 600}ms)`);
  lines.push(`- **Interruption sensitivity:** ${flags.interruption_sensitivity || 'normal'}`);
  lines.push(`- **Audio enhancement:** ${flags.audio_enhancement || 'provider_native'}`);
  lines.push(`- **Noise cancellation:** ${flags.noise_cancellation || 'standard'}`);
  lines.push(`- **Echo cancellation:** ${flags.echo_cancellation || 'provider_native'}`);
  lines.push(`- **Automatic gain control:** ${flags.automatic_gain_control || 'provider_native'}`);
  lines.push(`- **Silence timeout:** ${flags.silence_timeout_ms ?? 15000}ms`);
  lines.push(`- **Max call duration:** ${flags.max_call_duration_sec ? `${flags.max_call_duration_sec}s` : 'no fixed cap'}`);
  lines.push(`- **Greeting mode:** ${flags.greeting_mode || 'immediate'}`);
  lines.push(`- **Voice profile:** ${flags.voice_profile || 'warm'} (${flags.speaking_speed ?? 1.0}x)`);
  lines.push(`- **Language fallback:** ${flags.language_fallback || 'auto_then_confirm'}`);
  lines.push(`- **Latency priority:** ${flags.latency}`);
  lines.push(`- **Job:** ${stackLine(labels,'business_logic')}`);
  lines.push(`- **Tools:** ${flags.tools}`);
  lines.push(`- **Human handoff:** ${flags.handoff || 'ticket'}`);
  lines.push(`- **Recording consent:** ${flags.recording_consent || 'announce'}`);
  lines.push(`- **Transcript retention:** ${flags.transcript_retention_days ?? 30} days`);
  lines.push(`- **Deployment:** ${stackLine(labels,'deployment')}`);
  lines.push('');
  lines.push('## Selected stack');
  lines.push('');
  for (const p of result.pipeline) lines.push(`- **${p.role}:** ${p.label || p.id}`);
  lines.push('');
  lines.push('## Audio contract (read this before writing any audio code)');
  lines.push('');
  if (needsBridge) {
    lines.push('> **A custom audio bridge is required.** Do not pass telephony frames into the model directly.');
    lines.push('');
    for (const t of transforms) lines.push(`- [${t.direction}] ${t.step}  (${t.from} -> ${t.to})`);
    lines.push('');
    lines.push('Full contract: see [.callsmith/context/audio-contract.md](.callsmith/context/audio-contract.md).');
  } else {
    lines.push('> **No custom transcoding in your code** — normalization is handled by a native layer.');
    lines.push('');
    for (const n of notes) lines.push(`- ${n}`);
  }
  lines.push('');
  lines.push('## Interruption & turn-taking');
  lines.push('');
  if (result.interruption.enabled) {
    lines.push(`Barge-in is **enabled**. ${result.interruption.steps.length} layers participate in interruption handling:`);
    lines.push('');
    for (const s of result.interruption.steps) {
      lines.push(`### ${s.layer} (${s.provider})`);
      lines.push(`- **Mechanism:** ${s.mechanism}`);
      lines.push(`- **What happens:** ${s.detail}`);
      if (s.code) lines.push(`- **Code:** \`${s.code}\``);
      lines.push('');
    }
    lines.push('Full details: see [.callsmith/context/interruption.md](.callsmith/context/interruption.md).');
  } else {
    lines.push('Barge-in is **disabled** (half-duplex). The agent finishes speaking before accepting user input.');
  }
  lines.push('');
  lines.push('## Latency budget');
  lines.push('');
  const lat = result.latency;
  lines.push('| Leg | Latency (ms) |');
  lines.push('|---|---|');
  for (const leg of lat.legs) lines.push(`| ${leg.label} | ${leg.ms} |`);
  lines.push(`| **Total estimated** | **${lat.total_ms}** |`);
  lines.push(`| Target (${flags.latency}) | ${lat.target_ms} |`);
  lines.push('');
  if (lat.verdict === 'within target') {
    lines.push(`> This stack is **within the latency target** (${lat.total_ms}ms vs ${lat.target_ms}ms target).`);
  } else if (lat.verdict === 'borderline') {
    lines.push(`> ⚠ This stack is **borderline** (${lat.total_ms}ms vs ${lat.target_ms}ms target). Consider optimizing the largest contributors.`);
  } else {
    lines.push(`> ⚠⚠ This stack **exceeds the latency target** (${lat.total_ms}ms vs ${lat.target_ms}ms target). Reduce latency or accept degraded UX.`);
  }
  lines.push('');
  lines.push('Full breakdown: see [.callsmith/context/latency-budget.md](.callsmith/context/latency-budget.md).');
  lines.push('');
  lines.push('## Cost estimation');
  lines.push('');
  const cost = result.cost;
  lines.push('| Leg | Provider | Billing | Per minute |');
  lines.push('|---|---|---|---|');
  for (const leg of cost.legs) {
    lines.push(`| ${leg.role} | ${leg.label} | ${leg.billing} | $${leg.per_minute_usd.toFixed(4)} |`);
  }
  lines.push(`| **Total** | | | **$${cost.total_per_minute_usd.toFixed(4)}/min** |`);
  lines.push('');
  lines.push(`- **Per hour:** ~$${cost.per_hour_usd}`);
  lines.push(`- **Per 1k calls (5 min avg):** ~$${cost.per_1k_calls_usd}`);
  lines.push(`- *Assumptions: ${cost.assumptions}. Verify at provider sites before budgeting.*`);
  lines.push('');
  lines.push('Full details: see [.callsmith/context/cost-estimation.md](.callsmith/context/cost-estimation.md).');
  lines.push('');
  lines.push('## Conversation state');
  lines.push('');
  const llmPack = sel.llm ? providers[sel.llm.id] : null;
  const ctxWindow = llmPack?.context_window || 128000;
  const overflowMin = Math.floor(ctxWindow / 250);
  lines.push(`- **Context window:** ${ctxWindow.toLocaleString()} tokens${llmPack ? ` (${llmPack.label})` : ''}. At ~250 tokens/min, overflow at ~${overflowMin.toLocaleString()} min.`);
  lines.push(`- **Strategy:** Sliding window — when approaching limit, drop oldest non-system messages. System prompt is always retained.`);
  lines.push(`- **Transcript:** SQLite persistence at \`transcripts.db\`. Every turn logged with timestamp, role, content, token estimate, and metadata.`);
  lines.push(`- **DTMF:** Collected with configurable inter-digit timeout (default 5s). Injected into conversation as text. See \`state.py\`.`);
  lines.push('');
  lines.push('See [.callsmith/context/conversation-state.md](.callsmith/context/conversation-state.md) for implementation details.');
  lines.push('');
  lines.push('## Error handling & resilience');
  lines.push('');
  lines.push('- **WebSocket recovery:** Exponential backoff (1s, 2s, 4s, 8s, 16s, max 30s) with +/-25% jitter. Max 5 retries before session fails.');
  lines.push('- **Rate limits:** `Retry-After` header honored. Exponential backoff on 429/5xx responses. Max 3 retries per request.');
  lines.push('- **Fallback chains:** Configured per pipeline leg. On primary failure after retries, switch to fallback provider automatically.');
  lines.push('- **Tool call timeouts:** 5s default. On timeout, respond with "let me check that" and retry asynchronously.');
  lines.push('');
  lines.push('See [.callsmith/context/error-handling.md](.callsmith/context/error-handling.md) for implementation details.');
  lines.push('');
  lines.push('## Operations & maintainability');
  lines.push('');
  lines.push(`- **Runtime ownership:** ${ops.hosting_label}; owner = ${ops.infrastructure_owner}.`);
  lines.push(`- **Debugging:** ${ops.debug_note}`);
  lines.push(`- **Trace sampling:** ${ops.trace_sampling}; debug audio window = ${ops.retain_debug_audio_sec}s.`);
  if (ops.adjustments.length) {
    for (const item of ops.adjustments) lines.push(`- **Adjustment:** ${item}`);
  }
  for (const item of ops.responsibilities) lines.push(`- ${item}`);
  lines.push('');
  lines.push('Audio cleanup ownership:');
  lines.push('');
  for (const feature of ops.audio_features) {
    lines.push(`- **${feature.feature}:** ${feature.mode}; owner = ${feature.owner}. ${feature.action}`);
  }
  lines.push('');
  lines.push('See [.callsmith/context/operations.md](.callsmith/context/operations.md) for operational responsibilities and debug settings.');
  lines.push('');
  lines.push('## Operational levers');
  lines.push('');
  lines.push('- **Voice UX tuning:** endpointing, interruption sensitivity, audio enhancement, noise cancellation, echo cancellation, gain control, silence timeout, greeting mode, speaking speed, and language fallback are locked in [.callsmith/context/voice-ux.md](.callsmith/context/voice-ux.md).');
  lines.push('- **Tool calling:** generated `tools.py` must use timeout, retry, idempotency, and safe speech fallback policies from [.callsmith/context/tool-calling.md](.callsmith/context/tool-calling.md).');
  lines.push('- **Observability:** generated `observability.py` must trace STT, LLM, TTS, interruption, DTMF, tools, reconnects, dropped frames, and cost from [.callsmith/context/observability.md](.callsmith/context/observability.md).');
  lines.push('- **Safety/compliance:** recording consent, PII redaction, retention, opt-out/DNC, and audit log policy live in [.callsmith/context/safety-compliance.md](.callsmith/context/safety-compliance.md).');
  lines.push('- **Human handoff:** transfer/callback/ticket summary policy lives in [.callsmith/context/handoff.md](.callsmith/context/handoff.md).');
  lines.push('- **Local PSTN testing:** use ngrok instructions in [.callsmith/context/local-testing.md](.callsmith/context/local-testing.md).');
  lines.push('- **Simulation:** run `callsmith simulate --answers <answers.json>` and compare against [.callsmith/context/simulation.md](.callsmith/context/simulation.md).');
  lines.push('');
  lines.push('## Blockers & potholes');
  lines.push('');
  const activePotholes = potholes.filter(p => !p.mitigated);
  const mitigatedPotholes = potholes.filter(p => p.mitigated);
  if (blockers.length === 0 && activePotholes.filter(p => p.severity === 'blocker').length === 0) {
    lines.push('No blockers detected for this stack. Review warnings in [.callsmith/context/potholes.md](.callsmith/context/potholes.md).');
  } else {
    for (const b of blockers) lines.push(`- **[BLOCKER]** ${b.note}`);
    for (const p of activePotholes.filter(p => p.severity === 'blocker')) lines.push(`- **[BLOCKER / ${p.source}]** ${p.note}`);
  }
  if (mitigatedPotholes.length) {
    lines.push('');
    lines.push(`**Mitigated by native layer** (${mitigatedPotholes.length} provider concern(s) resolved — see [.callsmith/context/potholes.md](.callsmith/context/potholes.md) for which layer handles each).`);
  }
  lines.push('');
  lines.push('## Build order (follow in sequence)');
  lines.push('');
  lines.push('See [.callsmith/context/build-order.md](.callsmith/context/build-order.md). Do not skip the audio-contract step.');
  lines.push('');
  lines.push('## Required docs');
  lines.push('');
  lines.push('Provider docs context should already exist when the project was created with `callsmith init`.');
  lines.push('Refresh it manually if you are using the advanced command flow:');
  lines.push('```bash');
  lines.push('callsmith docs --answers <answers.json>   # writes stubs + Context7 prompts into .callsmith/docs/');
  lines.push('```');
  lines.push('');
  lines.push('## Agent instructions');
  lines.push('');
  lines.push('Before writing code, read these files in order:');
  lines.push('1. `.callsmith/context/architecture.md`');
  lines.push('2. `.callsmith/context/audio-contract.md`');
  lines.push('3. `.callsmith/context/interruption.md`');
  lines.push('4. `.callsmith/context/latency-budget.md`');
  lines.push('5. `.callsmith/context/cost-estimation.md`');
  lines.push('6. `.callsmith/context/conversation-state.md`');
  lines.push('7. `.callsmith/context/error-handling.md`');
  lines.push('8. `.callsmith/context/operations.md`');
  lines.push('9. `.callsmith/context/voice-ux.md`');
  lines.push('10. `.callsmith/context/tool-calling.md`');
  lines.push('11. `.callsmith/context/observability.md`');
  lines.push('12. `.callsmith/context/safety-compliance.md`');
  lines.push('13. `.callsmith/context/handoff.md`');
  lines.push('14. `.callsmith/context/local-testing.md`');
  lines.push('15. `.callsmith/context/simulation.md`');
  lines.push('16. `.callsmith/context/potholes.md`');
  lines.push('17. `.callsmith/context/build-order.md`');
  lines.push('');
  lines.push('Do not invent unsupported audio formats. Do not skip transcoding if the audio-contract requires it. Do not assume telephony frame boundaries align with model frames.');
  lines.push('');
  return lines.join('\n');
}

function renderArchitecture(result, flags, sel, labels) {
  const L = [];
  L.push('# Architecture');
  L.push('');
  L.push('## Pipeline');
  for (const p of result.pipeline) L.push(`1. **${p.role}** — ${p.label || p.id}`);
  L.push('');
  L.push('## Flags');
  for (const [k, v] of Object.entries(flags)) L.push(`- ${k}: ${v}`);
  return L.join('\n') + '\n';
}

function renderAudioContract(result) {
  const L = [];
  L.push('# Audio Contract');
  L.push('');
  L.push('This file is the single source of truth for what audio conversions the implementation must perform.');
  L.push('');
  if (result.transforms.length === 0) {
    L.push('**No custom transcoding required.** Selected native layer absorbs it:');
    L.push('');
    for (const n of result.notes) L.push(`- ${n}`);
  } else {
    L.push('## Required transforms');
    L.push('');
    L.push('| Direction | Step | From | To |');
    L.push('|---|---|---|---|');
    for (const t of result.transforms) L.push(`| ${t.direction} | ${t.step} | ${t.from} | ${t.to} |`);
    L.push('');
    L.push('## Implementation notes');
    L.push('');
    L.push('- Reassemble telephony frames by byte budget, not message boundary, before resampling.');
    L.push('- Use two independent resamplers if input/output rates differ.');
    L.push('- On interruption, flush the outbound buffer before the next model chunk.');
  }
  return L.join('\n') + '\n';
}

function renderPotholes(result) {
  const L = ['# Potholes', ''];
  const order = ['blocker', 'warning', 'note'];
  for (const sev of order) {
    const items = result.potholes.filter(p => p.severity === sev && !p.mitigated);
    if (!items.length) continue;
    L.push(`## ${sev}`);
    for (const p of items) L.push(`- **[${p.source}]** ${p.note}`);
    L.push('');
  }
  const mitigated = result.potholes.filter(p => p.mitigated);
  if (mitigated.length) {
    L.push('## Mitigated by native layer');
    L.push('');
    L.push('These provider-level concerns are resolved by a selected native layer — no action required in your code:');
    L.push('');
    for (const p of mitigated) {
      L.push(`- **[${p.source}]** ${p.note}  _(mitigated by ${p.mitigatedBy})_`);
    }
    L.push('');
  }
  return L.join('\n') + '\n';
}

function renderBuildOrder(result, sel, flags) {
  const L = ['# Build Order', '', 'Implement top-to-bottom. Verify each step before the next.', ''];
  L.push('1. **Config & env** — load keys from `.env.example`; validate presence at startup.');
  L.push('2. **Session lifecycle state machine** — map provider events to a single session model (call_started, media_active, interruption, ended).');
  if (result.transforms.length > 0) {
    L.push('3. **Audio bridge** — implement every transform in `.callsmith/context/audio-contract.md`. Add a fake audio-frame test that round-trips a known sample.');
  } else {
    L.push('3. **Audio wiring** — connect the native-normalized PCM streams; confirm frame format matches the model ingest contract.');
  }
  L.push('4. **VAD & interruption wiring** — configure the VAD provider from the recipe; wire interruption events to the turn manager. See `.callsmith/context/interruption.md`.');
  L.push('5. **Model session** — connect realtime/STT+LLM+TTS; wire interruption handling and tool calling.');
  L.push('6. **Conversation state** — wire `state.py` (ContextManager, TranscriptStore, DTMFHandler) into the session. See `.callsmith/context/conversation-state.md`.');
  L.push('7. **Error handling & resilience** — wire `resilience.py` (reconnection, retry, fallback). See `.callsmith/context/error-handling.md`.');
  L.push('8. **Operations contract** — load `operations.py`; confirm hosting ownership, debug depth, trace sampling, and audio cleanup ownership. See `.callsmith/context/operations.md`.');
  L.push('9. **Voice UX tuning** — load `voice_ux.py`; enforce endpointing, audio cleanup, silence timeout, greeting mode, language fallback, and max call duration.');
  L.push('10. **Business logic & tools** — wire `tools.py`; every side-effecting call needs timeout, retry, idempotency, and audit logging.');
  L.push('11. **Safety & handoff** — wire `safety.py` and `handoff.py`; handle consent, PII redaction, retention, opt-out/DNC, and escalation summary.');
  L.push('12. **Observability** — wire `observability.py`; log inbound, post-transcode, model output, outbound streams, tools, interruption, reconnect, and cost separately.');
  L.push('13. **Local PSTN test** — use `local_test.py` and ngrok to expose the local webhook/WebSocket before production deployment work.');
  L.push('14. **E2E simulation** — run `callsmith simulate` and generated `simulate_call.py` covering call lifecycle + barge-in + DTMF + tools + reconnection.');
  return L.join('\n') + '\n';
}

function renderInterruption(result) {
  const L = ['# Interruption & Turn-Taking', ''];
  if (!result.interruption.enabled) {
    L.push('Barge-in is **disabled**. The agent operates in half-duplex mode.');
    return L.join('\n') + '\n';
  }
  L.push('Barge-in is **enabled**. When the user speaks during agent output, the following layers cooperate to interrupt playback and cancel in-flight work:');
  L.push('');
  for (const s of result.interruption.steps) {
    L.push(`## ${s.layer} — ${s.provider}`);
    L.push(`- **Mechanism:** \`${s.mechanism}\``);
    L.push(`- **What happens:** ${s.detail}`);
    if (s.code) {
      L.push(`- **Implementation:**`);
      L.push(`  \`${s.code}\``);
    }
    L.push('');
  }
  L.push('## End-to-end interruption flow');
  L.push('');
  L.push('1. VAD detects user speech during agent output');
  L.push('2. Framework fires interruption event (InterruptionFrame in Pipecat, session interrupt in LiveKit)');
  L.push('3. In-flight LLM stream is cancelled');
  L.push('4. TTS output is stopped, buffered audio is discarded');
  L.push('5. Telephony playback is stopped (clear/flush)');
  L.push('6. Agent listens for the user\'s complete utterance');
  L.push('7. New turn begins when STT reports a final transcript');
  return L.join('\n') + '\n';
}

function renderLatencyBudget(result) {
  const L = ['# Latency Budget', ''];
  const lat = result.latency;
  L.push('| Leg | Latency (ms) |');
  L.push('|---|---|');
  for (const leg of lat.legs) L.push(`| ${leg.label} | ${leg.ms} |`);
  L.push(`| **Total** | **${lat.total_ms}** |`);
  L.push(`| Target | ${lat.target_ms} |`);
  L.push(`| Verdict | ${lat.verdict} |`);
  L.push('');
  L.push('## Optimization tips');
  L.push('');
  L.push('- **Realtime models** have the highest single contribution. Choose `ultra` latency priority if budget allows.');
  L.push('- **LLM TTFT** dominates cascaded latency. Use streaming + short system prompts.');
  L.push('- **TTS first-audio** varies by provider. Cartesia (~150ms) is fastest; ElevenLabs (~250ms) is average.');
  L.push('- **VAD processing** is small but additive. WebRTC VAD (10ms) is fastest; Silero (20ms) is most accurate.');
  L.push('- **Telephony media RTT** is fixed by the provider. Cannot be optimized in your code.');
  return L.join('\n') + '\n';
}

function renderCostEstimation(result) {
  const L = ['# Cost Estimation', ''];
  const cost = result.cost;
  L.push('| Leg | Provider | Billing model | Raw rate | Per minute (USD) |');
  L.push('|---|---|---|---|---|');
  for (const leg of cost.legs) {
    L.push(`| ${leg.role} | ${leg.label} | ${leg.billing} | $${leg.raw_rate} | $${leg.per_minute_usd.toFixed(4)} |`);
  }
  L.push(`| **Total** | | | | **$${cost.total_per_minute_usd.toFixed(4)}/min** |`);
  L.push('');
  L.push('## Scale projections');
  L.push('');
  L.push(`- **Per hour:** ~$${cost.per_hour_usd}`);
  L.push(`- **Per 1k calls (5 min avg):** ~$${cost.per_1k_calls_usd}`);
  L.push('');
  L.push(`**Assumptions:** ${cost.assumptions}.`);
  L.push('');
  L.push('## Per-leg detail');
  L.push('');
  for (const leg of cost.legs) {
    L.push(`### ${leg.role} — ${leg.label}`);
    L.push(`- **Billing:** ${leg.billing}`);
    if (leg.billing === 'per_1k_chars') {
      L.push(`- **Rate:** $${leg.raw_rate}/1k chars. At ~800 chars/min = $${leg.per_minute_usd.toFixed(4)}/min.`);
    } else if (leg.billing === 'per_hour') {
      L.push(`- **Rate:** $${leg.raw_rate}/hour = $${leg.per_minute_usd.toFixed(4)}/min.`);
    } else if (leg.billing === 'free') {
      L.push(`- **Rate:** Free (self-hosted or open source).`);
    } else {
      L.push(`- **Rate:** $${leg.raw_rate}/min.`);
    }
    if (leg.notes) L.push(`- **Notes:** ${leg.notes}`);
    L.push('');
  }
  L.push('> Cost estimates use public pricing as of Jun 2026. Always verify at provider sites before budgeting.');
  return L.join('\n') + '\n';
}

function renderConversationState(result, sel, providers) {
  const L = ['# Conversation State Management', ''];
  const llmPack = sel.llm ? providers[sel.llm.id] : null;
  const ctxWindow = llmPack?.context_window || 128000;
  const overflowMin = Math.floor(ctxWindow / 250);

  L.push('## Context window management');
  L.push('');
  L.push(`The selected LLM (${llmPack?.label || 'default'}) has a **${ctxWindow.toLocaleString()}-token** context window.`);
  L.push(`At a conversational pace of ~250 tokens/min, the window fills after ~${overflowMin.toLocaleString()} minutes.`);
  L.push('');
  L.push('### Strategy: sliding window');
  L.push('');
  L.push('1. System prompt is **always retained** (never dropped).');
  L.push('2. When total tokens approach `max_tokens - reserve_tokens`, the oldest non-system messages are dropped.');
  L.push('3. `reserve_tokens` (default: 4000) ensures headroom for the model\'s response.');
  L.push('4. For calls exceeding 50% of the context window, consider adding a summarization step.');
  L.push('');
  L.push('```python');
  L.push('from state import ContextManager');
  L.push('');
  L.push(`ctx = ContextManager(max_tokens=${ctxWindow}, reserve_tokens=4000)`);
  L.push('ctx.add_message("system", SYSTEM_PROMPT)');
  L.push('ctx.add_message("user", transcript_text)');
  L.push('messages = ctx.get_messages()  # fits within budget');
  L.push('```');
  L.push('');

  L.push('## Transcript persistence');
  L.push('');
  L.push('Every turn is logged to SQLite (`transcripts.db`). No external dependencies required.');
  L.push('');
  L.push('### Schema');
  L.push('');
  L.push('| Column | Type | Description |');
  L.push('|---|---|---|');
  L.push('| id | INTEGER | Auto-increment primary key |');
  L.push('| call_id | TEXT | Unique call identifier (e.g. Twilio CallSid) |');
  L.push('| timestamp | REAL | Unix timestamp |');
  L.push('| role | TEXT | system / user / assistant |');
  L.push('| content | TEXT | Message content |');
  L.push('| tokens | INTEGER | Estimated token count |');
  L.push('| metadata | TEXT | JSON blob (tool calls, DTMF, etc.) |');
  L.push('');
  L.push('```python');
  L.push('from state import TranscriptStore');
  L.push('');
  L.push('store = TranscriptStore("transcripts.db")');
  L.push('store.log_turn(call_sid, "user", "I need help with my order")');
  L.push('store.log_turn(call_sid, "assistant", "Sure, what is your order number?")');
  L.push('transcript = store.get_transcript(call_sid)  # list of all turns');
  L.push('```');
  L.push('');

  L.push('## DTMF handling');
  L.push('');
  L.push('Telephony providers send DTMF (keypad) events. The `DTMFHandler` collects digits with a configurable inter-digit timeout.');
  L.push('');
  L.push('### Configuration');
  L.push('');
  L.push('| Parameter | Default | Description |');
  L.push('|---|---|---|');
  L.push('| max_digits | 0 (unlimited) | Flush after N digits collected |');
  L.push('| inter_digit_timeout_ms | 5000 | Timeout between digits before flushing |');
  L.push('');
  L.push('### Framework wiring');
  L.push('');
  const orchId = sel.orchestration?.id;
  if (orchId === 'pipecat') {
    L.push('**Pipecat:** Use `DTMFAggregator` in the pipeline between `transport.input()` and `stt`:');
    L.push('```python');
    L.push('from pipecat.processors.aggregators.dtmf_aggregator import DTMFAggregator');
    L.push('');
    L.push('dtmf = DTMFAggregator(timeout=5.0, prefix="Keypad input: ")');
    L.push('user_aggregator, assistant_aggregator = LLMContextAggregatorPair(');
    L.push('    context,');
    L.push('    user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),');
    L.push(')');
    L.push('pipeline = Pipeline([');
    L.push('    transport.input(),');
    L.push('    dtmf,  # collects DTMF before STT');
    L.push('    stt,');
    L.push('    user_aggregator,');
    L.push('    llm,');
    L.push('    tts,');
    L.push('    transport.output(),');
    L.push('    assistant_aggregator,');
    L.push('])');
    L.push('```');
  } else if (orchId === 'livekit') {
    L.push('**LiveKit:** Use `GetDtmfTask` for IVR-style digit collection:');
    L.push('```python');
    L.push('from livekit.agents.tasks import GetDtmfTask');
    L.push('');
    L.push('# Collect 4-digit PIN with 10s per-digit timeout');
    L.push('result = await GetDtmfTask(');
    L.push('    num_digits=4,');
    L.push('    dtmf_input_timeout=10.0,');
    L.push('    chat_ctx=session.current_agent.chat_ctx,');
    L.push(').run(session)');
    L.push('pin = result.user_input');
    L.push('```');
  } else {
    L.push('**Custom:** Parse DTMF from WebSocket messages:');
    L.push('```python');
    L.push('from state import DTMFHandler');
    L.push('');
    L.push('dtmf = DTMFHandler(max_digits=4, inter_digit_timeout_ms=5000)');
    L.push('dtmf.on_complete(lambda digits: handle_input(digits))');
    L.push('');
    L.push('# In your WebSocket handler:');
    L.push('if message.get("event") == "dtmf":');
    L.push('    digit = message["dtmf"]["digit"]');
    L.push('    dtmf.add_digit(digit)');
    L.push('```');
  }
  L.push('');
  L.push('### System prompt for DTMF');
  L.push('');
  L.push('Update the system prompt to handle keypad input alongside speech:');
  L.push('```');
  L.push('When you receive input starting with "Keypad input:", this represents');
  L.push('button presses on the phone keypad. Respond to both voice and keypad input.');
  L.push('```');
  return L.join('\n') + '\n';
}

function renderErrorHandling(result, sel) {
  const L = ['# Error Handling & Resilience', ''];

  L.push('## WebSocket drop recovery');
  L.push('');
  L.push('The media WebSocket between telephony and agent can drop due to network blips, provider restarts, or load balancer timeouts.');
  L.push('');
  L.push('### Connection state machine');
  L.push('');
  L.push('| State | Meaning |');
  L.push('|---|---|');
  L.push('| CONNECTED | Media flowing normally |');
  L.push('| DISCONNECTED | Connection lost, about to reconnect |');
  L.push('| RECONNECTING | Backoff in progress |');
  L.push('| FAILED | Max retries exhausted, session ends |');
  L.push('');
  L.push('### Backoff schedule');
  L.push('');
  L.push('| Retry | Base delay | With jitter (±25%) |');
  L.push('|---|---|---|');
  L.push('| 1 | 1s | 0.75s - 1.25s |');
  L.push('| 2 | 2s | 1.50s - 2.50s |');
  L.push('| 3 | 4s | 3.00s - 5.00s |');
  L.push('| 4 | 8s | 6.00s - 10.00s |');
  L.push('| 5 | 16s | 12.00s - 20.00s |');
  L.push('');
  L.push('Max 5 retries. After that, the session is marked FAILED and the call ends gracefully.');
  L.push('');

  L.push('## Rate-limit backoff');
  L.push('');
  L.push('LLM/STT/TTS APIs may return HTTP 429 (Too Many Requests) or 5xx errors.');
  L.push('');
  L.push('### Strategy');
  L.push('');
  L.push('1. If `Retry-After` header is present, use that value as the delay.');
  L.push('2. Otherwise, exponential backoff: 1s, 2s, 4s (max 8s) with ±25% jitter.');
  L.push('3. Max 3 retries per request.');
  L.push('4. On final failure, log the error and fall back (if fallback configured).');
  L.push('');
  L.push('```python');
  L.push('from resilience import retry_with_backoff');
  L.push('');
  L.push('@retry_with_backoff(max_retries=3, base_delay=1.0)');
  L.push('async def call_llm(messages):');
  L.push('    return await client.chat.completions.create(...)');
  L.push('```');
  L.push('');

  L.push('## Fallback chains');
  L.push('');
  L.push('Configure fallback providers for each pipeline leg. On primary failure (after retries), switch to the next in the chain.');
  L.push('');
  const orchId = sel.orchestration?.id;
  if (orchId === 'livekit') {
    L.push('### LiveKit: FallbackAdapter');
    L.push('');
    L.push('LiveKit provides built-in `FallbackAdapter` for STT, LLM, and TTS:');
    L.push('```python');
    L.push('from livekit.agents import stt, llm, tts');
    L.push('from livekit.plugins import deepgram, assemblyai, openai, cartesia');
    L.push('');
    L.push('session = AgentSession(');
    L.push('    stt=stt.FallbackAdapter([deepgram.STT(), assemblyai.STT()]),');
    L.push('    llm=llm.FallbackAdapter([openai.LLM(model="gpt-5.5")]),');
    L.push('    tts=tts.FallbackAdapter([cartesia.TTS(...)]),');
    L.push(')');
    L.push('```');
    L.push('');
    L.push('The first provider is primary. If it fails on any error, the next is tried automatically.');
  } else if (orchId === 'pipecat') {
    L.push('### Pipecat: connection error handlers');
    L.push('');
    L.push('Pipecat services auto-reconnect with exponential backoff. Add event handlers for logging:');
    L.push('```python');
    L.push('@tts.event_handler("on_connection_error")');
    L.push('async def on_tts_error(service, error):');
    L.push('    logger.error(f"TTS connection error: {error}")');
    L.push('    # ErrorFrame is pushed through pipeline automatically');
    L.push('```');
    L.push('');
    L.push('For fallback, wrap service calls in `retry_with_backoff` and catch failures to switch providers.');
  } else {
    L.push('### Custom: manual fallback');
    L.push('');
    L.push('Use `FallbackConfig` to define chains and `retry_with_backoff` for each call:');
    L.push('```python');
    L.push('from resilience import FallbackConfig, retry_with_backoff');
    L.push('');
    L.push('fb = FallbackConfig()');
    L.push('fb.register("stt", "deepgram", "assemblyai")');
    L.push('fb.register("llm", "openai", "anthropic")');
    L.push('fb.register("tts", "elevenlabs", "cartesia")');
    L.push('');
    L.push('# On primary failure, get fallback:');
    L.push('fallback = fb.get_fallback("stt", "deepgram")  # -> "assemblyai"');
    L.push('```');
  }
  L.push('');

  L.push('## Tool call timeouts');
  L.push('');
  L.push('Tool calls pause audio output until the tool returns. Set a timeout and respond gracefully:');
  L.push('');
  L.push('```python');
  L.push('import asyncio');
  L.push('');
  L.push('try:');
  L.push('    result = await asyncio.wait_for(call_tool(args), timeout=5.0)');
  L.push('except asyncio.TimeoutError:');
  L.push('    # Respond with a holding message and retry asynchronously');
  L.push('    await speak("Let me check that for you.")');
  L.push('    result = await call_tool(args)  # retry without blocking audio');
  L.push('```');
  L.push('');

  L.push('## Session crash recovery');
  L.push('');
  L.push('On session restart (crash, redeploy), restore conversation state from `TranscriptStore`:');
  L.push('');
  L.push('```python');
  L.push('from state import TranscriptStore, ContextManager');
  L.push('');
  L.push('store = TranscriptStore("transcripts.db")');
  L.push('transcript = store.get_transcript(call_id)');
  L.push('');
  L.push('ctx = ContextManager(max_tokens=128000)');
  L.push('for turn in transcript:');
  L.push('    ctx.add_message(turn["role"], turn["content"])');
  L.push('```');
  return L.join('\n') + '\n';
}

function renderOperations(result) {
  const ops = result.operations;
  const L = ['# Operations & Maintainability', ''];
  L.push('This file records who owns the runtime behaviors that usually decide whether a voice agent is maintainable after launch.');
  L.push('');
  L.push('## Hosting ownership');
  L.push('');
  L.push('| Item | Value |');
  L.push('|---|---|');
  L.push(`| Requested hosting | ${ops.requested_hosting_model} |`);
  L.push(`| Effective hosting | ${ops.effective_hosting_model} |`);
  L.push(`| Runtime label | ${ops.hosting_label} |`);
  L.push(`| Infrastructure owner | ${ops.infrastructure_owner} |`);
  L.push(`| Orchestration | ${ops.orchestration || 'n/a'} |`);
  L.push('');
  if (ops.adjustments.length) {
    L.push('## Resolver adjustments');
    L.push('');
    for (const item of ops.adjustments) L.push(`- ${item}`);
    L.push('');
  }
  L.push('## Responsibilities');
  L.push('');
  for (const item of ops.responsibilities) L.push(`- ${item}`);
  L.push('');
  L.push('## Audio cleanup ownership');
  L.push('');
  L.push('| Feature | Mode | Owner | Action |');
  L.push('|---|---|---|---|');
  for (const feature of ops.audio_features) {
    L.push(`| ${feature.feature} | ${feature.mode} | ${feature.owner} | ${feature.action} |`);
  }
  L.push('');
  L.push('## Debug profile');
  L.push('');
  L.push('| Lever | Value |');
  L.push('|---|---|');
  L.push(`| Profile | ${ops.debug_profile} |`);
  L.push(`| Trace level | ${ops.trace_level} |`);
  L.push(`| Trace sampling | ${ops.trace_sampling} |`);
  L.push(`| Debug audio window | ${ops.retain_debug_audio_sec}s |`);
  L.push('');
  L.push(ops.debug_note);
  L.push('');
  L.push('## Production review checklist');
  L.push('');
  L.push('- Confirm whether raw/debug audio retention is legal for the selected consent and retention policy.');
  L.push('- Keep one trace id across telephony, orchestration, STT/realtime, LLM, TTS, tools, and handoff.');
  L.push('- Log turn state transitions separately from transcript text; many voice bugs are timing bugs, not language bugs.');
  L.push('- Add a regression call for barge-in, long silence, background noise, echo, tool timeout, reconnect, and human handoff.');
  L.push('- Re-run provider docs hydration before changing audio cleanup, endpointing, or provider SDK versions.');
  return L.join('\n') + '\n';
}

function renderVoiceUx(flags) {
  const ux = voiceUxConfig(flags);
  const L = ['# Voice UX Tuning', ''];
  L.push('These are runtime knobs, not documentation-only notes. Generated `voice_ux.py` exposes the same values as a typed config object.');
  L.push('');
  L.push('| Lever | Value | Runtime behavior |');
  L.push('|---|---|---|');
  L.push(`| Endpointing | ${ux.endpointing} (${ux.endpointing_ms}ms) | Controls how quickly a user turn is closed after silence. |`);
  L.push(`| Interruption sensitivity | ${ux.interruption_sensitivity} | Controls how aggressively barge-in flushes playback. |`);
  L.push(`| Audio enhancement | ${ux.audio_enhancement} | Selects provider-native cleanup, voice-focus, raw low-latency, or self-hosted DSP. |`);
  L.push(`| Noise cancellation | ${ux.noise_cancellation} | Controls noise suppression strategy. |`);
  L.push(`| Echo cancellation | ${ux.echo_cancellation} | Controls acoustic echo cancellation ownership/strength. |`);
  L.push(`| Automatic gain control | ${ux.automatic_gain_control} | Controls volume normalization behavior. |`);
  L.push(`| Silence timeout | ${ux.silence_timeout_ms}ms | Reprompt after caller silence. |`);
  L.push(`| Max call duration | ${ux.max_call_duration_sec || 'none'}s | End or hand off calls that exceed the cap. |`);
  L.push(`| Greeting mode | ${ux.greeting_mode} | Determines whether the agent speaks first. |`);
  L.push(`| Voice profile | ${ux.voice_profile} (${ux.speaking_speed}x) | Preferred speaking style and speed. |`);
  L.push(`| Language fallback | ${ux.language_fallback} | How to recover when caller language differs from the selected language. |`);
  L.push('');
  L.push('## Implementation expectations');
  L.push('');
  L.push('- `voice_ux.py` must be loaded by the session entry point.');
  L.push('- Apply audio cleanup in exactly one layer. Double noise suppression or double AGC can create clipped speech and false barge-in.');
  L.push('- Silence and max-duration checks should run on every user/agent state transition.');
  L.push('- If `greeting_mode` is `wait_for_user`, do not generate an opening reply until the first user turn.');
  L.push('- If `language_fallback` is `ask_caller`, the first uncertain language turn should ask the caller which language they prefer.');
  return L.join('\n') + '\n';
}

function renderToolCalling(flags, sel, providers) {
  const L = ['# Tool Calling', ''];
  const toolMode = flags.tools || 'none';
  L.push(`Selected tool mode: **${toolMode}**.`);
  L.push('');
  if (toolMode === 'none') {
    L.push('No external tools are required. Generated `tools.py` still includes a registry so the agent can add tools later without changing the scaffold shape.');
  } else {
    L.push('Generated `tools.py` must provide:');
    L.push('');
    L.push('- A `ToolRegistry` with timeout and retry wrappers.');
    L.push('- Idempotency keys for side-effecting calls.');
    L.push('- Safe speech policy when a tool fails or times out.');
    L.push('- Audit metadata for tool name, latency, status, and redacted arguments.');
    L.push('- A stub for the selected integration mode.');
  }
  L.push('');
  L.push('## Framework notes');
  L.push('');
  if (sel.orchestration?.id === 'livekit') {
    L.push('- LiveKit function tools should use `@function_tool()` on the `Agent` subclass, with `RunContext` as the first runtime argument.');
  } else if (sel.orchestration?.id === 'pipecat') {
    L.push('- Pipecat tools should be exposed through the selected LLM service/tool adapter and traced through `observability.py`.');
  } else {
    L.push('- Custom FastAPI stacks should call tools from the WebSocket/session handler after the model chooses an action.');
  }
  L.push('');
  L.push('## Failure speech policy');
  L.push('');
  L.push('When a tool fails, do not expose stack traces, provider names, secrets, or raw HTTP errors to the caller. Say a short recovery phrase and either retry, hand off, or continue with available information.');
  return L.join('\n') + '\n';
}

function renderObservability(result, flags, sel) {
  const L = ['# Observability', ''];
  const ops = result.operations;
  L.push('Generated `observability.py` creates a per-call timeline and summary metrics. This is the main debug surface for live calls.');
  L.push(`Debug profile: **${ops.debug_profile}**. Trace level: **${ops.trace_level}**. Trace sampling: **${ops.trace_sampling}**. Debug audio window: **${ops.retain_debug_audio_sec}s**.`);
  L.push('');
  L.push('## Required events');
  L.push('');
  for (const event of [
    'call_started',
    'media_frame_in',
    'stt_partial',
    'stt_final',
    'llm_first_token',
    'tts_first_audio',
    'agent_audio_out',
    'interruption_started',
    'interruption_ended',
    'dtmf',
    'tool_started',
    'tool_finished',
    'reconnect_started',
    'reconnect_finished',
    'dropped_frame',
    'call_ended',
  ]) {
    L.push(`- \`${event}\``);
  }
  L.push('');
  L.push('## Metrics');
  L.push('');
  L.push('- STT time to first partial and final.');
  L.push('- LLM time to first token.');
  L.push('- TTS time to first audio.');
  L.push('- First response latency.');
  L.push('- Interruption count and duration.');
  L.push('- Dropped frame count.');
  L.push('- WebSocket reconnect count.');
  L.push('- Tool latency and failure count.');
  L.push('- Audio cleanup mode, VAD false-trigger count, and interruption outcome.');
  L.push(`- Estimated cost per minute: $${result.cost.total_per_minute_usd.toFixed(4)}.`);
  L.push('');
  L.push('## Framework hooks');
  L.push('');
  if (sel.orchestration?.id === 'livekit') {
    L.push('- Attach to LiveKit `AgentSession` state events such as `user_state_changed` and `agent_state_changed`.');
  } else if (sel.orchestration?.id === 'pipecat') {
    L.push('- Attach a Pipecat `BaseObserver` to the pipeline worker/task with metrics enabled.');
  } else {
    L.push('- Emit trace events directly from the FastAPI WebSocket handler and audio bridge.');
  }
  return L.join('\n') + '\n';
}

function renderSafetyCompliance(flags) {
  const safety = safetyConfig(flags);
  const L = ['# Safety & Compliance', ''];
  L.push('| Lever | Value |');
  L.push('|---|---|');
  L.push(`| Recording consent | ${safety.recording_consent} |`);
  L.push(`| Transcript retention | ${safety.transcript_retention_days} days |`);
  L.push(`| PII redaction | ${safety.pii_redaction ? 'enabled' : 'disabled'} |`);
  L.push(`| Tool audit logging | ${safety.audit_tool_actions ? 'enabled' : 'disabled'} |`);
  L.push('');
  L.push('## Required behavior');
  L.push('');
  L.push('- Announce or request recording consent before recording when configured.');
  L.push('- Redact phone numbers, emails, long account numbers, and card-like numbers before logs leave the process.');
  L.push('- Honor opt-out / do-not-call language by ending the sales/collections flow and logging the preference.');
  L.push('- Apply transcript retention to local and remote stores.');
  L.push('- Audit every tool action with a redacted argument summary and idempotency key.');
  L.push('');
  L.push('This is not legal advice. Treat the generated policy as an implementation guardrail and verify jurisdiction-specific requirements before production.');
  return L.join('\n') + '\n';
}

function renderHandoff(flags) {
  const mode = flags.handoff || 'ticket';
  const L = ['# Human Handoff', ''];
  L.push(`Selected handoff mode: **${mode}**.`);
  L.push('');
  L.push('## Escalation triggers');
  L.push('');
  L.push('- Caller asks for a person.');
  L.push('- The agent reaches low confidence on an important answer.');
  L.push('- A side-effecting tool fails repeatedly.');
  L.push('- Safety, compliance, billing, cancellation, or complaint policy requires a human.');
  L.push('- The call reaches max duration or repeated silence.');
  L.push('');
  L.push('## Handoff summary');
  L.push('');
  L.push('Generated `handoff.py` should summarize caller identity, intent, attempted actions, unresolved question, tool results, sentiment/risk, and recommended next action.');
  return L.join('\n') + '\n';
}

function renderLocalTesting(flags, sel) {
  const L = ['# Local Testing With ngrok', ''];
  L.push('Production deployment is out of scope for this recipe, but local PSTN/WebSocket testing needs a public HTTPS/WSS URL.');
  L.push('');
  L.push('## Run locally');
  L.push('');
  L.push('```bash');
  L.push('python server.py');
  L.push('ngrok http 8000');
  L.push('```');
  L.push('');
  L.push('Use the ngrok HTTPS URL as your provider webhook base URL. Use the matching WSS URL for media streams.');
  L.push('');
  if (flags.needs_telephony) {
    const telephony = sel.telephony?.id || 'telephony';
    L.push(`For ${telephony}, point the voice webhook to \`https://<ngrok-domain>/voice\` or the provider-specific generated route, and the media stream URL to \`wss://<ngrok-domain>/ws\`.`);
  } else {
    L.push('For browser/app testing, ngrok is optional unless a third-party callback must reach the local process.');
  }
  L.push('');
  L.push('Generated `local_test.py` prints the derived webhook and WebSocket URLs so users do not have to hand-edit them.');
  return L.join('\n') + '\n';
}

function renderSimulationPlan(result, flags, sel) {
  const L = ['# End-to-End Simulation Plan', ''];
  L.push('`callsmith simulate` runs a deterministic fake call against the selected architecture. It does not call paid APIs.');
  L.push('');
  L.push('## Covered lifecycle');
  L.push('');
  for (const item of [
    'start event',
    'media frames',
    'STT partial/final or realtime input',
    'interruption/barge-in',
    'DTMF',
    'tool call',
    'TTS/model audio output',
    'transcript persistence check',
    'reconnect path',
    'hangup',
    'audio transform/sample-rate assertions',
  ]) {
    L.push(`- ${item}`);
  }
  L.push('');
  L.push('## Expected audio path');
  L.push('');
  if (result.transforms.length) {
    for (const t of result.transforms) L.push(`- [${t.direction}] ${t.step} (${t.from} -> ${t.to})`);
  } else {
    L.push('- Native framework/provider audio normalization. No custom bridge expected.');
  }
  L.push('');
  L.push('## Pass condition');
  L.push('');
  L.push('The simulation passes when every required lifecycle event is present, generated scaffold files are present when `--scaffold` is supplied, and all audio-path expectations match the compiled contract.');
  return L.join('\n') + '\n';
}
