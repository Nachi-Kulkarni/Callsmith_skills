# Handoff contract — clinic triage (inbound PSTN)

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "medical",
  "surface": "inbound_pstn",
  "providers": { "telephony": "twilio", "orchestration": "livekit", "realtime": "gemini-live", "vad": "silero" },
  "policy": {
    "jurisdiction": "US",
    "basis": "organization_policy",
    "retention_basis": "Clinic care-continuity and dispute policy; confirm against state requirements before launch.",
    "recording_consent": "announce",
    "transcript_retention": "thirty_days",
    "human_handoff": "transfer"
  },
  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 900 }
}
```

## 1. Intent / use case

Inbound phone agent for a multi-specialty clinic. Callers describe symptoms; agent triages urgency, books or reschedules appointments, and escalates medical red flags to staff. Success = correct urgency class + appointment slot or live transfer without inventing clinical advice.

## 2. Stack (providers + why)

| Layer | Choice | Why |
|---|---|---|
| Surface | Inbound PSTN | Patients call the published clinic number |
| Architecture | Realtime S2S | Low-latency natural dialogue for anxious callers |
| Telephony | Twilio | Existing clinic account; Media Streams |
| Orchestration | LiveKit | SIP trunk absorbs μ-law bridge; native barge-in path |
| Realtime model | Gemini Live | Multilingual + solid telephony pilot fit |
| VAD | Silero | Framework-standard endpointing |

## 3. Audio path

Twilio Media Streams → LiveKit SIP. LiveKit normalizes telephony audio (pack: livekit `audio_normalization`). **Transforms on agent bridge: 0** (native short-circuit). Do not double-decode μ-law in app code.

## 4. Interruption / barge-in

Full-duplex phone → barge-in **required**. Ownership: LiveKit turn handling + Silero VAD; on barge-in cancel model output, stop TTS/playout, clear telephony playback buffer, resume listen. Do not rely on prompt-only interruption.

## 5. Floors applied

| Policy | Choice | Receipt |
|---|---|---|
| Domain | Medical / clinical | Clinic triage |
| Recording consent | **announce** (prefer explicit on recorded lines) | Before: none → After: announce at call start |
| Transcript retention | **30 days** | Explicitly chosen for care continuity / disputes |
| Human handoff | **transfer** on urgent safety / clinical escalation | Not ticket-only |
| Tools | OpenAPI for scheduling EHR | Webhook only if OpenAPI unavailable (document comparison) |

## 6. Latency / cost note

Target p50 conversational turn under ~800ms perceived. LiveKit + Gemini Live avoids cascaded STT→LLM TTFT stack. Pack estimates: telephony+realtime path ≈ lower $/min than cascaded STT+LLM+TTS for long calls; alternative cascaded Deepgram+GPT+ElevenLabs adds STT+TTS legs (~+$0.01–0.05/min order depending on rates) and LLM TTFT risk >500ms — rejected for first pilot.

## 7. Build / implement notes

1. Wire Twilio number → LiveKit SIP inbound.
2. Agent session: Gemini Live + Silero; consent announcement as first utterance.
3. Scheduling tools via OpenAPI client; timeouts + idempotency.
4. Transfer to nurse line with summary (reason, symptoms, caller id).
5. Log timeline: ring, media up, first model audio, barge-in, tool, transfer, hangup.
6. Do not invent sample rates — re-read `providers/telephony/twilio.json` and `providers/orchestration/livekit.json` before coding.
