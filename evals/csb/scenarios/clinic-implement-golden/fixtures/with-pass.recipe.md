# Handoff contract — Clinic golden contract path

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "medical",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "jurisdiction": "US", "basis": "organization_policy", "retention_basis": "Clinic pilot policy; legal review required before launch.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "transfer" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 900 }
}
```

## 1. Intent / use case
Clinic triage booking + urgent transfer; multilingual.

## 2. Stack (providers + why)
Twilio + LiveKit + Gemini Live + Silero.

## 3. Audio path
0 transforms via LiveKit SIP.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Medical. Consent announce. Retention 30 days. Handoff transfer. Tools OpenAPI for scheduling.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
