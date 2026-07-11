/**
 * Handoff contract validation (G5 + optional floor receipts).
 * Constitution: product_decisions.md — agent writes the contract; CLI only validates shape.
 */
import { expandAnswers } from './resolver.mjs';

/** Required sections (G5). Each entry: id + matchers (heading/body keywords). */
export const REQUIRED_SECTIONS = [
  {
    id: 'intent',
    label: 'Intent / use case',
    patterns: [/\bintent\b/i, /\buse\s*case\b/i, /\bcaller\b/i, /\bbusiness\b/i],
  },
  {
    id: 'stack',
    label: 'Stack (providers + why)',
    patterns: [/\bstack\b/i, /\bprovider/i, /\btelephony\b/i, /\borchestrat/i, /\brealtime\b/i],
  },
  {
    id: 'audio_path',
    label: 'Audio path',
    patterns: [/\baudio\s*path\b/i, /\btransform/i, /\bμ-?law\b/i, /\bmulaw\b/i, /\bsample\s*rate\b/i, /\bpcm\b/i],
  },
  {
    id: 'interruption',
    label: 'Interruption / barge-in',
    patterns: [/\binterrupt/i, /\bbarge-?in\b/i, /\bvad\b/i, /\bturn-?tak/i],
  },
  {
    id: 'floors',
    label: 'Floors applied (consent, retention, handoff, tools)',
    patterns: [/\bfloor/i, /\bconsent\b/i, /\bretention\b/i, /\bhandoff\b/i, /\btransfer\b/i, /\bcompliance\b/i],
  },
  {
    id: 'latency_cost',
    label: 'Latency / cost note',
    patterns: [/\blatency\b/i, /\bttft\b/i, /\bcost\b/i, /\$\/?\s*min/i, /\bms\b/i, /\bper-?minute\b/i],
  },
  {
    id: 'build_notes',
    label: 'Build / implement notes',
    patterns: [/\bbuild\b/i, /\bimplement/i, /\bnext\s*steps?\b/i, /\bcoding\s*agent\b/i],
  },
];

/**
 * Domain floor signals — when domain is declared, contract must mention these themes.
 * Soft checks: keyword presence in floors section or whole doc (receipts, not legal certification).
 */
export const DOMAIN_FLOOR_HINTS = {
  medical: {
    labels: ['medical', 'clinical', 'patient', 'pharmacy', 'health'],
    require: [
      { id: 'consent', patterns: [/\bconsent\b/i, /\bannounce\b/i, /\bexplicit\b/i] },
      { id: 'retention', patterns: [/\bretention\b/i, /\b30\s*d/i, /\bthirty/i] },
      { id: 'handoff', patterns: [/\bhandoff\b/i, /\btransfer\b/i] },
    ],
  },
  banking: {
    labels: ['banking', 'payment', 'kyc', 'upi', 'lending', 'financial'],
    require: [
      { id: 'consent_explicit', patterns: [/\bexplicit\b/i, /\bconsent\b/i] },
      { id: 'retention', patterns: [/\bretention\b/i, /\b30\s*d/i, /\bthirty/i] },
      { id: 'handoff', patterns: [/\bhandoff\b/i, /\btransfer\b/i] },
    ],
  },
  collections: {
    labels: ['collections', 'debt', 'recovery', 'dnc', 'ndnc'],
    require: [
      { id: 'consent_explicit', patterns: [/\bexplicit\b/i, /\bconsent\b/i] },
      { id: 'retention', patterns: [/\bretention\b/i, /\b90\s*d/i, /\bninety/i] },
      { id: 'handoff', patterns: [/\bhandoff\b/i, /\btransfer\b/i] },
    ],
  },
  legal: {
    labels: ['legal', 'attorney', 'law firm'],
    require: [
      { id: 'consent', patterns: [/\bconsent\b/i, /\bannounce\b/i, /\bexplicit\b/i] },
      { id: 'retention', patterns: [/\bretention\b/i, /\b90\s*d/i, /\bninety/i] },
      { id: 'handoff', patterns: [/\bhandoff\b/i, /\btransfer\b/i, /\bcallback\b/i] },
    ],
  },
  insurance: {
    labels: ['insurance', 'fnol', 'claim'],
    require: [
      { id: 'consent', patterns: [/\bconsent\b/i, /\bannounce\b/i, /\bexplicit\b/i] },
      { id: 'retention', patterns: [/\bretention\b/i, /\b90\s*d/i, /\bninety/i] },
      { id: 'handoff', patterns: [/\bhandoff\b/i, /\btransfer\b/i] },
    ],
  },
};

export const CONTRACT_RECEIPT_VERSION = 1;

export const CONTRACT_DOMAINS = [
  'general',
  'medical',
  'banking',
  'collections',
  'legal',
  'insurance',
];

export const CONTRACT_POLICY_BASIS = [
  'callsmith_default',
  'organization_policy',
  'legal_review',
  'explicit_risk_acceptance',
];

const CONSENT_RANK = { none: 0, announce: 1, explicit: 2 };
const RETENTION_RANK = { ephemeral: 0, seven_days: 1, thirty_days: 2, ninety_days: 3 };
const HANDOFF_VALUES = new Set(['none', 'transfer', 'callback', 'ticket']);
const PROVIDER_ROLE_VALUES = new Set(['telephony', 'orchestration', 'realtime', 'stt', 'llm', 'tts', 'vad']);
const SURFACE_VALUES = new Set([
  'inbound_pstn',
  'outbound_pstn',
  'web_voice',
  'webrtc_app',
  'whatsapp_voice',
]);

// These are product safety defaults, not claims about universal legal requirements.
// A legal review or explicit written risk acceptance may override them in the receipt.
export const CONTRACT_DEFAULT_FLOORS = {
  medical: { consent: 'announce', retention: 'thirty_days', handoff: 'transfer' },
  banking: { consent: 'explicit', retention: 'thirty_days', handoff: 'transfer' },
  collections: { consent: 'explicit', retention: 'ninety_days', handoff: 'transfer' },
  legal: { consent: 'announce', retention: 'ninety_days', handoff: 'transfer' },
  insurance: { consent: 'announce', retention: 'ninety_days', handoff: 'transfer' },
};

const RECEIPT_PATTERN = /```json\s+callsmith-contract\s*\n([\s\S]*?)\n```/i;

export function parseContractReceipt(text) {
  const match = String(text || '').match(RECEIPT_PATTERN);
  if (!match) {
    return { receipt: null, error: 'missing ```json callsmith-contract receipt block' };
  }
  try {
    return { receipt: JSON.parse(match[1]), error: null };
  } catch (error) {
    return { receipt: null, error: `invalid callsmith-contract JSON: ${error.message}` };
  }
}

function meetsRank(ranks, value, minimum) {
  return ranks[value] !== undefined && ranks[minimum] !== undefined && ranks[value] >= ranks[minimum];
}

function knownProviderIds(providers) {
  if (!providers) return null;
  if (providers instanceof Set) return providers;
  if (providers instanceof Map) return new Set(providers.keys());
  return new Set(Object.keys(providers));
}

export function validateContractReceipt(receipt, opts = {}) {
  const errors = [];
  const warnings = [];
  const floors = [];
  const fail = (message) => errors.push(message);

  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return { status: 'FAIL', errors: ['contract receipt must be a JSON object'], warnings, floors };
  }
  if (receipt.schema_version !== CONTRACT_RECEIPT_VERSION) {
    fail(`contract receipt schema_version must be ${CONTRACT_RECEIPT_VERSION}`);
  }
  if (!CONTRACT_DOMAINS.includes(receipt.domain)) {
    fail(`contract receipt domain must be one of: ${CONTRACT_DOMAINS.join(', ')}`);
  }
  if (opts.domain && receipt.domain && detectDomain('', opts.domain) !== receipt.domain) {
    fail(`contract receipt domain "${receipt.domain}" does not match --domain "${opts.domain}"`);
  }
  if (!SURFACE_VALUES.has(receipt.surface)) {
    fail(`contract receipt surface must be a canonical id`);
  }

  const providers = receipt.providers;
  const known = knownProviderIds(opts.providers);
  if (!providers || typeof providers !== 'object' || Array.isArray(providers) || !Object.keys(providers).length) {
    fail('contract receipt providers must contain at least one provider pack id');
  } else {
    for (const [kind, id] of Object.entries(providers)) {
      if (!PROVIDER_ROLE_VALUES.has(kind)) {
        fail(`contract receipt provider role is not canonical: ${kind}`);
      } else if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(id))) {
        fail(`contract receipt provider ${kind} must be a lowercase pack id: ${id}`);
      } else if (known && !known.has(id)) {
        fail(`contract receipt references unknown provider pack: ${kind}:${id}`);
      }
    }
  }

  const policy = receipt.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    fail('contract receipt policy object is required');
  } else {
    if (!CONTRACT_POLICY_BASIS.includes(policy.basis)) {
      fail(`contract policy basis must be one of: ${CONTRACT_POLICY_BASIS.join(', ')}`);
    }
    if (!Object.hasOwn(CONSENT_RANK, policy.recording_consent)) {
      fail('contract policy recording_consent must be none, announce, or explicit');
    }
    if (!Object.hasOwn(RETENTION_RANK, policy.transcript_retention)) {
      fail('contract policy transcript_retention must be ephemeral, seven_days, thirty_days, or ninety_days');
    }
    if (!HANDOFF_VALUES.has(policy.human_handoff)) {
      fail('contract policy human_handoff must be none, transfer, callback, or ticket');
    }
    if (!policy.retention_basis || typeof policy.retention_basis !== 'string') {
      fail('contract policy retention_basis is required');
    }

    const defaults = CONTRACT_DEFAULT_FLOORS[receipt.domain];
    if (defaults && (!policy.jurisdiction || typeof policy.jurisdiction !== 'string')) {
      fail(`contract policy jurisdiction is required for regulated domain "${receipt.domain}"`);
    }

    if (defaults) {
      const checks = [
        {
          id: 'recording_consent',
          present: meetsRank(CONSENT_RANK, policy.recording_consent, defaults.consent),
          detail: `${policy.recording_consent} >= ${defaults.consent}`,
        },
        {
          id: 'transcript_retention',
          present: meetsRank(RETENTION_RANK, policy.transcript_retention, defaults.retention),
          detail: `${policy.transcript_retention} >= ${defaults.retention}`,
        },
        {
          id: 'human_handoff',
          present: policy.human_handoff === defaults.handoff,
          detail: `${policy.human_handoff} == ${defaults.handoff}`,
        },
      ];
      floors.push(...checks.map((check) => ({ domain: receipt.domain, ...check })));
      const failed = checks.filter((check) => !check.present);
      if (failed.length) {
        const override = policy.basis === 'explicit_risk_acceptance' && policy.override;
        const validOverride =
          override &&
          typeof override.accepted_by === 'string' &&
          override.accepted_by.trim() &&
          typeof override.reason === 'string' &&
          override.reason.trim();
        if (!validOverride) {
          for (const check of failed) fail(`contract policy below Callsmith default: ${check.id} (${check.detail})`);
        } else {
          warnings.push(`explicit risk acceptance overrides Callsmith defaults: ${failed.map((f) => f.id).join(', ')}`);
          for (const check of failed) check.present = true;
          for (const floor of floors) {
            if (failed.some((f) => f.id === floor.id)) floor.present = true;
          }
        }
      }
    }
  }

  const latency = receipt.latency_slo;
  if (!latency || typeof latency !== 'object' || Array.isArray(latency)) {
    fail('contract receipt latency_slo object is required');
  } else {
    if (latency.metric !== 'turn_gap_ms') fail('contract latency_slo.metric must be turn_gap_ms');
    if (![50, 95, 99].includes(latency.percentile)) fail('contract latency_slo.percentile must be 50, 95, or 99');
    if (!(typeof latency.target_ms === 'number' && Number.isFinite(latency.target_ms) && latency.target_ms > 0)) {
      fail('contract latency_slo.target_ms must be a positive number');
    }
  }

  return { status: errors.length ? 'FAIL' : 'PASS', errors, warnings, floors };
}

function sectionPresent(text, section) {
  return section.patterns.some((re) => re.test(text));
}

function detectDomain(text, explicitDomain) {
  if (explicitDomain) {
    const key = String(explicitDomain).toLowerCase().trim();
    if (CONTRACT_DOMAINS.includes(key)) return key;
    if (DOMAIN_FLOOR_HINTS[key]) return key;
    for (const [id, def] of Object.entries(DOMAIN_FLOOR_HINTS)) {
      if (def.labels.some((l) => key.includes(l))) return id;
    }
  }
  const lower = text.toLowerCase();
  for (const [id, def] of Object.entries(DOMAIN_FLOOR_HINTS)) {
    if (def.labels.some((l) => lower.includes(l))) return id;
  }
  return null;
}

/**
 * @param {string} text — markdown handoff contract
 * @param {{ domain?: string, providers?: object|Map|Set }} [opts]
 * @returns {{ status: 'PASS'|'FAIL', receipt: object|null, sections: object[], floors: object[], domain: string|null, errors: string[], warnings: string[] }}
 */
export function validateContract(text, opts = {}) {
  const errors = [];
  const warnings = [];
  const body = String(text || '');

  if (!body.trim()) {
    return {
      status: 'FAIL',
      sections: [],
      floors: [],
      receipt: null,
      domain: null,
      errors: ['contract is empty'],
      warnings: [],
    };
  }

  const parsedReceipt = parseContractReceipt(body);
  let receipt = parsedReceipt.receipt;
  let receiptReport = { errors: [], warnings: [], floors: [] };
  if (parsedReceipt.error) {
    errors.push(parsedReceipt.error);
  } else {
    receiptReport = validateContractReceipt(receipt, opts);
    errors.push(...receiptReport.errors);
    warnings.push(...receiptReport.warnings);
  }

  const sections = REQUIRED_SECTIONS.map((s) => {
    const present = sectionPresent(body, s);
    if (!present) errors.push(`missing section signal: ${s.label} (${s.id})`);
    return { id: s.id, label: s.label, present };
  });

  const domain = receipt?.domain || detectDomain(body, opts.domain);
  const floors = [...receiptReport.floors];
  if (!receipt && domain && DOMAIN_FLOOR_HINTS[domain]) {
    for (const req of DOMAIN_FLOOR_HINTS[domain].require) {
      const present = req.patterns.some((re) => re.test(body));
      floors.push({ domain, id: req.id, present });
      if (!present) {
        errors.push(`floor receipt missing for domain "${domain}": ${req.id}`);
      }
    }
  } else if (!receipt && opts.domain) {
    warnings.push(`unknown domain "${opts.domain}" — section check only; no floor receipts enforced`);
  } else if (!receipt) {
    warnings.push('no domain detected — floor receipts not enforced (pass --domain or name domain in contract)');
  }

  return {
    status: errors.length ? 'FAIL' : 'PASS',
    receipt,
    sections,
    floors,
    domain,
    errors,
    warnings,
  };
}

/** Compare the structured receipt with the canonical answers artifact. */
export function validateContractAnswers(receipt, answers, menu) {
  const checks = [];
  const errors = [];
  const compare = (id, actual, expected) => {
    const ok = actual === expected;
    const detail = ok
      ? `${id} matches (${String(actual)})`
      : `${id} mismatch: receipt=${String(actual ?? '(missing)')} answers=${String(expected ?? '(missing)')}`;
    checks.push({ id, ok, actual: actual ?? null, expected: expected ?? null, detail });
    if (!ok) errors.push(detail);
  };

  if (!receipt || typeof receipt !== 'object') {
    return { status: 'FAIL', checks, errors: ['cannot compare answers without a valid contract receipt'] };
  }
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
    return { status: 'FAIL', checks, errors: ['answers must be a JSON object'] };
  }

  compare('surface', receipt.surface, answers.surface);
  compare('recording_consent', receipt.policy?.recording_consent, answers.recording_consent);
  compare('transcript_retention', receipt.policy?.transcript_retention, answers.transcript_retention);
  compare('human_handoff', receipt.policy?.human_handoff, answers.human_handoff);

  try {
    const expanded = expandAnswers(answers, menu, { strict: true });
    const expectedProviders = Object.fromEntries(Object.entries(expanded.providers || {})
      .filter(([, selection]) => selection?.id)
      .map(([role, selection]) => [role, selection.id]));
    const actualProviders = receipt.providers || {};
    const roles = [...new Set([...Object.keys(expectedProviders), ...Object.keys(actualProviders)])].sort();
    for (const role of roles) compare(`provider.${role}`, actualProviders[role], expectedProviders[role]);
  } catch (error) {
    errors.push(`answers cannot be normalized: ${error.message}`);
  }

  return { status: errors.length ? 'FAIL' : 'PASS', checks, errors };
}
