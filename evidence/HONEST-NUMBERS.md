# Honest Numbers

Callsmith measures whether a coding agent produces a voice design whose floors, provider physics,
contract, and reality traps all pass. It does not measure a deployed call.

## The number that will count

The primary number is paired task-success lift:

```text
mean(success(WITH) - success(BASE))
```

Success is binary. `G_FLOOR`, `G_PHYS`, `G_CON`, and `G_REAL` must all pass. A strong average cannot
hide an unsafe or physically impossible result.

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

Those cases remain in the report. No-lift scenarios, invalid arms, contamination bugs, and losing
secondary metrics are not removed from the published bundle.

## Why earlier runs are not the headline

The July 11 diagnostics found useful product effects, but BASE could discover personal skills and a
globally installed Callsmith CLI through inherited host state. That violates the ablation. The fixed
runner now uses an auth-only home, sanitized PATH, disabled plugins/hooks/memories, an isolated Git
root, and fail-closed trace validation. Results from before that boundary stay diagnostic.

See [diagnostic history](./diagnostics/README.md).
