# Handoff contract — Refuse unknown AcmeTel synthesis

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "basis": "organization_policy", "retention_basis": "Lead-support operations policy.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "callback" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 900 }
}
```

## 1. Intent / use case
Inbound lead qual; refuse fabricated AcmeTel pack.

## 2. Stack (providers + why)
Twilio (real pack) + LiveKit + Gemini Live. AcmeTel not verified — not synthesized.

## 3. Audio path
Twilio μ-law via LiveKit native path.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Consent, retention, handoff, and tools policy rewritten to meet domain floors.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
