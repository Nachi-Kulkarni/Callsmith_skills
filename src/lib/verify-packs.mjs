export function verifyPacks(providers, menu) {
  const failures = [];
  const warnings = [];
  let checks = 0;

  const providerIds = new Set(Object.keys(providers));
  for (const [id, pack] of Object.entries(providers)) {
    const addFailure = (message) => failures.push({ pack: id, message });
    const addWarning = (message) => warnings.push({ pack: id, message });

    checks++;
    if (!pack.id || pack.id !== id) addFailure(`pack id must match registry key (${id})`);
    if (!pack.kind) addFailure('missing kind');
    if (!pack.label) addFailure('missing label');
    if (!Array.isArray(pack.directions) || pack.directions.length === 0) addFailure('missing supported directions');
    if (!Array.isArray(pack.native_capabilities)) addFailure('missing native_capabilities array');

    checks++;
    if (!pack.ingest?.format || pack.ingest.sample_rate === undefined || pack.ingest.channels === undefined) {
      addFailure('missing ingest audio contract');
    }
    if (!pack.egress?.format || pack.egress.sample_rate === undefined || pack.egress.channels === undefined) {
      addFailure('missing egress audio contract');
    }

    checks++;
    for (const url of pack.doc_urls || []) {
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) addFailure(`unsupported docs URL protocol: ${url}`);
      } catch {
        addFailure(`invalid docs URL: ${url}`);
      }
    }
    if (!pack.doc_urls?.length) addWarning('no official docs URL recorded');

    checks++;
    if (requiresPinnedModel(pack) && !pack.model) addFailure('model-capable pack must pin a model id');
    // Floating aliases (where the provider silently revs what they point to) must fail.
    // NOTE: a denylist can never be complete; exact-pin staleness is ALSO guarded by
    // test/packs.test.mjs. Preview-tier names (e.g. gemini-...-preview) are legitimate
    // pinned ids, not floating aliases — their silent-rev risk is caught by that exact-pin test.
    if (pack.model && /latest|canary|nightly|\bauto\b/i.test(pack.model)) {
      addFailure(`model id is not pinned enough (floating alias): ${pack.model}`);
    }

    checks++;
    if (!pack.cost_estimates) {
      addFailure('missing cost_estimates');
    } else if (typeof pack.cost_estimates.per_minute_usd !== 'number') {
      addFailure('cost_estimates.per_minute_usd must be numeric');
    }

    checks++;
    if (!Array.isArray(pack.lifecycle) || pack.lifecycle.length === 0) addWarning('no lifecycle events recorded');
    if (!Array.isArray(pack.potholes)) addWarning('no potholes array recorded');
    if (!pack.context7?.library_id && !['vad'].includes(pack.kind)) {
      addWarning('no Context7 library id recorded for docs refresh');
    }
  }

  for (const group of menu.groups || []) {
    for (const option of group.options || []) {
      const provider = option.maps?.provider;
      checks++;
      if (provider && !providerIds.has(provider)) {
        failures.push({ pack: provider, message: `menu option ${group.id}/${option.id} references missing provider pack` });
      }
    }
  }

  return {
    status: failures.length ? 'FAIL' : warnings.length ? 'WARN' : 'PASS',
    generated_at: null,
    counts: {
      packs: Object.keys(providers).length,
      checks,
    },
    failures,
    warnings,
  };
}

function requiresPinnedModel(pack) {
  return ['realtime', 'stt', 'tts', 'llm'].includes(pack.kind);
}
