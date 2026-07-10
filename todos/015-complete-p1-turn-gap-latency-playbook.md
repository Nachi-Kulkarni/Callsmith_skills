---
status: complete
priority: p1
issue_id: "015"
tags: [voice, latency, ttfa, observability]
dependencies: ["013"]
---

# End-of-turn to first-audible latency playbook

## Problem Statement

The existing TTFT playbook measures only the LLM leg, not the silence users experience from acoustic speech end to audible agent playback.

## Findings

The critical path includes endpointing, transcript commitment, LLM startup, text aggregation, TTS startup, transport, and playout buffering. Optimizing latency without cutoff/interruption guardrails is gameable.

## Proposed Solutions

1. Extend TTFT terminology: remains ambiguous.
2. Add a `/callsmith latency` playbook with a portable turn trace schema and quality-constrained optimization loop: recommended.

## Recommended Action

Define Turn Gap and component spans, ground-truth vs production-observable variants, percentile reporting, and framework mappings for LiveKit/Pipecat/custom pipelines.

## Acceptance Criteria

- [x] Turn Gap and component timestamp semantics are unambiguous.
- [x] Trace schema covers EOU, transcript, LLM, aggregation, TTS, first chunk, and first audible playout.
- [x] p50/p95/p99 and environment tags are required.
- [x] Cutoff, false interruption, correctness, and audio-underrun guardrails are included.
- [x] LiveKit, Pipecat, and custom instrumentation guidance is provided.
- [x] Existing `ttft` route remains compatible or clearly redirects.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Defined the first-audible latency product work.

### 2026-07-10 - Implemented and verified

**By:** Codex (`turn_latency`)

**Actions:**

- Defined `turn_gap_ms` from labeled acoustic speech end to first audible playout and retained LLM TTFT as a component span.
- Added a portable monotonic-clock trace schema, environment cohort tags, attribution spans, nearest-rank p50/p95/p99 reporting rules, starting budgets, guardrails, cancellation semantics, and a quality-constrained experiment loop.
- Added concrete LiveKit, Pipecat, and custom-pipeline instrumentation mappings.
- Routed `/callsmith latency` to the new playbook and made the existing TTFT playbook explicitly redirect to it for end-to-end work.

**Verification:** `node --test test/csb-turn.test.mjs` (10/10 passing); `npm run bench:turn` (controlled fixture passed, 570 ms / 43.85% p95 improvement).
