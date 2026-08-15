# Maintenance

Callsmith is feature-complete. It is designed to decay loudly rather than rot
quietly: this file is the contract for what may wake the project up and what
may not. Endgame context: [`docs/plans/endgame.md`](./docs/plans/endgame.md).

## What pages the owner (and why)

| Signal | Where | What it means | Response |
|---|---|---|---|
| Weekly CI goes red | `.github/workflows/ci.yml` (Monday cron) | Pack evidence expired (`verify-packs` `expires_at`), or a pack/schema/test drifted | The quarterly ritual below |
| Dead pack source URLs | `verify-packs` failures, issue reports | A provider moved its docs; the pack's evidence basis is gone | Re-verify against the new primary source, update `sources` + `verified_at` |
| Provider breaking change | issue reports, provider changelogs | A pack fact is now wrong (audio format, limits, lifecycle) | Patch the pack with a dated source; the schema and `pack validate` do the rest |
| First measurement runs | owner decision | Live adapters land with their first retained raw trace (`evals/measure/adapters/README.md`) | Follow `docs/plans/endgame.md` moves 1–4 |

Nothing else pages anyone. Feature requests are answered by the repo itself:
packs are data, `CONTRIBUTING.md` shows the shape, and the publication standard
rejects unsourced claims automatically. Questions go to discussions.

## The quarterly ritual (one hour, four times a year)

0. Run `node bin/callsmith.mjs verify-packs --due --within 45` — the treadmill
   report lists every pack needing re-verification, in expiry order, with its
   primary source. (Weekly CI already fails hard on *expired* evidence via
   `doctor` and the real-clock pack test; this step is the heads-up.)
1. Re-open the most volatile pack sources (pricing, limits, model versions,
   regions) and re-verify against `reference/current-docs.md` policy.
2. Bump `verification.verified_at` (and `deployment.regions.verified_at` where
   touched) so `verify-packs` stays green with honest dates — never bump a date
   without re-reading the source.
3. Run any measurement refresh that is due (`evals/measure/stacks/`, cold
   cohort on the first refresh after a measured release).
4. If nothing changed: that is the ritual. Close the laptop.

## What done looks like

Green weekly CI, pack evidence inside its expiry window, and no human watching
the repo. The project watches itself; red is the only pager.
