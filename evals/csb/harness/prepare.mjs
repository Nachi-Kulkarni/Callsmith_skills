/**
 * Workspace preparation for CSB arms.
 * Guardrails: no oracle/tags leak to actor; BASE has no skill/packs/CLI.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(HERE, '../../..');

export function outputSchemaText() {
  // The answers interface IS the menu. Generated, never hand-maintained —
  // a hand-copied table drifted from menu.json once and invalidated a suite.
  const menu = JSON.parse(readFileSync(join(REPO_ROOT, 'data/menu.json'), 'utf8'));
  const rows = menu.groups
    .map((g) => `| \`${g.id}\` | ${g.options.map((o) => `\`${o.id}\``).join(', ')} |`)
    .join('\n');
  return [
    '# Required outputs',
    '',
    'Write these files in the workspace root (both **required**, non-empty):',
    '',
    '## 1. `voice.answers.json`',
    '',
    'JSON object of design choices using exactly these string enum tokens (the full',
    'answer interface). Values outside these lists do not resolve. Include the keys',
    'that apply; **omit** unused provider keys (never use the string `"none"` as a',
    'provider id).',
    '',
    '| Field | Allowed values |',
    '|---|---|',
    rows,
    '',
    '## 2. `callsmith.recipe.md`',
    '',
    'Short markdown handoff contract. Start with a fenced `json callsmith-contract` receipt.',
    'This exact example passes the contract validator — copy it and edit the values',
    '(every field below is required):',
    '',
    '```json callsmith-contract',
    '{',
    '  "schema_version": 1,',
    '  "domain": "general",',
    '  "surface": "inbound_pstn",',
    '  "providers": { "telephony": "twilio", "orchestration": "livekit", "vad": "silero" },',
    '  "policy": {',
    '    "basis": "callsmith_default",',
    '    "recording_consent": "announce",',
    '    "transcript_retention": "thirty_days",',
    '    "human_handoff": "transfer",',
    '    "retention_basis": "QA window; auto-purged after 30 days",',
    '    "jurisdiction": "none"',
    '  },',
    '  "latency_slo": { "metric": "turn_gap_ms", "percentile": 95, "target_ms": 900 }',
    '}',
    '```',
    '',
    'Rules: `providers` values are flat lowercase pack-id strings, one per role',
    '(`telephony`, `orchestration`, `realtime`, `stt`, `llm`, `tts`, `vad`). The receipt',
    '`surface` and policy floors must match `voice.answers.json`. `percentile` must be',
    '50, 95, or 99. Regulated domains (`medical`, `banking`, `collections`, `legal`,',
    '`insurance`) additionally require a real `jurisdiction` and floor-minimum choices.',
    '',
    'Then include headings/content for:',
    '',
    '1. Intent / use case',
    '2. Stack (providers + why)',
    '3. Audio path',
    '4. Interruption / barge-in',
    '5. Floors (consent, retention, handoff, tools) — consistent with answers',
    '6. Latency/cost note, with a percentile `turn_gap_ms` target in the receipt',
    '7. Build / implement notes',
    '',
    'Empty recipe files are invalid.',
    '',
    'Do not invent other required deliverables.',
    '',
  ].join('\n');
}

/**
 * @param {'BASE'|'WITH'} arm
 * @param {{ id: string, brief: string, poison?: object|null }} scenario
 * @param {string} runDir
 */
export function prepareArmWorkspace(arm, scenario, runDir) {
  if (existsSync(runDir)) {
    throw new Error(`refusing reused actor workspace: ${runDir}`);
  }
  mkdirSync(runDir, { recursive: true });

  // Public only — never copy oracle.json, tags.json, manifest.json, poisoned labels.
  writeFileSync(join(runDir, 'brief.md'), scenario.brief + (scenario.brief.endsWith('\n') ? '' : '\n'));
  writeFileSync(
    join(runDir, 'scenario.json'),
    JSON.stringify({ id: scenario.id, brief: scenario.brief }, null, 2) + '\n',
  );

  // Deterministic seed (same for BASE and WITH). Content only — not marked as "poison".
  writeFileSync(
    join(runDir, 'voice.answers.json'),
    JSON.stringify(scenario.poison || {}, null, 2) + '\n',
  );

  writeFileSync(
    join(runDir, 'OUTPUT_SCHEMA.md'),
    outputSchemaText(),
  );

  // Neutral README — must not disclose which arm this workspace is.
  writeFileSync(
    join(runDir, 'README.md'),
    [
      `# CSB workspace — ${scenario.id}`,
      '',
      'Design task workspace. Required deliverables are specified in `OUTPUT_SCHEMA.md`.',
      '',
      'Write only inside this directory.',
      '',
    ].join('\n'),
  );

  if (arm === 'WITH') {
    cpSync(join(REPO_ROOT, 'SKILL.md'), join(runDir, 'SKILL.md'));
    // Hidden self-contained runtime: executable, but absent from normal agent discovery.
    const runtimeDir = join(runDir, '.callsmith-runtime');
    mkdirSync(runtimeDir, { recursive: true });
    for (const name of ['bin', 'src', 'data', 'providers', 'reference']) {
      cpSync(join(REPO_ROOT, name), join(runtimeDir, name), { recursive: true });
    }
    cpSync(join(REPO_ROOT, 'package.json'), join(runtimeDir, 'package.json'));
    cpSync(join(REPO_ROOT, 'SKILL.md'), join(runtimeDir, 'SKILL.md'));
    const binDir = join(runDir, '.bin');
    mkdirSync(binDir, { recursive: true });
    const shim = join(binDir, 'callsmith');
    writeFileSync(
      shim,
      [
        '#!/bin/sh',
        'exec node "$(dirname "$0")/../.callsmith-runtime/bin/callsmith.mjs" "$@"',
        '',
      ].join('\n'),
    );
    chmodSync(shim, 0o755);

    // Symlink-free packs are shared by the CLI and agents that prefer reading files.
    cpSync(join(REPO_ROOT, 'providers'), join(runDir, 'providers'), { recursive: true });
    // reference playbooks available but unscored
    if (existsSync(join(REPO_ROOT, 'reference'))) {
      cpSync(join(REPO_ROOT, 'reference'), join(runDir, 'reference'), { recursive: true });
    }
  }

  // Prove no leak: refuse if oracle somehow present
  for (const banned of ['oracle.json', 'tags.json', 'manifest.json', 'poisoned.answers.json']) {
    if (existsSync(join(runDir, banned))) {
      throw new Error(`oracle leak: ${banned} must not appear in actor workspace`);
    }
  }

  return runDir;
}

export function readArmArtifacts(runDir) {
  const answersPath = join(runDir, 'voice.answers.json');
  const recipePath = join(runDir, 'callsmith.recipe.md');
  let answers = null;
  let recipe = '';
  if (existsSync(answersPath)) {
    try {
      answers = JSON.parse(readFileSync(answersPath, 'utf8'));
    } catch {
      answers = null;
    }
  }
  if (existsSync(recipePath)) {
    recipe = readFileSync(recipePath, 'utf8');
  }
  return { answers, recipe, answersPath, recipePath };
}
