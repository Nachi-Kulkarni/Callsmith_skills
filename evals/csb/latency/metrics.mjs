// Shared metric-boundary registry.
// One source of truth: validator (required events per profile), scorer (compute
// only when both boundaries are present), and the measurement runner (reject
// advertised metrics unavailable under a run's profile) all import this.
//
// Boundary timestamps are distinct from derived metrics: `provider_first_output_ms`
// is a boundary (first response received from the provider); the *metric*
// `speech_end_to_provider_output_ms` is the duration between two boundaries.
// Equal timestamps are valid only when one real callback represents both
// boundaries — never synthesized to satisfy a requirement.

// Derived metric name -> the two boundary timestamps it subtracts (end - start).
export const METRIC_BOUNDARIES = {
  turn_gap_ms: ["speech_end_ms", "audio_first_audible_ms"],
  // S2S response boundary: caller speech end -> first provider output (Gemini first modelTurn).
  speech_end_to_provider_output_ms: ["speech_end_ms", "provider_first_output_ms"],
  // provider output -> submitted to the local/transport playout path.
  provider_to_playout_ms: ["provider_first_output_ms", "audio_first_playout_ms"],
  // playout path -> first non-silent audio at the measurement boundary.
  playout_to_audible_ms: ["audio_first_playout_ms", "audio_first_audible_ms"],
  // Cascaded legs — each isolates one provider when its boundaries are real.
  delivery_playout_ms: ["tts_first_chunk_ms", "audio_first_audible_ms"],
  endpointing_ms: ["speech_end_ms", "eou_detected_ms"],
  transcript_commit_ms: ["eou_detected_ms", "transcript_final_ms"],
  pre_llm_queue_ms: ["transcript_final_ms", "llm_request_ms"],
  llm_ttft_ms: ["llm_request_ms", "llm_first_token_ms"],
  text_aggregation_ms: ["llm_first_token_ms", "text_committed_ms"],
  pre_tts_queue_ms: ["text_committed_ms", "tts_request_ms"],
  tts_first_chunk_ms: ["tts_request_ms", "tts_first_chunk_ms"],
};

// Which derived metrics each instrumentation profile is permitted to publish.
// S2S spans cross multiple providers (caller -> transport -> Gemini -> transport),
// so they are stack-level until boundaries isolate a single provider.
export const PROFILE_METRICS = {
  cascaded_full: [
    "turn_gap_ms",
    "endpointing_ms",
    "transcript_commit_ms",
    "pre_llm_queue_ms",
    "llm_ttft_ms",
    "text_aggregation_ms",
    "pre_tts_queue_ms",
    "tts_first_chunk_ms",
    "delivery_playout_ms",
  ],
  s2s_transport: [
    "turn_gap_ms",
    "speech_end_to_provider_output_ms",
    "provider_to_playout_ms",
    "playout_to_audible_ms",
  ],
  end_to_end: ["turn_gap_ms"],
};

export const INSTRUMENTATION_PROFILES = Object.keys(PROFILE_METRICS);

// Both boundaries of a metric present and finite non-negative on this turn.
// ponytail: boundary presence is a numeric check, not a provenance check.
// Whether an equal timestamp came from one real callback or dishonest copying
// cannot be decided numerically — that lives in adapter receipts.
export function metricBoundariesAvailable(metric, turn) {
  const boundaries = METRIC_BOUNDARIES[metric];
  if (!boundaries) return false;
  return boundaries.every((key) => Number.isFinite(turn[key]) && turn[key] >= 0);
}

// The set of boundary timestamp names a profile promises, in canonical order.
export function profileBoundaryNames(profile) {
  const metrics = PROFILE_METRICS[profile] || [];
  const names = new Set();
  for (const metric of metrics) {
    for (const boundary of METRIC_BOUNDARIES[metric] || []) names.add(boundary);
  }
  return [...names];
}
