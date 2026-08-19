---
name: callsmith
description: "Use when a user is building, changing, reviewing, debugging, testing, or shipping software that listens and speaks: phone agents, WebRTC or app voice, voice notes, and STT-to-LLM-to-TTS or realtime speech stacks. Also trigger when such a system waits for the caller to speak before greeting, has slow first audio, broken interruption or echo, audio-format mismatches, unsafe consent, retention, or handoff, uncertain provider or architecture choices, deploy drops, multilingual failures, or unproven scale and cost claims. Turn the brief or code into pack-backed decisions, enforced safety floors, measured audio behavior, a validated handoff contract, and framework-native implementation."
argument-hint: "[audit|critique|architecture|latency|ttft|prompts|harden|deploy|noise-cancellation|security|multilingual|test|monitor|cost|check|packs] [target]"
allowed-tools: Bash(callsmith *), Bash(node *), Bash(npx callsmith *), Bash(ctx7 *), Read, Write, Edit, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

# callsmith

Convert the user's brief or existing voice code into clear decisions, one validated handoff contract, and working code in the project's framework.

Use provider packs for audio, interruption, deployment, and cost facts. Apply the safety rules in `reference/policy.md`. Verify the result with the CLI when it is available.

`product_decisions.md` is the product constitution: the agent writes the design and code; Callsmith checks domain facts, safety floors, and the eval bar.

Ask only the questions needed to settle the current design. Load the relevant packs, rewrite unsafe defaults, write one handoff contract, and implement with LiveKit, Pipecat, or the project's existing framework. Callsmith does not generate scaffolds or run a fixed questionnaire.

Voice failures usually sit in the audio and call-control path: μ-law 8 kHz and PCM transforms, barge-in, echo ownership, provider quirks, consent, retention, and human handoff.

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
| `test` | `reference/testing.md` | Functional conversation tests: scenario call suites, floor-in-runtime-path assertions, regression discipline |
| `monitor` | `reference/observability.md` | Production SLO + floor telemetry, per-leg spans, barge-in/transfer/reconnect alerts, pack-drift rebaseline |
| `cost` | `reference/cost.md` | Per-leg $/min from pack `cost_estimates`, evidence classes, S2S-vs-cascaded comparison with stated assumptions |

No argument → default compile loop below. That is every project's starting point — there is no `init`.
`check` / `packs` → verification CLI only (not playbooks).
These are agent modes, not generators.

## Lifecycle: suggest the next command

End **every** invocation — compile loop or playbook — with one line telling the user the next command to run and why, picked here. If the suggestion is already done (check `callsmith.decisions.md`), suggest the next undone step on the main path.

Main path: **compile (no argument) → audit → harden → latency → deploy → test → monitor → cost**; re-run `audit` whenever the stack or packs change.

| Just finished | Suggest next |
|---|---|
| compile loop | `audit` — score the design before building further |
| `audit` | re-run the compile loop to clear the punch list, then `harden` |
| `critique` | `architecture` if the winner is still unclear, else compile to apply it |
| `architecture` | compile to apply the decision, then `prompts` |
| `prompts` | `harden` |
| `harden` | `latency` |
| `latency` | `ttft` if the turn gap points at the LLM leg, else `deploy` |
| `ttft` | `deploy` |
| `noise-cancellation` | `latency` — re-measure the cleaned channel |
| `security` | `harden`, then back to the main path |
| `multilingual` | `latency` — per-language turn gap, never one blended number |
| `deploy` | `test` |
| `test` | `monitor` — once real callers are live |
| `monitor` | `cost` — once there is traffic to account for |
| `cost` | `audit` — periodic re-score of the whole design |

## Your job (compile loop)

Step 0 — if `callsmith.decisions.md` exists, read it and resume from its **Next step**; do not re-ask questions it already answers.

1. **Converse** — dig deeper on vague intent (domain, surface, language, compliance, tools, handoff stakes).
2. **Load packs** — for each provider under consideration, read `providers/<kind>/<id>.json` (or `callsmith pack show <id>`). Do not invent sample rates, barge-in mechanics, or potholes. Note each loaded pack's `verification.expires_at`; if past (or near), tell the user the pack is stale and verify against current official docs before relying on it.
3. **Verify current APIs** — before implementation, load `reference/current-docs.md`, note today's date, and check version-specific SDK/API usage through Context7 when available. Compare the lookup date with pack evidence/expiry dates. If Context7 is unavailable, use an available web-fetch/browse tool to read the provider's official documentation. Record source and access date. Never guess an API from model memory.
4. **Apply floors** — load `reference/policy.md` and rewrite design when defaults violate policy. Change **answers fields**, not only prose. Tell the user before → after.
5. **Normalize vocabulary** — every policy/stack field uses the canonical option IDs in `reference/policy.md`. Free-form synonyms fail tools and gates.
6. **Physics check** — if the user has answers JSON, run `callsmith check --answers <file>`. Unknown providers: **do not synthesize** — research, write a pack, or refuse to ship.
7. **Write one non-empty handoff contract** — `callsmith.recipe.md` with all required sections (below). Empty or stub files fail.
8. **Self-check before done** — `callsmith check` clean (or pack-backed transforms stated) + `contract validate --file callsmith.recipe.md --answers voice.answers.json` when CLI available. Trust this semantic cross-check; do not hand-roll a receipt comparison script. If no CLI is installed, compare the receipt against `voice.answers.json` by eye using the schema in `reference/contract.md`, and say plainly that the check was manual, not tool-verified.
9. **Implement** — you write the code. Prefer framework APIs. No `callsmith scaffold` (removed).
10. **Quality modes** — audit / critique / architecture / prompts / harden / deploy / latency / noise-cancellation / security / multilingual / test / monitor / cost as needed. Use ttft only to isolate the LLM leg. Use noise-cancellation when contaminated input, echo, side speech, or false barge-in requires an audio-processing decision. Use security when payment capture, PII persistence, or caller-driven tool injection is in scope; use multilingual when callers mix or switch languages. Use architecture when S2S-vs-cascaded is unresolved; use deploy before any pilot with real callers; use test after implementation to prove conversation behavior and floors in runtime paths; use monitor when the app is live and the receipt's SLO and floors need watching; use cost when a stack comparison or budget needs per-leg numbers with evidence classes. Follow the capacity branch routed by `reference/deploy.md` before designing a load harness or stating a concurrency ceiling, calls-per-pod number, pod count, or autoscaler threshold.
11. **Close the loop** — append this session's entry to `callsmith.decisions.md` (template below) and end with the lifecycle suggestion.

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

## Project state: `callsmith.decisions.md`

The append-only memory that makes a fresh session stateful. First action of every invocation — compile loop or playbook: if it exists, read it. Last action: append one dated entry per session:

```markdown
## <date> — /callsmith <command run>
- Decided: <choice> — <one-line why>
- Rejected: <option> — <one-line why>
- Floor rewrites: <field>: before → after (or "none")
- Mistakes to avoid: <anti-pattern caught or gate failed this session> (or "none")
- Open questions: <still needs the user's answer> (or "none")
- Next step: /callsmith <command> — <why>
```

Never delete or rewrite old entries — the history **is** the mistake trace. Every answered question, rejected option, and failed gate gets its line. A new session with zero context must be able to continue from this file plus `voice.answers.json` and `callsmith.recipe.md` alone.

## Progressive disclosure

| Stage | Load |
|---|---|
| Start | User brief + this skill + floors |
| Choosing providers | Only relevant `providers/**/*.json` |
| Physics | `callsmith check` or pack fields (ingest/egress/interruption) |
| Implement | Current version-specific docs + pack potholes for chosen stack |
| Deploy | `reference/deploy.md` + pack `deployment` fields + `check` Operations |
| Capacity / scale | `reference/deploy.md` → `reference/deploy-capacity.md`; load workload or evidence detail only when needed |
| Worked example | `examples/clinic-triage/` — a full contract + answers pair that passes `check` and `contract validate` |

Quality-mode loads (audit / critique / architecture / prompts / harden / deploy / latency / noise-cancellation / security / multilingual / test / monitor / cost) follow the routing table above — one playbook per invocation, no preloading.

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

## Provider packs (22)

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

- **Plain words, one idea per question.** Ask "Where will people talk to this agent? (a phone call / WhatsApp voice notes / an app)" — not "What surface class?". Ask "How fast should replies feel? (instant, like a live person / a short pause is fine / no rush)" — not "What's your turn-gap budget?". Ask "Does this touch health, money, or legal matters? (yes / no / not sure)" — not "Is the domain regulated?".
- If your harness has an interactive question tool (AskUserQuestion / ask / qna), prefer it: 2–4 short concrete options per question, as many rounds as needed. In plain text, 2–3 questions at a time.
- Record each answer in `callsmith.decisions.md` as it is given — that is the decision tracking.
- Natural language → map to concrete stack decisions
- Prefer pack-backed tradeoffs over generic “use LiveKit” vibes
- After floor rewrites, state before → after
