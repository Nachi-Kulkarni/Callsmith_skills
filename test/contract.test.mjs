import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseContractReceipt,
  validateContract,
  validateContractAnswers,
  validateContractReceipt,
  REQUIRED_SECTIONS,
} from '../src/lib/contract.mjs';
import { loadMenu, loadProviders } from '../src/lib/resolver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'callsmith.mjs');
const EXAMPLE = path.join(ROOT, 'examples', 'clinic-triage', 'callsmith.recipe.md');
const EXAMPLE_ANSWERS = path.join(ROOT, 'examples', 'clinic-triage', 'voice.answers.json');

function run(...args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
  });
}

describe('contract validate (G5)', () => {
  it('empty contract fails', () => {
    const r = validateContract('');
    assert.equal(r.status, 'FAIL');
    assert.ok(r.errors.length);
  });

  it('example clinic contract passes with medical floors', () => {
    const text = fs.readFileSync(EXAMPLE, 'utf8');
    const r = validateContract(text, { domain: 'medical' });
    assert.equal(r.status, 'PASS', JSON.stringify(r.errors));
    assert.equal(r.domain, 'medical');
    assert.ok(r.sections.every((s) => s.present));
    assert.ok(r.floors.length >= 1);
    assert.ok(r.floors.every((f) => f.present));
  });

  it('CLI contract validate --file example --domain medical', () => {
    const r = run('contract', 'validate', '--file', EXAMPLE, '--answers', EXAMPLE_ANSWERS, '--domain', 'medical');
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /PASS/);
    assert.match(r.stdout, /answers OK\s+provider\.telephony/);
  });

  it('fails when the receipt and answers disagree', () => {
    const text = fs.readFileSync(EXAMPLE, 'utf8');
    const report = validateContract(text, { domain: 'medical' });
    const answers = JSON.parse(fs.readFileSync(EXAMPLE_ANSWERS, 'utf8'));
    answers.telephony = 'exotel';
    const consistency = validateContractAnswers(report.receipt, answers, loadMenu());
    assert.equal(consistency.status, 'FAIL');
    assert.match(consistency.errors.join('; '), /provider\.telephony mismatch/);
  });

  it('CLI exits nonzero when --answers disagrees with the receipt', () => {
    const mismatch = path.join(ROOT, 'test', '_mismatched-answers.json');
    const answers = JSON.parse(fs.readFileSync(EXAMPLE_ANSWERS, 'utf8'));
    answers.telephony = 'exotel';
    fs.writeFileSync(mismatch, `${JSON.stringify(answers, null, 2)}\n`);
    try {
      const r = run('contract', 'validate', '--file', EXAMPLE, '--answers', mismatch, '--domain', 'medical');
      assert.equal(r.status, 1);
      assert.match(r.stdout + r.stderr, /provider\.telephony|answers MISS/i);
    } finally {
      fs.unlinkSync(mismatch);
    }
  });

  it('CLI fails on thin stub', () => {
    const stub = path.join(ROOT, 'test', '_stub-contract.md');
    fs.writeFileSync(stub, '# Hello\n\nNo real sections.\n');
    try {
      const r = run('contract', 'validate', '--file', stub);
      assert.equal(r.status, 1);
      assert.match(r.stdout + r.stderr, /FAIL|MISS|missing/i);
    } finally {
      fs.unlinkSync(stub);
    }
  });

  it('standalone CLI rejects a regulated keyword-theater fixture', () => {
    const fixture = path.join(ROOT, 'evals/csb/scenarios/bank-kyc/fixtures/keyword-theater.recipe.md');
    const r = run('contract', 'validate', '--file', fixture, '--domain', 'banking');
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /callsmith-contract receipt/i);
  });

  it('rejects prose-only keyword theater', () => {
    const prose = REQUIRED_SECTIONS.map((section) => `## ${section.label}\n\nConsent retention handoff latency 500 ms provider build.`).join('\n\n');
    const r = validateContract(prose, { domain: 'medical' });
    assert.equal(r.status, 'FAIL');
    assert.match(r.errors.join('; '), /missing .*callsmith-contract receipt/i);
  });

  it('parses a receipt and rejects unknown providers when a catalog is supplied', () => {
    const text = '```json callsmith-contract\n{"schema_version":1}\n```';
    assert.equal(parseContractReceipt(text).receipt.schema_version, 1);
    const r = validateContractReceipt({
      schema_version: 1,
      domain: 'general',
      surface: 'web_voice',
      providers: { orchestration: 'invented-provider' },
      policy: {
        basis: 'organization_policy',
        retention_basis: 'Internal policy.',
        recording_consent: 'none',
        transcript_retention: 'ephemeral',
        human_handoff: 'none',
      },
      latency_slo: { metric: 'turn_gap_ms', percentile: 95, target_ms: 800 },
    }, { providers: new Set(['livekit']) });
    assert.equal(r.status, 'FAIL');
    assert.match(r.errors.join('; '), /unknown provider/i);
  });

  it('requires explicit acceptance to reduce a regulated default', () => {
    const receipt = {
      schema_version: 1,
      domain: 'medical',
      surface: 'inbound_pstn',
      providers: { telephony: 'twilio' },
      policy: {
        jurisdiction: 'US',
        basis: 'organization_policy',
        retention_basis: 'Clinic policy.',
        recording_consent: 'none',
        transcript_retention: 'seven_days',
        human_handoff: 'ticket',
      },
      latency_slo: { metric: 'turn_gap_ms', percentile: 95, target_ms: 900 },
    };
    assert.equal(validateContractReceipt(receipt).status, 'FAIL');
    receipt.policy.basis = 'explicit_risk_acceptance';
    receipt.policy.override = { accepted_by: 'Safety owner', reason: 'Approved pilot exception.' };
    const accepted = validateContractReceipt(receipt);
    assert.equal(accepted.status, 'PASS', accepted.errors.join('; '));
    assert.ok(accepted.warnings.length);
  });
});

describe('contract deployment receipt (optional section)', () => {
  const providers = loadProviders();
  const receipt = (overrides = {}) => ({
    schema_version: 1,
    domain: 'general',
    surface: 'inbound_pstn',
    providers: { telephony: 'twilio', orchestration: 'livekit', realtime: 'gemini-live' },
    policy: {
      basis: 'organization_policy',
      retention_basis: 'Internal policy.',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      human_handoff: 'transfer',
    },
    latency_slo: { metric: 'turn_gap_ms', percentile: 95, target_ms: 1200 },
    ...overrides,
  });

  it('accepts a self-host deployment section', () => {
    const r = validateContractReceipt(
      receipt({ deployment: { target: 'railway', region: 'us', drain_owner: 'user_implemented' } }),
      { providers },
    );
    assert.equal(r.status, 'PASS', r.errors.join('; '));
  });

  it('pins managed targets to their orchestration pack and platform drain', () => {
    const ok = validateContractReceipt(
      receipt({ deployment: { target: 'livekit_cloud', region: 'us', drain_owner: 'platform_managed' } }),
      { providers },
    );
    assert.equal(ok.status, 'PASS', ok.errors.join('; '));

    const wrongOrchestrator = validateContractReceipt(
      receipt({
        providers: { telephony: 'twilio', orchestration: 'pipecat', realtime: 'gemini-live' },
        deployment: { target: 'livekit_cloud', region: 'us', drain_owner: 'platform_managed' },
      }),
      { providers },
    );
    assert.equal(wrongOrchestrator.status, 'FAIL');
    assert.match(wrongOrchestrator.errors.join('; '), /requires orchestration pack livekit/);

    const wrongDrain = validateContractReceipt(
      receipt({ deployment: { target: 'livekit_cloud', region: 'us', drain_owner: 'user_implemented' } }),
      { providers },
    );
    assert.equal(wrongDrain.status, 'FAIL');
    assert.match(wrongDrain.errors.join('; '), /requires drain_owner platform_managed/);
  });

  it('refuses platform-managed drain claims on self-host targets', () => {
    const r = validateContractReceipt(
      receipt({
        providers: { telephony: 'twilio', orchestration: 'custom-fastapi', realtime: 'gemini-live' },
        deployment: { target: 'k8s', region: 'us', drain_owner: 'platform_managed' },
      }),
      { providers },
    );
    assert.equal(r.status, 'FAIL');
    assert.match(r.errors.join('; '), /requires drain_owner user_implemented/);
  });

  it('rejects non-canonical deployment targets', () => {
    const r = validateContractReceipt(
      receipt({ deployment: { target: 'heroku', region: 'us', drain_owner: 'user_implemented' } }),
      { providers },
    );
    assert.equal(r.status, 'FAIL');
    assert.match(r.errors.join('; '), /canonical menu id/);
  });

  it('fails closed on regulated residency mismatch, advises otherwise', () => {
    const regulated = validateContractReceipt(
      receipt({
        domain: 'medical',
        providers: { telephony: 'exotel', orchestration: 'livekit', realtime: 'gemini-live' },
        policy: {
          jurisdiction: 'IN',
          basis: 'organization_policy',
          retention_basis: 'Clinic policy.',
          recording_consent: 'announce',
          transcript_retention: 'thirty_days',
          human_handoff: 'transfer',
        },
        deployment: { target: 'railway', region: 'eu', drain_owner: 'user_implemented' },
      }),
      { providers },
    );
    assert.equal(regulated.status, 'FAIL');
    assert.match(regulated.errors.join('; '), /regulated residency check failed: exotel\.media_edges/);

    const general = validateContractReceipt(
      receipt({
        providers: { telephony: 'exotel', orchestration: 'livekit', realtime: 'gemini-live' },
        deployment: { target: 'railway', region: 'eu', drain_owner: 'user_implemented' },
      }),
      { providers },
    );
    assert.equal(general.status, 'PASS', general.errors.join('; '));
    assert.match(general.warnings.join('; '), /region advisory: exotel\.media_edges/);
  });

  it('compares receipt deployment against the canonical answers', () => {
    const text = fs.readFileSync(EXAMPLE, 'utf8');
    const report = validateContract(text, { domain: 'medical' });
    const answers = JSON.parse(fs.readFileSync(EXAMPLE_ANSWERS, 'utf8'));
    report.receipt.deployment = {
      target: answers.deployment ?? 'local',
      region: answers.region ?? 'unknown',
      drain_owner: 'user_implemented',
    };
    const ok = validateContractAnswers(report.receipt, answers, loadMenu());
    assert.equal(ok.status, 'PASS', ok.errors.join('; '));
    assert.ok(ok.checks.some((check) => check.id === 'deployment.target' && check.ok));

    answers.deployment = 'fly';
    const mismatch = validateContractAnswers(report.receipt, answers, loadMenu());
    assert.equal(mismatch.status, 'FAIL');
    assert.match(mismatch.errors.join('; '), /deployment\.target mismatch/);
  });
});

