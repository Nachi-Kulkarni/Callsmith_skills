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
  it('SKILL.md routing references only playbooks that exist', () => {
    const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
    const mentioned = [...skill.matchAll(/reference\/([a-z0-9-]+\.md)/g)].map((m) => m[1]);
    assert.ok(mentioned.length >= 8, 'routing table should reference the playbooks');
    for (const f of new Set(mentioned)) {
      assert.ok(fs.existsSync(path.join(ROOT, 'reference', f)), `reference/${f} routed but missing`);
    }
    // C16 resurrection guard: removed loadtest-harness port names stay dead
    const deployDocs = ['deploy.md', 'deploy-capacity.md', 'deploy-workload.md', 'deploy-evidence.md']
      .map((f) => fs.readFileSync(path.join(ROOT, 'reference', f), 'utf8')).join('\n');
    assert.doesNotMatch(
      deployDocs,
      /SocketCluster|ResourceLease|SessionControl|MediaTransport|CallerAgent|SutProbe/,
    );
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

describe('region physics', () => {
  const exotelAnswers = (overrides) => ({
    surface: 'inbound_pstn',
    architecture: 'realtime_s2s',
    telephony: 'exotel',
    orchestration: 'custom_fastapi',
    realtime_model: 'gemini_live',
    vad: 'silero',
    language: 'english',
    barge_in: 'required',
    latency: 'balanced',
    business_logic: 'support',
    tools: 'none',
    deployment: 'cloud_vm',
    ...overrides,
  });
  const writeAnswers = (name, answers) => {
    const file = path.join(ROOT, 'test', name);
    fs.writeFileSync(file, JSON.stringify(answers, null, 2));
    return file;
  };

  it('advises but does not block an unverified region for unregulated traffic', () => {
    const file = writeAnswers('_region-advisory.answers.json', exotelAnswers({ region: 'eu' }));
    try {
      const r = run('check', '--answers', file);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /Advisory \[region_unverified\] Exotel/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('fails closed when regulated collections pins an unverifiable region', () => {
    const file = writeAnswers('_region-blocker.answers.json', exotelAnswers({ region: 'eu', business_logic: 'collections' }));
    try {
      const r = run('check', '--answers', file);
      assert.equal(r.status, 1, r.stderr + r.stdout);
      assert.match(r.stderr + r.stdout, /region_unverified/);
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('does not flag the telephony leg when the region pin is verified', () => {
    const file = writeAnswers('_region-verified.answers.json', exotelAnswers({ region: 'in' }));
    try {
      const r = run('check', '--answers', file);
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.doesNotMatch(r.stdout, /region_unverified\] Exotel/);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
