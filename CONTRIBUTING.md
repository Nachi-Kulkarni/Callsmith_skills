# Contributing to callsmith

**Constitution:** [`product_decisions.md`](./product_decisions.md).
callsmith teaches coding agents to design production voice agents and verifies pack physics, floors, and the eval bar. The agent compiles; this repo does not generate apps.

## Setup

```bash
git clone <this-repo>
cd callsmith
npm test           # pack + verification CLI tests must pass
```

Zero runtime dependencies. Node >= 18. Keep it that way unless the supply-chain cost is clearly worth it.

## Highest-value work

- **Provider packs** (`providers/<kind>/<id>.json`) — audio contract, interruption, potholes, evidence-dated latency/cost, env keys, and primary sources. Validate: `node bin/callsmith.mjs pack validate` and `verify-packs`.
- **Hard floors** in `SKILL.md` / playbooks / eval rubric — rewrite policy, not flag-only theater.
- **Eval scenarios + binary rubric** (`evals/csb/`) — design-quality typechecker for the agent.
- **Physics inspect** (`check` / resolver) — correct transforms and impossibilities from pack data.
- **Handoff contract receipt** (G5) — semantic policy/provider/latency validation plus explanatory prose.

## Do not contribute

- Scaffold / forge / init / simulate / synthesis paths
- Expanding menu-as-coverage-law
- Byte-identical lock as product identity
- Features that only deepen deterministic **generation**

## How to add a provider pack

1. Create `providers/<kind>/<id>.json` following `providers/_schema.json`, including verification grade/date/sources and honest latency evidence where claimed.
2. Run `node bin/callsmith.mjs pack validate` and `verify-packs` — 0 failures.
3. If `data/menu.json` is used for `check` expand, add an option that maps to the pack (or select free-text provider id in answers).
4. Run `npm test`.

## Pull request checklist

- [ ] Changes align with [`product_decisions.md`](./product_decisions.md)
- [ ] `npm test` passes
- [ ] `node bin/callsmith.mjs pack validate` / `verify-packs` clean if packs changed
- [ ] No new runtime dependencies without justification
- [ ] No resurrection of deleted generation surfaces

## Commit style

Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`). Subject under 72 chars.
