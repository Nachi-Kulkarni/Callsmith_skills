---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, ux, simplicity, menu]
dependencies: []
---

# Menu intake bloat: collapse 8 voice-UX knobs into presets

## Problem Statement

The diff adds 8 fine-grained voice-UX intake groups (`endpointing`, `interruption_sensitivity`, `noise_cancellation`, `silence_timeout`, `max_call_duration`, `greeting_mode`, `voice_profile`, `language_fallback`) on top of the existing ~18. The full `callsmith spec` intake is now ~26 sequential MCQs. Most recipe authors lack the telephony-ops expertise to choose endpointing milliseconds or noise-cancellation profiles, so they either accept defaults blindly (the steps add latency without signal) or pick arbitrarily and lock in values they don't understand.

## Findings (evidence)

- `data/menu.json:130-219` — 8 new groups, all `required:false` with defaults.
- Decision-fatigue concern (UX-simplicity, not correctness). Also bloats `menu.json`, answer fixtures, and `templateAnswers`.

## Proposed Solutions

1. **Collapse to 1 group `operational_profile` with 3 presets** that set all 8 flags at once (recommended):
   - `support_default` — balanced 600ms, normal sensitivity, standard noise, 15s silence, 30min cap, immediate greeting, warm 1.0x, auto_then_confirm.
   - `fast_ivr` — aggressive 350ms, high, voice_focus, 8s, 10min, immediate, fast 1.12x, strict.
   - `careful_slow` — conservative 900ms, low, standard, 30s, 60min, wait_for_user, slow 0.9x, ask_caller.
   Keep an `advanced` escape hatch only if a real user asks. Effort: Medium. Risk: Medium — changes answer keys; fixtures + `cli-contract`/`operational-levers` tests need updates.

## Recommended Action

Solution 1, as a separate UX PR from the security/data fixes.

## Acceptance Criteria

- [ ] Default intake returns to a tractable length (~18-19 questions).
- [ ] The 8 flags are still expressible (via preset, or advanced override).
- [ ] Answer fixtures + affected tests updated and green.

## Work Log

### 2026-06-28 — Implemented (Solution 1)
**Actions:**
- `data/menu.json`: replaced the 8 fine-grained UX groups (`endpointing`, `interruption_sensitivity`, `noise_cancellation`, `silence_timeout`, `max_call_duration`, `greeting_mode`, `voice_profile`, `language_fallback`) with one `operational_profile` group offering 3 presets: `support_default` (reproduces prior defaults exactly), `fast_ivr`, `careful_slow`. Each preset's `maps` set all 10 underlying flags, so `voiceUxConfig`/lock/recipe/scaffold output is unchanged for the default.
- `test/operational-levers.test.mjs`: updated the spec-template test to assert the new `operational_profile` key and that forging the default template resolves the expected `voice_ux`/`safety` values.
- Intake reduced from ~26 to ~19 questions; full granular control still available via the generated `voice_ux.py`.
**Verified:** full 167-test suite green.
