# Harden

Use after a handoff contract exists and before implementation is treated as production-ready. Focus: real-call behavior — timing, state, resilience, safety, operator workflows.

If a finding changes architecture, **rewrite the handoff contract** and re-run `callsmith check`. Do not invent a generator path.

## Required reads

1. Handoff contract (`callsmith.recipe.md` or equivalent)
2. Packs for every provider in the stack
3. Optional `callsmith check` (transforms, blockers, latency, cost)
4. Floors: `reference/policy.md`

There is no generated `.callsmith/context/*` empire and no scaffold to patch.

## Checklist

### Media & turns

- [ ] Frames reassembled by **byte budget**, not WebSocket message boundary
- [ ] Every pack-implied transform has a unit/fake-frame test in the *project*
- [ ] Barge-in: cancel model + stop TTS + clear telephony playback + resume listen
- [ ] Silence, voicemail, DTMF, hangup, reconnect, 429/5xx, tool timeout are **explicit states**
- [ ] One state machine for telephony hangup **and** WebSocket close

### Tools & handoff

- [ ] Tool calls: idempotent, timeout-bound, retry-aware, safe to describe to the caller
- [ ] Transfer physics named per provider pack: warm (second leg + conference) vs blind (REFER / redirect / Connect flow); who owns the caller leg while the human answers
- [ ] Consent/disclosure before transfer; hold treatment is an explicit state, not dead air
- [ ] Transfer failure path: no-answer / busy → callback or voicemail, recorded in the contract — a failed transfer with no fallback strands the caller
- [ ] Human handoff includes summary, caller identity, reason, failed self-service path — injected into the human leg, not just logged
- [ ] Urgent stakes → transfer (not ticket-only)
- [ ] Tools path matches reality (OpenAPI vs webhook justified)

### Safety & floors

- [ ] PII redaction, consent, transcript retention, opt-out/DNC for phone flows
- [ ] Domain floors met (collections → explicit + ≥ 90d; banking → explicit + ≥ 30d; medical → ≥ announce + retention explicit)
- [ ] Consent/handoff present in **runtime paths**, not only docs

### Operability

- [ ] Logs isolate: inbound audio, post-transcode, STT final, LLM first token, TTS first audio, outbound, interruption, reconnect, cost
- [ ] Local PSTN testing has a repeatable tunnel/webhook setup

## Output

```markdown
## Hardening Plan

### Must Fix Before Pilot
- …

### Should Fix Before Production
- …

### Tests To Add (in the project)
- …

### Observability To Add
- …

### Contract changes required?
no / yes — sections: …
```

Prioritize **Must Fix** only if a real pilot would fail or harm a caller without it. Everything else is production polish.
