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
  return [
    '# Required outputs',
    '',
    'Write these files in the workspace root (both **required**, non-empty):',
    '',
    '## 1. `voice.answers.json`',
    '',
    'JSON object of stack/policy choices. Prefer short **string enum tokens**, not free-form sentences.',
    '',
    'Common keys (include those that apply; **omit** unused provider keys — do not use the string `"none"` as a provider id):',
    '',
    '- `surface`, `architecture`, `language`, `barge_in`',
    '- `telephony`, `orchestration`, `realtime_model`, `stt`, `llm`, `tts`, `vad` (only if that leg exists)',
    '- `recording_consent`, `transcript_retention`, `human_handoff`, `tools`, `business_logic`, `latency`, `deployment`',
    '',
    'If Callsmith `SKILL.md` is present, use its **Canonical answers vocabulary** exactly.',
    '',
    '## 2. `callsmith.recipe.md`',
    '',
    'Short markdown handoff contract. Start with a fenced `json callsmith-contract` receipt following `reference/contract.md` when that file is available. The receipt policy must match `voice.answers.json`. Then include headings/content for:',
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

  writeFileSync(
    join(runDir, 'README.md'),
    [
      `# CSB arm ${arm} — ${scenario.id}`,
      '',
      arm === 'BASE'
        ? 'BASE arm: design from the brief only. No Callsmith skill, packs, or CLI in this workspace.'
        : 'WITH arm: Callsmith skill + packs + verification CLI available.',
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
