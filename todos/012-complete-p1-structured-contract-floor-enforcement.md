---
status: complete
priority: p1
issue_id: "012"
tags: [contract, floors, safety, validation]
dependencies: ["011"]
---

# Structured contract and floor enforcement

## Problem Statement

`contract validate` currently passes keyword-complete contracts that explicitly retain unsafe values such as consent `none` and ticket-only urgent handoff.

## Findings

Regex presence checks cannot prove policy state, jurisdiction, basis, or consistency. CSB adds a separate answers cross-check, but the public P0 CLI does not.

## Proposed Solutions

1. Add more prose regexes: easy to game.
2. Require versioned YAML/JSON-like structured contract frontmatter and validate it semantically: recommended.

## Recommended Action

Define contract schema v1, distinguish Callsmith defaults from legal requirements, validate canonical policy/provider values, and preserve agent-written prose below the receipt.

## Acceptance Criteria

- [x] Contract schema v1 is documented and parsed without external dependencies.
- [x] Unsafe medical/banking/collections fixtures fail standalone CLI validation.
- [x] Jurisdiction and retention basis are explicit for regulated domains.
- [x] Numeric latency/cost target is enforced, not warned.
- [x] Golden contract and CSB oracles use the same validator.
- [x] Negative and compatibility tests pass.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Captured the floor-receipt validation gap and structured remedy.

### 2026-07-10 - Completed

**By:** Codex

**Actions:** Added the dependency-free `json callsmith-contract` v1 receipt, semantic provider/policy/domain/latency validation, regulated-domain defaults with explicit-risk overrides, contract↔answers CSB cross-checks, documentation, golden receipts, and negative CLI/unit coverage. Focused contract and oracle suites pass (21 tests).
