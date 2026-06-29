---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, simplicity, simulate, duplication]
dependencies: ["005"]
---

# Fake-call spec duplicated across JS + Python; mock-precision metrics

## Problem Statement

The deterministic fake call is implemented TWICE in two languages with nothing guaranteeing they agree: `buildTrace` (`src/lib/simulate.mjs:108-148`, JS) and `FakeCallSimulator.run()` (generated `simulate_call.py`, `src/lib/scaffold.mjs:1477-1499`). Adding one lifecycle event means editing both, plus `requiredEvents`, plus `REQUIRED_OPERATIONAL_FILES` — four coupled spots. Separately, `computeMetrics` reports fields that look like measurements but are constants/copies.

## Findings (evidence)

- Duplicate lifecycle: both encode identical literals in the same order — `bytes=320`, transcript `"I need help"` / `"I need help with my order"`, `tool_finished ... latency_ms=120`, `bytes=960`, barge-in `reason="caller_speech_during_playback"`, `reconnect_started retry=1`.
- `buildTrace` also emits `transcript_persisted` and `agent_audio_cleared` that neither `requiredEvents` nor `computeMetrics` reads — trace noise.
- Mock-precision metrics (`simulate.mjs:170-185`): `dropped_frames` is **always 0** (no event ever pushed); `reconnect_count` is **always 1**; `estimated_cost_per_minute_usd` and `target_ms` are re-echoed from `result.cost`/`result.latency`; `agent_audio_out` duplicates `cost_per_minute_usd` onto every audio event for no reader.

## Proposed Solutions

1. **One canonical lifecycle list.** Define a single `LIFECYCLE_STEPS` array (event name + detail template + advance-ms) in `simulate.mjs`; drive both `buildTrace` and the generated `simulate_call.py` body from it (export a JSON blob the scaffold embeds). Effort: Medium. Risk: Medium — guard with existing `operational-levers.test.mjs` + generated `test_fake_call_simulator_runs`.
2. **Drop mock-precision fields.** Remove `dropped_frames`/`reconnect_count` (or make `buildTrace` actually exercise a dropped frame / multi-reconnect); remove `estimated_cost_per_minute_usd`/`target_ms` from metrics (already on `report` via `result`); remove per-event `cost_per_minute_usd`. Effort: Small. Risk: Low.

## Recommended Action

Solution 2 first (quick, safe), then Solution 1 behind existing tests.

## Acceptance Criteria

- [ ] No metric field reports a constant disguised as a measurement.
- [ ] One source of truth for the fake-call event sequence.
- [ ] `operational-levers.test.mjs` and generated simulator test stay green.

## Work Log

### 2026-06-28 — Implemented (Solution 2: drop mock-precision metrics)
**Actions:**
- `src/lib/simulate.mjs` `computeMetrics`: dropped `dropped_frames` (always 0), `reconnect_count` (always 1), and re-echoed `target_ms` / `estimated_cost_per_minute_usd` (already on the report via `result`). Removed per-event `cost_per_minute_usd` echo from `agent_audio_out`.
- Kept genuinely-computed metrics: `first_response_ms`, `tool_count`, `tool_latency_ms`.
- Note: the generated Python `CallTrace` runtime class (scaffold.mjs) legitimately retains `dropped_frames` as a real incrementing counter — left intact.
- Solution 1 (single canonical LIFECYCLE_STEPS driving both JS `buildTrace` and generated `simulate_call.py`) deferred as a separate Medium-risk refactor; the two are now cross-referenced via the resolved-pack rate source (005).
**Verified:** operational-levers tests green.
