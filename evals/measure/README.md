# Callsmith measurement

`run.mjs` is the provider-neutral measurement boundary. A stack adapter must play the frozen corpus at the caller boundary and write a raw `turn-trace.schema.json` trace; the runner verifies corpus hashes, environment preflight, region/cohort pins, trace semantics, nearest-rank percentiles, and quality vetoes before emitting `callsmith_measurement` pack evidence.

```bash
node evals/measure/run.mjs --config stack.json --out evals/measure/runs/run-id --live
```

Locked pilot designs live in `stacks/` (S2S WebRTC, S2S PSTN, cascaded WebRTC — budget-lean cohorts; the cascaded pilot keeps transport identical to the S2S pilot so the architecture delta is attributable); the adapter contract lives in `adapters/README.md`. The runner is machine-proven with zero spend by replaying a recorded trace:

```bash
node evals/measure/run.mjs --config evals/measure/fixtures/replay-stack.json --out <fresh-dir> --trace evals/measure/fixtures/replay-trace.json
```

Keep warm and cold cohorts separate. Fewer than 100 valid turns makes p99 directional. Never turn the emitted values into hard CI timing thresholds; retain raw traces, sanitize publication artifacts separately, and update packs only after the exact region, model versions, machine, corpus hash, config hash, and sample size are reviewed.

The frozen v1 corpus is 20 pinned 8 kHz FSDD clips under CC-BY-SA-4.0. Its manifest fixes clean, long, seeded-noise, barge-in, and silence playback profiles; adapters must implement those profiles exactly and record the manifest hash.
