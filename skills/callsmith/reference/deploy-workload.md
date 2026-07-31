# Constructing voice load

Model a call as a long-lived, stateful, two-way media stream. Use concurrent sessions and call
arrivals as load units; use request rate only for the individual services behind the call.

## Pace media

Convert caller audio to one internal uncompressed mono format. Keep codec conversion and resampling
inside the media adapter and record the chosen resampler because it can change recognition quality.

Send fixed-duration frames on monotonic deadlines:

1. Reframe provider output into exact frame sizes.
2. Advance from an absolute deadline; do not repeatedly sleep for one interval and accumulate drift.
3. Send silence frames during pauses unless the real transport explicitly suppresses silence.
4. Reset after a small missed-deadline allowance; never burst old frames to catch up.
5. Record deadline error. Mark the run invalid when its high percentile exceeds one frame duration.

Timestamp received audio at the earliest adapter boundary. Avoid attributing harness queueing to the
system under test.

## Choose arrival models

Use both regimes:

- **Closed loop:** hold N active calls and replace completed calls. Use to answer “how many
  simultaneous calls fit?” Record turn rate and call-duration dilation because a slow system
  silently reduces offered load.
- **Open loop:** start calls at a scheduled rate regardless of response speed. Use to expose queue
  growth, rejection, and collapse. Bound in-flight work for safety, but report unmet starts as
  backlog rather than hiding them.

Connect them with `concurrency = arrival_rate * mean_call_duration`.

Select profiles by question:

- **staircase:** hold successive levels long enough to reach steady state and find the bend;
- **burst:** start many calls together and test admission;
- **soak:** hold realistic calls long enough to expose leaks and context growth;
- **replay:** reproduce a time-varying production arrival trace;
- **recovery cycle:** repeatedly cross the suspected ceiling and back off to test scaling and drain.

Model retries explicitly with bounded attempts, backoff, jitter, and identity cooldown. Prevent a
rejected identity from creating an accidental retry storm.

## Choose caller realism

Start cheap and deterministic, then add realism:

1. Use silence or tone to find the media generator’s own ceiling.
2. Replay licensed human recordings for repeatable recognition load.
3. Synthesize scripted lines for deterministic conversational timing.
4. Use a realtime role-player only for behavior that requires interaction; repeat nondeterministic
   runs and report medians.

Match production call length, bandwidth, codec artifacts, noise, jitter, loss, interruption, and
tool use. Generate caveats for every disabled condition. Never let an inline judge or expensive
caller perturb the system being measured; score stored outputs after the run.

## Scale the generator

Split the target concurrency or arrival rate across generators; do not duplicate the full plan on
each box. Partition identities deterministically, synchronize the start, and keep generator health
per box. Pool raw latency samples before recomputing percentiles; never average percentiles. Sample
system telemetry once from the coordinator so observation load does not multiply with generators.

Place generators near the target. Treat cross-region delay as part of the workload only when it
matches production.

## Inject failures safely

Exercise media loss, reconnect, stalls, malformed frames, duplicate lifecycle events, abrupt hangup,
provider errors, and worker termination. Record each injection and grade it `survived`, `degraded`,
or `dropped`. Keep mutating business actions on non-production targets with explicit authorization.
