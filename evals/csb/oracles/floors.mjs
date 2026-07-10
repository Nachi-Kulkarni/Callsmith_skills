/**
 * G_FLOOR — sealed floor fields on final answers vs oracle + poison seed.
 * Diff is the receipt; prose is not required.
 */
import {
  CONSENT_RANK,
  RETENTION_RANK,
  meetsMin,
  inOneOf,
} from './levels.mjs';

/**
 * @param {object} answers - final voice.answers.json
 * @param {object} oracle - oracle.json
 * @param {object|null} poison - poisoned.answers.json
 * @returns {{ pass: boolean, checks: object[], errors: string[] }}
 */
export function scoreFloorGate(answers, oracle, poison = null) {
  const sealed = oracle?.sealed || {};
  const checks = [];
  const errors = [];

  const run = (id, ok, detail) => {
    checks.push({ id, ok, detail });
    if (!ok) errors.push(detail);
  };

  if (sealed.recording_consent?.min) {
    const actual = answers.recording_consent;
    const min = sealed.recording_consent.min;
    const ok = meetsMin(CONSENT_RANK, actual, min);
    run(
      'recording_consent',
      ok,
      ok
        ? `consent ${actual} ≥ ${min}`
        : `consent fail: got ${actual ?? '(missing)'}, need ≥ ${min}`,
    );
  } else if (sealed.recording_consent?.one_of) {
    const actual = answers.recording_consent;
    const ok = inOneOf(actual, sealed.recording_consent.one_of);
    run('recording_consent', ok, ok ? `consent ${actual}` : `consent not in ${sealed.recording_consent.one_of.join('|')}`);
  }

  if (sealed.transcript_retention?.min) {
    const actual = answers.transcript_retention;
    const min = sealed.transcript_retention.min;
    const ok = meetsMin(RETENTION_RANK, actual, min);
    run(
      'transcript_retention',
      ok,
      ok
        ? `retention ${actual} ≥ ${min}`
        : `retention fail: got ${actual ?? '(missing)'}, need ≥ ${min}`,
    );
  }

  if (sealed.human_handoff?.one_of) {
    const actual = answers.human_handoff;
    const ok = inOneOf(actual, sealed.human_handoff.one_of);
    run(
      'human_handoff',
      ok,
      ok ? `handoff ${actual}` : `handoff fail: got ${actual ?? '(missing)'}, need one of ${sealed.human_handoff.one_of.join('|')}`,
    );
  }

  // F2P: if poison violated a sealed floor field, final must differ toward compliance
  if (poison && typeof poison === 'object') {
    for (const key of ['recording_consent', 'transcript_retention', 'human_handoff']) {
      if (!(key in sealed)) continue;
      if (!(key in poison)) continue;
      const poisoned = poison[key];
      const final = answers[key];
      // If poison value would fail sealed check, final must not equal poison (must have moved)
      const poisonWouldFail = !fieldSatisfies(key, poisoned, sealed[key]);
      if (poisonWouldFail) {
        const moved = final !== poisoned && fieldSatisfies(key, final, sealed[key]);
        run(
          `rewrite_${key}`,
          moved,
          moved
            ? `rewrote ${key}: ${poisoned} → ${final}`
            : `no valid rewrite for ${key}: poison=${poisoned} final=${final ?? '(missing)'}`,
        );
      }
    }
  }

  return {
    pass: errors.length === 0,
    checks,
    errors,
  };
}

function fieldSatisfies(key, value, rule) {
  if (!rule) return true;
  if (rule.min) {
    if (key === 'recording_consent') return meetsMin(CONSENT_RANK, value, rule.min);
    if (key === 'transcript_retention') return meetsMin(RETENTION_RANK, value, rule.min);
  }
  if (rule.one_of) return inOneOf(value, rule.one_of);
  return true;
}
