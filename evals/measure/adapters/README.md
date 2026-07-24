# Measurement adapters

A stack adapter is the live boundary of `evals/measure/run.mjs`. The runner spawns it as:

```
<config.adapter argv...> --corpus <manifest.json> --trace <out-trace.json>
```

The adapter must:

1. Play every utterance in the corpus manifest at the caller boundary of the stack under test — a WebRTC synthetic participant or a PSTN loopback call — honoring each utterance's `playback_profiles` entry exactly (`clean`, `long`, `noise`, `barge_in`, `silence`).
2. Record one `reference/turn-trace.schema.json` turn per utterance on a single monotonic millisecond clock (`track: live`), including per-turn quality flags and barge-in/cancellation timestamps when a barge-in profile plays.
3. Exit 0. The runner verifies corpus hashes, scores the trace, and owns percentiles — adapters never compute statistics.

Adapters are per-stack integration code that run against live provider APIs with real credentials and real spend. They are deliberately **not committed untested**: an adapter lands in the same change as the first retained raw trace it produced, sanitized and reviewed per `reference/latency.md`. Until then, the locked experiment designs live in `evals/measure/stacks/*.json`, and CI replays `evals/measure/fixtures/replay-trace.json` through the runner so the whole pipeline minus the provider leg is machine-proven.
