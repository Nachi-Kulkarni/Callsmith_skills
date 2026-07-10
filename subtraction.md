# callsmith — Subtraction (complete)

> Historical cut map. **Not constitution.** Forward law: [`product_decisions.md`](./product_decisions.md).

## Status: DONE (1.6.0-agent-compiler)

Deterministic **generation** removed. Deterministic **verification** kept thin.

### Deleted

- `scaffold` / `forge` / `init` / `simulate` / `docs` / `intake` / `spec` / `explain` / `release-check` (CLI exits 2)
- Engine modules: scaffold, compile, simulate, docs, registry (synthesis), release-check, safe-write
- `data/presets.json`, bench fixture grid, generation-era tests
- Engine-archive product decisions file

### Kept

| Keep | Why |
|---|---|
| `SKILL.md` + `reference/*` | Agent compile path |
| `providers/**` | Physics stdlib |
| Hard floors | Rewrite policy |
| Eval harness + scenarios + rubric | Design quality bar |
| Thin CLI | `packs` / `pack show` / `pack validate` / `verify-packs` / `check` / `contract validate` / `doctor` |
| Resolver physics (library) | Powers `check` only |
| Example contracts | e.g. `examples/clinic-triage/` (G5 golden) |

### P0 wedge (from constitution)

> pack physics inspect + floor receipts + contract validate + eval gate

Do not reintroduce deleted generation surfaces.
