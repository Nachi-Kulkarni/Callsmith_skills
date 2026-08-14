# Handoff contract — in-app card support (ultra-low-latency WebRTC)

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "banking",
  "surface": "webrtc_app",
  "providers": { "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": {
    "jurisdiction": "US",
    "basis": "organization_policy",
    "retention_basis": "Bank ops policy PAY-7: 30-day transcript retention for disputes and supervision; confirm against federal/state requirements before launch.",
    "recording_consent": "explicit",
    "transcript_retention": "thirty_days",
    "human_handoff": "transfer"
  },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 600 }
}
```

## 1. Intent / use case

Voice assistant inside a US neobank's mobile app. Cardholders ask about transactions, card freezes, travel notices, and dispute intake by talking to the app. Success = correct account action via tools, or a warm transfer to a human specialist — without the agent inventing financial advice or proceeding past explicit consent.

## 2. Stack (providers + why)

| Layer | Choice | Why |
|---|---|---|
| Surface | WebRTC in-app | Customers speak inside the banking app they are already logged into |
| Architecture | Realtime S2S | Ultra-low-latency brief → realtime S2S per policy.md channel constraints; cascade rejected (STT+TTS legs + LLM TTFT risk >500ms) |
| Orchestration | LiveKit Agents | Realtime rooms, native barge-in path, server-side audio normalization |
| Realtime model | Gemini Live | 16k in / 24k out; solid tool-calling for account actions |
| VAD | Silero | Framework-standard endpointing |

No telephony pack is selected — app-to-app WebRTC has no PSTN leg.

## 3. Audio path

App publishes Opus over WebRTC → LiveKit delivers normalized 16 kHz PCM frames to the worker regardless of transport (pack: livekit `audio_normalization`) → Gemini Live takes `audio/pcm;rate=16000` in, emits 24 kHz PCM out → LiveKit re-encodes 24k PCM → Opus for the room. **Transforms on agent bridge: 0.** `callsmith check` still flags Gemini Live's asymmetric 16k-in/24k-out rates: on this stack the conversion lives inside the LiveKit Google plugin — build two independent resamplers only if you bypass that plugin. Do not decode Opus in app code.

## 4. Interruption / barge-in

Full-duplex device audio → barge-in **required**. Ownership: LiveKit turn handling + Silero VAD; on barge-in cancel model output, stop TTS/playout, resume listen. Do not rely on prompt-only interruption.

## 5. Floors applied

| Policy | Choice | Receipt |
|---|---|---|
| Domain | Banking / cards | Regulated: jurisdiction recorded in receipt |
| Recording consent | **explicit** (banking floor) | In-app consent gate before the session starts; no session without a recorded opt-in |
| Transcript retention | **30 days** (banking floor) | Disputes + supervision window |
| Human handoff | **transfer** on disputes / fraud suspicion / anything adversarial | Warm transfer: specialist joins the same LiveKit room with a session summary — the physics of this surface honors a live floor |
| Tools | OpenAPI for core banking | Authenticated, idempotent card/transaction actions; webhook-only rejected |

## 6. Latency / cost note

Pack planning allowances sum ≈ 20ms (LiveKit pipeline) + 500ms (Gemini Live response start) + 20ms (Silero) ≈ **540ms** of compute per turn; the SLO (turn_gap_ms p95 = 600ms) leaves ~60ms of headroom — capture Turn Gap traces on the deployed path before locking the number. Modeled cost ≈ **$0.030/min** (Gemini Live 0.025 + LiveKit Cloud 0.005 per participant-minute); a cascaded Deepgram+GPT+ElevenLabs fallback adds STT/TTS legs (~+$0.01–0.05/min order depending on rates) and TTFT risk >500ms — rejected for the pilot.

## 7. Build / implement notes

1. Consent gate: explicit in-app opt-in recorded before a room token is minted; declined → chat fallback, no voice session.
2. Mint short-lived LiveKit room tokens from the app backend after consent.
3. Agent session: Gemini Live + Silero; banking system prompt with no-advice guardrails.
4. Card/transaction tools via OpenAPI client with per-session auth, timeouts, idempotency.
5. Transfer: invite specialist into the room with summary (reason, verified customer, actions taken).
6. Log timeline: consent, room join, first model audio, barge-in, tool, transfer, session end.
7. Do not invent sample rates — re-read `providers/realtime/gemini-live.json` and `providers/orchestration/livekit.json` before coding.
