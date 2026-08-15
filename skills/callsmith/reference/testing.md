# Test

Use this playbook for `/callsmith test` — functional conversation testing of the built voice agent. `harden` is a design checklist; this playbook proves behavior with runnable tests. Timing belongs to `latency`; stack choice to `architecture`.

## Ground truth

CI never dials the PSTN. Every layer below the pilot runs on fakes: media-file replay into the telephony webhook, a deterministic STT/TTS stub, and a simulated caller driven by the scenario. Live calls appear only in pilot sampling, never as a CI gate.

## The pyramid

| Layer | What it proves | Where it runs |
|---|---|---|
| Unit | Transform math, VAD framing, byte-budget reassembly, one state machine for WS-close + hangup (from `harden`) | Every commit |
| Scenario call test | A whole scripted call reaches the right outcome with floors intact | Every commit |
| Regression suite | A prompt or model change did not break known calls | Before any prompt/model change ships |
| Pilot sampling | Real callers behave like the scenarios assumed | Pre-launch, then periodic |

## Scenario call test anatomy

Each scenario is a caller profile + goal + assertions. Assert outcomes, never transcript text:

- **Outcome**: intent resolved, slot values captured, booking/tool call made with the typed arguments the contract declares.
- **Floors in runtime paths** (not docs): the consent utterance plays *before* sensitive capture or recording starts; a transfer-eligible utterance actually triggers the transfer path; a failed transfer falls back per the contract instead of stranding the caller; card digits route through DTMF masking (`security.md`), never a transcript.
- **Recovery**: DTMF escape after repeated ASR failure, voicemail detection, reconnect, mid-call provider 5xx.

Assert semantic facts (intent fired, slot equals X, transfer API invoked) — byte-diffing transcripts is flaky against nondeterministic STT/TTS and proves nothing.

## Regression discipline

1. Freeze the suite's scenarios and assertions; only outcomes are frozen, never prose.
2. Run before and after any prompt, model-version, or provider-leg change.
3. A regression is a behavior delta with the change named — no "prompt v7 broke 3 tests" without the failing assertion attached.
4. Per-language cohorts run as separate scenarios (`multilingual.md`); one blended pass rate hides the failing language. Include code-switch samples.

## Pilot sampling

Before launch, review a sample of real calls (listen + trace) against the same assertions. A scenario suite that real callers contradict is a suite bug, not a caller bug.

## Anti-patterns

- Byte-diff or fuzzy-string-assert on transcripts instead of outcomes
- One blended pass rate across languages or scenarios
- Live PSTN calls or vendor keys required to run CI
- Only the happy path scripted; no transfer-failure, no barge-in mid-answer, no DTMF escape
- Prompt changes shipped without the regression suite
- Barge-in tested only with clean single-speaker audio (echo/side-speaker cases live in `noise-cancellation.md`)
- Golden transcripts kept after their scenario assertions were rewritten

## Output

```markdown
## Conversation Test Plan

**Scenarios:** N (happy / recovery / floor / per-language) — listed with caller profile + goal
**Fakes:** telephony webhook sim / STT stub / TTS stub — divergence from live legs named
**Assertions:** outcomes + floor-in-runtime-path checks per scenario

### Failing now
- [scenario] assertion — actual vs expected

### Suite to add (in the project)
- …

### Contract changes required?
no / yes — sections: …
```
