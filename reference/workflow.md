# Shared contract workflow

Callsmith's durable output is a small, reviewable evidence trail—not generated application scaffolding.

## Repository artifacts

Commit these beside the voice-agent implementation:

- `voice.answers.json`: canonical design choices used by physics checks
- `callsmith.recipe.md`: structured receipt plus the human handoff contract
- turn traces that contain no sensitive payloads, or an aggregate latency report derived from them

Do not put secrets, transcripts, raw audio, or patient/customer content in these artifacts. A project may ignore root-level scratch files, but example and service-level contracts are intentionally committable. Review receipt changes like API or infrastructure changes: provider, policy, jurisdiction, and SLO changes should be visible in Git history.

## Local loop

```bash
callsmith check --answers path/to/voice.answers.json
callsmith contract validate --file path/to/callsmith.recipe.md
callsmith verify-packs
```

The coding agent then implements against the accepted contract. Re-run validation after any stack, channel, policy, or latency-budget change.

## CI gate

Use the same verifier; do not create a second policy engine in a workflow wrapper.

```yaml
- run: npm ci
- run: node bin/callsmith.mjs verify-packs
- run: node bin/callsmith.mjs check --answers services/voice/voice.answers.json
- run: node bin/callsmith.mjs contract validate --file services/voice/callsmith.recipe.md
```

## Thin runtime adapters

Claude Code, Codex, Cursor, Copilot, Gemini CLI, and OpenCode should all load the canonical `SKILL.md`, relevant `reference/*` playbooks, and `providers/**`. A slash command, hook, plugin manifest, or CI workflow is only a router:

1. pass the user's brief to the agent;
2. load the canonical skill and only relevant packs/playbooks;
3. invoke the same verification CLI;
4. return its unmodified status and evidence.

An adapter must not duplicate floors, provider facts, contract schemas, scoring rules, or generation logic. If behavior belongs to every runtime, change the canonical skill/reference/pack/verifier once.
