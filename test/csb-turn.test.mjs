import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { REQUIRED_EVENTS, validateTurnTrace } from "../evals/csb/latency/validate.mjs";
import { deriveTurnMetrics, nearestRank, scoreTurnTraces, summarizeTrace } from "../evals/csb/latency/score.mjs";

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
  assert.deepEqual(Object.keys(summary.metrics.turn_gap_ms).sort(), ["p50", "p95", "p99"]);
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
