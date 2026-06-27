# callsmith — Product Decisions

> Source of truth for what callsmith IS, what it GUARANTEES, and how those guarantees become tests.
> Derived from a three-round grilling session (2026-06-25). Every line below is a committed decision unless marked **[OPEN]**.
> This doc drives the test plan: each guarantee in here becomes one or more behavior tests, built TDD.

---

## 1. Product identity

**callsmith compiles a verified implementation contract for a voice AI agent.**

A user answers an MCQ intake. callsmith resolves provider compatibility, then emits a **recipe** (`callsmith.recipe.md` + `callsmith.lock.json`) that a coding agent consumes to build the whole system in one pass. A **scaffold** (runnable repo skeleton) is a derived convenience layered on top.

| Aspect | Decision | Status |
|---|---|---|
| Primary deliverable | **The recipe is the source of truth.** `recipe.md` + `lock.json` is canonical; the scaffold is derived. | DECIDED |
| Where test effort concentrates | Layer 3 (artifacts) is the heaviest-tested layer. Scaffold correctness is tested but secondary. | DECIDED |
| Consumer | A coding agent (via `SKILL.md`) is the primary reader of the recipe. | DECIDED |

---

## 2. The test pyramid (6 layers)

Every guarantee maps to one of these layers. The decision for each layer is locked below.

| # | Layer | What it proves | callsmith decision |
|---|---|---|---|
| 1 | **Data integrity** | every pack validates vs `_schema.json`; menu well-formed; no dangling refs | **Hard CI gate** — invalid pack fails the build |
| 2 | **Resolver logic** | audio matrix, when-groups, native short-circuits, impossibility detection | **Strict** — refuses hard impossibilities (4 conditions) |
| 3 | **Artifacts** | recipe.md + lock.json reflect resolver truth; byte-deterministic | **Heaviest test weight**; lock is fully deterministic |
| 4 | **CLI contract** | exit codes, help, errors on bad input; `check` clean vs blocked | **Public contract** — exit codes are part of the API |
| 5 | **Scaffold correctness** | generated repo parses, deps match, μ-law bridge round-trips | **Runs per-fixture in CI** (scaffold → pip install → pytest) |
| 6 | **Agent-skill** | SKILL.md → an agent produces a runnable plan | **Recipe-structure assertions + manual checklist** |

---

## 3. Decision register

### Resolver contract

| ID | Decision | Detail |
|---|---|---|
| R1 | **Refuse hard impossibilities** | `forge` exits non-zero and produces NO recipe when a stack is impossible. |
| R2 | **Four impossibility conditions** | `forge` refuses if ANY of: (a) **no audio path** — telephony format can't reach model format and no layer converts it; (b) **surface/direction mismatch** — e.g. inbound-only telephony for an outbound job; (c) **missing mandatory leg** — e.g. cascaded stack with no STT, or realtime with no realtime model; (d) **conflicting native capabilities** — two providers claim incompatible native modes. |
| R3 | **Soft difficulty still forges** | A stack that's merely hard (e.g. needs 4 audio transforms) still forges, with `[BLOCKER]` warnings the user reads. Only true impossibilities refuse. |
| R4 | **`check` mirrors this** | `check` exits non-zero when any impossibility or unresolved blocker is present; exits 0 on a clean/blocked-only stack. |

### Provider scope (v1.1)

| ID | Decision | Detail |
|---|---|---|
| P1 | **All major providers** | v1.1 ships 21 verified packs, not golden-path-only. |
| P2 | **Confirmed list** | See §4 below. |
| P3 | **Unknown provider → online resolution (two-tier)** ✅ | **Implemented.** When answers reference a provider with no installed pack: **(1) registry lookup** — fetch from a community pack registry (`CALLSMITH_REGISTRY` env, default GitHub raw URL; supports `file://`/local paths for testing); **(2) dynamic synthesis fallback** — build a transient pack with sensible defaults + blocker pothole. Registry packs pass validation and are `verified: true`. Synthesized packs are stamped **`UNVERIFIED PROVIDER — validate before shipping`** in the recipe (prominent header) + lock `resolved_providers` array. `CALLSMITH_REGISTRY_SKIP=1` forces synthesis for testing. |

### Artifacts & determinism

| ID | Decision | Detail |
|---|---|---|
| D1 | **Lock is byte-deterministic** | `generated_at` is removed from `lock.json` (or made injectable for tests). Same answers → byte-identical lock. |
| D2 | **Reproducible builds** | Byte-determinism enables snapshot tests and reproducible builds — a core "lock" promise. |
| D3 | **Recipe reflects resolver truth** | recipe.md content is asserted against the resolver's output, not internal maps. |

### Quality gates

| ID | Decision | Detail |
|---|---|---|
| Q1 | **Pack schema = hard gate** | Every pack validates against `providers/_schema.json`. CI fails on any invalid pack. A missing field is a build error. Critical with 21 packs drifting. |
| Q2 | **Scaffolded tests run in CI** | The generated repo's pytest passing IS a callsmith guarantee. CI does: scaffold → `pip install -r requirements.txt` → `pytest`, per fixture. |
| Q3 | **Model staleness = test guard now** | A test pins current model names (`gpt-5.5`, `claude-sonnet-4-6`, `gemini-3.5-flash`, `gemini-3.1-flash-live-preview`, `gpt-realtime-2`, `nova-3`, `eleven_v3`, `sonic-3.5`). Scheduled CI re-verification against live docs/APIs is a **v1.x** addition. |

### CLI contract

| ID | Decision | Detail |
|---|---|---|
| C1 | **`check` exit code is public** | `check` exits non-zero on impossibility/unresolved blockers; 0 otherwise. (Currently broken — see §5.) |
| C2 | **`forge` exit code is public** | `forge` exits non-zero on hard impossibility; 0 otherwise. |
| C3 | **Bad-input handling** | callsmith must catch with a clear error + non-zero exit: **missing required answer** (e.g. no telephony), **conflicting choices** (e.g. realtime + STT), **unknown command / bad flags** (e.g. `callsmith froge` or `forge` with no `--answers`). |
| C4 | **Interactive `spec` TTY — tested via template + resolver only** | `spec --answers out.json` (template) and when-group routing are automated. The interactive numbered prompts are a thin wrapper, tested manually. No PTY-harness in the suite. |

### Test architecture

| ID | Decision | Detail |
|---|---|---|
| T1 | **Tests drive through the CLI subprocess → artifacts** | Tests spawn `callsmith forge/check/scaffold` and assert on the produced files. Truest E2E, refactor-proof. |
| T2 | **Fixture strategy = grid of golden pairings + edges (~40)** | NOT full cartesian (~100+ is unmaintainable). The grid = the golden corridor + each provider's canonical pairing + known edge cases. ~40 checked-in fixtures. Every provider appears in at least its canonical pairing. |
| T3 | **Agent-skill = recipe-structure assertions + manual checklist** | A test asserts every recipe.md contains the sections an agent needs (audio contract, build order, potholes, required env). A human checklist covers the full agent run. |
| T4 | **Docs-fetch testing** ✅ | **Implemented.** `test/docs.test.mjs` (11 tests) asserts stubs contain frozen audio contracts (format, sample rate, transport), env keys, lifecycle events, potholes, Context7 commands, and official doc URLs — all offline. Live fetch is best-effort and verified manually. |
| T5 | **Fixture creation = generator + checked-in goldens** | A script generates `answers.json` for each grid combo from the provider list; outputs are checked in, reviewed, and regeneratable when packs change. Not hand-written, not runtime-only. |
| T6 | **Impossibility detection via extended pack schema** | Each pack declares supported `directions` (inbound/outbound) and `surfaces`; native capabilities carry explicit conflict annotations. Clean, testable rules. Ripples a small metadata addition to all 21 packs. (Backs R2b/R2d.) |

### Tier 1 features (voice-agent completeness)

| ID | Decision | Detail |
|---|---|---|
| L1 | **LLM as first-class pipeline citizen** ✅ | **Implemented.** LLM providers (OpenAI GPT-4o, Anthropic Claude Sonnet 4, Google Gemini 2.5 Flash) are in the menu, resolver pipeline, lock, recipe, scaffold, and staleness guard. `detectImpossibilities` refuses cascaded stacks without an LLM. |
| L2 | **VAD as first-class pipeline citizen** ✅ | **Implemented.** VAD providers (Silero, Deepgram Endpointing, WebRTC VAD) are in the menu, resolver pipeline, lock, recipe, and scaffold. VAD drives the interruption section of the recipe. |
| L3 | **Interruption & turn-taking section** ✅ | **Implemented.** Every provider pack carries an `interruption` block (mechanism + description + code_hint). The resolver assembles these into a concrete, ordered interruption flow per stack. Recipe includes a dedicated "Interruption & turn-taking" section + `.callsmith/context/interruption.md` with end-to-end flow. |
| L4 | **Latency budget modeling** ✅ | **Implemented.** Every provider pack carries `latency_estimates` (per-leg ms). The resolver computes a total budget, compares against a target (500/800/1200ms by latency priority), and produces a verdict. Recipe includes a latency table + `.callsmith/context/latency-budget.md` with optimization tips. Lock includes `latency` object. |
| L5 | **Framework-native scaffolds** ✅ | **Implemented.** Scaffolds now use the actual framework APIs: **LiveKit** generates `agent.py` with `AgentSession`, `Agent`, `TurnHandlingOptions`, `silero.VAD.load()`; **Pipecat** generates `bot.py` with `Pipeline`, `PipelineTask`, `DeepgramSTTService`, `OpenAILLMService`, `TwilioFrameSerializer`, `SileroVADAnalyzer`, `LLMContextAggregatorPair` + `server.py` with webhook + WebSocket handler; **Custom FastAPI** generates webhook server + audio bridge with codecs/resampler. Tests verify framework-specific structure via AST analysis. |

### Tier 2 — Cost, state, resilience

| ID | Feature | Status |
|---|---|---|
| T2-1 | **Cost estimation per stack** ✅ | **Implemented.** Every provider pack carries `cost_estimates` with billing model + normalized per-minute USD. Resolver `computeCost()` sums per-leg costs. Recipe includes cost table + `.callsmith/context/cost-estimation.md` with per-leg detail + scale projections (per-hour, per-1k-calls). Lock includes `cost` object. `check` command shows cost summary. |
| T2-2 | **Conversation state management** ✅ | **Implemented.** Scaffold generates `state.py` with: (1) `ContextManager` — sliding-window token tracking against the LLM's context window; (2) `TranscriptStore` — SQLite-backed persistence for every turn (call_id, timestamp, role, content, tokens, metadata); (3) `DTMFHandler` — keypad digit collection with inter-digit timeout. Framework-specific DTMF wiring: Pipecat uses `DTMFAggregator`, LiveKit uses `GetDtmfTask`, Custom parses from WebSocket events. |
| T2-3 | **Error handling & resilience** ✅ | **Implemented.** Scaffold generates `resilience.py` with: (1) `ReconnectingWebSocket` — exponential backoff (1s→2s→4s→8s→16s, max 30s) with ±25% jitter, max 5 retries, `ConnectionState` machine; (2) `retry_with_backoff` decorator — honors `Retry-After` header, exponential backoff on 429/5xx, max 3 retries; (3) `FallbackConfig` — per-leg fallback chain registration. Context file includes framework-specific patterns (LiveKit `FallbackAdapter`, Pipecat `on_connection_error`, custom manual fallback). |

### Versioning & roadmap

| ID | Decision | Detail |
|---|---|---|
| V1 | **v1.0 shipped** | Full matrix + tests + green CI. 117 tests across 10 files. |
| V2 | **v1.1 = Tier 1 completeness** | LLM/VAD pipeline, interruption resolution, latency budget, framework-native scaffolds. 21 provider packs. |
| V3 | **v1.2 = Tier 2 completeness** | Cost estimation, conversation state management (ContextManager + TranscriptStore + DTMFHandler), error handling & resilience (ReconnectingWebSocket + retry_with_backoff + FallbackConfig). 144 tests across 12 files. |
| V4 | **TypeScript scaffold deferred** | Python is the v1.x target (AI/voice ecosystem is Python-native). TS scaffold lands if demand appears. |
| V5 | **Hosting: personal account for now** | Repo under personal GitHub + personal npm scope. CI via GitHub Actions. Transferable to a dedicated org later if it grows. |

---

## 4. Provider matrix (21 packs)

Confirmed list. Each = research + verified pack + schema test + fixtures.

| Role | Providers |
|---|---|
| **Telephony** | Exotel, Twilio, Plivo, Telnyx, Vonage |
| **Orchestration** | LiveKit, Pipecat, custom-FastAPI |
| **Realtime** | Gemini Live, OpenAI Realtime |
| **STT** | Deepgram, AssemblyAI |
| **LLM** | OpenAI (GPT-4o), Anthropic (Claude Sonnet 4), Google (Gemini 2.5 Flash) |
| **TTS** | ElevenLabs, Cartesia, Sarvam |
| **VAD** | Silero VAD, Deepgram Endpointing, WebRTC VAD |

---

## 5. Code findings — gaps (ALL RESOLVED)

All gaps below were identified during the initial audit and have been fixed. Retained for historical context.

| # | Gap | Status |
|---|---|---|
| G1 | `check` never exits non-zero | ✅ Fixed — exits non-zero on blockers |
| G2 | `forge` never refuses impossibilities | ✅ Fixed — refuses missing leg + direction mismatch |
| G3 | `lock.json` not deterministic | ✅ Fixed — no timestamps, byte-identical |
| G4 | No bad-input validation | ✅ Fixed — malformed JSON, missing answers, unknown command |
| G5 | No pack schema validation gate | ✅ Fixed — `validate.mjs` + CI gate |
| G6 | Only 8 of 15 packs | ✅ Fixed — 21 packs (telephony + orchestration + realtime + stt + llm + tts + vad) |
| G7 | Tests implementation-coupled | ✅ Fixed — tests drive through CLI → artifacts |
| G8 | No recipe-structure assertion | ✅ Fixed — structural assertions in forge tests |
| G9 | Packs lack impossibility metadata | ✅ Fixed — directions + native_capabilities on all packs |

---

## 6. From decisions → test behaviors

This is the bridge to the test plan and TDD execution. Each behavior below is one vertical slice; it reads like a spec ("callsmith can..."), drives through the CLI → artifacts, and survives internal refactors.

### Layer 1 — Data integrity
- **B1.** Every pack in `providers/` validates against `_schema.json` (hard gate).
- **B2.** Every menu option that maps to a provider resolves to an existing pack (no dangling refs).
- **B3.** `data/menu.json` is well-formed and every `when` predicate references a real group id.

### Layer 2 — Resolver logic (the impossible vs possible boundary)
- **B4.** `forge` REFUSES (non-zero exit, no recipe) when no audio path exists.
- **B5.** `forge` REFUSES on surface/direction mismatch.
- **B6.** `forge` REFUSES on missing mandatory leg (cascaded w/o STT, LLM, or TTS; realtime w/o realtime model).
- **B7.** `forge` REFUSES on conflicting native capabilities.
- **B8.** `forge` SUCCEEDS (with `[BLOCKER]` warnings) on a hard-but-possible stack (4 transforms).
- **B9.** A realtime stack's recipe names no STT/TTS; a cascaded stack names no realtime model (when-groups).

### Layer 3 — Artifacts & determinism
- **B10.** Same answers → byte-identical `lock.json` (snapshot).
- **B11.** `lock.json` pins the verified, current model names (staleness guard).
- **B12.** A LiveKit stack's recipe states no custom transcoding is needed.
- **B13.** A custom-FastAPI stack's recipe requires decoding μ-law and resampling to 16 kHz PCM.
- **B14.** recipe.md always contains the agent-required sections (audio contract, build order, potholes, env).

### Layer 4 — CLI contract
- **B15.** `check` exits 0 on a clean stack; non-zero on impossibility/unresolved blockers.
- **B16.** `forge` exits non-zero on hard impossibility.
- **B17.** Missing required answer → clear error + non-zero exit.
- **B18.** Conflicting choices → clear error + non-zero exit.
- **B19.** Unknown command / bad flags → clear error + non-zero exit.
- **B20.** `spec --answers out.json` writes a fillable template with all visible groups.

### Layer 5 — Scaffold correctness
- **B21.** A custom-FastAPI scaffold's audio bridge round-trips 8 kHz μ-law → 16 kHz PCM → 8 kHz μ-law.
- **B22.** A LiveKit scaffold's bridge is a passthrough (no resampling).
- **B23.** Every fixture's scaffold: `pip install -r requirements.txt && pytest` passes.
- **B24.** Scaffolded `requirements.txt` matches the selected providers' `env_keys`/dependencies.

### Layer 6 — Agent-skill
- **B25.** recipe.md contains every section `SKILL.md` tells the agent to read (contract ↔ skill consistency).
- *(manual checklist: an agent following SKILL.md + recipe produces a runnable system)*

### Provider packs (per new pack, TDD)
- **B26–B32.** For each of Plivo, Telnyx, Vonage, AssemblyAI, Sarvam, Cartesia, custom-FastAPI: a recipe referencing it resolves with the correct, verified audio contract and no false impossibility.

---

## 7. Open decisions

| ID | Item | Status |
|---|---|---|
| T4 | Docs-fetch testing strategy | ✅ Resolved — `test/docs.test.mjs` (11 tests) asserts frozen stubs offline. |
| P3-detail | Registry format & hosting | ✅ Resolved — `CALLSMITH_REGISTRY` env supports URL/local-path; synthesis fallback implemented. |
| — | custom-FastAPI formalization | ✅ Resolved — exists as `providers/orchestration/custom-fastapi.json` pack. |

---

## 8. How this doc is used

1. **Test plan derives from §6.** Each behavior B1–B32+ maps to tests (144 total, all green).
2. **§5 gaps are all resolved** (G1–G9). Retained for history.
3. **§Tier 1 features** (L1–L5) track the voice-agent completeness work: LLM/VAD pipeline, interruption resolution, latency budget, framework-native scaffolds.
4. **Decisions are living.** When a decision changes, update this doc AND the test it maps to. A green test that contradicts this doc is a bug.
