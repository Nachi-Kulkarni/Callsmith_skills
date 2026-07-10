/**
 * Machine scorer for one CSB arm (schema v1).
 * LLM judge weight = 0. Public CSB-Δ requires paired BASE+WITH (not computed here alone).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFloorGate } from '../oracles/floors.mjs';
import { scorePhysicsGate } from '../oracles/physics.mjs';
import { scoreRealGate } from '../oracles/real.mjs';
import { scoreContractGate } from '../oracles/contract-gate.mjs';
import { loadMenu, loadProviders } from '../../../src/lib/resolver.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CSB_ROOT = path.resolve(HERE, '..');
export const SCENARIOS_DIR = path.join(CSB_ROOT, 'scenarios');

/**
 * Load a scenario directory (schema v1).
 * @param {string} scenarioId
 * @param {string} [scenariosDir]
 */
export function loadScenario(scenarioId, scenariosDir = SCENARIOS_DIR) {
  const dir = path.join(scenariosDir, scenarioId);
  const readJson = (name) => {
    const p = path.join(dir, name);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  };
  const manifest = readJson('manifest.json');
  if (!manifest || manifest.schema_version !== 1) {
    throw new Error(`scenario ${scenarioId}: missing or invalid manifest.json (need schema_version: 1)`);
  }
  const tags = readJson('tags.json');
  const oracle = readJson('oracle.json');
  if (!tags || tags.schema_version !== 1) throw new Error(`${scenarioId}: tags.json schema_version 1 required`);
  if (!oracle || oracle.schema_version !== 1) throw new Error(`${scenarioId}: oracle.json schema_version 1 required`);

  const briefPath = path.join(dir, 'brief.md');
  const brief = fs.existsSync(briefPath) ? fs.readFileSync(briefPath, 'utf8') : '';
  const poison = readJson('poisoned.answers.json');

  return { id: scenarioId, dir, manifest, tags, oracle, brief, poison };
}

/**
 * Score final artifacts for one arm.
 * @param {object} opts
 * @param {object} opts.scenario - loadScenario() result
 * @param {object} opts.answers - final voice.answers.json
 * @param {string} opts.recipe - callsmith.recipe.md text
 * @param {string} [opts.commandLog] - stdout/stderr for deleted-generator trap
 * @param {'BASE'|'WITH'|string} [opts.arm]
 */
export function scoreArm({ scenario, answers, recipe, commandLog = '', arm = 'WITH' }) {
  const menu = loadMenu();
  const providers = loadProviders();
  const poison = scenario.poison;

  const G_FLOOR = scoreFloorGate(answers || {}, scenario.oracle, poison);
  const G_PHYS = scorePhysicsGate(answers || {}, scenario.oracle, { menu, providers });
  const G_CON = scoreContractGate(recipe || '', answers || {}, {
    ...scenario.oracle,
    contract_domain: scenario.oracle.contract_domain || scenario.manifest.domain,
    menu,
    providers,
  });
  const G_REAL = scoreRealGate({
    answers: answers || {},
    oracle: scenario.oracle,
    tags: scenario.tags,
    manifest: scenario.manifest,
    commandLog,
    menu,
    providers,
  });

  const gates = {
    G_FLOOR: G_FLOOR.pass,
    G_PHYS: G_PHYS.pass,
    G_CON: G_CON.pass,
    G_REAL: G_REAL.pass,
  };
  const gateScore = Object.values(gates).filter(Boolean).length;

  const taskSuccess = G_REAL.pass && Object.values(gates).every(Boolean);

  return {
    schema_version: 1,
    scenario_id: scenario.id,
    arm,
    gates,
    gateScore,
    maxGates: 4,
    task_success: taskSuccess,
    primary_metric_note: 'Task success requires all gates; G_REAL is a hard veto.',
    details: {
      G_FLOOR,
      G_PHYS: {
        pass: G_PHYS.pass,
        checks: G_PHYS.checks,
        errors: G_PHYS.errors,
        transformCount: G_PHYS.transformCount,
      },
      G_CON,
      G_REAL,
    },
    // Explicit: single-arm score is not CSB-Δ
    csb_delta: null,
    note: 'Publish paired task-success-rate lift; gateScore delta is diagnostic only.',
  };
}

/**
 * Paired diagnostic gate delta plus primary task-success outcomes.
 */
export function pairDelta(withResult, baseResult) {
  if (!withResult || !baseResult) {
    throw new Error('pairDelta requires both WITH and BASE scoreArm results');
  }
  return {
    schema_version: 1,
    scenario_id: withResult.scenario_id,
    with_score: withResult.gateScore,
    base_score: baseResult.gateScore,
    delta: withResult.gateScore - baseResult.gateScore,
    task_success: {
      WITH: Boolean(withResult.task_success),
      BASE: Boolean(baseResult.task_success),
      lift: Number(Boolean(withResult.task_success)) - Number(Boolean(baseResult.task_success)),
    },
    gates: {
      WITH: withResult.gates,
      BASE: baseResult.gates,
    },
  };
}

export function listScenarioIds(scenariosDir = SCENARIOS_DIR) {
  if (!fs.existsSync(scenariosDir)) return [];
  return fs
    .readdirSync(scenariosDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => fs.existsSync(path.join(scenariosDir, id, 'manifest.json')));
}
