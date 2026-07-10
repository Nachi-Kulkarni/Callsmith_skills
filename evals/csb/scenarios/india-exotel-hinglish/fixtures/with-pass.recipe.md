# Handoff contract — India Exotel Hinglish support

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "banking",
  "surface": "inbound_pstn",
  "providers": { "telephony": "exotel", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "jurisdiction": "IN", "basis": "organization_policy", "retention_basis": "Fintech support audit policy; confirm DPDP and sector requirements.", "recording_consent": "explicit", "transcript_retention": "thirty_days", "human_handoff": "transfer" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 900 }
}
```

## 1. Intent / use case
Inbound Exotel fintech support for Hinglish callers; payment failure → transfer.

## 2. Stack (providers + why)
Exotel + LiveKit + Gemini Live (multilingual). Not Twilio despite common defaults.

## 3. Audio path
LiveKit SIP absorbs μ-law bridge; ~0 transforms when native.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Banking domain. Consent: explicit. Retention: 30 days. Handoff: transfer on payment failure.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
