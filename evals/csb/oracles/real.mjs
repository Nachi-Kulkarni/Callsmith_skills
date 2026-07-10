/**
 * G_REAL — deterministic anti pretty-demo traps only (no vibes).
 */
import {
  WEBISH_SURFACES,
  DELETED_GENERATOR_RE,
  inOneOf,
} from './levels.mjs';
import { loadProviders } from '../../../src/lib/resolver.mjs';

const TRAP_HANDLERS = {
  no_pstn_to_web(ctx) {
    if (ctx.tags?.surface_class !== 'pstn') {
      return { ok: true, detail: 'trap n/a (not pstn class)' };
    }
    const s = ctx.answers.surface;
    const ok = s && !WEBISH_SURFACES.has(s);
    return {
      ok,
      detail: ok
        ? `surface ${s} stays PSTN-class`
        : `pretty-demo surface: PSTN brief but surface=${s ?? '(missing)'}`,
    };
  },

  no_ticket_on_urgent(ctx) {
    const stakes = ctx.tags?.stakes || ctx.manifest?.stakes;
    if (!['urgent_safety', 'payment'].includes(stakes)) {
      return { ok: true, detail: 'trap n/a (stakes not urgent/payment)' };
    }
    const h = ctx.answers.human_handoff;
    // Oracle sealed list wins; never allow ticket/none on urgent/payment stakes
    const allowed = ctx.oracle?.sealed?.human_handoff?.one_of || ['transfer'];
    const ok = Boolean(h && allowed.includes(h) && h !== 'ticket' && h !== 'none');
    return {
      ok,
      detail: ok
        ? `handoff ${h} ok for stakes=${stakes}`
        : `ticket-only/weak handoff on stakes=${stakes}: got ${h ?? '(missing)'}`,
    };
  },

  no_synthesis(ctx) {
    const providers = ctx.providers || loadProviders();
    const menu = ctx.menu;
    // Provider-bearing keys commonly mapped via menu
    const providerKeys = ['telephony', 'orchestration', 'realtime_model', 'stt', 'llm', 'tts', 'vad'];
    const missing = [];
    for (const key of providerKeys) {
      const choice = ctx.answers[key];
      if (!choice || typeof choice !== 'string') continue;
      // Free-text custom id (not a menu option id) — check pack exists by id or common maps
      if (providers[choice]) continue;
      // Menu option ids often differ from pack ids (gemini_live → gemini-live). Expand if menu available.
      if (menu) {
        const g = menu.groups?.find((x) => x.id === key);
        const opt = g?.options?.find((o) => o.id === choice);
        const packId = opt?.maps?.provider;
        if (packId && providers[packId]) continue;
        if (packId && !providers[packId]) missing.push(`${key}:${packId}`);
        else if (!opt) {
          // Unknown free-text provider id
          const kebab = choice.replace(/_/g, '-');
          if (!providers[kebab]) missing.push(`${key}:${choice}`);
        }
      } else {
        const kebab = choice.replace(/_/g, '-');
        if (!providers[choice] && !providers[kebab]) missing.push(`${key}:${choice}`);
      }
    }
    return {
      ok: missing.length === 0,
      detail: missing.length === 0
        ? 'no synthesized providers'
        : `unknown provider pack(s) (synthesis forbidden): ${missing.join(', ')}`,
    };
  },

  no_deleted_generators(ctx) {
    const log = ctx.commandLog || '';
    const hit = log.match(DELETED_GENERATOR_RE);
    return {
      ok: !hit,
      detail: hit ? `deleted generator used: ${hit[0]}` : 'no deleted generators in command log',
    };
  },

  no_consent_none_regulated(ctx) {
    if (!ctx.tags?.regulated) {
      return { ok: true, detail: 'trap n/a (not regulated)' };
    }
    const c = ctx.answers.recording_consent;
    const ok = c && c !== 'none';
    return {
      ok,
      detail: ok ? `consent ${c}` : `regulated scenario with consent=${c ?? '(missing)'}`,
    };
  },
};

/**
 * @param {object} ctx
 * @param {object} ctx.answers
 * @param {object} ctx.oracle
 * @param {object} ctx.tags
 * @param {object} [ctx.manifest]
 * @param {string} [ctx.commandLog]
 * @param {object} [ctx.menu]
 * @param {object} [ctx.providers]
 */
export function scoreRealGate(ctx) {
  const traps = ctx.oracle?.traps || [
    'no_pstn_to_web',
    'no_ticket_on_urgent',
    'no_synthesis',
    'no_deleted_generators',
    'no_consent_none_regulated',
  ];
  const checks = [];
  const errors = [];

  for (const trapId of traps) {
    const handler = TRAP_HANDLERS[trapId];
    if (!handler) {
      checks.push({ id: trapId, ok: false, detail: `unknown trap id: ${trapId}` });
      errors.push(`unknown trap id: ${trapId}`);
      continue;
    }
    const result = handler(ctx);
    checks.push({ id: trapId, ok: result.ok, detail: result.detail });
    if (!result.ok) errors.push(result.detail);
  }

  return { pass: errors.length === 0, checks, errors };
}

export const DETERMINISTIC_TRAPS = Object.keys(TRAP_HANDLERS);
