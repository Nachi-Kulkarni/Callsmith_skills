# Prompts

Use this mode for the production voice agent's runtime prompt. Do not edit
`evals/csb/harness/prompts.mjs` unless the user explicitly asks for benchmark prompts.

## Invocation

`/callsmith prompts [target]`

- With a target, inspect and edit that prompt in place.
- Without one, locate the runtime system/developer prompt. If several are plausible, ask which one.
- Read the tool schemas and two or three representative transcripts before rewriting.

## Ownership boundary

The prompt owns conversational behavior: role, tone, language, turn length, clarification,
tool choice, confirmation, and escalation wording.

Code owns authentication, authorization, validation, retries, idempotency, consent state,
retention, VAD, barge-in cancellation, audio formats, timeouts, and handoff execution. Never
pretend a prompt instruction implements those controls.

## Rewrite loop

1. State the caller goal and the agent's allowed scope in plain language.
2. Remove duplicated product prose, examples that add no new rule, and provider physics.
3. Put hard conversational rules before style preferences.
4. Describe each tool by when to call it, required evidence, confirmation boundary, and failure behavior; do not restate its schema.
5. Make uncertainty explicit: ask one focused question or hand off—never invent customer, inventory, policy, or provider facts.
6. Keep normal turns short and natural. Ask at most one question per turn unless the product explicitly requires otherwise.
7. Preserve the caller's established language and script; do not mix languages accidentally.
8. Run the application's existing prompt integration/eval path and inspect actual transcripts. Do not claim success from a syntax check or fabricated conversation.

## Required checks

- No secrets, hidden reasoning, internal IDs, or raw tool payloads are spoken.
- Irreversible or sensitive actions require the application's real confirmation state.
- Tool failure produces a truthful recovery or handoff, not a guessed success.
- Interruption behavior is implemented in runtime code, not described as prompt magic.
- The final prompt is the shortest version that preserves every evidenced requirement.

## Output

Edit the real prompt file. Report the rules removed or changed, the integration path run,
and any behavior that still requires runtime code. Do not create a separate prompt document
unless the user requests one.
