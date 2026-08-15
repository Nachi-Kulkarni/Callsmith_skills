# Fairness-hardened CSB diagnostic — DeepSeek V4 Flash + GPT-5.6-Luna xhigh

Date: 2026-08-15 · Harness: prompt revision 2 + fully published interface (commit range
`73a5e5d..7d3a4b4`) · Grade: **diagnostic** (single run per scenario, runs=1).

> **Addendum (2026-08-15, post-publication standard update):** both runs recorded here
> executed their arms **in parallel** (`arm_execution: "parallel"`). The publication
> standard adopted the same day requires sequential arms — simultaneous arms share one
> model subscription, and differential throttling between them is an uncontrolled
> confound. These numbers therefore stand as single-run *diagnostics* only and would not
> be publication-eligible as run; the artifacts and scoring are unchanged.


Replaces the retracted 2026-07-31 report. Every number below is recomputable from the
retained run artifacts by deterministic oracles — no judge, no post-hoc rescoring.

## Method

Paired arms per scenario: the same actor model, brief, seed answers, budget, and
byte-identical output interface (`OUTPUT_SCHEMA.md` carries the full canonical enum
table, generated from `data/menu.json`, and a validator-true receipt example). The only
difference between arms is the Callsmith skill bundle (SKILL.md, packs, reference, CLI).
Prompts are short, natural-register, and coaching-free in both arms. Input symmetry is
asserted in code per trial; workspaces carry no arm identity; actor environments are
scrubbed of harness paths.

Actors: `codex` (GPT-5.6-Luna, reasoning xhigh, ChatGPT subscription — publication-
eligible isolation) and `opencode` (DeepSeek V4 Flash via opencode — diagnostic-grade
isolation only).

## Results

| | BASE | WITH | paired lift | 95% CI (10k bootstrap) |
|---|---:|---:|---:|---|
| DeepSeek V4 Flash — task success | 7/10 | 9/9 scored | **+0.30** | 0.00 – 0.60 |
| GPT-5.6-Luna xhigh — task success | 6/11 | 11/11 | **+0.45** | 0.18 – 0.73 |

Task success = all four deterministic gates. One DeepSeek WITH arm
(`clinic-floor-poison`) was invalidated by the actor omitting its recipe file —
correctly caught by validity gates; the pair is excluded, not scored.

Per-gate rates (BASE arm):

| Gate | DeepSeek BASE | Luna BASE | Both WITH |
|---|---:|---:|---:|
| G_REAL (reality traps) | 100% | 100% | 100% |
| G_PHYS (stack physics) | 100% | 100% | 100% |
| G_FLOOR (safety floors) | 80% | 73% | 100% |
| G_CON (contract consistency) | 70% | 55% | 100% |

## What this run says

1. **Current models are good at this unaided.** Reality traps and provider physics
   pass at 100% in every BASE arm once the output interface is honest. Older claims
   of near-total BASE failure do not reproduce.
2. **The skill's measured lift is +30pp (flash) / +45pp (Luna), entirely in floor
   completion and contract consistency** — the two layers the product exists to
   enforce. There is no physics or reality lift to claim.
3. **The frontier model gained more than the cheap one.** xhigh reasoning writes
   confident designs and still drops receipt consistency on ~half the briefs; the
   skill's verification loop is what closes that, not extra intelligence.

## What this run cannot establish

- Single run per scenario; intervals are wide. A publishable product claim requires
  ≥3 counterbalanced repetitions and a second model family on a publication-eligible
  actor (the DeepSeek/opencode arm is diagnostic-grade isolation by the repo's own rule).
- Design-artifact gates only — nothing about call quality, latency, uptime, or deployed cost.
- Arm count is small; per-scenario idiosyncrasies (e.g. `india-exotel-hinglish` failing
  floors+contract in both models' BASE arms) deserve scenario-level review before
  stronger claims.

## Artifacts

Runs (local, gitignored, retained): `evals/csb/runs/dsv4go-fair-full11-r1/`,
`evals/csb/runs/luna-fair-full11-r1/`. Each arm carries `reproducibility.json`
(model/tool/commit/budget hashes), the retained actor trace, and per-gate `score.json`.

## Failure analysis (from retained traces, 2026-08-15)

Where the 8 failing BASE arms actually went wrong, and what it says about the product:

**Floor failures are domain-inference misses, not vocabulary misses.** Both models'
BASE arms failed the same two scenarios for the same reason: the brief *implies* a
regulated domain without naming it. `india-exotel-hinglish` ("fintech … payment
failures") implies banking — both models chose `announce` consent where banking floors
require `explicit`. `whatsapp-not-pstn` ("clinic" triage) implies medical — both chose
`ticket` handoff (pattern-matching "async → ticket") where medical floors require
`transfer`, which IS achievable on a WhatsApp thread. Models under-apply domain-keyed
floors when the domain is buried in the brief; the skill's floor table is the corrective,
and this is now the cleanest single sentence for what Callsmith does.

**Contract failures split into two classes.** (1) *Enum invention*: BASE wrote
`policy.basis: "callsmith_banking"` — invented because the published receipt example
showed a single legal value (`callsmith_default`) instead of enumerating the four; this
was a real discoverability gap in the published interface and is fixed in the schema as
of 2026-08-15 (runs above predate that fix). (2) *Mirrored floor misses*: receipts that
faithfully matched below-floor answers — not a separate failure.

**The one WITH-arm failure is model variance, not skill friction.** The invalidated
`clinic-floor-poison` WITH arm (DeepSeek) rewrote `voice.answers.json` correctly, then
exited without ever invoking the verifier or writing the recipe — 1 of 20 WITH arms,
flash-tier only. The Luna WITH arms all completed the full loop. Watch: if flash-tier
models routinely stop after the answers step, the skill's "done when" needs to survive
weaker instruction-following; no change made yet on n=1.

**Verifier usage correlates with success.** Every WITH arm that ran
`callsmith contract validate` passed G_CON; the only WITH arm that skipped it failed to
produce a contract at all. The verification loop is the product's active ingredient.
