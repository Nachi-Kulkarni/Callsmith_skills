# Callsmith measurement

> **Status: experimental.** The runner, corpus integrity, provenance pins, and publication
> path are machine-proven against the replay fixture — but **no live adapter is implemented
> yet** (`adapters/` contains only the contract) and the frozen corpus is 20 FSDD digit
> clips from 2 speakers at 8 kHz: adequate for transport-timing mechanics, not for
> representative ASR/EOU load. Numbers from this track must not be quoted as provider
> measurements until a live adapter exists and its raw traces clear review.

`run.mjs` is the provider-neutral measurement boundary. A stack adapter must play the frozen corpus at the caller boundary and write a raw `turn-trace.schema.json` trace; the runner verifies corpus hashes, environment preflight, region/cohort pins, trace semantics, nearest-rank percentiles, and quality vetoes before emitting `callsmith_measurement` pack evidence.

```bash
node evals/measure/run.mjs --config stack.json --out evals/measure/runs/run-id --live
```

Locked pilot designs live in `stacks/` (S2S WebRTC, S2S PSTN, cascaded WebRTC — budget-lean cohorts; the cascaded pilot keeps transport identical to the S2S pilot so the architecture delta is attributable); the adapter contract lives in `adapters/README.md`. The runner is machine-proven with zero spend by replaying a recorded trace:

```bash
node evals/measure/run.mjs --config evals/measure/fixtures/replay-stack.json --out <fresh-dir> --trace evals/measure/fixtures/replay-trace.json
```

Keep warm and cold cohorts separate. Fewer than 100 valid turns makes p99 directional. Never turn the emitted values into hard CI timing thresholds; retain raw traces, sanitize publication artifacts separately, and update packs only after the exact region, model versions, machine, corpus hash, config hash, and sample size are reviewed.

## Publish a reviewed timing bundle

Raw live runs stay under ignored `evals/measure/runs/`. They are private operational inputs, not
public evidence. After reviewing a run, create a fresh sanitized bundle with the same runner:

```bash
npm run bench:measure:publish -- \
  --source evals/measure/runs/<run-id> \
  --config evals/measure/stacks/<stack>.json \
  --out evidence/measurements/<run-id>
```

Publication fails if the output already exists; the source contains an unknown file or field; a
config, corpus, adapter, target, provenance, or source hash does not match; recomputed metrics differ
from the retained receipt; a quality veto is present; or secret scanning fails. The bundle contains
only frozen config, sanitized timing events, the measurement receipt, methodology, a redaction
receipt, and a checksum manifest. It never copies audio, transcripts, credentials, session IDs, raw
host paths, or the unsanitized trace.

A replay fixture can exercise this path deterministically, but its public receipt is marked
`evidence_scope: replay_fixture`, `publishable: false`, with provider and stack evidence suppressed.
Only a provenance-checked live source can produce a `provider_operational` bundle.

Only the maintainer running an approved live measurement should access the raw directory. Delete raw
runs after the reviewed public bundle and release are immutable, unless a documented diagnostic or
dispute requires a limited retention period. Collect timing events by default; audio or transcripts
require separate approval and must never pass through this publisher.

The frozen v1 corpus is 20 pinned 8 kHz FSDD clips under CC-BY-SA-4.0. Its manifest fixes clean, long, seeded-noise, barge-in, and silence playback profiles; adapters must implement those profiles exactly and record the manifest hash.
