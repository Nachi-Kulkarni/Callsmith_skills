# Luna/xhigh full-suite diagnostic

> **RETRACTED (2026-08-15).** The numbers in this report cannot be reproduced from retained
> artifacts and are withdrawn. They were produced under a pre-fairness harness whose BASE arm
> lacked the published output interface, and the scoring provenance is no longer trustworthy.
> Replaced by the fairness-hardened runs in
> [`csb-fair-harness-20260815.md`](./csb-fair-harness-20260815.md).

The same coding model received the same voice-agent brief twice. One run worked normally; the other
could also use Callsmith's guidance, provider facts, and checks. Both had to finish the design files.

## Result

The run scheduled 33 pairs across 11 scenarios and three repetitions. One assisted arm finished with
its answers file unchanged, leaving 32 valid pairs. A review of those retained final artifacts with
the current deterministic rules produced:

| Strict handoff check | Without Callsmith | With Callsmith |
|---|---:|---:|
| Individual checks passed | 26/128 (20.3%) | 128/128 (100%) |
| Ready for handoff (all four checks) | 0/32 | 32/32 |
| Safe consent, retention, and handoff | 14/32 | 32/32 |
| Compatible providers and audio path | 0/32 | 32/32 |
| Complete handoff file | 0/32 | 32/32 |
| No hard contradictions | 12/32 | 32/32 |

The original raw run was not changed and no model call was repeated. Warnings that did not make the
audio path impossible remained visible without erasing valid audio evidence.

## How to read the two totals

The unassisted artifacts earned 26 individual checks. That is useful partial work, not an inability
to build a voice agent. Many drafts were plausible and made useful choices.

The “ready for handoff” row asks a different, deliberately all-or-nothing question. A design misses
it when any one of these is absent:

1. safe consent, retention, and human handoff choices;
2. an audio path that the selected providers can actually carry;
3. a complete machine-readable handoff that matches the prose;
4. no invented provider, channel mismatch, or other hard contradiction.

This benchmark measures consistency at that final handoff boundary. It does not measure coding
ability, deployed call quality, uptime, or whether a human could repair a promising draft.

## What changed in the artifacts

The assisted artifacts consistently turned reasonable ideas into reviewable decisions: exact policy
values, named provider ownership, explicit audio transforms, and a handoff file that agreed with the
design. The unassisted artifacts often explained the right concern but left at least one required
choice implicit or inconsistent.

## Status

This remains a single-family diagnostic. One of 33 scheduled pairs was invalid, the traces remain
private, and a release claim still requires a fresh complete run plus a second eligible model family.
