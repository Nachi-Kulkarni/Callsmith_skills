# Critique

Use when the user wants taste, judgment, or a second opinion on a voice-agent architecture. The goal is to make the stack feel inevitable: the easiest thing to build should also be the thing most likely to survive a real pilot.

## Method

1. **Facts pass:** load relevant packs (`pack show` / read JSON). Optionally run `callsmith check` if an answers file exists. Read the handoff contract if present.
2. **Taste pass:** ignore tooling for a moment and ask whether the architecture makes product sense for the actual caller, channel, region, language, and failure cost.
3. **Synthesize.** Do not only restate pack fields.

## Voice-agent taste tests

- Demo vs pilot vs production — different operability bars.
- Is latency honest? Cascaded must earn the extra TTFT.
- Custom FastAPI because control is needed, or because native orchestrators were never considered?
- Telephony fit for direction, region, carrier reality?
- Model/STT/TTS fit for language pattern and noisy phone audio?
- Barge-in required by behavior, or half-duplex/IVR?
- Provider accounts available today, or untestable vendors?
- Human handoff as a product flow? Urgent phone payment/medical/collections → **transfer**, not ticket.
- Consent and retention meet domain floors (rewrite, don’t only flag)?
- Booking/CRM: OpenAPI preferred, or webhook justified with a written comparison?
- One numeric tradeoff from packs or `check` (latency ms and $/min vs an alternative)?

## Anti-patterns

- “Best model” before channel and caller behavior.
- Custom bridge for a first pilot when LiveKit/Pipecat absorbs the audio burden.
- Cascaded STT+LLM+TTS for ultra-low-latency phone without measuring TTFT.
- “Multilingual” without fallback/confirmation behavior.
- Logging only transcripts; ignoring frame timing, interruption, reconnects.
- Flag-only floors on regulated domains.
- Ticket-only handoff on urgent live-call stakes.
- Webhook default for booking without OpenAPI comparison.
- Latency/cost talk without numbers.

## Output

```markdown
## Architecture Critique

**Gut verdict:** ...
**Best thing about this stack:** ...
**Biggest risk:** ...

### Taste Score
| Lens | Score / 4 | Finding |
|---|---:|---|
| Product fit | ? | ... |
| Latency honesty | ? | ... |
| Build speed | ? | ... |
| Operability | ? | ... |
| Provider/account reality | ? | ... |

### Floor receipts
- ...

### Reframe
The better question is not "..."; it is "..."

### Options
A. Keep this stack, because ...
B. Change architecture/provider, because ...
C. Run `/callsmith ttft`, because ...
```

Be opinionated. If two stacks are possible, say which you would choose for this user and why.
