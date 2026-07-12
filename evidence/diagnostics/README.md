# Superseded diagnostic traces

These traces changed the product and benchmark. They do **not** support a public lift claim.

All runs used Codex CLI `0.144.1`, `gpt-5.6-luna`, and `xhigh`. They were pinned to clean commits,
but predated the complete host-isolation fix in `8b5f3fb`.

## 1. BASE contamination was real

In `paired-core10-r1-group-a-20260711`, the India BASE actor read
`$HOME/.codex/skills/agent-native-architecture/SKILL.md` and its references. Another BASE trace read
the global brainstorming skill. BASE was therefore not “brief + model knowledge only.”

This produced the auth-only `HOME`/`CODEX_HOME`, plugin disablement, and sanitized-PATH boundary.
The raw India trace SHA-256 is
`daa0ab9a6bf4c4e196c5380cd128a79ac7b613376e74d4edbf80aa4914488662`.

## 2. Product-loop friction was measurable

One clinic WITH scenario was rerun while the product loop was simplified:

| Frozen commit | Commands | Trace events | Wall time | Gates |
|---|---:|---:|---:|---:|
| `68d632e` | 30 | 70 | 255.2 s | 4/4 |
| `622254a` | 17 | 53 | 242.1 s | 4/4 |
| `a9f63c6` | 9 | 38 | 175.0 s | 4/4 |

This is development telemetry, not a randomized A/B: commits differ, one scenario was used, and the
old actor environment was not fully isolated. It supports the design decision to keep the CLI
self-contained and make `contract validate --answers` own consistency checking. It does not support
“Callsmith is 31% faster” as a product claim.

Raw status SHA-256 values, in table order:

- `d13fe4ae46f96d8c39fea347d2de89423ae13f0106cd243ad11af0b12c6903e2`
- `70c503bb7ffab2599dc4f3591dc50924766afe278710f156b3e9849695ed81c0`
- `1a05a8939573dcfda6d7dd8c7de9d4fd06486553f3a6245808582af347bb0457`

## 3. Trace errors must be ordered, not merely counted

Codex sometimes emitted reconnect errors and later completed successfully. The validator originally
rejected any error event, incorrectly discarding recovered turns. It now accepts errors only when a
later `turn.completed` proves recovery, and rejects `turn.failed` or any terminal error.

## Sanitized excerpts

[`trace-excerpts.jsonl`](./trace-excerpts.jsonl) retains only the evidence needed to understand these
findings. Command output, personal paths, trace identifiers, and credentials are absent.

## Offline engineering verification

[`offline-core10-20260712.md`](./offline-core10-20260712.md) records the complete local test and
fixture-causality evaluation after the publication hardening pass. It proves the benchmark and
release machinery, not live-model product lift.

## Post-isolation live diagnostic

[`grok-core10-20260712.md`](./grok-core10-20260712.md) records the first repeated live core10 result
after the isolation boundary. It reports the 29 valid pairs, the invalid WITH arm, the no-lift cases,
and the timing tradeoff. Because one scheduled arm was invalid, it remains diagnostic and cannot be
promoted through a selective retry.
