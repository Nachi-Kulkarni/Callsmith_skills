const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function verifyPacks(providers, menu, options = {}) {
  const failures = [];
  const warnings = [];
  let checks = 0;
  const now = normalizeNow(options.now);
  const staleAfterDays = options.staleAfterDays ?? 60;

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
    validateUrls(pack.doc_urls, 'docs', addFailure);
    if (!pack.doc_urls?.length) addWarning('no official docs URL recorded');

    checks++;
    verifyProvenance(pack.verification, { now, staleAfterDays, addFailure, addWarning });

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
    verifyLatencyEvidence(pack, addFailure);

    checks++;
    verifyRegions(pack.deployment?.regions, addFailure);

    checks++;
    if (!pack.cost_estimates) {
      addFailure('missing cost_estimates');
    } else if (typeof pack.cost_estimates.per_minute_usd !== 'number') {
      addFailure('cost_estimates.per_minute_usd must be numeric');
    }

    checks++;
    if (!Array.isArray(pack.lifecycle) || pack.lifecycle.length === 0) addWarning('no lifecycle events recorded');
    if (!Array.isArray(pack.potholes)) addWarning('no potholes array recorded');
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
    generated_at: now.toISOString(),
    counts: {
      packs: Object.keys(providers).length,
      checks,
    },
    failures,
    warnings,
  };
}

/**
 * Quarterly-ritual helper (MAINTENANCE.md): which packs need re-verification soon,
 * in expiry order, with their primary sources. Expired packs (days_left < 0)
 * already fail verifyPacks; this report is the "schedule the refresh" view.
 */
export function packRefreshReport(providers, { now, withinDays = 30 } = {}) {
  const current = normalizeNow(now);
  const horizon = current.getTime() + withinDays * DAY_MS;
  const due = [];
  for (const [id, pack] of Object.entries(providers || {})) {
    const expiresAt = parseDateOnly(pack.verification?.expires_at, true);
    if (!expiresAt || expiresAt.getTime() > horizon) continue;
    due.push({
      pack: id,
      verified_at: pack.verification.verified_at,
      expires_at: pack.verification.expires_at,
      days_left: Math.ceil((expiresAt.getTime() - current.getTime()) / DAY_MS),
      sources: pack.verification.sources || [],
    });
  }
  due.sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  return { generated_at: current.toISOString(), within_days: withinDays, due };
}

function verifyRegions(regions, addFailure) {
  if (!regions) return addFailure('missing deployment.regions matrix');
  for (const field of ['media_edges', 'worker_regions', 'model_regions', 'recording_regions', 'transcript_regions']) {
    if (!Array.isArray(regions[field]) || !regions[field].length) addFailure(`deployment.regions.${field} must be non-empty`);
  }
  if (!parseDateOnly(regions.verified_at)) addFailure('deployment.regions.verified_at must be a real YYYY-MM-DD date');
  validateUrls(regions.sources, 'deployment region source', addFailure);
  if (!regions.sources?.length) addFailure('deployment.regions.sources must contain primary evidence URLs');
}

function verifyProvenance(verification, { now, staleAfterDays, addFailure, addWarning }) {
  if (!verification || typeof verification !== 'object') {
    addFailure('missing verification provenance (grade, verified_at, expires_at, sources)');
    return;
  }

  if (!['official_docs', 'official_repository', 'callsmith_measurement', 'community'].includes(verification.grade)) {
    addFailure(`verification.grade is unsupported: ${verification.grade ?? '<missing>'}`);
  }
  if (verification.grade === 'community') {
    addWarning('community-sourced pack requires independent review before production use');
  }
  validateUrls(verification.sources, 'verification source', addFailure);
  if (!verification.sources?.length) addFailure('verification.sources must contain primary evidence URLs');

  const verifiedAt = parseDateOnly(verification.verified_at);
  const expiresAt = parseDateOnly(verification.expires_at, true);
  if (!verifiedAt) addFailure('verification.verified_at must be a real YYYY-MM-DD date');
  if (!expiresAt) addFailure('verification.expires_at must be a real YYYY-MM-DD date');
  if (!verifiedAt || !expiresAt) return;

  if (verifiedAt > now) addFailure(`verification.verified_at is in the future (${verification.verified_at})`);
  if (expiresAt < verifiedAt) addFailure('verification.expires_at must not precede verified_at');
  if (now > expiresAt) {
    addFailure(`verification evidence expired on ${verification.expires_at}; re-check primary sources and refresh the pack`);
    return;
  }

  const ageDays = Math.floor((now - verifiedAt) / DAY_MS);
  if (ageDays >= staleAfterDays) {
    addWarning(`verification evidence is ${ageDays} days old and expires ${verification.expires_at}; schedule a source refresh`);
  }
}

function verifyLatencyEvidence(pack, addFailure) {
  const estimates = pack.latency_estimates;
  const evidence = pack.latency_evidence;
  if (!estimates) {
    if (evidence?.length) addFailure('latency_evidence exists without latency_estimates compatibility values');
    return;
  }
  if (!Array.isArray(evidence) || evidence.length === 0) {
    addFailure('latency_estimates require latency_evidence with source, region, sample size, and percentiles');
    return;
  }

  const expectedMetrics = Object.keys(estimates);
  for (const metric of expectedMetrics) {
    const entries = evidence.filter((item) => item?.metric === metric);
    if (entries.length !== 1) addFailure(`latency metric ${metric} must have exactly one latency_evidence entry`);
  }
  for (const item of evidence) {
    if (!item || typeof item !== 'object') {
      addFailure('latency_evidence entries must be objects');
      continue;
    }
    const label = `latency_evidence.${item.metric ?? '<missing>'}`;
    if (!(item.metric in estimates)) addFailure(`${label} has no matching latency_estimates metric`);
    if (!['planning_estimate', 'vendor_claim', 'callsmith_measurement'].includes(item.source)) {
      addFailure(`${label}.source is unsupported`);
    }
    if (typeof item.region !== 'string' || !item.region.trim()) addFailure(`${label}.region is required`);
    if (!Number.isInteger(item.sample_size) || item.sample_size < 0) addFailure(`${label}.sample_size must be a non-negative integer`);

    const percentiles = item.percentiles_ms;
    if (!percentiles || !['p50', 'p95', 'p99'].every((key) => key in percentiles)) {
      addFailure(`${label}.percentiles_ms must declare p50, p95, and p99 (use null when unavailable)`);
      continue;
    }
    const observed = ['p50', 'p95', 'p99'].map((key) => percentiles[key]);
    if (observed.some((value) => value !== null && (typeof value !== 'number' || value < 0))) {
      addFailure(`${label}.percentiles_ms values must be non-negative numbers or null`);
    }

    if (item.source === 'planning_estimate') {
      if (item.region !== 'not_measured' || item.sample_size !== 0 || observed.some((value) => value !== null)) {
        addFailure(`${label} planning estimates must use region=not_measured, sample_size=0, and null observed percentiles`);
      }
      if (!Number.isInteger(item.planning_value_ms) || item.planning_value_ms !== estimates[item.metric]) {
        addFailure(`${label}.planning_value_ms must equal latency_estimates.${item.metric}`);
      }
    } else {
      const numeric = observed.filter((value) => typeof value === 'number');
      if (numeric.length === 0) addFailure(`${label} ${item.source} must report at least one observed percentile`);
      if (numeric.length === 3 && !(observed[0] <= observed[1] && observed[1] <= observed[2])) {
        addFailure(`${label} percentiles must satisfy p50 <= p95 <= p99`);
      }
      if (item.source === 'callsmith_measurement' && item.sample_size === 0) {
        addFailure(`${label} Callsmith measurements require a positive sample_size`);
      }
      if (item.source === 'vendor_claim') {
        try {
          if (!item.source_url || !['http:', 'https:'].includes(new URL(item.source_url).protocol)) throw new Error();
        } catch {
          addFailure(`${label} vendor claims require a valid source_url`);
        }
      }
    }
    if (typeof item.methodology !== 'string' || !item.methodology.trim()) addFailure(`${label}.methodology is required`);
  }
}

function validateUrls(urls, label, addFailure) {
  for (const url of urls || []) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) addFailure(`unsupported ${label} URL protocol: ${url}`);
    } catch {
      addFailure(`invalid ${label} URL: ${url}`);
    }
  }
}

function parseDateOnly(value, endOfDay = false) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return null;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  const parsed = new Date(`${value}${suffix}`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return parsed;
}

function normalizeNow(value) {
  const now = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(now.getTime())) throw new TypeError('verifyPacks options.now must be a valid date');
  return now;
}

function requiresPinnedModel(pack) {
  return ['realtime', 'stt', 'tts', 'llm'].includes(pack.kind);
}
