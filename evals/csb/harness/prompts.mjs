/**
 * Actor prompts for CSB arms.
 * No rubric walkthrough, no oracle, no target anchors, no exam script.
 *
 * Lessons from live core10 (generalized into WITH + SKILL, not BASE sabotage):
 * - Free-form synonyms break expand/check (warm_transfer, whatsapp_async, …)
 * - Fake provider ids / "none" as id = synthesis fail
 * - Empty recipe fails G_CON
 * - Contract prose must match answers floors (no consent theater)
 */

export function buildWithPrompt(scenario, runDir) {
  return `You are designing a production voice agent with Callsmith.

## Brief

${scenario.brief}

## What you have (WITH arm)

- \`brief.md\` / \`scenario.json\` — product brief
- \`voice.answers.json\` — starting draft (often wrong). **Rewrite fields**, do not only comment.
- \`SKILL.md\` — floors, **canonical option ids**, packs, contract shape (read it)
- \`providers/**\` — physics facts only from packs
- \`callsmith\` on PATH (\`./.bin/callsmith\`)
- \`OUTPUT_SCHEMA.md\` — required files
- \`reference/*\` — optional playbooks

## Compile loop (keep it short)

1. Read \`SKILL.md\` sections: **Hard floors** + **Canonical answers vocabulary**.
2. Fix \`voice.answers.json\` using **exact option ids** from the skill (never freestyle English synonyms).
3. For every provider you keep: \`callsmith pack show <id>\` or read \`providers/**\` — cite real pack ids.
4. Run \`callsmith check --answers voice.answers.json\` and fix impossibilities / wrong legs.
5. Write a **non-empty** \`callsmith.recipe.md\`: begin with the structured receipt from \`reference/contract.md\`, then all G5 sections (intent, stack, audio path, interruption, floors, latency/cost, build notes).
6. Run \`callsmith contract validate --file callsmith.recipe.md --answers voice.answers.json\` (add \`--domain\` when regulated: medical/banking/collections/legal/insurance). This owns receipt ↔ answers consistency; do not write an ad-hoc comparison script.
7. Ensure the receipt and contract floors exactly match answers (no “consent matters” while \`recording_consent: none\` on regulated flows).

## Hard constraints (bench-proven failure modes)

- **Canonical ids only** in answers: e.g. handoff=\`transfer|callback|ticket|none\` (not \`warm_transfer\`); surface=\`whatsapp_voice\` for WhatsApp notes (not \`whatsapp_async\`); consent=\`none|announce|explicit\`; retention=\`ephemeral|seven_days|thirty_days|ninety_days\`; architecture=\`realtime_s2s|cascaded|hybrid\`.
- **Language:** \`english|hindi|hinglish|multilingual|…\` — not \`english_and_hindi\` / \`bilingual_*\`.
- **Providers:** use skill menu/pack ids only. Never invent \`livekit_agents\`, \`gemini_live_2_5\`, etc. **Omit** unused keys — do not set \`"telephony": "none"\` or \`"vad": "none"\`.
- **Channel fit:** PSTN briefs → \`inbound_pstn\`/\`outbound_pstn\` + real telephony; WhatsApp voice notes → \`whatsapp_voice\` without telephony; ultra app voice → \`webrtc_app\`/\`web_voice\` + realtime, not cascaded-by-default.
- **Floors in answers**, not only prose. Urgent medical/payment/collections dispute → \`human_handoff: transfer\`.
- **No** init/forge/scaffold/simulate/intake/docs/spec.
- **No** unknown-provider synthesis.
- Work only inside ${runDir}.

## Done when

- \`voice.answers.json\` exists with canonical ids
- \`callsmith.recipe.md\` is non-empty and G5-complete
- check / contract validate would pass for your files

Required outputs: \`voice.answers.json\` and \`callsmith.recipe.md\`.
`;
}

export function buildBasePrompt(scenario, runDir) {
  // BASE must stay honest: same quality bar, no Callsmith vocabulary dump (that would fake CSB-Δ).
  return `You are designing a production voice agent.

## Brief

${scenario.brief}

## What you have (BASE arm)

- \`brief.md\` / \`scenario.json\` — the product brief
- \`voice.answers.json\` — a starting draft (may be incomplete or wrong). Fix it.
- \`OUTPUT_SCHEMA.md\` — required output files

You do **not** have a Callsmith skill, provider pack library, or verification CLI. Use your own knowledge.

## Your job

Produce the best production design you can:

1. Fix \`voice.answers.json\` for this brief (surface, stack, language, consent, retention, handoff, tools, …). Prefer **simple machine-readable string enums** (short tokens like \`transfer\`, \`inbound_pstn\`, \`explicit\`) over long free-form phrases.
2. Write a **non-empty** \`callsmith.recipe.md\` covering: intent, stack, audio path, interruption/barge-in, floors (consent/retention/handoff/tools), latency/cost (with a percentile target), build notes. If the output schema specifies a machine-readable contract receipt, include it.
3. Match the channel: phone vs WhatsApp/async vs in-app WebRTC. Do not invent fake vendor product codenames.

## Constraints

- Work only inside ${runDir}.
- Required outputs: \`voice.answers.json\` and \`callsmith.recipe.md\` (both must exist and be non-empty).
- Same time and quality bar as any serious production design task — do not phone it in.
`;
}

export function buildActorPrompt(arm, scenario, runDir) {
  return arm === 'BASE'
    ? buildBasePrompt(scenario, runDir)
    : buildWithPrompt(scenario, runDir);
}
