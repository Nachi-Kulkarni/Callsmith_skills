---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security, injection, scaffold, agent-safety]
dependencies: []
---

# Provider-id injection into generated Python and agent markdown

## Problem Statement

callsmith's `expandAnswers` kindHolder branch (`src/lib/resolver.mjs:56-60`) accepts **any non-empty string** as a custom provider id (telephony/orchestration/realtime/stt/tts/llm/vad). That raw string then flows UNSANITIZED into:
- generated **Python** source (scaffold docstrings/comments) — enabling code injection, and
- agent-facing **markdown** (recipe banner, context files, README) — enabling prompt injection.

callsmith's whole purpose is to emit artifacts that coding agents execute and read first. A malicious `answers.json` (e.g. shared/committed as a "recipe handoff") therefore becomes an RCE + agent-prompt-injection vector. This is the highest-severity class of issue for an agent-native codegen tool.

## Findings (evidence)

- **P1 — Python injection.** `src/lib/scaffold.mjs:765, 800` (`renderCustomServer`) and `:525` (`renderPipecatServer`) interpolate `${telephonyId || 'telephony'}` into Python module docstrings and `# TODO` comments. `telephonyId = sel.telephony?.id` (`scaffold.mjs:49`) is the raw answers value. A `telephony` value containing `"""` terminates the docstring and injects executable code that runs when the agent executes `python server.py` / `pytest` (which the generated README instructs). Confirmed by POC.
- **P1 — Markdown prompt injection.** `src/lib/compile.mjs:118-123` (UNVERIFIED PROVIDERS banner), `:153` (Selected stack), `:160` (audio-contract transform rows via `t.from`/`t.to`), `:302` (architecture.md), `src/lib/scaffold.mjs:2125` (README) interpolate the raw id/label unescaped. A multi-line payload renders as fabricated system/bash instructions inside the very files the agent is told to read first.
- **P2 — Path traversal.** `src/lib/docs.mjs:42,49` write `${id}.md` and `${id}.fetched.md` via `fs.mkdirSync(..., {recursive:true})`. A `telephony: "../../.git/hooks/pre-commit"` writes outside `docsDir`.
- **P3 — Log/output spoofing.** `resolver.mjs:62,78,81` strict-mode `Error` messages and `bin/callsmith.mjs:43,145,152,173,194,224` CLI output echo the raw value, enabling ANSI-clear / newline log spoofing.
- **Why strict mode doesn't help:** the kindHolder branch is intentionally permissive (legitimate custom-provider flow), and `scaffold` does not run `detectImpossibilities`, so synthesized-malicious ids sail through.

## Proposed Solutions

1. **Validate at the boundary (recommended — fixes all four findings at once).** Add `validateProviderId(id)` in `expandAnswers` kindHolder branch enforcing `/^[a-z0-9][a-z0-9-]{0,63}$/i`. Legitimate custom ids (`acme-telephony`, `globex-voice`) still pass; breakout characters (`"`, `/`, `\n`, ANSI) are rejected with a clear error. Effort: Small. Risk: Low.
2. **Defense-in-depth in scaffold.mjs.** Never interpolate raw ids/labels into Python — use `JSON.stringify` for any string literal, or fixed placeholders for docstrings/comments. Protects callers that bypass the resolver.
3. **Defense-in-depth in compile.mjs / docs.mjs.** Escape `${id}`/`${label}` for markdown (strip newlines/backticks, wrap in backticks) and reject `/` in filenames.
4. **Sanitize echoed values.** Add `safe(s) = String(s).replace(/[\x00-\x1f\x7f]/g,'?').slice(0,80)` for all `Error(...)` and `console.log/error` paths.

## Recommended Action

Implement Solution 1 (validateProviderId) as the primary fix, plus Solution 2/3 as defense-in-depth. Add `test/security.test.mjs` feeding a malicious answers.json through `forge`/`scaffold`/`docs`/`simulate` asserting: no file written outside outDir; no generated `.py` contains `os.system`/`__import__`/`subprocess` from input; no generated `.md` contains the multi-line payload.

## Acceptance Criteria

- [ ] `validateProviderId` rejects ids outside `/^[a-z0-9][a-z0-9-]{0,63}$/i` at expand time.
- [ ] Existing custom-id fixtures (`acme-telephony`-style) still pass.
- [ ] POC malicious answers.json: generated `server.py` passes `python3 -c "import ast; ast.parse(open(...).read())"` with no injected statements.
- [ ] POC malicious answers.json: no file written outside `--out` dir.
- [ ] `test/security.test.mjs` added and green.
- [ ] All 161 existing tests still pass.

## Work Log

### 2026-06-28 — Implemented
**By:** review pass
**Actions:**
- Added `validateProviderId` (`/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`) at the `expandAnswers` kindHolder boundary in `src/lib/resolver.mjs` — closes Python-injection, markdown prompt-injection, path-traversal, and log-spoof findings at the source.
- Added `safeEcho()` control-char stripper for untrusted values echoed into `Error` messages.
- Added `test/security.test.mjs` (6 tests): unit validation of safe/dangerous ids + E2E forge refusal of docstring-breakout and path-traversal ids + no-injected-python walk of the forged outDir.
**Verified:** 167/167 tests pass; legitimate custom ids (`acme-telephony`, `acme_nonexistent`) still forge.
