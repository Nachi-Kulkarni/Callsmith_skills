# Changelog

All notable changes to callsmith are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Language-lock, unclear-speech, and spoken-delivery guidance: keep one explicit active language, reject single-token/script/name evidence as a switch, confirm uncertain proper nouns, ask a neutral same-language retry instead of trusting garbled STT, and define personality through a few audible behaviors/examples with provider-gated speech tags.
- Agent-first startup contract for outbound voice: prompt owns the once-only identity/purpose opener, runtime sends a provider-native stimulus only after confirmed pickup, caller media is gated until first assistant audio with a bounded fail-open timeout, and tests/latency traces prove ordering without requiring the caller to say hello. The Gemini Live pack records the proven `send_realtime_input(text=...)` path and rejects fake-audio/VAD tricks.
- Trigger-first skill metadata: the fixed `description` field now names concrete user situations and failure symptoms so model-invoked agents can load Callsmith without `/callsmith`; a structure gate keeps the always-loaded pointer under 100 words and requires both surface and symptom triggers. The skill opening now leads with the work instead of duplicate positioning and internal product shorthand.
- Skill lifecycle UX (C25): every `/callsmith` invocation now ends by suggesting the next command, picked from a single after→next table in SKILL.md (compile → audit → harden → latency → deploy → test → monitor → cost, with branch returns for critique/architecture/prompts/ttft/noise-cancellation/security/multilingual); a structure test fails if a new argument-hint command has no lifecycle suggestion.
- Per-project state file `callsmith.decisions.md` — append-only log of decisions, rejected options, floor rewrites, mistakes to avoid, open questions, and the next step. Read at the start of every invocation and appended at the end, so a fresh session with zero context resumes from it plus `voice.answers.json` and `callsmith.recipe.md` alone.
- Asking rules rewritten: plain words, one idea per question, with worked examples ("Where will people talk to this agent?" not "What surface class?"); prefer the harness's interactive question tool (AskUserQuestion / ask / qna) when available, and record each answer into the decisions file as it is given.
- Public honesty fixes on the evidence surface: the 2026-08-15 diagnostics report carries a dated addendum disclosing that both runs executed arms in parallel (not publication-eligible under the standard adopted the same day; artifacts and scoring unchanged, manifest hash updated); README and HONEST-NUMBERS state the same limit, plus a new ground-truth-independence limitation — the oracles derive from the floors and contract schema shipped in the skill, so CSB measures conformance to Callsmith's rules, not their external correctness.
- `docs/decisions-register.md` — the decision register (C1–C24) and constitution changelog moved out of the shipped constitution; `product_decisions.md` drops from ~18.5 KB to ~12 KB in the consumer skill payload and keeps a pointer.
- Skill `allowed-tools` now includes `WebFetch`/`WebSearch`, unblocking the compile loop's own documented web-fetch fallback when Context7 is unavailable; the progressive-disclosure table links `examples/clinic-triage/` (previously unreachable from the skill).



- `/callsmith test` (`reference/testing.md`) — conversation test suites: scenario call tests that assert outcomes and floors in runtime paths (consent before capture, transfer fallback, DTMF masking) rather than transcript text, regression discipline for prompt/model changes, per-language cohorts, and pilot sampling. CI never dials live PSTN.
- `providers/telephony/whatsapp-cloud.json` — the WhatsApp Business Platform voice-note pack (22nd): OGG/OPUS-mono-only for native voice-note rendering, 16 MB audio cap, webhook media URL expiry, MIME-mismatch trap, async-channel semantics (no barge-in/turn-gap — a design with them on this surface is a category error), 24 h window and free service replies vs per-message template pricing since 2025-07-01, all sourced to Meta docs dated 2026-08-15. No menu leg selects it; the compile loop loads it directly for WhatsApp briefs, and the `policy.md` no-pack warning became a pointer.
- `/callsmith monitor` (`reference/observability.md`) — production observability for what the receipt promised: turn-gap SLO from per-leg v2-trace spans, floor telemetry that pages immediately (consent-before-capture, masking violations, deletion jobs), barge-in/reconnect anomaly alerts, per-language cohorts, and pack-drift SLO rebaselining.
- `/callsmith cost` (`reference/cost.md`) — per-leg $/min assembled from pack `cost_estimates` with evidence classes stated, assumptions declared (turns, length, barge-in rate), S2S-bundled vs cascaded sum-of-parts at the same call profile; cost never overrides a floor.
- `callsmith verify-packs --due [--within N]` — pack-refresh treadmill report: packs needing re-verification in expiry order with primary sources; documented as step 0 of the MAINTENANCE.md quarterly ritual.
- `run-arms.mjs --arm-execution sequential` — arms of a trial run one at a time in the recorded counterbalanced order, removing the shared-subscription throttling confound of parallel arms. Required for publication-eligible runs (enforced in `buildSummary` and `review-publication.mjs`); parallel remains the diagnostic default.
- `run-arms.mjs --resume <run-dir>` — crash recovery for long publication runs: continues a predeclared run from its last complete trial boundary (same seed/runs/scenarios/commit/source hashes), refuses a partially executed trial so no arm is ever re-run conditioned on failure.
- Scenario-cluster bootstrap: the 95% lift interval resamples scenario clusters, not correlated within-scenario trials; the publication review additionally requires the combined interval to exclude zero.
- `command_log_evaluable` on every arm score — an empty command log (grok trace shape, quiet opencode runs) means the `no_deleted_generators` trap passed vacuously; reports now say so instead of implying the trap ran.
- Structure test locking `skills/callsmith/` byte-identical to the repo source (SKILL.md, product_decisions.md, reference/, providers/, examples/) so `sync:skill` drift fails CI.
- Real-clock pack test: CI now fails the day any pack's evidence actually expires (the weekly-cron alarm MAINTENANCE.md always promised).

### Changed
- `evidence/README.md` now publishes the re-scoped discriminating-gate publication bar (the retired `+0.5/+0.4/0.6` line was still live on the public proof surface after the C24 re-scope).
- CSB publication bar re-scoped to the discriminating gates (floor lift ≥ +0.20, contract lift ≥ +0.25, BASE discriminating-fail ≥ 0.3, physics/reality as no-regression vetoes). The fairness-hardened interface removed vocabulary-availability failures, leaving physics/reality at BASE ceiling on current models — the old physics ≥ +0.4 / base-fail ≥ 0.6 thresholds were unreachable by construction. Full rationale and audit trail in `evals/csb/DESIGN.md`; the saturation alarm (discriminating-fail < 0.3) now mandates trap refresh, never bar-lowering.
- The canonical floor table lives solely in `reference/policy.md` (now carrying the handoff ladder and collections durable-write rule). The drifted copy in `audit.md` (which had grown a "Government / benefits" floor the contract schema cannot express) and the condensed copies in `harden.md`, `security.md`, and `product_decisions.md` are pointers now.
- `doctor` derives the required reference canon from SKILL.md routing instead of a stale 11-of-18 list; it now covers all playbooks plus `turn-trace.v2.schema.json`, `current-docs.md`, and the deploy subtree.
- `reference/architecture.md` no longer hard-codes $/min planning numbers two lines above "compute both from packs, don't guess" — the cost lens points at pack `cost_estimates`.
- `reference/multilingual.md` gained the output template its siblings all carry; `reference/critique.md` taste-score lens now has 0–4 anchors (a 4 requires a digit).
- README scoreboard carries an upper-bound caveat: the published lifts were measured before the receipt-example interface fix, part of whose BASE contract failures the run report attributes to that gap.
- `evals/measure/README.md` is banner-marked experimental: no live adapter exists and the frozen corpus (20 FSDD digit clips) proves transport timing only.
- Publication review reuses `assertNoSecrets` from `build-evidence.mjs` instead of a drifting duplicate scanner.
- `package.json` `main` now points at `src/lib/index.mjs` (the library entry) instead of the OpenCode plugin shim.

### Fixed
- Region residency check: a single `any`/`global`/`not_applicable` entry anywhere in a regions array exempted the whole leg from the pin check; sentinel exemption now applies only when the entire array is sentinel values, so mixed arrays (e.g. `["not_applicable","us-east"]`) must answer the pin. All shipped packs carry pure sentinel arrays, so behavior is unchanged on current data (locked by a new unit test).
- `check --answers` on a `null`/array/scalar JSON file now fails with a clean one-line error instead of a raw `TypeError` message; the CLI route wraps dispatch so a corrupt pack file or unexpected crash prints one clean `error:` line, never a stack trace.
- SKILL.md's progressive-disclosure table no longer duplicates the routing table's quality-mode rows (deleted seven rows; stage rows and the worked-example link stay).
- `run-arms.mjs` cleans the isolated actor workspace in a `finally` block — a mid-run crash no longer leaks `callsmith-csb-*` tmpdirs (the failure mode that once left 127 MB behind).
- Removed the undocumented top-level `native_sip` field from the OpenAI Realtime pack (dead, absent from `_schema.json`, redundant with `native_capabilities`).
- Removed the empty leftover `reference/deploy/` directory.

## [1.9.0] — 2026-08-15

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
- Follow-up interface corrections, all locked by generated-from-source or validator-truth tests: the answers enum table is generated from `data/menu.json` (24 groups, including previously hidden `deployment`/`latency`/`barge_in`/`tools`/`business_logic` enums); the receipt example is a concrete validator-true receipt (flat pack-id provider strings, `target_ms`) with a lock test that runs the real `validateContract` on the published example; the answer-to-pack id mapping (e.g. `gpt_4o` → `openai`) is generated from menu maps. Trial arms now execute in parallel and run-dir creation is atomic against same-second runner collisions.
- Fresh fairness-hardened diagnostic runs (2026-08-15, single run per scenario): DeepSeek V4 Flash BASE 7/10 vs WITH 9/9 (+30pp) and GPT-5.6-Luna xhigh BASE 6/11 vs WITH 11/11 (+45pp); lift concentrated entirely in floor completion and contract consistency; reality and physics pass at 100% unaided. The 2026-07-31 diagnostic is retracted (numbers not reproducible from retained artifacts; see the note atop it) and the README scoreboard now carries the measured numbers with their limitations.

- Provider-specific ops rules moved out of resolver logic into pack data: `deployment.hosting_rules` (`force`/`cap` + reason) on pipecat/custom-fastapi and `cost_estimates.self_host_platform_fee_zero` on livekit, fact-checked against livekit.com/pricing and docs.pipecat.ai (2026-08-15) and declared in `_schema.json`. Adding a pack with unusual hosting/cost semantics no longer requires editing the resolver.
- `check --json` now returns a consistent `{impossible, advisories, resolve}` shape on the blocker path; doc-vocabulary grep tests and the ci.yml string snapshot were removed in favor of routing-existence and resurrection-guard invariants; CSB DESIGN section retitled from marketing-speak.

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
