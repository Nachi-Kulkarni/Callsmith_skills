# callsmith — Product Decisions (Canon)

> **Sole constitutional source of truth.** If any other doc conflicts with this file, **this file wins.**
>
> Regime: **agent compiler + deterministic fact verifier** — not scaffold generator, not second architecture brain.

Every line below is a committed decision unless marked **[OPEN]**.

---

## Glossary (plain English)

| Term | Meaning |
|---|---|
| **Wedge** | The one thing the product does that nothing else does; every feature must serve it. |
| **Floor** | A minimum safety choice (consent, retention, handoff) the agent must rewrite the design to meet — mentioning it is not meeting it. |
| **Pack** | A dated, sourced JSON file of checked facts about one provider: audio formats, quirks, costs, env keys. |
| **Contract** | The single handoff document (`callsmith.recipe.md`) another engineer builds from. |
| **Receipt** | The machine-readable JSON block at the top of a contract that makes its choices testable. |
| **Compile loop** | The agent's core job: ask, load packs, apply floors, write one contract, then implement. |
| **CSB** | CallsmithBench — the benchmark that compares with/without-Callsmith agent runs on binary, machine-checked points. |
| **Evidence class** | The label on every pack fact saying how it was verified and when it expires. |
| **Planning estimate** | A vendor or pack number good enough for design math, not a production promise until measured yourself. |
| **Drain** | Shutting workers down by finishing in-flight calls first instead of hanging up on callers. |

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

The single canonical floor table — domains, consent/retention minima, the handoff ladder, and the tool-integration rule — lives in [`reference/policy.md`](./reference/policy.md). It is not duplicated here; conflicting copies lose to it.

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
| Playbooks (`reference/*`) | Optional modes: audit, critique, architecture, latency, ttft, prompts (runtime conversation), harden, deploy, noise-cancellation, security, multilingual, test, monitor, cost |
| Deploy capacity references (`reference/deploy-*.md`) | General voice-load workflow and the mandatory validity/attribution contract before sizing claims |

---

## 10. Decision register

The decision register (C1–C24) and the constitution changelog live in
[`docs/decisions-register.md`](./docs/decisions-register.md) — maintainer history, not shipped
canon. The installed skill payload carries this file only.

