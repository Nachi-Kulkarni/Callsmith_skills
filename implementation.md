# Callsmith implementation plan

Status: in progress — Gates 0, 1A, and 1A.1 closed; Gate 1B requires live credentials and a pinned target
Date: 2026-07-29
Target release: `v1.8.0-agent-compiler` ("Measured")

This is the executable plan that combines the useful parts of both frontier-model
reviews with the repository as it exists now. It does not override
[`product_decisions.md`](./product_decisions.md).

## Outcome

Ship one defensible chain of proof:

```text
same brief
  -> valid BASE/WITH artifacts
  -> two model families under one actor tool
  -> reviewed CallsmithBench claim
  -> live provider traces
  -> sanitized operational receipts
  -> measured architecture table
  -> immutable release
  -> external adopter
```

The release is done when:

1. the CallsmithBench publication reviewer emits an eligible two-family claim;
2. the three locked operational pilots emit valid, reviewed measurement receipts;
3. raw traces remain private while public artifacts are sanitized and checksummed;
4. measured values, and only measured values, reach provider packs and the README;
5. the packaged product installs through its primary paths and passes `doctor`;
6. at least one external workflow owner can reproduce the first win.

## Current baseline

Verified locally on 2026-07-31:

- `npm test`: **163/163 passing**;
- Gate 1A.1 is closed at `caacbef` (`fix(measure): complete Gate 1A.1 evidence contract`);
- verification baseline: Node `v22.23.1`, Codex CLI `0.144.1`, actor binary SHA-256
  `134063e133f0b4244fa3b251acf973d4fe4b4aeeacbdc135211bf480f59f1477`;
- provider packs, contracts, measurement replay, drain behavior, installer rollback,
  release integrity, actor isolation, and publication review are already tested;
- weekly CI, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
  `MAINTENANCE.md` already exist;
- 21 provider packs already exist;
- the live measurement runner, licensed corpus, three stack configs, and trace
  schema already exist;
- the missing live adapter files named by the stack configs do not exist;
- the Luna/xhigh 11-scenario run is retained as a diagnostic: 32/33 valid pairs,
  one unchanged answers artifact, no selective retry, and no release-level claim;
- no eligible two-family product claim exists;
- no provider-backed latency number exists;
- Gate 0's committed baseline was clean; later work must preserve unrelated user-owned changes.

The repository is not missing more product machinery. It is missing the final
provider-backed and independently reviewable evidence.

## What to keep, change, and reject from the two reviews

| Recommendation | Decision | Reason |
|---|---|---|
| Complete two-family replication | **Keep — P0** | This is the remaining product-lift publication gate. |
| Publish live provider latency | **Keep — P0** | This closes the largest gap between design evidence and operational evidence. |
| Retain invalid/no-lift cases | **Keep — invariant** | Selective retry would corrupt the estimand. |
| Add CI/install visibility | **Keep — P1** | CI exists; expose only results actually exercised through a client. |
| Add one architecture visual | **Keep — P1** | One inline Mermaid flow can replace explanatory text without adding an asset pipeline. |
| Add a terminal demo | **Defer** | Record it after the measured release so it demonstrates earned behavior. |
| Sign the mutable `curl \| bash` path | **Change** | First remove/de-emphasize the mutable path. If retained, use an explicit immutable release asset and attestation; do not build a custom signing system. |
| Add three more provider packs | **Reject** | Existing breadth is adequate. Add a pack only for a real user or pilot requirement. |
| Integrate/delete the root load-test ZIP | **Reject** | The ZIP and expanded directory are ignored local material, not shipped product. |
| Restore a scaffold migration path | **Reject** | Generation was deliberately deleted. Removed commands should point to the skill/contract path, not resurrect scaffolding. |
| Add HIPAA/SOC 2/GDPR clause mapping | **Change** | Document compliance boundaries and data handling. Do not imply certification or legal sufficiency without qualified review. |
| Build governance files | **Reject as duplicate** | The files already exist. Link and verify them instead. |
| Add adoption and ROI proof | **Keep — P2** | This requires external users; it cannot be manufactured inside the repository. |

## Non-negotiable implementation rules

- No new provider pack without a pilot or external adopter requiring it.
- No new hosted runtime, scaffold generator, or second architecture engine.
- No new root runtime dependency.
- Do not commit a live adapter until it has produced its first valid retained trace.
- Do not publish raw model/provider traces.
- Do not replace an invalid benchmark arm. Start a fresh predeclared run.
- Two product-claim model families must use the same actor tool, actor version,
  reasoning effort, seed, schedule, budget, and source commit.
- Implement the first adapter plainly. Extract shared code only after the second
  adapter proves real duplication.
- Extend existing tests instead of creating a parallel test framework.
- A green unit suite is necessary but is not live-provider evidence.

## Execution order

### Gate 0 — stabilize the baseline

Purpose: preserve current useful work and establish a known-green starting point.

- [x] Review and finish the existing user-owned changes.
- [x] Run `git diff --check`.
- [x] Run the complete local gate:

  ```bash
  npm test
  node bin/callsmith.mjs doctor
  node bin/callsmith.mjs pack validate
  node bin/callsmith.mjs verify-packs
  npm pack --dry-run --json --cache /private/tmp/callsmith-npm-cache
  ```

- [x] Commit the reviewed Gate 1A.1 baseline at `caacbef`.
- [x] Record the commit, Node version, actor binary version, and actor binary hash.

Exit:

- clean worktree;
- all gates pass.

### Gate 1 — prove operational timestamps are observable

Purpose: prevent adapters from inventing per-leg metrics that the real stack does
not expose. Verified against official docs: Gemini Live (pilots 1 & 2) is an
opaque speech-to-speech stream exposing only first output (first `modelTurn`),
interruption, turn-complete, and transcription streams — there is **no**
LLM-request/first-token, text-commit, or separate TTS-request/first-chunk event.
The cascaded stack (pilot 3) exposes all legs. The contract encodes this.

Split into 1A (contract plumbing) and 1B (live proof). **Gate 1 is partially
complete until 1B validates a real turn.**

#### Gate 1A — encode the observability contract — DONE (committed)

Status: contract plumbing shipped; enforceable; no live number published.

- [x] Profile-aware schema v2 ([`reference/turn-trace.v2.schema.json`](./reference/turn-trace.v2.schema.json)); v1 untouched. Profiles `cascaded_full`, `s2s_transport`, `end_to_end`.
- [x] Shared metric-boundary registry ([`evals/csb/latency/metrics.mjs`](./evals/csb/latency/metrics.mjs)) with an explicit `PROFILE_REQUIRED_BOUNDARIES` table (not derived from metric endpoints — deriving dropped `audio_first_playout_ms`) and an architecture/profile compatibility table.
- [x] `provider_first_output_ms` boundary (first provider response), distinct from `audio_first_playout_ms` (submitted to playout) and `audio_first_audible_ms`.
- [x] Validator accepts v1+v2; required set from the profile; ordering across present boundaries only; rejects arch/profile mismatches and negative optional timestamps; hybrid per-turn `path` removed (deferred feature).
- [x] Per-metric `n_applicable`/`n_observed` (defense-in-depth; equality holds for valid traces under a strict profile).
- [x] `run.mjs` preflights config profile + every advertised metric BEFORE the adapter is spawned (no provider spend on a bad config); spend authorization requires the approval to cover `max_spend_usd`; full provenance + `adapter_sha256` computed before execution; config/trace profile match enforced; a quality-vetoed run marks `publishable: false` and suppresses evidence.
- [x] S2S pilots moved to `stack_metrics` with empty `pack_metrics`; cascaded keeps genuine per-leg pack metrics.
- [x] Twilio `mark` documented as playback-completed, not onset.

#### Gate 1B — one real S2S turn proves observability — BLOCKER

Requires credentials + pinned target. Until this validates, **no S2S number or
pack evidence may be published, and Gate 3's cohort is blocked.**

- [ ] Choose the target: reuse a source-pinned LiveKit+Gemini deployment, or add the smallest eval-only reference target under `evals/measure/targets/livekit-gemini-live/`.
- [ ] Implement a minimal one-turn probe adapter reusing the existing `--live` path (no separate probe mode).
- [ ] Demonstrate `provider_first_output_ms` (Gemini first `modelTurn`), `audio_first_playout_ms`, and `audio_first_audible_ms` are observable on the same monotonic clock; caller-boundary audio capture supplies playout/audible.
- [ ] Retain the real trace; confirm it passes the v2 `s2s_transport` validator.
- [ ] Remove any boundary the probe disproves.
- [ ] Leave the Twilio PSTN pilot until the WebRTC probe works — PSTN additionally needs a genuine loopback/audible boundary.

Exit (Gate 1 complete):

- one real turn passes the trace validator;
- all retained timestamps share a documented monotonic clock or declared
  synchronization bound;
- no metric is attributed to a provider by subtraction or assumption.

If Gate 1B fails, stop. Publish only end-to-end metrics that are directly
observable.

### Gate 2 — add the operational publication boundary

Purpose: keep raw provider traces private while making published measurements
independently checkable.

Add:

- `evals/measure/publish.mjs`;
- one `bench:measure:publish` script in `package.json`;
- cases in the existing `test/measure-run.test.mjs`.

The command should accept a raw ignored run directory, its frozen config, and a
fresh output directory:

```bash
npm run bench:measure:publish -- \
  --source evals/measure/runs/<run-id> \
  --config evals/measure/stacks/<stack>.json \
  --out evidence/measurements/<run-id>
```

Minimum behavior:

- [ ] refuse an existing output directory;
- [ ] verify the config, corpus, adapter, target, and source hashes;
- [ ] recompute metrics from `raw-trace.json`;
- [ ] compare recomputed metrics byte-for-byte with `measurement.json`;
- [ ] reuse the existing exported JSON sanitizer rather than creating a second
  redaction engine;
- [ ] scan for credentials, emails, host paths, session IDs, and unexpected
  fields;
- [ ] publish only the frozen config, sanitized timing trace, measurement
  receipt, methodology, redaction receipt, and checksum manifest;
- [ ] keep the unsanitized raw trace under ignored `evals/measure/runs/`;
- [ ] fail on a quality veto, changed hash, unknown file, or secret finding.
- [ ] document raw-trace access, retention, and deletion before the first live
  run; collect timing events only and exclude audio/transcripts unless a
  separately approved diagnostic requires them.

Tests:

- [ ] replay fixture publishes deterministically;
- [ ] tampered trace fails;
- [ ] mismatched receipt fails;
- [ ] credential/path fixture is redacted or rejected;
- [ ] unknown publication input fails closed.

Do not copy the endgame plan's raw trace into public `evidence/measurements/`.
Only the sanitized timing trace belongs there.

### Gate 3 — implement and run the three live pilots

Purpose: create measured operational evidence without expanding Callsmith into a
runtime.

#### Pilot 1 — LiveKit + Gemini Live over WebRTC

File: `evals/measure/adapters/livekit-gemini-live.mjs`

- [ ] Join the pinned reference room as a synthetic caller.
- [ ] Play the manifest schedule at the caller boundary.
- [ ] Implement `clean`, `long`, `noise`, `barge_in`, and `silence` profiles.
- [ ] Subscribe to response audio and record only defensible trace events.
- [ ] Start with one turn, then one complete 20-clip pass.
- [ ] Run enough identical warm passes for at least 120 valid turns.
- [ ] Keep setup retries and invalid turns in the private run receipt.
- [ ] On interruption, retain the partial run as invalid; never resume it into a
  publishable cohort.
- [ ] Tear down rooms/workers and confirm no billable resources remain.
- [ ] Run the operational publisher.
- [ ] Land the adapter only with its first reviewed evidence bundle.

Exit command:

```bash
node evals/measure/run.mjs \
  --config evals/measure/stacks/livekit-gemini-live.webrtc.json \
  --out evals/measure/runs/<pilot-1-id> \
  --live
```

#### Pilot 2 — Twilio + LiveKit + Gemini Live over PSTN

File: `evals/measure/adapters/twilio-livekit-gemini-live.mjs`

- [ ] Reuse proven playback/trace code from Pilot 1 only where it is genuinely
  identical.
- [ ] Use a non-trial Twilio account; trial whisper/verified-number restrictions
  invalidate the audio path.
- [ ] Keep corpus, target stack, region, cohort, and model versions identical to
  Pilot 1 so the transport delta is attributable.
- [ ] Exercise hangup, mark/clear, interruption, and incomplete-call paths.
- [ ] Reach at least 120 valid warm turns.
- [ ] Tear down the call route and confirm no number/session/resource continues
  billing unexpectedly.
- [ ] Publish a reviewed sanitized bundle.

#### Pilot 3 — Pipecat cascaded over WebRTC

File: `evals/measure/adapters/pipecat-cascaded.mjs`

- [ ] Use LiveKit/WebRTC transport, matching the checked-in stack config. Do not
  copy the older endgame text that routes this pilot through Twilio.
- [ ] Pin Deepgram, OpenAI, Cartesia, Pipecat, and transport versions.
- [ ] Record STT, LLM, TTS, queue, delivery, and end-to-end spans only when their
  actual instrumentation boundaries match the schema.
- [ ] Hold corpus, transport, region, and cohort constant against Pilot 1.
- [ ] Reach at least 120 valid warm turns.
- [ ] Publish a reviewed sanitized bundle.

Dependency rule:

- keep provider SDKs out of the root runtime dependency set;
- use Node built-ins where sufficient;
- if an SDK is unavoidable, isolate and exactly pin adapter-only development
  dependencies and include their lock hash in the receipt;
- do not add a generic adapter framework before two real adapters demonstrate
  the same code.

### Gate 4 — update packs from receipts

Purpose: ensure the measured table and provider packs cannot drift apart.

For each eligible measurement:

- [ ] copy only publisher-reviewed `pack_evidence` fields into the relevant pack;
- [ ] set source to `callsmith_measurement`;
- [ ] include sample size, region, cohort, percentiles, corpus hash, config hash,
  target commit, adapter hash, and run date;
- [ ] update `verification.verified_at` only after re-reading the cited primary
  provider sources;
- [ ] keep unmeasured values labeled `planning_estimate` or `vendor_claim`;
- [ ] link every pack measurement to its public receipt;
- [ ] update `reference/architecture.md` from the same reviewed receipts and
  preserve `planning_unmeasured` everywhere else;
- [ ] run `pack validate`, `verify-packs`, and the full suite.

No script should blindly rewrite packs from a raw run. Human review is the
publication boundary.

### Gate 5 — complete the two-family CallsmithBench publication

Purpose: test the final measured product state and turn the strong Grok
diagnostic into an eligible product claim.

Status on 2026-07-31: the Luna/xhigh full-suite run produced 32 valid pairs and
one invalid pair. Its retained artifacts are documented as diagnostic evidence;
the raw run remains unchanged, no arm will be selectively replaced, and Gate 5
still has zero publication-eligible family runs.

Freeze:

- [ ] Finish Gates 1–4 first. Provider-pack measurements are part of the WITH
  product and must not change between the two family runs.
- [ ] Run the Gate 0 command set again and commit the final benchmark source.
- [ ] Do not change `SKILL.md`, `reference/`, `providers/`, `bin/`, `src/`,
  `data/`, CSB harness/scenarios/prompts, or scorers between the two runs and
  release. If any of them change, rerun both families.

Preflight:

- [ ] Choose two distinct model families supported by one actor tool. The
  existing reviewer rejects a Grok-plus-Codex combination as a cross-tool
  confound.
- [ ] Prefer two Codex families already recognized by
  `evals/csb/harness/actors.mjs`, provided the installed Codex CLI accepts both.
- [ ] Use the same supported reasoning effort for both families.
- [ ] Use the full current 11-scenario suite, three repetitions, both arms, one
  seed, and one source commit: 66 arms per family, 132 total.
- [ ] Confirm quota and disclosure approval before starting the run.

Run each family into a fresh directory:

```bash
npm run bench:csb -- \
  --actor-tool codex \
  --actor-model <family-a-model-id> \
  --actor-reasoning <shared-effort> \
  --runs 3 \
  --seed <frozen-seed> \
  --out evals/csb/runs/<family-a-run-id>

npm run bench:csb -- \
  --actor-tool codex \
  --actor-model <family-b-model-id> \
  --actor-reasoning <shared-effort> \
  --runs 3 \
  --seed <frozen-seed> \
  --out evals/csb/runs/<family-b-run-id>
```

Failure behavior:

- transport failure before an arm runs: retain the failed attempt and start a
  new predeclared run;
- actor completes but omits or fails to rewrite an artifact: the run remains
  diagnostic;
- any invalid arm: do not replace it and do not publish the run;
- source or actor mismatch between families: both runs are ineligible as a
  combined claim.

Build and review:

```bash
npm run bench:csb:evidence -- \
  --source evals/csb/runs/<family-a-run-id> \
  --out evidence/csb/<family-a-run-id>

npm run bench:csb:evidence -- \
  --source evals/csb/runs/<family-b-run-id> \
  --out evidence/csb/<family-b-run-id>

npm run bench:csb:review -- \
  --bundles evidence/csb/<family-a-run-id>,evidence/csb/<family-b-run-id> \
  --out evidence/csb/review-<release-id>
```

Acceptance:

- [ ] both source runs have zero invalid arms;
- [ ] both bundles independently pass provenance, redaction, checksum, and
  rescoring;
- [ ] the combined reviewer emits `product_claim_eligible: true`;
- [ ] `README-SNIPPET.md` is generated by the reviewer;
- [ ] the old Grok result remains labeled diagnostic in Honest Numbers;
- [ ] `todos/019-ready-p1-publish-callsmith-evidence.md` is updated from actual
  results, not manually declared complete.

### Gate 6 — release and README

Purpose: make existing trust surfaces visible without turning the README into a
larger wall of text.

README changes:

- [ ] replace the diagnostic headline with the generated reviewed CSB snippet;
- [ ] add the controlled S2S-WebRTC vs S2S-PSTN vs cascaded-WebRTC p50/p95 table;
- [ ] link every number to a checksummed receipt;
- [ ] add one compact Mermaid flow for skill → packs/floors → contract → checks;
- [ ] add a short "who this is for / use something else when" section;
- [ ] link `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, and
  `MAINTENANCE.md`;
- [ ] show a dated install-support matrix with `verified`, `manifest-only`, and
  `community-reported` states;
- [ ] add the CI badge only after the remote workflow passes on the exact
  release branch;
- [ ] add uninstall/rollback guidance;
- [ ] derive or test the displayed provider-pack count so it cannot silently rot;
- [ ] extend the five-minute win into a visible failing receipt → rewrite →
  passing `check` and `contract validate` loop; do not add an auto-fix CLI;
- [ ] keep legal language explicit: product floors are not certification or
  legal advice.

Installer/release changes:

- [ ] keep repository/plugin-manager installation as the primary path;
- [ ] remove the mutable `curl .../main/install-callsmith.sh | bash` command from
  the primary README unless it verifies an explicit release artifact;
- [ ] if retaining a manual remote installer, upload a versioned release asset,
  enable immutable releases/attestation, and document verification;
- [ ] do not add an independent Cosign setup unless GitHub's release attestation
  cannot cover the chosen artifact;
- [ ] exercise actual install + `doctor` for the primary supported clients;
- [ ] label unexercised clients honestly rather than treating manifest presence
  as runtime proof.

Release:

- [ ] move `CHANGELOG.md` Unreleased entries to `1.8.0-agent-compiler`;
- [ ] run the complete Gate 0 command set from the release commit;
- [ ] install the exact packed tarball into a fresh temporary prefix;
- [ ] run `doctor`, example `check`, and example `contract validate` from that
  installed artifact;
- [ ] tag the exact tested commit;
- [ ] publish npm and the immutable GitHub release;
- [ ] attach CSB and operational receipt links to the release notes;
- [ ] update `product_decisions.md` only with factual completion status;
- [ ] correct or mark superseded the stale parts of `docs/plans/endgame.md`
  (Pilot 3 transport and public raw-trace wording);
- [ ] update `SECURITY.md` and the evidence docs with the operational trace
  retention/redaction boundary;
- [ ] retain weekly CI and the maintenance wake-up contract.

### Gate 7 — external adoption

Purpose: earn evidence the repository cannot produce about itself.

- [ ] Ask one voice-workflow owner to run `/callsmith audit` on an active design.
- [ ] Capture the original design, Callsmith receipt, implementation decision,
  time spent, and what changed.
- [ ] Obtain explicit permission before publishing any organization or result.
- [ ] Publish a named case study only when the implementation owner confirms the
  before/after is accurate.
- [ ] Repeat across three materially different stacks.
- [ ] Track opt-in repeat use at 30/60/90 days; do not add hidden telemetry.
- [ ] Add providers only when an adopter needs one and supplies reviewable primary
  evidence.
- [ ] State the maintenance/business model once actual adopter expectations are
  known.

This gate is not required to prove the technical release, but it is required
before calling Callsmith a 10/10 adopted project.

## User and failure flows

| Flow | Happy path | Failure behavior |
|---|---|---|
| Product benchmark | clean source → two valid families → sanitized bundles → reviewer | any invalid arm keeps the run diagnostic; never replace it |
| Live pilot | credentials → one-turn proof → full corpus → quality pass → sanitized bundle | missing event, bad clock, quality veto, or generator fault makes the run invalid |
| Pack update | reviewed receipt → explicit pack edit → validation | raw or unreviewed measurement never reaches a pack |
| Install | plugin manager/release asset → reload → `doctor` | incomplete install rolls back; mutable/unverified remote script is not promoted |
| Contribution | sourced pack/floor/eval change → existing checks → review | unsupported claims remain `unknown`; no invented provider facts |
| Release | exact commit → full gate → packed install → immutable tag/assets | any artifact/hash/install mismatch blocks the release |

## Release-level acceptance criteria

### Product proof

- [ ] two distinct same-tool model families;
- [ ] full identical scenario suite, three repetitions, no invalid arms;
- [ ] reviewed positive product lift;
- [ ] sanitized, checksummed, independently rescored bundles.

### Operational proof

- [ ] three provider-backed pilots;
- [ ] at least 120 valid warm turns per stack;
- [ ] p50/p95 plus quality outcomes;
- [ ] exact source/config/corpus/adapter/target provenance;
- [ ] no inferred per-provider metric;
- [ ] raw/private and sanitized/public layers separated.

### Engineering

- [ ] `npm test` passes;
- [ ] pack validation and freshness checks pass;
- [ ] package dry-run contains the intended product;
- [ ] fresh packed install passes the real verification journey;
- [ ] zero new root runtime dependencies;
- [ ] no deleted generation surface returns.

### Trust

- [ ] all public numbers link to receipts;
- [ ] invalid and no-lift cases remain visible;
- [ ] primary install paths have dated runtime proof;
- [ ] remote executable artifacts are immutable and verifiable;
- [ ] compliance limits remain explicit.

## Explicitly out of scope

- more provider breadth without user demand;
- hosted Callsmith runtime;
- scaffold generation;
- legal certification;
- arbitrary dashboard/telemetry infrastructure;
- a generic capacity engine without a real target and adopter question;
- CI timing thresholds against live providers;
- a generic adapter SDK before repeated code exists;
- marketing video before the measured release;
- claims of production quality from fixture, replay, drain, or design-only tests.

## Final command checklist

```bash
git diff --check
npm test
node bin/callsmith.mjs doctor
node bin/callsmith.mjs pack validate
node bin/callsmith.mjs verify-packs
npm pack --dry-run --json --cache /private/tmp/callsmith-npm-cache
```

Then verify the evidence-specific gates:

```bash
npm run bench:csb:review -- \
  --bundles evidence/csb/<family-a>,evidence/csb/<family-b> \
  --out evidence/csb/review-<release-id>

npm run bench:measure:publish -- \
  --source evals/measure/runs/<run-id> \
  --config evals/measure/stacks/<stack>.json \
  --out evidence/measurements/<run-id>
```

Do not release because these commands merely exited zero. Release only after the
installed artifact, evidence receipts, public links, and real provider paths have
all been reviewed.

## References

- [`product_decisions.md`](./product_decisions.md) — product constitution
- [`docs/plans/endgame.md`](./docs/plans/endgame.md) — earlier endgame narrative
- [`todos/019-ready-p1-publish-callsmith-evidence.md`](./todos/019-ready-p1-publish-callsmith-evidence.md) — product-proof acceptance path
- [`evidence/README.md`](./evidence/README.md) — CSB publication contract
- [`evals/csb/README.md`](./evals/csb/README.md) — benchmark execution
- [`evals/measure/README.md`](./evals/measure/README.md) — operational measurement
- [`evals/measure/adapters/README.md`](./evals/measure/adapters/README.md) — live adapter contract
- [`MAINTENANCE.md`](./MAINTENANCE.md) — post-release wake-up contract
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [GitHub release integrity verification](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/verify-release-integrity)
