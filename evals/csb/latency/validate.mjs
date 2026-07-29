import fs from "node:fs";
import { INSTRUMENTATION_PROFILES, profileBoundaryNames } from "./metrics.mjs";

// v1 required events — the ten cascaded legs. Kept for v1 traces (zero regression)
// and as the cascaded_full profile boundary set in v2.
export const REQUIRED_EVENTS = [
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
];

const ARCHITECTURES = new Set(["realtime_s2s", "cascaded", "hybrid"]);
const SURFACES = new Set(["inbound_pstn", "outbound_pstn", "web_voice", "webrtc_app", "whatsapp_voice"]);
const TRACKS = new Set(["controlled", "live"]);
const SCHEMA_VERSIONS = new Set([1, 2]);

// Canonical ordering of all boundary timestamps. A v2 profile requires a subset;
// ordering is enforced only across the boundaries that are actually present.
export const BOUNDARY_ORDER = [
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
];

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// The required boundary set for a turn under a given (profile, path).
// v1 and cascaded_full: the ten cascaded legs.
// v2 s2s_transport / end_to_end: only the boundaries the profile exposes.
function requiredBoundaries(profile, path) {
  // Hybrid per-turn path takes precedence when present.
  if (path === "cascaded") return REQUIRED_EVENTS;
  if (path === "realtime_s2s") return profileBoundaryNames("s2s_transport");
  if (!profile) return REQUIRED_EVENTS; // v1 default
  return profileBoundaryNames(profile);
}

export function validateTurnTrace(trace) {
  const errors = [];
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return { ok: false, errors: ["trace must be an object"] };
  }

  if (!SCHEMA_VERSIONS.has(trace.schema_version)) errors.push("schema_version must be 1 or 2");
  if (!TRACKS.has(trace.track)) errors.push("track must be controlled or live");
  if (!nonEmpty(trace.run_id)) errors.push("run_id must be a non-empty string");

  const isV2 = trace.schema_version === 2;

  const env = trace.environment;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    errors.push("environment must be an object");
  } else {
    if (!ARCHITECTURES.has(env.architecture)) errors.push("environment.architecture is invalid");
    if (!SURFACES.has(env.surface)) errors.push("environment.surface is invalid");
    if (isV2 && !INSTRUMENTATION_PROFILES.includes(env.instrumentation_profile)) {
      errors.push("environment.instrumentation_profile must be one of: " + INSTRUMENTATION_PROFILES.join(", "));
    }
    for (const key of ["transport", "region", "runtime", "network_profile", "audio_format"]) {
      if (!nonEmpty(env[key])) errors.push(`environment.${key} must be a non-empty string`);
    }
    if (!env.providers || typeof env.providers !== "object" || Array.isArray(env.providers) || Object.keys(env.providers).length === 0) {
      errors.push("environment.providers must contain at least one provider/model tag");
    } else {
      for (const [key, value] of Object.entries(env.providers)) {
        if (!nonEmpty(key) || !nonEmpty(value)) errors.push("environment.providers keys and values must be non-empty strings");
      }
    }
  }

  const clock = trace.clock;
  if (!clock || typeof clock !== "object" || Array.isArray(clock)) {
    errors.push("clock must be an object");
  } else {
    if (clock.type !== "monotonic") errors.push("clock.type must be monotonic");
    if (clock.unit !== "ms") errors.push("clock.unit must be ms");
    if (!nonEmpty(clock.origin_id)) errors.push("clock.origin_id must be a non-empty string");
    if (clock.synchronization_error_ms !== undefined && (!Number.isFinite(clock.synchronization_error_ms) || clock.synchronization_error_ms < 0)) {
      errors.push("clock.synchronization_error_ms must be a non-negative number");
    }
  }

  if (!Array.isArray(trace.turns) || trace.turns.length === 0) {
    errors.push("turns must be a non-empty array");
    return { ok: false, errors };
  }

  const turnIds = new Set();
  trace.turns.forEach((turn, index) => {
    const at = `turns[${index}]`;
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!nonEmpty(turn.turn_id)) errors.push(`${at}.turn_id must be a non-empty string`);
    else if (turnIds.has(turn.turn_id)) errors.push(`${at}.turn_id must be unique`);
    else turnIds.add(turn.turn_id);

    // Required boundary set is profile-driven (v2) or the ten cascaded legs (v1).
    const profile = isV2 ? env.instrumentation_profile : null;
    const required = requiredBoundaries(profile, turn.path);
    for (const event of required) {
      if (!Number.isFinite(turn[event]) || turn[event] < 0) errors.push(`${at}.${event} must be a non-negative number`);
    }
    if (!new Set(["labeled", "detector"]).has(turn.speech_end_source)) {
      errors.push(`${at}.speech_end_source must be labeled or detector`);
    }
    if (trace.track === "controlled" && turn.speech_end_source !== "labeled") {
      errors.push(`${at}.speech_end_source must be labeled for controlled traces`);
    }

    // Ordering: enforce monotonicity only across the boundaries that are present,
    // in canonical order. A v2 S2S turn legitimately omits cascaded legs.
    const present = BOUNDARY_ORDER.filter((key) => Number.isFinite(turn[key]));
    for (let i = 1; i < present.length; i += 1) {
      if (turn[present[i]] < turn[present[i - 1]]) {
        errors.push(`${at}.${present[i]} must not precede ${present[i - 1]}`);
      }
    }

    const quality = turn.quality;
    if (!quality || typeof quality !== "object" || Array.isArray(quality)) {
      errors.push(`${at}.quality must be an object`);
    } else {
      for (const key of ["premature_cutoff", "false_interruption", "response_correct"]) {
        if (typeof quality[key] !== "boolean") errors.push(`${at}.quality.${key} must be boolean`);
      }
      if (!Number.isInteger(quality.audio_underruns) || quality.audio_underruns < 0) {
        errors.push(`${at}.quality.audio_underruns must be a non-negative integer`);
      }
    }

    const bargeKeys = ["barge_in_detected_ms", "cancellation_sent_ms", "cancellation_ack_ms"];
    const presentBargeKeys = bargeKeys.filter((key) => turn[key] !== undefined);
    if (presentBargeKeys.length !== 0 && presentBargeKeys.length !== bargeKeys.length) {
      errors.push(`${at} must record all barge-in/cancellation timestamps or none`);
    } else if (presentBargeKeys.length === bargeKeys.length) {
      if (!bargeKeys.every((key) => Number.isFinite(turn[key]) && turn[key] >= 0)) {
        errors.push(`${at} barge-in/cancellation timestamps must be non-negative numbers`);
      } else if (turn.cancellation_sent_ms < turn.barge_in_detected_ms || turn.cancellation_ack_ms < turn.cancellation_sent_ms) {
        errors.push(`${at} cancellation timestamps are out of order`);
      }
    }
  });

  return { ok: errors.length === 0, errors };
}

export function loadAndValidateTurnTrace(file) {
  const trace = JSON.parse(fs.readFileSync(file, "utf8"));
  const validation = validateTurnTrace(trace);
  return { trace, ...validation };
}
