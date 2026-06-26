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

### Provider scope (v1.0)

| ID | Decision | Detail |
|---|---|---|
| P1 | **All major providers** | v1.0 ships ~15 verified packs, not golden-path-only. |
| P2 | **Confirmed list** | See §4 below. |
| P3 | **Unknown provider → online resolution (two-tier)** | When answers reference a provider with no installed pack: **(1) registry lookup** — search an online pack registry (GitHub dir / skills.sh hub), download a verified community pack if it exists; **(2) dynamic synthesis fallback** — if no registry pack, use webfetch/Context7 to research the provider's audio contract and build a transient pack. Synthesized packs are stamped **`UNVERIFIED PROVIDER — validate before shipping`** in the recipe. This two-tier resolution preserves the verified-contract guarantee for the common path while remaining extensible. |

### Artifacts & determinism

| ID | Decision | Detail |
|---|---|---|
| D1 | **Lock is byte-deterministic** | `generated_at` is removed from `lock.json` (or made injectable for tests). Same answers → byte-identical lock. |
| D2 | **Reproducible builds** | Byte-determinism enables snapshot tests and reproducible builds — a core "lock" promise. |
| D3 | **Recipe reflects resolver truth** | recipe.md content is asserted against the resolver's output, not internal maps. |

### Quality gates

| ID | Decision | Detail |
|---|---|---|
| Q1 | **Pack schema = hard gate** | Every pack validates against `providers/_schema.json`. CI fails on any invalid pack. A missing field is a build error. Critical with ~15 packs drifting. |
| Q2 | **Scaffolded tests run in CI** | The generated repo's pytest passing IS a callsmith guarantee. CI does: scaffold → `pip install -r requirements.txt` → `pytest`, per fixture. |
| Q3 | **Model staleness = test guard now** | A test pins current model names (`gpt-realtime-2`, `gemini-live-2.5-flash-preview`, `nova-3`). Scheduled CI re-verification against live docs/APIs is a **v1.x** addition. |

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
| T4 | **Docs-fetch testing** | **[OPEN]** — recommendation: assert doc stubs contain the frozen contract + correct Context7 commands, offline only; live fetch verified manually. To confirm when the docs layer is reached in TDD. |
| T5 | **Fixture creation = generator + checked-in goldens** | A script generates `answers.json` for each grid combo from the provider list; outputs are checked in, reviewed, and regeneratable when packs change. Not hand-written, not runtime-only. |
| T6 | **Impossibility detection via extended pack schema** | Each pack declares supported `directions` (inbound/outbound) and `surfaces`; native capabilities carry explicit conflict annotations. Clean, testable rules. Ripples a small metadata addition to all 15 packs. (Backs R2b/R2d.) |

### Versioning & roadmap

| ID | Decision | Detail |
|---|---|---|
| V1 | **One big push to v1.0** | Build the full matrix + tests first, then cut v1.0. No intermediate npm publish. TDD is still incremental within the push (vertical slice per pack / per behavior). |
| V2 | **v1.0 = full Python matrix + green CI** | ~15 packs, Python scaffold, all 6 test layers green. |
| V3 | **TypeScript scaffold deferred to v1.x** | Python is the v1.0 target (AI/voice ecosystem is Python-native). TS scaffold lands later only if demand appears. |
| V4 | **Hosting: personal account for now** | Repo under personal GitHub + personal npm scope (e.g. `@radhikakulkarni/callsmith`). CI via GitHub Actions. Transferable to a dedicated org later if it grows. |

---

## 4. The v1.0 provider matrix (15 packs)

Confirmed list. Each = research + verified pack + schema test + fixtures.

| Role | Providers | Existing | To add |
|---|---|---|---|
| **Telephony** | Exotel, Twilio, Plivo, Telnyx, Vonage | Exotel, Twilio | **Plivo, Telnyx, Vonage** |
| **Realtime** | Gemini Live, OpenAI Realtime | Gemini Live, OpenAI Realtime | — |
| **STT** | Deepgram, AssemblyAI, Sarvam | Deepgram | **AssemblyAI, Sarvam** |
| **TTS** | ElevenLabs, Cartesia | ElevenLabs | **Cartesia** |
| **Orchestration** | LiveKit, Pipecat, custom-FastAPI | LiveKit, Pipecat | **custom-FastAPI** (special-case pack or resolver branch — audit needed) |

**Net new packs to build (TDD):** Plivo, Telnyx, Vonage, AssemblyAI, Sarvam, Cartesia, + custom-FastAPI formalization = **7 work items**.

**Fixture grid (~40):** Generated by a script (T5). The grid covers: the golden corridor (Exotel/Twilio + LiveKit/Pipecat/custom + Gemini/OpenAI), each new provider's canonical pairing (e.g. Plivo + LiveKit + Gemini), and known edges (OpenAI native-SIP, Twilio 16 kHz PCM, cascaded STT/TTS combos, outbound-direction stacks). NOT every cartesian combination.

---

## 5. Code findings — gaps between current state and the guarantees

These are the concrete places where the code does NOT yet honor a decision above. Each is a real TDD RED candidate (the test fails because the behavior doesn't exist yet).

| # | Gap | Location | Decision it violates | TDD type |
|---|---|---|---|---|
| G1 | **`check` never exits non-zero** | `bin/callsmith.mjs:112-123` (no `process.exit` in `check`) | C1 | **RED → GREEN** (new behavior) |
| G2 | **`forge` never refuses impossibilities** | `bin/callsmith.mjs:100-111`, `src/lib/resolver.mjs` | R1, R2, C2 | **RED → GREEN** (new behavior) |
| G3 | **`lock.json` is not deterministic** (`generated_at`) | `src/lib/compile.mjs` | D1, D2 | **RED → GREEN** (change behavior) |
| G4 | **No bad-input validation** | `bin/callsmith.mjs` (only guards missing `--answers`) | C3 | **RED → GREEN** (new behavior) |
| G5 | **No pack schema validation gate** | no validator exists | Q1 | **RED → GREEN** (new behavior) |
| G6 | **Only 8 of 15 packs exist** | `providers/` | P1, P2 | **RED → GREEN** (per pack) |
| G7 | **Existing tests are implementation-coupled** | `test/resolver.test.mjs:49,57` (`transforms.length === 4`), `:31-34,42` (internal `providers` map), `:14-16` (shape assertions) | T1 (should drive through artifacts) | **Retrofit** (replace, not RED-first) |
| G8 | **No recipe-structure assertion test** | — | T3 | **RED → GREEN** (new behavior) |
| G9 | **Packs lack impossibility metadata** (no `directions`/`surfaces`, no conflict annotations) | `providers/_schema.json` + all 8 packs | T6, R2b, R2d | **RED → GREEN** (schema extension, foundational — blocks B4–B7) |

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
- **B6.** `forge` REFUSES on missing mandatory leg (cascaded w/o STT; realtime w/o realtime model).
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

| ID | Item | Recommendation |
|---|---|---|
| T4 | Docs-fetch testing strategy | Assert frozen stubs + Context7 commands offline; live fetch verified manually. Confirm at TDD time. |
| P3-detail | Registry format & hosting for unknown-provider lookup | GitHub directory of community packs under `callsmith-packs/` org, mirrored to skills.sh. Detail before implementing P3. |
| — | custom-FastAPI: pack file vs resolver special-case | Audit current handling; formalize as whichever the resolver tests pass with. |

---

## 8. How this doc is used

1. **Test plan derives from §6.** Each behavior B1–B32 becomes a test (or a few), built in vertical TDD slices.
2. **§5 gaps are the RED queue.** G1–G9, ordered by dependency:
   - **G9** (schema extension: directions + conflict rules) — *foundational; blocks B4–B7 impossibility tests and all new-pack work (G6), since every pack must carry the new metadata.*
   - **G3** (determinism) + **G7** (retrofit) — unblock snapshot/byte-diff tests for everything downstream.
   - **G5** (schema gate) — unblocks the pack-adding sprint (G6); pairs with G9 since the validator enforces the new fields.
   - **G1 / G2 / G4** (exit codes + validation) — the strict-resolver work; depends on G9 for impossibility metadata.
   - **G6** (7 new packs) — each a vertical slice; depends on G9 + G5.
   - **G8** (recipe-structure assertion) — independent; can land anytime.
3. **Decisions are living.** When a decision changes, update this doc AND the test it maps to. A green test that contradicts this doc is a bug.
