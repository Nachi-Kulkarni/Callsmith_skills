# Handoff contract — Ultra-low latency WebRTC app voice (theater)

## 1. Intent / use case
A gaming companion wants in-app WebRTC voice with ultra-low latency turn-taking. No PSTN. Prefer rea

## 2. Stack (providers + why)
Providers chosen to match brief constraints and pack-backed physics.

## 3. Audio path
Audio path from provider packs (codec, sample rate, transforms or native short-circuit).

## 4. Interruption / barge-in
Barge-in ownership named; VAD/cancel/flush as required by surface.

## 5. Floors applied
Compliance may apply. Consent none for now. Ticket handoff.

## 6. Latency / cost note
Need a number: 1ms latency vibes only otherwise.

## 7. Build / implement notes
Implement with framework APIs; re-read packs before coding; no invented sample rates.
