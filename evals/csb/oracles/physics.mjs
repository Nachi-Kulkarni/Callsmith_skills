/**
 * G_PHYS — surface/direction/arch/telephony sealed fields + transform band from pack resolve.
 */
import {
  architectureClass,
  inOneOf,
} from './levels.mjs';
import {
  loadMenu,
  loadProviders,
  expandAnswers,
  resolve,
  detectImpossibilities,
} from '../../../src/lib/resolver.mjs';

/**
 * @param {object} answers
 * @param {object} oracle
 * @param {{ menu?: object, providers?: object }} [deps]
 */
export function scorePhysicsGate(answers, oracle, deps = {}) {
  const sealed = oracle?.sealed || {};
  const physics = oracle?.physics || {};
  const checks = [];
  const errors = [];
  const run = (id, ok, detail) => {
    checks.push({ id, ok, detail });
    if (!ok) errors.push(detail);
  };

  if (sealed.surface?.one_of) {
    const ok = inOneOf(answers.surface, sealed.surface.one_of);
    run('surface', ok, ok ? `surface ${answers.surface}` : `surface fail: ${answers.surface ?? '(missing)'}`);
  }

  if (sealed.language?.one_of) {
    const ok = inOneOf(answers.language, sealed.language.one_of);
    run('language', ok, ok ? `language ${answers.language}` : `language fail: ${answers.language ?? '(missing)'}`);
  }

  if (sealed.architecture_class?.one_of) {
    const cls = architectureClass(answers.architecture);
    const ok = cls && sealed.architecture_class.one_of.includes(cls);
    run(
      'architecture_class',
      ok,
      ok ? `arch class ${cls}` : `arch class fail: ${cls ?? answers.architecture ?? '(missing)'}`,
    );
  }

  if (sealed.telephony?.one_of) {
    const ok = inOneOf(answers.telephony, sealed.telephony.one_of);
    run('telephony', ok, ok ? `telephony ${answers.telephony}` : `telephony fail: ${answers.telephony ?? '(missing)'}`);
  }

  // Pack resolve path
  const menu = deps.menu || loadMenu();
  const providers = deps.providers || loadProviders();
  let expanded;
  let resolveReport = null;
  let impossibilities = [];
  let blocking = [];
  try {
    expanded = expandAnswers(answers, menu, { strict: false });
    impossibilities = detectImpossibilities(expanded, providers);
    blocking = impossibilities.filter((i) =>
      ['unknown_provider', 'no_audio_path', 'direction_mismatch', 'native_capability_conflict'].includes(i.code),
    );
    if (!blocking.length) {
      resolveReport = resolve(expanded, providers);
    }
  } catch (e) {
    run('expand_resolve', false, `expand/resolve error: ${e.message}`);
    return { pass: false, checks, errors, resolveReport: null, impossibilities: [] };
  }

  const unknown = impossibilities.filter((i) => i.code === 'unknown_provider');
  run(
    'no_unknown_provider',
    unknown.length === 0,
    unknown.length === 0
      ? 'no unknown providers'
      : `unknown providers: ${unknown.map((u) => u.message).join('; ')}`,
  );

  if (physics.require_possible !== false) {
    // missing_leg may be ok if optional paths; hard impossibilities fail
    run(
      'no_hard_impossibility',
      blocking.length === 0,
      blocking.length === 0
        ? 'no hard impossibilities'
        : blocking.map((b) => `[${b.code}] ${b.message}`).join('; '),
    );
  }

  const transformCount = resolveReport?.transforms?.length ?? null;

  if (physics.transform_band === '0') {
    const ok = transformCount === 0;
    run(
      'transform_band_0',
      ok,
      ok ? 'transforms=0 (native)' : `expected 0 transforms, got ${transformCount}`,
    );
  } else if (physics.transform_band === 'heavy') {
    const ok = typeof transformCount === 'number' && transformCount >= 3;
    run(
      'transform_band_heavy',
      ok,
      ok ? `transforms=${transformCount} (heavy)` : `expected ≥3 transforms, got ${transformCount}`,
    );
  }

  // If agent kept a heavy stack, they must not claim native/0 in contract — handled in G_CON/real optional.
  // Here: if oracle sets require_native_short_circuit, orchestration must normalize.
  if (physics.require_native_short_circuit) {
    const orchId = expanded?.providers?.orchestration?.id;
    const orch = orchId ? providers[orchId] : null;
    const native = !!(orch?.native_capabilities || []).includes('audio_normalization');
    run(
      'native_short_circuit',
      native && transformCount === 0,
      native && transformCount === 0
        ? `native path via ${orchId}`
        : `expected native audio_normalization with 0 transforms (orch=${orchId}, transforms=${transformCount})`,
    );
  }

  return {
    pass: errors.length === 0,
    checks,
    errors,
    resolveReport,
    impossibilities,
    transformCount,
  };
}
