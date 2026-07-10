---
status: complete
priority: p1
issue_id: "013"
tags: [providers, provenance, freshness, latency]
dependencies: ["011"]
---

# Provider provenance and freshness

## Problem Statement

Provider validation proves shape but is described as freshness verification. Facts, prices, models, and single-value latency estimates lack source grade, verification date, expiry, region, and measurement method.

## Findings

The ElevenLabs pack currently recommends a non-conversational model and a deprecated latency parameter. Existing verification only parses documentation URLs and blocks floating aliases.

## Proposed Solutions

1. Keep informal notes: insufficient for the product's trust claim.
2. Add required provenance metadata and separate vendor claims, measured distributions, and planning estimates: recommended.

## Recommended Action

Version the pack evidence model, correct verified facts in the highest-risk packs, and make stale/unproven claims visible and testable.

## Acceptance Criteria

- [x] Schema requires verification grade/date/source for factual packs.
- [x] Latency supports source, region, sample size, and percentiles instead of pretending one integer is universal.
- [x] `verify-packs` detects expired evidence and reports actionable warnings/failures.
- [x] ElevenLabs real-time guidance is current and deprecated advice removed.
- [x] Pack tests cover evidence and staleness behavior.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Captured pack epistemic integrity work.

### 2026-07-10 - Completed

**By:** Codex

**Actions:**

- Added mandatory dated provenance with evidence grades, primary sources, and expiry to every provider pack.
- Separated architecture-planning latency inputs from observed distributions; planning values now state zero samples and null percentiles, while measured/vendor evidence supports region, sample size, and p50/p95/p99.
- Added deterministic-clock freshness checks with actionable aging warnings and hard expiry failures.
- Changed ElevenLabs realtime TTS from `eleven_v3` to `eleven_flash_v2_5`, replaced legacy tuning guidance with current WebSocket/Flash/region guidance, and documented Flash text-normalization risk.
- Added schema, provenance, expiry, latency-evidence, measured-distribution, and ElevenLabs regression tests.

**Verification:**

- `node --test test/packs.test.mjs test/cli-verify.test.mjs` — 14 passed, 0 failed.
- `git diff --check -- providers src/lib/verify-packs.mjs test/packs.test.mjs todos/013-ready-p1-provider-provenance-freshness.md` — clean.
- `rg -n "eleven_v3|optimize_streaming_latency" providers` — no matches.
