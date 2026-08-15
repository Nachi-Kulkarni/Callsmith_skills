# Audit

Score an existing voice-agent design. **Do not edit** unless the user explicitly asks you to fix findings.

Facts come from packs + CLI only: `pack show`, `pack validate`, `check --answers`. Taste and gaps are your job.

## Inputs (load only what you need)

1. Brief / intent
2. Packs for the chosen stack only
3. `callsmith.recipe.md` if present
4. `voice.answers.json` + `callsmith check` if present
5. Floors: `reference/policy.md` (not vibes)

Completeness = intent clear + floors satisfied + pack-informed physics + contract written.
Not menu coverage 1.0.

## Method

1. **Facts** — run `check` when answers exist; open only relevant packs. Cite pack ids for audio/interruption claims.
2. **Scorecard** — every dimension 0–4. A 4 means another agent can implement without rediscovery.
3. **Floors** — if violated, Safety maxes at 2. State before → after rewrites (even if you only recommend them).
4. **Stop signs** — P1 blockers first. No soft landing on unknown providers or flag-only compliance.
5. **Next moves** — 2–3 concrete actions. Do not end with “what do you think?”

## Scorecard (0–4 each · total / 36)

| Dimension | What to check |
|---|---|
| Intent clarity | Caller, task, success, escalation, failure modes |
| Floor receipts | Consent / retention / handoff / tools rewritten where required — not flag-only |
| Stack taste | Latency, language, budget, region, accounts match |
| Audio contract | Transforms from packs; native normalize only when pack says so |
| Interruption | VAD, cancel, flush, clear, resume mapped per provider |
| Latency | E2E fit; cascaded TTFT risk named; digit from pack/`check` |
| Observability | Timeline isolates telephony, bridge, STT, LLM, TTS, tools, reconnect, barge-in, cost |
| Safety | Consent, PII, retention, opt-out/DNC, handoff, tool audit |
| Buildability | One contract is enough to build in order |

| Band | Meaning |
|---|---|
| 32–36 | Build-ready |
| 26–31 | Buildable; confirm 1–2 risks |
| 18–25 | Re-open design |
| &lt;18 | Not ready |

## Hard floors (Safety ≤ 2 if violated)

Floors, the handoff ladder, and the tool-integration rule are canonical in `reference/policy.md` — load it, do not score from memory or from any copy. Any floor violation caps the Safety dimension at 2, regardless of prose quality.

**Acknowledging a risk is not handling it.**

## Instant fails (call out as P1)

- Unknown provider with no pack (synthesis)
- Contract empty / missing receipt / contradicts answers
- Ticket-only handoff on urgent live stakes
- PSTN stack for pure WhatsApp voice notes (or reverse)
- Free-form policy enums (`warm_transfer`, …) instead of canonical IDs
- Latency talk with no ms or $/min digit

## Report

```markdown
## Callsmith Audit

**Score:** ??/36 — Rating
**Verdict:** Build / Reopen design / Measure TTFT / Change stack

| Dimension | Score | Finding |
|---|---:|---|
| Intent clarity | ? | … |

### Floor receipts (before → after)
- …

### Stop Signs
- [P1] …

### Strong Choices
- …

### Recommended Next Move
1. …
2. Write/update handoff contract sections …
3. Implement with framework-native APIs (agent owns codegen)
```
