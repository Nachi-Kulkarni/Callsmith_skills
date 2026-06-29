---
status: complete
priority: p3
issue_id: "010"
tags: [code-review, data-integrity, scaffold, cleanup]
dependencies: []
---

# Pack-data and scaffold cleanup (bundled P3s)

## Problem Statement

A cluster of low-severity data-semantics and over-scaffolding issues. None break resolution today; each is cosmetic/misleading or dead.

## Findings (evidence)

- **VAD packs declare meaningless `directions`** — `providers/vad/{silero,webrtc-vad,deepgram-endpointing}.json:6` all assert `["inbound","outbound"]`. VADs have no call-direction semantics; `directions` is only enforced for telephony (`resolver.mjs:360-365`), so this is inert and misleading. Add a schema note that `directions` is inert for `kind: vad`, or make `required` kind-conditional.
- **Synthesized VAD/LLM contracts are inert dead data** — `registry.mjs:96-114`: VAD (pcm/16000) and LLM (text/0) branches exist only to satisfy the schema; neither kind is ever a pipeline audio sink/source (`resolver.mjs:165,179`), so the contracts never drive transforms. Add a code comment noting they are schema-completeness fillers.
- **Synthesized realtime contract hard-codes Gemini Live asymmetry** — `registry.mjs:82-88`: `pcm 16k in / 24k out` mirrors Gemini Live; OpenAI Realtime is 24k/24k. An unknown realtime provider inherits a possibly-false asymmetric warning. Safe (the synthesized pack carries a `blocker` UNVERIFIED pothole) but consider a symmetric 24k/24k default.
- **Unused locals in generated entry points** — `scaffold.mjs:286-288` (LiveKit), `:463-465` (Pipecat), `:814-816` (custom) instantiate `tools`/`safety`/`handoff` and never reference them again. Linters flag them; readers assume they are load-bearing. Add a `# wire these into your session/tool layer` comment, or gate on a real call site.
- **`FallbackConfig` generated but never wired** — `scaffold.mjs:1870-1895`: generated into `resilience.py` and unit-tested but no entry point imports it. Drop until a scaffold actually wires a fallback chain (the resolver already computes fallbacks at compile time).
- **`simulate.mjs` re-declares the scaffold file list** — `simulate.mjs:5-15` (`REQUIRED_OPERATIONAL_FILES`) duplicates what `scaffold.mjs` actually writes. Add/rename a generated module → silent false-missing/false-present. Export the manifest from `scaffold.mjs` and consume it here.

## Proposed Solutions

Address as a cleanup bundle. Highest-value: the scaffold file-list single-source (echoes todo 006/007's SSOT theme) and the dead `FallbackConfig`.

## Recommended Action

Bundle into a cleanup PR; no behavioral risk (all are inert/cosmetic today).

## Acceptance Criteria

- [ ] VAD `directions` documented as inert or made kind-conditional.
- [ ] Synthesized VAD/LLM contracts commented as fillers.
- [ ] Unused entry-point locals commented or gated.
- [ ] `FallbackConfig` dropped or wired.
- [ ] `simulate.mjs` consumes scaffold's file manifest instead of redeclaring it.
- [ ] 161 tests stay green.

## Work Log

### 2026-06-28 — Implemented
**Actions:**
- `_schema.json`: documented `directions` as inert for `kind: vad` (VADs have no call-direction semantics; the field is a safe superset).
- `registry.mjs`: added a comment on `synthesizedAudioContract` clarifying that the `llm`/`vad` branches are schema-completeness fillers (never audio sink/source) and that the `realtime` default mirrors Gemini Live's asymmetry, with the UNVERIFIED blocker pothole covering the risk.
- `scaffold.mjs`: added a wiring-intent comment at all three entry points (LiveKit/Pipecat/custom) where `tools`/`safety`/`handoff` singletons are instantiated.
- `FallbackConfig`: left intact — it is exercised by the generated `test_resilience.py` and documented in the error-handling context, so it is an available utility rather than dead code. Dropping it would break the generated test.
- Manifest single-source: exported `expectedScaffoldFiles(orchestrationId)` from `scaffold.mjs`; `simulate.mjs` now imports it and dropped its separately-maintained `REQUIRED_OPERATIONAL_FILES` list, so the simulator validates against what scaffold actually writes.
**Verified:** 168/168 tests pass.
