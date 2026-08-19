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

## First-speaker contract

For outbound and proactive calls, default to the agent speaking first unless the product contract
explicitly chooses user-first. Put the short, once-only identity, purpose, and permission opener in
the system prompt. The prompt defines **what** to say; runtime code decides **when** a turn starts.

Do not expect a system prompt such as “greet immediately” to create an assistant turn. After the
carrier or client confirms answer/media readiness, orchestration must send the provider-supported
startup stimulus: an in-conversation text/message or explicit response request. Never feed silence,
noise, or fake caller audio merely to trip VAD. Route the timing, input gate, timeout, and replay
rules through `harden`; route pickup-to-first-audible measurement through `latency`.

## Spoken delivery

Define personality as audible behavior—turn length, contractions, correction, hold, and farewell
patterns—not adjectives such as “friendly.” Keep only two or three real-call examples when they
teach cadence or repair better than a rule. Use disfluencies sparingly and in the active language.
Emit pause, emotion, laughter, or SSML tags only when the selected synthesis path supports them and
the rendered audio was tested; otherwise use plain text. Narrate a wait once, not every internal step.

## Rewrite loop

1. State the caller goal and the agent's allowed scope in plain language.
2. Remove duplicated product prose, examples that add no new rule, and provider physics.
3. Put hard conversational rules before style preferences.
4. Describe each tool by when to call it, required evidence, confirmation boundary, and failure behavior; do not restate its schema.
5. Make uncertainty explicit: ask one focused question or hand off—never invent customer, inventory, policy, or provider facts.
6. Keep normal turns short and natural. Ask at most one question per turn unless the product explicitly requires otherwise.
7. Preserve the caller's established language and script. A garbled token, shared acknowledgement,
   proper noun, borrowed word, or unexpected STT script is not enough evidence to switch languages.
   Interpret ambiguous sounds using the current language and trusted call context; if a name, place,
   or intent is still uncertain, confirm it instead of silently translating or correcting it.
8. Run the application's existing prompt integration/eval path and inspect actual transcripts. Do not claim success from a syntax check or fabricated conversation.

## Required checks

- No secrets, hidden reasoning, internal IDs, or raw tool payloads are spoken.
- Irreversible or sensitive actions require the application's real confirmation state.
- Tool failure produces a truthful recovery or handoff, not a guessed success.
- Garbled or low-confidence speech never counts as consent, confirmation, or a reason to switch languages; ask one short retry in the caller's last stable language.
- Interruption behavior is implemented in runtime code, not described as prompt magic.
- Agent-first behavior has a real post-answer startup trigger; the prompt alone is not credited.
- The final prompt is the shortest version that preserves every evidenced requirement.

## Output

Edit the real prompt file. Report the rules removed or changed, the integration path run,
and any behavior that still requires runtime code. Do not create a separate prompt document
unless the user requests one.
