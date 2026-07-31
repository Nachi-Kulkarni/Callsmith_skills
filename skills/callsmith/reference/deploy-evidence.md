# Capacity evidence and attribution

Compute results from caller media sent, agent media received, lifecycle events, and optional
transcripts/probes. Define every timing anchor explicitly so two runs remain comparable.

## Measure the voice path

- **response start:** first voiced agent audio minus the caller’s last voiced frame; anchor at speech
  end, not when silence detection finishes;
- **first session response:** first agent audio minus session start; keep cold and warm cohorts
  separate;
- **mid-utterance gap:** a long gap followed by more speech; do not count normal utterance endings;
- **streaming factor:** voiced audio duration divided by delivery duration for each utterance; report
  the worst utterance rather than averaging across silence;
- **interruption latency:** caller speech onset during agent speech to the last agent frame;
- **conversation pace:** turns per call, turns per second, and actual duration divided by scripted
  duration;
- **lifecycle:** admission latency, rejections by reason, abandoned calls, orphaned sessions, and
  reconnects;
- **correctness:** semantic pass rate, truncated output, tool success, and violations by concurrency;
- **cost:** provider usage and cost per call or per concurrent-session hour.

Bucket outcomes by concurrency at call start. Pool raw samples for percentiles, sum counters, and
keep gauges per target.

## Attribute before judging

Evaluate in this order and stop at the first supported cause:

1. **Generator bound:** media deadlines missed, generator CPU saturated, or generator event loop
   delayed. Mark the run invalid.
2. **Caller degraded:** caller-side synthesis/model quota or stream stalls. Do not blame the target.
3. **Media path bound:** jitter or gaps rise while application workers stay cool.
4. **Provider bound:** external speech/model errors or throttling rise without worker pressure.
5. **Dependency bound:** database, API, or broker latency rises while worker pressure stays flat.
6. **Application red line:** capacity rejections, event-loop delay, hot workers, mid-speech gaps, or
   inability to stream in real time cross their budgets.
7. **Application degraded:** user-facing latency or correctness crosses budget without a hard red
   line.
8. **Healthy:** no threshold crossed. Report a lower bound, not a ceiling.

Cap confidence when direct per-target probes are missing. Treat symptoms with a cold application as
media/dependency evidence, not application capacity.

## Emit one result contract

Write a versioned `run.json` containing:

- harness and target versions;
- included boundary and adapter roles;
- arrival stages, call cap, audio/network profile, caller type, and region;
- attempted, admitted, completed, rejected, abandoned, orphaned, and backlogged calls;
- raw-sample summaries plus results by scenario and concurrency;
- per-target application/dependency peaks and per-generator health;
- injected-failure and correctness outcomes;
- attribution, verdict, confidence, evidence statements, and generated caveats.

Gate run validity before SLI thresholds. Require clean pacing, exclusive identities, valid lifecycle
receipts, and attribution other than generator/caller failure. A schema-valid artifact is not proof
that a real deployment was measured.

## Convert evidence to capacity

Use the highest clean load level before an attributed application red line. Use the hottest
worker’s peak, not fleet total, as the per-target ceiling.

Estimate demand with:

`peak_concurrency = arrivals_per_hour * average_call_minutes / 60`

Then size targets from measured per-target capacity, explicit headroom, and the worst observed burst.
Do not apply the formula to an invalid run or an unlocated ceiling.

For four or more load levels, optionally fit a contention/coherency curve to distinguish serialized
work from cross-node coordination. Use the fit as diagnosis, not as a replacement for observed
evidence.

## Grade confidence

Call confidence high only when the generator has headroom, each target is probed directly, load
levels reach steady state, nondeterministic callers are repeated, call duration matches production,
and generator placement matches production. Otherwise list the missing conditions and label the
result medium or directional.

Keep raw diagnostics private. Sanitize traces, verify provenance and hashes, rescore independently,
and review publication separately before making a public capacity claim.
