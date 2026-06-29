import fs from 'node:fs';
import path from 'node:path';
import { loadMenu, loadProviders, expandAnswers, resolve } from './resolver.mjs';
import { expectedScaffoldFiles } from './scaffold.mjs';
import { createSafeWriter } from './safe-write.mjs';

export function simulate(rawAnswers, outDir, opts = {}) {
  const menu = loadMenu();
  const providers = opts.providers ?? loadProviders();
  const answers = expandAnswers(rawAnswers, menu);
  const result = resolve(answers, providers);
  const writer = createSafeWriter(outDir, { force: opts.force === true, dryRun: opts.dryRun === true });
  const simRel = '.callsmith/simulation/trace.jsonl';

  const ratePacks = resolveRatePacks(answers, providers);
  const events = buildTrace(result, answers, ratePacks);
  const failures = [];
  const warnings = [];

  const eventNames = new Set(events.map(e => e.event));
  for (const required of requiredEvents(answers.flags)) {
    if (!eventNames.has(required)) {
      failures.push(explainMissingEvent(required, answers.flags));
    }
  }

  if (opts.scaffoldDir) {
    const scaffoldDir = path.resolve(opts.scaffoldDir);
    const missing = requiredScaffoldFiles(answers.flags, answers.providers)
      .filter(rel => !fs.existsSync(path.join(scaffoldDir, rel)));
    if (missing.length) {
      failures.push(
        `Scaffold at "${scaffoldDir}" is missing ${missing.length} expected file(s): ${missing.join(', ')}. ` +
        `Run \`callsmith scaffold --answers <file> --out ${scaffoldDir}\` to generate them first.`
      );
    }
  } else {
    warnings.push('No --scaffold directory supplied; simulation validated the compiled contract only. Pass --scaffold <dir> to also verify generated files exist.');
  }

  const metrics = computeMetrics(events, result);
  const checks = {
    audio_path: result.transforms.length
      ? result.transforms.map(t => `${t.direction}: ${t.step}`)
      : ['native audio normalization / passthrough'],
    first_response_under_target: metrics.first_response_ms <= result.latency.target_ms,
    barge_in_expected: answers.flags.barge_in === true || answers.flags.barge_in === 'optional',
    tool_mode: answers.flags.tools || 'none',
  };
  if (!checks.first_response_under_target) {
    warnings.push(`Simulated first response ${metrics.first_response_ms}ms exceeds target ${result.latency.target_ms}ms.`);
  }

  const report = {
    status: failures.length ? 'FAIL' : 'PASS',
    summary: failures.length
      ? `${failures.length} simulation checks failed`
      : 'fake call lifecycle completed',
    architecture: answers.flags.mode,
    stack: result.pipeline.map(p => ({ role: p.role, id: p.id, label: p.label })),
    metrics,
    checks,
    failures,
    warnings,
    events,
    files: {
      trace: path.join(writer.root, '.callsmith/simulation/trace.jsonl'),
      report: path.join(writer.root, '.callsmith/simulation/report.json'),
    },
  };

  writer.w('.callsmith/simulation/trace.jsonl', events.map(e => JSON.stringify(e)).join('\n') + '\n');
  writer.w('.callsmith/simulation/report.json', JSON.stringify(report, null, 2) + '\n');
  report.collisions = writer.collisions;
  report.overwritten = writer.overwritten;
  report.manifest = writer.manifest;
  report.dryRun = writer.dryRun;
  return report;
}

function requiredEvents(flags) {
  const events = [
    'call_started',
    'media_frame_in',
    flags.mode === 'realtime' ? 'realtime_input' : 'stt_partial',
    flags.mode === 'realtime' ? 'realtime_turn_complete' : 'stt_final',
    'agent_audio_out',
    'dtmf',
    'reconnect_started',
    'reconnect_finished',
    'call_ended',
  ];
  if (flags.mode !== 'realtime') events.push('llm_first_token', 'tts_first_audio');
  if (flags.barge_in === true || flags.barge_in === 'optional') {
    events.push('interruption_started', 'interruption_ended');
  }
  if (flags.tools && flags.tools !== 'none') events.push('tool_started', 'tool_finished');
  return events;
}

function explainMissingEvent(name, flags) {
  if (name === 'tool_started' || name === 'tool_finished') {
    return `Expected tool events because tools=${flags.tools || 'none'}, but the simulated ${flags.mode} lifecycle did not emit them. Fix: emit ${name} in your ${flags.mode} session, or set tools=none if this agent has no side-effecting calls.`;
  }
  return `missing simulated lifecycle event: ${name}. The simulation expected this event for architecture=${flags.mode}. Check .callsmith/context/simulation.md for the covered lifecycle.`;
}

function requiredScaffoldFiles(flags, selected) {
  return expectedScaffoldFiles(selected.orchestration?.id);
}

function buildTrace(result, answers, ratePacks) {
  const flags = answers.flags;
  const events = [];
  let t = 0;
  const push = (event, detail = {}, advance = 0) => {
    t += advance;
    events.push({ at_ms: t, event, ...detail });
  };

  const inRate = ratePacks.sink?.ingest?.sample_rate || 16000;
  const outRate = ratePacks.telephony?.ingest?.sample_rate || ratePacks.source?.egress?.sample_rate || 24000;
  const inCodec = ratePacks.telephony?.egress?.format === 'mulaw' ? 'mulaw->pcm' : 'pcm';

  push('call_started', { call_id: 'sim-call-001' });
  push('media_frame_in', { bytes: 320, sample_rate: inRate, codec: inCodec }, 20);
  push('media_frame_in', { bytes: 320, sample_rate: inRate, codec: inCodec }, 20);

  if (flags.mode === 'realtime') {
    push('realtime_input', { frame_count: 2 }, 40);
    // Fixed offsets before this event sum to 80ms (two media frames + realtime_input);
    // agent_audio_out adds 20ms after = 100ms total fixed offset. So advance by
    // total_ms - 100 to land first_response_ms exactly on the latency budget.
    push('realtime_turn_complete', { transcript: 'I need help with my order' }, Math.max(120, result.latency.total_ms - 100));
    if (flags.tools && flags.tools !== 'none') {
      push('tool_started', { name: `${flags.tools}_lookup`, idempotency_key: 'sim-call-001:lookup:1' }, 5);
      push('tool_finished', { name: `${flags.tools}_lookup`, status: 'ok', latency_ms: 120 }, 120);
    }
  } else {
    push('stt_partial', { text: 'I need help' }, latencyLeg(result, /STT/i, 120));
    push('stt_final', { text: 'I need help with my order' }, 80);
    push('llm_first_token', { token: 'Sure' }, latencyLeg(result, /LLM/i, 150));
    if (flags.tools && flags.tools !== 'none') {
      push('tool_started', { name: `${flags.tools}_lookup`, idempotency_key: 'sim-call-001:lookup:1' }, 5);
      push('tool_finished', { name: `${flags.tools}_lookup`, status: 'ok', latency_ms: 120 }, 120);
    }
    push('tts_first_audio', { bytes: 960 }, latencyLeg(result, /TTS/i, 150));
  }

  push('agent_audio_out', { bytes: 960, sample_rate: outRate }, 20);
  if (flags.barge_in === true || flags.barge_in === 'optional') {
    push('interruption_started', { reason: 'caller_speech_during_playback' }, 60);
    push('agent_audio_cleared', { buffered_frames: 3 }, 5);
    push('interruption_ended', { action: 'resume_listening' }, 40);
  }
  push('dtmf', { digits: '1' }, 50);
  push('transcript_persisted', { turns: 2 }, 10);
  push('reconnect_started', { retry: 1 }, 10);
  push('reconnect_finished', { retry: 1, latency_ms: 250 }, 250);
  push('call_ended', { reason: 'caller_hangup' }, 20);
  return events;
}

// Resolve the audio-relevant packs directly from the selection so the simulator reads
// sample rates from the source of truth instead of regex-parsing transform prose.
// This stays correct even when the mulaw-emit gate suppresses an outbound transform.
function resolveRatePacks(answers, providers) {
  const sel = answers.providers;
  const mode = answers.flags.mode;
  const isRt = mode === 'realtime' || mode === 'hybrid';
  const pick = (selection) => selection?.id ? providers[selection.id] : null;
  return {
    telephony: pick(sel.telephony),
    sink: pick(isRt ? sel.realtime : sel.stt),
    source: pick(isRt ? sel.realtime : sel.tts),
  };
}

function latencyLeg(result, regex, fallback) {
  return result.latency.legs.find(l => regex.test(l.label))?.ms || fallback;
}

function computeMetrics(events, result) {
  const started = events.find(e => e.event === 'call_started')?.at_ms ?? 0;
  const firstAudio = events.find(e => e.event === 'agent_audio_out')?.at_ms ?? result.latency.total_ms;
  const tools = events.filter(e => e.event === 'tool_finished');
  return {
    first_response_ms: firstAudio - started,
    tool_count: tools.length,
    tool_latency_ms: tools.reduce((sum, e) => sum + (e.latency_ms || 0), 0),
  };
}
