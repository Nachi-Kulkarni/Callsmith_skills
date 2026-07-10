# Handoff contract — Exotel custom bridge (honest heavy path)

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "general",
  "surface": "inbound_pstn",
  "providers": { "telephony": "exotel", "orchestration": "custom-fastapi", "realtime": "gemini-live", "vad": "silero" },
  "policy": { "basis": "organization_policy", "retention_basis": "Support operations policy.", "recording_consent": "announce", "transcript_retention": "thirty_days", "human_handoff": "callback" },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 1000 }
}
```

## 1. Intent / use case

Inbound India PSTN support on Exotel with full control of the media bridge.

## 2. Stack (providers + why)

Exotel telephony + custom FastAPI WebSocket bridge + Gemini Live + Silero VAD. Custom bridge chosen because the brief requires owning the audio path.

## 3. Audio path

Heavy transforms from packs: μ-law 8 kHz decode, resample to model ingress, asymmetric egress resample, encode back to telephony. **Do not claim 0 transforms.** LiveKit native short-circuit is the alternative if ops wants fewer bridges.

## 4. Interruption / barge-in

Barge-in required on full-duplex phone; app owns cancel + flush on custom bridge; Silero VAD for endpointing.

## 5. Floors applied

Consent: announce. Retention: 30 days. Handoff: callback for non-urgent support. Domain general support (not medical).

## 6. Latency / cost note

Expect higher bridge latency than LiveKit SIP path; pack/check style estimate ~800ms+ risk on cascaded hops — quantify with check before pilot. Cost dominated by realtime model ~$0.04/min class.

## 7. Build / implement notes

Implement WS frame reassembly by byte budget; unit-test μ-law round-trip; never invent sample rates — re-read exotel + gemini-live packs.
