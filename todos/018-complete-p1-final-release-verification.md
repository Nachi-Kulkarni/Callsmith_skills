---
status: complete
priority: p1
issue_id: "018"
tags: [release, verification, quality]
dependencies: ["011", "012", "013", "014", "015", "016", "017"]
---

# Final release verification

## Problem Statement

The rewrite is complete only when it succeeds from tracked files and shipped artifacts, not merely inside the current dirty workspace.

## Findings

Ignored local files and stale scripts previously allowed local green tests to hide fresh-clone failures.

## Proposed Solutions

Use a tracked-files export or temporary clean worktree equivalent to validate tests, package, installer layout, CLI contracts, examples, and documentation.

## Recommended Action

Run every quality gate, audit the final diff and package manifest, and close all todos only after clean-environment proof.

## Acceptance Criteria

- [x] Full tests and focused CSB/latency tests pass.
- [x] `git diff --check` passes.
- [x] Pack validation/freshness and CLI doctor pass.
- [x] npm package dry-run contains exactly required product files.
- [x] Tracked-file/fresh-clone-equivalent test passes.
- [x] No ready/pending completion todos remain.
- [x] Final worktree changes are summarized without committing or pushing automatically.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Defined the terminal release gate.

### 2026-07-10 - Completed

**By:** Codex

**Actions:** Staged the intended agent-compiler rewrite without committing, exported the Git index into a clean tree, packed and installed that artifact into a disposable consumer, and ran its doctor/check/contract journey. Full repository tests, CSB controlled fixtures, pack evidence verification, cached diff hygiene, executable modes, documentation links, and npm manifest were verified.
