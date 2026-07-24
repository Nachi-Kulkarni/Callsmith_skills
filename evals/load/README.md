# CSB-Load drain gate

The worker command in `load.json` speaks JSONL over stdin/stdout. It emits `{"type":"ready"}`, accepts `{"type":"start","call_ids":[...]}`, emits `turn` events with `call_id` and `turn_gap_ms`, then one `call_complete` per call. On SIGTERM it must stop taking new work, finish every in-flight call, emit a `final` event with zero `stale_audio_replays`, `fd_delta`, and `active_tasks_delta`, and exit.

```bash
node evals/load/run.mjs --config load.json --out evals/load/runs/run-id
```

The gate compares one-call baseline p95 with the concurrent cohort, sends a real SIGTERM mid-call, and fails on any dropped call, stale replay/leak receipt, or p95 degradation above the configured bound.

CI proof, both run locally in seconds with no credentials: `fixtures/reference.json` passes (drain-correct worker) and `fixtures/poisoned.json` fails (drops every in-flight call on SIGTERM).
