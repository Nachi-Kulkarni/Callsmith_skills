# Capacity workflow

Use this branch of `/callsmith deploy` for concurrency ceilings, calls per worker, pod counts,
autoscaler thresholds, load tests, bursts, and soak runs. Treat capacity as a measured property of a
specific system boundary and workload—not as a provider feature.

## Route the work

1. Define the system boundary. Name every included and bypassed media relay, worker, model provider,
   datastore, and broker.
2. Define the production workload. Record arrival rate, concurrent calls, call length, turn rate,
   language, audio path, interruption rate, tool use, and regional placement.
3. Read [deploy-workload.md](deploy-workload.md) to construct traffic that behaves like voice rather
   than HTTP.
4. Establish a known-good baseline against a controllable fake target before testing the real
   system. Prove that the generator can sustain the planned frame rate and concurrency.
5. Run a staircase to locate the bend, a burst for admission, a soak for leaks, and a recovery cycle
   for autoscaling. Do not substitute one profile for all four questions.
6. Read [deploy-evidence.md](deploy-evidence.md) to validate the generator, attribute the bottleneck,
   classify the result, and calculate capacity.
7. State one of three outcomes: `invalid run`, `lower bound >= N`, or `attributed ceiling N per
   target`. Never turn “highest level attempted” into a ceiling.

## Build in this order

1. Implement paced media, one lifecycle adapter, deterministic caller audio, core latency/choke
   metrics, and a versioned result artifact.
2. Prove the generator against a fake target with an adjustable ceiling.
3. Add real lifecycle/media adapters and direct per-target telemetry.
4. Add open-loop arrivals, realistic audio/network conditions, production-length calls, and bursts.
5. Add interruption, semantic correctness, fault injection, and multiple generators.
6. Add CI regression gates only after the measurement definitions stabilize.

Keep the engine stack-neutral. Adapt six roles instead of forking the engine:

- **identity lease** — reserve any state-bearing identity so concurrent calls do not collide;
- **session lifecycle** — start, stop, and optionally update a call;
- **media stream** — send caller audio and receive agent audio;
- **caller workload** — produce speech and react to responses;
- **system probe** — sample each worker or dependency directly;
- **correctness check** — score the completed interaction offline.

Describe unfamiliar technology by role on first mention. For example: “a room-and-track media server
that routes participant audio,” not an unexplained product or protocol name. Keep product-specific
envelopes, codecs, authentication, and SDK calls inside adapters.

## Refuse these claims

- Refuse capacity from a passing graceful-drain test; it proves shutdown behavior only.
- Refuse capacity when the generator misses media deadlines or exhausts its own CPU/quota.
- Refuse fleet-summed calls as a per-worker ceiling; use the hottest target.
- Refuse a production projection from short, clean, wideband calls when production is longer,
  narrowband, noisy, or cross-region.
- Refuse destructive scenarios against production or without explicit authorization.
- Refuse public numbers from raw traces; retain, sanitize, and review evidence separately.

## Output

```markdown
### Capacity evidence
Boundary: included components; excluded components
Workload: arrival model, call length, audio/network profile, caller type
Result: invalid / lower bound >= N / ceiling N per target
Attribution: generator / caller / transport / provider / dependency / application / healthy
Confidence: high / medium / directional — missing conditions
Artifact: run.json path
Sizing: expected peak concurrency, headroom, burst factor, required targets
Caveats: generated from disabled realism, missing probes, and untested paths
```
