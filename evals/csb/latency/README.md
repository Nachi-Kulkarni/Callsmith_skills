# CSB-Turn

CSB-Turn measures whether an optimization reduces user-perceived silence without buying speed through cutoff, false interruption, wrong answers, or broken audio.

The primary score is:

```text
baseline p95 turn_gap_ms - candidate p95 turn_gap_ms
```

A positive result passes only when every quality veto passes. Controlled traces require labeled speech ends and the same `turn_id` sample set in both arms, so candidates cannot drop difficult turns; they are deterministic/CI-eligible. Live traces preserve raw observed samples and environment tags; they are reported but explicitly `ci_eligible: false` because provider and network variance must not be invented away.

```bash
npm run bench:turn
npm run bench:turn:score -- --baseline before.json --candidate after.json
node --test test/csb-turn.test.mjs
```

Fixtures exercise fast-valid, slow-valid, premature-cutoff, false-interruption, and missing-event behavior. See [`../../../reference/latency.md`](../../../reference/latency.md) for timestamp semantics, instrumentation, budgets, and the experiment protocol.
