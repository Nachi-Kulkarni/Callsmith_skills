/** Ordered ranks for sealed floor fields (schema v1). */

export const CONSENT_RANK = {
  none: 0,
  announce: 1,
  explicit: 2,
};

export const RETENTION_RANK = {
  ephemeral: 0,
  seven_days: 1,
  thirty_days: 2,
  ninety_days: 3,
};

export function meetsMin(rankMap, actual, min) {
  if (actual === undefined || actual === null || actual === '') return false;
  if (!(actual in rankMap)) return false;
  if (!(min in rankMap)) return false;
  return rankMap[actual] >= rankMap[min];
}

export function inOneOf(actual, oneOf) {
  if (actual === undefined || actual === null || actual === '') return false;
  return oneOf.includes(actual);
}

/** Map menu architecture ids → class. */
export function architectureClass(architecture) {
  if (!architecture) return null;
  if (architecture === 'realtime_s2s' || architecture === 'realtime') return 'realtime';
  if (architecture === 'cascaded') return 'cascaded';
  if (architecture === 'hybrid') return 'hybrid';
  return architecture;
}

export const PSTN_SURFACES = new Set(['inbound_pstn', 'outbound_pstn']);
export const WEBISH_SURFACES = new Set(['web_voice', 'webrtc_app', 'whatsapp_voice']);

export const DELETED_GENERATOR_RE =
  /\bcallsmith\s+(init|forge|scaffold|simulate|intake|docs|spec|release-check)\b/i;
