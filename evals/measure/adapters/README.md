# Measurement adapters

A stack adapter is the live boundary of `evals/measure/run.mjs`. The runner spawns it as:

```
<config.adapter argv...> --corpus <manifest.json> --trace <out-trace.json>
```

The adapter MUST:

1. Play every utterance in the corpus manifest at the caller boundary of the stack under test — a WebRTC synthetic participant or a PSTN loopback call — honoring each utterance's `playback_profiles` entry exactly (`clean`, `long`, `noise`, `barge_in`, `silence`).
2. Record one turn per utterance in the out trace, on a single monotonic millisecond clock (`track: live`), with per-turn quality flags and barge-in/cancellation timestamps when a barge-in profile plays.
3. Write `provenance.json` into the out directory (see below).
4. Optionally write `spend.json` into the out directory.
5. Exit 0. The runner verifies corpus hashes, scores the trace, and owns percentiles — adapters never compute statistics.

## Trace schema: v1 or v2

Write the trace the stack can honestly observe. Do not synthesize boundaries the provider does not emit.

- **v1** ([`turn-trace.schema.json`](../../../reference/turn-trace.schema.json)): all ten cascaded legs required on every turn. Use only when the stack is a fully instrumented cascaded pipeline.
- **v2** ([`turn-trace.v2.schema.json`](../../../reference/turn-trace.v2.schema.json)): declare `environment.instrumentation_profile` and record only the boundaries the profile exposes:
  - `cascaded_full` — the ten cascaded legs (same as v1).
  - `s2s_transport` — `speech_end_ms`, `provider_first_output_ms`, `audio_first_audible_ms` plus `audio_first_playout_ms` (response submitted to the playout path). A realtime speech-to-speech provider (e.g. Gemini Live) is an opaque stream: it exposes first output (first `modelTurn`), interruption, and turn-complete, but **no** LLM-request/first-token, text-commit, or separate TTS-request/first-chunk event. Those must be omitted, never fabricated.
  - `end_to_end` — only `speech_end_ms` and `audio_first_audible_ms` (fallback).

`provider_first_output_ms` (first provider response) is distinct from `audio_first_playout_ms` (submitted to playout) and `audio_first_audible_ms` (heard at the boundary); equal values are valid only when one real callback represents both. For PSTN, Twilio Media Streams `mark` is playback-**completed**, not onset — record it as `playback_completed_ms`, never infer playout onset by subtracting chunk duration.

The trace's `instrumentation_profile` MUST equal the config's `instrumentation_profile`; the runner rejects a mismatch.

## provenance.json (required for `--live`)

Write provenance at run time into the out directory — never type it into the tracked config template. Every field is required:

```json
{
  "target_commit": "<git commit of the reference target deployment>",
  "runtime_version": "<Node / runtime version>",
  "sdk_versions": { "livekit": "...", "google-genai": "..." },
  "model_ids": { "realtime": "gemini-2.x-live-..." },
  "machine_class": "<e.g. m5.large>",
  "region": "us",
  "audio_format": "<e.g. pcm16-16000-mono>",
  "network_profile": "<e.g. datacenter-lan>"
}
```

The runner itself computes `adapter_sha256` from the adapter source path — do not supply it. A missing or incomplete provenance file fails the run closed.

## spend.json (optional)

If the provider APIs expose actual usage, write it so the receipt records real spend rather than only the approval ceiling:

```json
{ "provider_usage": { "livekit": { "minutes": 0 }, "google": { "tokens": 1234 } },
  "actual_cost_usd": 0.0, "measured_at": "<iso8601>" }
```

`max_spend_usd` in the config is an **approval ceiling**, not an enforced provider bill cap; `--approve-spend-usd` authorizes spend that covers it, and provider billing remains externally measured.

Adapters are per-stack integration code that run against live provider APIs with real credentials and real spend. They are deliberately **not committed untested**: an adapter lands in the same change as the first retained raw trace it produced, sanitized and reviewed per `reference/latency.md`. Until then, the locked experiment designs live in `evals/measure/stacks/*.json`, and CI replays `evals/measure/fixtures/replay-trace.json` through the runner so the whole pipeline minus the provider leg is machine-proven.
