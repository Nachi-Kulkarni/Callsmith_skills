# Harden

Use after a handoff contract exists and before implementation is treated as production-ready. Focus: real-call behavior — timing, state, resilience, safety, operator workflows.

## Required reads

1. Handoff contract (`callsmith.recipe.md` or equivalent)
2. Packs for every provider in the stack
3. Optional `callsmith check` output (transforms, blockers, latency, cost)
4. `SKILL.md` hard floors

There is no generated `.callsmith/context/*` empire and no scaffold to patch.

## Hardening checklist

- Audio frames reassembled by byte budget, not WebSocket message boundary.
- Every transform implied by packs has a unit test or fake-frame test in the *project* (agent-written).
- Barge-in cancels model output, stops TTS, clears telephony playback, resumes listening.
- Silence, voicemail, DTMF, hangup, reconnect, provider 429/5xx, and tool timeout are explicit states.
- Tool calls are idempotent, timeout-bound, retry-aware, and safe to describe to the caller.
- Human handoff includes summary, caller identity, reason, and failed self-service path.
- Observability logs separate inbound audio, post-transcode audio, STT final, LLM first token, TTS first audio, outbound audio, interruption, reconnect, and cost.
- PII redaction, consent, transcript retention, and opt-out/DNC active for phone flows.
- Domain floors met (collections → explicit consent + ≥ 90d retention; banking → explicit + ≥ 30d; medical → ≥ announce with retention explicit).
- Urgent stakes use transfer handoff with summary + reason.
- Tool path matches integration reality (OpenAPI vs webhook justified).
- Local PSTN testing has a repeatable tunnel/webhook setup.

## Output

```markdown
## Hardening Plan

### Must Fix Before Pilot
- ...

### Should Fix Before Production
- ...

### Tests To Add (in the project)
- ...

### Observability To Add
- ...
```

If a finding changes architecture, rewrite the handoff contract and re-check physics from packs. Do not invent a second generator path.
