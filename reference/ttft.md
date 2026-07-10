# TTFT Pilot

> TTFT is only the LLM submetric. For the user-perceived metric from acoustic speech end to first audible agent audio, use [`latency.md`](latency.md). The `/callsmith ttft` route remains compatible for LLM-provider diagnosis; `/callsmith latency` is the primary end-to-end optimization route.

Measure time-to-first-token for the LLM leg in cascaded or hybrid voice-agent stacks. Agent ritual — not a bundled deterministic library.

## When to run

- Architecture is cascaded or hybrid.
- Comparing LLM providers.
- Latency budget is near the target.
- User says the bot “feels slow” before TTS begins.

Skip pure realtime S2S unless a comparable text-token stream is actually in the path.

## Ask for a key

If missing from the environment, ask the user to fetch a free/trial key and put it in the shell env — not committed files.

| Provider | Env var | Key page |
|---|---|---|
| OpenAI | `OPENAI_API_KEY` | `https://platform.openai.com/api-keys` |
| Anthropic | `ANTHROPIC_API_KEY` | `https://console.anthropic.com/settings/keys` |
| Google Gemini | `GOOGLE_API_KEY` or `GEMINI_API_KEY` | `https://aistudio.google.com/apikey` |

## Measurement contract

- `first_byte_ms`: request sent → first response byte
- `first_text_ms`: request sent → first non-empty text delta
- `complete_ms`: request sent → stream completion

≥ 3 trials. Tiny prompt shaped like the agent’s real first turn.

| p50 first text | Verdict |
|---:|---|
| `<= 300ms` | Excellent |
| `301–500ms` | Usable for many pilots |
| `501–800ms` | Risky; shorten prompt, faster model, or realtime |
| `> 800ms` | Bad fit for low-latency turn-taking |

For phone agents, treat `>500ms` as a serious design finding unless the flow is deliberately slow.

## How to run

Use the target project’s SDK/settings, or a throwaway scratch script outside the package. Do not add provider SDKs to callsmith for this.

## Report

```markdown
## TTFT Pilot

Provider/model: ...
Prompt shape: ...
Runs: 3

| Run | First byte | First text | Complete |
|---:|---:|---:|---:|

**Verdict:** ...
**Decision:** Keep provider / shorten prompt / change LLM / switch architecture
```

If the result is poor, present 2–3 concrete options. Never silently swap the provider.
