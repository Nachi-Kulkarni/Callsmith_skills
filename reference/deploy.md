# Deploy

Choose where the voice agent runs and prove it survives real operations. Use after a handoff contract exists and before any pilot with real callers.

Cloud vs self-host is not a vibe — it is physics: who owns the media edge, who drains in-flight calls on deploy, which region the worker sits in, and how many calls one process can carry before VAD contention shows up as endpointing jitter.

Agent ritual — not a generator. callsmith does not write Dockerfiles, Terraform, or CI. You do, informed by packs.

## When to run

- The contract exists, implementation has started, and "where does this run?" is still open
- The user asks LiveKit Cloud vs self-host, Pipecat Cloud vs Fly/VM, or "just put it on Railway"
- Before any pilot with real callers

## Required reads

1. Handoff contract + `voice.answers.json`
2. Packs for the chosen orchestration + telephony + VAD + realtime/STT/TTS legs — read their structured `deployment.regions` fields and potholes, not your memory
3. `callsmith check --answers …` — the **Operations** section (requested vs effective hosting, adjustments, responsibilities)
4. Floors: `reference/policy.md` — regulated domains add residency duties (below)

## The first question: managed or self-host?

| Stack | Managed path | Self-host path | Pilot default |
|---|---|---|---|
| `livekit` | LiveKit Cloud managed agents (`lk agent create`, platform scaling + drain, region pinning, hosted SIP) | LiveKit server (free) + your own workers; you own SFU, TURN, SIP bridge, drain | **Cloud** until cost or residency forces self-host |
| `pipecat` | Pipecat Cloud hosted bot runners | VM/Fly bot runner, typically bot-per-process | **Cloud** for pilot; self-host when per-minute math wins |
| `custom_fastapi` | none — a "managed" claim here is theater | you own everything | Refuse the managed framing |

Rules of thumb:

- Pilot + no ops engineer → managed cloud. Do not self-host LiveKit "to learn."
- Regulated / residency-bound briefs (e.g. India PSTN + medical) → pin regions or self-host, and record residency in the contract receipt.
- Break-even math uses pack per-minute costs + an infra estimate, labeled a planning estimate. Never present it as a quote.

## Ten deployment decisions

1. **Compute model** — worker pool multiplexing (LiveKit agent worker carries many calls) vs bot-per-process (typical self-hosted Pipecat) vs custom. Where does VAD run, and on whose CPU?
2. **Concurrency & autoscaling** — scale on *concurrent calls*, not CPU. Cap calls per worker before Silero/ONNX thread contention appears as endpointing jitter.
3. **Drain** — SIGTERM → stop dispatch → finish in-flight calls → exit. Platform-managed (cloud) or user-implemented (self-host) — never "restart and drop callers." Killing a process mid-call is the #1 first-production incident.
4. **Cold start & warm pools** — one shared Silero ONNX session per worker (never per call/frame), pre-warmed at startup; warm STT/TTS/LLM connections; measure cold and warm cohorts separately.
5. **Region physics** — compare media edge, worker, model, recording, and transcript locations. Unknown is advisory without a stated floor and blocking when an approved organizational requirement names a region.
6. **Telephony/SIP ownership** — who provisions trunk, numbers, dispatch rules. A managed agent cloud does **not** configure your Twilio/Exotel trunk for you.
7. **Secrets inventory** — collect `env_keys` from every selected pack into a checklist; secrets manager, never the repo.
8. **Load balancer / WebSocket reality** — idle timeouts above max call duration, sticky sessions, one state machine for WS close **and** hangup (already canon).
9. **Observability in production** — turn traces per `reference/latency.md`; alert on p95 turn gap, `audio_underruns`, `false_interruption`; a cost/min dashboard.
10. **Cost ceiling & break-even** — $/min from packs + infra cost; write the number where self-host beats cloud, or admit you don't know yet and defer.

## Floors tie-in (residency)

When an approved organizational contract states a residency region, the receipt names compute, telephony/media edge, model endpoint, recording, and transcript locations. The resolver performs technical compatibility only and fails closed on unknown or incompatible legs; counsel/compliance owns the legal conclusion. A `whatsapp_voice` async design carries no PSTN-region assumptions.

## Anti-patterns (match-and-refuse)

- Single-process "prod" with no drain
- VAD model reloaded per call or per frame — shared ONNX session or nothing
- Worker region ≠ telephony POP ("staging was fine")
- WebSocket LB with a 60 s idle timeout on 30-minute calls
- Secrets in the repo; no `env_keys` audit
- "Serverless" trusted without a measured cold start
- Self-hosted LiveKit for a two-week pilot with no ops capacity
- Managed-cloud claims on a custom FastAPI bridge
- Autoscaling on CPU while VAD/endpointing degrades at high concurrency

## Output

```markdown
## Deployment Plan

**Target:** livekit-cloud / pipecat-cloud / self-host (vm | fly | k8s) — one sentence why
**Hosting model:** requested → effective (from `callsmith check` Operations)
**Region:** worker / telephony POP / model endpoint / transcript storage

### Ten decisions
| # | Decision | Choice | Pack / source |
|---|---|---|---|
| 1 | Compute model | … | livekit.deployment |
| … | | | |

### Floor receipts (residency/consent — regulated only)
- …

### Must fix before pilot
- …

### Later (production polish)
- …

### Contract changes required?
no / yes — sections: …
```

Be opinionated. Pick one target, and name the rejection reason for the other. Do not end with "it depends."
