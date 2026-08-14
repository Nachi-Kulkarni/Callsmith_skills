# Noise Cancellation and Competing-Speaker Control

Use this playbook for `/callsmith noise-cancellation`. Design the smallest open-source audio chain that removes the named contaminant without deleting the caller.

## Contents

1. [Operating rules](#operating-rules)
2. [Write the audio contract](#write-the-audio-contract)
3. [Choose the correct class](#choose-the-correct-class)
4. [Open-source stack](#open-source-stack)
5. [Build one rung at a time](#build-one-rung-at-a-time)
6. [Sustained level gate](#sustained-level-gate)
7. [Speaker-attributed control](#speaker-attributed-control)
8. [Prove the result](#prove-the-result)
9. [Anti-patterns](#anti-patterns)
10. [Office experiment ledger](#office-experiment-ledger)
11. [Current primary sources](#current-primary-sources)

## Operating rules

- Name the problem before choosing a model: acoustic echo, non-speech noise, side speech, and true overlapping speech require different systems.
- Protect clean primary speech first. A chain that removes interference by deleting target words fails.
- Do not call VAD, a level gate, diarization, or speaker verification “source separation.” They can decide when to pass a mixed region; they cannot reconstruct one voice from mono overlap.
- Keep one owner for each job: one echo canceller, one main enhancer, and one gain controller.
- Prevent adaptive gain after deliberate attenuation; it can raise suppressed regions again.
- Default to fully open-source, local processing. Use commercial isolation only when the user explicitly allows it.
- Treat every CPU, latency, threshold, and attenuation number in the field ledger as a measured prior, not a production promise.

## Write the audio contract

Record before implementation:

- surface and transport: browser/WebRTC, SIP/RTP, PSTN, app microphone, or file;
- channel count, sample format/rate, frame size, codec history, and resampling owner;
- contaminant: render echo, stationary/transient noise, reverberation, side speaker, or mixture;
- whether side speech overlaps the target and at what side-to-target ratios;
- how the target is known: dominant/nearest, first speaker, explicit enrollment, or unknown;
- existing frontend, transport, and provider processing;
- maximum algorithmic delay, p95 processing time, CPU/RSS per concurrent call, and queue bound;
- privacy and consent requirements for raw and enrollment audio.

If these are unknown, inspect the real audio path and obtain a short consented diagnostic sample. Do not infer behavior from a feature name such as “noise cancellation.”

## Choose the correct class

| Requirement | Smallest plausible class | Cannot do |
|---|---|---|
| Agent/playback echo returns through the microphone | AEC with synchronized render reference | Remove an unrelated room speaker by identity |
| Fan, HVAC, traffic, hiss, keyboard | WebRTC NS or RNNoise; test DeepFilterNet if quality warrants compute | Reliably choose one human voice over another |
| Quieter side speech mainly in target pauses | Sustained level-relative gate | Preserve target during equal-level mono overlap |
| Reject non-target turns/side-only regions by identity | VAD + speaker embeddings + attributed gate | Recover target samples from simultaneous voices |
| Preserve target during single-channel overlap | Target-speaker extraction or speech separation | Guarantee low CPU, no enrollment, or generalization |
| Multiple microphones available | Beamforming/spatial filtering before monaural inference | Add spatial cues to an already mixed mono stream |

The decisive question is: **must the target remain intact while the unwanted speaker talks at the same time?** If yes on one channel, use TSE/separation or change capture geometry.

## Open-source stack

### WebRTC Audio Processing Module

Use WebRTC APM for established AEC, background noise suppression, high-pass filtering, gain control, and VAD when the application owns the capture path. AEC requires the render stream; a microphone-only file cannot perform real echo cancellation. Configure AEC, NS, and AGC separately.

Do not disable AEC merely because a custom denoiser is added. Do disable or relocate adaptive gain that follows deliberate gating when measurement shows it restores suppressed regions.

### RNNoise

Use RNNoise for lightweight recurrent non-speech noise suppression. Its upstream example consumes raw 16-bit mono PCM at 48 kHz, so framing, resampling, and WAV parsing remain integration work. It is trained from clean speech plus noise; it is not a target-speaker model.

### DeepFilterNet

Use DeepFilterNet for full-band 48 kHz speech enhancement when its runtime/model cost is justified. Prefer its maintained native path where practical. Account for resampling, STFT/model lookahead, recurrent state, and warmup. Any side-speaker reduction is workload-specific; prove it rather than relabeling the model as voice isolation.

### DTLN and PercepNet

Keep DTLN and ordinary PercepNet in the speech-enhancement class. The archive named both as lightweight alternatives, but neither name alone proves maintained weights, deployable licensing, streaming integration, or speaker selection. Personalized PercepNet is a different target-voice research path.

### Silero VAD

Use Silero VAD for streaming speech probability at 8 or 16 kHz when the framework’s existing VAD is insufficient. Keep state per stream and reset between calls. It detects speech, not speaker identity.

### ECAPA-TDNN speaker embeddings

Use SpeechBrain or WeSpeaker ECAPA embeddings for enrollment, verification, clustering, and speaker-attributed gating. Calibrate on the deployed language, codec, room, microphone, demographics, and window length. Do not copy cosine thresholds across models or preprocessing.

If using ONNX, pin preprocessing with the weights, set intentional thread counts, and verify numerical parity against the source runtime.

### TSE and separation

Use Asteroid, WeSep/REAL-TSE baselines, or a published implementation for actual overlap extraction. Verify code, pretrained-weight, and training-data licenses separately. Visible source does not imply shippable weights.

Named comparisons from the archive have boundaries:

- SpeakerBeam-SS is a target-speaker-extraction paper; do not assume official deployable weights.
- OpenSpeakerBeam-SS is an independent reimplementation whose repository still marks its license TBD.
- Waveformer’s released code is class-conditioned target **sound** extraction, not automatically target-speaker enrollment.
- TargetVoice was a comparison point, not part of the proven open-source office chain.

## Build one rung at a time

Start with the platform feature already present. Add one stage, rerun the complete battery, and retain it only when it improves the written acceptance contract.

```text
decode once -> resample once -> AEC when this layer owns synchronized render
            -> raw/AEC tap for speaker evidence
            -> one main noise enhancer
            -> optional sustained gate or speaker controller
            -> fixed gain/limiter -> STT/VAD/turn detector
```

Ordering is not universal. Ablate it. If a browser or managed transport already applies learned enhancement, obtain raw audio or disable the duplicate stage before adding another learned suppressor. Preserve standard echo cancellation when needed.

## Sustained level gate

Use a gate only when side speech is usually quieter or occurs during target pauses. The durable office finding is delayed closing plus a closed hold: short low-energy target dips are common, so fast closing shreds words.

Track state per short fixed frame:

```text
level      = frame RMS in dBFS
speech     = VAD decision/probability
envelope   = robust high percentile of recent accepted speech levels
floor      = noise estimate with faster downward than upward movement
threshold  = envelope - depth_db

if strong target-level evidence:
    pass; refresh hangover
elif level >= threshold:
    pass; reset below-threshold duration
elif hangover remains:
    pass
elif already closed:
    remain attenuated until strong target evidence returns
elif below-threshold duration >= close_sustain_ms:
    enter closed state
else:
    pass
```

Smooth gain; never hard-zero. Update the envelope only from accepted speech-like frames. Keep the threshold relative so whole-mixture gain changes do not change behavior.

Use the office configuration only as a sweep seed:

- 10 ms decision frames;
- 2 s running 90th-percentile envelope, seeded by roughly 1.5 s speech;
- close sustain 300 ms;
- depth sweep 4/6/8 dB;
- attenuation sweep 25/40 dB;
- overlap margin 3 dB;
- hangover 120 ms;
- attenuation attack about 5 ms, release 50–100 ms.

Require these invariants: near-zero false close on target-only audio; whole-mixture gain invariance; suppressed frames never train the envelope; no one-syllable reopen while closed; no downstream adaptive gain restoration; bounded queues.

## Speaker-attributed control

Use identity when muting a complete non-target region is acceptable.

1. Enroll from an explicit clip or a precisely defined in-call event.
2. Require enough clean single-speaker speech before forming a centroid.
3. Extract embeddings from the least-distorted usable tap.
4. Compare with target and optional non-target centroids.
5. Keep an unknown band; do not force every window to target or side.
6. Apply gain only after sustained evidence.
7. Bypass/re-enroll if target-only engagement crosses a safety limit.

“First voice wins” fails when an IVR, agent greeting, bystander, or playback echo is first. Short windows react faster but weaken embeddings; long windows leak before deciding. Enhancers may shift embeddings, so compare raw/AEC-only/enhanced taps.

During overlap, muting the mixture removes both speakers and passing it retains both. Route “keep the enrolled caller while removing simultaneous mono speech” to TSE. Embeddings may condition a TSE model, but that is a separator rather than a gain gate.

## Prove the result

Keep byte-stable source audio and a manifest of consent, real/synthetic status, language, device, codec, target/side transcripts, labeled activity windows, SNR, and side-to-target ratio.

Minimum battery:

1. clean target only;
2. target + non-speech noise at realistic and stress SNR;
3. side speech in pauses;
4. partial and heavy overlap;
5. quiet/far and loud/near target;
6. playback echo and double-talk when relevant;
7. deployed codec/packet behavior;
8. production-length streaming soak;
9. at least one held-out genuine room/call recording.

Synthetic mixtures control timing and ratios but are not the only proof for embeddings or learned separation. Sweep whole-mixture gain separately from target-to-interference ratio.

Report:

- target WER/CER or exact phrase retention, including overlap regions;
- unwanted-speaker leakage in side-only and overlap regions;
- target-only RMS/quality delta and false-suppression time;
- average attenuation plus fixed short-window peak attenuation;
- gate/lock engagement and transition count;
- DNSMOS/P.835 or SI-SDR only as supporting metrics where valid;
- algorithmic/buffering delay, frame p50/p95/p99, and turn-gap impact;
- RTF/one-core percentage, RSS, host, versions, threads, and load average;
- dropped/late frames, queue depth, clipping, discontinuities, and listening notes.

Pin code, model weights, corpus, STT judge, and configuration. Evaluate before/after in the same batch. Reject “side words disappeared” until every required target phrase remains. Delete stages with no incremental benefit. Ship behind a feature flag with observable safe aggregates and an owner for rollback.

## Anti-patterns

| Anti-pattern | Detection |
|---|---|
| Call every contaminant noise | Label echo, non-speech noise, side-only speech, and overlap separately |
| Fast-close or absolute-level gate | Measure target-only false closes and whole-mixture gain invariance |
| Learn envelope from suppressed frames | Assert only accepted speech updates it |
| Adaptive gain after attenuation | Compare suppressed-region level with downstream AGC on/off |
| Stack learned suppressors | Ablate each stage; keep only incremental winners |
| Treat VAD/diarization as separation | Measure target retention inside overlap windows |
| Copy embedding thresholds | Calibrate false rejection/acceptance on deployed audio |
| Blind first-speaker enrollment | Test wrong-first-speaker and recovery |
| Use only TTS or pause-only tests | Require held-out real audio and overlap |
| Report average attenuation only | Pair with short-window peak and engagement trace |
| Use quality score as sole verdict | Require transcript retention and listening |
| Benchmark busy/unidentified host | Record host, load, threads, RTF, and concurrency soak |
| Resample repeatedly | Trace every rate boundary; resample once each direction |
| Replace raw evidence early | Preserve immutable before files and manifests |

## Office experiment ledger

Source: user-supplied `noise-cancellation.zip`, SHA-256 `ca64b7d3638fc70fbce18266dfbac21722a4c4324a3042a97e12375160307063`, dated 2026-08-06. It contained one skill and seven references. Preserve these as tried field results, not universal benchmarks.

### Setup and selected chains

- Problem: suppress a nearby speaker in mono voice-agent input without deleting the primary caller.
- Battery: controlled TTS mixtures plus one 25 s real-room Hinglish recording.
- Components: WebRTC APM, RNNoise, DeepFilterNet3, Silero/VAD-style decisions, WeSpeaker ECAPA512 ONNX, PyTorch/torchaudio, and resampling/audio utilities.

Chosen sound:

```text
16 kHz mono PCM -> x0.5 -> resample 48 kHz -> DeepFilterNet3 -> resample back
                -> AdaptiveLevelGate(depth 4, attenuation 40,
                                     hangover 120 ms, release 100 ms,
                                     close sustain 300 ms)
```

Reported on the one room recording: about 3% of one core idle, about 50 ms added latency, 15–34 dB average attenuation in side regions, and 46–105 dB short-window peaks.

Runner-up:

```text
raw -> sustained gate -> ECAPA SpeakerLockGate
    -> WebRTC APM noise suppression + high-pass, AGC off
```

Reported around 4% of one core. “Zero added latency” in the source means no explicit lookahead model in that controller path, not literal end-to-end zero.

### Measured failures and parameter effects

| Experiment | Field result |
|---|---|
| Close 60–120 ms | Ate target words at low-energy boundaries |
| Close sustain 300 ms | Best office balance; noisy-input target loss remained |
| Close sustain 500 ms | Safer target, leaked 0.3–0.7 s side bursts |
| Depth 4 dB | Aggressive; better side suppression, more target risk |
| Depth 8 dB | Gentler; safer target, more side leakage |
| Attenuation 40 dB | Preferred dead-silent side sound |
| Attenuation 25 dB | More conservative target guard |
| Whole mixture x0.5/x2 | Decisions reportedly invariant |
| Side within roughly 8 dB of target | Level gate failed |
| Clean/noise-added room recording | Gate closed about 23%/49%; target loss rose with the latter |

AGC after suppression reportedly raised a side region from about -60 to -25 dB and returned it to transcripts. A hot enhancer input around -5 dB RMS clipped/became aggressive; x0.5 normalization was chosen for that recording. Generalize “no adaptive gain after attenuation” and “avoid clipping,” not the multiplier.

DeepFilterNet environment: `deepfilternet 0.5.6`, torchaudio `2.4.1`, one PyTorch thread, Rust-built `deepfilterlib`.

| Input | Side change | Target cost | Idle CPU |
|---|---:|---:|---:|
| Synthetic TTS | about 0.1–0.5 dB | about 0.2 dB | short-run near 9% |
| One real room | about 15–37 dB time-varying | about 9 dB broad level reduction | about 3% |

`mask_only` produced roughly 12 dB broad attenuation and was rejected. `atten_lim_db` 12/20 removed most desired side reduction. The native SNR-gated decoder path was identified as a compute lever. The chunked DF3 sidecar booted but was not end-to-end verified and remained disabled.

Speaker controller: WeSpeaker VoxCeleb ECAPA ONNX, 80 mel bins, 192-D normalized embeddings, roughly 5 s enrollment, 2 s windows, 3 s cadence, match/reject thresholds 0.60/0.45, one target + one side cluster, about 150 ms gain attack, roughly 40 dB attenuation.

On the one room sample, the side cluster formed after roughly 1 s, side words left the judged transcript, and target transcript stayed complete. CPU was reported about 3.1% at 3 s cadence; 1 s cadence raised the Python feature path to about 16%, dominated by filterbank work. Tested synthetic voices showed cosine similarities around 0.55–0.65 versus roughly 0.2–0.4 for tested real different speakers; this is not universal to TTS.

Embedding after DeepFilterNet reportedly suppressed the target for 16.9 s of 25 s. Taking speaker evidence upstream and applying gain downstream reduced misfire to about 1 s, though overlap word loss remained. This proves a useful gating result on one recording, not source separation.

Judging findings: paired same-configuration STT; real-room validation required; one burst measured about 3 dB average versus 47 dB short-window peak; CPU shifted from about 3% idle to 15–24% near host load average 12.

Unfinished in the source:

1. auto-soften aggressive gate parameters under heavy/noisy enhancement;
2. validate on more real rooms;
3. re-measure CPU on the deployment host;
4. replace chunked DF3 sidecar with true streaming state and end-to-end delay proof.

Do not describe these as completed.

## Current primary sources

Checked 2026-08-14; re-open before version-specific implementation:

- [WebRTC APM](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/g3doc/audio_processing_module.md)
- [RNNoise](https://github.com/xiph/rnnoise)
- [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) and [DeepFilterNet2 paper](https://arxiv.org/abs/2205.05474)
- [DTLN](https://github.com/breizhn/DTLN) and [PercepNet paper](https://arxiv.org/abs/2008.04259)
- [Silero VAD](https://github.com/snakers4/silero-vad)
- [SpeechBrain ECAPA model card](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb)
- [Asteroid](https://github.com/asteroid-team/asteroid), [SpeakerBeam-SS](https://arxiv.org/abs/2407.01857), and [REAL-TSE](https://real-tse.github.io/challenge/)
- [Waveformer](https://github.com/vb000/Waveformer) and [OpenSpeakerBeam-SS](https://github.com/helloooideeeeea/OpenSpeakerBeam-SS)
- [LiveKit noise and echo cancellation](https://docs.livekit.io/transport/media/noise-cancellation/)
- [Microsoft DNS Challenge and DNSMOS](https://github.com/microsoft/DNS-Challenge)
