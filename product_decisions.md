# callsmith — Product Decisions (Canon)

> **Sole constitutional source of truth.** If any other doc conflicts with this file, **this file wins.**
>
> Regime: **agent compiler + deterministic fact verifier** — not scaffold generator, not second architecture brain.

Every line below is a committed decision unless marked **[OPEN]**.

---

## 1. Identity

**callsmith teaches coding agents to design production voice agents, while deterministic tools verify facts the agent must not invent.**

| Role | Owner |
|---|---|
| Ambiguity, taste, dig-deeper dialogue, stack choice, implementation | **Agent** (skill / hooks / plugins / workflows) |
| Provider physics (audio formats, barge-in, potholes, env keys) | **Packs** (`providers/*.json`) |
| Non-negotiable safety / product policy | **Floors** (skill + validation) |
| Proof of design quality | **Evals** (binary rubric + scenarios) |
| Validation / inspection only | **Tiny CLI** (packs, physics, floors, contract, doctor) |

### One-line constitution

> **The agent compiles. callsmith validates the physics, floors, and eval bar.**

Not: “the agent compiles everything with no ground truth.”
Not: “the CLI compiles and the agent fills forms.”

### Product wedge (P0)

> **pack physics inspect + floor receipts + contract validate + eval gate**

Not: lock as ship contract + scaffold/simulate proof.

### Primary surfaces

| Surface | Status |
|---|---|
| `SKILL.md` + `reference/*` | **Canon** — how agents compile |
| `providers/**` + `_schema.json` | **Canon** — standard library of facts |
| Hard floors | **Canon** — rewrite, do not only flag |
| Eval harness + scenarios + rubric | **Canon** — typechecker for agent quality |
| Handoff contract (agent-written, short) | **Canon** — outcome artifact |
| Thin verification CLI | **Canon** — packs / check / doctor / contract validate |
| CLI generation (`forge` / `scaffold` / `init` / `simulate` / `intake` / `docs`) | **Deleted** — exit 2 if invoked |
| 22-group MCQ coverage law | **Demoted** — menu is expand/hint data for `check`, not completeness |
| Byte-deterministic lock as product center | **Rejected** — not identity |
| Dynamic unknown-provider synthesis | **Rejected** — false confidence |

### +4 delta (product verdict)

The +4 is **not** “we scaffolded your app.”

The +4 is:

> My agent no longer hallucinates voice-stack physics, skips consent/handoff floors, or ships a pretty demo that fails on PSTN reality.

Irreversible when callsmith is the shared **stdlib + taste layer + eval bar** across agent sessions.

---

## 2. Hard guarantees

These are promises we will keep and test. Break them = ship fail.

| ID | Guarantee | How it is proven |
|---|---|---|
| **G1** | **Pack integrity** — every installed provider pack validates against `providers/_schema.json` | CI hard gate on pack schema |
| **G2** | **No fabricated provider facts** — audio/interruption/pothole claims come from packs (or user-supplied pack files), never from silent synthesis | No dynamic UNVERIFIED pack invention; unknown provider → research / add pack / block ship |
| **G3** | **Floor policy is enforceable** — regulated domains cannot pass “aware but unchanged” | Skill rewrite rules + validation (CLI or eval) fails closed on floor violations |
| **G4** | **Eval bar is binary and causal** — sealed gates + ablation (CSB-Δ), not essay/ceremony theater | CallsmithBench design: [`evals/csb/DESIGN.md`](./evals/csb/DESIGN.md); machine oracles + WITH−BASE lift; LLM judge weight 0 on the public score |
| **G5** | **Handoff contract is semantic** — agent-produced contract includes a versioned structured receipt plus explanatory sections; provider, policy, jurisdiction, and turn-gap SLO choices are machine-checkable | Semantic contract validation + answers cross-check + eval gate |
| **G6** | **Physics are checkable** — given declared providers, transforms / native short-circuits / hard impossibilities can be reported from pack data | Thin verify/inspect path (resolver-as-library or pack math), not full app generation |
| **G7** | **Skill is the compile path** — interactive design is agent-native; no CLI wizard | Documented install + SKILL.md |

### Floor policy (minimums)

Same domain floors as skill/eval (non-exhaustive):

| Domain signals | Consent | Retention | Handoff when stakes high |
|---|---|---|---|
| Medical / clinical | ≥ announce (prefer explicit) | ≥ 30d | transfer |
| Banking / payment / KYC | explicit | ≥ 30d | transfer on payment failure |
| Collections / debt / DNC | explicit | ≥ 90d | transfer on dispute |
| Legal / insurance (high stakes) | ≥ announce | ≥ 90d | transfer when urgent |

**Acknowledging a risk is not handling it.** Floors require rewrite (or explicit written acceptance of legal risk).

### Handoff contract — required sections (G5)

Agent-written (not 16 generated markdown files):

1. Intent / use case
2. Stack (providers + why)
3. Audio path (transforms or native ownership)
4. Interruption / barge-in ownership
5. Floors applied (consent, retention, handoff, tools justification)
6. Latency/cost note with a percentile `turn_gap_ms` SLO
7. Build / implement notes for the coding agent

---

## 3. Non-guarantees

We **do not** promise these. Docs and tests must not pretend otherwise.

| Non-guarantee | Why |
|---|---|
| Generated production app is correct / complete | Generation deleted; agents own implementation |
| Fake-call simulate proves PSTN readiness | Lifecycle mock ≠ media fidelity or carrier reality |
| Byte-identical `callsmith.lock.json` is the product center | Not identity; not shipped |
| MCQ coverage 1.0 / 22 groups complete | Completeness = floors + intent + pack-informed physics, not menu fill rate |
| Unknown providers auto-synthesized “safely” | Synthesis creates false confidence — **rejected** |
| Hosted runtime, legal certification, HIPAA/PCI badge | Out of scope |
| One true stack for a brief | Variability is the agent’s job |

---

## 4. Kept tools (CLI / validation spine)

Deterministic **verification**, not deterministic **generation**.

| Tool | Purpose | Status |
|---|---|---|
| `packs` / `pack list` | Show installed provider packs | **Shipped** |
| `pack show <id>` | Dump pack facts (audio, interruption, potholes, env) | **Shipped** |
| `pack validate` / `verify-packs` | Schema + evidence provenance/date/expiry checks (not live source-content verification) | **Shipped** |
| `doctor` | Install health, pack load, skill present | **Shipped** |
| `check --answers <file>` | Physics report from pack data (transforms, impossibilities, latency, cost) | **Shipped** (thin) |
| `contract validate --file <f> [--domain …]` | Handoff contract receipt + explanatory G5 sections | **Shipped** (semantic validation) |

Exit codes on validation tools remain a public contract: non-zero on fail.

---

## 5. Deleted tools (do not resurrect)

| Surface | Disposition |
|---|---|
| `forge` | **Deleted** — agent writes the handoff contract |
| `scaffold` / generated `agent.py` empire | **Deleted** — agent implements against packs + contract |
| `simulate` fake lifecycle | **Deleted** — not a production proof |
| `init` / `init --preset` | **Deleted** — use skill + optional `examples/` later |
| `intake` coverage state machine | **Deleted** as CLI product — skill dig-deeper owns completeness |
| `docs` / 16-file `.callsmith/context/*` | **Deleted** — one handoff contract |
| `spec` / `explain` / `release-check` as product surfaces | **Deleted** |
| Dynamic provider synthesis / registry invent | **Deleted** — block or require real pack |
| Byte-deterministic lock as ship artifact | **Deleted** as product center |

**Canon forbids new features** that reintroduce deleted generation surfaces.

---

## 6. Tests (what CI should prove)

| Layer | Proves | Priority |
|---|---|---|
| **Pack schema** | Every pack valid; no dangling kind/id claims that matter | **Hard gate** |
| **No synthesis** | Unknown provider path does not invent verified facts | **Hard gate** |
| **Floor enforcement** | Skill text + validation/eval catch consent/handoff/tools skips | **Hard gate** |
| **Skill-contract consistency** | SKILL.md required sections / floors match this file | Structure tests |
| **Eval harness** | CSB oracles, poison fixtures, BASE/WITH arms, CSB-Δ report; legacy 28-pt optional | Harness tests + design in `evals/csb/` |
| **Example contracts** | Golden handoff contracts for key verticals satisfy G5 | Lightweight fixtures |
| **Physics inspect** | Pack-pair transform / impossibility reports match known cases | Thin unit/integration |

### Explicitly out of product identity

- Scaffold pytest matrix
- Byte-identical lock snapshots
- 40-stack fixture grid for codegen
- Decision-graph bench for MCQ coverage state machine

---

## 7. Split brain (non-negotiable)

| Layer | Deterministic? | May invent? |
|---|---|---|
| Agent (skill/workflows) | No | Implementation, dialogue, stack taste, codegen |
| Packs | Yes (data) | **No** — only human/PR-reviewed pack edits |
| Floors | Yes (policy) | **No** — override only with explicit user risk acceptance |
| Eval rubric | Yes (binary points) | **No** — partial credit theater forbidden |
| Validation CLI | Yes | **No** — report from packs/contract only |

**Installs are top-of-funnel. Packs + floors + eval in the agent’s path is retention.**

---

## 8. Provider packs

| Decision | Detail |
|---|---|
| Packs are the stdlib | Audio ingest/egress, interruption, potholes, evidence-labeled latency/cost planning inputs, env keys, source URLs, optional evidence-graded `deployment` physics |
| Evidence expires | Every factual pack records grade, verification date, expiry, and primary sources; expired evidence fails verification |
| Add provider = drop JSON | Validated by schema; no code change required for new facts |
| Unknown provider | Research → write/install pack → re-validate. **Do not synthesize a fake pack.** |
| Community packs | Allowed when schema-valid; mark verification grade honestly (verified vs community) |

---

## 9. Skill / teaching surfaces

| Surface | Role |
|---|---|
| Skill | Primary compile language for coding agents |
| Hooks **[OPEN]** | Pre-ship constraints (floors + pack load) without competing CLI generator |
| Plugins | Packs as extensibility; future agent-runtime plugins optional |
| Workflows | Agent multi-step: dig-deeper → contract → implement → harden → eval |
| Playbooks (`reference/*`) | Optional modes: audit, critique, architecture, latency, ttft, prompts (runtime conversation), harden, deploy |

---

## 10. Decision register (active)

| ID | Decision | Status |
|---|---|---|
| C1 | Constitution: agent compiles; callsmith validates physics, floors, eval bar | **DECIDED** |
| C2 | **This file is sole product canon** for what to build next | **DECIDED** |
| C3 | Delete deterministic *generation*; keep deterministic *verification* | **DONE** |
| C4 | Unknown provider synthesis is forbidden | **DECIDED** |
| C5 | Scaffold / simulate / forge / preset-init are not product | **DONE** (removed) |
| C6 | MCQ coverage 1.0 is not completeness | **DECIDED** |
| C7 | Primary install path is agent skill | **DECIDED** |
| C8 | +4 delta = no hallucinated physics / no skipped floors / no pretty-but-PSTN-dead demos | **DECIDED** |
| C9 | Contract validate CLI shape | **DONE** — versioned receipt validates provider IDs, policy basis, jurisdiction, regulated defaults, and percentile turn-gap SLOs |
| C10 | P0 wedge = pack inspect + floor receipts + contract validate + eval gate | **DECIDED** |
| C11 | Companion docs (`product.md`, `subtraction.md`, README) must not contradict this file | **DECIDED** |
| C12 | `deploy` + `architecture` are playbooks (agent modes) backed by pack deployment physics; deterministic generation stays deleted | **DECIDED** |
| C13 | Packs may carry an optional evidence-graded `deployment` block; CSB publication gate accepts a repeated full suite of ≥10 scenarios (core10 or superset) | **DECIDED** |
| C14 | Measured latency requires a hashed licensed corpus, pinned config/region/cohort, raw turn traces, nearest-rank percentiles, and quality vetoes; no provider number is inferred | **DECIDED** |
| C15 | The optional receipt deployment block is additive; managed target/drain claims and regulated residency paths fail closed against structured pack regions | **DECIDED** |
| C16 | CSB-Load sends real SIGTERM under concurrency and passes only with zero drops/leaks/stale replay plus bounded p95 turn-gap degradation | **DECIDED** |
| C17 | `prompts` edits the production runtime prompt; safety, audio, and tool enforcement remain code-owned | **DECIDED** |

---

## 11. Working agreements

1. New work starts from **this file**, not from README nostalgia or archived CLI product.
2. **Do not** open PRs that expand scaffold templates, menu-as-law, synthesis, or lock-as-identity.
3. **Do** put new knowledge in packs, floors, skill/playbooks, or eval scenarios.
4. When code and this doc disagree, **this doc wins** — finish the lag.
5. Optional companions: `product.md` (+4 / irreversibility narrative), `subtraction.md` (historical cut map). Neither overrides this file.

---

## Changelog of constitution

| Date | Note |
|---|---|
| 2026-07-09 | Regime change: agent compiler + deterministic verification. |
| 2026-07-09 | Generation code deleted (1.6.0-agent-compiler). Wedge = pack inspect + floors + contract + eval. This file sole forward canon. |
| 2026-07-09 | `contract validate` shipped (minimal). Example: `examples/clinic-triage/`. Structure tests for floors/no-synthesis/physics. |
| 2026-07-09 | CallsmithBench (CSB) eval design: ablation CSB-Δ, 4 sealed gates, dual oracle, core10 — `evals/csb/DESIGN.md`. |
| 2026-07-09 | CSB Phase 1 shipped: schema v1, machine oracles, fixture scorer, CI tests. CSB-Δ unpublished until paired agent run. |
| 2026-07-10 | Contract receipt v1 replaced keyword-only floor theater; committed contract history is the cross-session evidence trail. |
| 2026-07-20 | Playbooks `deploy` + `architecture`; optional pack `deployment` blocks (8 packs) + deep potholes (Silero reuse/echo/truncate/session-limit/transfer); menu deploy targets; `check` prints Operations + env keys; scenario `deploy-managed-cloud-pilot` grows suite to 11; publication gate ≥10. |
| 2026-07-21 | Frozen measurement corpus/harness, structured region matrices, optional deployment receipt enforcement, and CSB-Load drain gate. Provider measurements remain unpublished until live raw traces clear review. |
| 2026-07-22 | Added `/callsmith prompts` as the runtime-prompt writing and review playbook. |
