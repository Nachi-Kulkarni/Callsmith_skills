# Cost

Use this playbook for `/callsmith cost` — assemble the $/min and per-call cost of a stack from pack `cost_estimates`, with each number's evidence class stated. `check` prints the summed planning allowance; this playbook turns it into a decision-grade comparison. Floors are not for sale: cost never justifies a floor override (`policy.md`).

## Method

1. **Enumerate legs from answers** — telephony per-minute (plus media-stream add-ons where the pack lists them), STT streaming duration, LLM tokens per turn, TTS characters, realtime bundled minutes, orchestrator hosting.
2. **Sum from packs** — `callsmith check` reports the summed `cost_estimates` planning allowance; per-leg numbers come from each pack, never memory or marketing pages.
3. **State assumptions** — average turns per call, average turn length, barge-in rate. A $/min without assumptions is a single point pretending to be a model.
4. **Compare candidates** — S2S bundled vs cascaded sum-of-parts at the *same* call profile; use the `/callsmith architecture` matrix's cost lens.

## Evidence classes (never blur them)

Every pack cost number is a `planning_estimate` until Callsmith or the user measures it (`verify-packs` shows which). Planning numbers are for design math and stack comparison, not contracts or budgets committed to a customer. A measured number needs its receipts (region, cohort, date) per `deploy-evidence.md` discipline.

## Drivers that move the number

- Turn length and count: LLM tokens and TTS characters scale with caller verbosity, not minutes.
- Barge-in: every interruption skips unplayed TTS — heavy barge-in cuts TTS spend below the linear model.
- Context growth: long calls grow cascaded LLM input tokens until truncation.
- Region: telephony media egress and model regions interact (`deployment.regions` matrix).
- Session limits: resumption paths restart billing legs; architecture decides this before cost does.
- Recording + retention storage is a floor consequence, not an optimization target.

## Anti-patterns

- One $/min with no per-leg breakdown and no assumptions
- Vendor marketing numbers quoted as fact (planning class at best)
- Telephony media-stream add-ons forgotten on the "same" carrier
- S2S priced at max turn length vs cascaded at min turn length in the same table
- Comparing stacks at different call profiles
- A cost model never re-run after a pack rev or pricing change
- Cost used to argue down a consent/retention/handoff floor

## Output

```markdown
## Cost Model

**Profile:** avg N turns/call, M s/turn, barge-in rate — stated
**Per-leg (from packs, planning class):**
| Leg | $/min or per-call | Source pack + evidence class |

**Total:** ≈ $X.XX/min (planning; ±30% envelope) — vs alternative stack: $Y.YY/min
**Drivers ranked:** …
**To measure before committing:** … (links to `latency` / measure runs)
```
