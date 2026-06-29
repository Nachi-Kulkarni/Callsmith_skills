# callsmith

A recipe compiler for voice AI agents. 21 provider packs, 22 menu groups, and a deterministic audio-contract resolver that catches the telephony potholes before you write a line of code.

> **Quick start:** `curl -fsSL https://raw.githubusercontent.com/Nachi-Kulkarni/Callsmith_skills/main/install-callsmith.sh | bash`, then `callsmith init`.

## Why callsmith?

Every voice-agent tutorial starts with the model. Skip the audio bridge and you get the same handful of failures on every project: μ-law decode crashes, barge-in that doesn't fire, echo loops at runtime, resampling artifacts, and WebSocket frames that split mid-syllable.

The hard part of a voice agent is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM 16/24 kHz), turn/interruption lifecycle, barge-in, echo/noise cleanup ownership, and per-provider streaming quirks.

callsmith encodes that knowledge as data and resolves it deterministically.

### callsmith adds:

- **One intake flow.** `callsmith init` (or `callsmith spec`) walks a 22-group MCQ and writes a complete handoff packet. No prose, no ambiguity.
- **21 provider packs.** Each declares its real ingest/egress audio format, lifecycle events, potholes, and cost estimates. The resolver reconciles them across the full stack. Add a provider by dropping in a JSON pack — no code changes.
- **Deterministic audio contract.** The resolver computes exactly which transforms are needed (or "handled natively"), which are impossible, and which native capabilities mitigate which potholes.
- **Framework-native scaffolds.** LiveKit `AgentSession`, Pipecat `Pipeline`, or custom FastAPI webhook — generated code uses real framework APIs, not a generic skeleton.
- **Fake-call simulator.** `callsmith simulate` runs a deterministic call lifecycle (start → media → interrupt → DTMF → tool → TTS → reconnect → hangup) and reports pass/fail per step.

## Install

**One-liner:**

```bash
curl -fsSL https://raw.githubusercontent.com/Nachi-Kulkarni/Callsmith_skills/main/install-callsmith.sh | bash
```

**Or with npm from GitHub** (zero npm dependencies — installs in seconds):

```bash
npm install -g github:Nachi-Kulkarni/Callsmith_skills
```

**As an agent skill** (Claude Code, Cursor, Codex, Copilot, Gemini CLI, OpenCode):

```bash
npx skills add Nachi-Kulkarni/Callsmith_skills
```

## Quick start

```bash
callsmith init
cd voice-agent
bash install.sh test
```

`callsmith init` defaults to the India support preset and writes the full project into `./voice-agent`: answers, recipe, lock file, context docs, provider docs, scaffold, and a fake-call simulation report.

Choose a different starter:

```bash
callsmith init --list
callsmith init --preset browser-voice --out ./browser-agent
```

| Preset | Stack |
|--------|-------|
| `india-support` | Exotel + LiveKit + Gemini Live (inbound PSTN, Hindi support) |
| `global-support` | Twilio + Pipecat + Deepgram + OpenAI + ElevenLabs (cascaded, English) |
| `low-latency-demo` | Telnyx + LiveKit + Gemini Live (ultra-low latency) |
| `cheap-cascaded` | Plivo + Pipecat + Deepgram + GPT + Cartesia (cost-optimized) |
| `browser-voice` | Web + Pipecat + Deepgram + OpenAI + ElevenLabs (no telephony) |

The longer `spec → forge → scaffold → docs → simulate` flow still exists for maintainers and debugging, but it is not the normal path.

**Write protection:** `init`, `forge`, `scaffold`, `docs`, and `simulate` never silently overwrite your files. Add `--force` to overwrite, or `--dry-run` to preview.

## What `init` writes

```
voice.answers.json           reproducible answer file
callsmith.recipe.md          the handoff packet (intent, stack, audio contract,
                             interruption, latency, operations, build order)
callsmith.lock.json          reproducible manifest (byte-deterministic)
.env.example                 required keys for the selected stack
.callsmith/context/
  audio-contract.md          THE audio transforms (or "handled natively")
  interruption.md            turn-taking + barge-in flow per provider
  latency-budget.md          per-leg latency breakdown + verdict
  potholes.md                blockers, warnings, mitigated issues
  build-order.md             implementation sequence
  ...                        12 more context files (state, resilience, tools,
                             safety, observability, voice UX, handoff, etc.)
.callsmith/docs/             provider-specific facts + Context7 prompts
agent.py / bot.py / server.py framework-native scaffold
```

## Why the audio contract matters

Two stacks, same telephony, completely different implementation burden:

**Exotel + custom FastAPI + Gemini Live** → 4 transforms, 4 blockers:

```
[inbound]  decode μ-law → PCM        (exotel → gemini-live)
[inbound]  resample 8000 → 16000 Hz  (exotel → gemini-live)
[outbound] resample 24000 → 8000 Hz  (gemini-live → exotel)
[outbound] encode PCM → μ-law        (gemini-live → exotel)
```

**Exotel + LiveKit + Gemini Live** → 0 transforms. LiveKit's SIP trunk absorbs the μ-law decode and resampling server-side; your worker sees 16 kHz PCM directly.

That difference — invisible in the model docs, fatal at runtime — is what callsmith resolves up front.

## Supported providers

| Layer | Providers |
|-------|-----------|
| Telephony | Exotel, Twilio, Plivo, Telnyx, Vonage |
| Orchestration | LiveKit, Pipecat, Custom FastAPI |
| Realtime S2S | Gemini Live, OpenAI Realtime |
| STT | Deepgram (Nova-3), AssemblyAI |
| LLM | OpenAI (GPT-5.5), Anthropic (Claude), Google (Gemini) |
| TTS | ElevenLabs, Cartesia, Sarvam |
| VAD | Silero VAD, Deepgram Endpointing, WebRTC VAD |

Add a provider by dropping a JSON pack into `providers/`. No code changes.

## Commands

| Command | What it does |
|---------|-------------|
| `callsmith init [--preset <id>]` | Create a starter project with one command |
| `callsmith spec` | Interactive 22-group intake quiz |
| `callsmith forge --answers f` | Compile answers into the handoff packet |
| `callsmith check --answers f` | Print the compatibility matrix (transforms, blockers, latency, cost) |
| `callsmith scaffold --answers f` | Generate the framework-native repo skeleton |
| `callsmith simulate --answers f` | Run the fake-call lifecycle simulator |
| `callsmith docs --answers f` | Write provider doc stubs + Context7 prompts |
| `callsmith explain` | Explain a recipe in plain English |
| `callsmith verify-packs` | Check provider pack freshness |
| `callsmith release-check` | Run publish-readiness checks |

## Anti-patterns callsmith prevents

- Writing audio conversion code without reading `audio-contract.md` first.
- Implementing interruption without reading `interruption.md` — each provider has a different barge-in mechanism.
- Replacing framework classes (`AgentSession`, `Pipeline`) with custom implementations when the recipe doesn't require it.
- Assuming the orchestration framework normalizes audio — sometimes it does, sometimes it doesn't. The recipe says which.
- Mixing input formats on a realtime model (e.g. feeding both 24 kHz PCM and μ-law to OpenAI Realtime).
- Treating WebSocket close and telephony hangup as the same event.
- Ignoring the context window — long calls overflow without `ContextManager`.
- Skipping transcript logging — `TranscriptStore` enables crash recovery.
- Hardcoding retry logic instead of using `retry_with_backoff`.

## How it is agent-native

callsmith is both a CLI and a skill. The `SKILL.md` teaches coding agents the `spec → forge → scaffold` workflow and the voice-domain rules; the CLI does the deterministic resolution. The generated `callsmith.recipe.md` explicitly instructs the agent which files to read and which transforms are non-negotiable — so the agent implements the architecture callsmith decides, rather than improvising one.

## License

MIT
