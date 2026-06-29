---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, simplicity, single-source-of-truth]
dependencies: []
---

# Voice-UX / safety defaults defined three times (SSOT violation)

## Problem Statement

The same operational defaults (`endpointing_ms ?? 600`, `silence_timeout_ms ?? 15000`, `max_call_duration_sec ?? 1800`, `greeting_mode || 'immediate'`, `voice_profile || 'warm'`, `speaking_speed ?? 1.0`, `language_fallback || 'auto_then_confirm'`, plus `recording_consent || 'announce'`, `transcript_retention_days ?? 30`) are hard-coded in THREE places across TWO languages (JS + generated Python). Changing one default means editing 3 sites; they will drift.

## Findings (evidence)

- `src/lib/compile.mjs:84-95` — `voiceUxConfig(flags)` (JS source of truth).
- `src/lib/compile.mjs:98-104` — `safetyConfig(flags)`.
- `src/lib/scaffold.mjs:1213-1225` — `ux` literal re-derived in `renderVoiceUxPy` (generated `voice_ux.py`).
- `src/lib/scaffold.mjs:1272-1274` — re-derived in `renderSafetyPy` (generated `safety.py`).
- `src/lib/compile.mjs:135-142` — re-derived inline in `renderRecipe`.

## Proposed Solutions

1. **Export `voiceUxConfig`/`safetyConfig` from compile.mjs and import in scaffold.mjs**; `JSON.stringify` the same object into the generated `voice_ux.py` / `safety.py`. The recipe renderer already calls `voiceUxConfig`. Effort: Small. Risk: Low.

## Recommended Action

Solution 1.

## Acceptance Criteria

- [ ] Defaults live in exactly one function per concern (`voiceUxConfig`, `safetyConfig`).
- [ ] Generated `voice_ux.py` / `safety.py` consume the same values via import + JSON serialization.
- [ ] Existing tests (operational-levers, scaffold) stay green.

## Work Log

### 2026-06-28 — Implemented (Solution 1)
**Actions:**
- `src/lib/compile.mjs`: exported `voiceUxConfig` and `safetyConfig`; coerced `audit_tool_actions` to a real boolean (was `undefined`-prone).
- `src/lib/scaffold.mjs`: imports both; `renderVoiceUxPy` and `renderSafetyPy` now consume the single source of truth (no re-derived defaults). Python booleans emitted as `True`/`False`.
**Verified:** scaffold + operational-levers tests green; generated `voice_ux.py`/`safety.py` carry identical values to the lock.
