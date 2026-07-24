# Handoff contract — Managed-cloud deploy vs custom bridge trap

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "basis": "organization_policy", "retention_basis": "Lead-support operations policy.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "callback" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 800 }
}
```

## 1. Intent / use case
Inbound Twilio lead-qualification agent for a two-person team with no ops capacity; a managed cloud runs the agent worker; deploys must never drop a live caller.

## 2. Stack (providers + why)
Twilio + LiveKit (audio_normalization) + Gemini Live + Silero, deployed on LiveKit Cloud managed agents — the platform owns worker scaling and drain, which is what a no-ops pilot needs.

## 3. Audio path
0 transforms: LiveKit SIP normalizes μ-law to 16 kHz PCM at the edge. No custom μ-law bridge in app code.

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface. One shared Silero session per worker, pre-warmed at startup — never reloaded per call.

## 5. Floors applied
Consent announce, retention thirty_days, handoff callback; tools webhook acceptable for pilot (no state-changing actions); floors rewritten to match answers.

## 6. Latency / cost note
Latency ≈ 620 ms class planning estimate (unmeasured, not an SLO); cost ≈ $0.043/min from pack planning estimates vs self-host infra + $0 media fee — verify before committing.

## 7. Build / implement notes
Deploy via LiveKit Cloud managed agents (lk agent create); platform-managed drain on deploy; region-pin the worker near the Twilio edge; env keys (TWILIO_*, LIVEKIT_*, GEMINI_API_KEY) live in a secrets manager.
