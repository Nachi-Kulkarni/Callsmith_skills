# CSB scenario schema v1 (sealed)

**Version:** `1`
**Status:** frozen for Phase 1+ fixtures. Bump to v2 only with a migration note.

Every scored scenario lives under `evals/csb/scenarios/<id>/` with these files:

| File | Actor sees? | Required | Purpose |
|---|---|---|---|
| `manifest.json` | no | yes | schema_version, id, domain, stakes, arms |
| `brief.md` | **yes** | yes | Business brief only — no oracles, no targets |
| `tags.json` | no | yes | domain, surface_class, stakes, language_force |
| `oracle.json` | no | yes | Sealed fields + physics band + traps |
| `poisoned.answers.json` | seed only | yes* | Deterministic bad seed (*optional if `seed_mode: empty`) |
| `reference/` | no | no | Solvability proof (human gold) |

## manifest.json

```json
{
  "schema_version": 1,
  "id": "clinic-floor-poison",
  "title": "Clinic triage with poisoned floors",
  "domain": "medical",
  "stakes": "urgent_safety",
  "seed_mode": "poisoned",
  "arms": ["BASE", "WITH"]
}
```

| Field | Type | Notes |
|---|---|---|
| `schema_version` | number | Must be `1` |
| `id` | string | Directory name |
| `title` | string | Human label |
| `domain` | `medical\|banking\|collections\|legal\|insurance\|general` | Floor oracle |
| `stakes` | `urgent_safety\|payment\|lead\|async\|none` | Handoff oracle |
| `seed_mode` | `poisoned\|empty\|clean` | How arm starts |
| `arms` | string[] | Usually `["BASE","WITH"]` |

## tags.json

```json
{
  "schema_version": 1,
  "domain": "medical",
  "surface_class": "pstn",
  "direction": "inbound",
  "language_force": null,
  "stakes": "urgent_safety",
  "regulated": true
}
```

| Field | Values |
|---|---|
| `surface_class` | `pstn` \| `browser` \| `async_voice` \| `webrtc_app` |
| `direction` | `inbound` \| `outbound` \| `n/a` |
| `language_force` | `null` \| `hinglish` \| `multilingual` \| `english` \| … |
| `regulated` | boolean |

## oracle.json

```json
{
  "schema_version": 1,
  "sealed": {
    "surface": { "one_of": ["inbound_pstn"] },
    "recording_consent": { "min": "announce" },
    "transcript_retention": { "min": "thirty_days" },
    "human_handoff": { "one_of": ["transfer"] },
    "language": { "one_of": ["multilingual", "hinglish", "hindi"] },
    "architecture_class": { "one_of": ["realtime", "cascaded", "hybrid"] },
    "telephony": { "one_of": ["twilio"] }
  },
  "physics": {
    "transform_band": null,
    "forbid_claim_zero_transforms_if_heavy": false,
    "require_native_or_admit_heavy": false
  },
  "traps": [
    "no_pstn_to_web",
    "no_ticket_on_urgent",
    "no_synthesis",
    "no_deleted_generators"
  ],
  "contract_domain": "medical"
}
```

### sealed field ops

| Op | Meaning |
|---|---|
| `one_of: [...]` | Final answer must be in set (if key present or required) |
| `min: level` | Ordered rank ≥ minimum (consent, retention) |
| `required: true` | Key must be present |

Omitted sealed keys are **unscored** (free taste).

### transform_band

| Value | Meaning |
|---|---|
| `null` | Do not gate transform count |
| `"0"` | Must be native / zero transforms |
| `"heavy"` | Must be ≥3 transforms if stack kept |
| `"any_possible"` | Only require check/resolve has no hard impossibility |

## poisoned.answers.json

Partial or full menu-shaped answers. Must **fail** at least one sealed floor/physics field so G_FLOOR/G_PHYS can F2P.

## BASE arm honesty (guardrail)

BASE receives:

- Same `brief.md`
- Same output schema instruction (`voice.answers.json` + `callsmith.recipe.md`)
- Same time budget / model

BASE does **not** receive: SKILL, packs tree, callsmith CLI, reference playbooks, oracle, poison labels.

Do **not** strip tools, cripple context, or inject “you are dumb” prompts. CSB-Δ must measure callsmith, not BASE sabotage.

## G_REAL traps (deterministic only)

| Trap id | Predicate (code) |
|---|---|
| `no_pstn_to_web` | If tags.surface_class=`pstn`, final surface ∉ web_voice/webrtc_app/whatsapp_voice |
| `no_ticket_on_urgent` | If stakes=`urgent_safety` or `payment`, handoff ≠ ticket (and ≠ none) |
| `no_synthesis` | No provider id in answers that lacks a pack (unless answers refuse/omit) |
| `no_deleted_generators` | Command log has no `init\|forge\|scaffold\|simulate\|intake\|docs` |
| `no_consent_none_regulated` | If regulated, consent ≠ none |

No free-text “vibes” traps in v1.
