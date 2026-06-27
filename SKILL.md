---
name: callsmith
description: Compile a production-ready implementation recipe for voice AI agents (telephony + realtime/cascaded speech). Use when the user wants to build, scaffold, or architect a voice agent, voice bot, IVR, or phone agent — or mentions Exotel, Twilio, Plivo, Telnyx, Vonage, LiveKit, Pipecat, Gemini Live, OpenAI Realtime, Deepgram, AssemblyAI, ElevenLabs, Cartesia, Sarvam, Silero VAD, STT, TTS, LLM, speech-to-speech, barge-in, or media streams. Resolves the audio bridge, interruption/turn-taking, latency budget, detects impossible stacks, and compiles a deterministic handoff packet with framework-native scaffolds so a coding agent can build the whole thing in one pass.
argument-hint: "[spec|forge|check|scaffold|docs|context] [target]"
allowed-tools: Bash(callsmith *), Bash(node *), Bash(npx callsmith *), Bash(npm install -g callsmith), Read, Write, Edit
---

# callsmith

A recipe compiler for voice AI agents. It takes a short MCQ intake (surface, telephony, orchestration, architecture, realtime model / STT+LLM+TTS, VAD, language, barge-in, latency priority, business logic, tools, deployment), resolves audio-format compatibility, computes the interruption/turn-taking flow, models the latency budget, and writes an agent handoff packet: `callsmith.recipe.md` + `callsmith.lock.json` + `.callsmith/context/*`. A coding agent then builds the full system from that packet — using **framework-native code** (LiveKit Agents, Pipecat Pipeline, or custom FastAPI) — without rediscovering telephony potholes.

The hard part of voice agents is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM 16/24 kHz), turn/interruption lifecycle, VAD configuration, and per-provider streaming quirks. callsmith carries that knowledge so the implementer does not have to.

## Setup check

Run this before anything else. If the CLI is missing, install it.

```bash
command -v callsmith >/dev/null 2>&1 && echo "Installed" || npm install -g callsmith
```

In a checkout of the callsmith repo itself, the CLI runs without a global install:

```bash
node bin/callsmith.mjs --help
```

## Core workflow

The build is `spec -> forge -> (check) -> scaffold`. Intake produces an answers file; forge compiles it; check inspects the matrix; scaffold emits the repo skeleton.

```bash
# 1. Take the intake (see the menu, or write an answers file)
callsmith spec --answers voice.answers.json

# 2. Compile the handoff packet into the project
callsmith forge --answers voice.answers.json --out .

# 3. Inspect the compatibility matrix without writing files
callsmith check --answers voice.answers.json

# 4. Generate the framework-native repo skeleton
callsmith scaffold --answers voice.answers.json --out .

# 5. Hydrate fresh provider docs into .callsmith/docs/
callsmith docs --answers voice.answers.json --out .
```

### What forge writes

```
callsmith.recipe.md          # the handoff packet (intent, stack, audio contract, interruption, latency, cost, conversation state, error handling, build order)
callsmith.lock.json          # reproducible manifest (providers, models, compatibility, latency, cost)
.env.example                 # required keys for the selected stack
.callsmith/context/
  architecture.md            # pipeline + flags (includes LLM, VAD)
  audio-contract.md          # THE audio transforms (or "handled natively")
  interruption.md            # per-provider interruption flow (VAD -> cancel -> flush -> clear)
  latency-budget.md          # per-leg latency breakdown + optimization tips
  cost-estimation.md         # per-leg cost table + scale projections
  conversation-state.md      # context window strategy + transcript schema + DTMF wiring
  error-handling.md          # WebSocket recovery + rate-limit backoff + fallback chains
  potholes.md                # all blockers/warnings/notes from every provider
  build-order.md             # implementation sequence (10 steps including state + resilience)
```

## Commands

| Command | Description |
|---|---|
| `spec [--answers f]` | Print the intake menu, or emit a fillable answers template |
| `forge --answers f [--out d]` | Compile answers into the handoff packet (recipe + lock + context) |
| `check --answers f` | Print the compatibility matrix (transforms, blockers, latency, cost, interruption). Exits non-zero if blockers remain |
| `scaffold --answers f [--out d]` | Generate the framework-native repo skeleton |
| `docs --answers f [--out d]` | Hydrate provider docs via Context7 into `.callsmith/docs/` |
| `context` | Preflight: report whether a recipe is loaded in the cwd |

## The 15 menu groups

| # | Group | Options |
|---|---|---|
| 1 | **Surface** | Inbound PSTN, Outbound PSTN, Web voice, App-to-app, WhatsApp voice |
| 2 | **Architecture** | Realtime speech-to-speech, Cascaded STT→LLM→TTS, Hybrid |
| 3 | **Telephony** (conditional) | Exotel, Twilio, Plivo, Telnyx, Vonage |
| 4 | **Orchestration** | LiveKit Agents, Pipecat, Custom FastAPI |
| 5 | **Realtime model** (conditional) | Gemini Live (`gemini-3.1-flash-live-preview`), OpenAI Realtime (`gpt-realtime-2`) |
| 6 | **STT** (conditional) | Deepgram (Nova-3), AssemblyAI (`universal-3-5-pro`) |
| 7 | **LLM** (conditional) | OpenAI (`gpt-5.5`), Anthropic (`claude-sonnet-4-6`), Google (`gemini-3.5-flash`) |
| 8 | **TTS** (conditional) | ElevenLabs (`eleven_v3`), Cartesia (`sonic-3.5`), Sarvam (`bulbul:v3`) |
| 9 | **VAD** | Silero VAD, Deepgram Endpointing, WebRTC VAD |
| 10 | **Language** | English, Hindi, Hinglish, Tamil, Kannada, Multilingual |
| 11 | **Barge-in** | Required (full-duplex), Optional (best-effort), Disabled (half-duplex) |
| 12 | **Latency priority** | Ultra-low, Balanced, Low-cost, Highest-reliability |
| 13 | **Business logic** | FAQ, Support, Lead qual, Booking, Collections, Interview |
| 14 | **Tools** | None, Webhook, OpenAPI spec, MCP server, Database |
| 15 | **Deployment** | Local, Railway, Render, Fly.io, Kubernetes |

## Framework-native scaffolds

The scaffold generates code that uses the actual framework APIs — not a generic skeleton.

**LiveKit Agents**: generates `agent.py` with `AgentSession`, `Agent`, `TurnHandlingOptions(turn_detection=MultilingualModel())`, `silero.VAD.load()`, and inference or plugin-based model wiring.

**Pipecat**: generates `bot.py` with `Pipeline([transport.input(), stt, context_aggregator.user(), llm, tts, transport.output(), context_aggregator.assistant()])`, `PipelineTask`, `PipelineRunner`, `TwilioFrameSerializer`, `SileroVADAnalyzer` + `server.py` with webhook + WebSocket handler.

**Custom FastAPI**: generates `server.py` with webhook endpoint + WebSocket media handler (includes DTMF parsing, TranscriptStore logging, ReconnectingWebSocket pattern) + `audio/bridge.py` with μ-law codecs and resampler (only when transforms are needed).

All scaffolds also generate:
- **`state.py`** — `ContextManager` (sliding-window token tracking against the LLM's context window), `TranscriptStore` (SQLite persistence for every turn), `DTMFHandler` (keypad digit collection with inter-digit timeout).
- **`resilience.py`** — `ReconnectingWebSocket` (exponential backoff reconnection), `retry_with_backoff` (rate-limit handling decorator), `FallbackConfig` (per-leg provider fallback chains).
- **`tests/test_state.py`** + **`tests/test_resilience.py`** — validates all three modules round-trip correctly.

## Cost estimation

Every provider pack carries `cost_estimates` with billing model + normalized per-minute USD. The recipe includes:

- A per-leg cost table (telephony, orchestration, VAD, STT, LLM, TTS)
- Scale projections: per-hour, per-1k calls (5-min avg)
- Per-leg detail with billing model explanation

Cost assumptions: ~250 tokens/min LLM, ~800 chars/min TTS, 5-min avg call. Always verify at provider sites.

## Conversation state management

The recipe and scaffold address three state concerns:

1. **Context window management**: `ContextManager` tracks token count and enforces a sliding window. System prompt is always retained. When approaching `max_tokens - reserve_tokens`, oldest messages are dropped. Uses the LLM's actual `context_window` from the provider pack.

2. **Transcript persistence**: `TranscriptStore` logs every turn to SQLite (`transcripts.db`). Schema: call_id, timestamp, role, content, tokens, metadata. Enables crash recovery — on restart, load transcript back into ContextManager.

3. **DTMF handling**: Framework-specific wiring:
   - **Pipecat**: `DTMFAggregator` in pipeline between `transport.input()` and `stt`
   - **LiveKit**: `GetDtmfTask` for IVR-style digit collection
   - **Custom**: parse `dtmf` events from WebSocket messages

## Error handling & resilience

The recipe and scaffold address four resilience concerns:

1. **WebSocket drop recovery**: `ReconnectingWebSocket` with exponential backoff (1s→2s→4s→8s→16s, max 30s) and ±25% jitter. Max 5 retries. `ConnectionState` machine: CONNECTED → DISCONNECTED → RECONNECTING → CONNECTED/FAILED.

2. **Rate-limit backoff**: `retry_with_backoff` decorator honors `Retry-After` header. Exponential backoff on 429/5xx. Max 3 retries. Applied to LLM/STT/TTS API calls.

3. **Fallback chains**: `FallbackConfig` registers primary + fallback per pipeline leg. Framework-specific:
   - **LiveKit**: `stt.FallbackAdapter([deepgram.STT(), assemblyai.STT()])`
   - **Pipecat**: `@tts.event_handler("on_connection_error")` for auto-reconnect logging
   - **Custom**: manual `FallbackConfig.register("stt", "deepgram", "assemblyai")`

4. **Tool call timeouts**: 5s default. On timeout, respond with holding message and retry asynchronously.

## How to use callsmith when building for a user

### When the user describes a voice agent in prose

Do not improvise an architecture. Run the intake, then compile.

1. Read the menu: `callsmith spec`.
2. Map the user's intent to the 15 menu groups. Ask only what the user has not already specified, 2-3 questions at a time.
3. Write the answers object to a file (keys = group ids, values = option ids).
4. Run `callsmith forge --answers <file> --out .`.
5. Read `callsmith.recipe.md` and `.callsmith/context/audio-contract.md` **and** `.callsmith/context/interruption.md` before writing any code.

### When the user already has answers or a partial stack

Run `callsmith check` first. It surfaces: the audio contract (transforms), interruption flow (per-provider barge-in steps), latency budget (per-leg breakdown + verdict), and blockers. If it reports transforms, those are non-negotiable implementation steps.

### When scaffolding

Only scaffold after `forge` has written `callsmith.recipe.md`. The scaffold uses the framework's native APIs — do not replace framework classes with custom implementations unless the recipe explicitly requires a custom bridge.

## The audio contract (why this skill exists)

Voice agents fail at the audio boundary. The recurring traps callsmith encodes:

- Telephony media streams are **μ-law 8 kHz narrowband** (except Vonage, which streams L16 PCM 16 kHz). A decode + resample stage is mandatory unless a native layer does it.
- Realtime models use **asymmetric rates** (e.g. Gemini Live: 16 kHz in, 24 kHz out). Two independent resamplers are required.
- **Barge-in** requires flushing the outbound buffer and cancelling in-flight model/TTS output. Each provider has a different mechanism (Twilio: mark/clear, Vonage: action:clear, LiveKit: TurnHandlingOptions, Pipecat: InterruptionFrame). The recipe's interruption section spells out the exact flow.
- WebSocket frames split/coalesce audio arbitrarily. Reassemble by byte budget, not message boundary.

## Interruption & turn-taking

The recipe includes a dedicated "Interruption & turn-taking" section with concrete, ordered steps for the selected stack:

1. **VAD detection** — Silero/Deepgram/WebRTC VAD detects user speech
2. **Framework cancellation** — Pipecat fires InterruptionFrame; LiveKit cancels via TurnHandlingOptions
3. **LLM stream cancel** — cancel the in-flight streaming completion
4. **TTS output stop** — close the TTS WebSocket, discard buffered audio
5. **Media playback stop** — provider-specific (Twilio: clear event, Vonage: action:clear)

Each step includes the provider's `interruption` block with mechanism name, description, and code hint.

## Latency budget

The recipe includes a latency table summing per-leg estimates:

| Leg | Example |
|---|---|
| Telephony media round-trip | 80 ms |
| Orchestration pipeline overhead | 20-30 ms |
| VAD processing | 10-30 ms |
| STT time to first transcript | 300-350 ms (cascaded) |
| LLM time to first token | 350-450 ms (cascaded) |
| TTS time to first audio | 150-250 ms (cascaded) |
| Realtime model response start | 450-500 ms (realtime) |

Total is compared against a target (500ms ultra / 800ms balanced / 1200ms reliability) with a verdict.

## Impossibility detection

`forge` exits non-zero and produces no recipe if:

- **Missing mandatory leg** — cascaded without STT/TTS/LLM, or realtime without a model.
- **Surface/direction mismatch** — outbound job with inbound-only telephony.
- **Unknown provider that can't be resolved** — (P3 resolves most unknowns via registry/synthesis).

## Unknown provider resolution (P3)

When answers reference a provider not in the installed packs, callsmith resolves it online:

1. **Registry lookup** — fetches from a community pack registry (`CALLSMITH_REGISTRY` env). Registry packs are validated and marked `verified: true`.
2. **Dynamic synthesis fallback** — builds a transient pack with sensible defaults + a blocker pothole. Stamped **`UNVERIFIED PROVIDER`** in the recipe header.

## Determinism

`callsmith.lock.json` is byte-deterministic: same answers → identical lock. No timestamps, no nondeterminism.

## Provider packs (21 total)

| Layer | Providers |
|---|---|
| Telephony (5) | Exotel, Twilio, Plivo, Telnyx, Vonage |
| Orchestration (3) | LiveKit, Pipecat, Custom FastAPI |
| Realtime (2) | Gemini Live (`gemini-3.1-flash-live-preview`), OpenAI Realtime (`gpt-realtime-2`) |
| STT (2) | Deepgram (`nova-3`), AssemblyAI (`universal-3-5-pro`) |
| LLM (3) | OpenAI (`gpt-5.5`), Anthropic (`claude-sonnet-4-6`), Google (`gemini-3.5-flash`) |
| TTS (3) | ElevenLabs (`eleven_v3`), Cartesia (`sonic-3.5`), Sarvam (`bulbul:v3`) |
| VAD (3) | Silero VAD, Deepgram Endpointing, WebRTC VAD |

Each pack declares: audio ingest/egress format, transport, lifecycle events, potholes, latency estimates, cost estimates, interruption mechanism, env keys, doc URLs, and Context7 library IDs.

## Anti-patterns to avoid

- Do not write audio conversion code without reading `.callsmith/context/audio-contract.md` first.
- Do not implement interruption without reading `.callsmith/context/interruption.md` — each provider has a different mechanism.
- Do not replace framework classes (AgentSession, Pipeline) with custom implementations unless the recipe explicitly requires a custom bridge.
- Do not assume the orchestration framework normalizes audio — verify it appears in the recipe's notes.
- Do not mix input formats on a realtime model (e.g. feed both 24 kHz PCM and μ-law to OpenAI Realtime).
- Do not treat WebSocket close and telephony hangup as the same event; map both to one session state machine.
- Do not ignore the context window — long calls overflow. Use `ContextManager` from `state.py`.
- Do not skip transcript logging — `TranscriptStore` enables crash recovery and debugging.
- Do not hardcode retry logic — use `retry_with_backoff` from `resilience.py` instead.
- Do not configure fallback providers without reading `.callsmith/context/error-handling.md`.
