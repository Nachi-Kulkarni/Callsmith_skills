/**
 * Actor prompts for CSB arms.
 *
 * Fairness contract (see DESIGN.md):
 * - Both prompts are short, behavior-focused, natural-register: the task as a
 *   user would state it, never an exam script.
 * - The output interface (enum tokens, receipt shape) lives in OUTPUT_SCHEMA.md,
 *   which both arms receive byte-identical. Prompts never inline gate-relevant
 *   facts the other arm cannot see.
 * - The WITH prompt only routes to the bundled skill; every fact it needs lives
 *   in SKILL.md / reference / packs / the CLI, so lift attributes to the product.
 */

export function buildWithPrompt(scenario, runDir) {
  return `You are designing a production voice agent. The Callsmith skill is installed
in this workspace — use it.

## Brief

${scenario.brief}

The workspace contains the brief (\`brief.md\`), a draft \`voice.answers.json\` that may
be incomplete or wrong, \`OUTPUT_SCHEMA.md\` specifying the two required deliverables
(the answers file and the \`callsmith.recipe.md\` handoff contract), and the Callsmith
skill: \`SKILL.md\`, provider packs under \`providers/**\`, optional playbooks under
\`reference/*\`, and the \`callsmith\` CLI on PATH.

Read \`SKILL.md\` first and work the way it directs.
Work only inside ${runDir}.
`;
}

export function buildBasePrompt(scenario, runDir) {
  return `You are designing a production voice agent.

## Brief

${scenario.brief}

The workspace contains the brief (\`brief.md\`), a draft \`voice.answers.json\` that may
be incomplete or wrong, and \`OUTPUT_SCHEMA.md\` specifying the two required deliverables:
the answers file with your design choices, and \`callsmith.recipe.md\` — the handoff
contract another engineer will build from.

Fix the answers for this brief and write the contract.
Work only inside ${runDir}.
`;
}

export function buildActorPrompt(arm, scenario, runDir) {
  return arm === 'BASE'
    ? buildBasePrompt(scenario, runDir)
    : buildWithPrompt(scenario, runDir);
}
