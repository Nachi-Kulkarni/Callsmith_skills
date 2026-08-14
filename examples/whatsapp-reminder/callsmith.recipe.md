# Handoff contract — WhatsApp delivery reminder (async voice notes)

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "whatsapp_voice",
  "providers": { "orchestration": "custom-fastapi", "stt": "deepgram", "llm": "gemini", "tts": "sarvam", "vad": "silero" },
  "policy": {
    "basis": "organization_policy",
    "retention_basis": "Shop ops policy SHOP-3: transcripts kept 7 days for delivery-dispute continuity; voice-note audio is deleted after transcription.",
    "recording_consent": "none",
    "transcript_retention": "seven_days",
    "human_handoff": "ticket"
  },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 60000 }
}
```

## 1. Intent / use case

Async voice-note assistant for a D2C e-commerce shop. Customers reply to delivery updates on WhatsApp with voice notes; the agent transcribes, answers "where is my order" questions, reschedules delivery slots, and takes opt-outs. Success = correct order action or an honest async handoff — never a promised live transfer the channel cannot honor, never invented logistics claims.

## 2. Stack (providers + why)

| Layer | Choice | Why |
|---|---|---|
| Surface | WhatsApp voice notes | Customers already reply in the same chat as the delivery update; async by nature |
| Architecture | Cascaded | Notes are complete utterances — no realtime session to hold, no turn-taking physics to fight |
| Orchestration | Custom FastAPI worker | Webhook + job queue; the shop owns the media download/decode path end to end |
| STT | Deepgram | Accurate batch transcription of the downloaded note |
| LLM | Gemini 3.5 Flash | Handles Hinglish delivery/reschedule phrasing from Indian customers |
| TTS | Sarvam | Natural Indian-language voice-note replies |
| VAD | Silero | Trims leading/trailing silence in notes before STT |

No telephony pack is selected: per `reference/policy.md` channel constraints, `whatsapp_voice` never carries a telephony key.

## 3. Audio path

Notes arrive via the WhatsApp Business Media API as Opus in an OGG container. The worker downloads the media, decodes Opus → 16 kHz mono linear PCM (Deepgram ingest: `encoding=linear16&sample_rate=16000`), and after synthesis encodes Sarvam PCM output back to Opus/OGG for upload. **Transforms on pack-to-pack bridges: none exist on this surface** (no telephony μ-law leg); both decode and encode are owned by the worker, in code.

## 4. Interruption / barge-in

**None.** Async channel — per policy.md, `whatsapp_voice` has no live barge-in. Notes are sequential: if a second note arrives while the first reply is being generated, queue it and answer the pair as one turn (dedupe by WhatsApp message id). Silero runs only for silence trimming, not turn-taking.

## 5. Floors applied

| Policy | Choice | Receipt |
|---|---|---|
| Domain | General (e-commerce delivery) | Non-regulated on purpose: medical/banking floors force `transfer`, which an async channel cannot honor |
| Recording consent | **none** | No recording is made — note audio is deleted after transcription |
| Transcript retention | **7 days** | Delivery-dispute window; then deleted |
| Human handoff | **ticket** on refund / damaged-parcel / anything multi-party | Async-honest: ticket with transcript summary + order id routed to shop staff; no live-transfer promise |
| Tools | OpenAPI for orders/delivery slots | Durable authenticated interface for slot changes; webhook-only rejected |

## 6. Latency / cost note

Per-note compute once dequeued ≈ 300ms Deepgram transcript + 350ms Gemini TTFT + 200ms Sarvam first audio + ~30ms worker/VAD ≈ **0.9s**; the SLO (turn_gap_ms p95 = 60s) is dominated by queue depth, not model legs — monitor queue wait separately from compute. Modeled cost ≈ **$0.0099/min** (STT 0.0048 + LLM 0.0001 + TTS 0.005, worker free/self-hosted) plus Meta WhatsApp per-conversation pricing — verify current Meta rates before launch.

## 7. Build / implement notes

1. WhatsApp webhook → signature verify → enqueue job (idempotent by message id).
2. Worker: download media, decode Opus → PCM 16k, Silero trim, Deepgram transcription.
3. Gemini tool loop against the OpenAPI order service (reschedule, address change, opt-out); timeouts + idempotency keys on slot mutations.
4. Sarvam synthesis → encode OGG Opus → send reply note; delete audio artifacts post-transcription.
5. Escalation: refund/damaged-parcel disputes → ticket with summary; never promise a call.
6. Do not invent sample rates — re-read `providers/stt/deepgram.json` and `providers/tts/sarvam.json` before coding.
