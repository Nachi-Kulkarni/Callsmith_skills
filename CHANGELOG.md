# Changelog

All notable changes to callsmith are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [1.6.0-agent-compiler] — Regime change: agent compiler + verification

### Removed (deterministic generation)
- `scaffold`, `forge`, `init`, `simulate`, `docs`, `intake`, `spec`, `explain`, `context`, `release-check` as product commands (CLI exits 2 with guidance)
- `src/lib/scaffold.mjs`, `compile.mjs`, `simulate.mjs`, `docs.mjs`, `registry.mjs` (synthesis), `release-check.mjs`, `safe-write.mjs`
- `data/presets.json`, `bench/`, fixture grid, generation-era tests, `todos/`, generator scripts
- Dynamic unknown-provider synthesis path
- `product_decisions.engine-archive.md` (historical CLI product — deleted so it cannot resurrect)

### Kept (deterministic verification)
- Provider packs + schema validation
- `callsmith packs | pack show | pack validate | verify-packs | check | doctor`
- Resolver physics for `check` (no generation)
- Skill + playbooks + CallsmithBench source; the superseded judge-based eval harness was removed

### Product
- **Sole forward canon:** [`product_decisions.md`](./product_decisions.md) (kept with [`subtraction.md`](./subtraction.md) cut receipt)
- P0 wedge: pack physics inspect + floor receipts + contract validate + eval gate
- **`contract validate --file [--domain]`** — versioned receipt validates provider IDs, policy basis, regulated defaults, jurisdiction, and percentile turn-gap SLOs (`src/lib/contract.mjs`)
- Example: `examples/clinic-triage/` (recipe + answers)
- **CallsmithBench Phase 1–2:** schema v1, machine oracles, fixture scorer, BASE/WITH arm runner (`npm run bench:csb`), package ships `evals/csb/**`. CSB-Δ not published until reviewed paired agent run
- **Prompt improvements from core10 live failures:** SKILL canonical vocabulary (no free-form enums / `"none"` providers / empty recipes); WITH-arm CSB prompts + OUTPUT_SCHEMA; BASE stays free of sealed enum dump
- Eval rubric retargeted off intake/forge to packs/floors/contract
- Structure tests: skill floors, no-synthesis, physics check smoke
- Playbooks, README, CONTRIBUTING, SECURITY aligned to constitution

## [1.5.0] — Decision-graph benchmark + decision-quality

### Added
- **`callsmith bench`** (`npm run bench`) — a rigorous, scenario-based benchmark for the agent's dig-deeper intake loop. It pins a **golden decision tree** per scenario, replays the real `analyzeIntake` engine to capture the actual path, and **judges** the decision graph with binary checkpoints (Y/N) that accumulate points. Covers 12 scenarios: 4 surface×architecture combos, the outbound direction flag, the maximal hybrid tree, 3 impossibility branches (unknown provider, no audio path, direction mismatch — each with a resolution), and 3 semantic/edge cases (hinglish support, half-duplex IVR, WhatsApp voice). Deterministic grade targets 100%; the semantic Q8/Q10 checkpoints are scored via `bench/judge-payload.md` against `bench/judge-prompt.md`.
- **`bench/`** harness: `scenarios.mjs` (the corpus), `golden.mjs` (an independent golden-tree builder that cross-checks the engine — does not call `analyzeIntake`), `simulate.mjs` (real-engine transcript), `grade.mjs` (binary auto-grader), `run.mjs` (orchestrator → `bench/report.md` + `bench/judge-payload.md`), and `packs.mjs` (synthetic provider packs: `opus-phone` → `no_audio_path`, `inbound-only-carrier` → `direction_mismatch`, `acme-telephony` → `unknown_provider`).
- `test/bench-gate.test.mjs` — CI regression gate asserting the benchmark's deterministic grade is 100%, so `npm test` fails if a change regresses decision quality.
- **Skill playbooks in `reference/`** — `/callsmith audit`, `/callsmith critique`, `/callsmith ttft`, and `/callsmith harden` now behave like Impeccable-style command lenses: markdown-first, agentic, and taste-driven. They use `callsmith intake/check/init` as evidence instead of growing a deterministic JS audit library.

### Changed
- **`analyzeIntake` decision-quality** (the fixes the benchmark forced):
  - Now accepts a 4th `opts.previousVisible` argument and exposes the previously-discarded **`visible`** set (every group currently in scope). This lets callers compute a precise per-turn delta.
  - **`justUnlocked`** — a NEW precise per-turn delta: groups visible now but not in `opts.previousVisible`. Use this to announce what the latest answer opened up. Falls back to the full visible set when no previous set is supplied.
  - **`recommendedNext`** now prefers a just-unlocked REQUIRED group (surface the new question immediately) before falling back to the first `open` group — better UX than blind menu order.
  - **`newlyVisible`** is RETAINED for backwards compatibility but is NOT the per-turn delta: it is the conditional-and-still-unanswered priority list. Re-documented accordingly.
  - All additive and backwards-compatible: existing callers and tests are unaffected.
- `callsmith intake` human-readable summary now prints `visible` and `just unlocked` lines. The `--json` output already carried the full analysis object.
- `SKILL.md` dig-deeper loop rewritten to teach the agent the `visible`/`justUnlocked` delta and that `recommendedNext` now prefers newly-unlocked groups.
- `/callsmith` skill workflow now routes quality gates through markdown playbooks. For cascaded/hybrid stacks, the agent asks for trial/free API keys where available before running a TTFT pilot. Provider changes after critique/TTFT findings must go back through MCQ answers rather than ad hoc edits.
- `bench/report.md` and `bench/judge-payload.md` are git-ignored (generated outputs); the bench harness source is tracked.

## [1.4.0] — Agent-native intake

### Added
- **`callsmith intake --answers <file> [--json]`** — the deterministic coverage gate that drives the agent's dig-deeper loop. Reports `coverage`, `answered`, `open` (required groups still unanswered), `newlyVisible` (conditional groups just unlocked), `optional`, `hidden`, `impossible`, `recommendedNext`, and `state` (`incomplete` | `complete` | `impossible`). Exits non-zero when the stack is impossible.
- **`analyzeIntake(rawAnswers, menu, providers?)`** — new pure library function (re-exported from `src/lib/index.mjs`) backing `callsmith intake`. Exposes the visibility/coverage view the resolver previously computed and discarded; runs on partial answers without applying defaults.
- **`callsmith init --answers <file>`** (agent-native input mode) — when the answers file exists, it is read as **input** and compiled (not rewritten). This is the path `/callsmith` produces after conversing with the user.

### Changed
- **The interactive intake is now agent-native.** All TTY/readline wizards are removed from the CLI: the 22-group `interactiveSpec` quiz, the 4-question `interactiveGuided` wizard, and the `init` numbered mode-picker/preset sub-picker are gone. The CLI has zero `readline`/`process.stdin.isTTY` branches. Invoke `/callsmith` in your coding agent to converse and build the answers file; the CLI is the deterministic engine underneath.
- `callsmith spec` is non-interactive: prints the menu as a reference, or writes a fillable template with `--answers <file>`.
- `callsmith init` with no mode prints agent-native guidance (point to `/callsmith`) plus the non-interactive shortcuts.
- `SKILL.md` rewritten around the agent as the intake surface: the dig-deeper loop (deterministic `intake` gate + model-driven semantic depth), progressive disclosure (load menu/packs/context on demand), and a leaner body (244 lines). Drops the static 22-group table in favor of `callsmith spec` as the on-demand menu reference.
- README Quick Start leads with the agent-native flow (`/callsmith` converses → `callsmith intake` gates → `callsmith init --answers`), with presets as the non-interactive shortcut.

### Removed
- **`callsmith execute`** — undocumented transitional alias for `init` ("while the command naming settles"). `init` is the canonical name.
- **`callsmith init --guided`** (+ `guidedAnswers`/`printGuidedHelp`) — the wizard-era 4-flag shortcut. Now redundant: curated stacks are covered by `--preset`, and conversational intake by `/callsmith` → `init --answers`.
- Dead `commandName` parameter from `runInitCommand` (only existed to distinguish `init` vs `execute`).

### Fixed
- `analyzeIntake` treats an unknown non-empty value in a kind-bearing group as a custom/registry provider selection (mirrors `expandAnswers`), so it counts toward coverage and is flagged as `unknown_provider` impossibility — rather than being silently dropped.

## [1.3.1] — One-shot init (historical; removed in 1.6.0)

### Added
- `callsmith init` one-shot project creation: writes answers, recipe/context, provider docs, scaffold, and simulation report from the default preset.
- `callsmith init --preset <id>` with 5 presets (phone-realtime-gemini, phone-realtime-openai, phone-cascaded, browser-realtime, browser-cascaded).
- `callsmith execute` alias for the one-shot init flow while the command naming settles. (Removed in 1.4.0 — `init` is canonical.)
- `callsmith explain --answers <file>` plain-English stack summary (no files written).
- Write protection: `init`, `forge`, `scaffold`, `docs`, `simulate` refuse to overwrite existing files. `--force` overwrites; `--dry-run` previews.
- `--help` / `help` / no-arg now exit 0.
- Pothole mitigation: provider potholes resolved by a native layer (e.g. LiveKit audio normalization) are separated into a "Mitigated by native layer" section, removing audio-contract contradictions.
- `.env.example` now includes dashboard links for every required key.
- Generated scaffold includes a `Makefile` (`make install`, `make test`, `make dev`, `make simulate`).
- `data/presets.json` preset definitions.
- `CONTRIBUTING.md`, `SECURITY.md`, issue/PR templates.
- `simulate` now emits `tool_started`/`tool_finished` in realtime mode (was only in cascaded mode).
- Simulate failure messages now explain the cause and the fix.

### Changed
- `spec` is non-interactive: writes a fillable template when `--answers` is passed, prints the menu reference otherwise. (Earlier versions had a TTY quiz; superseded by the agent-native intake in 1.4.0.)
- `spec` shows option IDs alongside labels.
- README quickstart now starts with `callsmith init` instead of exposing the internal `spec -> forge -> scaffold -> docs -> simulate` pipeline.
- Provider docs hydration no longer live-fetches by default; pass `callsmith docs --fetch` to opt in.
- README documents local install honestly (npm name conflict noted).

### Fixed
- Audio-contract contradiction: Exotel+LiveKit+Gemini no longer says both "no transcoding" and "build two resamplers".
- `simulate` exited 1 on the default template because realtime mode did not emit tool events.
- `--help` exited 1 as "unknown command".
- Latent bug in `compile.mjs` where `tool-calling.md` content was passed to `path.join` instead of `write`.

## [1.3.0] - Tier 2

### Added
- Cost estimation, conversation state, error handling context.
- 21 provider packs with verified audio contracts + model names + latency/cost estimates.
- LLM + VAD as first-class pipeline citizens.
- Interruption & turn-taking resolution.
- Latency and cost budget modeling.
- Operational scaffold modules (`observability.py`, `tools.py`, `voice_ux.py`, `safety.py`, `handoff.py`, `local_test.py`, `simulate_call.py`).
- `callsmith simulate` fake call lifecycle.
- `callsmith verify-packs` pack freshness checks.
- Framework-native scaffolds (LiveKit AgentSession + Pipecat PipelineWorker + custom FastAPI webhook).
- Impossibility detection, unknown-provider online resolution.
- Byte-deterministic lock, schema validation gate, 40-fixture grid.
