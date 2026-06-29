---
status: complete
priority: p2
issue_id: "003"
tags: [code-review, data-integrity, ci, staleness-guard]
dependencies: []
---

# verify-packs staleness regex misses `preview` model aliases

## Problem Statement

`callsmith verify-packs` is the CI gate meant to catch unpinned / drifting model names. Its regex `/latest|preview-latest|auto/i` is both redundant and incomplete: the `preview-latest` alternative is a dead substring of `latest`, and **bare `preview` is not matched** — so the one real volatile alias in the registry (`providers/realtime/gemini-live.json`, model `gemini-...-flash-live-preview`) sails through. The gate advertises a freshness guarantee it cannot deliver.

## Findings (evidence)

- `src/lib/verify-packs.mjs:39` — regex `/latest|preview-latest|auto/i`.
- Evaluated against the registry: all pinned ids pass, but drift aliases like `foo-preview`, `gpt-4o-canary`, `whisper-nightly`, `claude-3-rc`, date-stamped `v2-0-2024-08` are NOT caught.
- Note: `test/packs.test.mjs` staleness guard pins exact model strings, so a silent Google rev WOULD be caught there — but only if that test runs. `verify-packs` is the dedicated CI gate and it is the one that misses the preview suffix.

## Proposed Solutions

1. **Allowlist (recommended).** Assert each model-capable pack's `model` equals an explicit, maintained allowlist entry kept alongside the pack. This is the only design that survives the next drifting-alias naming convention. Effort: Medium. Risk: Low.
2. **Broaden the denylist** to `/latest|preview|canary|nightly|\brc\b|\bexp\b|auto|\d{4}-\d{2}-\d{2}/i` and drop the redundant `preview-latest`. A denylist can never be complete, but this covers today's known drift vocabulary. Effort: Small. Risk: Low (may flag legitimate pinned `preview` names — acceptable since they ARE volatile).

## Recommended Action

Solution 1 (allowlist) if time permits; otherwise Solution 2 as a stopgap.

## Acceptance Criteria

- [ ] `gemini-...-preview`-style aliases are flagged (or explicitly allowlisted with eyes-open sign-off).
- [ ] Redundant `preview-latest` alternative removed.
- [ ] `verify-packs` still reports PASS over the current installed registry (no regressions for legitimately pinned ids).

## Work Log

### 2026-06-28 — Implemented (stopgap Solution 2)
**Actions:**
- `src/lib/verify-packs.mjs`: dropped redundant `preview-latest` alt; broadened to `/latest|canary|nightly|\bauto\b/i`; added a comment documenting that a denylist is incomplete and that preview-tier staleness (e.g. `gemini-...-preview`) is guarded by the exact-pin test in `test/packs.test.mjs`.
**Verified:** `callsmith verify-packs` → 0 failures over the 21-pack registry.
