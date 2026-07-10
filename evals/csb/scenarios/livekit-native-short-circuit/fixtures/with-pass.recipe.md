# Handoff contract — LiveKit native audio short-circuit

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "basis": "organization_policy", "retention_basis": "Support quality policy.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "callback" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 800 }
}
```

## 1. Intent / use case
Inbound Twilio + LiveKit + Gemini Live with native audio path.

## 2. Stack (providers + why)
Twilio + LiveKit (audio_normalization) + Gemini Live + Silero.

## 3. Audio path
0 transforms: LiveKit SIP normalizes μ-law. Do not double-decode in app.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Consent, retention, handoff, and tools policy rewritten to meet domain floors.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
