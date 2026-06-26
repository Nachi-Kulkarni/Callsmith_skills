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
callsmith.recipe.md          the handoff packet (intent, stack, audio contract, build order)
callsmith.lock.json          reproducible manifest (providers, models, compatibility flags)
.env.example                 required keys for the selected stack
.callsmith/context/
  architecture.md            pipeline + flags
  audio-contract.md          THE audio transforms (or "handled natively")
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
| Realtime S2S | Gemini Live (`gemini-live-2.5-flash-preview`), OpenAI Realtime (`gpt-realtime-2`, native SIP) |
| STT (cascaded) | Deepgram (Nova-3), AssemblyAI (`universal-3-5-pro`) |
| TTS (cascaded) | ElevenLabs (`eleven_multilingual_v2`), Cartesia (`sonic-latest`, μ-law native), Sarvam (`bulbul:v3`) |
| LLM (cascaded) | OpenAI, Anthropic, Gemini |

Each provider ships a pack (`providers/<kind>/<id>.json`) declaring its real ingest/egress audio contract, lifecycle events, potholes, and native capabilities. The resolver reconciles these across the stack. Add a provider by dropping in a pack — no code changes.

## How it is agent-native

callsmith is both a CLI and a skill. The `SKILL.md` teaches coding agents the `spec → forge → scaffold` workflow and the voice-domain rules; the CLI does the deterministic resolution. The generated `callsmith.recipe.md` explicitly instructs the agent which files to read and which transforms are non-negotiable — so the agent implements the architecture callsmith decides, rather than improvising one.

## Repo layout

```
bin/callsmith.mjs            CLI entry (spec/forge/check/scaffold/docs/context)
src/lib/
  resolver.mjs               provider loader + menu expander + compatibility resolver + impossibility detection
  compile.mjs                answers -> recipe + lock + context files (byte-deterministic)
  scaffold.mjs               generates Python repo skeleton with contract-accurate audio bridge
  validate.mjs               schema validation gate for provider packs
  docs.mjs                   per-provider doc hydration via Context7
data/menu.json               the MCQ intake tree (single source of truth)
providers/                   15 provider packs (verified audio contracts + potholes)
  _schema.json               pack shape (required: id, kind, transport, ingest, egress, directions, native_capabilities)
scripts/gen-fixtures.mjs     generates the grid fixture matrix
test/                        60 tests (data integrity, resolver, CLI contract, grid, scaffold)
  fixtures/grid/             30 generated answer files
SKILL.md                     the agent skill
product_decisions.md         source-of-truth for all product decisions
```

## Status

v1.0. **15 provider packs** (verified audio contracts + model names), impossibility detection (`forge` refuses impossible stacks), byte-deterministic lock, schema validation gate, 30-fixture grid (all forge green), scaffolded repos pass pytest, agent-skill recipe consistency. 60-test suite, CI via GitHub Actions.

## License

MIT
