# CallsmithBench (CSB) — Eval Design

> **What this measures:** the real **+4 delta**, not process theater.
> **Constitution:** [`product_decisions.md`](../../product_decisions.md)
> **Status:** Design canon for the next eval. The OpenCode 28-point rubric is **legacy research** until CSB ships.

---

## 0. The product claim (what must be falsifiable)

### +4 delta

> My agent no longer hallucinates voice-stack physics, skips consent/handoff floors, or ships a pretty demo that fails on PSTN reality.

### Irreversibility

Users feel: *I cannot believe I used to design voice stacks without packs + floors + a gate.*

### Real delta formula

```
value = value_gained − trust_cost − setup_friction − switching_anxiety − maintenance_burden
```

The eval must prove **value_gained** (physics + floors + ship honesty) and keep **trust_cost** low (no synthesis, no flag-only, no fake green).

---

## 1. Why the superseded judge eval was removed

| Current pattern | What it actually measures | Why it fails +4 |
|---|---|---|
| 28 binary LLM points | Rubric cosplay + long notes | Essay points are free (~12–16 pts) |
| Actor prompt lists phases | Exam preparation | Prompt **is** the answer key |
| `targetAnswers` in judge | Anchor gravity | House-stack monoculture |
| “Ran pack show / check” | Ceremony | Presence ≠ design change |
| No BASE arm | Absolute score | Cannot claim lift over plain agent |
| No poison seeds | Cooperative cleanup | Floor rewrite often untested |
| Notes as primary artifact | Verbosity theater | Implementability unmeasured |

**One-line verdict:** excellent unit test that the agent can *role-play callsmith*; weak test that it *is* a voice compiler; near-zero test of wire readiness.

---

## 2. Four lenses that constrain the design

### Product UX (builder)

| Need | Eval implication |
|---|---|
| Time-to-first-floor-save | Seed **known** floor violations; score rewrite, not awareness |
| Low cognitive load | Score only `voice.answers.json` + `callsmith.recipe.md` (notes unscored) |
| Trust | Numbers from packs/check; mismatch = hard fail |
| Score in 10 seconds | Public badge: **paired task-success lift**, not “23.7/28 warn” |

### Caller / business (end user of the agent)

| Reality | Must score |
|---|---|
| PSTN μ-law / surface truth | Wrong surface / fake phone path → fail |
| Consent on regulated lines | Flag-only → fail |
| Live handoff on safety/payment | ticket-only when stakes high → fail |
| Latency honesty | Adjectives without pack/check digits → fail contract gate |
| Barge-in on full-duplex phone | Required + owner from pack |

### Developer / coding-agent user

| Need | Eval implication |
|---|---|
| Fewer rediscoveries | Physics claims must match pack resolve |
| Ablation | WITH skill+packs vs BASE bare agent |
| Implementable contract | Blind second agent from recipe only |
| No scaffold debt | Forbidden tool list is P2P invariant |

### Incredible GitHub project

Stars stick when outsiders can:

1. Cite a **named number** (`CSB success lift +0.31 on core10`)
2. Trust green CI on **deterministic** tracks
3. Reproduce (`npm run bench:csb` + model pins + seeds)
4. See **BASE still fails** (packs remain load-bearing)

---

## 3. Design law (non-negotiable)

### Evidence hierarchy (hard → soft)

1. **Artifact fields + CLI exit codes + in-process `resolve` / `validateContract`**
2. **Oracle match** on sealed fields (consent, handoff, surface, language, transform class)
3. **Blind implementer** checklist (binary)
4. **LLM judge only residual** (weight **0** on CSB-Δ; quote-capped; notes length = 0 weight)

### What NOT to score (ever)

- Word count / eloquence of `agent-notes.md`
- “Ran audit/critique/ttft/harden playbooks”
- “Considered an alternative” without rejected stack + number in **answers or contract**
- Self-critique theater
- Presence of “HIPAA” without consent rewrite in answers
- Provider name-drop without pack-grounded field
- Deleted-generator abstinence as a *skill* point (track as P2P only)

### Dual oracle (SWE-bench style)

| Oracle | Meaning |
|---|---|
| **FAIL_TO_PASS (F2P)** | Scenario-specific requirements that start failed (poison floors, wrong surface, transform trap) |
| **PASS_TO_PASS (P2P)** | Constitution invariants that must stay green (no synthesis, no generation resurrection, G5 shape) |

```
resolve = all F2P pass AND all P2P pass
LLM cannot override F2P fails
```

---

## 4. Public score (10-second read)

### Primary: paired task-success lift

Each scenario has **4 binary gates**. A trial succeeds only if every gate passes, with `G_REAL` acting as a hard veto.

```
Success(arm_i) = G_FLOOR AND G_PHYS AND G_CON AND G_REAL
CSB lift       = mean_i(Success(WITH_i) − Success(BASE_i))
```

**Badge:**

```
CSB success lift +0.34 · WITH 92% · BASE 58% · pass^3 83%
```

The report includes a deterministic 10,000-resample paired-bootstrap 95% uncertainty interval. Mean gate-score delta is diagnostic only: the gates share evidence and must not be presented as four independent units of value.

| Chip | Definition |
|---|---|
| **floors** | % scenarios WITH passes `G_FLOOR` |
| **physics** | % WITH passes `G_PHYS` |
| **contract** | % WITH passes `G_CON` |
| **base-fail** | % BASE fails ≥1 of floor/physics (should stay high) |

### Secondary (separate, never mixed into primary success lift)

| Metric | Meaning |
|---|---|
| **CSB-Imp %** | Blind implementer checklist pass rate on WITH recipes |
| **pass^3 regulated** | All of 3 runs pass F2P on medical/banking/collections subset |
| **TTFP** | Turns until first pack-cited physics fact (WITH arm) |

### Product-lift claim is true only if

1. **Task-success lift is positive with a reviewed uncertainty interval** on core10 across ≥2 model families
2. **Floor lift** ≥ +0.5 absolute (`P(G_FLOOR|WITH) − P(G_FLOOR|BASE)`)
3. **Physics lift** ≥ +0.4
4. **base-fail** ≥ 0.6 (refresh traps if saturated)
5. No scored dimension is notes length

---

## 5. The four gates (only these count toward CSB-Δ)

| Gate | ID | Pass (binary AND of sealed subfields) | Evidence |
|---|---|---|---|
| **Floor rewrite** | `G_FLOOR` | Domain oracle met on final answers; if seed was poisoned, fields moved in the correct direction | `answers` vs `fixtures/poisoned/*` + `oracles/floors.mjs` |
| **Physics correct** | `G_PHYS` | Surface/direction/arch class match oracle; transform band matches pack resolve; no invented provider ids | In-process `expand` + `resolve` / `detectImpossibilities` |
| **Contract ship** | `G_CON` | `validateContract(recipe, domain)` PASS; answers policy consistent with contract floors | `src/lib/contract.mjs` |
| **Anti-pretty-demo** | `G_REAL` | Trap predicates: not web for PSTN, not ticket on medical red-flag, no synthesis, no deleted CLI | Scenario trap functions + command log |

**No partial credit inside a gate.** “Almost explicit” = fail.

### Sealed fields (scored)

- `surface`, direction
- `language` when brief forces it
- `recording_consent`, `transcript_retention`
- `human_handoff` when stakes high
- architecture **class** when scenario locks it
- telephony id when brief names it
- transform class band: `{0 native | 1–2 light | ≥3 heavy}`
- tools class for booking: openapi OR webhook **with** comparison signal in contract

### Free fields (unscored taste)

Specific LLM/TTS brand when multiple pack-valid; deployment host; prose style.

### Floor rewrite — anti flag-only

Poison seeds (deterministic), not only cooperative user-sim:

```json
{
  "recording_consent": "none",
  "transcript_retention": "ephemeral",
  "human_handoff": "ticket",
  "surface": "inbound_pstn"
}
```

**Pass only if** final answers meet domain minima.
The **diff is the receipt**. Do not require “before → after” prose.

### Physics — harness re-resolves

Do **not** trust actor-pasted `check` stdout. After the run:

```js
const expanded = expandAnswers(finalAnswers, menu, { strict: false });
const report = resolve(expanded, providers);
// compare transform band + impossibilities to oracle
```

### Contract — machine first

Reuse `callsmith contract validate`. Later: cross-check `answers.recording_consent` vs contract domain section.

---

## 6. Arms (ablation — required for +4 claim)

| Arm | Access | Forbidden |
|---|---|---|
| **BASE** | Same model, brief, time budget, output schema | No SKILL, no packs, no callsmith CLI, no reference/* |
| **WITH** | Full product surface | Deleted generators still forbidden |

For Codex actors, filesystem isolation alone is insufficient: the CLI can discover personal skills
outside the arm workspace. Every arm therefore runs with a disposable auth-only `HOME` and
`CODEX_HOME`. Only the subscription `auth.json` is copied; user configuration, rules, skills,
plugins, memories, and history are excluded and the temporary home is never retained.

Same poison seed for both arms.

### Attribution matrix (monthly / major skill edits)

| Arm | Packs | Floors skill | CLI | Proves |
|---|---|---|---|---|
| A0 BASE | — | — | — | Base model IQ |
| A1 packs only | ✅ | — | — | Physics alone |
| A2 floors only | — | ✅ | — | Policy alone |
| A3 skill+packs | ✅ | ✅ | — | Compiler without verify |
| A4 full wedge | ✅ | ✅ | ✅ | **P0 product claim** |
| A5 dump-all packs | all in prompt | ✅ | ✅ | Progressive disclosure necessity |
| A6 generation zombie | ✅ | ✅ | ✅ + allow scaffold | Deletion still correct |

**Success signature:**

```
A4 >> A0 on floors + physics
A1 ↓ physics hallucinations; not floors
A2 ↓ floor skips; not physics
A4 ≥ A3 on check cleanliness
A6 does not improve F2P
```

---

## 7. Tracks

| Track | Purpose | Scorer | CI |
|---|---|---|---|
| **T-PHYS-U** | Pack schema + known resolve bands | Node unit tests | **Hard gate** |
| **T-FLOOR** | Poison → rewrite | Oracle diffs | Nightly agent |
| **T-PHYS-D** | Design physics honesty | resolve oracle | Nightly agent |
| **T-CON** | G5 + domain receipts | contract validate | CI goldens + nightly |
| **T-ABL** | WITH − BASE task success | Paired arms | Nightly (public lift) |
| **T-IMP** | Blind implement from recipe | Binary checklist | Weekly |
| **T-DEMO** | Pretty-demo traps | Trap oracles | Nightly |
| **T-BLOG** | Typed failures → skill/pack PR | Diff-derived backlog | Always |

The legacy 28-point judge harness was deleted after CSB absorbed the useful scenario evidence. One benchmark owns the public quality claim.

---

## 8. Core10 scenarios (public high-signal set)

Demote salon/gym warmth from the marketing core. Extended zoo = weekly.

| # | ID | Signal | Poison / trap |
|---|---|---|---|
| 1 | `clinic-floor-poison` | Medical consent + transfer | consent none, handoff ticket |
| 2 | `collections-outbound` | explicit + 90d + dispute transfer | weak consent, short retention |
| 3 | `india-exotel-hinglish` | Language + named carrier | language english, wrong telco |
| 4 | `exotel-custom-transform-trap` | Physics honesty | **must keep custom FastAPI** and admit heavy transforms (LiveKit rewrite fails this scenario) |
| 5 | `livekit-native-short-circuit` | Correct 0-transform | fail if double μ-law “best practice” |
| 6 | `whatsapp-not-pstn` | Surface discipline | default PSTN answers |
| 7 | `bank-kyc` | explicit + transfer + tools | consent none, ticket |
| 8 | `ultra-latency-webrtc` | Arch class under SLA | cascaded when ultra required |
| 9 | `unknown-provider-refusal` | No synthesis (G2) | “AcmeTel verified” without pack |
| 10 | `clinic-implement-golden` | Contract quality + Imp track | empty → WITH recipe; Imp from recipe only |

Each scenario ships:

```
brief.md              # public to actor
tags.json             # domain, surface, stakes — harness only
oracle.json           # sealed fields + transform band — harness only
poisoned.answers.json # deterministic seed
reference/            # optional solvability proof
```

**Actor must never see** oracle.json, targetAnswers, judge-rubric point IDs, or automatic zero rules.

---

## 9. Implementability track (CSB-Imp)

Separate public metric — measures **G5 value**.

Blind coding agent receives **only** `callsmith.recipe.md` (no skill, no packs tree). Binary checklist:

| Item | Evidence |
|---|---|
| Names telephony + orchestrator from contract | parse |
| Codec/sample rate **as stated in contract** | string match |
| Barge-in ownership matches contract | section |
| Consent utterance / handoff path in plan or stub | section |
| Single non-contradictory stack | structure |

Start with golden [`examples/clinic-triage/callsmith.recipe.md`](../../examples/clinic-triage/callsmith.recipe.md).

---

## 10. Reliability vs capability

| Suite | Bar | Use |
|---|---|---|
| **Capability** | pass@1 / pass@3 on core10 + extended | Hill-climb |
| **Reliability** | **pass^3** on regulated F2P (clinic, bank, collections) | Skill release gate |
| **Regression** | T-PHYS-U + golden contracts + oracle unit tests | Every PR |
| **Negative** | Non-voice briefs must not force compile theater | Overtrigger control |

Floor skip once is a ship fail → **pass^k**, not only pass@k, on regulated subset.

---

## 11. Irreversibility metrics (habit, not installs)

| Metric | Definition | “Can’t go back” signal |
|---|---|---|
| CSB success lift | paired all-gates success-rate lift | positive and sustained with reviewed uncertainty |
| Gate-score delta | mean correlated gate-count lift | diagnostic only |
| Floor lift | WITH − BASE on G_FLOOR | ≥ +0.5 |
| Physics lift | WITH − BASE on G_PHYS | ≥ +0.4 |
| Base fail rate | BASE fails floor or physics | ≥ 0.6 |
| Pack-touch rate | % WITH sessions with pack-cited fact | high |
| Contract-commit | % producing G5 recipe | high |
| Continuation integrity | Session B extends Session A without re-hallucinating | green F2P preserved |
| Rediscovery tax | BASE reintroduces wrong μ-law after WITH was correct | stays high |
| TTFP | turns to first pack-cited physics | low on WITH |

**Vanity banned as north star:** installs, stars, downloads alone.

---

## 12. Canonical harness loop

```
for trial in deterministic_schedule(seed, runs):
  for scenario in core10:
    for arm in counterbalanced([BASE, WITH]):
    workspace = prepare(arm, scenario, seed)   # isolation; no gold leakage
    actor(arm, workspace)                      # same model + time budget
    require actor.exit == 0 AND fresh(answers, recipe)
    answers = read(voice.answers.json)
    recipe  = read(callsmith.recipe.md)
    check   = resolve(expand(answers))         # harness-side
    con     = validateContract(recipe, domain)
    gates   = {
      G_FLOOR: floorOracle(answers, seed, scenario),
      G_PHYS:  physOracle(answers, check, scenario),
      G_CON:   con.PASS && crossCheck(answers, recipe),
      G_REAL:  trapOracle(answers, recipe, cmdLog, scenario),
    }
  success_i = all(WITH.gates) - all(BASE.gates) # G_REAL veto included
emit paired success lift + CI, pass^k, diagnostic gate lifts, typed backlog
optional: Imp arm on WITH recipes
optional: LLM essay judge (weight 0)
```

### Typed backlog (not free prose)

```json
{
  "failure_id": "G_FLOOR.consent",
  "scenario": "clinic-floor-poison",
  "arm": "WITH",
  "expected": "announce|explicit",
  "actual": "none",
  "target": "SKILL.md#hard-floors"
}
```

→ groups into `improvement-backlog.md` by `target` (skill / pack / scenario / harness).

### Actor prompt rules

- Give: brief + (WITH only) skill/packs/CLI
- Require outputs: **answers + recipe only**
- **Do not** paste the 28-point rubric or 12-step exam script
- Playbooks optional, **unscored**

---

## 13. Pass bars

| Claim | Bar |
|---|---|
| CI green | T-PHYS-U + golden `contract validate` + oracle unit tests |
| Nightly agent | core10 WITH task success plus zero G_FLOOR fails on regulated core |
| Publish CSB lift | complete repeated BASE+WITH core10, clean commit, model/tool pins, hashes, budgets, and uncertainty in `summary.json` |
| “irreversible” | positive reviewed task-success lift **and** floor lift ≥ 0.5 **and** base-fail ≥ 0.6 |
| Skill release | regulated **pass^3** F2P ≥ 0.9 + regression green |

---

## 14. Mapping to P0 wedge

| Wedge | Track / gate |
|---|---|
| pack physics inspect | T-PHYS-U + G_PHYS |
| floor receipts | G_FLOOR (diff = receipt) |
| contract validate | G_CON |
| eval gate | paired task-success lift + CI hard spine |
| +4 delta | Ablation lifts |
| anti pretty demo | G_REAL |

---

## 15. Implementation phases

| Phase | Work | Verify |
|---|---|---|
| **0** | This design + README badge mock | Agreed task-success-lift meaning |
| **1** | Schema v1, oracles, score.mjs, poison+negative fixtures, CI tests | **DONE** |
| **2** | BASE/WITH agent runner; no oracle leak; valid machine score after actor | **DONE** — repeated/counterbalanced `run-arms.mjs` with invalid-run rejection and reproducibility manifests. Live lift remains unpublished until reviewed agent run |
| **3** | core10 scenarios (remaining 8) + report template | Fixture dry-run each oracle |
| **4** | Typed backlog + cut ceremony from OpenCode actor prompt | Failures → targets |
| **5** | CSB-Imp on golden clinic | Broken recipe fails Imp |
| **6** | Demote 28-pt rubric; `npm run bench:csb` | product_decisions G4 |
| **7** | **First published CSB lift** only after reproducible repeated paired agent run | summary.json + model/tool pins + hashes + interval |
| **8** | Ongoing: trap refresh when base-fail < 0.5 | Compound loop |

### Phase 1 guardrails (locked)

1. **G_REAL deterministic** — only predicates in `oracles/real.mjs`; no free-text traps.
2. **G_CON anti-theater** — `scoreContractGate` cross-checks answers; keyword-only recipes fail.
3. **BASE honest** — see `schema/scenario.v1.md`; never cripple BASE to inflate Δ.
4. **Schema versioned** — `schema_version: 1` required on load.
5. **No public lift from fixtures alone** — fixture summaries set `publishable: false`.

### Fairness hardening (2026-08-15, prompt revision 2)

A full harness audit (input symmetry, oracle independence, leakage, validity,
determinism, counterbalancing) plus the DeepSWE prompt lessons produced these
locked rules. Runs before this revision are not comparable to runs after it.

- **The interface belongs to both arms.** `OUTPUT_SCHEMA.md` (byte-identical per
  arm) publishes the full answers enum table and the receipt field shape. BASE
  can now fail only on judgment — floors, physics, consistency — never on
  vocabulary availability. Floor minimums, packs, and the CLI loop remain
  WITH-only; that is the measured product.
- **Prompts route, never coach.** Both prompts are short, natural-register task
  statements (DeepSWE style). The WITH prompt says the skill is installed and to
  read `SKILL.md`; it no longer inlines enum lists, channel rules, or floor
  answers. Lift therefore attributes to the skill bundle, not the prompt.
- **No arm identity disclosure.** Workspace READMEs and tmpdir labels are
  neutral; which arm is which lives only in harness-side metadata.
- **Env scrubbing for opencode actors** (`PWD`, `OLDPWD`, `CSB_*`,
  `OPENCODE_*` removed) so the harness repo path cannot leak.
- **Input symmetry is asserted in code** per trial (brief, scenario,
  `OUTPUT_SCHEMA.md`, seed hashes compared across arms) before any pair scores.
- **`reproducibility.json` and `README.md` are immutable controls** — actor
  tampering invalidates the arm.

### Critical files

- New: `evals/csb/**` (this design + oracles + score + core10)
- Spine: `src/lib/contract.mjs`, `src/lib/resolver.mjs`
- Goldens: `examples/clinic-triage/`
- Law: `product_decisions.md` §G4 / tests

---

## 16. Anti-goals (again)

- Do not score OpenCode “did the dance.”
- Do not let `agent-notes.md` recover a failed gate.
- Do not average BASE and WITH into one vanity pass rate.
- Do not use MCQ coverage as quality.
- Do not treat simulate/scaffold as evidence.
- Do not allow partial credit inside sealed fields.
- Do not leak oracles to the actor.

---

## 17. One-page “resolved” definition

A trial **resolves** iff:

1. **Physics** — pack-backed; transform/native class correct; no invented codecs
2. **Floors** — domain minima in **answers** (rewrite if poisoned), not flag-only
3. **Handoff** — stakes match transfer/callback/ticket
4. **Contract** — G5 + domain receipts; ≥1 quantified tradeoff signal
5. **P2P** — no generation resurrection; no unknown-provider synthesis
6. **(Release)** — pass^3 on regulated resolve

A skill version is **+4-positive** iff **A4 − A0** is large on physics hallucinations and floor violations — the three clauses of the product verdict — not a higher mean rubric vibe.
