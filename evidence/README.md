# Callsmith evidence

This directory is the public proof surface for Callsmith.

## Current status

No release-level product-lift number is published yet. The latest Luna/xhigh full-suite diagnostic
found 128/128 individual checks passed with Callsmith and 26/128 without it. The assisted artifacts
met all four strict handoff checks in 32/32 valid pairs; the unassisted artifacts did not meet all four
together. One of 33 scheduled pairs was invalid, so the run remains non-publishable and will not be
repaired with a selective retry. Read the
[plain-language diagnostic](./diagnostics/luna-xhigh-full-suite-20260731.md), the
[earlier Grok diagnostic](./diagnostics/grok-core10-20260712.md), and
[Honest Numbers](./HONEST-NUMBERS.md).

Earlier runs that predate the complete actor-isolation boundary remain
[diagnostic history](./diagnostics/README.md) and are not pooled into a CallsmithBench headline.

A public claim requires two frozen model-family evaluations. For each family:

- all ten core scenarios;
- paired BASE and WITH arms;
- three counterbalanced repetitions;
- no invalid arms;
- pinned model, reasoning, tool version, commit, seed, and budgets;
- positive reviewed task-success lift and interval;
- floor lift at least `+0.5`, physics lift at least `+0.4`, and BASE floor/physics failure rate at least `0.6`;
- sanitized receipts and traces covered by a checksum manifest.

See [Honest Numbers](./HONEST-NUMBERS.md) for what the benchmark can and cannot establish.

## Publication layout

```text
evidence/
  README.md
  HONEST-NUMBERS.md
  diagnostics/
  csb/<frozen-run-id>/
    config.json
    summary.json
    report.md
    REDACTION.md
    MANIFEST.sha256
    case-studies/
    trial-*/<scenario>/<arm>/...
```

Raw local runs stay under ignored `evals/csb/runs/`. Build an allowlisted, sanitized bundle with:

```bash
npm run bench:csb:evidence -- \
  --source evals/csb/runs/<frozen-run-id> \
  --out evidence/csb/<frozen-run-id>
```

The builder refuses malformed traces, removes command output, redacts local paths/identifiers and
common credentials, excludes unknown files, generates paired BASE/WITH case studies, and hashes
every published artifact.

After building two model bundles, run the release reviewer:

```bash
npm run bench:csb:review -- \
  --bundles evidence/csb/<model-a>,evidence/csb/<model-b> \
  --out evidence/csb/review
```

It writes `product-claim.json` and `RESULTS.md`, and exits nonzero unless both bundles are sanitized,
complete repeated core10 runs with distinct pinned model IDs, distinct named model families, identical
frozen controls, checksum-valid receipts, and every documented lift threshold.
Only an eligible review emits `README-SNIPPET.md`; that reviewed snippet becomes the measured-evidence
section near the top of the project README.
