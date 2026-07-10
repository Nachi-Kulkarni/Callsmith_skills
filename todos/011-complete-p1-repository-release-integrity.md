---
status: complete
priority: p1
issue_id: "011"
tags: [release, ci, packaging, installer]
dependencies: []
---

# Repository and release integrity

## Problem Statement

The agent-compiler rewrite passes locally but a normal commit/fresh clone would omit ignored golden examples, CI invokes a deleted command, packaging exposes a missing script, manual installation omits playbooks, and executable modes regressed.

## Findings

- `callsmith.recipe.md` and `voice.answers.json` are globally ignored, including golden examples.
- CI still runs deleted scaffold/release-check paths.
- `eval:opencode` is advertised in the package but its files are not shipped.
- Manual fallback installation omits `reference/` and examples.
- Executable bits were removed from the CLI and installer.

## Proposed Solutions

1. Preserve ignores and force-add examples: fragile and contradicts committed contracts.
2. Narrow generated-output ignores, modernize CI/package/installer, and restore modes: recommended.

## Recommended Action

Make committed contracts first-class, remove stale release paths, and add tests that exercise the shipped artifact and manual install layout.

## Acceptance Criteria

- [x] Golden example files are visible to normal Git staging.
- [x] CI only runs existing checks and no deleted scaffold dependencies.
- [x] Every npm script points to shipped or repository-only content intentionally.
- [x] Manual installer includes all skill-referenced files and fails loudly on incomplete copies.
- [x] CLI/installer executable modes are restored.
- [x] `git diff --check`, tests, and package dry-run pass.

## Work Log

### 2026-07-10 - Created

**By:** Codex

**Actions:** Converted repository audit findings into a release-integrity work item.

### 2026-07-10 - Completed

**By:** Codex

**Actions:** Narrowed generated-output ignores, repaired CI and package scripts, restored executable modes, made the manual installer archive-shape independent and transactional, removed stale managed upgrade files, honored custom install paths, and added offline installer plus Git-index package/install journeys. The packed CLI completes doctor, physics check, and semantic contract validation from an index export.
