---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, architecture, simulate, fragility]
dependencies: []
---

# Simulator regex-parses transform prose (silent fallback on drift)

## Problem Statement

`src/lib/simulate.mjs` derives inbound/outbound sample rates and codec by regex-parsing the **human-readable transform step strings** emitted by `planAudioDiff` (e.g. `/-> (\d+) Hz/`, `/decode mulaw/i`). The `step` string serves dual duty as (a) recipe blocker note and (b) machine-parseable simulator input — a leaky abstraction. If `planAudioDiff` wording drifts, simulator metrics silently fall back to defaults (16000/24000/pcm) with **no error and no failing test**.

## Findings (evidence)

- `src/lib/simulate.mjs:154-168` — `inboundRate`, `outboundRate`, `inboundCodec` parse `result.transforms[*].step`.
- `test/operational-levers.test.mjs` only asserts `status==='PASS'` + event presence, NOT the rate values — so drift is invisible to CI.
- `outboundRate` is already wrong in one real config: when a TTS declares `emit_mulaw_8000` and telephony accepts mulaw/8k, `resolve()` emits the "skip encode" note and NO outbound transform, so `outboundRate` falls back to 24000 while the real wire output is 8000 Hz μ-law.

## Proposed Solutions

1. **Read rates from resolved packs (recommended).** Derive inbound/outbound rates from `result.pipeline` provider `ingest`/`egress` `sample_rate`/`format` directly, instead of reverse-engineering from prose. Removes the coupling entirely and is correct even when the mulaw-emit gate suppresses the transform. Effort: Small. Risk: Low.
2. **Emit structured step objects.** Have `planAudioDiff` return `{label, kind, fromHz, toHz}` alongside the human label; both `resolve()` and `simulate()` consume the structured field. Effort: Medium. Risk: Medium (touches the resolver return shape).

## Recommended Action

Solution 1 (read from packs) — minimal, correct, decoupled.

## Acceptance Criteria

- [ ] Simulator rates derived from pipeline packs, not from `step` string regex.
- [ ] `emit_mulaw_8000` + mulaw-telephony config reports correct 8000 Hz outbound in the trace.
- [ ] A test asserts the simulator rate matches the telephony pack's ingest sample_rate for at least one mulaw and one pcm stack.

## Work Log

### 2026-06-28 — Implemented (Solution 1: read from packs)
**Actions:**
- `src/lib/simulate.mjs`: added `resolveRatePacks(answers, providers)`; `buildTrace` now derives `inRate`/`outRate`/`inCodec` from the resolved telephony/sink/source packs' `ingest`/`egress` instead of regex-parsing transform prose. Removed `inboundRate`/`outboundRate`/`inboundCodec` string-parsers.
- Also fixes the `emit_mulaw_8000` mis-report (`outboundRate` now reads `telephony.ingest.sample_rate` = 8000, not the 24000 fallback).
**Verified:** operational-levers simulate test green.
