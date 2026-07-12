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
    assert.doesNotMatch(clean, /aggregated_output/);
    assert.match(clean, /\$HOME/);
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
    const source = path.join(temp, 'raw-run');
    const out = path.join(temp, 'published');
    try {
      const arm = path.join(source, 'trial-001', 'clinic', 'BASE');
      fs.mkdirSync(arm, { recursive: true });
      fs.writeFileSync(path.join(source, 'config.json'), JSON.stringify({
        run_id: 'test-run',
        actor: { tool: 'codex', model: 'gpt-test', reasoning: 'xhigh' },
        git: { commit: 'abc123' },
        runs: 3,
        seed: 'fixed',
        scenarios: ['clinic'],
        budget: { timeout_ms_per_arm: 1000 },
        access_token: 'private',
      }));
      fs.writeFileSync(path.join(source, 'summary.json'), '{"publishable":true}\n');
      fs.writeFileSync(path.join(source, 'report.md'), '# Report\n');
      fs.writeFileSync(path.join(source, 'do-not-copy.txt'), 'private\n');
      fs.writeFileSync(path.join(arm, 'actor.status.json'), '{"session_id":"private"}\n');
      fs.writeFileSync(path.join(arm, 'actor.events.jsonl'), `${JSON.stringify({ type: 'thread.started', thread_id: 'private' })}\n`);
      fs.writeFileSync(path.join(arm, 'actor.stdout.txt'), 'not allowlisted\n');

      const result = buildEvidenceBundle({ source, out });
      assert.ok(result.files.includes('MANIFEST.sha256'));
      assert.ok(result.files.includes('REDACTION.md'));
      assert.ok(result.files.includes('REPRODUCE.md'));
      assert.ok(result.files.includes('trial-001/clinic/BASE/actor.events.sanitized.jsonl'));
      assert.equal(fs.existsSync(path.join(out, 'do-not-copy.txt')), false);
      assert.equal(fs.existsSync(path.join(out, 'trial-001/clinic/BASE/actor.stdout.txt')), false);
      assert.doesNotMatch(fs.readFileSync(path.join(out, 'config.json'), 'utf8'), /private/);
      assert.match(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'), /"sanitized": true/);
      assert.match(fs.readFileSync(path.join(out, 'REPRODUCE.md'), 'utf8'), /git checkout abc123/);
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
    const source = path.join(temp, 'raw-run');
    try {
      fs.mkdirSync(source);
      fs.writeFileSync(path.join(source, 'config.json'), '{}\n');
      fs.writeFileSync(path.join(source, 'summary.json'), '{"publishable":false}\n');
      fs.writeFileSync(path.join(source, 'report.md'), '# Diagnostic\n');
      assert.throws(
        () => buildEvidenceBundle({ source, out: path.join(temp, 'published') }),
        /not publication-eligible/,
      );
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });
});
