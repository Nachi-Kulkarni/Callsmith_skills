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
| `language` | any BCP 47 language tag, or `multilingual` when switching is required |

Common mappings:

- warm transfer / live agent → `transfer`
- verbal opt-in → `explicit`
- keep for 30 days → `thirty_days`
- Several supported languages with one stable default → that primary language's BCP 47 tag; use `multilingual` only when switching is required
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

Menu IDs (e.g. `gpt_4o`) are stable handles for answers files; the currently pinned model version and its dated evidence live in the provider pack, not the ID.

Omit provider legs that do not exist. The string `"none"` is never a provider ID. Unknown providers require a real researched pack; they are not synthesized.

## Channel constraints

| Brief | Required shape |
|---|---|
| Live phone/PSTN | `inbound_pstn` or `outbound_pstn` plus a telephony pack |
| Async WhatsApp voice note | `whatsapp_voice`, no telephony, no live barge-in. Channel facts (OGG/Opus mono voice notes, 16 MB cap, 24 h window) live in `providers/telephony/whatsapp-cloud.json` — no answers leg selects it; load the pack directly |
| Ultra-low-latency in-app voice | `webrtc_app` or `web_voice`; prefer realtime S2S unless evidence supports a cascade |
| Named carrier | Keep that carrier unless the contract explains a user-approved substitution |

## Hard floors

These are conservative Callsmith product defaults, not universal legal requirements. Regulated deployments still require jurisdiction-specific organizational/legal review, recorded in the contract receipt. **This is the single floor table** — other documents point here; do not copy it.

| Domain signals | Minimum consent | Minimum retention | High-stakes handoff |
|---|---|---|---|
| Medical / clinical / patient | `announce` | `thirty_days` | `transfer` |
| Banking / payment / KYC | `explicit` | `thirty_days` | `transfer` |
| Collections / debt / dispute | `explicit` | `ninety_days` | `transfer` |
| Legal / attorney | `announce` | `ninety_days` | `transfer` |
| Insurance / FNOL | `announce` | `ninety_days` | `transfer` |

Handoff ladder by stakes: urgent medical, payment failure, collections dispute, or fraud → `transfer`; non-urgent lead-gen → `callback` or `ticket`; async-only channels → `ticket`.

Acknowledging a problem is not handling it. Rewrite the answers and receipt. A below-default choice only passes with `basis: "explicit_risk_acceptance"` and a non-empty named acceptor and reason, following `reference/contract.md`.

Tool-changing actions (booking, CRM, ERP, payment promises) need a durable, authenticated interface. Prefer an OpenAPI-described integration; if a generic webhook is chosen, record the comparison and failure/idempotency behavior. Collections promise-to-pay requires the durable write.
