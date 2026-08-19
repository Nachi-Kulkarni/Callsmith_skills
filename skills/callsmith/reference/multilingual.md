# Multilingual

Use this playbook for `/callsmith multilingual` when callers speak more than one language or mix them mid-sentence. Language answers use a BCP 47 tag or `multilingual`, as defined in `reference/policy.md`.

## Ground truth

Code-switching (Hinglish, Tamil-English) degrades STT accuracy, and vendors do not publish WER for it — no datasheet number exists for "mixed English-Hindi on 8 kHz μ-law." Treat every multilingual capability claim, pack or vendor, as a planning estimate until measured on your callers, channel, and codec. A pack listing a language proves support, not quality.

## Multilingual vs per-language legs

| Situation | Choice |
|---|---|
| One language per call, known up front | Per-language legs: one pinned STT model + TTS voice each; deterministic |
| Mid-call or mid-sentence switching (`hinglish`) | One code-switch-capable model for the whole call; per-language legs reset context at every switch |
| Mixed population, low volume | Start with the single best multilingual model; split legs only when a measured per-language gap justifies a second stack |

`multilingual` as an answer is a stack decision, not a capability claim — it creates the per-language evidence duty below.

## Language lock and unclear speech

Keep an explicit `active_language`, initialized from the chosen primary language or trusted entry
context. Change it only after an explicit request or sustained, unambiguous speech; one filler, word,
name, borrowed term, or STT script change is not language evidence.

Use the active language and trusted context as transcription priors. Confirm uncertain names instead
of silently translating or respelling them. Garbled or low-confidence speech is missing evidence,
never intent, consent, or confirmation: ask one neutral retry in the last stable language. Request
louder speech only when input-level/noise evidence supports it; repeated failures use DTMF or human
fallback. Pass provider locale hints and confidence/alternatives when available—a prompt cannot
repair clipped audio or a wrongly configured STT leg.

## TTS per language

- One reviewed voice per language; never let the TTS default choose per request.
- Pin language, speaker, pronunciation dictionary, and numeral preprocessing per pack guidance (Sarvam: measure each language — codec support does not prove pronunciation quality).
- Run a pronunciation check per language on deployed prompts: proper nouns, numerals, addresses, transliterations. Listen to real output; do not approve from a spec sheet.

## Accent and demographic coverage

Vendor eval sets skew; accuracy is not uniform across accents, age, gender, or channel. Mirror the ECAPA rule in `reference/noise-cancellation.md`: calibrate on the deployed population — your callers, codec, handset — not the vendor benchmark. A pilot cohort of one accent proves nothing about the rest of the base.

## DTMF fallback

When ASR confidence collapses mid-code-switch, the caller must not fall into a retry loop:

- Detect it from confidence plus repeat count, not silence timeout alone.
- Offer DTMF escape for structured data (numbers, menu choices; card entry routes through `/callsmith security`).
- Keep the fallback prompt in the caller's last stable language.

## Evaluation

- Measure WER and turn gap **per language**; never average across languages — one blended number hides the failing language.
- Report per-language cohorts with sample counts; "92% overall" on 90% English samples is a masked failure.
- Include code-switch samples; per-language WER does not cover switches even when both languages pass alone.

## Anti-patterns

- Invented language names (`english_and_hindi`) instead of valid BCP 47 tags or `multilingual`
- One blended WER or turn-gap across languages
- A pack's language list quoted as a quality claim
- TTS voice auto-selecting language per request
- Accent calibration on one region or the founding team
- Switching language from one ambiguous token, proper noun, filler, or STT-selected script
- Silently guessing an uncertain name or treating a garbled transcript as confirmation
- Retry loops with no DTMF escape on collapsed confidence
- Per-language legs chosen for menu coverage instead of a measured gap

## Output

```markdown
## Multilingual Plan

**Language answers:** … (BCP 47 tags + switching policy)
**Leg choice:** per-language legs / single code-switch model — why
**Voices:** one reviewed voice per language + pronunciation checks done / pending
**Fallback:** DTMF escape trigger + prompt language rule

### Per-language evidence (planning until measured)
| Language | WER source | Turn gap | Cohort n |

### Contract changes required?
no / yes — sections: …
```
