# Handoff contract — Ultra-low latency WebRTC app voice

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "webrtc_app",
  "providers": { "orchestration": "livekit", "realtime": "openai-realtime", "vad": "silero" },
  "policy": { "basis": "organization_policy", "retention_basis": "Seven-day product debugging window.", "recording_consent": "announce", "transcript_retention": "seven_days", "human_handoff": "none" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 500 }
}
```

## 1. Intent / use case
In-app WebRTC companion voice; ultra latency; no PSTN.

## 2. Stack (providers + why)
LiveKit + OpenAI Realtime (or Gemini Live). Architecture realtime_s2s, not cascaded.

## 3. Audio path
WebRTC PCM path; no telephony μ-law.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Consent, retention, handoff, and tools policy rewritten to meet domain floors.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
