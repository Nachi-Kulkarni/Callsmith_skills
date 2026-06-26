---
name: callsmith
description: Compile a production-ready implementation recipe for voice AI agents (telephony + realtime/cascaded speech). Use when the user wants to build, scaffold, or architect a voice agent, voice bot, IVR, or phone agent — or mentions Exotel, Twilio, Plivo, Telnyx, Vonage, LiveKit, Pipecat, Gemini Live, OpenAI Realtime, Deepgram, AssemblyAI, ElevenLabs, Cartesia, Sarvam, STT, TTS, speech-to-speech, barge-in, or media streams. Resolves the audio bridge, detects impossible stacks, and compiles a deterministic handoff packet so a coding agent can build the whole thing in one pass.
argument-hint: "[spec|forge|check|scaffold|docs|context] [target]"
allowed-tools: Bash(callsmith *), Bash(node *), Bash(npx callsmith *), Bash(npm install -g callsmith), Read, Write, Edit
---

# callsmith

A recipe compiler for voice AI agents. It takes a short MCQ intake (surface, telephony, orchestration, model architecture, language, barge-in, business logic, tools, deployment), resolves the audio-format and lifecycle compatibility across the selected stack, and writes an agent handoff packet: `callsmith.recipe.md` + `callsmith.lock.json` + `.callsmith/context/*`. A coding agent then builds the full system from that packet without rediscovering telephony potholes.

The hard part of voice agents is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM 16/24 kHz), turn/interruption lifecycle, and per-provider streaming quirks. callsmith carries that knowledge so the implementer does not have to.

## Setup check

Run this before anything else. If the CLI is missing, install it.

```bash
command -v callsmith >/dev/null 2>&1 && echo "Installed" || npm install -g callsmith
```

In a checkout of the callsmith repo itself, the CLI runs without a global install:

```bash
node bin/callsmith.mjs --help
```

All examples below assume `callsmith` is on PATH. Substitute `node bin/callsmith.mjs` when working inside the repo.

## Core workflow

The build is `spec -> forge -> (check) -> scaffold`. Intake produces an answers file; forge compiles it; check inspects the matrix; scaffold emits the repo skeleton.

```bash
# 1. Take the intake (see the menu, or write an answers file)
callsmith spec --answers voice.answers.json

# 2. Compile the handoff packet into the project
callsmith forge --answers voice.answers.json --out .

# 3. Inspect the compatibility matrix without writing files
callsmith check --answers voice.answers.json

# 4. Generate the repo skeleton (lego pieces with correct contracts)
callsmith scaffold --answers voice.answers.json --out .

# 5. Hydrate fresh provider docs into .callsmith/docs/
callsmith docs
```

### What forge writes

```
callsmith.recipe.md          # the handoff packet (intent, stack, audio contract, build order)
callsmith.lock.json          # reproducible manifest (providers, models, compatibility flags)
.env.example                 # required keys for the selected stack
.callsmith/context/
  architecture.md            # pipeline + flags
  audio-contract.md          # THE audio transforms (or "handled natively")
  potholes.md                # all blockers/warnings/notes from every provider
  build-order.md             # implementation sequence
```

## Commands

| Command | Description |
|---|---|
| `spec [--answers f]` | Print the intake menu, or emit a fillable answers template |
| `forge --answers f [--out d]` | Compile answers into the handoff packet |
| `check --answers f` | Print the compatibility matrix (transforms, blockers, notes). Exits non-zero if blockers remain — use in CI |
| `scaffold --answers f [--out d]` | Generate the repo skeleton from the recipe |
| `docs [--out d]` | Hydrate provider docs via Context7 into `.callsmith/docs/` |
| `context` | Preflight: report whether a recipe is loaded in the cwd |

## How to use callsmith when building for a user

### When the user describes a voice agent in prose

Do not improvise an architecture. Run the intake, then compile.

1. Read the menu: `callsmith spec`.
2. Map the user's intent to the 13 menu groups. Ask only what the user has not already specified, 2-3 questions at a time. Defaults are sensible; do not re-ask answered questions.
3. Write the answers object to a file (keys = group ids, values = option ids).
4. Run `callsmith forge --answers <file> --out .`.
5. Read `callsmith.recipe.md` and `.callsmith/context/audio-contract.md` before writing any code.

### When the user already has answers or a partial stack

Run `callsmith check` first to surface the audio contract and blockers. If it reports transforms, those are non-negotiable implementation steps. If it reports zero transforms, a native layer (LiveKit/Pipecat normalization, OpenAI SIP, or ElevenLabs μ-law) is absorbing the work — confirm the user is actually using that layer.

### When scaffolding

Only scaffold after `forge` has written `callsmith.recipe.md`. The skeleton's audio module must implement exactly the transforms in `.callsmith/context/audio-contract.md`, no more, no less.

## The audio contract (why this skill exists)

Voice agents fail at the audio boundary. The recurring traps callsmith encodes:

- Telephony media streams are **μ-law 8 kHz narrowband**. No realtime model or STT consumes that directly. A decode (μ-law→PCM) and resample (8k→16k/24k) stage is mandatory unless a native layer does it.
- Realtime models use **asymmetric rates** (e.g. Gemini Live: 16 kHz in, 24 kHz out). Two independent resamplers are required, one per direction.
- **Barge-in** requires flushing the outbound buffer and cancelling in-flight model/TTS output. Half-implemented interruption causes overlapping speech.
- WebSocket frames split/coalesce audio arbitrarily. Reassemble by byte budget, not message boundary.
- Some layers absorb the work: LiveKit's SIP trunk, Pipecat transports, OpenAI's native SIP, ElevenLabs' `ulaw_8000_8` output, Cartesia's `pcm_mulaw` at 8kHz. callsmith detects these and reports "no custom bridge needed".

## Impossibility detection

callsmith refuses to forge stacks that are genuinely impossible. `forge` exits non-zero and produces no recipe if:

- **Missing mandatory leg** — e.g. cascaded architecture with no STT, or realtime with no model.
- **Surface/direction mismatch** — e.g. outbound job with an inbound-only telephony provider.

A stack that is *hard but possible* (e.g. needs 4 audio transforms with a custom FastAPI bridge) still forges with `[BLOCKER]` warnings. Only true impossibilities are refused.

## Unknown provider resolution (P3)

When answers reference a provider not in the installed packs, callsmith resolves it online:

1. **Registry lookup** — fetches from a community pack registry (`CALLSMITH_REGISTRY` env, default GitHub raw URL). Registry packs are validated and marked `verified: true`.
2. **Dynamic synthesis fallback** — if no registry pack, callsmith builds a transient pack with sensible defaults + a blocker pothole. Synthesized packs are stamped **`UNVERIFIED PROVIDER — validate before shipping`** in the recipe header and lock `resolved_providers` array.

`CALLSMITH_REGISTRY_SKIP=1` skips the registry and always synthesizes. `CALLSMITH_REGISTRY=/local/path` uses a local directory for testing.

## Determinism

`callsmith.lock.json` is byte-deterministic: the same answers always produce the same lock (no timestamps). This enables reproducible builds and snapshot testing.

Always defer to the generated `.callsmith/context/audio-contract.md` over general knowledge.

## Routing rules

1. **No argument**: print a one-line orientation and suggest `callsmith spec`.
2. **First word matches a command** (`spec|forge|check|scaffold|docs|context`): run the matching setup/workflow step.
3. **User describes a voice agent in prose** without naming callsmith: propose the intake (`callsmith spec`) before designing the architecture yourself. callsmith's resolver is more reliable than improvised audio handling.
4. **User asks to fix a broken voice agent**: run `callsmith check` against their current stack if the answers are reconstructible; the matrix usually names the missing transform.

## Reference knowledge

For the underlying voice-domain detail the resolver draws on, see the provider packs under `providers/` (telephony, orchestration, realtime, stt, tts) and `data/menu.json`. The packs are the single source of truth for each provider's ingest/egress audio contract and potholes; edit them there and every recipe stays consistent.

## Anti-patterns to avoid

- Do not write audio conversion code without reading `.callsmith/context/audio-contract.md` first.
- Do not assume the orchestration framework normalizes audio — verify it appears in the recipe's notes.
- Do not mix input formats on a realtime model (e.g. feed both 24 kHz PCM and μ-law to OpenAI Realtime).
- Do not treat WebSocket close and telephony hangup as the same event; map both to one session state machine.
