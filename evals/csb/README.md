# CallsmithBench (CSB)

For operational speech-end → first-audible latency measurement, use the separate [CSB-Turn track](latency/README.md). Core CSB measures design/implementation artifacts; CSB-Turn scores p95 `turn_gap_ms` improvement behind quality vetoes.

**Design:** [`DESIGN.md`](./DESIGN.md)
**Scenario schema:** [`schema/scenario.v1.md`](./schema/scenario.v1.md)
**Constitution:** [`../../product_decisions.md`](../../product_decisions.md)

## What the benchmark publishes

The primary metric is the paired lift in **task-success rate** between WITH and BASE. A task succeeds only when all four machine gates pass. `G_REAL` is a hard veto, so a pretty contract cannot compensate for a physically impossible or unsafe design.

```
CSB success lift +?.??? · WITH ??% · BASE ??% · pass^3 ??%
```

The harness also reports a deterministic 10,000-resample paired-bootstrap 95% interval for the lift, reliability as `pass^k`, and per-gate lift. Mean gate-score delta remains available only as a diagnostic; correlated gates are not added together as the headline claim.

No public number has been published yet. Fixture scoring proves scorer causality, not product lift.

## Four binary gates

1. **G_FLOOR** — sealed consent, retention, handoff, and poison rewrite.
2. **G_PHYS** — surface and provider compatibility, including transform cost.
3. **G_CON** — structured contract validation and answers cross-check.
4. **G_REAL** — deterministic reality traps (`no_pstn_to_web`, `no_ticket_on_urgent`, `no_synthesis`, `no_deleted_generators`, `no_consent_none_regulated`).

## Valid-trial rules

A live arm is unscorable if the actor fails, times out, reports an error, omits an artifact, leaves an empty artifact, or reuses a stale pre-actor artifact. The runner exits nonzero when any live arm is invalid.

A publishable run also requires:

- a clean Git worktree and recorded commit;
- an explicit `--actor-model` pin and detected actor-tool version;
- a new, unused output directory;
- prompt, scenario, harness, and provider-pack SHA-256 hashes;
- recorded time/output budgets and arm timing;
- paired BASE/WITH trials for every scheduled scenario;
- retained stdout, stderr, and a sanitized full session export when the actor tool exposes one.

The runner supports `opencode` and subscription-authenticated `codex` actors. Codex runs are
ephemeral, ignore personal configuration/rules, execute inside a nested isolated Git root, and
retain the CLI JSONL event stream as the arm trace. `codex login status` must report a valid login.

## Commands

```bash
# CI
npm run test:csb

# Prepare isolated workspaces; never scored
npm run bench:csb:dry -- --scenario clinic-floor-poison --runs 3 --seed experiment-1

# Gold-fixture scorer demo; never publishable
npm run bench:csb:fixtures -- --scenario clinic-floor-poison

# Repeated paired live trials. Model pin is mandatory.
npm run bench:csb -- \
  --scenario clinic-floor-poison \
  --actor-model provider/model-version \
  --runs 3 \
  --seed experiment-1

# Codex CLI via ChatGPT subscription, with model and reasoning both pinned.
npm run bench:csb -- \
  --actor-tool codex \
  --actor-model gpt-5.6-luna \
  --actor-reasoning xhigh \
  --runs 3 \
  --seed luna-xhigh-20260711
```

`--runs N` repeats each scenario N times. `--seed` deterministically shuffles scenario order and counterbalances which arm runs first. Every trial is stored under `trial-NNN/<scenario>/<arm>` so attempts cannot overwrite one another.

## Arm honesty

| Arm | Gets | Does not get |
|---|---|---|
| **BASE** | brief, seed answers, output schema | skill, packs, CLI, oracle/tags |
| **WITH** | brief, seed, skill, packs, CLI shim, references | oracle/tags/manifest |

Both arms get the same unlabeled seed, brief, actor model, and budget.

## Outputs

- `config.json` — complete reproducibility manifest and deterministic schedule.
- `trial-NNN/.../actor.status.json` — process result, validity decision, timing, and trace receipt.
- `trial-NNN/.../reproducibility.json` — model/tool/budget and content hashes for that arm.
- `trial-NNN/.../score.json` — emitted only for valid actor output.
- `summary.json` — primary success lift, interval, `pass^k`, diagnostics, and invalid arms.
- `report.md` — compact human-readable result.

## Layout

```
evals/csb/
  DESIGN.md
  schema/scenario.v1.md
  oracles/{floors,physics,real,contract-gate,levels}.mjs
  harness/{actors,prepare,prompts,run-arms,score,validity}.mjs
  scenarios/<id>/{manifest,tags,oracle,brief,poisoned.answers.json,fixtures/}
```
