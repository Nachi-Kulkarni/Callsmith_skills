import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTurnTrace } from "./validate.mjs";

export function nearestRank(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) throw new Error("percentile requires at least one value");
  if (!(percentile > 0 && percentile <= 1)) throw new Error("percentile must be in (0, 1]");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

export function deriveTurnMetrics(turn) {
  return {
    turn_gap_ms: turn.audio_first_audible_ms - turn.speech_end_ms,
    endpointing_ms: turn.eou_detected_ms - turn.speech_end_ms,
    transcript_commit_ms: turn.transcript_final_ms - turn.eou_detected_ms,
    pre_llm_queue_ms: turn.llm_request_ms - turn.transcript_final_ms,
    llm_ttft_ms: turn.llm_first_token_ms - turn.llm_request_ms,
    text_aggregation_ms: turn.text_committed_ms - turn.llm_first_token_ms,
    pre_tts_queue_ms: turn.tts_request_ms - turn.text_committed_ms,
    tts_first_chunk_ms: turn.tts_first_chunk_ms - turn.tts_request_ms,
    delivery_playout_ms: turn.audio_first_audible_ms - turn.tts_first_chunk_ms,
  };
}

export function summarizeTrace(trace) {
  const validation = validateTurnTrace(trace);
  if (!validation.ok) throw new Error(`invalid turn trace:\n- ${validation.errors.join("\n- ")}`);
  const turns = trace.turns.map(deriveTurnMetrics);
  const metricNames = Object.keys(turns[0]);
  const metrics = Object.fromEntries(metricNames.map((name) => {
    const values = turns.map((turn) => turn[name]);
    return [name, {
      p50: nearestRank(values, 0.5),
      p95: nearestRank(values, 0.95),
      p99: nearestRank(values, 0.99),
    }];
  }));
  const counts = {
    premature_cutoff: trace.turns.filter((turn) => turn.quality.premature_cutoff).length,
    false_interruption: trace.turns.filter((turn) => turn.quality.false_interruption).length,
    incorrect_response: trace.turns.filter((turn) => !turn.quality.response_correct).length,
    audio_underruns: trace.turns.reduce((sum, turn) => sum + turn.quality.audio_underruns, 0),
  };
  return { samples: trace.turns.length, metrics, quality: counts };
}

function environmentDifference(baseline, candidate) {
  const ignored = new Set(["commit_sha"]);
  const normalize = (value, topLevel = false) => {
    if (Array.isArray(value)) return value.map((item) => normalize(item));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !(topLevel && ignored.has(key)))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, normalize(item)]));
  };
  return JSON.stringify(normalize(baseline.environment, true)) === JSON.stringify(normalize(candidate.environment, true));
}

export function scoreTurnTraces(baseline, candidate) {
  const baselineValidation = validateTurnTrace(baseline);
  const candidateValidation = validateTurnTrace(candidate);
  const errors = [
    ...baselineValidation.errors.map((error) => `baseline: ${error}`),
    ...candidateValidation.errors.map((error) => `candidate: ${error}`),
  ];
  if (errors.length) return { valid: false, passed: false, errors };
  if (baseline.track !== candidate.track) {
    return { valid: false, passed: false, errors: ["baseline and candidate tracks must match"] };
  }
  if (!environmentDifference(baseline, candidate)) {
    return { valid: false, passed: false, errors: ["baseline and candidate environment tags differ"] };
  }
  if (candidate.track === "controlled") {
    const baselineIds = baseline.turns.map((turn) => turn.turn_id).sort();
    const candidateIds = candidate.turns.map((turn) => turn.turn_id).sort();
    if (JSON.stringify(baselineIds) !== JSON.stringify(candidateIds)) {
      return { valid: false, passed: false, errors: ["controlled arms must contain the same turn_id sample set"] };
    }
  }

  const baselineSummary = summarizeTrace(baseline);
  const candidateSummary = summarizeTrace(candidate);
  const qualityVetoes = [];
  for (const key of Object.keys(candidateSummary.quality)) {
    if (candidate.track === "controlled" && candidateSummary.quality[key] > 0) {
      qualityVetoes.push(`controlled candidate ${key} must be zero`);
    }
    if (candidateSummary.quality[key] > baselineSummary.quality[key]) {
      qualityVetoes.push(`candidate ${key} regressed (${baselineSummary.quality[key]} → ${candidateSummary.quality[key]})`);
    }
  }

  const baselineP95 = baselineSummary.metrics.turn_gap_ms.p95;
  const candidateP95 = candidateSummary.metrics.turn_gap_ms.p95;
  const improvementMs = baselineP95 - candidateP95;
  const improvementPct = baselineP95 === 0 ? 0 : (improvementMs / baselineP95) * 100;
  const liveWarnings = candidate.track === "live" && Math.min(baselineSummary.samples, candidateSummary.samples) < 100
    ? ["live p99/SLO conclusions are directional with fewer than 100 samples per arm"]
    : [];

  return {
    valid: true,
    passed: improvementMs > 0 && qualityVetoes.length === 0,
    track: candidate.track,
    ci_eligible: candidate.track === "controlled",
    metric: "p95_turn_gap_ms",
    baseline: baselineSummary,
    candidate: candidateSummary,
    improvement_ms: improvementMs,
    improvement_pct: Number(improvementPct.toFixed(2)),
    quality_vetoes: qualityVetoes,
    warnings: liveWarnings,
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--baseline") args.baseline = argv[++index];
    else if (argv[index] === "--candidate") args.candidate = argv[++index];
    else if (argv[index] === "--help") args.help = true;
    else throw new Error(`unknown argument: ${argv[index]}`);
  }
  return args;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function runCli(argv = process.argv.slice(2)) {
  const ownDir = path.dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(argv);
  if (args.help) {
    console.log("Usage: node score.mjs [--baseline trace.json --candidate trace.json]");
    return 0;
  }
  const baselineFile = args.baseline || path.join(ownDir, "fixtures", "slow-valid.json");
  const candidateFile = args.candidate || path.join(ownDir, "fixtures", "fast-valid.json");
  if (Boolean(args.baseline) !== Boolean(args.candidate)) throw new Error("--baseline and --candidate must be provided together");
  const result = scoreTurnTraces(readJson(baselineFile), readJson(candidateFile));
  console.log(JSON.stringify(result, null, 2));
  return result.passed ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
