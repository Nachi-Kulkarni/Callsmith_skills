/**
 * Hard gate: provider packs validate; no generation product tests.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadProviders, loadMenu } from '../src/lib/resolver.mjs';
import { validatePacks } from '../src/lib/validate.mjs';
import { packRefreshReport, verifyPacks } from '../src/lib/verify-packs.mjs';

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
    // Real clock: pack dates are honest against today, not a frozen reference
    // point (verified_at must never be in the future relative to now).
    const report = verifyPacks(loadProviders(), loadMenu());
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
    const report = verifyPacks({ twilio: community }, { groups: [] }, { now: '2026-07-21T12:00:00Z' });
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

  it('no pack evidence is expired on the real clock (weekly CI treadmill alarm)', () => {
    // Frozen-clock tests above prove the logic; this one pages the owner when the
    // quarterly refresh ritual (MAINTENANCE.md) is overdue — the alarm doctor also raises.
    const report = verifyPacks(loadProviders(), loadMenu());
    const expired = report.failures.filter(({ message }) => /expired/.test(message));
    assert.deepEqual(expired, [], `pack evidence expired — run the refresh ritual: ${JSON.stringify(expired)}`);
  });

  it('lists the refresh treadmill in expiry order with primary sources', () => {
    const report = packRefreshReport(loadProviders(), { now: '2026-09-20T12:00:00Z', withinDays: 30 });
    // Gemini Live was refreshed on 2026-08-19; the other 20 packs are due within 30d.
    assert.equal(report.due.length, 20);
    assert.ok(!report.due.some(({ pack }) => pack === 'gemini-live'));
    assert.ok(report.due[0].expires_at <= report.due[1].expires_at, 'sorted by expiry');
    for (const item of report.due) {
      assert.ok(item.days_left >= 0 && item.days_left <= 30, `${item.pack} days_left`);
      assert.ok(item.sources.length >= 1, `${item.pack} carries its primary source`);
    }
  });

  it('treadmill stays quiet while evidence is fresh', () => {
    const report = packRefreshReport(loadProviders(), { now: '2026-07-21T12:00:00Z', withinDays: 14 });
    assert.equal(report.due.length, 0);
  });

  it('rejects unproven latency numbers and accepts a real measured distribution', () => {
    const original = loadProviders().openai;
    const missing = structuredClone(original);
    delete missing.latency_evidence;
    const missingReport = verifyPacks({ openai: missing }, { groups: [] }, { now: '2026-07-21T12:00:00Z' });
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
    const measuredReport = verifyPacks({ openai: measured }, { groups: [] }, { now: '2026-07-21T12:00:00Z' });
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

  it('orchestration packs carry deployment physics for the deploy playbook', () => {
    const providers = loadProviders();
    for (const id of ['livekit', 'pipecat', 'custom-fastapi']) {
      const dep = providers[id].deployment;
      assert.ok(dep, `${id} missing deployment block`);
      assert.ok(typeof dep.concurrency_model === 'string', `${id} concurrency_model`);
      assert.ok(typeof dep.drain_behavior === 'string', `${id} drain_behavior`);
    }
    // The custom bridge must never pretend a managed option exists.
    assert.equal(providers['custom-fastapi'].deployment.hosted_option, null);
    assert.equal(providers['custom-fastapi'].deployment.drain_behavior, 'user_implemented');
    assert.equal(providers.livekit.deployment.hosted_option.managed_runtime, true);
    assert.equal(providers.pipecat.deployment.hosted_option.managed_runtime, true);
  });

  it('deployment blocks (when present) declare honest hosted_option shape', () => {
    for (const pack of Object.values(loadProviders())) {
      if (!pack.deployment) continue;
      if (pack.deployment.hosted_option != null) {
        assert.equal(typeof pack.deployment.hosted_option.name, 'string', `${pack.id} hosted_option.name`);
        assert.equal(typeof pack.deployment.hosted_option.managed_runtime, 'boolean', `${pack.id} managed_runtime`);
        assert.equal(typeof pack.deployment.hosted_option.region_pinning, 'boolean', `${pack.id} region_pinning`);
      }
    }
  });

});
