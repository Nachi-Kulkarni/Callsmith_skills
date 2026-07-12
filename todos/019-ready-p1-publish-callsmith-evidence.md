---
status: ready
priority: p1
issue_id: "019"
tags: [benchmark, evidence, readme, release]
dependencies: []
---

# Publish credible Callsmith evidence

## Problem Statement

Callsmith has a reproducible BASE-versus-WITH benchmark harness, deterministic gates, and product examples, but its README does not yet carry a reviewed public product-lift result. The project therefore explains its thesis without proving that the product changes agent outcomes.

## Findings

- Ponytail leads with a real-agent A/B result, publishes per-task receipts, preserves a safety floor, and documents benchmark bugs and limitations.
- Caveman separates its headline from total-session economics and plainly documents workloads where the product is net-negative.
- Impeccable makes the product effect visible through a concrete, reproducible before/after case study.
- Callsmith needs all three: causal benchmark proof, honest limitations, and visible artifacts.
- Existing screening and partial paired runs are diagnostic only; they cannot become the public headline.

## Proposed Solutions

1. Publish preliminary diagnostic results. Fast, but too easy to overclaim and not reproducible as one frozen experiment.
2. Publish only a case study. Visceral, but does not prove lift over a capable bare agent.
3. Run the complete controlled benchmark, retain receipts, then combine its result with case studies and an honest-numbers document.

## Recommended Action

Use option 3. First eliminate actor contamination and validate the harness with a smoke pair. Then run repeated paired core10 evaluations, review the uncertainty and gates, commit a sanitized evidence bundle, and rewrite the README around the earned result.

## Acceptance Criteria

- [x] BASE actor cannot load Callsmith or unrelated personal skills/configuration.
- [ ] Smoke pair is valid, reproducible, and scores both arms.
- [ ] Complete repeated BASE/WITH core10 run finishes on a frozen clean commit.
- [ ] A second model-family run satisfies the documented publication standard.
- [ ] Evidence bundle contains manifests, hashes, summaries, report, and sanitized receipts.
- [ ] README leads with reviewed measured evidence and a concrete before/after.
- [ ] Honest-numbers document states limitations, invalid trials, and losing/no-lift cases.
- [ ] Full repository tests, CSB tests, documentation links, and diff hygiene pass.

## Work Log

### 2026-07-12 - Started

**By:** Codex

**Actions:** Reviewed Ponytail, Caveman, and Impeccable evidence patterns; chose a combined causal-proof, honest-limitations, and visible-case-study structure. Began benchmark isolation audit before publishing any number.

### 2026-07-12 - Closed Codex global-skill contamination

**By:** Codex

**Actions:** Reproduced that `--ignore-user-config` still exposed globally discovered skills. Added a disposable auth-only `HOME`/`CODEX_HOME` per live Codex arm, kept it outside the persisted workspace, disabled local/remote plugins, hooks, and memories, recorded the isolation policy in the run manifest, and added regression coverage. Extended summaries with gate rates, floor/physics lift, BASE failure rate, regulated `pass^k`, trace-sanitization status, and stricter repeated-core10 publication semantics. Focused CSB runner tests pass (24/24); full repository tests pass (91/91).

**Learnings:** Codex configuration isolation and skill discovery isolation are different boundaries. A publishable BASE arm needs both workspace isolation and home-directory isolation.
