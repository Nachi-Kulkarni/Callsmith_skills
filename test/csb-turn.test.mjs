import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REQUIRED_EVENTS, validateTurnTrace } from "../evals/csb/latency/validate.mjs";
import { deriveTurnMetrics, nearestRank, scoreTurnTraces, summarizeTrace } from "../evals/csb/latency/score.mjs";
import { METRIC_BOUNDARIES, PROFILE_METRICS, metricBoundariesAvailable } from "../evals/csb/latency/metrics.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "evals", "csb", "latency", "fixtures");
const read = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, name), "utf8"));

test("trace schema and runtime validator require every latency boundary", () => {
  const schema = JSON.parse(fs.readFileSync(path.join(root, "reference", "turn-trace.schema.json"), "utf8"));
  const required = schema.$defs.turn.required;
  for (const event of REQUIRED_EVENTS) assert.ok(required.includes(event), `${event} absent from JSON Schema`);

  assert.equal(validateTurnTrace(read("fast-valid.json")).ok, true);
  const invalid = validateTurnTrace(read("missing-event.json"));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("llm_first_token_ms")));
});

test("controlled traces require labeled speech end and one monotonic clock", () => {
  const trace = read("fast-valid.json");
  trace.turns[0].speech_end_source = "detector";
  trace.clock.type = "wall";
  const result = validateTurnTrace(trace);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("must be labeled")));
  assert.ok(result.errors.some((error) => error.includes("must be monotonic")));
});

test("event ordering and complete cancellation spans are enforced", () => {
  const trace = read("fast-valid.json");
  trace.turns[0].tts_first_chunk_ms = trace.turns[0].tts_request_ms - 1;
  trace.turns[1].barge_in_detected_ms = 3800;
  const result = validateTurnTrace(trace);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("tts_first_chunk_ms must not precede")));
  assert.ok(result.errors.some((error) => error.includes("all barge-in/cancellation timestamps")));
});

test("nearest-rank percentiles and component spans are deterministic", () => {
  assert.equal(nearestRank([10, 30, 20, 40], 0.5), 20);
  assert.equal(nearestRank([10, 30, 20, 40], 0.95), 40);
  const trace = read("fast-valid.json");
  const metrics = deriveTurnMetrics(trace.turns[0]);
  assert.equal(metrics.turn_gap_ms, 700);
  assert.equal(metrics.llm_ttft_ms, 210);
  assert.equal(metrics.endpointing_ms, 140);
  const summary = summarizeTrace(trace);
  assert.deepEqual(Object.keys(summary.metrics).sort(), [
    "delivery_playout_ms", "endpointing_ms", "llm_ttft_ms", "pre_llm_queue_ms",
    "pre_tts_queue_ms", "text_aggregation_ms", "transcript_commit_ms",
    "tts_first_chunk_ms", "turn_gap_ms",
  ]);
  // Each metric carries coverage (n_applicable/n_observed) plus percentiles.
  assert.deepEqual(Object.keys(summary.metrics.turn_gap_ms).sort(), ["n_applicable", "n_observed", "p50", "p95", "p99"]);
});

test("the metric-boundary registry is internally consistent", () => {
  // Every metric's two boundaries exist, and every profile's metrics exist in the registry.
  for (const [metric, boundaries] of Object.entries(METRIC_BOUNDARIES)) {
    assert.equal(boundaries.length, 2, `${metric} must have exactly two boundaries`);
  }
  for (const [profile, metrics] of Object.entries(PROFILE_METRICS)) {
    for (const metric of metrics) {
      assert.ok(METRIC_BOUNDARIES[metric], `${profile} advertises unknown metric ${metric}`);
    }
  }
});

test("an s2s_transport trace validates with only observable boundaries and omits unobservable metrics", () => {
  const trace = read("s2s-valid.json");
  assert.equal(trace.schema_version, 2);
  assert.equal(trace.environment.instrumentation_profile, "s2s_transport");
  const validation = validateTurnTrace(trace);
  assert.equal(validation.ok, true, validation.errors.join("\n"));
  const summary = summarizeTrace(trace);
  // The four S2S profile metrics, none fabricated.
  assert.deepEqual(Object.keys(summary.metrics).sort(), [
    "playout_to_audible_ms", "provider_to_playout_ms",
    "speech_end_to_provider_output_ms", "turn_gap_ms",
  ]);
  // No cascaded-only leg is ever emitted for an S2S trace.
  assert.equal(summary.metrics.llm_ttft_ms, undefined);
  assert.equal(summary.metrics.pre_llm_queue_ms, undefined);
  for (const metric of Object.keys(summary.metrics)) {
    assert.equal(summary.metrics[metric].n_applicable, summary.metrics[metric].n_observed);
  }
});

test("an s2s turn missing a promised observable boundary fails validation", () => {
  const trace = read("s2s-valid.json");
  delete trace.turns[0].provider_first_output_ms;
  const result = validateTurnTrace(trace);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("provider_first_output_ms must be a non-negative number")));
});

test("a v2 trace cannot be compared against a v1 trace (mismatched contract)", () => {
  const baseline = read("slow-valid.json"); // v1 cascaded
  const candidate = read("s2s-valid.json"); // v2 s2s
  const result = scoreTurnTraces(baseline, candidate);
  assert.equal(result.valid, false);
});

test("boundary availability gates metric computation per turn", () => {
  const turn = { speech_end_ms: 1000, audio_first_audible_ms: 1500 };
  assert.equal(metricBoundariesAvailable("turn_gap_ms", turn), true);
  assert.equal(metricBoundariesAvailable("llm_ttft_ms", turn), false);
});

test("fast valid fixture improves p95 and passes all quality gates", () => {
  const result = scoreTurnTraces(read("slow-valid.json"), read("fast-valid.json"));
  assert.equal(result.valid, true);
  assert.equal(result.passed, true);
  assert.equal(result.metric, "p95_turn_gap_ms");
  assert.ok(result.improvement_ms > 0);
  assert.deepEqual(result.quality_vetoes, []);
  assert.equal(result.ci_eligible, true);
});

test("premature cutoff and false interruption buy no benchmark credit", () => {
  const oneTurnBaseline = read("slow-valid.json");
  oneTurnBaseline.turns = [oneTurnBaseline.turns[0]];
  oneTurnBaseline.turns[0].turn_id = "cutoff-1";
  const cutoff = scoreTurnTraces(oneTurnBaseline, read("premature-cutoff.json"));
  assert.equal(cutoff.valid, true);
  assert.equal(cutoff.passed, false);
  assert.ok(cutoff.quality_vetoes.some((veto) => veto.includes("premature_cutoff")));
  assert.ok(cutoff.quality_vetoes.some((veto) => veto.includes("incorrect_response")));

  oneTurnBaseline.turns[0].turn_id = "false-interruption-1";
  const interruption = scoreTurnTraces(oneTurnBaseline, read("false-interruption.json"));
  assert.equal(interruption.valid, true);
  assert.equal(interruption.passed, false);
  assert.ok(interruption.quality_vetoes.some((veto) => veto.includes("false_interruption")));
});

test("missing events make a comparison invalid rather than silently dropping samples", () => {
  const result = scoreTurnTraces(read("slow-valid.json"), read("missing-event.json"));
  assert.equal(result.valid, false);
  assert.equal(result.passed, false);
  assert.ok(result.errors.some((error) => error.includes("llm_first_token_ms")));
});

test("live tracks remain report-only for CI and preserve small-sample warning", () => {
  const baseline = read("slow-valid.json");
  const candidate = read("fast-valid.json");
  baseline.track = "live";
  candidate.track = "live";
  baseline.turns.forEach((turn) => { turn.speech_end_source = "detector"; });
  candidate.turns.forEach((turn) => { turn.speech_end_source = "detector"; });
  const result = scoreTurnTraces(baseline, candidate);
  assert.equal(result.valid, true);
  assert.equal(result.passed, true);
  assert.equal(result.ci_eligible, false);
  assert.ok(result.warnings.some((warning) => warning.includes("fewer than 100")));
});

test("different environment tags cannot be compared", () => {
  const baseline = read("slow-valid.json");
  const candidate = read("fast-valid.json");
  candidate.environment.region = "different-region";
  const result = scoreTurnTraces(baseline, candidate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("environment tags differ")));
});

test("network profile and audio format are mandatory comparison controls", () => {
  const trace = read("fast-valid.json");
  delete trace.environment.network_profile;
  delete trace.environment.audio_format;
  const result = validateTurnTrace(trace);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("environment.network_profile")));
  assert.ok(result.errors.some((error) => error.includes("environment.audio_format")));
});

test("controlled candidates cannot drop difficult samples", () => {
  const baseline = read("slow-valid.json");
  const candidate = read("fast-valid.json");
  candidate.turns.pop();
  const result = scoreTurnTraces(baseline, candidate);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("same turn_id sample set")));
});
