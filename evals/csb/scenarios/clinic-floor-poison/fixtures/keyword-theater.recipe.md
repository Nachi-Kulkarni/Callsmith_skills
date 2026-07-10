# Handoff contract — looks complete, policy is not

## 1. Intent / use case

Clinic phone agent for appointments.

## 2. Stack (providers + why)

Twilio + LiveKit + Gemini Live because popular.

## 3. Audio path

μ-law 8 kHz, LiveKit normalizes, 0 transforms, PCM 16 kHz.

## 4. Interruption / barge-in

VAD with barge-in required, cancel TTS on interrupt.

## 5. Floors applied

HIPAA may apply. We should think about consent and retention and handoff carefully.
Recording consent: none for now (flagged for later).
Handoff: ticket only.

## 6. Latency / cost note

Latency about 600ms, cost about $0.04/min versus cascaded alternative.

## 7. Build / implement notes

Build the agent with LiveKit agents framework.
