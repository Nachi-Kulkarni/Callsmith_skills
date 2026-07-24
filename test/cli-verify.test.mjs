import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'callsmith.mjs');

function run(...args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
  });
}

describe('verification CLI', () => {
  it('doctor ok', () => {
    const r = run('doctor');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /status: OK/);
  });

  it('pack validate ok', () => {
    const r = run('pack', 'validate');
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });

  it('packs lists providers', () => {
    const r = run('packs');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /twilio/i);
  });

  it('pack show twilio', () => {
    const r = run('pack', 'show', 'twilio');
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.id, 'twilio');
    assert.ok(j.ingest?.format);
  });

  it('removed generation commands exit 2', () => {
    for (const cmd of ['init', 'forge', 'scaffold', 'simulate', 'intake']) {
      const r = run(cmd);
      assert.equal(r.status, 2, cmd);
      assert.match(r.stderr, /removed/i);
    }
  });

  it('help mentions contract validate and P0 wedge', () => {
    const r = run('--help');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /contract validate/);
    assert.match(r.stdout, /pack inspect|floor receipts|eval gate/i);
  });

  it('labels pack latency sums as unmeasured planning inputs', () => {
    const answers = path.join(ROOT, 'examples', 'clinic-triage', 'voice.answers.json');
    const r = run('check', '--answers', answers);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Latency planning allowance/i);
    assert.match(r.stdout, /unmeasured; not an SLO/i);
    assert.doesNotMatch(r.stdout, /verdict=within target/i);

    const json = run('check', '--answers', answers, '--json');
    assert.equal(json.status, 0, json.stderr + json.stdout);
    const report = JSON.parse(json.stdout);
    assert.equal(report.resolve.latency.evidence_class, 'planning_unmeasured');
    assert.equal(report.resolve.latency.verdict, null);
  });

  it('check prints Operations hosting model and env keys', () => {
    const answers = path.join(ROOT, 'examples', 'clinic-triage', 'voice.answers.json');
    const r = run('check', '--answers', answers);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Operations: /);
    assert.match(r.stdout, /requested: managed_cloud/);
    assert.match(r.stdout, /Env keys/);
  });

  it('check forces self-hosted ownership for a custom bridge claiming managed cloud', () => {
    const answersPath = path.join(ROOT, 'test', '_deploy-ops.answers.json');
    const answers = {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'twilio',
      orchestration: 'custom_fastapi',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'none',
      human_handoff: 'callback',
      recording_consent: 'announce',
      transcript_retention: 'thirty_days',
      hosting_model: 'managed_cloud',
      deployment: 'k8s',
    };
    fs.writeFileSync(answersPath, JSON.stringify(answers, null, 2));
    try {
      const r = run('check', '--answers', answersPath);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /Operations: /);
      assert.match(r.stdout, /Custom FastAPI forces self-hosted/);
      assert.match(r.stdout, /requested: managed_cloud/);
    } finally {
      fs.unlinkSync(answersPath);
    }
  });
});
