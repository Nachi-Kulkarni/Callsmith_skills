# Handoff contract — Outbound collections compliance

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "collections",
  "surface": "outbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "pipecat", "stt": "deepgram", "llm": "openai", "tts": "elevenlabs", "vad": "silero" },
  "policy": { "jurisdiction": "US", "basis": "organization_policy", "retention_basis": "Collections dispute and audit policy; confirm state and federal requirements.", "recording_consent": "explicit", "transcript_retention": "ninety_days", "human_handoff": "transfer" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 1200 }
}
```

## 1. Intent / use case
Outbound collections negotiation; dispute → live transfer.

## 2. Stack (providers + why)
Twilio outbound + Pipecat cascaded (cost) + Deepgram + GPT + ElevenLabs.

## 3. Audio path
Audio path from provider packs (codec, sample rate, transforms or native short-circuit).

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Domain collections. Consent: explicit. Retention: 90 days. Handoff: transfer on dispute. DNC/opt-out must be honored.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
