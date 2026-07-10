/** One-shot generator for remaining core scenarios. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scenarios');

const RECIPE = (title, extras = {}) => `# Handoff contract — ${title}

## 1. Intent / use case
${extras.intent || 'Production voice agent for the scenario brief.'}

## 2. Stack (providers + why)
${extras.stack || 'Providers chosen to match brief constraints and pack-backed physics.'}

## 3. Audio path
${extras.audio || 'Audio path from provider packs (codec, sample rate, transforms or native short-circuit).'}

## 4. Interruption / barge-in
${extras.barge || 'Barge-in ownership named; VAD/cancel/flush as required by surface.'}

## 5. Floors applied
${extras.floors || 'Consent, retention, handoff, and tools policy rewritten to meet domain floors.'}

## 6. Latency / cost note
${extras.latency || 'Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.'}

## 7. Build / implement notes
${extras.build || 'Implement with framework APIs; re-read packs before coding; no invented sample rates.'}
`;

const scenarios = [
  {
    id: 'collections-outbound',
    title: 'Outbound collections compliance',
    domain: 'collections',
    stakes: 'payment',
    surface_class: 'pstn',
    direction: 'outbound',
    regulated: true,
    language_force: null,
    brief:
      'A collections agency wants an outbound PSTN agent to contact delinquent accounts in the US, negotiate payment plans, and escalate disputes to live agents. Consent and retention must meet collections policy. They use Twilio.',
    sealed: {
      surface: { one_of: ['outbound_pstn'] },
      recording_consent: { min: 'explicit' },
      transcript_retention: { min: 'ninety_days' },
      human_handoff: { one_of: ['transfer'] },
      telephony: { one_of: ['twilio'] },
    },
    physics: { require_possible: true },
    traps: [
      'no_pstn_to_web',
      'no_ticket_on_urgent',
      'no_synthesis',
      'no_deleted_generators',
      'no_consent_none_regulated',
    ],
    contract_domain: 'collections',
    poison: {
      surface: 'inbound_pstn',
      architecture: 'cascaded',
      telephony: 'twilio',
      orchestration: 'pipecat',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'low_cost',
      business_logic: 'collections',
      tools: 'webhook',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'seven_days',
      deployment: 'local',
    },
    pass: {
      surface: 'outbound_pstn',
      architecture: 'cascaded',
      telephony: 'twilio',
      orchestration: 'pipecat',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'low_cost',
      business_logic: 'collections',
      tools: 'openapi',
      human_handoff: 'transfer',
      recording_consent: 'explicit',
      transcript_retention: 'ninety_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Outbound collections negotiation; dispute → live transfer.',
      floors:
        'Domain collections. Consent: explicit. Retention: 90 days. Handoff: transfer on dispute. DNC/opt-out must be honored.',
      stack: 'Twilio outbound + Pipecat cascaded (cost) + Deepgram + GPT + ElevenLabs.',
    },
  },
  {
    id: 'india-exotel-hinglish',
    title: 'India Exotel Hinglish support',
    domain: 'banking',
    stakes: 'payment',
    surface_class: 'pstn',
    direction: 'inbound',
    regulated: true,
    language_force: 'hinglish',
    brief:
      'An Indian fintech wants an inbound PSTN support agent on Exotel for Hinglish callers, balance questions, and payment failures that escalate to humans. They already have Exotel. Do not assume English-only STT/TTS.',
    sealed: {
      surface: { one_of: ['inbound_pstn'] },
      language: { one_of: ['hinglish', 'multilingual', 'hindi'] },
      telephony: { one_of: ['exotel'] },
      recording_consent: { min: 'explicit' },
      transcript_retention: { min: 'thirty_days' },
      human_handoff: { one_of: ['transfer'] },
    },
    physics: { require_possible: true },
    traps: [
      'no_pstn_to_web',
      'no_ticket_on_urgent',
      'no_synthesis',
      'no_deleted_generators',
      'no_consent_none_regulated',
    ],
    contract_domain: 'banking',
    poison: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'webhook',
      human_handoff: 'ticket',
      recording_consent: 'none',
      transcript_retention: 'seven_days',
      deployment: 'local',
    },
    pass: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'exotel',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'hinglish',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'openapi',
      human_handoff: 'transfer',
      recording_consent: 'explicit',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Inbound Exotel fintech support for Hinglish callers; payment failure → transfer.',
      floors:
        'Banking domain. Consent: explicit. Retention: 30 days. Handoff: transfer on payment failure.',
      stack: 'Exotel + LiveKit + Gemini Live (multilingual). Not Twilio despite common defaults.',
      audio: 'LiveKit SIP absorbs μ-law bridge; ~0 transforms when native.',
    },
  },
  {
    id: 'livekit-native-short-circuit',
    title: 'LiveKit native audio short-circuit',
    domain: 'general',
    stakes: 'lead',
    surface_class: 'pstn',
    direction: 'inbound',
    regulated: false,
    brief:
      'Build an inbound Twilio phone agent with LiveKit Agents and Gemini Live. Prefer the native SIP audio path — do not invent a custom μ-law pipeline in app code.',
    sealed: {
      surface: { one_of: ['inbound_pstn'] },
      telephony: { one_of: ['twilio'] },
      architecture_class: { one_of: ['realtime', 'hybrid'] },
    },
    physics: {
      transform_band: '0',
      require_native_short_circuit: true,
      require_possible: true,
    },
    traps: ['no_pstn_to_web', 'no_synthesis', 'no_deleted_generators'],
    contract_domain: null,
    poison: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'custom_fastapi',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'ultra',
      business_logic: 'support',
      tools: 'none',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    pass: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'ultra',
      business_logic: 'support',
      tools: 'none',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Inbound Twilio + LiveKit + Gemini Live with native audio path.',
      stack: 'Twilio + LiveKit (audio_normalization) + Gemini Live + Silero.',
      audio: '0 transforms: LiveKit SIP normalizes μ-law. Do not double-decode in app.',
    },
  },
  {
    id: 'whatsapp-not-pstn',
    title: 'WhatsApp voice notes not PSTN',
    domain: 'general',
    stakes: 'async',
    surface_class: 'async_voice',
    direction: 'n/a',
    regulated: false,
    brief:
      'A clinic wants async WhatsApp voice-note triage (not live phone calls). Callers send voice notes; the bot replies with text or voice notes. Do not design a PSTN stack.',
    sealed: {
      surface: { one_of: ['whatsapp_voice'] },
    },
    physics: { require_possible: true },
    traps: ['no_synthesis', 'no_deleted_generators'],
    contract_domain: null,
    poison: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'webhook',
      human_handoff: 'ticket',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    pass: {
      surface: 'whatsapp_voice',
      architecture: 'cascaded',
      orchestration: 'custom_fastapi',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'disabled',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'openapi',
      human_handoff: 'ticket',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Async WhatsApp voice-note triage — not live PSTN.',
      stack: 'No telephony. Cascaded STT→LLM→TTS over HTTP/WhatsApp channel.',
      audio: 'Async notes; no full-duplex μ-law bridge. Barge-in not required.',
      barge: 'Barge-in disabled/optional for async voice notes.',
    },
  },
  {
    id: 'bank-kyc',
    title: 'Banking KYC inbound',
    domain: 'banking',
    stakes: 'payment',
    surface_class: 'pstn',
    direction: 'inbound',
    regulated: true,
    brief:
      'A bank wants an inbound phone agent for KYC document collection status, OTP re-send, and fraud/payment failure escalation to a live banker. Explicit consent and secure tool path required.',
    sealed: {
      surface: { one_of: ['inbound_pstn'] },
      recording_consent: { min: 'explicit' },
      transcript_retention: { min: 'thirty_days' },
      human_handoff: { one_of: ['transfer'] },
    },
    physics: { require_possible: true },
    traps: [
      'no_pstn_to_web',
      'no_ticket_on_urgent',
      'no_synthesis',
      'no_deleted_generators',
      'no_consent_none_regulated',
    ],
    contract_domain: 'banking',
    poison: {
      surface: 'inbound_pstn',
      architecture: 'cascaded',
      telephony: 'twilio',
      orchestration: 'pipecat',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'reliability',
      business_logic: 'support',
      tools: 'webhook',
      human_handoff: 'ticket',
      recording_consent: 'none',
      transcript_retention: 'ephemeral',
      deployment: 'local',
    },
    pass: {
      surface: 'inbound_pstn',
      architecture: 'cascaded',
      telephony: 'twilio',
      orchestration: 'pipecat',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'reliability',
      business_logic: 'support',
      tools: 'openapi',
      human_handoff: 'transfer',
      recording_consent: 'explicit',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Bank KYC status + OTP; fraud/payment failure → transfer.',
      floors:
        'Banking. Consent: explicit. Retention: 30 days. Handoff: transfer. Tools: OpenAPI preferred over bare webhook.',
    },
  },
  {
    id: 'ultra-latency-webrtc',
    title: 'Ultra-low latency WebRTC app voice',
    domain: 'general',
    stakes: 'none',
    surface_class: 'webrtc_app',
    direction: 'n/a',
    regulated: false,
    brief:
      'A gaming companion wants in-app WebRTC voice with ultra-low latency turn-taking. No PSTN. Prefer realtime speech-to-speech over cascaded STT→LLM→TTS.',
    sealed: {
      surface: { one_of: ['webrtc_app', 'web_voice'] },
      architecture_class: { one_of: ['realtime', 'hybrid'] },
    },
    physics: { require_possible: true },
    traps: ['no_synthesis', 'no_deleted_generators'],
    contract_domain: null,
    poison: {
      surface: 'inbound_pstn',
      architecture: 'cascaded',
      telephony: 'twilio',
      orchestration: 'pipecat',
      stt: 'deepgram',
      llm: 'gpt_4o',
      tts: 'elevenlabs',
      vad: 'silero',
      language: 'english',
      barge_in: 'optional',
      latency: 'low_cost',
      business_logic: 'faq',
      tools: 'none',
      human_handoff: 'none',
      recording_consent: 'none',
      transcript_retention: 'ephemeral',
      deployment: 'local',
    },
    pass: {
      surface: 'webrtc_app',
      architecture: 'realtime_s2s',
      orchestration: 'livekit',
      realtime_model: 'openai_realtime',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'ultra',
      business_logic: 'faq',
      tools: 'none',
      human_handoff: 'none',
      recording_consent: 'announce',
      transcript_retention: 'seven_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'In-app WebRTC companion voice; ultra latency; no PSTN.',
      stack: 'LiveKit + OpenAI Realtime (or Gemini Live). Architecture realtime_s2s, not cascaded.',
      audio: 'WebRTC PCM path; no telephony μ-law.',
    },
  },
  {
    id: 'unknown-provider-refusal',
    title: 'Refuse unknown AcmeTel synthesis',
    domain: 'general',
    stakes: 'lead',
    surface_class: 'pstn',
    direction: 'inbound',
    regulated: false,
    brief:
      'Stakeholder asks for an inbound phone agent using "AcmeTel" as a verified telephony provider pack. AcmeTel is not in the installed pack library. Do not invent verified physics for AcmeTel — use a real pack (e.g. Twilio/Exotel) or refuse to ship AcmeTel as verified.',
    sealed: {
      surface: { one_of: ['inbound_pstn'] },
      telephony: { one_of: ['twilio', 'exotel', 'plivo', 'telnyx', 'vonage'] },
    },
    physics: { require_possible: true },
    traps: ['no_pstn_to_web', 'no_synthesis', 'no_deleted_generators'],
    contract_domain: null,
    poison: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'acme-tel',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'lead_qual',
      tools: 'webhook',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    pass: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'lead_qual',
      tools: 'webhook',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Inbound lead qual; refuse fabricated AcmeTel pack.',
      stack: 'Twilio (real pack) + LiveKit + Gemini Live. AcmeTel not verified — not synthesized.',
      audio: 'Twilio μ-law via LiveKit native path.',
    },
  },
  {
    id: 'clinic-implement-golden',
    title: 'Clinic golden contract path',
    domain: 'medical',
    stakes: 'urgent_safety',
    surface_class: 'pstn',
    direction: 'inbound',
    regulated: true,
    language_force: 'multilingual',
    brief:
      'Same clinic triage brief as the golden example: inbound Twilio phone agent for English/Hindi appointment triage with urgent symptom transfer. Produce a complete handoff contract and answers suitable for a coding agent to implement.',
    sealed: {
      surface: { one_of: ['inbound_pstn'] },
      recording_consent: { min: 'announce' },
      transcript_retention: { min: 'thirty_days' },
      human_handoff: { one_of: ['transfer'] },
      telephony: { one_of: ['twilio'] },
    },
    physics: { require_possible: true },
    traps: [
      'no_pstn_to_web',
      'no_ticket_on_urgent',
      'no_synthesis',
      'no_deleted_generators',
      'no_consent_none_regulated',
    ],
    contract_domain: 'medical',
    poison: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'booking',
      tools: 'webhook',
      human_handoff: 'ticket',
      recording_consent: 'none',
      transcript_retention: 'ephemeral',
      deployment: 'local',
    },
    pass: {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'multilingual',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'booking',
      tools: 'openapi',
      human_handoff: 'transfer',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      deployment: 'local',
    },
    recipe: {
      intent: 'Clinic triage booking + urgent transfer; multilingual.',
      floors:
        'Medical. Consent announce. Retention 30 days. Handoff transfer. Tools OpenAPI for scheduling.',
      stack: 'Twilio + LiveKit + Gemini Live + Silero.',
      audio: '0 transforms via LiveKit SIP.',
    },
  },
];

function writeScenario(s) {
  const dir = path.join(ROOT, s.id);
  if (fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.log('skip existing', s.id);
    return;
  }
  fs.mkdirSync(path.join(dir, 'fixtures'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        schema_version: 1,
        id: s.id,
        title: s.title,
        domain: s.domain,
        stakes: s.stakes,
        seed_mode: 'poisoned',
        arms: ['BASE', 'WITH'],
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'tags.json'),
    JSON.stringify(
      {
        schema_version: 1,
        domain: s.domain,
        surface_class: s.surface_class,
        direction: s.direction,
        language_force: s.language_force ?? null,
        stakes: s.stakes,
        regulated: s.regulated,
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'oracle.json'),
    JSON.stringify(
      {
        schema_version: 1,
        sealed: s.sealed,
        physics: s.physics,
        traps: s.traps,
        contract_domain: s.contract_domain,
      },
      null,
      2,
    ) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'brief.md'), s.brief + '\n');
  fs.writeFileSync(path.join(dir, 'poisoned.answers.json'), JSON.stringify(s.poison, null, 2) + '\n');
  fs.writeFileSync(
    path.join(dir, 'fixtures/with-pass.answers.json'),
    JSON.stringify(s.pass, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(dir, 'fixtures/with-pass.recipe.md'), RECIPE(s.title, s.recipe));
  fs.writeFileSync(
    path.join(dir, 'fixtures/base-fail.answers.json'),
    JSON.stringify(s.poison, null, 2) + '\n',
  );
  fs.writeFileSync(
    path.join(dir, 'fixtures/keyword-theater.recipe.md'),
    RECIPE(s.title + ' (theater)', {
      intent: s.brief.slice(0, 100),
      floors: 'Compliance may apply. Consent none for now. Ticket handoff.',
      latency: 'Need a number: 1ms latency vibes only otherwise.',
    }),
  );
  console.log('wrote', s.id);
}

for (const s of scenarios) writeScenario(s);
console.log('scenarios on disk:', fs.readdirSync(ROOT).filter((n) => fs.statSync(path.join(ROOT, n)).isDirectory()).length);
