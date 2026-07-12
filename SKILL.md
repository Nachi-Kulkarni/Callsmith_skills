---
name: callsmith
description: Design production voice AI agents (telephony + realtime/cascaded speech). Use when the user wants to build, architect, or harden a voice agent, voice bot, IVR, or phone agent — or mentions Exotel, Twilio, Plivo, Telnyx, Vonage, LiveKit, Pipecat, Gemini Live, OpenAI Realtime, Deepgram, AssemblyAI, ElevenLabs, Cartesia, Sarvam, Silero VAD, STT, TTS, barge-in, or media streams. You are the compiler: dig deeper, apply hard floors, load provider packs for physics, write a short handoff contract, then implement. callsmith validates packs/physics — it does not generate the app.
argument-hint: "[audit|critique|latency|ttft|harden|check|packs] [target]"
allowed-tools: Bash(callsmith *), Bash(node *), Bash(npx callsmith *), Bash(ctx7 *), Read, Write, Edit, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

# callsmith

**You are the compiler.** callsmith teaches you to design production voice agents; packs, floors, and evals verify what you must not invent.

> The agent compiles. callsmith validates the physics, floors, and eval bar.

Constitution: `product_decisions.md`. Wedge: pack physics inspect + floor receipts + contract validate + eval gate.

Not a scaffold generator. Not a 22-question coverage machine. You converse, dig deeper, load **provider packs**, **rewrite** floor violations, write one **handoff contract**, then implement with framework-native code (LiveKit / Pipecat / custom).

The hard part is not the model. It is the audio bridge (μ-law 8 kHz ↔ PCM), barge-in, echo ownership, per-provider quirks — plus regulated floors (consent, retention, handoff).

## Setup

```bash
# Prefer local checkout verification CLI
if [ -f bin/callsmith.mjs ]; then
  node bin/callsmith.mjs doctor
elif command -v callsmith >/dev/null 2>&1; then
  callsmith doctor
else
  echo "Optional: install CLI for pack validate/check — skill works without full generation CLI"
fi
```

Primary install for users: `npx skills add Nachi-Kulkarni/Callsmith_skills` then invoke `/callsmith`.

## Command routing (playbooks)

| Argument | Load |
|---|---|
| `audit` | `reference/audit.md` |
| `critique` | `reference/critique.md` |
| `latency` | `reference/latency.md` |
| `ttft` | `reference/ttft.md` |
| `harden` | `reference/harden.md` |

These are agent modes, not generators.

## Your job (compile loop)

1. **Converse** — dig deeper on vague intent (domain, surface, language, compliance, tools, handoff stakes).
2. **Load packs** — for each provider under consideration, read `providers/<kind>/<id>.json` (or `callsmith pack show <id>`). Do not invent sample rates, barge-in mechanics, or potholes.
3. **Verify current APIs** — before implementation, load `reference/current-docs.md`, note today's date, and check version-specific SDK/API usage through Context7 when available. Compare the lookup date with pack evidence/expiry dates. If Context7 is unavailable, use an available web-fetch/browse tool to read the provider's official documentation. Record source and access date. Never guess an API from model memory.
4. **Apply floors** — load `reference/policy.md` and rewrite design when defaults violate policy. Change **answers fields**, not only prose. Tell the user before → after.
5. **Normalize vocabulary** — every policy/stack field uses the canonical option IDs in `reference/policy.md`. Free-form synonyms fail tools and gates.
6. **Physics check** — if the user has answers JSON, run `callsmith check --answers <file>`. Unknown providers: **do not synthesize** — research, write a pack, or refuse to ship.
7. **Write one non-empty handoff contract** — `callsmith.recipe.md` with all required sections (below). Empty or stub files fail.
8. **Self-check before done** — `callsmith check` clean (or pack-backed transforms stated) + `contract validate --file callsmith.recipe.md --answers voice.answers.json` when CLI available. Trust this semantic cross-check; do not hand-roll a receipt comparison script.
9. **Implement** — you write the code. Prefer framework APIs. No `callsmith scaffold` (removed).
10. **Quality modes** — audit / critique / harden / latency as needed. Use ttft only to isolate the LLM leg.

Completeness = **intent clear + floors satisfied + pack-informed physics + contract written**.
Not menu coverage 1.0.

## Canonical answers vocabulary (do not freestyle)

Before writing `voice.answers.json`, **load `reference/policy.md`**. It is the single canonical table for surface, architecture, policy, language, provider answer IDs → pack IDs, and channel constraints. Use its exact tokens; omit nonexistent provider legs and never use `"none"` as a provider ID.

The recurring benchmark failures are free-form synonyms such as `warm_transfer`, `whatsapp_async`, `english_and_hindi`, and invented product IDs. Map natural language to the reference vocabulary before running `check`.

## Hard floors — fix, do not only flag

**Acknowledging a risk is not handling it.** Load and apply the domain defaults in `reference/policy.md`. Rewrite `recording_consent`, `transcript_retention`, and `human_handoff` in both answers and receipt. A below-default design needs the explicit named risk-acceptance record defined by `reference/contract.md`. Tool-changing actions need a durable authenticated interface and recorded failure/idempotency behavior.

## Handoff contract (required sections)

Write a **non-empty** single markdown file (default `callsmith.recipe.md`). Missing file, empty body, or a missing/invalid `json callsmith-contract` receipt is a fail. Use the exact schema and canonical values in `reference/contract.md`; the receipt must match `voice.answers.json`.

1. Intent / use case
2. Stack (providers + why) — use real pack/menu ids
3. Audio path (transforms or native ownership — from packs)
4. Interruption / barge-in ownership
5. Floors applied (consent, retention, handoff, tools) + any overrides — **must match answers**
6. Latency/cost note (one quantified tradeoff with a **digit**: ms or $/min)
7. Build notes for implementation

**Contract ↔ answers consistency:** if the contract discusses consent/retention/handoff, the answers fields must already meet floors. Prose “HIPAA may apply” + `recording_consent: none` is flag-only theater (fail).

The receipt records the policy basis, jurisdiction for regulated domains, installed provider pack IDs, and a percentile `turn_gap_ms` SLO. Callsmith floors are conservative product defaults, not legal advice. A below-default design requires a named explicit-risk acceptance and reason; never silently weaken it.

Optional: keep `voice.answers.json` for `callsmith check` — values must use **canonical ids** above, not free-form prose.

## Progressive disclosure

| Stage | Load |
|---|---|
| Start | User brief + this skill + floors |
| Choosing providers | Only relevant `providers/**/*.json` |
| Physics | `callsmith check` or pack fields (ingest/egress/interruption) |
| Quality | `reference/audit.md`, `reference/latency.md`, etc. |
| Implement | Current version-specific docs + pack potholes for chosen stack |

```bash
callsmith packs
callsmith pack show twilio
callsmith pack validate
callsmith check --answers voice.answers.json   # optional answers file
callsmith contract validate --file callsmith.recipe.md --answers voice.answers.json --domain medical
callsmith doctor
```

## Verification CLI (facts only)

| Command | Purpose |
|---|---|
| `packs` / `pack show` / `pack validate` | Stdlib inspection |
| `verify-packs` | Evidence dates, expiry, provenance shape, and CI safety |
| `check --answers f` | Transforms, impossibilities, latency/cost from packs |
| `contract validate --file f [--answers a] [--domain …]` | Semantic policy/provider/turn-gap receipt, answers consistency + explanatory sections |
| `doctor` | Install health |

**Removed (do not call):** `init`, `forge`, `scaffold`, `simulate`, `intake`, `docs`, `spec`, `release-check`. Generation is your job.

## Provider packs (21)

Discover installed packs with `callsmith packs`; load only the selected files. Each pack carries audio ingress/egress, interruption, potholes, evidence-labeled planning inputs, environment keys, and dated sources.

## Audio contract (why this exists)

- Telephony is usually **μ-law 8 kHz** (Vonage often L16 16 kHz). Decode/resample unless orchestration normalizes natively (e.g. LiveKit SIP).
- Realtime models often use **asymmetric rates** (e.g. 16 kHz in / 24 kHz out).
- **Barge-in** = flush outbound + cancel in-flight TTS/model; mechanism differs per provider.
- WebSocket frames split mid-syllable — reassemble by byte budget, not message boundary.
- WebSocket close ≠ telephony hangup — one session state machine for both.

Exotel + custom FastAPI + Gemini Live → often **4 transforms**.
Exotel + LiveKit + Gemini Live → often **0 transforms**.
That difference lives in packs — not in model marketing docs.

## Anti-patterns

- Invent sample rates / barge-in without a pack
- Only flag floors without rewriting the design
- Ticket-only handoff on urgent payment/medical/collections
- Webhook for booking without OpenAPI comparison
- Assume orchestration always normalizes audio
- Synthesize unknown providers
- **Free-form enum synonyms** (`warm_transfer`, `whatsapp_async`, `english_and_hindi`, …)
- **`"telephony": "none"`** (or other `"none"` provider ids) instead of omitting the key
- Empty `callsmith.recipe.md` or contract that contradicts answers
- PSTN stack for pure WhatsApp voice-note briefs (or reverse)
- Cascaded default when brief requires ultra-low-latency app voice
- Custom FastAPI + claim “0 transforms” without pack proof
- Treat scaffold/sim green as product (removed)
- Mix input formats into a realtime model
- Equate WS close with hangup
- Skip transcript/consent on regulated flows

## Asking style

- 2–3 focused questions at a time
- Natural language → map to concrete stack decisions
- Prefer pack-backed tradeoffs over generic “use LiveKit” vibes
- After floor rewrites, state before → after
