# Callsmith evidence

This directory is the public proof surface for Callsmith.

## Current status

No product-lift number is published yet. Earlier live runs helped improve the product and benchmark,
but they predate the complete actor-isolation boundary. They are retained only as
[diagnostic history](./diagnostics/README.md), not pooled into a CallsmithBench headline.

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
    trial-*/<scenario>/<arm>/...
```

Raw local runs stay under ignored `evals/csb/runs/`. Build an allowlisted, sanitized bundle with:

```bash
npm run bench:csb:evidence -- \
  --source evals/csb/runs/<frozen-run-id> \
  --out evidence/csb/<frozen-run-id>
```

The builder refuses malformed traces, removes command output, redacts local paths/identifiers and
common credentials, excludes unknown files, and hashes every published artifact.
