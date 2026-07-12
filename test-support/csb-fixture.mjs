import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildActorPrompt } from '../evals/csb/harness/prompts.mjs';
import { outputSchemaText } from '../evals/csb/harness/prepare.mjs';
import { listScenarioIds, loadScenario, pairDelta, scoreArm } from '../evals/csb/harness/score.mjs';
import { seededSchedule, summarizeValidPairs, taskSuccess } from '../evals/csb/harness/validity.mjs';

const HASH = 'a'.repeat(64);
const COMMIT = 'b'.repeat(40);

// Per-tool actor presets. Both codex and grok carry the same reviewed 7-key
// fail-closed isolation boundary; only the binary/version/model defaults differ.
const ACTOR_PRESETS = {
  codex: {
    binary: 'codex',
    version: 'codex-cli 0.144.1',
    model: 'gpt-5.6-luna',
    family: 'luna',
    reasoning: 'xhigh',
  },
  grok: {
    binary: 'grok',
    version: 'grok 0.2.93 (f00f96316d4b) [stable]',
    model: 'grok-4.5',
    family: 'grok',
    reasoning: 'high',
  },
};

export function createRawPublishableRun(root, name, {
  tool = 'codex',
  model,
  family,
  weak = false,
} = {}) {
  const preset = ACTOR_PRESETS[tool] || ACTOR_PRESETS.codex;
  const run = path.join(root, name);
  fs.mkdirSync(run, { recursive: true });
  const scenarios = listScenarioIds().sort();
  const runs = 3;
  const seed = 'fixed-publication-seed';
  const schedule = seededSchedule(scenarios, runs, ['BASE', 'WITH'], seed);
  const budget = { timeout_ms_per_arm: 600000, max_captured_output_bytes_per_stream: 20 * 1024 * 1024 };
  const source = {
    provider_packs_sha256: HASH,
    harness_sha256: HASH,
    scorer_sha256: HASH,
    product_sha256: HASH,
    scenarios: Object.fromEntries(scenarios.map((id) => [id, HASH])),
  };
  const actor = {
    tool,
    binary: preset.binary,
    binary_sha256: HASH,
    version: preset.version,
    model: model || preset.model,
    family: family || preset.family,
    reasoning: preset.reasoning,
    isolation: {
      ephemeral_session: true,
      ignore_user_config: true,
      ignore_user_rules: true,
      auth_only_home: true,
      plugins_disabled: true,
      hooks_disabled: true,
      memories_disabled: true,
    },
  };
  const config = {
    schema_version: 2,
    run_id: name,
    mode: 'live',
    actor,
    git: { commit: COMMIT, dirty: false },
    seed,
    runs,
    scenarios,
    arms: ['BASE', 'WITH'],
    budget,
    source,
    schedule,
  };
  fs.writeFileSync(path.join(run, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  fs.writeFileSync(path.join(run, 'report.md'), '# Raw report replaced during publication\n');

  const total = runs * scenarios.length;
  const pairs = [];
  let index = 0;
  for (const item of schedule) {
    const scenario = loadScenario(item.scenarioId);
    const pairRoot = path.join(run, `trial-${String(item.trial).padStart(3, '0')}`, item.scenarioId);
    const withAnswers = readFixtureJson(scenario, ['with-pass.answers.json', 'honest-heavy.answers.json']);
    const withRecipe = readFixtureText(scenario, ['with-pass.recipe.md', 'honest-heavy.recipe.md']);
    const baseAnswers = weak
      ? withAnswers
      : readFixtureJson(scenario, ['base-fail.answers.json']) || scenario.poison;
    const baseRecipe = weak
      ? withRecipe
      : readFixtureText(scenario, ['keyword-theater.recipe.md']) || '# Invalid fixture baseline\n';
    const scores = {
      WITH: scoreArm({ scenario, answers: withAnswers, recipe: withRecipe, arm: 'WITH' }),
      BASE: scoreArm({ scenario, answers: baseAnswers, recipe: baseRecipe, arm: 'BASE' }),
    };
    for (const arm of ['BASE', 'WITH']) {
      const armRoot = path.join(pairRoot, arm);
      fs.mkdirSync(armRoot, { recursive: true });
      const common = {
        'brief.md': scenario.brief + (scenario.brief.endsWith('\n') ? '' : '\n'),
        'scenario.json': `${JSON.stringify({ id: item.scenarioId, brief: scenario.brief }, null, 2)}\n`,
        'OUTPUT_SCHEMA.md': outputSchemaText(),
        'input-seed.answers.json': `${JSON.stringify(scenario.poison || {}, null, 2)}\n`,
      };
      for (const [file, content] of Object.entries(common)) fs.writeFileSync(path.join(armRoot, file), content);
      const prompt = buildActorPrompt(arm, scenario, armRoot);
      fs.writeFileSync(path.join(armRoot, 'actor-prompt.md'), prompt);
      fs.writeFileSync(path.join(armRoot, 'voice.answers.json'), `${JSON.stringify(arm === 'WITH' ? withAnswers : baseAnswers, null, 2)}\n`);
      fs.writeFileSync(path.join(armRoot, 'callsmith.recipe.md'), arm === 'WITH' ? withRecipe : baseRecipe);
      fs.writeFileSync(path.join(armRoot, 'score.json'), `${JSON.stringify(scores[arm], null, 2)}\n`);
      const traceEvents = tool === 'grok'
        ? [
          { type: 'thought', data: 'working' },
          { type: 'text', data: 'private final response' },
          { type: 'end', stopReason: 'EndTurn', sessionId: `${name}-${item.trial}-${item.scenarioId}-${arm}` },
        ]
        : [
          { type: 'thread.started', thread_id: `${name}-${item.trial}-${item.scenarioId}-${arm}` },
          { type: 'item.completed', item: { type: 'agent_message', text: 'private final response' } },
          { type: 'turn.completed' },
        ];
      fs.writeFileSync(path.join(armRoot, 'actor.events.jsonl'), `${traceEvents.map(JSON.stringify).join('\n')}\n`);
      fs.writeFileSync(path.join(armRoot, 'actor.stderr.txt'), '');
      fs.writeFileSync(path.join(armRoot, 'actor.status.json'), `${JSON.stringify({
        status: 0,
        duration_ms: 1000 + index,
        valid: true,
        invalid_reasons: [],
        session_trace: { valid: true, file: 'actor.events.jsonl', sanitized: false },
      }, null, 2)}\n`);
      fs.writeFileSync(path.join(armRoot, 'reproducibility.json'), `${JSON.stringify({
        prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
        scenario_sha256: source.scenarios[item.scenarioId],
        provider_packs_sha256: source.provider_packs_sha256,
        harness_sha256: source.harness_sha256,
        scorer_sha256: source.scorer_sha256,
        product_sha256: source.product_sha256,
        model: actor.model,
        model_family: actor.family,
        actor_tool: actor.tool,
        actor_reasoning: actor.reasoning,
        tool_version: actor.version,
        actor_binary_sha256: actor.binary_sha256,
        git_commit: COMMIT,
        seed,
        arm,
        budget,
      }, null, 2)}\n`);
    }
    const pairReceipt = {
      ...pairDelta(scores.WITH, scores.BASE),
      trial: item.trial,
      valid: true,
      task_success: { WITH: taskSuccess(scores.WITH), BASE: taskSuccess(scores.BASE) },
    };
    fs.writeFileSync(path.join(pairRoot, 'pair.json'), `${JSON.stringify(pairReceipt, null, 2)}\n`);
    pairs.push({ trial: item.trial, scenarioId: item.scenarioId, armOrder: item.arms, ...scores });
    index += 1;
  }
  const regulatedScenarioIds = scenarios.filter((id) => ['medical', 'banking', 'collections']
    .includes(loadScenario(id).manifest.domain));
  const metrics = summarizeValidPairs(pairs, { runs, regulatedScenarioIds });
  const summary = {
    schema_version: 2,
    run_id: name,
    run_valid: true,
    publishable: true,
    invalid_arms: [],
    n_scheduled_pairs: total,
    n_valid_pairs: total,
    metrics,
    trials: pairs.map((pair) => ({
      trial: pair.trial,
      scenario: pair.scenarioId,
      paired: true,
      task_success: { WITH: taskSuccess(pair.WITH), BASE: taskSuccess(pair.BASE) },
    })),
  };
  fs.writeFileSync(path.join(run, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return run;
}

export function writeManifest(root) {
  const files = walk(root).filter((file) => path.basename(file) !== 'MANIFEST.sha256').sort();
  const rows = files.map((file) => {
    const hash = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    return `${hash}  ${path.relative(root, file)}`;
  });
  fs.writeFileSync(path.join(root, 'MANIFEST.sha256'), `${rows.join('\n')}\n`);
}

function readFixtureJson(scenario, names) {
  const value = readFixtureText(scenario, names);
  return value ? JSON.parse(value) : null;
}

function readFixtureText(scenario, names) {
  for (const name of names) {
    const file = path.join(scenario.dir, 'fixtures', name);
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return null;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
