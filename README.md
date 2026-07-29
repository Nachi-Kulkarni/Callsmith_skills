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

### Same brief. Same model. Different artifact.

In a repeated live CallsmithBench diagnostic, Grok-4.5 received the same voice-agent briefs, budget,
and output schema with and without Callsmith.

| Valid paired result | BASE | WITH |
|---|---:|---:|
| Complete task success | 10.3% (3/29) | 100% (29/29) |
| Floor gate | 62.1% | 100% |
| Physics gate | 10.3% | 100% |
| Contract gate | 10.3% | 100% |
| Reality gate | 48.3% | 100% |

That is a **+89.7 percentage-point diagnostic lift** (95% paired-bootstrap interval: +75.9 to
+100.0 points). It is not yet Callsmith's release claim: one of 30 scheduled WITH arms failed to
write its answers artifact, and the two-family replication is still outstanding.

The useful part is visible in the receipts:

- **Clinic:** BASE kept an invalid 90-day retention value, a weak handoff, an unknown TTS provider,
  and a malformed contract. WITH rewrote the floors, selected known packs, and produced a contract
  that passed all four gates.
- **Exotel:** BASE described the bridge but failed the custom-transform physics and structured
  contract checks. WITH made the bridge ownership and transforms reviewable and passed all gates.
- **WhatsApp:** BASE treated an asynchronous medical voice-note workflow inconsistently. WITH
  removed the PSTN stack, disabled live barge-in, and bound escalation and retention into the receipt.

Three pairs showed no lift because BASE already passed. WITH also took 58.1 seconds at the median,
versus 54.0 seconds for BASE. The invalid arm stays in the record; it will not be selectively replaced.

See the [diagnostic report](./evidence/diagnostics/grok-core10-20260712.md),
[publication standard](./evidence/README.md), and [Honest Numbers](./evidence/HONEST-NUMBERS.md).

Operational evidence is a separate track. Callsmith now ships a hashed 20-clip licensed corpus,
provider-adapter measurement boundary, structured region/residency checks, and a real SIGTERM drain
gate. No provider latency number is published yet: the three live pilots still require provider
credentials, spend approval, retained raw traces, sanitization, and review.

#### What CallsmithBench actually does

CallsmithBench gives the same coding model the same realistic voice-agent brief twice. BASE receives
the repository, output schema, and normal model knowledge. WITH receives those exact inputs plus
Callsmith's skill, provider packs, floors, and validators. Both arms must write final artifacts—not
just explain what they would build.

Independent deterministic scorers then read `voice.answers.json` and the structured handoff contract:

| Gate | What it checks |
|---|---|
| **G_FLOOR** | Consent, retention, and human handoff meet the scenario's minimum floor |
| **G_PHYS** | Surfaces, providers, audio formats, transforms, and interruption ownership are compatible |
| **G_CON** | The machine-readable contract is complete and agrees with the final answers |
| **G_REAL** | Hard traps are avoided: invented providers, PSTN assumptions on WhatsApp, unsafe ticket-only escalation, and deleted generators |

The scenarios include medical clinics, Exotel custom bridges, WhatsApp voice notes, unknown providers,
and orchestration paths where native media handling changes the required transforms. This is
**real-agent, real-repository, final-artifact evidence**. It measures design correctness before
implementation; it does not claim production call quality, uptime, or real-user task completion.

### Product wedge

> **pack physics inspect + floor receipts + contract validate + eval gate**

### callsmith is

| Layer | Role |
|---|---|
| **Skill + playbooks** (`SKILL.md` + `reference/`) | How the agent compiles; `/callsmith deploy` adds a concise capacity workflow that prevents false ceilings |
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

### One repository link — complete plugin

Paste this repository into your client's marketplace/plugin installer:

```text
https://github.com/Nachi-Kulkarni/Callsmith_skills
```

That installation includes the Callsmith skill, provider packs, policy and contract references,
verification CLI source, examples, evidence documentation, and Context7 MCP configuration.

**Codex app:** open **Plugins → Add marketplace**, paste the repository link, install **Callsmith**,
then start a new task.

**Codex CLI:**

```bash
codex plugin marketplace add Nachi-Kulkarni/Callsmith_skills
codex plugin add callsmith@callsmith-marketplace
```

**Claude Code:**

```text
/plugin marketplace add Nachi-Kulkarni/Callsmith_skills
/plugin install callsmith@callsmith-marketplace
```

**Grok Build:**

```bash
grok plugin install Nachi-Kulkarni/Callsmith_skills
```

**Cursor:** install from the Cursor Plugin Marketplace when listed, or add this repository as a
custom plugin source. The native manifest lives at `.cursor-plugin/plugin.json`.

**Kimi Code:**

```text
/plugins install https://github.com/Nachi-Kulkarni/Callsmith_skills
/reload
```

Or browse the repository catalog with `/plugins marketplace` and the raw
`.kimi-plugin/marketplace.json` URL.

**Devin CLI:**

```bash
devin plugins install Nachi-Kulkarni/Callsmith_skills
```

**OpenCode:** add the Git repository package to `opencode.json`, then restart OpenCode:

```json
{
  "plugin": [
    "callsmith@git+https://github.com/Nachi-Kulkarni/Callsmith_skills.git"
  ]
}
```

The OpenCode plugin registers the Callsmith skill directory and Context7 MCP without overwriting an
existing user-configured `context7` server.

**Pi:**

```bash
pi install git:github.com/Nachi-Kulkarni/Callsmith_skills
```

**Antigravity:**

```bash
agy plugin install https://github.com/Nachi-Kulkarni/Callsmith_skills
```

All native installers use this repository as the product root. Start a new session—or run the
client's reload command—after installation.

### Skill-only install

```bash
npx skills add Nachi-Kulkarni/Callsmith_skills
```

Then invoke `/callsmith` in Claude Code, Cursor, Codex, Copilot, Gemini CLI, or OpenCode. The
skill-only route may not install Context7 automatically; run `npx ctx7 setup` when needed.

### Current provider documentation

Callsmith ships dated provider packs so every decision remains reviewable, but voice SDKs and APIs
change faster than a release. For version-specific implementation docs, install Context7 once:

```bash
npx ctx7 setup
```

Choose MCP mode when your client supports it, or CLI + Skills mode when it does not. This repository
also includes a project-level [`.mcp.json`](./.mcp.json) using Context7's stdio package, which works
in unattended Grok sessions without an OAuth prompt. An API key is optional but recommended by
Context7 for higher rate limits.

Callsmith still works without Context7. The agent must fall back to official provider documentation
through whatever web-fetch/browse capability is available, record the source URL, source date when
available, and access date, and refuse to invent an API when neither source is available. Expired
pack evidence, changed SDK versions, and volatile facts such as model names, API shapes, regions,
pricing, and audio behavior trigger a fresh lookup.
See [current-documentation policy](./reference/current-docs.md).

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

Playbooks: `/callsmith audit` · `critique` · `architecture` · `latency` · `ttft` · `prompts` · `harden` · `deploy`. See `reference/`.

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
node bin/callsmith.mjs contract validate --file examples/clinic-triage/callsmith.recipe.md --answers examples/clinic-triage/voice.answers.json --domain medical
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
| `/callsmith architecture` | S2S vs cascaded vs hybrid — decided with pack numbers, no ties |
| `/callsmith latency` | Optimize user speech-end → first audible audio with a full turn trace |
| `/callsmith ttft` | Diagnose the LLM first-token submetric only |
| `/callsmith prompts` | Write or review the production runtime prompt |
| `/callsmith harden` | Production-readiness pass |
| `/callsmith deploy` | Cloud vs self-host, drain, regions, warm pools, concurrency, break-even, load-test architecture, and capacity proof |

### Verification CLI

| Command | What it does |
|---------|-------------|
| `callsmith packs` | List provider packs |
| `callsmith pack show <id>` | Dump one pack |
| `callsmith pack validate` | Schema-validate packs |
| `callsmith verify-packs` | Evidence provenance/date/expiry guard (not live source-content verification) |
| `callsmith check --answers f` | Physics report (transforms, blockers, latency, cost) |
| `callsmith contract validate --file f --answers a` | Handoff contract G5 + structured policy/provider/latency receipt + answers consistency |
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
| [`reference/prompts.md`](./reference/prompts.md) | Production runtime-prompt writing and review |
| [`reference/architecture.md`](./reference/architecture.md) | S2S vs cascaded vs hybrid decision matrix |
| [`reference/deploy.md`](./reference/deploy.md) | Cloud vs self-host deployment physics: drain, regions, warm pools, concurrency |
| [`reference/deploy-capacity.md`](./reference/deploy-capacity.md) | `/callsmith deploy` capacity workflow; routes to workload or evidence detail only when needed |
| [`reference/workflow.md`](./reference/workflow.md) | Committed artifacts, CI gate, and thin runtime adapters |

## License

MIT
