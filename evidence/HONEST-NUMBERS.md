# Honest Numbers

Callsmith measures whether a coding agent produces a voice design whose floors, provider physics,
contract, and reality traps all pass. It does not measure a deployed call.

## The number that will count

The primary number is paired task-success lift:

```text
mean(success(WITH) - success(BASE))
```

Success is binary: the safety choices, audio path, handoff file, and contradiction checks must all
pass. A strong average cannot hide an unsafe or physically impossible result.

This is a strict “ready for engineering handoff” score, not a judgment of whether the model can
build anything useful. A reasonable draft still counts as a miss when even one required safety,
audio, or handoff detail is absent.

## Latest full-suite diagnostic

On 2026-07-31, GPT-5.6 Luna at `xhigh` completed 32 of 33 scheduled pairs validly across the current
11-scenario suite. A review of the retained final artifacts with the current deterministic rules
found 128/128 individual checks passed with Callsmith and 26/128 without it. The assisted artifacts
met all four checks in every valid pair; the unassisted artifacts did not meet all four together.
Warnings that did not make the audio path impossible remained visible without erasing valid audio
evidence. No model calls were repeated and the original raw run was left unchanged.

The unassisted result does not mean the model produced nothing useful. It met the safety-choice
check in 14/32 pairs and avoided the named hard contradictions in 12/32. What it did not produce was
a single artifact that satisfied all four strict handoff checks at once.

| Valid paired result | Without Callsmith | With Callsmith |
|---|---:|---:|
| Individual checks passed | 26/128 (20.3%) | 128/128 (100%) |
| Ready for handoff (all four checks) | 0/32 | 32/32 |
| Safe consent, retention, and handoff | 14/32 | 32/32 |
| Compatible providers and audio path | 0/32 | 32/32 |
| Complete handoff file | 0/32 | 32/32 |
| No hard contradictions | 12/32 | 32/32 |

One scheduled WITH arm finished with its answers file unchanged, so the complete run remains invalid
and non-publishable. This is a single-family diagnostic, not Callsmith's release claim. See the
[plain-language report](./diagnostics/luna-xhigh-full-suite-20260731.md).

## Earlier Grok diagnostic

On 2026-07-12, Grok-4.5 at `high` completed 29 of 30 scheduled paired core10 trials validly. Across
the valid pairs, WITH succeeded 29/29 and BASE succeeded 3/29: a paired lift of 0.897, with a 95%
paired-bootstrap interval from 0.759 to 1.000.

This is diagnostic evidence, not the release result. The missing pair was not a transport outage:
the WITH actor completed its turn but did not update `voice.answers.json`. Excluding that pair is why
the run is marked `run_valid: false` and `publishable: false`. Selectively rerunning and replacing the
failed arm would condition the result on failure and is not allowed. The next eligible attempt is a
new, complete, predeclared run.

| Valid paired result | Without Callsmith | With Callsmith | Lift |
|---|---:|---:|---:|
| Individual checks passed | 38/116 (32.8%) | 116/116 (100%) | +67.2 pp |
| Ready for handoff (all four checks) | 10.3% | 100% | +89.7 pp |
| Safe consent, retention, and handoff | 62.1% | 100% | +37.9 pp |
| Compatible providers and audio path | 10.3% | 100% | +89.7 pp |
| Complete handoff file | 10.3% | 100% | +89.7 pp |
| No hard contradictions | 48.3% | 100% | +51.7 pp |

BASE already succeeded in three valid pairs: `clinic-implement-golden` trial 1, `bank-kyc` trial 2,
and `whatsapp-not-pstn` trial 3. Median actor time was 54.0 seconds for BASE and 58.1 seconds for WITH;
WITH was slower in 13 of 29 valid pairs and faster in 16. These are actor wall-clock measurements,
not deployed call latency or token economics.

## What it can establish

- Whether Callsmith changes final design artifacts relative to the same model without Callsmith.
- Whether regulated defaults are rewritten in machine-readable answers and contracts.
- Whether provider/audio choices agree with the checked pack library.
- Whether the result survives deterministic anti-demo traps.
- How sensitive that effect is to scenario and model family.

## What it cannot establish

- Production call quality, uptime, or real-user task completion.
- Legal or regulatory compliance.
- Security beyond the named deterministic gates.
- Actual speech-end to first-audible latency; that belongs to the separately controlled CSB-Turn track.
- Token-price or whole-session economics unless provider usage receipts are present.
- That packs, floors, skill instructions, or the CLI individually caused the result; WITH tests them as one product.
- A universal model-independent effect. Results are scoped to exact model/tool versions and budgets.

## When Callsmith may not help

- BASE already knows the provider physics and chooses the correct floors.
- The task contains no provider ambiguity, regulated floor, or voice-specific trap.
- The model spends extra time reading packs without changing the final design.
- A provider pack is stale, incomplete, or wrong. Pack validation checks provenance shape and expiry,
  not live source truth.
- The design passes static gates but fails when implemented or deployed.

Those cases remain in the report. No-lift scenarios, invalid arms, contamination failures, and losing
secondary metrics are not removed from the published bundle.

## Why earlier runs are not the headline

The July 11 diagnostics found useful product effects, but BASE could discover personal skills and a
globally installed Callsmith CLI through inherited host state. That violates the ablation. The fixed
runner now uses an auth-only home, sanitized PATH, disabled plugins/hooks/memories, an isolated Git
root, and fail-closed trace validation. Results from before that boundary stay diagnostic.

See [diagnostic history](./diagnostics/README.md).
