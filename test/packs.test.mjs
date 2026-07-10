/**
 * Hard gate: provider packs validate; no generation product tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadProviders, loadMenu } from '../src/lib/resolver.mjs';
import { validatePacks } from '../src/lib/validate.mjs';
import { verifyPacks } from '../src/lib/verify-packs.mjs';

describe('provider packs', () => {
  it('loads packs', () => {
    const providers = loadProviders();
    assert.ok(Object.keys(providers).length >= 20, 'expected ~21 packs');
  });

  it('schema-validates every pack', () => {
    const errors = validatePacks();
    assert.deepEqual(errors, [], errors.join('\n'));
  });

  it('verify-packs has no failures', () => {
    const report = verifyPacks(loadProviders(), loadMenu(), { now: '2026-07-10T12:00:00Z' });
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures, null, 2));
  });

  it('requires dated primary-source provenance for every factual pack', () => {
    for (const pack of Object.values(loadProviders())) {
      assert.match(pack.verification.verified_at, /^\d{4}-\d{2}-\d{2}$/, `${pack.id} verified_at`);
      assert.match(pack.verification.expires_at, /^\d{4}-\d{2}-\d{2}$/, `${pack.id} expires_at`);
      assert.ok(pack.verification.sources.length > 0, `${pack.id} evidence sources`);
    }
  });

  it('labels community evidence without pretending it is first-party verification', () => {
    const community = structuredClone(loadProviders().twilio);
    community.verification.grade = 'community';
    const report = verifyPacks({ twilio: community }, { groups: [] }, { now: '2026-07-10T12:00:00Z' });
    assert.equal(report.failures.length, 0, JSON.stringify(report.failures, null, 2));
    assert.ok(report.warnings.some(({ message }) => /community-sourced/i.test(message)));
  });

  it('warns when evidence is aging and fails after its expiry using an injected clock', () => {
    const providers = loadProviders();
    const aging = verifyPacks(providers, { groups: [] }, { now: '2026-09-09T12:00:00Z' });
    assert.ok(aging.warnings.some(({ message }) => message.includes('61 days old')));
    assert.equal(aging.failures.length, 0, JSON.stringify(aging.failures, null, 2));

    const expired = verifyPacks(providers, { groups: [] }, { now: '2026-10-09T00:00:00Z' });
    assert.ok(expired.failures.some(({ message }) => message.includes('evidence expired on 2026-10-08')));
  });

  it('rejects unproven latency numbers and accepts a real measured distribution', () => {
    const original = loadProviders().openai;
    const missing = structuredClone(original);
    delete missing.latency_evidence;
    const missingReport = verifyPacks({ openai: missing }, { groups: [] }, { now: '2026-07-10T12:00:00Z' });
    assert.ok(missingReport.failures.some(({ message }) => message.includes('latency_estimates require latency_evidence')));

    const measured = structuredClone(original);
    measured.latency_evidence = [{
      metric: 'ttft_ms',
      source: 'callsmith_measurement',
      region: 'us-east',
      sample_size: 500,
      percentiles_ms: { p50: 280, p95: 510, p99: 740 },
      methodology: '500 warmed streaming requests over the production network path.',
    }];
    const measuredReport = verifyPacks({ openai: measured }, { groups: [] }, { now: '2026-07-10T12:00:00Z' });
    assert.equal(measuredReport.failures.length, 0, JSON.stringify(measuredReport.failures, null, 2));
  });

  it('uses ElevenLabs realtime guidance without the deprecated tuning parameter', () => {
    const pack = loadProviders().elevenlabs;
    assert.equal(pack.model, 'eleven_flash_v2_5');
    assert.match(pack.label, /Flash v2\.5/);
    assert.ok(pack.verification.sources.some((url) => url.endsWith('/overview/models')));
    assert.doesNotMatch(JSON.stringify(pack), /optimize_streaming_latency/);
  });

  it('telephony packs declare μ-law or L16 ingest', () => {
    const providers = loadProviders();
    const tel = Object.values(providers).filter((p) => p.kind === 'telephony');
    assert.ok(tel.length >= 5);
    for (const p of tel) {
      assert.ok(p.ingest?.format, `${p.id} missing ingest.format`);
      assert.ok(typeof p.ingest.sample_rate === 'number', `${p.id} missing sample_rate`);
    }
  });
});
