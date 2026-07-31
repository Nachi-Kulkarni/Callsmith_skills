# Closing the loop — the endgame scenario

Status: plan, written 2026-07-24. Everything below the adapter boundary is already
machine-proven in CI. This is the fastest honest path from here to "released and
not looked at for a long time."

> Superseded in part on 2026-07-31: the shareable `v1.8.0-agent-compiler` release no longer waits for
> live-provider spend. The live measurement work remains a separate evidence milestone in
> [`release-roadmap.md`](./release-roadmap.md). Raw traces stay private; only sanitized timing bundles
> may enter public evidence.

## The day the project is done

Roughly two weeks after keys are in hand. `v1.8.0-agent-compiler` is tagged, the
npm package is published, and the GitHub release is titled **"Measured."**

What exists that day:

- **Eight packs carry `callsmith_measurement` evidence.** gemini-live, livekit,
  silero (pilot 1); twilio (pilots 2–3); pipecat, deepgram, openai, cartesia
  (pilot 3). Each entry: p50/p95/p99, region `us`, `sample_size >= 100`, warm
  cohort, and a methodology string naming the corpus hash, config hash, and run
  date. `verification.verified_at` bumped; fresh 90-day expiry runway.
- **`evidence/measurements/` holds one sanitized receipt directory per pilot stack**: the
  allowlisted timing trace, emitted `measurement.json`, methodology, redaction receipt, and checksum
  manifest. Unsanitized traces remain private. Every published number links back to its receipt.
- **The README's S2S-vs-cascaded section is a real table**: same frozen 20-clip
  corpus, same region, three stacks, per-leg and end-to-end turn-gap
  percentiles. Whatever the numbers are — the table's existence is the moat.
  Nobody else publishes controlled-corpus per-leg turn-gap percentiles for
  these stacks; this project would be first.
- **`reference/architecture.md` cites measured numbers where they exist** and
  keeps `planning_unmeasured` labels everywhere else. The honesty gradient
  stays intact.
- **A weekly scheduled CI workflow runs the full gate** (`npm test`,
  `pack validate`, `verify-packs`). Green badge is silence. Red is the only
  pager.
- **`product_decisions.md` declares feature-complete.** `subtraction.md`
  unchanged — nothing added since the deploy/measure regime landed, nothing
  left to remove.
- **A short MAINTENANCE note** states exactly what may wake the project up
  (expired evidence, dead pack source URLs, a provider breaking change reported
  in an issue) and what may not (feature requests → the pack PR template;
  questions → discussions).

Then the laptop closes.

## The critical path — four moves, not forty

The only code left is three adapters, and they share ~80%: corpus reader,
playback-profile renderer (clean / long / noise / barge-in / silence →
8 kHz μ-law frames), and the turn-trace writer. Only the transport differs.

**Move 1 — adapter 1, LiveKit WebRTC (the only hard one, ~1 session).**
A Node synthetic participant: join the room where the reference agent
(LiveKit Agents + Gemini Live + Silero) runs, publish each corpus clip as an
audio track on the manifest schedule, subscribe to agent audio, stamp
playback-known `speech_end` against the first audible agent frame, write the
turn trace. ~250 LOC. Then the warm run: 20 clips × 5 passes ≈ 100 turns ≈
15–25 minutes of wall time. `measurement.json` drops out; three packs get
measured evidence.
*Exit: `node evals/measure/run.mjs --config evals/measure/stacks/livekit-gemini-live.webrtc.json --live` exits 0; receipt committed.*

**Move 2 — adapter 2, Twilio PSTN into LiveKit (~½ session).**
Same player, new boundary: Twilio REST originates the call to the LiveKit SIP
trunk; a bidirectional Media Stream back-feeds the corpus frames (barge-in
profile = paired clip offset 300 ms; noise profile = pre-mixed seeded variants).
Trace writer reused verbatim. Run, receipt, commit. The WebRTC↔PSTN delta is
now attributable — same corpus, same region, same model.

**Move 3 — adapter 3, cascaded stack (~½ session).**
Same Twilio feed into a Pipecat pipeline (Deepgram → OpenAI → Cartesia) on a
us-pinned worker. Trace writer reused again. Run, receipt, five packs updated.
The architecture matrix gets its first measured row.

**Move 4 — release (one morning, no code).**
Re-verify the handful of most-volatile pack sources and bump dates for maximum
expiry runway; move CHANGELOG Unreleased → `[1.8.0] — Measured`; `npm version`
+ publish; tag; GitHub release notes generated from the receipts; one
announcement post, because that's the point of the moat. (The weekly CI cron
and `MAINTENANCE.md` already exist — Move 4 is the version bump and the
announcement.)

## The honest catch: this project is designed to decay

"Not looking back" cannot mean freezing it — `verify-packs` carries
`expires_at`, doctor goes red when evidence ages out, source URLs rot,
providers ship breaking changes. The loop doesn't close by stopping change; it
closes because **the project watches itself**:

- Weekly CI runs the whole gate. Green = silence. Red = the only thing allowed
  to page you.
- One quarterly hour: re-open the most volatile doc pages, bump `verified_at`,
  done. That is the entire maintenance budget. (The cold cohort — same harness,
  fresh infra — rides along on the first refresh; v1 of the numbers ships
  warm-only and says so in the methodology string.)
- Everything else answers itself: packs are data, CONTRIBUTING shows the shape,
  and the publication standard rejects unsourced claims without a human in the
  loop.

**Total cost of the endgame: ~3 adapter sessions + one release morning +
1 hour per quarter.** What's left behind is the only measured, hash-pinned,
reproducible turn-gap dataset for these stacks in the open — and a repo that
only speaks up when reality moves first.
