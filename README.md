# callsmith

A recipe compiler for voice AI agents.

callsmith takes a short MCQ intake (surface, telephony, orchestration, model architecture, language, barge-in, business logic, tools, deployment), resolves the audio-format and lifecycle compatibility across the selected stack, and writes an **agent handoff packet** that a coding agent (Claude Code, Cursor, Codex, Gemini CLI) builds from in one pass — without rediscovering telephony potholes.

> The hard part of a voice agent is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM 16/24 kHz), turn/interruption lifecycle, and per-provider streaming quirks. callsmith carries that knowledge.

## Install

**As a CLI:**

```bash
npm install -g callsmith
```

**As an agent skill** (works in Claude Code, Cursor, Codex, Copilot, Gemini CLI, OpenCode, Cline, and 18+ others):

```bash
npx skills add <owner>/callsmith
```

## Quick start

```bash
# 1. Take the intake (interactive menu, or write an answers file)
callsmith spec --answers voice.answers.json

# 2. Compile the handoff packet into the project
callsmith forge --answers voice.answers.json --out .

# 3. Inspect the compatibility matrix
callsmith check --answers voice.answers.json

# 4. Generate the repo skeleton
callsmith scaffold --answers voice.answers.json --out .

# 5. Hydrate fresh provider docs
callsmith docs
```

## What `forge` writes

```
callsmith.recipe.md          the handoff packet (intent, stack, audio contract, interruption, latency, build order)
callsmith.lock.json          reproducible manifest (providers, models, compatibility, latency)
.env.example                 required keys for the selected stack
.callsmith/context/
  architecture.md            pipeline + flags
  audio-contract.md          THE audio transforms (or "handled natively")
  interruption.md            turn-taking + barge-in flow per provider
  latency-budget.md          per-leg latency breakdown + optimization
  potholes.md                all blockers/warnings/notes from every provider
  build-order.md             implementation sequence
```

## Why the audio contract matters

Two stacks, same telephony, completely different implementation burden:

**Exotel + custom FastAPI bridge + Gemini Live** → 4 transforms, 4 blockers:

```
[inbound]  decode μ-law → PCM        (exotel → gemini-live)
[inbound]  resample 8000 → 16000 Hz  (exotel → gemini-live)
[outbound] transcode PCM → μ-law     (gemini-live → exotel)
[outbound] resample 24000 → 8000 Hz  (gemini-live → exotel)
```

**Exotel + LiveKit + Gemini Live** → 0 transforms. LiveKit's SIP trunk absorbs the μ-law decode and resampling server-side; your worker sees 16 kHz PCM directly.

That difference — invisible in the model docs, fatal at runtime — is what callsmith resolves up front.

## Supported providers

| Layer | Providers |
|---|---|
| Telephony | Exotel, Twilio, Plivo, Telnyx, Vonage |
| Orchestration | LiveKit, Pipecat, custom FastAPI bridge |
| Realtime S2S | Gemini Live (`gemini-3.1-flash-live-preview`), OpenAI Realtime (`gpt-realtime-2`, native SIP) |
| STT (cascaded) | Deepgram (Nova-3), AssemblyAI (`universal-3-5-pro`) |
| LLM (cascaded) | OpenAI (`gpt-5.5`), Anthropic (`claude-sonnet-4-6`), Google (`gemini-3.5-flash`) |
| TTS (cascaded) | ElevenLabs (`eleven_v3`), Cartesia (`sonic-3.5`, μ-law native), Sarvam (`bulbul:v3`) |
| VAD | Silero VAD, Deepgram Endpointing, WebRTC VAD |

Each provider ships a pack (`providers/<kind>/<id>.json`) declaring its real ingest/egress audio contract, lifecycle events, potholes, and native capabilities. The resolver reconciles these across the stack. Add a provider by dropping in a pack — no code changes.

## How it is agent-native

callsmith is both a CLI and a skill. The `SKILL.md` teaches coding agents the `spec → forge → scaffold` workflow and the voice-domain rules; the CLI does the deterministic resolution. The generated `callsmith.recipe.md` explicitly instructs the agent which files to read and which transforms are non-negotiable — so the agent implements the architecture callsmith decides, rather than improvising one.

## Repo layout

```
bin/callsmith.mjs            CLI entry (spec/forge/check/scaffold/docs/context)
src/lib/
  resolver.mjs               provider loader + menu expander + compatibility resolver + impossibility detection
  compile.mjs                answers -> recipe + lock + context files (byte-deterministic)
  scaffold.mjs               generates framework-native repo: LiveKit (AgentSession), Pipecat (Pipeline), or custom FastAPI (audio bridge + webhook)
  validate.mjs               schema validation gate for provider packs
  registry.mjs               two-tier unknown-provider resolution (registry + synthesis)
  docs.mjs                   per-provider doc hydration via Context7
data/menu.json               the MCQ intake tree (single source of truth)
providers/                   21 provider packs (telephony, orchestration, realtime, stt, llm, tts, vad)
  _schema.json               pack shape (required: id, kind, transport, ingest, egress, directions, native_capabilities)
scripts/gen-fixtures.mjs     generates the grid fixture matrix
test/                        117 tests (data integrity, resolver, registry, CLI contract, docs, grid, scaffold, tier1)
  fixtures/grid/             40 generated answer files
  fixtures/registry/         test packs for local registry lookup
SKILL.md                     the agent skill
product_decisions.md         source-of-truth for all product decisions
```

## Status

v1.1. **21 provider packs** (verified audio contracts + model names + latency estimates + interruption metadata), **LLM + VAD as first-class pipeline citizens**, **interruption & turn-taking resolution** (concrete per-provider barge-in flow), **latency budget modeling** (per-leg breakdown with target + verdict), **framework-native scaffolds** (LiveKit AgentSession + Pipecat Pipeline + custom FastAPI webhook), impossibility detection, unknown-provider online resolution, byte-deterministic lock, schema validation gate, 40-fixture grid, 117-test suite, CI via GitHub Actions.

## License

MIT
