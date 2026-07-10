---
status: complete
priority: p1
issue_id: "014"
tags: [evals, benchmark, csb, reproducibility]
dependencies: ["011", "012"]
---

# CSB benchmark validity and reliability

## Problem Statement

CSB scores failed actors, does not enforce model pinning or clean artifacts, lacks full trace export and repeated trials, and sums correlated gates into a potentially inflated delta.

## Findings

The exploratory core10 result included multiple `exit null` actors; a rerun moved one scenario by three points. Run configs recorded no model.

## Proposed Solutions

1. Patch failures individually: leaves the metric concept weak.
2. Introduce valid-trial criteria, reproducibility manifest, repeated paired attempts, all-gates task success, veto traps, and diagnostic gate lifts: recommended.

## Recommended Action

Make invalid infrastructure runs unscorable; record the actual tested system and budget; use success-rate lift plus `pass^k` as public metrics.

## Acceptance Criteria

- [x] Failed/timed-out actors never produce scored pairs.
- [x] Run directories are clean and artifacts must be fresh.
- [x] Model, agent version, commit, prompt/scenario/pack hashes, budget, and timing are recorded.
- [x] Multiple paired trials and randomized arm order are supported.
- [x] Primary task success requires all critical gates; G_REAL is a veto.
- [x] Gate lift and `pass^k` remain diagnostic/reliability outputs.
- [x] Full actor trace/session export is retained when available.
- [x] Tests reproduce invalid-run, stale-artifact, and variance cases.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Converted benchmark audit into validity requirements.

### 2026-07-10 - Implemented reproducible valid-trial harness

**By:** Codex

**Actions:**
- Made run and arm workspaces append-proof: any existing output path is refused.
- Required a clean Git worktree, explicit actor-model pin, and detectable actor-tool version for live runs.
- Added deterministic repeated schedules with seeded scenario randomization and alternating arm order.
- Added per-arm reproducibility receipts covering commit, model/tool, budget, timing, and prompt/scenario/provider-pack hashes.
- Made failed, timed-out, errored, missing, empty, stale, or untouched actor artifacts invalid and unscorable.
- Retained stdout/stderr and sanitized OpenCode session exports when available.
- Replaced correlated gate-count lift as the headline with all-gates task-success lift, paired uncertainty, `pass^k`, and diagnostic gate lifts.
- Updated CSB README/design documentation and added invalid-run, stale-artifact, scheduling, veto, and variance tests.
- Ran `npm run test:csb`: 25 tests passed.
- Ran scoped `git diff --check`: clean.

**Learnings:**
- A benchmark result is only meaningful when infrastructure failures cannot become low scores.
- Alternating arm order within each scenario gives deterministic counterbalancing without trusting a lucky random draw.
- Gate counts remain useful for diagnosis, but all-gates success better represents whether a production design actually resolves the task.
