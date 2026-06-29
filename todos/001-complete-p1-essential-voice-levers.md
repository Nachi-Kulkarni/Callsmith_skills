---
status: complete
priority: p1
issue_id: "001"
tags: [voice-ai, livekit, pipecat, simulator, observability, tools]
dependencies: []
---

# Essential Voice-Agent Levers

## Problem Statement

Callsmith resolves a voice-agent architecture, but it must also help users prove and operate the generated agent as a live-call system. The missing state space is local call simulation, observability, tool execution, voice UX tuning, safety/compliance, human handoff, ngrok-based local PSTN testing, and provider-pack verification.

## Findings

- Recipe and scaffold tests prove static structure, not call lifecycle behavior.
- LiveKit Agents use `AgentSession`, turn handling, state events, and `@function_tool` for tools.
- Pipecat exposes pipeline observers and frame events through `BaseObserver` attached to a worker/task.
- Local PSTN testing can stay out of deployment scope by generating a ngrok runbook and helper.
- Provider packs need deterministic verification that can run in CI without live network access.

## Proposed Solutions

1. Add compiler context files for the state space and task order.
2. Add menu/config knobs for endpointing, interruption, noise cancellation, silence timeout, max call duration, greeting, voice profile, language fallback, consent, retention, and handoff.
3. Generate scaffold modules for observability, tool calling, voice UX policy, safety/compliance, handoff, local ngrok testing, and simulation.
4. Add `callsmith simulate` and `callsmith verify-packs`.
5. Extend tests to verify the new generated modules, commands, and docs.

## Recommended Action

Implement all non-deployment levers now. Keep production deployment control plane out of scope; only include local ngrok instructions and helper code.

## Acceptance Criteria

- [x] Fresh `callsmith spec --answers` exposes the new voice UX and safety knobs.
- [x] `callsmith forge` writes context files for simulator, observability, tools, voice UX, safety, handoff, and local testing.
- [x] `callsmith scaffold` generates Python modules and tests for those levers.
- [x] `callsmith simulate` emits a deterministic fake-call report covering lifecycle, media, STT, interruption, DTMF, tool, TTS, reconnect, and hangup.
- [x] `callsmith verify-packs` checks pack freshness risks in CI without network access.
- [x] Existing fixtures still forge and scaffold.
- [x] Full Node test suite passes.

## Work Log

### 2026-06-27 - Implementation Pass

**By:** Codex

**Actions:**
- Scoping the state space and implementing each lever sequentially.
- Added intake defaults for voice UX, safety, handoff, consent, and retention.
- Added compiler context and lock fields for operational policies.
- Added generated modules: `observability.py`, `tools.py`, `voice_ux.py`, `safety.py`, `handoff.py`, `local_test.py`, and `simulate_call.py`.
- Added `callsmith simulate` and `callsmith verify-packs`.
- Added behavior tests for the new commands, context files, and scaffold modules.

**Learnings:**
- Keep deployment out of scope, but local PSTN testing needs an ngrok path so users can test with real providers before shipping.
- Pack verification should warn, not fail, when a provider lacks a Context7 docs-refresh ID but has otherwise valid pack metadata.
