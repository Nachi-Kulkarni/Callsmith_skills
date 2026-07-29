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
// so they are stack level until boundaries isolate a single provider.
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

// EXPLICIT required-boundary set per profile — NOT derived from metric endpoints.
// Required raw boundaries and publishable metrics are related but not identical:
// cascaded_full requires audio_first_playout_ms on every turn even though no
// published cascaded metric subtracts it (it is a boundary, consumed indirectly).
// Deriving from metric endpoints silently dropped it. This table is the contract.
export const PROFILE_REQUIRED_BOUNDARIES = {
  cascaded_full: [
    "speech_end_ms",
    "eou_detected_ms",
    "transcript_final_ms",
    "llm_request_ms",
    "llm_first_token_ms",
    "text_committed_ms",
    "tts_request_ms",
    "tts_first_chunk_ms",
    "audio_first_playout_ms",
    "audio_first_audible_ms",
  ],
  s2s_transport: [
    "speech_end_ms",
    "provider_first_output_ms",
    "audio_first_playout_ms",
    "audio_first_audible_ms",
  ],
  end_to_end: ["speech_end_ms", "audio_first_audible_ms"],
};

// Which architecture may declare which profile. An s2s profile on a cascaded
// architecture (or vice versa) is a contract mismatch and must fail closed.
export const ARCH_PROFILE_COMPAT = {
  realtime_s2s: ["s2s_transport", "end_to_end"],
  cascaded: ["cascaded_full", "end_to_end"],
  hybrid: ["cascaded_full", "s2s_transport", "end_to_end"],
};

// Every boundary timestamp the schema knows about, for presence/range checks on
// optional fields (e.g. playback_completed_ms is optional but if present must be
// a finite non-negative number).
export const KNOWN_BOUNDARIES = [
  ...new Set([
    "speech_end_ms",
    "eou_detected_ms",
    "transcript_final_ms",
    "llm_request_ms",
    "llm_first_token_ms",
    "text_committed_ms",
    "tts_request_ms",
    "tts_first_chunk_ms",
    "provider_first_output_ms",
    "audio_first_playout_ms",
    "audio_first_audible_ms",
    "playback_completed_ms",
  ]),
];

// Both boundaries of a metric present and finite non-negative on this turn.
// ponytail: boundary presence is a numeric check, not a provenance check.
// Whether an equal timestamp came from one real callback or dishonest copying
// cannot be decided numerically — that lives in adapter receipts.
export function metricBoundariesAvailable(metric, turn) {
  const boundaries = METRIC_BOUNDARIES[metric];
  if (!boundaries) return false;
  return boundaries.every((key) => Number.isFinite(turn[key]) && turn[key] >= 0);
}
