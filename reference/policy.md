# Canonical choices and product floors

Load this reference before writing `voice.answers.json` or a contract receipt. Natural-language answers are mapped to these IDs; do not create synonyms.

## Canonical answer IDs

| Field | Allowed IDs |
|---|---|
| `surface` | `inbound_pstn`, `outbound_pstn`, `web_voice`, `webrtc_app`, `whatsapp_voice` |
| `architecture` | `realtime_s2s`, `cascaded`, `hybrid` |
| `recording_consent` | `none`, `announce`, `explicit` |
| `transcript_retention` | `ephemeral`, `seven_days`, `thirty_days`, `ninety_days` |
| `human_handoff` | `none`, `transfer`, `callback`, `ticket` |
| `language` | `english`, `hindi`, `hinglish`, `tamil`, `kannada`, `multilingual` |

Common mappings:

- warm transfer / live agent → `transfer`
- verbal opt-in → `explicit`
- keep for 30 days → `thirty_days`
- English and Hindi → `multilingual` or `hinglish`
- WhatsApp voice notes → `whatsapp_voice`, without a telephony key

Provider values in `voice.answers.json` use menu IDs; the receipt uses pack IDs:

| Layer | Answer IDs | Pack IDs |
|---|---|---|
| Telephony | `exotel`, `twilio`, `plivo`, `telnyx`, `vonage` | same |
| Orchestration | `livekit`, `pipecat`, `custom_fastapi` | `livekit`, `pipecat`, `custom-fastapi` |
| Realtime | `gemini_live`, `openai_realtime` | `gemini-live`, `openai-realtime` |
| STT | `deepgram`, `assemblyai` | same |
| LLM | `gpt_4o`, `claude`, `gemini_l` | `openai`, `anthropic`, `gemini` |
| TTS | `elevenlabs`, `sarvam`, `cartesia` | same |
| VAD | `silero`, `deepgram_endpointing`, `webrtc_vad` | `silero`, `deepgram-endpointing`, `webrtc-vad` |

Omit provider legs that do not exist. The string `"none"` is never a provider ID. Unknown providers require a real researched pack; they are not synthesized.

## Channel constraints

| Brief | Required shape |
|---|---|
| Live phone/PSTN | `inbound_pstn` or `outbound_pstn` plus a telephony pack |
| Async WhatsApp voice note | `whatsapp_voice`, no telephony, no live barge-in |
| Ultra-low-latency in-app voice | `webrtc_app` or `web_voice`; prefer realtime S2S unless evidence supports a cascade |
| Named carrier | Keep that carrier unless the contract explains a user-approved substitution |

## Hard floors

These are conservative Callsmith product defaults, not universal legal requirements. Regulated deployments still require jurisdiction-specific organizational/legal review, recorded in the contract receipt.

| Domain signals | Minimum consent | Minimum retention | High-stakes handoff |
|---|---|---|---|
| Medical / clinical / patient | `announce` | `thirty_days` | `transfer` |
| Banking / payment / KYC | `explicit` | `thirty_days` | `transfer` |
| Collections / debt / dispute | `explicit` | `ninety_days` | `transfer` |
| Legal / attorney | `announce` | `ninety_days` | `transfer` |
| Insurance / FNOL | `announce` | `ninety_days` | `transfer` |

Acknowledging a problem is not handling it. Rewrite the answers and receipt. A below-default choice only passes with `basis: "explicit_risk_acceptance"` and a non-empty named acceptor and reason, following `reference/contract.md`.

Tool-changing actions (booking, CRM, ERP, payment promises) need a durable, authenticated interface. Prefer an OpenAPI-described integration; if a generic webhook is chosen, record the comparison and failure/idempotency behavior.
