import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildEvidenceBundle,
  sanitizeJsonValue,
  sanitizeTrace,
} from '../evals/csb/scripts/build-evidence.mjs';
import { listScenarioIds } from '../evals/csb/harness/score.mjs';
import { createRawPublishableRun } from '../test-support/csb-fixture.mjs';

describe('CSB evidence publication', () => {
  it('keeps committed diagnostic excerpts content-addressed', () => {
    const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'evidence/diagnostics');
    const manifest = fs.readFileSync(path.join(root, 'MANIFEST.sha256'), 'utf8').trim().split('\n');
    for (const row of manifest) {
      const match = row.match(/^([a-f0-9]{64})  (.+)$/);
      assert.ok(match, `invalid manifest row: ${row}`);
      const [, expected, file] = match;
      const actual = createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
      assert.equal(actual, expected, `${file} hash drifted`);
    }
  });

  it('redacts paths, trace ids, credentials, emails, and command output', () => {
    const trace = [
      { type: 'thread.started', thread_id: 'private-thread' },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: '/bin/sh -lc "sed /Users/alice/.codex/auth.json"',
          aggregated_output: 'Bearer secret-value alice@example.com',
          exit_code: 0,
        },
      },
    ].map(JSON.stringify).join('\n');
    const clean = sanitizeTrace(trace);
    assert.doesNotMatch(clean, /private-thread|Users\/alice|secret-value|alice@example/);
    assert.doesNotMatch(clean, /aggregated_output|"command":|\/bin\/sh/);
    assert.match(clean, /REDACTED_TRACE_ID/);
  });

  it('fails closed on malformed JSONL', () => {
    assert.throws(() => sanitizeTrace('{bad'), /refusing partial publication/);
  });

  it('redacts secret-valued JSON fields without removing benchmark hashes', () => {
    const clean = sanitizeJsonValue({ access_token: 'private', prompt_sha256: 'public-hash' });
    assert.equal(clean.access_token, '[REDACTED]');
    assert.equal(clean.prompt_sha256, 'public-hash');
  });

  it('builds an allowlisted bundle with a complete checksum manifest', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-evidence-test-'));
    const source = createRawPublishableRun(temp, 'raw-run');
    const out = path.join(temp, 'published');
    try {
      fs.writeFileSync(path.join(source, 'do-not-copy.txt'), 'private\n');

      const result = buildEvidenceBundle({ source, out, provenanceVerifier: testProvenance });
      assert.ok(result.files.includes('MANIFEST.sha256'));
      assert.ok(result.files.includes('REDACTION.md'));
      assert.ok(result.files.includes('REPRODUCE.md'));
      assert.ok(result.files.includes('case-studies/README.md'));
      // 3 trials per scenario in the current suite (core10 or superset).
      assert.equal(result.files.filter((file) => file.startsWith('case-studies/trial-')).length, 3 * listScenarioIds().length);
      assert.ok(result.files.includes('trial-001/bank-kyc/BASE/actor.events.sanitized.jsonl'));
      assert.equal(fs.existsSync(path.join(out, 'do-not-copy.txt')), false);
      assert.equal(result.files.some((file) => file.endsWith('actor.events.jsonl')), false);
      assert.equal(result.files.some((file) => file.includes('stdout') || file.includes('stderr')), false);
      assert.doesNotMatch(fs.readFileSync(path.join(out, 'config.json'), 'utf8'), /Users\//);
      assert.match(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'), /"sanitized": true/);
      assert.match(fs.readFileSync(path.join(out, 'REPRODUCE.md'), 'utf8'), /git checkout b{40}/);
      assert.match(fs.readFileSync(path.join(out, 'case-studies/trial-001-bank-kyc.md'), 'utf8'), /BASE \*\*fail\*\* · WITH \*\*pass\*\*/);
      const manifest = fs.readFileSync(path.join(out, 'MANIFEST.sha256'), 'utf8');
      for (const file of result.files.filter((file) => file !== 'MANIFEST.sha256')) {
        assert.match(manifest, new RegExp(`  ${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
      }
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('refuses to turn a diagnostic run into public evidence', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-evidence-refuse-'));
    const source = createRawPublishableRun(temp, 'raw-run');
    try {
      const summary = JSON.parse(fs.readFileSync(path.join(source, 'summary.json'), 'utf8'));
      summary.publishable = false;
      fs.writeFileSync(path.join(source, 'summary.json'), `${JSON.stringify(summary)}\n`);
      assert.throws(
        () => buildEvidenceBundle({ source, out: path.join(temp, 'published'), provenanceVerifier: testProvenance }),
        /not publication-eligible/,
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('rejects allowlisted receipts that are symlinks', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-evidence-symlink-'));
    try {
      const source = createRawPublishableRun(temp, 'raw-run');
      const recipe = path.join(source, 'trial-001', 'bank-kyc', 'BASE', 'callsmith.recipe.md');
      fs.rmSync(recipe);
      fs.symlinkSync('/etc/hosts', recipe);
      assert.throws(
        () => buildEvidenceBundle({ source, out: path.join(temp, 'published'), provenanceVerifier: testProvenance }),
        /regular file/,
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  it('builds an allowlisted bundle from a Grok run with its own isolation boundary', () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-evidence-grok-'));
    const source = createRawPublishableRun(temp, 'raw-run', { tool: 'grok' });
    const out = path.join(temp, 'published');
    try {
      const config = JSON.parse(fs.readFileSync(path.join(source, 'config.json'), 'utf8'));
      assert.equal(config.actor.tool, 'grok');
      assert.equal(config.actor.family, 'grok');

      const result = buildEvidenceBundle({ source, out, provenanceVerifier: testProvenance });
      assert.ok(result.files.includes('MANIFEST.sha256'));
      assert.ok(result.files.includes('trial-001/bank-kyc/BASE/actor.events.sanitized.jsonl'));
      // Grok streaming-json traces round-trip through the grok trace parser on rescore.
      const study = fs.readFileSync(path.join(out, 'case-studies/trial-001-bank-kyc.md'), 'utf8');
      assert.match(study, /grok 0\.2\.93/);
      assert.match(study, /BASE \*\*fail\*\* · WITH \*\*pass\*\*/);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});

function testProvenance() {
  return true;
}
