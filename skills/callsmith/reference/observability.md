# Monitor

Use this playbook for `/callsmith monitor` — production observability for a deployed voice agent. The receipt in `callsmith.recipe.md` made promises (a percentile `turn_gap_ms` SLO, floors, a handoff path); this playbook watches them. `deploy` covers rollout; `latency` covers measurement mechanics.

## What is watched (and only this)

| Signal | Source | Alert when |
|---|---|---|
| Turn-gap p95 vs receipt SLO | spans per leg (`turn-trace.v2.schema.json` fields) | SLO breached for a sustained window, not a single call |
| Consent-before-capture | counter at the capture boundary | any violation — this is a floor, page immediately |
| Handoff failure + fallback rate | transfer API result + fallback activation | fallback fires above the contract's stated rate |
| DTMF masking violations | redaction fixture on live transcripts (`security.md`) | any PAN in any store — page immediately |
| Retention deletion job | job receipt per retention ID | a scheduled deletion does not run and prove it ran |
| Barge-in / false-interruption rate | VAD + interruption events | step-change vs baseline (echo or prompt regression) |
| Reconnects, WS-close-without-hangup, session-limit resumptions | session state machine events | above baseline |
| Per-leg error budget | STT / LLM / TTS / telephony error counters | budget burn, per leg, not blended |

Floors page immediately; latency degrades gracefully. A fleet-average turn gap that hides the p95 tail is the first anti-pattern this playbook exists to kill.

## Spans, not vibes

Every call emits the leg boundaries the v2 trace schema already names (speech end, provider first output, playback). One dashboard row per leg; the receipt's SLO is computed from these spans, not from a separate stopwatch. If a leg cannot emit its boundary, that is a finding — name it and fix the instrumentation before trusting the SLO.

## Per-language cohorts

Mirrors `multilingual.md`: turn gap and error rates reported per language cohort with sample counts. A blended "98% healthy" on 95% English calls masks the failing cohort.

## Pack drift

Monitoring assumes the pack physics still hold. When a provider revs a model, limit, or codec path: check the pack's `verification.expires_at` and the provider changelog, re-run the measurement track and the conversation suite, then re-baseline the SLO. Never silently absorb a provider change into an SLO that was set against the old leg (see `MAINTENANCE.md`).

## Logging discipline

Every new telemetry surface sits downstream of the `security.md` redaction boundary: no raw audio, PANs, or PII in metrics labels or log fields. A dashboard is a persistence point — enumerate it like any other store.

## Anti-patterns

- Mean or fleet-average latency as the headline while p95 burns
- Consent, masking, or deletion "verified" by sampling instead of counters
- One blended health metric across legs, languages, or call types
- Dashboards without per-leg spans — attribution impossible when something degrades
- Treating the provider status page as your monitoring
- New telemetry that bypasses the redaction boundary
- An SLO quietly re-set after a provider rev, with no re-measurement

## Output

```markdown
## Monitoring Plan

**SLO:** turn-gap p95 ≤ N ms (receipt basis), window, budget
**Floor alerts:** consent-before-capture / masking / deletion-job — page targets
**Spans:** per-leg boundaries instrumented — missing ones named
**Cohorts:** per-language / per-call-type splits with counts
**Dashboards to add (in the project):** …

### Contract changes required?
no / yes — sections: …
```
