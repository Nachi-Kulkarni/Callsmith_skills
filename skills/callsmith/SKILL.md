---
name: callsmith
description: "Design production voice AI agents across telephony and realtime or cascaded speech. Use for architecture, implementation, hardening, deployment, scaling, provider selection, audio physics, safety floors, and latency measurement."
argument-hint: "[audit|critique|architecture|latency|ttft|prompts|harden|deploy|noise-cancellation|security|multilingual|check|packs] [target]"
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

Primary install for users: `npx skills add https://github.com/Nachi-Kulkarni/Callsmith_skills/tree/main/skills/callsmith` then invoke `/callsmith`.

## Command routing (playbooks)

One playbook per invocation. Load **only** the matching file when invoked:

| Argument | Load | When |
|---|---|---|
| `audit` | `reference/audit.md` | Score an existing design; punch list, no edits |
| `critique` | `reference/critique.md` | Opinionated stack second opinion; pick a winner |
| `architecture` | `reference/architecture.md` | S2S vs cascaded vs hybrid; decide with numbers, no ties |
| `latency` | `reference/latency.md` | Turn Gap (speech end → first audible) |
| `ttft` | `reference/ttft.md` | LLM-leg only; use after latency points at TTFT |
| `prompts` | `reference/prompts.md` | Write or review the production runtime prompt |
| `harden` | `reference/harden.md` | Pre-pilot resilience / safety / state machine |
| `deploy` | `reference/deploy.md`; it routes to `reference/deploy-capacity.md` for capacity/scalability claims | Cloud vs self-host; drain, regions, warm pools, concurrency |
| `noise-cancellation` | `reference/noise-cancellation.md` | Open-source echo/noise cleanup, side-speaker suppression, speaker control, and overlap extraction |
| `security` | `reference/security.md` | Card-data routing, PII redaction boundaries, voice-channel prompt injection, recording access |
| `multilingual` | `reference/multilingual.md` | Code-switching STT, multilingual vs per-language legs, per-language TTS voices and evals |

No argument → default compile loop below.
`check` / `packs` → verification CLI only (not playbooks).
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
10. **Quality modes** — audit / critique / architecture / prompts / harden / deploy / latency / noise-cancellation / security / multilingual as needed. Use ttft only to isolate the LLM leg. Use noise-cancellation when contaminated input, echo, side speech, or false barge-in requires an audio-processing decision. Use security when payment capture, PII persistence, or caller-driven tool injection is in scope; use multilingual when callers mix or switch languages. Use architecture when S2S-vs-cascaded is unresolved; use deploy before any pilot with real callers. Follow the capacity branch routed by `reference/deploy.md` before designing a load harness or stating a concurrency ceiling, calls-per-pod number, pod count, or autoscaler threshold.

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

The receipt records the policy basis, jurisdiction for regulated domains, installed provider pack IDs, and a percentile `turn_gap_ms` SLO. Its optional deployment block records target, region, and drain owner; managed-runtime and regulated-residency claims must agree with pack physics. Callsmith floors are conservative product defaults, not legal advice.

Optional: keep `voice.answers.json` for `callsmith check` — values must use **canonical ids** above, not free-form prose.

## Progressive disclosure

| Stage | Load |
|---|---|
| Start | User brief + this skill + floors |
| Choosing providers | Only relevant `providers/**/*.json` |
| Physics | `callsmith check` or pack fields (ingest/egress/interruption) |
| Quality | `reference/audit.md`, `reference/prompts.md`, `reference/latency.md`, etc. |
| Implement | Current version-specific docs + pack potholes for chosen stack |
| Deploy | `reference/deploy.md` + pack `deployment` fields + `check` Operations |
| Capacity / scale | `reference/deploy.md` → `reference/deploy-capacity.md`; load workload or evidence detail only when needed |
| Noise / echo / side speakers | `reference/noise-cancellation.md`; keep office measurements as priors and re-measure the target channel |
| Payments / PII / injection | `reference/security.md`; card digits never enter transcripts, traces, or logs |
| Mixed-language callers | `reference/multilingual.md`; per-language WER and turn gap, never one blended metric |

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
- Self-host for a no-ops pilot, or claim managed convenience on a custom bridge
- Deploy without drain (killing workers mid-call) or with VAD reloaded per call/frame
- Treat a clean latency trace, closed-loop-only run, or saturated load box as a capacity number
- S2S-vs-cascaded by vibes when the brief is regulated + tool-heavy (cascaded) or ultra-low-latency (S2S)

## Asking style

- 2–3 focused questions at a time
- Natural language → map to concrete stack decisions
- Prefer pack-backed tradeoffs over generic “use LiveKit” vibes
- After floor rewrites, state before → after
