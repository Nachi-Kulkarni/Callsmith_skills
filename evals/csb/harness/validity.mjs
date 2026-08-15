/** Reproducibility, trial validation, and statistics for CallsmithBench. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function hashFile(file) {
  return sha256(readFileSync(file));
}

export function seededSchedule(scenarioIds, runs, arms, seed) {
  const schedule = [];
  const count = positiveInteger(runs, 'runs');
  for (let trial = 1; trial <= count; trial += 1) {
    const scenarios = shuffle([...scenarioIds], rng(`${seed}:trial:${trial}`));
    for (const scenarioId of scenarios) {
      let armOrder = [...arms];
      if (armOrder.length === 2) {
        const initial = Number.parseInt(sha256(`${seed}:${scenarioId}`).slice(0, 8), 16) % 2;
        const flip = (initial + trial - 1) % 2;
        if (flip) armOrder.reverse();
      }
      schedule.push({ trial, scenarioId, arms: armOrder });
    }
  }
  return schedule;
}

export function snapshotArtifacts(paths) {
  return Object.fromEntries(paths.map((file) => [file, fileSnapshot(file)]));
}

export function validateActorTrial({ actor, artifacts, immutable = {}, before = {}, startedAtMs }) {
  const reasons = [];
  if (actor?.status !== 0) reasons.push(`actor exit status was ${String(actor?.status)}`);
  if (actor?.timedOut) reasons.push('actor timed out');
  if (actor?.error) reasons.push(`actor error: ${actor.error}`);
  if (actor?.stdoutTruncated) reasons.push('actor stdout was truncated');
  if (actor?.stderrTruncated) reasons.push('actor stderr was truncated');
  if (actor?.traceRequired && actor?.trace?.valid !== true) {
    reasons.push(...(actor?.trace?.invalid_reasons || ['required actor trace is invalid']));
  }

  for (const [kind, file] of Object.entries(artifacts)) {
    const now = fileSnapshot(file);
    if (!now.exists) {
      reasons.push(`${kind} artifact is missing`);
      continue;
    }
    if (now.size === 0) reasons.push(`${kind} artifact is empty`);
    if (now.isSymlink) {
      reasons.push(`${kind} artifact must not be a symlink`);
      continue;
    }
    if (!now.isRegular) {
      reasons.push(`${kind} artifact must be a regular file`);
      continue;
    }
    if (now.mtimeMs + 1 < startedAtMs) reasons.push(`${kind} artifact is stale`);
    const previous = before[file];
    if (previous?.exists && previous.hash === now.hash) {
      reasons.push(`${kind} artifact was untouched by the actor`);
    }
  }
  for (const [kind, file] of Object.entries(immutable)) {
    const previous = before[file];
    const now = fileSnapshot(file);
    if (!previous?.exists) {
      reasons.push(`${kind} control lacks an initial snapshot`);
      continue;
    }
    if (!now.exists) {
      reasons.push(`${kind} control is missing after the actor run`);
      continue;
    }
    if (now.isSymlink) {
      reasons.push(`${kind} control must not be a symlink`);
      continue;
    }
    if (!now.isRegular) {
      reasons.push(`${kind} control must be a regular file`);
      continue;
    }
    if (previous.hash !== now.hash) reasons.push(`${kind} control was modified by the actor`);
  }
  return { valid: reasons.length === 0, reasons };
}

export function taskSuccess(score) {
  if (!score?.gates || score.gates.G_REAL !== true) return false;
  return Object.values(score.gates).length > 0 && Object.values(score.gates).every(Boolean);
}

export function summarizeValidPairs(pairs, { runs = 1, regulatedScenarioIds = [] } = {}) {
  const valid = pairs.filter((pair) => pair?.valid !== false && pair?.WITH && pair?.BASE);
  const n = valid.length;
  const withValues = valid.map((p) => Number(taskSuccess(p.WITH)));
  const baseValues = valid.map((p) => Number(taskSuccess(p.BASE)));
  const pairedLift = withValues.map((value, i) => value - baseValues[i]);
  const gateNames = ['G_FLOOR', 'G_PHYS', 'G_CON', 'G_REAL'];
  const regulated = new Set(regulatedScenarioIds);

  const byScenario = new Map();
  const liftByScenario = new Map();
  for (const [i, pair] of valid.entries()) {
    const values = byScenario.get(pair.scenarioId) || [];
    values.push(taskSuccess(pair.WITH));
    byScenario.set(pair.scenarioId, values);
    // Repeated trials of one scenario are correlated; the interval must resample
    // scenarios (clusters), not trials, or runs>1 understates uncertainty.
    const lifts = liftByScenario.get(pair.scenarioId) || [];
    lifts.push(pairedLift[i]);
    liftByScenario.set(pair.scenarioId, lifts);
  }
  const passPower = [...byScenario.values()].map((values) => values.length === runs && values.every(Boolean));
  const regulatedPassPower = [...byScenario.entries()]
    .filter(([scenarioId]) => regulated.has(scenarioId))
    .map(([, values]) => values.length === runs && values.every(Boolean));
  const gateRates = Object.fromEntries(gateNames.map((gate) => {
    const WITH = mean(valid.map((p) => Number(Boolean(p.WITH.gates?.[gate]))));
    const BASE = mean(valid.map((p) => Number(Boolean(p.BASE.gates?.[gate]))));
    return [gate, { WITH, BASE, lift: round(WITH - BASE) }];
  }));

  return {
    n_valid_pairs: n,
    task_success: {
      definition: 'all machine gates pass; G_REAL is a hard veto',
      WITH: mean(withValues),
      BASE: mean(baseValues),
      lift: mean(pairedLift),
      lift_95ci: clusterConfidenceInterval([...liftByScenario.values()]),
    },
    pass_power_k: {
      k: runs,
      rate: mean(passPower.map(Number)),
      scenarios_complete: passPower.length,
    },
    regulated_pass_power_k: {
      k: runs,
      rate: mean(regulatedPassPower.map(Number)),
      scenarios_complete: regulatedPassPower.length,
      scenario_ids: [...regulated],
    },
    gate_rates: gateRates,
    floor_lift: gateRates.G_FLOOR.lift,
    physics_lift: gateRates.G_PHYS.lift,
    contract_lift: gateRates.G_CON.lift,
    base_fail: mean(valid.map((p) => Number(
      !p.BASE.gates?.G_FLOOR || !p.BASE.gates?.G_PHYS,
    ))),
    // Discriminating gates: where the fairness-hardened interface still lets BASE
    // fail on judgment (floors, contract). Physics/reality sit at BASE ceiling on
    // current models, so publication weight lives here (DESIGN.md §4).
    base_discriminating_fail: mean(valid.map((p) => Number(
      !p.BASE.gates?.G_FLOOR || !p.BASE.gates?.G_CON,
    ))),
    diagnostic_gate_lift: Object.fromEntries(gateNames.map((gate) => [gate, gateRates[gate].lift])),
    diagnostic_gate_score_delta: mean(valid.map((p) => p.WITH.gateScore - p.BASE.gateScore)),
  };
}

export function meanConfidenceInterval(values) {
  if (!values.length) return null;
  const center = mean(values);
  if (values.length < 2) return { low: center, high: center, method: 'single_pair_no_variance' };
  const random = rng(`paired-bootstrap:${JSON.stringify(values)}`);
  const samples = [];
  for (let draw = 0; draw < 10_000; draw += 1) {
    let total = 0;
    for (let i = 0; i < values.length; i += 1) {
      total += values[Math.floor(random() * values.length)];
    }
    samples.push(total / values.length);
  }
  samples.sort((a, b) => a - b);
  return {
    low: round(samples[Math.floor(0.025 * (samples.length - 1))]),
    high: round(samples[Math.ceil(0.975 * (samples.length - 1))]),
    method: 'paired_bootstrap_percentile_95_10000',
  };
}

/** Percentile bootstrap over clusters (e.g. per-scenario groups), not raw values. */
export function clusterConfidenceInterval(clusters) {
  const groups = (clusters || []).filter((group) => Array.isArray(group) && group.length);
  const flat = groups.flat();
  if (!flat.length) return null;
  const center = mean(flat);
  if (groups.length < 2) return { low: center, high: center, method: 'single_cluster_no_variance' };
  const random = rng(`cluster-bootstrap:${JSON.stringify(groups)}`);
  const samples = [];
  for (let draw = 0; draw < 10_000; draw += 1) {
    let total = 0;
    let count = 0;
    for (let g = 0; g < groups.length; g += 1) {
      const group = groups[Math.floor(random() * groups.length)];
      for (const value of group) {
        total += value;
        count += 1;
      }
    }
    samples.push(total / count);
  }
  samples.sort((a, b) => a - b);
  return {
    low: round(samples[Math.floor(0.025 * (samples.length - 1))]),
    high: round(samples[Math.ceil(0.975 * (samples.length - 1))]),
    method: 'cluster_bootstrap_percentile_95_10000_by_scenario',
  };
}

function fileSnapshot(file) {
  if (!existsSync(file)) return { exists: false, size: 0, mtimeMs: null, hash: null };
  const stat = lstatSync(file);
  if (stat.isSymbolicLink()) {
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, hash: null, isSymlink: true, isRegular: false };
  }
  if (!stat.isFile()) {
    return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, hash: null, isSymlink: false, isRegular: false };
  }
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, hash: hashFile(file), isSymlink: false, isRegular: true };
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function rng(seed) {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffle(items, random) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function mean(values) {
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
