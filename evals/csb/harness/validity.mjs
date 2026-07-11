/** Reproducibility, trial validation, and statistics for CallsmithBench. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

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

export function validateActorTrial({ actor, artifacts, before = {}, startedAtMs }) {
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
    if (now.mtimeMs + 1 < startedAtMs) reasons.push(`${kind} artifact is stale`);
    const previous = before[file];
    if (previous?.exists && previous.hash === now.hash && previous.mtimeMs === now.mtimeMs) {
      reasons.push(`${kind} artifact was untouched by the actor`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function taskSuccess(score) {
  if (!score?.gates || score.gates.G_REAL !== true) return false;
  return Object.values(score.gates).length > 0 && Object.values(score.gates).every(Boolean);
}

export function summarizeValidPairs(pairs, { runs = 1 } = {}) {
  const valid = pairs.filter((pair) => pair?.valid !== false && pair?.WITH && pair?.BASE);
  const n = valid.length;
  const withValues = valid.map((p) => Number(taskSuccess(p.WITH)));
  const baseValues = valid.map((p) => Number(taskSuccess(p.BASE)));
  const pairedLift = withValues.map((value, i) => value - baseValues[i]);
  const gateNames = ['G_FLOOR', 'G_PHYS', 'G_CON', 'G_REAL'];

  const byScenario = new Map();
  for (const pair of valid) {
    const values = byScenario.get(pair.scenarioId) || [];
    values.push(taskSuccess(pair.WITH));
    byScenario.set(pair.scenarioId, values);
  }
  const passPower = [...byScenario.values()].map((values) => values.length === runs && values.every(Boolean));

  return {
    n_valid_pairs: n,
    task_success: {
      definition: 'all machine gates pass; G_REAL is a hard veto',
      WITH: mean(withValues),
      BASE: mean(baseValues),
      lift: mean(pairedLift),
      lift_95ci: meanConfidenceInterval(pairedLift),
    },
    pass_power_k: {
      k: runs,
      rate: mean(passPower.map(Number)),
      scenarios_complete: passPower.length,
    },
    diagnostic_gate_lift: Object.fromEntries(gateNames.map((gate) => [gate, mean(valid.map(
      (p) => Number(Boolean(p.WITH.gates?.[gate])) - Number(Boolean(p.BASE.gates?.[gate])),
    ))])),
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

function fileSnapshot(file) {
  if (!existsSync(file)) return { exists: false, size: 0, mtimeMs: null, hash: null };
  const stat = statSync(file);
  return { exists: true, size: stat.size, mtimeMs: stat.mtimeMs, hash: hashFile(file) };
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
