# Critique

Second opinion on architecture. Goal: the easiest stack to build should also be the one most likely to survive a real pilot.

**Be opinionated.** If two stacks are possible, pick one for this user and say why. Do not only restate pack fields.

## Method

1. **Facts** — load relevant packs (`pack show` / JSON). Run `callsmith check` if answers exist. Read the handoff contract if present.
2. **Taste** — ignore tooling for a moment: does this fit the actual caller, channel, region, language, and failure cost?
3. **Synthesize** — gut verdict + one reframe + ranked options. Always name a preferred option.

## Taste tests

- Demo vs pilot vs production — different operability bars
- Latency honest? Cascaded must earn the extra TTFT
- Custom FastAPI because control is needed, or because LiveKit/Pipecat were never considered?
- Telephony fit for direction, region, carrier reality?
- Model/STT/TTS fit for language pattern and noisy phone audio?
- Barge-in required by behavior, or half-duplex/IVR?
- Provider accounts available *today*, or untestable vendors?
- Human handoff as a product flow? Urgent phone payment/medical/collections → **transfer**, not ticket
- Consent and retention meet domain floors (rewrite, don’t only flag)?
- Booking/CRM: OpenAPI preferred, or webhook justified with a written comparison?
- One numeric tradeoff from packs or `check` (latency ms and $/min vs an alternative)?

## Anti-patterns (match-and-refuse)

- “Best model” before channel and caller behavior
- Custom bridge for a first pilot when LiveKit/Pipecat absorbs the audio burden
- Cascaded STT+LLM+TTS for ultra-low-latency phone without measuring TTFT
- “Multilingual” without fallback/confirmation behavior
- Logging only transcripts; ignoring frame timing, interruption, reconnects
- Flag-only floors on regulated domains
- Ticket-only handoff on urgent live-call stakes
- Webhook default for booking without OpenAPI comparison
- Latency/cost talk without numbers

## Output

```markdown
## Architecture Critique

**Gut verdict:** …
**Best thing about this stack:** …
**Biggest risk:** …
**I would ship:** <one stack sentence>

### Taste Score
Anchor each lens before scoring: **0** = actively harmful choice, **1** = works but a named alternative is strictly better, **2** = defensible with known tradeoffs, **3** = right call, one residual risk named, **4** = right call and the tradeoff is quantified from packs/`check`. A 4 requires a digit (ms or $/min); no digit, no 4.

| Lens | Score / 4 | Finding |
|---|---:|---|
| Product fit | ? | … |
| Latency honesty | ? | … |
| Build speed | ? | … |
| Operability | ? | … |
| Provider/account reality | ? | … |

### Floor receipts
- …

### Reframe
The better question is not "…"; it is "…"

### Options
A. Keep this stack, because …  ← pick or reject
B. Change architecture/provider, because …
C. Run `/callsmith latency` or `/callsmith ttft`, because …
```

End by naming **A, B, or C** as the move you would take next. No tie.
