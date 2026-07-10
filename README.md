# callsmith

**Teaches coding agents to design production voice agents — and verifies facts the agent must not invent.**

> The agent compiles. callsmith validates the physics, floors, and eval bar.

**Constitution:** [`product_decisions.md`](./product_decisions.md) — sole product law.

Not a scaffold factory. Not a hosted voice runtime. Not “another build-a-bot prompt.”
A skill + provider-pack standard library + floor policy + eval bar.

## Why callsmith?

Every voice-agent tutorial starts with the model. Skip the audio bridge and you get the same failures: μ-law decode crashes, barge-in that doesn't fire, echo loops, resampling artifacts, WebSocket frames that split mid-syllable.

The hard part is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM 16/24 kHz), turn/interruption lifecycle, barge-in, echo ownership, and per-provider streaming quirks — plus regulated floors (consent, retention, handoff).

callsmith encodes provider reality as **packs**, product taste as **floors**, and design quality as **evals**. The coding agent owns dialogue, stack choice, and implementation.

### The +4 delta

> My agent no longer hallucinates voice-stack physics, skips consent/handoff floors, or ships a pretty demo that fails on PSTN reality.

### Product wedge

> **pack physics inspect + floor receipts + contract validate + eval gate**

### callsmith is

| Layer | Role |
|---|---|
| **Skill** (`SKILL.md` + playbooks) | How the agent compiles: dig deeper, apply floors, write a handoff contract, implement |
| **Provider packs** (21) | Stdlib of audio formats, interruption, potholes, env keys |
| **Floors** | Rewrite (not only flag) consent / retention / handoff / tools by domain |
| **Evals** | Binary design-quality bar |
| **Thin verification** | Pack validate / physics check / doctor |

### callsmith is not

- Framework scaffold generator
- 22-group MCQ coverage law
- Fake-call simulator as production proof
- Dynamic “unknown provider” synthesis
- Byte-identical lockfiles as identity

## Install

**As an agent skill (primary):**

```bash
npx skills add Nachi-Kulkarni/Callsmith_skills
```

Then invoke `/callsmith` in Claude Code, Cursor, Codex, Copilot, Gemini CLI, or OpenCode.

**Optional verification CLI:**

```bash
curl -fsSL https://raw.githubusercontent.com/Nachi-Kulkarni/Callsmith_skills/main/install-callsmith.sh | bash
# or: npm install -g github:Nachi-Kulkarni/Callsmith_skills
```

## Quick start

1. Install the skill.
2. Tell your agent what voice agent you want.
3. Agent digs deeper, loads provider packs, **rewrites** floor violations, writes a short **handoff contract**.
4. Agent implements against that contract + pack facts.
5. Optional: `callsmith pack validate` / `check` / `contract validate` / eval scenarios.

Example contract: [`examples/clinic-triage/`](./examples/clinic-triage/). Its versioned machine-readable receipt is documented in [`reference/contract.md`](./reference/contract.md); prose alone cannot satisfy policy floors.

Playbooks: `/callsmith audit` · `critique` · `latency` · `harden` — with `ttft` retained only to isolate the LLM submetric. See `reference/`.

## A five-minute first win

Start with a familiar failure: a clinic phone-agent draft says “consent matters,” but its machine choices still say no consent, short retention, and ticket-only escalation. It also assumes every audio hop is compatible.

```json
{
  "surface": "inbound_pstn",
  "recording_consent": "none",
  "transcript_retention": "seven_days",
  "human_handoff": "ticket"
}
```

Give the brief to an agent with Callsmith. It loads only the chosen provider packs, rewrites unsafe choices, checks the audio path, and produces the [clinic example](./examples/clinic-triage/) with this reviewable receipt:

```json
{
  "domain": "medical",
  "recording_consent": "announce",
  "transcript_retention": "thirty_days",
  "human_handoff": "transfer",
  "turn_gap_p95_target_ms": 900
}
```

That abbreviated view comes from the full `json callsmith-contract` block. Verify the actual artifacts:

```bash
node bin/callsmith.mjs check --answers examples/clinic-triage/voice.answers.json
node bin/callsmith.mjs contract validate --file examples/clinic-triage/callsmith.recipe.md --domain medical
```

The irreversible value is the trail: commit the answers and contract with the implementation, review receipt diffs, and run the same checks in CI. The next agent inherits decisions and evidence instead of reconstructing them from chat. See [`reference/workflow.md`](./reference/workflow.md).

### Why packs matter

**Exotel + custom FastAPI + Gemini Live** → often 4 transforms.
**Exotel + LiveKit + Gemini Live** → often 0 transforms (SIP absorbs bridge).

That difference lives in packs — not in agent imagination.

## Supported providers

| Layer | Providers |
|-------|-----------|
| Telephony | Exotel, Twilio, Plivo, Telnyx, Vonage |
| Orchestration | LiveKit, Pipecat, Custom FastAPI |
| Realtime S2S | Gemini Live, OpenAI Realtime |
| STT | Deepgram (Nova-3), AssemblyAI |
| LLM | OpenAI, Anthropic, Google |
| TTS | ElevenLabs, Cartesia, Sarvam |
| VAD | Silero VAD, Deepgram Endpointing, WebRTC VAD |

Add a provider by dropping a validated JSON pack into `providers/`. **Unknown providers are not auto-synthesized.**

## Commands

### Skill playbooks (primary)

| Command | What it does |
|---------|-------------|
| `/callsmith` | Dig deeper → floors → pack-informed contract → implement |
| `/callsmith audit` | Readiness scorecard |
| `/callsmith critique` | Opinionated architecture critique |
| `/callsmith latency` | Optimize user speech-end → first audible audio with a full turn trace |
| `/callsmith ttft` | Diagnose the LLM first-token submetric only |
| `/callsmith harden` | Production-readiness pass |

### Verification CLI

| Command | What it does |
|---------|-------------|
| `callsmith packs` | List provider packs |
| `callsmith pack show <id>` | Dump one pack |
| `callsmith pack validate` | Schema-validate packs |
| `callsmith verify-packs` | Evidence provenance/date/expiry guard (not live source-content verification) |
| `callsmith check --answers f` | Physics report (transforms, blockers, latency, cost) |
| `callsmith contract validate --file f` | Handoff contract G5 + structured policy/provider/latency receipt |
| `callsmith doctor` | Install + pack health |

Generation commands (`init`, `forge`, `scaffold`, `simulate`, `intake`, …) are **removed** (exit 2).

## Anti-patterns

- Inventing audio formats or barge-in without a pack
- Flagging consent/handoff risk without rewriting the design
- Shipping webhook tools for booking/CRM without an OpenAPI comparison
- Treating WebSocket close and telephony hangup as the same event
- Assuming orchestration always normalizes telephony audio
- Using dynamic “UNVERIFIED provider” synthesis
- Treating scaffold green as PSTN-ready

## Docs

| Doc | Role |
|-----|------|
| [`product_decisions.md`](./product_decisions.md) | **Constitution** (sole forward law) |
| [`product.md`](./product.md) | +4 / irreversibility companion |
| [`subtraction.md`](./subtraction.md) | Completed cut map |
| [`SKILL.md`](./SKILL.md) | Agent compile procedure |
| [`reference/policy.md`](./reference/policy.md) | Canonical IDs, channel rules, and conservative product floors |
| [`reference/contract.md`](./reference/contract.md) | Structured receipt schema and explicit-risk override |
| [`reference/latency.md`](./reference/latency.md) | Turn Gap instrumentation, attribution, budgets, and experiment loop |
| [`reference/workflow.md`](./reference/workflow.md) | Committed artifacts, CI gate, and thin runtime adapters |

## License

MIT
