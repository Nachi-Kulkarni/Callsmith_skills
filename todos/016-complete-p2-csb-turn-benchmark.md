---
status: complete
priority: p2
issue_id: "016"
tags: [evals, latency, voice, csb]
dependencies: ["014", "015"]
---

# Quality-constrained CSB Turn benchmark

## Problem Statement

CSB evaluates design artifacts but does not prove that Callsmith helps an agent instrument and reduce real conversational silence.

## Findings

A latency score needs raw event traces, labeled end-of-speech ground truth, percentile statistics, and quality vetoes.

## Proposed Solutions

1. Add a prose latency gate to core CSB: easy to game.
2. Create a separate CSB-Turn track with deterministic trace fixtures and an optional live-provider protocol: recommended.

## Recommended Action

Ship trace validation/scoring, representative fixtures, a deliberately slow cascaded scenario, and a live-run reporting contract without putting network variance in hard CI.

## Acceptance Criteria

- [x] Trace schema validator and scorer exist.
- [x] Synthetic fixtures cover fast-valid, slow-valid, premature-cutoff, false-interruption, and missing-event cases.
- [x] Score is p95 Turn Gap improvement subject to quality vetoes.
- [x] Controlled track is deterministic; live track records raw samples and never invents CI stability.
- [x] Tests and documentation pass.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Defined the operational latency benchmark track.

### 2026-07-10 - Implemented and verified

**By:** Codex (`turn_latency`)

**Actions:**

- Implemented raw-trace validation, derived component metrics, deterministic nearest-rank percentiles, and the p95 Turn Gap scorer.
- Added hard quality vetoes for cutoff, false interruption, incorrect response, and audio underruns.
- Required identical sample IDs across controlled arms to prevent selective sample dropping; live traces are explicitly report-only for CI and retain raw samples/environment tags.
- Added five adversarial fixture classes, package scripts, benchmark documentation, and ten focused tests.

**Verification:** `node --test test/csb-turn.test.mjs` (10/10 passing); `npm run bench:turn` (pass); syntax checks for validator/scorer (pass).
