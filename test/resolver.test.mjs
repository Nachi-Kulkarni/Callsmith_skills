/**
 * Direct unit tests for the resolver. All fixtures are in-memory pack objects —
 * no fixture dirs, no dependence on which packs are installed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  expandAnswers,
  resolve,
  planAudioDiff,
  resolveInterruption,
  resolveOperationsConfig,
  computeLatencyBudget,
  computeCost,
  detectImpossibilities,
  validateProviderId,
} from '../src/lib/resolver.mjs';

const pack = (id, over = {}) => ({ id, label: id, native_capabilities: [], ...over });

describe('planAudioDiff', () => {
  const e = (format, sample_rate) => ({ egress: { format, sample_rate } });
  const i = (format, sample_rate) => ({ ingest: { format, sample_rate } });
  const cases = [
    ['mulaw 8k -> pcm 16k decodes then resamples', e('mulaw', 8000), i('pcm', 16000),
      ['decode mulaw -> PCM', 'resample 8000 Hz -> 16000 Hz'], []],
    ['pcm 16k -> mulaw 8k resamples then encodes', e('pcm', 16000), i('mulaw', 8000),
      ['resample 16000 Hz -> 8000 Hz', 'encode PCM -> mulaw'], []],
    ['pcm 16k -> linear16 24k resamples then normalizes', e('pcm', 16000), i('linear16', 24000),
      ['resample 16000 Hz -> 24000 Hz', 'normalize pcm -> linear16'], []],
    ['pcm 24k -> pcm 24k is a no-op', e('pcm', 24000), i('pcm', 24000), [], []],
    ['pcm -> pcm resample at a new rate stays supported', e('pcm', 16000), i('pcm', 24000),
      ['resample 16000 Hz -> 24000 Hz'], []],
    ['mulaw -> mulaw at a new rate is unsupported', e('mulaw', 8000), i('mulaw', 16000),
      ['resample 8000 Hz -> 16000 Hz'], ['resample 8000 Hz -> 16000 Hz for mulaw']],
    ['opus -> pcm transcode is unsupported', e('opus', 24000), i('pcm', 16000),
      ['transcode opus -> pcm'], ['transcode opus -> pcm']],
  ];
  for (const [name, from, to, steps, unsupported] of cases) {
    it(name, () => {
      assert.deepEqual(planAudioDiff(from, to), { steps, unsupported });
    });
  }

  it('treats text/selectable/pcm-events/missing formats as no-audio sentinels', () => {
    for (const f of ['text', 'selectable', 'pcm-events', undefined]) {
      assert.deepEqual(planAudioDiff(e(f, 0), i('pcm', 16000)), { steps: [], unsupported: [] });
      assert.deepEqual(planAudioDiff(e('pcm', 16000), i(f, 0)), { steps: [], unsupported: [] });
    }
  });
});

describe('expandAnswers', () => {
  const menu = () => ({
    groups: [
      {
        id: 'architecture',
        options: [
          { id: 'realtime_s2s', label: 'Realtime', maps: { mode: 'realtime' } },
          { id: 'cascaded', label: 'Cascaded', maps: { mode: 'cascaded' } },
        ],
      },
      {
        id: 'telephony',
        default: 'twilio',
        options: [{ id: 'twilio', label: 'Twilio', maps: { provider: 'twilio', kind: 'telephony' } }],
      },
    ],
  });

  it('rejects a choice that is not one of the listed options', () => {
    assert.throws(
      () => expandAnswers({ architecture: 'quantum' }, menu()),
      /Invalid answer for "architecture": "quantum". Expected one of: realtime_s2s, cascaded/
    );
  });

  it('rejects unknown keys in strict mode', () => {
    assert.throws(
      () => expandAnswers({ architecture: 'realtime_s2s', telephony: 'twilio', bogus: 'x' }, menu(), { strict: true }),
      /Unknown answer key "bogus"/
    );
  });

  it('requires an answer for required groups in strict mode', () => {
    assert.throws(() => expandAnswers({}, menu(), { strict: true }), /Missing required answer for "architecture"/);
  });

  it('accepts an unlisted provider id via the kind-holder and maps flags', () => {
    const { providers, labels, flags } = expandAnswers({ architecture: 'cascaded', telephony: 'acme-voice' }, menu());
    assert.deepEqual(providers.telephony, { id: 'acme-voice', selectedVia: 'telephony' });
    assert.equal(labels.telephony, 'acme-voice');
    assert.equal(flags.mode, 'cascaded');
  });

  it('rejects hostile provider ids at the trust boundary', () => {
    assert.equal(validateProviderId('acme-voice'), 'acme-voice');
    assert.throws(() => expandAnswers({ telephony: 'bad id' }, menu()), /Invalid provider id "bad id"/);
  });
});

describe('resolve', () => {
  it('throws a styled error when realtime architecture has no realtime model', () => {
    assert.throws(
      () => resolve({ flags: { mode: 'realtime' }, providers: {}, labels: {} }, {}),
      /Realtime architecture requires a realtime model/
    );
    assert.throws(
      () => resolve({ flags: { mode: 'hybrid' }, providers: { stt: { id: 's' } }, labels: {} }, {}),
      /Realtime architecture requires a realtime model/
    );
  });

  it('marks a pothole mitigated only when a selected layer holds the matching capability', () => {
    const build = (orchCaps) => {
      const providers = {
        twilio: pack('twilio', {
          ingest: { format: 'text' }, egress: { format: 'text' },
          potholes: [{ id: 'codec-drift', severity: 'warning', note: 'bridge codecs', mitigated_by: ['audio_normalization'] }],
        }),
        livekit: pack('livekit', { native_capabilities: orchCaps }),
        deepgram: pack('deepgram', { ingest: { format: 'text' } }),
      };
      const sel = { telephony: { id: 'twilio' }, orchestration: { id: 'livekit' }, stt: { id: 'deepgram' } };
      return resolve({ flags: { needs_telephony: true, mode: 'cascaded' }, providers: sel, labels: {} }, providers);
    };
    const mitigated = build(['audio_normalization']).potholes[0];
    assert.equal(mitigated.source, 'twilio');
    assert.equal(mitigated.mitigated, true);
    assert.equal(mitigated.mitigatedByCapability, 'audio_normalization');
    assert.equal(build([]).potholes[0].mitigated, undefined);
  });
});

describe('resolveInterruption', () => {
  const providers = Object.fromEntries(
    ['v', 'r', 's', 'o', 'l', 't', 'p'].map(k => [k, pack(k, { interruption: { mechanism: 'm', description: 'd', code_hint: 'c' } })])
  );
  // Deliberately reverse key order to prove layer ordering, not insertion order, wins.
  const sel = { telephony: { id: 'p' }, tts: { id: 't' }, llm: { id: 'l' }, orchestration: { id: 'o' }, stt: { id: 's' }, realtime: { id: 'r' }, vad: { id: 'v' } };

  it('orders layers vad -> realtime -> stt -> orchestration -> llm -> tts -> telephony', () => {
    const steps = resolveInterruption(sel, providers, {}).steps;
    assert.deepEqual(steps.map(s => s.layer), [
      'Speech Detection', 'Realtime Model', 'Turn Endpointing', 'Pipeline Cancellation',
      'LLM Stream Cancel', 'TTS Output Stop', 'Media Playback Stop',
    ]);
    assert.deepEqual(steps.map(s => s.provider), ['v', 'r', 's', 'o', 'l', 't', 'p']);
  });

  it('is disabled when barge_in is false', () => {
    assert.deepEqual(resolveInterruption(sel, providers, { barge_in: false }), { enabled: false, steps: [] });
  });
});

describe('resolveOperationsConfig hosting rules (pack-driven)', () => {
  it('caps pipecat at hybrid_worker when managed cloud is requested', () => {
    const providers = { pipecat: pack('pipecat', { deployment: { hosting_rules: {
      cap: 'hybrid_worker', reason: 'worker is yours',
    } } }) };
    const sel = { orchestration: { id: 'pipecat' } };
    const out = resolveOperationsConfig(sel, providers, { hosting_model: 'managed_cloud' });
    assert.equal(out.effective_hosting_model, 'hybrid_worker');
    assert.deepEqual(out.adjustments, ['worker is yours']);
    // at or below the cap: no adjustment
    assert.equal(
      resolveOperationsConfig(sel, providers, { hosting_model: 'hybrid_worker' }).effective_hosting_model,
      'hybrid_worker',
    );
  });
});

describe('computeCost', () => {
  it('sums per-minute legs and scales to hour / 1k calls (hand-computed)', () => {
    const providers = {
      tel: pack('tel', { cost_estimates: { per_minute_usd: 0.004 } }),
      llm: pack('llm', { cost_estimates: { per_minute_usd: 0.003 } }),
      tts: pack('tts', { cost_estimates: { per_minute_usd: 0.002 } }),
    };
    const sel = { telephony: { id: 'tel' }, llm: { id: 'llm' }, tts: { id: 'tts' } };
    const out = computeCost(sel, providers);
    assert.deepEqual(out.legs.map(l => l.role), ['telephony', 'llm', 'tts']);
    assert.equal(out.total_per_minute_usd, 0.009); // 0.004 + 0.003 + 0.002
    assert.equal(out.per_hour_usd, 0.54);           // 0.009 * 60
    assert.equal(out.per_1k_calls_usd, 45);          // 0.009 * 5 * 1000
  });

  it('zeroes the platform per-minute fee only when the pack says self-hosting removes it', () => {
    const providers = { livekit: pack('livekit', { label: 'LiveKit Agents', cost_estimates: {
      per_minute_usd: 0.004, notes: 'cloud',
      self_host_platform_fee_zero: true,
      self_host_note: 'Self-hosted LiveKit removes the modeled LiveKit Cloud per-minute fee; infrastructure cost is not included.',
    } }) };
    const sel = { orchestration: { id: 'livekit' } };
    const leg = (hosting) => computeCost(sel, providers, {}, resolveOperationsConfig(sel, providers, { hosting_model: hosting })).legs[0];
    assert.equal(leg('self_hosted').per_minute_usd, 0);
    assert.match(leg('self_hosted').notes, /Self-hosted LiveKit removes the modeled LiveKit Cloud per-minute fee/);
    assert.equal(leg('managed_cloud').per_minute_usd, 0.004);
  });
});

describe('computeLatencyBudget', () => {
  const rt = (ms, source) => pack('rt', {
    latency_estimates: { response_start_ms: ms },
    latency_evidence: [{ metric: 'response_start_ms', source }],
  });
  const sel = { realtime: { id: 'rt' } };
  const budget = (ms, source, flags) => computeLatencyBudget(sel, { rt: rt(ms, source) }, { mode: 'realtime', ...flags });

  it('labels evidence class from the weakest source and withholds a verdict', () => {
    assert.equal(budget(300, 'planning_estimate', {}).evidence_class, 'planning_unmeasured');
    const vendor = budget(300, 'vendor_claim', {});
    assert.equal(vendor.evidence_class, 'vendor_claim');
    assert.equal(vendor.verdict, null);
    assert.match(vendor.note, /benchmark the deployment path/);
  });

  it('classifies measured totals against the 500/800/1200 targets', () => {
    assert.equal(budget(0, 'callsmith_measurement', { latency: 'ultra' }).target_ms, 500);
    assert.equal(budget(0, 'callsmith_measurement', { latency: 'balanced' }).target_ms, 800);
    assert.equal(budget(0, 'callsmith_measurement', {}).target_ms, 1200);
    assert.equal(budget(400, 'callsmith_measurement', { latency: 'ultra' }).verdict, 'within target');
    assert.equal(budget(700, 'callsmith_measurement', { latency: 'ultra' }).verdict, 'borderline'); // 700 <= 500 * 1.5
    assert.equal(budget(1300, 'callsmith_measurement', { latency: 'ultra' }).verdict, 'exceeds target');
    assert.equal(budget(300, 'callsmith_measurement', { latency: 'balanced' }).verdict, 'within target');
  });
});

describe('detectImpossibilities', () => {
  const twilio = pack('twilio', {
    label: 'Twilio',
    ingest: { format: 'mulaw', sample_rate: 8000 },
    egress: { format: 'mulaw', sample_rate: 8000 },
  });
  const opusRt = pack('opus-rt', {
    ingest: { format: 'opus', sample_rate: 24000 },
    egress: { format: 'opus', sample_rate: 24000 },
  });

  it('flags a selected provider with no installed pack', () => {
    const sel = { telephony: { id: 'ghost' }, realtime: { id: 'opus-rt' } };
    const out = detectImpossibilities({ flags: { needs_telephony: true, mode: 'realtime' }, providers: sel }, { 'opus-rt': opusRt });
    assert.equal(out.length, 1);
    assert.equal(out[0].code, 'unknown_provider');
    assert.match(out[0].message, /"ghost" was selected for telephony/);
  });

  it('region pin: a wholly-sentinel array exempts the leg, a mixed array must answer the pin', () => {
    const sentinel = pack('tel-any', {
      deployment: { regions: { media_edges: ['not_applicable'] } },
    });
    const mixed = pack('tel-mixed', {
      deployment: { regions: { media_edges: ['not_applicable', 'us-east'] } },
    });
    const flags = (id) => ({ needs_telephony: true, mode: 'realtime', region: 'in', direction: 'inbound' });
    const exempt = detectImpossibilities(
      { flags: flags('tel-any'), providers: { telephony: { id: 'tel-any' } } },
      { 'tel-any': sentinel },
    );
    assert.equal(exempt.filter(c => c.code === 'region_unverified').length, 0);
    const pinned = detectImpossibilities(
      { flags: flags('tel-mixed'), providers: { telephony: { id: 'tel-mixed' } } },
      { 'tel-mixed': mixed },
    );
    assert.equal(pinned.filter(c => c.code === 'region_unverified').length, 1);
    assert.match(pinned.find(c => c.code === 'region_unverified').message, /tel-mixed/);
  });

  it('flags cascaded stacks missing stt/llm/tts legs', () => {
    const out = detectImpossibilities({ flags: { mode: 'cascaded' }, providers: {} }, {});
    assert.equal(out.filter(c => c.code === 'missing_leg').length, 3);
  });

  it('flags unsupported inbound and outbound audio paths (opus over mulaw telephony)', () => {
    const sel = { telephony: { id: 'twilio' }, realtime: { id: 'opus-rt' } };
    const out = detectImpossibilities({ flags: { needs_telephony: true, mode: 'realtime' }, providers: sel }, { twilio, 'opus-rt': opusRt });
    const paths = out.filter(c => c.code === 'no_audio_path').map(c => c.message);
    assert.equal(paths.length, 2);
    assert.ok(paths.some(m => m.includes('inbound') && m.includes('transcode mulaw -> opus')));
    assert.ok(paths.some(m => m.includes('outbound') && m.includes('transcode opus -> mulaw')));
  });

  it('fires native_capability_conflict exactly once for symmetric declarations', () => {
    const sipCarrier = pack('sip-carrier', {
      label: 'SIP Carrier',
      native_capabilities: ['native_sip'],
      native_capability_conflicts: [{ capability: 'native_sip', conflicts_with: ['audio_normalization'], note: 'SIP media bypasses normalization' }],
    });
    const normalizer = pack('normalizer', {
      native_capabilities: ['audio_normalization'],
      native_capability_conflicts: [{ capability: 'audio_normalization', conflicts_with: ['native_sip'] }],
    });
    const sel = { telephony: { id: 'sip-carrier' }, orchestration: { id: 'normalizer' } };
    const out = detectImpossibilities(
      { flags: { needs_telephony: true, mode: 'cascaded' }, providers: sel },
      { 'sip-carrier': sipCarrier, normalizer }
    );
    const conflicts = out.filter(c => c.code === 'native_capability_conflict');
    assert.equal(conflicts.length, 1);
    assert.match(conflicts[0].message, /SIP Carrier \(telephony\) capability "native_sip" conflicts with normalizer/);
    assert.match(conflicts[0].message, /SIP media bypasses normalization/);
  });
});
