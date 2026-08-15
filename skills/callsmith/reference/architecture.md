# Architecture (S2S vs cascaded)

Kill the decision fatigue: pick realtime speech-to-speech, cascaded STT→LLM→TTS, or hybrid — with numbers — and say which one. The wrong default is the most expensive mistake in a voice build; everything else is tuning.

## When to run

- New design and the user is stuck between "Gemini Live feels like magic" and "we need control"
- `/callsmith critique` points at architecture as the risk
- Regulated brief with audit/tool duties (leans cascaded), or ultra-low-latency app voice (leans S2S)

## Method

1. **Facts** — load packs for the legs under consideration: `latency_evidence`, `cost_estimates`, `interruption`, session-limit potholes. Run `callsmith check` per candidate if answers exist. Never compare from memory.
2. **Taste** — caller, channel, language pattern, tool stakes, audit duties, team maturity.
3. **Decide** — one winner, one rejection reason, numbers for both.

## Decision matrix

| Lens | Realtime S2S | Cascaded | Winner when… |
|---|---|---|---|
| Turn gap (budget class, `latency.md`) | p50 ≤ 450 ms / p95 ≤ 700 ms class | p50 ≤ 800–1,000 ms / p95 ≤ 1,200–1,500 ms class | S2S if the budget is tighter than ~800 ms p95 |
| Language reality | strong EN/multilingual; Hinglish code-switch quality varies per model — measure on a labeled set | best-of-breed per leg (Sarvam for Indian languages, Deepgram Nova-3 telephony WER) | cascaded often wins 8 kHz Indian-language PSTN |
| Tool determinism | tool calls live inside the audio stream; harder to checkpoint and audit | text checkpoint before acting; idempotency reviewable | cascaded for booking/payment/KYC tools |
| Auditability (floors) | transcript is derived; consent/retention floors still apply | transcript exists by construction; easiest receipts | regulated → cascaded or hybrid |
| Interruption | native server VAD; per-pack flush rules (truncate/cancel accounting) | VAD + cancel + flush across legs you own | S2S for fluid barge-in conversation |
| Cost/min | bundled per-minute (from the pack's `cost_estimates`, planning class) | sum of parts from each leg's `cost_estimates`; cheap on short turns, can exceed S2S on long ones | compute both from packs, don't guess |
| Failure isolation | one vendor outage = dead agent | degrade/swap per leg | cascaded for ops maturity |
| Change velocity | prompt + config | per-leg upgrades and evals | cascaded while iterating fast |

## The hybrid pattern that actually ships

S2S owns open conversational turns; a deterministic cascaded branch (or function call → backend) owns state-changing tool turns. Declare turn-type ownership in the contract. Do not let the S2S model "also book things" without the same OpenAPI/idempotency bar as a cascaded tool.

## Noob rules (refuse to skip)

1. Regulated domain + state-changing tools → cascaded (or hybrid with a cascaded tool branch).
2. Ultra-low-latency in-app voice with light tools → realtime S2S.
3. Indian-language PSTN at 8 kHz → measure both on a labeled set; cascaded often wins WER, S2S wins flow. Decide with data, not vibes.
4. Never pick S2S because "one API is simpler" — you still own flush semantics, session duration limits, and resumption handles.
5. Never pick cascaded without a TTFT plan (`/callsmith ttft`).
6. Fallback is part of architecture: S2S down → cascaded degrade *is* hybrid. Name it, or you don't have it.
7. Session limits are architecture: a 10-minute-class session cap vs an hour-long call decides resumption design before any prompt is written.

## Output

```markdown
## Architecture Decision

**Winner:** realtime_s2s / cascaded / hybrid — one sentence
**Why not the runner-up:** …
**Numbers:** turn-gap budget class (ms) + $/min planning estimate for both options, from packs

| Lens | S2S | Cascaded | Weight in this brief |
|---|---|---|---|

### Turn-type ownership (hybrid only)
- open turns: …
- tool turns: …

### Measured follow-ups
- [ ] labeled-set WER comparison (language briefs)
- [ ] TTFT pilot (cascaded)

### Contract changes required?
no / yes — sections: …
```

One winner. No ties. If you cannot decide, the missing input is a measurement — name it under "Measured follow-ups" and pick the safer default per the noob rules.
