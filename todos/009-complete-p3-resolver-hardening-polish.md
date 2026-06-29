---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, architecture, resolver, polish]
dependencies: []
---

# Resolver hardening polish (bundled P3s)

## Problem Statement

A cluster of low-severity maintainability/robustness issues in the resolver and simulator core. None produce incorrect output today (all 161 tests pass), but each is a latent trap.

## Findings (evidence)

- **`isAudioSentinel(undefined)` masks malformed packs** — `resolver.mjs:95-97,102`: a missing `format` is silently treated as a no-op sentinel (zero transforms) instead of flagging a data defect. Push the check into `validate.mjs`/`verify-packs`.
- **Inbound/outbound blocker asymmetry** — `resolver.mjs:174` (inbound marks blockers only if step includes `resample`/`decode`) vs `:190-193` (outbound marks every step). Substring-coupled; a future inbound step name lacking those tokens would silently not be flagged as a blocker. Treat any non-empty `steps` as a blocker.
- **`orchNormalizes` + mulaw-emission gate logic duplicated** between `resolve()` (`:167-169,181,186`) and `detectImpossibilities()` (`:367-369,370`). Currently in sync; extract a shared `audioGate(...)` helper so the blocker and impossibility views cannot diverge.
- **Symmetric `native_capability_conflicts` would double-count** — `resolver.mjs:404-417`: if A declares "X conflicts Y" and B declares "Y conflicts X", the same incompatibility is pushed twice. Dedupe by canonical `[capability, otherCapability]` + pack-id pair.
- **`first_response_ms` magic `160`** — `simulate.mjs:118-136`: cumulative fixed offsets sum to 100ms but the formula subtracts 160, so realtime first-response is `total_ms − 60` (60ms more lenient than the budget). Functionally the pass check is still correct; derive `total_ms − 100` so it equals the budget exactly, or document what the 60ms represents.
- **No fixture×strict regression guard** — every grid fixture survives strict mode only because the 11 new groups are `required:false`. Add a CI test that runs `expandAnswers(fixture, menu, {strict:true})` over every fixture and asserts none throw, so a future required-group addition surfaces with a clear failure instead of 40 cascading grid failures.

## Proposed Solutions

Address as a bundle during a hardening pass; each item is Small effort / Low risk. The shared `audioGate` helper (item 3) is the highest-value because it prevents future divergence between the blocker and impossibility code paths.

## Recommended Action

Bundle into one hardening PR; prioritize the shared audio-gate extraction and the fixture×strict CI guard.

## Acceptance Criteria

- [ ] Malformed `format` caught by validator (not silently sentinel-ed).
- [ ] Non-empty inbound steps always become blockers.
- [ ] `audioGate(...)` shared by resolve() and detectImpossibilities().
- [ ] Symmetric conflicts deduped.
- [ ] `first_response_ms` derived or documented.
- [ ] fixture×strict CI guard added and green.

## Work Log

### 2026-06-28 — Implemented (all items)
**Actions:**
- Extracted `audioPathGate({telephony, orch, sink, source})` as the single source of truth consumed by both `resolve()` and `detectImpossibilities()` — the inbound/outbound gate logic can no longer drift. Removed the now-dead `audioDiff()` wrapper.
- Fixed inbound/outbound blocker asymmetry: inbound now marks every step as a blocker (dropped the `s.includes('resample') || s.includes('decode')` substring coupling), closing the latent gap where a `normalize pcm -> linear16` step wouldn't be flagged.
- `validate.mjs`: added an empty-format check so a malformed `format: ""` is rejected rather than silently treated as a no-op sentinel.
- `simulate.mjs`: derived the realtime turn-complete advance as `total_ms - 100` (was magic `160`) so `first_response_ms` lands exactly on the latency budget; documented the fixed-offset math.
- Added fixture×strict CI guard in `test/packs.test.mjs`: every fixture is run through `expandAnswers(..., {strict:true})` so a future required-group addition surfaces with a clear failure instead of cascading grid failures.
- (Symmetric conflict dedupe already landed with 004.)
**Verified:** 168/168 tests pass.
