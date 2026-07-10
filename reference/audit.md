# Audit

Run a voice-agent quality audit. This is an agentic critique, not a CLI detector.

Use the verification CLI only for facts: pack show, pack validate, and `check` physics.

## Inputs

Read only what the audit needs:

1. User brief / intent (conversation or notes).
2. Provider packs for the chosen stack (`providers/**` or `callsmith pack show <id>`).
3. Handoff contract if present (`callsmith.recipe.md` or equivalent).
4. Optional `voice.answers.json` + `callsmith check --answers …` for latency/cost/transforms.
5. Floors from `SKILL.md`.

Completeness = intent clear + floors satisfied + pack-informed physics + contract written.
Not menu coverage 1.0.

## Scorecard

Score each dimension 0–4. A 4 means another coding agent can implement without rediscovery.

| Dimension | What to check |
|---|---|
| Intent clarity | Caller type, task, success criteria, escalation, failure modes |
| Floor receipts | Consent / retention / handoff / tools rewritten where required; not flag-only |
| Stack taste | Providers match latency, language, budget, region, accounts |
| Audio contract | Transforms explicit from packs; native normalization trusted only when pack says so |
| Interruption | VAD, cancel, flush, clear, resume mapped per provider |
| Latency | End-to-end estimate fits use case; cascaded LLM TTFT risk called out |
| Observability | Timeline logs isolate telephony, bridge, STT, LLM, TTS, tools, reconnects, interruption, cost |
| Safety | Consent, PII, retention, opt-out/DNC, human handoff, tool audit logging |
| Buildability | One handoff contract is enough for a coding agent to build in order |

Total score: `sum / 36`.

Rating bands:

- `32–36` Excellent: build-ready
- `26–31` Good: buildable, one or two risks to confirm
- `18–25` Risky: re-open design before implement
- `<18` Not ready

## Audit rules

- Prefer pack-backed claims over vibes.
- Unknown providers: research / write pack / block ship — never synthesize.
- For phone agents, under-specifying country/carrier/direction is a real blocker.
- For Hinglish / code-mixed calls, verify STT/TTS support from packs.
- Cite actual latency ms and $/min from `check` or pack estimates; include one quantified alternative.

## Hard floors (Safety cannot score above 2 if violated)

| Domain signals | Min consent | Min retention |
|---|---|---|
| Medical / clinical / pharmacy / health | ≥ announce (prefer explicit) | Explicitly set; typically ≥ 30d |
| Banking / payment / KYC / UPI / lending | explicit | ≥ 30d |
| Collections / debt / recovery | explicit | ≥ 90d |
| Legal | ≥ announce | ≥ 90d |
| Insurance / FNOL | ≥ announce | ≥ 90d |
| Government / benefits | ≥ announce | ≥ 30d |

| Stakes | Min handoff |
|---|---|
| Urgent medical, payment failure, collections dispute, fraud | transfer |
| Non-urgent lead-gen | callback or ticket |
| Async-only channels | ticket |

| Integration | Tools rule |
|---|---|
| Booking / CRM / ERP | Prefer OpenAPI; webhook needs written comparison |
| Collections promise-to-pay | Durable write required |

**Acknowledging a risk is not handling it.** Rewrite the design (or record explicit legal-risk acceptance).

## Report

```markdown
## Callsmith Audit

**Score:** ??/36 — Rating
**Verdict:** Build / Reopen design / Measure TTFT / Change stack

| Dimension | Score | Finding |
|---|---:|---|
| Intent clarity | ? | ... |

### Floor receipts (before → after)
- ...

### Stop Signs
- [P1] ...

### Strong Choices
- ...

### Recommended Next Move
1. ...
2. Write/update handoff contract sections …
3. Implement with framework-native APIs (agent owns codegen)
```

End with 2–3 concrete next moves. Do not ask an open-ended “what do you think?” after a serious audit.
