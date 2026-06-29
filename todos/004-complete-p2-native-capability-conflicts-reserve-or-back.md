---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, architecture, yagni, data-integrity]
dependencies: []
---

# native_capability_conflicts: schema/detection untested by real data

## Problem Statement

The diff adds a `native_capability_conflicts` schema field (`providers/_schema.json:23-39`) plus ~25 lines of detection logic in `detectImpossibilities` (`src/lib/resolver.mjs:395-420`). No installed pack declares a conflict — the only exercise is one synthetic test fixture (`sip-only-carrier` in `test/impossibility.test.mjs:117`). The feature ships a safety guarantee the real registry cannot deliver: no production stack can ever trigger it.

## Findings (evidence)

- Grep across `providers/` → zero packs declare `native_capability_conflicts`.
- Consumer `resolver.mjs:404-417` is exercised only by the inline synthetic fixture.
- Self-conflict guard (`if (other.id === pack.id) continue;`) is correct; but symmetric declarations (A↔B both declaring the conflict) would double-count — latent, currently unreachable.

## Proposed Solutions

1. **Back it with a real conflict (recommended if a real one exists).** E.g. a SIP-trunk carrier that genuinely cannot coexist with `audio_normalization`, or model the `emit_mulaw_8000` TTS vs non-mulaw telephony case. Add a regression test against the installed registry. Effort: Medium. Risk: Low.
2. **Mark reserved.** Add a schema note "reserved — no pack currently declares conflicts" and do NOT extend the pattern (no `ingest_conflicts`/`model_conflicts`) until a second real conflict appears. Effort: Small. Risk: Low.

## Recommended Action

Solution 1 if a genuine real-world conflict applies; otherwise Solution 2 (reserve + comment). Do not leave it implying a guarantee the data doesn't deliver.

## Acceptance Criteria

- [ ] EITHER ≥1 installed pack declares a real conflict + registry regression test, OR schema marks the field reserved with a comment.
- [ ] Symmetric double-count case is covered (dedupe by canonical pair) or documented as out-of-scope.

## Work Log

### 2026-06-28 — Implemented (Solution 2: reserve + dedupe)
**Actions:**
- Marked `native_capability_conflicts` as **reserved** in `providers/_schema.json` (no installed pack declares a conflict; shape exercised by the `sip-only-carrier` synthetic test).
- Added symmetric-declaration dedupe in `detectImpossibilities` (`src/lib/resolver.mjs`) via a canonical `[ids+capabilities].sort()` key so A↔B reverse declarations can't double-count.
**Verified:** impossibility tests green.
