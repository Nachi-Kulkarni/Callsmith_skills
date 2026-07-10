/**
 * Structure gates from product_decisions.md:
 * skill floors + G5 language present; no-synthesis; physics check smoke.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadProviders,
  loadMenu,
  expandAnswers,
  detectImpossibilities,
  resolve,
  validateProviderId,
} from '../src/lib/resolver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(ROOT, 'bin', 'callsmith.mjs');

function run(...args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    cwd: ROOT,
  });
}

describe('skill / constitution structure', () => {
  it('SKILL.md encodes floors + G5 + canonical vocabulary', () => {
    const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
    assert.match(skill, /Hard floors/i);
    assert.match(skill, /recording_consent|consent/i);
    assert.match(skill, /handoff/i);
    assert.match(skill, /Handoff contract/i);
    assert.match(skill, /Audio path/i);
    assert.match(skill, /product_decisions\.md/);
    assert.match(skill, /pack physics inspect|floor receipts|contract validate|eval gate/i);
    assert.match(skill, /Canonical answers vocabulary/i);
    assert.match(skill, /reference\/policy\.md/);
    const policy = fs.readFileSync(path.join(ROOT, 'reference', 'policy.md'), 'utf8');
    assert.match(policy, /whatsapp_voice/);
    assert.match(policy, /warm_transfer|warm transfer/);
    assert.match(policy, /Omit provider legs|Omit.*provider/i);
    // May name removed commands only to forbid them
    assert.match(skill, /Removed \(do not call\).*forge.*scaffold.*intake/is);
  });

  it('product_decisions.md is sole canon with P0 wedge', () => {
    const pd = fs.readFileSync(path.join(ROOT, 'product_decisions.md'), 'utf8');
    assert.match(pd, /Sole constitutional source of truth/i);
    assert.match(pd, /pack physics inspect \+ floor receipts \+ contract validate \+ eval gate/);
    assert.match(pd, /The agent compiles/);
  });
});

describe('no synthesis', () => {
  it('rejects provider IDs that could escape paths, logs, or generated text', () => {
    for (const id of ['exotel', 'acme-telephony', 'acme_nonexistent', 'A1-2_3']) {
      assert.equal(validateProviderId(id), id);
    }
    for (const id of ['../../tmp/pwned', 'a/b', 'a b', 'a\nb', 'a\x1b[2Jb', '"; import os', '', 'a'.repeat(65)]) {
      assert.throws(() => validateProviderId(id), `expected rejection for ${JSON.stringify(id)}`);
    }
  });

  it('check rejects unknown provider pack (does not invent)', () => {
    const answersPath = path.join(ROOT, 'test', '_unknown-provider.answers.json');
    // Use a free-text provider id on telephony kind-bearing group
    const answers = {
      surface: 'inbound_pstn',
      architecture: 'realtime_s2s',
      telephony: 'acme-fake-carrier',
      orchestration: 'livekit',
      realtime_model: 'gemini_live',
      vad: 'silero',
      language: 'english',
      barge_in: 'required',
      latency: 'balanced',
      business_logic: 'support',
      tools: 'none',
      deployment: 'local',
    };
    fs.writeFileSync(answersPath, JSON.stringify(answers, null, 2));
    try {
      const r = run('check', '--answers', answersPath);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr + r.stdout, /unknown provider|synthesis|add a pack/i);
    } finally {
      fs.unlinkSync(answersPath);
    }
  });
});

describe('physics inspect', () => {
  it('livekit + twilio + gemini-live is possible with few/no transforms', () => {
    const answers = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'examples', 'clinic-triage', 'voice.answers.json'), 'utf8'),
    );
    const menu = loadMenu();
    const expanded = expandAnswers(answers, menu, { strict: true });
    const providers = loadProviders();
    const impossible = detectImpossibilities(expanded, providers);
    assert.equal(impossible.length, 0, JSON.stringify(impossible));
    const r = resolve(expanded, providers);
    assert.ok(r.pipeline?.length || r.transforms !== undefined);
  });

  it('CLI check on example answers exits 0', () => {
    const answers = path.join(ROOT, 'examples', 'clinic-triage', 'voice.answers.json');
    const r = run('check', '--answers', answers);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  });
});
