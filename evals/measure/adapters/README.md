# Measurement adapters

A stack adapter is the live boundary of `evals/measure/run.mjs`. The runner spawns it as:

```
<config.adapter argv...> --config <stack-config.json> --corpus <manifest.json> --trace <out-trace.json>
```

The adapter MUST:

1. Read the config passed by `--config` and play exactly the utterances its schedule declares — no more, no less — at the caller boundary of the stack under test (a WebRTC synthetic participant or a PSTN loopback call), honoring each utterance's playback profile.
2. Record one turn per scheduled utterance in the out trace, on a single monotonic millisecond clock (`track: live`), tagging every turn with its `utterance_id` (the corpus id it measured). The runner proves coverage by matching the observed turn set against the declared schedule exactly — a dropped or extra utterance fails the run closed. Include per-turn quality flags and barge-in/cancellation timestamps when a barge-in profile plays.
3. Write `provenance.json` into the out directory (see below).
4. Optionally write `spend.json` into the out directory.
5. Exit 0. The runner verifies corpus hashes, the declared schedule, profile/metric preflight, coverage, provenance, and quality vetoes; it owns percentiles — adapters never compute statistics.

## Schedule and corpus coverage

The stack config declares the exact measurement schedule:

```json
{
  "schedule": {
    "utterance_ids": ["digit-0-clean", "digit-1-clean"],
    "repeats": 2
  }
}
```

- `utterance_ids` must be a non-empty, duplicate-free list of IDs from the corpus manifest.
- `repeats` is optional and defaults to `1`; when present it must be a positive integer.
- A one-turn Gate 1B probe uses one ID with one repeat. A cohort declares its full ID set and repeat count.
- The adapter emits one trace turn per scheduled occurrence and sets that turn's `utterance_id` to the corresponding manifest ID.
- The runner compares the observed `utterance_id` multiset with the expanded schedule. Missing, duplicate, unknown, or extra occurrences fail closed; turn order is not significant.
- A tracked live-stack template that does not yet declare a schedule is intentionally non-runnable. Gate 1B adds the one-ID probe schedule with its tested adapter; Gate 3 expands that declaration for the measured cohort.

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

Provenance is validated in two stages:

1. **Structural** (before the trace is scored): every scalar field is a non-empty string; `target_commit` is an immutable 40-hex Git SHA; `sdk_versions` and `model_ids` are non-empty maps whose keys and values are non-empty strings. Presence-only is not enough.
2. **Consistency** (after the trace is read): `region` must match the config, and `audio_format` + `network_profile` must match the trace environment — the provenance must describe the same stack that was measured.

## spend.json (optional)

If the provider APIs expose actual usage, write it so the receipt records real spend rather than only the approval ceiling:

```json
{ "provider_usage": { "livekit": { "minutes": 0 }, "google": { "tokens": 1234 } },
  "actual_cost_usd": 0.0, "measured_at": "<iso8601>" }
```

`max_spend_usd` in the config is an **approval ceiling**, not an enforced provider bill cap; `--approve-spend-usd` authorizes spend that covers it, and provider billing remains externally measured.

Adapters are per-stack integration code that run against live provider APIs with real credentials and real spend. They are deliberately **not committed untested**: an adapter lands in the same change as the first retained raw trace it produced, sanitized and reviewed per `reference/latency.md`. Until then, the locked experiment designs live in `evals/measure/stacks/*.json`, and CI replays `evals/measure/fixtures/replay-trace.json` (an honest v2 cascaded trace) through the runner so the whole pipeline minus the provider leg — schedule coverage, provenance stages, profile preflight, percentiles, vetoes — is machine-proven.
