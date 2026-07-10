# Turn Gap latency

Optimize the silence the user actually hears. **Turn Gap** is the primary metric:

```text
turn_gap_ms = audio_first_audible_ms - speech_end_ms
```

`speech_end_ms` is the acoustic end of the user's utterance, not the VAD decision, final transcript, or request dispatch. `audio_first_audible_ms` is when the first non-silent agent audio is rendered to the user, not when TTS returns bytes or the server writes a packet. A labeled acoustic endpoint is ground truth. A production detector endpoint is an observable estimate and must be marked `speech_end_source: "detector"`; never compare it as if it were labeled truth.

TTFT remains useful as the LLM-only submetric `llm_first_token_ms - llm_request_ms`. It cannot stand in for Turn Gap.

## Clock rules

- Record all timestamps for a trace with one monotonic clock in milliseconds. Wall clocks can jump and are forbidden for duration math.
- Keep one `clock.origin_id`. If browser, media server, and worker clocks cannot share an origin, translate at collection time and record worst-case `synchronization_error_ms`.
- Timestamp at the boundary named: receive and send events are different. Do not backfill events from averages.
- Keep raw per-turn samples. Aggregate only after validation.
- Compare runs only when architecture, surface, transport, region, runtime, provider/model versions, network profile, and audio format are equivalent or the difference is the declared experiment.

The portable JSON contract is [`turn-trace.schema.json`](turn-trace.schema.json). Required stages are:

```text
speech_end → EOU detected → transcript final → LLM request → first token
           → text committed → TTS request → first audio chunk
           → first playout → first audible audio
```

For a realtime speech-to-speech provider, use the provider's transcript/semantic-commit and response/audio events for the corresponding fields. Equal timestamps are valid when stages are fused; omitting stages is not.

## Spans and attribution

Compute these spans per turn before percentiles:

| Span | Calculation | Owner |
|---|---|---|
| Endpointing | `eou_detected - speech_end` | VAD/turn detector |
| Transcript commit | `transcript_final - eou_detected` | STT |
| Pre-LLM queue | `llm_request - transcript_final` | orchestration |
| LLM TTFT | `llm_first_token - llm_request` | LLM |
| Text aggregation | `text_committed - llm_first_token` | sentence/chunk policy |
| Pre-TTS queue | `tts_request - text_committed` | orchestration |
| TTS first chunk | `tts_first_chunk - tts_request` | TTS |
| Delivery + playout | `audio_first_audible - tts_first_chunk` | transport/client buffer |

Report `p50`, `p95`, and `p99` with sample count for Turn Gap and every span. Callsmith uses deterministic nearest-rank percentiles: sort ascending and select `ceil(p × n) - 1`. Do not report p99 from fewer than 100 live samples as a stable SLO; label it directional.

### Find the bottleneck

1. If endpointing dominates, tune semantic/VAD endpointing on labeled utterances. Do not shorten silence thresholds until cutoff and false-interruption tests pass.
2. If transcript commit dominates, enable streaming/finalization controls, choose the correct language/model, and keep the STT connection warm.
3. If LLM TTFT dominates, shorten the fixed prefix and tool preamble, cache stable context, stream, or choose a measured faster model.
4. If text aggregation dominates, send a speakable clause instead of waiting for a full sentence; never emit fragments that harm comprehension.
5. If TTS dominates, stream text and audio, keep sessions warm, and use a realtime model. Vendor marketing latency is not a measurement.
6. If delivery dominates, inspect codec transforms, chunk sizing, jitter/playout buffers, websocket queues, and client audio scheduling.
7. If no span dominates, look for serial work that can safely overlap and for tail-only cold starts. Optimize p95 before polishing p50.

## Starting budgets

These are engineering budgets to test, not provider claims or universal promises.

| Path | Endpoint / commit | Generation | Delivery | Turn Gap target |
|---|---:|---:|---:|---:|
| Realtime S2S / WebRTC | 100–220 ms | 120–280 ms | 30–100 ms | p50 ≤ 450 ms; p95 ≤ 700 ms |
| Cascaded / WebRTC | 180–350 ms | LLM + aggregation + TTS 300–650 ms | 40–120 ms | p50 ≤ 800 ms; p95 ≤ 1,200 ms |
| Cascaded / PSTN | 220–450 ms | LLM + aggregation + TTS 350–750 ms | 80–220 ms | p50 ≤ 1,000 ms; p95 ≤ 1,500 ms |

Measure on the deployment path. Network, carrier, language, utterance shape, and codec transforms can invalidate the starting budget.

## Quality constraints

Latency is invalid if it is purchased by speaking over the user or degrading the answer. Every run records:

- `premature_cutoff`: the detector committed before labeled speech end or clipped a meaningful trailing word;
- `false_interruption`: agent output was cancelled without real user speech;
- `response_correct`: scenario-specific semantic/tool outcome passed;
- `audio_underruns`: audible playout starvation count.

Reject an optimization if any controlled turn has a cutoff, false interruption, incorrect response, or underrun. For live runs, require no regression against baseline and publish counts/rates with confidence context. Never hide failed turns from latency percentiles.

### Barge-in and cancellation

Instrument `barge_in_detected_ms`, `cancellation_sent_ms`, and `cancellation_ack_ms` on interruption turns. Detection must cancel model/TTS generation, flush queued outbound audio, and prevent stale audio from playing after the next turn begins. Test real barge-in, background speech, echo, and silence separately. A faster endpoint setting that increases false interruptions fails the quality gate.

## Instrumentation mappings

### LiveKit

Put monotonic marks around the participant speech/turn detector event, final transcript, agent generation request/first text, TTS request/first audio, and room audio publication/playout acknowledgement. Prefer framework metrics where their boundary matches this schema; add application marks where it does not. Preserve participant, room, region, model, and transport tags. Test interruption through the framework's speech handle/cancel path and confirm queued audio is flushed.

### Pipecat

Attach an observer/metrics processor around VAD stop/turn frames, final transcription frames, LLM request/first-token frames, TTS request/first-audio frames, transport output, and client playout. Use the same monotonic time source in processors. Treat `UserStoppedSpeakingFrame` as `eou_detected_ms`, not automatically as labeled `speech_end_ms`. Trace interruption frames through cancellation and transport flush.

### Custom pipelines

Create one turn context at input ingest. Carry its `turn_id` through STT, orchestration, LLM, TTS, transport, and client acknowledgements. Emit an append-only event at each boundary before handing work to the next queue. For PSTN, first server packet is not first audible; measure a carrier/client loopback or mark the production estimate honestly. Never infer missing events from neighboring timestamps.

## Experiment loop

1. Freeze the representative utterance/audio set, semantic oracle, environment, and model versions.
2. Capture at least 100 valid turns per live arm; warm and cold runs are separate cohorts.
3. Validate raw traces, then establish baseline p50/p95/p99 and quality counts.
4. Change one owner or policy.
5. Compare the same samples with the CSB-Turn scorer.
6. Ship only when p95 improves and every quality gate passes; retain raw traces for audit.

Run the deterministic fixtures with `npm run bench:turn`. Use `npm run bench:turn:score -- --baseline <trace> --candidate <trace>` for an explicit pair. Live mode records and validates raw samples, but network-dependent live numbers never become hard CI expectations.
