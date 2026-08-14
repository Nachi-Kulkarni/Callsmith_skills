# Changelog

All notable changes to callsmith are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

- Added `/callsmith noise-cancellation` (`reference/noise-cancellation.md`) — open-source echo/noise/side-speaker suppression playbook: contaminant classification, WebRTC APM/RNNoise/DeepFilterNet/Silero/ECAPA/TSE boundaries, sustained level gating, speaker-attributed control, one-rung-at-a-time build order, and a field experiment ledger with dated priors.
- Added `/callsmith security` (`reference/security.md`) — card-data routing (DTMF masking on both legs or out-of-band payment links; PAN/CVV never in transcripts, traces, or logs), PII redaction at the trust boundary before persistence, voice-channel prompt injection controls (tool allowlists, typed args, confirmation), and recording access + retention enforcement tied to the policy floors.
- Added `/callsmith multilingual` (`reference/multilingual.md`) — code-switching STT degradation treated as unmeasured by vendors (planning estimates only), multilingual vs per-language leg choice, per-language TTS voice and pronunciation checks, deployed-population accent calibration, DTMF fallback when ASR confidence collapses in-code-switch, and per-language WER/turn-gap evals (never blended).
- Added a "Failover and degradation" section to `reference/deploy.md` — failover targets must exist in answers/packs (no synthesis), a retry → fallback provider → busy message + callback ladder, no mid-call failover to a leg with different audio transforms without re-validated physics, and failover treated as a measured property under the deploy-capacity evidence discipline.
- Reworded the skill description's tail from "voice-agent evaluation" to "latency measurement" — the shipped skill carries latency/ttft playbooks and turn-trace schemas, not eval tooling.
- Added `test/resolver.test.mjs` — 25 direct unit tests for the resolver physics engine (audio format-pair planning, expandAnswers error paths, cost/latency math, interruption ordering, potholes, impossibilities incl. native capability conflicts); previously zero direct coverage.
- Replaced the hand-rolled CLI parser with `node:util` `parseArgs` in strict mode — unknown flags now fail loudly instead of silently printing human output when `--json` was requested; removed the `positional` TDZ trap and dead `=== true` guards.
- Deduplicated the providers/ directory walk into a shared `iterProviderPacks()` used by both `loadProviders` and `validatePacks`, added a duplicate-pack-id guard, and replaced the raw TypeError on a missing realtime leg with a proper error.
- Evidence tests no longer stub the provenance verifier: a new adversarial test runs the real `verifyCheckoutProvenance` against a forged commit pin and asserts fail-closed rejection with no partial bundle.
- csb-runner test scratch dirs moved from `evals/csb/runs/` to `os.tmpdir()` with an `after()` cleanup hook — failed runs can no longer leak residue (the source of 127 MB of local artifacts).
- Added WhatsApp and S2S in-app examples (`examples/whatsapp-reminder/`, `examples/s2s-inapp-support/`), both validated clean by `check` and `contract validate`.
- All nine shipped plugin/marketplace manifests now carry the exact package.json version, enforced by a new release-integrity test (the `.kimi` marketplace format marker excepted).
- CI: Node 20/22 matrix, `timeout-minutes`, superseded-run cancellation, and coverage reporting; `engines` corrected to `>=20.12` (the suite requires `entry.parentPath`). Added `sync:skill` (single-source mirror script) and a tag-triggered release workflow that runs the gates and attaches the packed tarball to a GitHub Release.
- Removed the `.DS_Store` filter fossil from the release walk and the `REQUIRED_SECTIONS.length` tautology from contract tests; backfilled derivable changelog dates (1.3.0, 1.6.0, 1.7.0) from git history.
- CSB fairness hardening (prompt revision 2, breaking comparability with pre-2026-08-15 runs): OUTPUT_SCHEMA.md now publishes the answers enum table and receipt field shape to BOTH arms so BASE fails only on judgment, never vocabulary availability; both actor prompts rewritten short and natural-register (DeepSWE-style) with the WITH prompt routing to the skill instead of inlining gate answers; neutral workspace READMEs/tmpdir labels (no arm identity); opencode actor env scrubbed of repo-path and CSB variables; per-trial input symmetry asserted in code; `reproducibility.json` and `README.md` made immutable controls; dead `oracle.menu` receipt-provider block and its synthetic-only test removed.

## [1.8.0-agent-compiler] — 2026-07-31

- Added a lean, self-contained `skills/callsmith/` distribution for one-command installation through
  the universal skills CLI. It contains the skill, provider packs, references, and example without
  shipping the repository's benchmarks or tests.
- Added a fail-closed operational evidence publisher to the existing measurement runner. It
  recomputes receipts from raw traces, validates hashes and provenance, sanitizes the public timing
  data, and emits methodology, redaction, and checksum receipts. Raw runs remain private and ignored.
- Rewrote the README around a beginner-readable first win, one installation command, honest support
  levels, an architecture flow, uninstall and immutable rollback instructions, and the current
  diagnostic's limited scope.
- Removed the redundant mutable shell installer and the standalone synthetic capacity harness.
  Real deployments retain the target-neutral `/callsmith deploy` evidence contract.
- Added release integrity coverage for the self-contained skill and retained the packed-artifact
  install journey (`doctor`, example physics check, and contract validation).

- Added `/callsmith prompts` for focused production runtime-prompt writing and review.
- Added the frozen licensed measurement corpus, live-adapter preflight/receipt runner, three locked pilot stack configs (`evals/measure/stacks/`), and the adapter contract. The standalone synthetic load harness was removed; real targets use the `/callsmith deploy` evidence contract. Live pack numbers still await provider credentials and spend approval.
- Replaced flat deployment regions with structured media/worker/model/recording/transcript matrices and added advisory vs regulated fail-closed region checks. Verified region data landed only where primary docs support it (Twilio media edges, Telnyx anchor sites, Pipecat Cloud regions incl. Mumbai, ElevenLabs isolated EU/India environments); unverifiable packs stay `unknown` rather than claim coverage.
- Extended contract receipts with optional deployment target, region, and drain ownership; refreshed pack transfer, stream-lifecycle, prompt-cache, and TTS segmentation guidance from official sources.
- Added the weekly scheduled CI evidence gate — the repo pages its owner when pack evidence expires or drifts — and `MAINTENANCE.md`, the wake-up contract for the feature-complete posture.

## [1.7.0-agent-compiler] — 2026-07-25 — Deploy playbook + deployment physics

### Added
- **`/callsmith deploy`** (`reference/deploy.md`) — cloud-vs-self-host playbook: managed paths (LiveKit Cloud managed agents, Pipecat Cloud) vs self-host, the ten deployment decisions (compute model, concurrency, drain, cold start/warm pools, region physics, SIP ownership, secrets inventory, LB/WebSocket reality, observability, cost break-even), residency floor tie-in, and a Deployment Plan output template.
- **`/callsmith architecture`** (`reference/architecture.md`) — S2S vs cascaded vs hybrid decision matrix scored from packs (turn-gap budget classes, cost/min, tool determinism, auditability); hybrid turn-type ownership; noob rules; one winner, no ties.
- **Optional pack `deployment` block** (schema-gated): `hosted_option` (managed_runtime, region_pinning), `self_host_notes`, `concurrency_model`, structured `regions`, `drain_behavior` — populated across the pack library.
- **Deep potholes from production scar tissue:** Silero (shared ONNX session, 32 ms window batching, thread contention, state reset on barge-in, double-VAD ownership), Twilio (agent self-interruption echo, mark tracking for played audio, transfer legs), Exotel (echo without mark/clear, Connect transfer flow), LiveKit (deploy drain, warm-pool cold start), Pipecat (bot-per-call drain, PSTN AEC), custom FastAPI (AEC ownership, drain/single-process), Gemini Live (session duration limit + resumption), OpenAI Realtime (truncate on barge-in with audio_end_ms accounting).
- **`check` prints the Operations section** (requested → effective hosting model, adjustments, responsibilities) and the env-keys secrets checklist.
- **Menu deploy targets:** `livekit_cloud`, `pipecat_cloud`, `cloud_vm` answer options.
- **CSB scenario `deploy-managed-cloud-pilot`** — no-ops managed brief vs custom-bridge poison; the suite grows to 11 scenarios.
- **harden.md transfer physics** — warm/blind transfer mechanics, consent before transfer, failure fallback, summary injection into the human leg.

### Changed
- CSB publication gate: a repeated full suite is now ≥10 scenarios (core10 or superset) after the suite grew to 11.

## [1.6.0-agent-compiler] — 2026-07-10 — Regime change: agent compiler + verification

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

## [1.3.0] - 2026-06-29 - Tier 2

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
