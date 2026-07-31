# Contract receipt

Every `callsmith.recipe.md` starts with one machine-readable receipt. The prose explains the design; the receipt makes its consequential choices testable.

```json callsmith-contract
{
  "schema_version": 1,
  "domain": "medical",
  "surface": "inbound_pstn",
  "providers": {
    "telephony": "twilio",
    "orchestration": "livekit",
    "stt": "deepgram",
    "llm": "openai",
    "tts": "cartesia"
  },
  "policy": {
    "jurisdiction": "US",
    "basis": "organization_policy",
    "retention_basis": "Clinic policy MED-12, approved 2026-06-30.",
    "recording_consent": "announce",
    "transcript_retention": "thirty_days",
    "human_handoff": "transfer"
  },
  "latency_slo": {
    "metric": "turn_gap_ms",
    "percentile": 95,
    "target_ms": 900
  },
  "deployment": {
    "target": "livekit_cloud",
    "region": "unknown",
    "drain_owner": "platform_managed"
  }
}
```

Canonical values:

- `domain`: `general`, `medical`, `banking`, `collections`, `legal`, `insurance`
- `surface`: `inbound_pstn`, `outbound_pstn`, `web_voice`, `webrtc_app`, `whatsapp_voice`
- provider roles: `telephony`, `orchestration`, `realtime`, `stt`, `llm`, `tts`, `vad`; values are installed provider pack IDs, not product prose
- `basis`: `callsmith_default`, `organization_policy`, `legal_review`, `explicit_risk_acceptance`
- consent: `none`, `announce`, `explicit`
- retention: `ephemeral`, `seven_days`, `thirty_days`, `ninety_days`
- handoff: `none`, `transfer`, `callback`, `ticket`
- latency metric: `turn_gap_ms`; percentile: `50`, `95`, or `99`
- optional deployment target: `local`, `livekit_cloud`, `pipecat_cloud`, `railway`, `render`, `fly`, `cloud_vm`, `k8s`; region: `unknown`, `in`, `us`, `eu`; drain owner: `platform_managed`, `user_implemented`

For a regulated domain, `jurisdiction` and `retention_basis` are required. Callsmith's domain floors are conservative product defaults, not legal advice or a claim that one rule applies in every jurisdiction. A design below those defaults fails unless the receipt records `basis: "explicit_risk_acceptance"` plus an `override` containing non-empty `accepted_by` and `reason` fields.

The receipt and `voice.answers.json` must agree. Validation rejects missing receipts, unknown pack IDs, domain mismatch, malformed latency SLOs, unacknowledged floor reductions, managed-target/orchestrator conflicts, false drain ownership, and regulated deployments whose selected packs cannot prove the requested region. The deployment section is optional for backward compatibility.
