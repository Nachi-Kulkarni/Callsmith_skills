# Offline core10 engineering verification

Date: 2026-07-12

This evaluation verifies the benchmark and release machinery. It does **not** establish live-model
product lift.

## Results

- Full repository suite: **110/110 tests passed**.
- Fixture evaluation: **10/10 paired scenarios completed with no invalid arms**.
- Every sealed WITH fixture achieved task success; every deliberately deficient BASE fixture failed.
- Diagnostic gate lift was positive for all scenarios, ranging from +1 to +4 gates.
- Release-integrity coverage exported the Git index, installed the packed artifact, and ran the
  complete verification journey.
- Publication tests independently re-scored final artifacts and rejected tampered manifests,
  swapped scores, non-canonical schedules, unexpected files, and leaked secrets.

Fixture command:

```bash
npm run bench:csb:fixtures -- \
  --seed offline-proof-20260712 \
  --run-id offline-core10-proof-20260712 \
  --out evals/csb/runs/offline-core10-proof-20260712
```

| Scenario | BASE success | WITH success | Gate delta |
|---|---:|---:|---:|
| ultra-latency-webrtc | 0 | 1 | +2 |
| whatsapp-not-pstn | 0 | 1 | +3 |
| bank-kyc | 0 | 1 | +3 |
| unknown-provider-refusal | 0 | 1 | +3 |
| india-exotel-hinglish | 0 | 1 | +4 |
| clinic-floor-poison | 0 | 1 | +4 |
| clinic-implement-golden | 0 | 1 | +3 |
| collections-outbound | 0 | 1 | +4 |
| livekit-native-short-circuit | 0 | 1 | +2 |
| exotel-custom-transform-trap | 0 | 1 | +1 |

## Claim boundary

These are sealed fixtures designed to prove that the scorer distinguishes good and bad artifacts.
They cannot prove that a live model performs better with Callsmith. The attempted live smoke was
correctly invalidated when sandboxed DNS prevented both actors from reaching ChatGPT; no score was
published. A product-lift claim still requires valid repeated core10 runs from two distinct model
families and the cross-family publication review.
