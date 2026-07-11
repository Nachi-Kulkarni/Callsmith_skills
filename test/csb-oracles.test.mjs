/**
 * CallsmithBench Phase 1 — machine oracles + fixtures (CI hard gate).
 * Does NOT publish CSB-Δ; only proves gates are causal and deterministic.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadScenario,
  listScenarioIds,
  scoreArm,
  pairDelta,
  SCENARIOS_DIR,
} from '../evals/csb/harness/score.mjs';
import { DETERMINISTIC_TRAPS } from '../evals/csb/oracles/real.mjs';
import { scoreContractGate } from '../evals/csb/oracles/contract-gate.mjs';
import { loadMenu } from '../src/lib/resolver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readFixture(scenarioDir, name) {
  return fs.readFileSync(path.join(scenarioDir, 'fixtures', name), 'utf8');
}
function readFixtureJson(scenarioDir, name) {
  return JSON.parse(readFixture(scenarioDir, name));
}

describe('CSB schema v1 scenarios', () => {
  it('lists scenarios with valid manifests', () => {
    const ids = listScenarioIds();
    assert.ok(ids.includes('clinic-floor-poison'));
    assert.ok(ids.includes('exotel-custom-transform-trap'));
    for (const id of ids) {
      const s = loadScenario(id);
      assert.equal(s.manifest.schema_version, 1);
      assert.equal(s.tags.schema_version, 1);
      assert.equal(s.oracle.schema_version, 1);
      assert.ok(s.brief.length > 20);
      assert.equal(s.tags.domain, s.manifest.domain, `${id}: manifest/tags domain drift`);
      const regulated = new Set(['medical', 'banking', 'collections', 'legal', 'insurance']);
      assert.equal(s.tags.regulated, regulated.has(s.manifest.domain), `${id}: regulated tag drift`);
      if (regulated.has(s.manifest.domain)) {
        assert.equal(s.oracle.contract_domain, s.manifest.domain, `${id}: contract domain drift`);
      }
      if (/\bclinic\b|\bpatient\b|medical\s+triage/i.test(s.brief)) {
        assert.equal(s.manifest.domain, 'medical', `${id}: clinical brief mislabeled as ${s.manifest.domain}`);
      }
    }
  });

  it('G_REAL traps are a fixed deterministic set', () => {
    for (const t of [
      'no_pstn_to_web',
      'no_ticket_on_urgent',
      'no_synthesis',
      'no_deleted_generators',
      'no_consent_none_regulated',
    ]) {
      assert.ok(DETERMINISTIC_TRAPS.includes(t), t);
    }
  });
});

describe('clinic-floor-poison gates', () => {
  const scenario = loadScenario('clinic-floor-poison');

  it('WITH gold fixtures pass all 4 gates', () => {
    const answers = readFixtureJson(scenario.dir, 'with-pass.answers.json');
    const recipe = readFixture(scenario.dir, 'with-pass.recipe.md');
    const r = scoreArm({ scenario, answers, recipe, arm: 'WITH' });
    assert.equal(r.gateScore, 4, JSON.stringify(r.details, null, 2));
    assert.equal(r.csb_delta, null);
  });

  it('BASE-style fail fixture scores 0 (not sabotaged — genuinely bad design)', () => {
    const answers = readFixtureJson(scenario.dir, 'base-fail.answers.json');
    const recipe = readFixture(scenario.dir, 'keyword-theater.recipe.md');
    const r = scoreArm({ scenario, answers, recipe, arm: 'BASE' });
    assert.equal(r.gates.G_FLOOR, false);
    assert.equal(r.gates.G_PHYS, false);
    assert.equal(r.gates.G_REAL, false);
    assert.ok(r.gateScore <= 1);
  });

  it('poison seed fails G_FLOOR (F2P starting point)', () => {
    const r = scoreArm({
      scenario,
      answers: scenario.poison,
      recipe: readFixture(scenario.dir, 'keyword-theater.recipe.md'),
      arm: 'WITH',
    });
    assert.equal(r.gates.G_FLOOR, false);
    assert.ok(r.details.G_FLOOR.errors.some((e) => /consent|handoff|retention/i.test(e)));
  });

  it('keyword theater: good headings + bad answers fail G_CON', () => {
    const answers = { ...scenario.poison };
    const recipe = readFixture(scenario.dir, 'keyword-theater.recipe.md');
    const g = scoreContractGate(recipe, answers, {
      ...scenario.oracle,
      contract_domain: 'medical',
    });
    assert.equal(g.pass, false);
    assert.ok(
      g.errors.some((e) => /answers consent|keyword theater|handoff/i.test(e)),
      g.errors.join('; '),
    );
  });

  it('deleted generator in command log fails G_REAL', () => {
    const answers = readFixtureJson(scenario.dir, 'with-pass.answers.json');
    const recipe = readFixture(scenario.dir, 'with-pass.recipe.md');
    const r = scoreArm({
      scenario,
      answers,
      recipe,
      commandLog: 'callsmith forge --answers x.json\n',
      arm: 'WITH',
    });
    assert.equal(r.gates.G_REAL, false);
    assert.ok(r.details.G_REAL.errors.some((e) => /deleted generator/i.test(e)));
  });

  it('unknown provider fails G_REAL no_synthesis / G_PHYS', () => {
    const answers = {
      ...readFixtureJson(scenario.dir, 'with-pass.answers.json'),
      telephony: 'acme-fake-carrier',
    };
    const recipe = readFixture(scenario.dir, 'with-pass.recipe.md');
    const r = scoreArm({ scenario, answers, recipe, arm: 'WITH' });
    assert.equal(r.gates.G_PHYS, false);
    assert.equal(r.gates.G_REAL, false);
  });

  it('paired fixture delta is positive (illustration only — not published CSB-Δ)', () => {
    const withR = scoreArm({
      scenario,
      answers: readFixtureJson(scenario.dir, 'with-pass.answers.json'),
      recipe: readFixture(scenario.dir, 'with-pass.recipe.md'),
      arm: 'WITH',
    });
    const baseR = scoreArm({
      scenario,
      answers: readFixtureJson(scenario.dir, 'base-fail.answers.json'),
      recipe: readFixture(scenario.dir, 'keyword-theater.recipe.md'),
      arm: 'BASE',
    });
    const pair = pairDelta(withR, baseR);
    assert.ok(pair.delta >= 2, `expected material lift, got ${pair.delta}`);
    assert.equal(pair.scenario_id, 'clinic-floor-poison');
  });
});

describe('exotel-custom-transform-trap', () => {
  const scenario = loadScenario('exotel-custom-transform-trap');

  it('honest heavy stack passes G_PHYS with transform_band heavy', () => {
    const answers = readFixtureJson(scenario.dir, 'honest-heavy.answers.json');
    const recipe = readFixture(scenario.dir, 'honest-heavy.recipe.md');
    const r = scoreArm({ scenario, answers, recipe, arm: 'WITH' });
    assert.equal(r.gates.G_PHYS, true, r.details.G_PHYS.errors.join('; '));
    assert.ok(r.details.G_PHYS.transformCount >= 3);
    assert.equal(r.gateScore, 4, JSON.stringify(r.gates));
  });

  it('livekit rewrite would fail heavy band (different honesty path)', () => {
    const answers = {
      ...readFixtureJson(scenario.dir, 'honest-heavy.answers.json'),
      orchestration: 'livekit',
    };
    const recipe = readFixture(scenario.dir, 'honest-heavy.recipe.md');
    const r = scoreArm({ scenario, answers, recipe, arm: 'WITH' });
    // LiveKit → 0 transforms → fails heavy band (scenario locks custom honesty)
    assert.equal(r.gates.G_PHYS, false);
  });
});

describe('examples golden still contract-valid', () => {
  it('examples/clinic-triage recipe + answers align for medical', () => {
    const answers = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'examples/clinic-triage/voice.answers.json'), 'utf8'),
    );
    const recipe = fs.readFileSync(
      path.join(ROOT, 'examples/clinic-triage/callsmith.recipe.md'),
      'utf8',
    );
    // Use clinic oracle sealed floors as cross-check shape
    const g = scoreContractGate(recipe, {
      ...answers,
      // example may lack language multilingual — only consent/retention/handoff
    }, {
      schema_version: 1,
      contract_domain: 'medical',
      sealed: {
        recording_consent: { min: 'announce' },
        transcript_retention: { min: 'thirty_days' },
        human_handoff: { one_of: ['transfer'] },
      },
    });
    assert.equal(g.pass, true, g.errors.join('; '));
  });

  it('contract receipt provider choices must match normalized answers', () => {
    const answers = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'examples/clinic-triage/voice.answers.json'), 'utf8'),
    );
    const recipe = fs.readFileSync(
      path.join(ROOT, 'examples/clinic-triage/callsmith.recipe.md'),
      'utf8',
    ).replace('"telephony": "twilio"', '"telephony": "exotel"');
    const result = scoreContractGate(recipe, answers, { contract_domain: 'medical', menu: loadMenu() });
    assert.equal(result.pass, false);
    assert.match(result.errors.join('; '), /receipt telephony:exotel != answers twilio/);
  });
});
