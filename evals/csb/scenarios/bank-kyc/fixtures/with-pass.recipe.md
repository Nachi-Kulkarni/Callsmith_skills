# Handoff contract — Banking KYC inbound

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "banking",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "pipecat", "stt": "deepgram", "llm": "openai", "tts": "elevenlabs", "vad": "silero" },
  "policy": { "jurisdiction": "IN", "basis": "organization_policy", "retention_basis": "Bank KYC audit policy; confirm with compliance before launch.", "recording_consent": "explicit", "transcript_retention": "thirty_days", "human_handoff": "transfer" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 1200 }
}
```

## 1. Intent / use case
Bank KYC status + OTP; fraud/payment failure → transfer.

## 2. Stack (providers + why)
Providers chosen to match brief constraints and pack-backed physics.

## 3. Audio path
Audio path from provider packs (codec, sample rate, transforms or native short-circuit).

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Banking. Consent: explicit. Retention: 30 days. Handoff: transfer. Tools: OpenAPI preferred over bare webhook.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
