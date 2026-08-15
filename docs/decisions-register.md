# callsmith — Decision Register & Constitution Changelog

> Historical companion to [`product_decisions.md`](../product_decisions.md) (which wins on any
> conflict). The register records *why* each decision exists; it is maintainer history, not shipped
> canon, and is not part of the installed skill payload.

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
| C16 | The standalone CSB-Load reference harness is not shipped; use the real target's drain test and `/callsmith deploy` evidence contract | **DONE** (removed) |
| C17 | `prompts` edits the production runtime prompt; safety, audio, and tool enforcement remain code-owned | **DECIDED** |
| C18 | `/callsmith deploy` owns scalability and requires paced-audio validity, open/closed arrival models, attribution-before-verdict, per-target ceiling, and versioned `run.json` before sizing claims | **DECIDED** |
| C19 | `security` is an agent playbook: card capture routed to DTMF masking or out-of-band links, PII redaction at the trust boundary, voice-channel prompt injection controls, recording access + retention enforcement; floors stay canonical in `reference/policy.md` | **DECIDED** |
| C20 | `multilingual` is an agent playbook: vendor multilingual claims are planning estimates, language answers stay canonical IDs, WER/turn-gap measured per language, never blended | **DECIDED** |
| C21 | `test` is an agent playbook: scenario call suites assert outcomes and floors in runtime paths (never transcript text), regression runs gate prompt/model changes, CI never dials live PSTN | **DECIDED** |
| C22 | `monitor` is an agent playbook: the receipt's SLO and floors are watched via per-leg v2-trace spans; floors page immediately, latency degrades on windows; SLOs rebaseline only after a pack-drift re-measurement | **DECIDED** |
| C23 | `cost` is an agent playbook: per-leg costs come from pack `cost_estimates` with evidence classes stated and assumptions declared; planning numbers are never commitments, and cost never overrides a floor | **DECIDED** |
| C24 | CSB publication bar re-scoped to the discriminating gates (floor lift ≥ +0.20, contract lift ≥ +0.25, base discriminating-fail ≥ 0.3, physics/reality as no-regression vetoes, cluster-bootstrap interval excluding zero) with sequential arm execution required; rationale and audit trail in `evals/csb/DESIGN.md` | **DECIDED** |

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
| 2026-07-28 | Synthesized the transferable voice load-test rules into three `/callsmith deploy` references; deployment sizing now routes through paced-audio validity, arrival models, attribution, and per-target evidence rather than copied stack recipes or the drain gate alone. |
| 2026-07-31 | Removed the standalone CSB-Load reference harness; Callsmith keeps the target-neutral deployment evidence contract and does not ship a synthetic capacity runner. |
| 2026-08-15 | Playbooks `test`, `monitor`, `cost` (C21–C23); the canonical floor table moved solely into `reference/policy.md` (copies replaced by pointers). |
| 2026-08-15 | CSB publication bar re-scoped to discriminating gates with sequential arms and scenario-cluster bootstrap (C24); harness gained crash resume and crash-safe workspace cleanup; `verify-packs --due` added as the pack-refresh treadmill report. |
