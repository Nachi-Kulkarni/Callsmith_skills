# Contributing to callsmith

callsmith is a recipe compiler for voice AI agents. Contributions that make the audio-contract resolution more accurate, the scaffold more runnable, or the provider packs more current are the highest-value work here.

## Setup

```bash
git clone <this-repo>
cd callsmith
npm install        # dev dependencies only (none today; the tool is zero-dep)
npm test           # 168+ behavior tests must pass
```

There are no runtime dependencies — callsmith runs on Node >=18 with only the standard library. Keep it that way unless the addition is clearly worth the supply-chain cost.

## What to work on

- **Provider packs** (`providers/<kind>/<id>.json`): the highest-leverage contribution. Each pack declares a real audio contract (ingest/egress format, sample rate, codec), lifecycle events, potholes, latency/cost estimates, and interruption metadata. Add a new provider by dropping in a pack — no code changes required. Validate with `node bin/callsmith.mjs verify-packs`.
- **Pack freshness**: model IDs and pricing drift. Update the `model` and `cost_estimates` fields against live docs, then run the staleness guard tests.
- **Scaffold depth**: make generated projects more runnable (health endpoints, mock modes, structured logging). See `src/lib/scaffold.mjs`.
- **Resolver correctness**: if callsmith emits a wrong audio contract or misses an impossibility, that is a bug. Add a fixture or test first, then fix.

## How to add a provider pack

1. Create `providers/<kind>/<id>.json` following `providers/_schema.json`.
2. Run `node bin/callsmith.mjs verify-packs` — it must report 0 failures.
3. Add an option to `data/menu.json` that maps to the new provider, or select it via the free-text provider id in an answers file.
4. Add a test in `test/packs.test.mjs` if the pack has a non-default shape.
5. Run `npm test` — all tests must pass.

## Pull request checklist

- [ ] `npm test` passes (green)
- [ ] `node bin/callsmith.mjs verify-packs` reports 0 failures (if packs changed)
- [ ] No new runtime dependencies without justification
- [ ] If you changed audio-contract resolution, add or update a fixture that exercises the change

## Commit style

Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Keep the subject line under 72 chars.

## Releasing

Releases are currently manual (npm publish is pending a scoped-name decision). Tagged commits on `main` are the source of truth until CI publishing is wired.
