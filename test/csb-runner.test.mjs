/**
 * Phase 2 runner: prepare workspaces without oracle leak; dry-run + score-fixtures.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScenario } from '../evals/csb/harness/score.mjs';
import { prepareArmWorkspace } from '../evals/csb/harness/prepare.mjs';
import { buildActorPrompt } from '../evals/csb/harness/prompts.mjs';
import {
  seededSchedule,
  snapshotArtifacts,
  summarizeValidPairs,
  taskSuccess,
  validateActorTrial,
} from '../evals/csb/harness/validity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(ROOT, 'evals/csb/harness/run-arms.mjs');

describe('CSB prepareArmWorkspace', () => {
  const scenario = loadScenario('clinic-floor-poison');
  const baseDir = path.join(ROOT, 'evals/csb/runs/_test-prepare-BASE');
  const withDir = path.join(ROOT, 'evals/csb/runs/_test-prepare-WITH');

  it('BASE has brief+seed, no skill/packs/cli, no oracle leak', () => {
    fs.rmSync(baseDir, { recursive: true, force: true });
    prepareArmWorkspace('BASE', scenario, baseDir);
    assert.ok(fs.existsSync(path.join(baseDir, 'brief.md')));
    assert.ok(fs.existsSync(path.join(baseDir, 'voice.answers.json')));
    assert.ok(fs.existsSync(path.join(baseDir, 'OUTPUT_SCHEMA.md')));
    assert.equal(fs.existsSync(path.join(baseDir, 'SKILL.md')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'providers')), false);
    assert.equal(fs.existsSync(path.join(baseDir, '.bin')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'oracle.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'tags.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'manifest.json')), false);
    assert.equal(fs.existsSync(path.join(baseDir, 'poisoned.answers.json')), false);
    const seed = JSON.parse(fs.readFileSync(path.join(baseDir, 'voice.answers.json'), 'utf8'));
    assert.equal(seed.recording_consent, 'none');
  });

  it('WITH has skill+packs+cli shim, still no oracle leak', () => {
    fs.rmSync(withDir, { recursive: true, force: true });
    prepareArmWorkspace('WITH', scenario, withDir);
    assert.ok(fs.existsSync(path.join(withDir, 'SKILL.md')));
    assert.ok(fs.existsSync(path.join(withDir, 'providers')));
    assert.ok(fs.existsSync(path.join(withDir, '.bin', 'callsmith')));
    assert.equal(fs.existsSync(path.join(withDir, 'oracle.json')), false);
    assert.equal(fs.existsSync(path.join(withDir, 'tags.json')), false);
  });

  it('refuses a reused or dirty actor workspace', () => {
    assert.throws(
      () => prepareArmWorkspace('WITH', scenario, withDir),
      /refusing reused actor workspace/,
    );
  });

  it('prompts do not leak rubric point ids or target anchors', () => {
    const withP = buildActorPrompt('WITH', scenario, withDir);
    const baseP = buildActorPrompt('BASE', scenario, baseDir);
    for (const p of [withP, baseP]) {
      assert.doesNotMatch(p, /G_FLOOR|verify_1_|targetAnswers|oracle\.json/i);
      assert.doesNotMatch(p, /mcq_1_|judge-rubric/i);
    }
    assert.match(withP, /SKILL\.md|provider/i);
    assert.match(withP, /Canonical|canonical option ids|whatsapp_voice|Omit/i);
    assert.match(withP, /non-empty/i);
    assert.match(baseP, /do \*\*not\*\* have a Callsmith skill/i);
    // BASE must not receive full Callsmith sealed enum dump (keeps ablation honest)
    assert.doesNotMatch(baseP, /Canonical answers vocabulary|gemini_live|custom_fastapi/i);
  });
});

describe('CSB run-arms CLI', () => {
  it('dry-run prepares both arms and does not publish CSB-Δ', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-dry-run');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [RUNNER, '--dry-run', '--scenario', 'clinic-floor-poison', '--out', out],
      { encoding: 'utf8', cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const trial = path.join(out, 'trial-001', 'clinic-floor-poison');
    assert.ok(fs.existsSync(path.join(trial, 'BASE', 'brief.md')));
    assert.ok(fs.existsSync(path.join(trial, 'WITH', 'SKILL.md')));
    assert.equal(fs.existsSync(path.join(trial, 'WITH', 'oracle.json')), false);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.publishable, false);
    assert.equal(summary.metrics, null);
    const config = JSON.parse(fs.readFileSync(path.join(out, 'config.json'), 'utf8'));
    assert.equal(config.runs, 1);
    assert.ok(config.git.commit);
    assert.ok(config.source.provider_packs_sha256);
    assert.ok(config.source.scenarios['clinic-floor-poison']);
    assert.ok(config.schedule[0].arms.length === 2);
  });

  it('score-fixtures emits demo deltas but marks unpublished', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-fixtures');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(
      process.execPath,
      [RUNNER, '--score-fixtures', '--scenario', 'clinic-floor-poison', '--out', out],
      { encoding: 'utf8', cwd: ROOT },
    );
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const summary = JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'));
    assert.equal(summary.publishable, false);
    assert.equal(summary.metrics, null);
    assert.ok(summary.fixture_demo_deltas?.length >= 1);
    assert.ok(summary.fixture_demo_deltas[0].delta >= 2);
  });

  it('requires an explicit model pin before a live run', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-no-model');
    fs.rmSync(out, { recursive: true, force: true });
    const r = spawnSync(process.execPath, [RUNNER, '--scenario', 'clinic-floor-poison', '--out', out], {
      encoding: 'utf8', cwd: ROOT,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /require --actor-model/i);
    assert.equal(fs.existsSync(out), false);
  });

  it('refuses to overwrite an existing run root', () => {
    const out = path.join(ROOT, 'evals/csb/runs/_test-reused-root');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const r = spawnSync(process.execPath, [RUNNER, '--dry-run', '--scenario', 'clinic-floor-poison', '--out', out], {
      encoding: 'utf8', cwd: ROOT,
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /refusing reused run directory/i);
  });
});

describe('CSB validity and repeated-run statistics', () => {
  it('builds deterministic randomized, counterbalanced schedules', () => {
    const ids = ['a', 'b', 'c'];
    const first = seededSchedule(ids, 4, ['BASE', 'WITH'], 'fixed-seed');
    const second = seededSchedule(ids, 4, ['BASE', 'WITH'], 'fixed-seed');
    assert.deepEqual(first, second);
    assert.equal(first.length, 12);
    assert.ok(first.some((entry) => entry.arms[0] === 'BASE'));
    assert.ok(first.some((entry) => entry.arms[0] === 'WITH'));
    for (const id of ids) {
      const firstArms = first.filter((entry) => entry.scenarioId === id).map((entry) => entry.arms[0]);
      assert.equal(firstArms.filter((arm) => arm === 'BASE').length, 2);
      assert.equal(firstArms.filter((arm) => arm === 'WITH').length, 2);
    }
  });

  it('invalidates failed actors even when artifacts exist', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-invalid-actor');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{}\n');
    fs.writeFileSync(recipe, '# recipe\n');
    const validity = validateActorTrial({
      actor: { status: 1, timedOut: false, error: null },
      artifacts: { answers, recipe },
      before: {},
      startedAtMs: Date.now() - 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /exit status/);
  });

  it('invalidates stale or unchanged artifacts', () => {
    const dir = path.join(ROOT, 'evals/csb/runs/_test-stale-artifacts');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const answers = path.join(dir, 'voice.answers.json');
    const recipe = path.join(dir, 'callsmith.recipe.md');
    fs.writeFileSync(answers, '{}\n');
    fs.writeFileSync(recipe, '# old\n');
    const before = snapshotArtifacts([answers, recipe]);
    const validity = validateActorTrial({
      actor: { status: 0, timedOut: false, error: null },
      artifacts: { answers, recipe },
      before,
      startedAtMs: Date.now() + 1000,
    });
    assert.equal(validity.valid, false);
    assert.match(validity.reasons.join(' '), /stale/);
    assert.match(validity.reasons.join(' '), /untouched/);
  });

  it('uses all-gates task success with G_REAL as a veto', () => {
    assert.equal(taskSuccess(score(true, true, true, true)), true);
    assert.equal(taskSuccess(score(true, true, true, false)), false);
  });

  it('reports paired success lift, variance, diagnostic gate lift, and pass^k', () => {
    const pairs = [
      pair('a', score(true, true, true, true), score(false, true, true, true)),
      pair('a', score(true, true, true, true), score(true, true, true, true)),
      pair('b', score(false, true, true, true), score(false, true, true, true)),
      pair('b', score(true, true, true, true), score(false, true, true, true)),
    ];
    const summary = summarizeValidPairs(pairs, { runs: 2 });
    assert.equal(summary.n_valid_pairs, 4);
    assert.equal(summary.task_success.WITH, 0.75);
    assert.equal(summary.task_success.BASE, 0.25);
    assert.equal(summary.task_success.lift, 0.5);
    assert.ok(summary.task_success.lift_95ci.low < summary.task_success.lift_95ci.high);
    assert.equal(summary.pass_power_k.k, 2);
    assert.equal(summary.pass_power_k.rate, 0.5);
    assert.equal(summary.diagnostic_gate_lift.G_FLOOR, 0.5);
  });
});

function score(floor, physics, contract, real) {
  const gates = { G_FLOOR: floor, G_PHYS: physics, G_CON: contract, G_REAL: real };
  return { gates, gateScore: Object.values(gates).filter(Boolean).length };
}

function pair(scenarioId, WITH, BASE) {
  return { scenarioId, WITH, BASE };
}
