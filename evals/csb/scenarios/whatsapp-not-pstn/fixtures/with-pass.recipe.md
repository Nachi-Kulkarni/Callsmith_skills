# Handoff contract — WhatsApp voice notes not PSTN

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "medical",
  "surface": "whatsapp_voice",
  "providers": { "orchestration": "custom-fastapi", "stt": "deepgram", "llm": "openai", "tts": "elevenlabs", "vad": "silero" },
  "policy": { "jurisdiction": "clinic-defined", "basis": "callsmith_default", "retention_basis": "Callsmith medical default; clinic review required before launch.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "transfer" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 2500 }
}
```

## 1. Intent / use case
Async WhatsApp voice-note triage — not live PSTN.

## 2. Stack (providers + why)
No telephony. Cascaded STT→LLM→TTS over HTTP/WhatsApp channel.

## 3. Audio path
Async notes; no full-duplex μ-law bridge. Barge-in not required.

## 4. Interruption / barge-in
Barge-in disabled/optional for async voice notes.

## 5. Floors applied
Consent, retention, handoff, and tools policy rewritten to meet domain floors.

## 6. Latency / cost note
Latency ≈ 600ms class; cost ≈ $0.04/min vs cascaded alternative from pack estimates.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
