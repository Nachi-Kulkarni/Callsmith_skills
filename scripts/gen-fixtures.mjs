#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures', 'grid');

const BASE = {
  language: 'english',
  barge_in: 'required',
  latency: 'balanced',
  business_logic: 'support',
  tools: 'webhook',
  deployment: 'railway',
};

const rt = (telephony, orch, model, extra = {}) => ({
  ...BASE, surface: 'inbound_pstn', architecture: 'realtime_s2s',
  telephony, orchestration: orch, realtime_model: model, ...extra,
});

const cas = (telephony, orch, stt, tts, extra = {}) => ({
  ...BASE, surface: 'inbound_pstn', architecture: 'cascaded',
  telephony, orchestration: orch, stt, tts, llm: 'gpt_4o', ...extra,
});

const TEL = ['exotel', 'twilio', 'plivo', 'telnyx', 'vonage'];
const ORCH = ['livekit', 'pipecat', 'custom_fastapi'];
const RT_MODEL = ['gemini_live', 'openai_realtime'];
const STT = ['deepgram', 'assemblyai'];
const TTS = ['elevenlabs', 'cartesia', 'sarvam'];

const fixtures = {};

// Golden corridor
fixtures['01-exotel-livekit-gemini'] = rt('exotel', 'livekit', 'gemini_live');
fixtures['02-exotel-custom-gemini'] = rt('exotel', 'custom_fastapi', 'gemini_live');
fixtures['03-twilio-pipecat-deepgram-elevenlabs'] = cas('twilio', 'pipecat', 'deepgram', 'elevenlabs');

// Every telephony in a realtime golden pairing with LiveKit
for (const t of TEL) fixtures[`10-${t}-livekit-gemini`] = rt(t, 'livekit', 'gemini_live');

// Every telephony with custom-FastAPI bridge (the 4-transform case)
for (const t of TEL) fixtures[`20-${t}-custom-gemini`] = rt(t, 'custom_fastapi', 'gemini_live');

// Every telephony with Pipecat + OpenAI
for (const t of TEL) fixtures[`30-${t}-pipecat-openai`] = rt(t, 'pipecat', 'openai_realtime');

// Every STT in a cascaded stack
for (const s of STT) fixtures[`40-twilio-pipecat-${s}-elevenlabs`] = cas('twilio', 'pipecat', s, 'elevenlabs');

// Every TTS in a cascaded stack
for (const t of TTS) fixtures[`50-twilio-pipecat-deepgram-${t}`] = cas('twilio', 'pipecat', 'deepgram', t);

// Orchestration variety with cascaded
fixtures['60-exotel-livekit-deepgram-elevenlabs'] = cas('exotel', 'livekit', 'deepgram', 'elevenlabs');
fixtures['61-exotel-custom-deepgram-elevenlabs'] = cas('exotel', 'custom_fastapi', 'deepgram', 'elevenlabs');

// Edge cases
fixtures['70-outbound-twilio-livekit-gemini'] = rt('twilio', 'livekit', 'gemini_live', { surface: 'outbound_pstn' });
fixtures['71-web-voice-livekit-gemini'] = { ...BASE, surface: 'web_voice', architecture: 'realtime_s2s', orchestration: 'livekit', realtime_model: 'gemini_live' };

// Cross-product edges: mixed providers
fixtures['80-plivo-pipecat-assemblyai-cartesia'] = cas('plivo', 'pipecat', 'assemblyai', 'cartesia');
fixtures['81-telnyx-custom-assemblyai-sarvam'] = cas('telnyx', 'custom_fastapi', 'assemblyai', 'sarvam');
fixtures['82-vonage-pipecat-deepgram-cartesia'] = cas('vonage', 'pipecat', 'deepgram', 'cartesia');

fs.mkdirSync(OUT, { recursive: true });
let count = 0;
for (const [name, answers] of Object.entries(fixtures)) {
  fs.writeFileSync(path.join(OUT, `${name}.answers.json`), JSON.stringify(answers, null, 2) + '\n');
  count++;
}
console.log(`Generated ${count} grid fixtures into ${path.relative(ROOT, OUT)}/`);
