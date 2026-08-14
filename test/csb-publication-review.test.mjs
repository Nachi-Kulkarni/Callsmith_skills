import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildEvidenceBundle } from '../evals/csb/scripts/build-evidence.mjs';
import {
  reviewPublication,
  writePublicationReview,
} from '../evals/csb/scripts/review-publication.mjs';
import { listScenarioIds } from '../evals/csb/harness/score.mjs';
import {
  createRawPublishableRun,
  writeManifest,
} from '../test-support/csb-fixture.mjs';

describe('CSB product-claim review', () => {
  it('accepts two distinct model families from real sanitized bundles', () => {
    withTempDir((root) => {
      const luna = buildBundle(root, 'luna', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const terra = buildBundle(root, 'terra', {
        model: 'gpt-5.6-terra',
        family: 'terra',
      });
      const review = writePublicationReview(
        [luna, terra],
        path.join(root, 'review'),
        REVIEW_OPTIONS,
      );

      assert.equal(review.product_claim_eligible, true, review.failures.join('; '));
      assert.deepEqual(review.model_families.sort(), ['luna', 'terra']);
      // 2 bundles × 3 runs × current suite size (core10 or superset).
      assert.equal(review.combined.n_valid_pairs, 2 * 3 * listScenarioIds().length);
      assert.equal(review.combined.WITH, 1);
      assert.equal(review.combined.BASE, 0);
      assert.equal(review.combined.lift, 1);
      assert.ok(fs.existsSync(path.join(root, 'review', 'RESULTS.md')));
      assert.ok(fs.existsSync(path.join(root, 'review', 'README-SNIPPET.md')));
    });
  });

  it('blocks a cross-tool product claim but lets a Grok bundle pass its own gates', () => {
    withTempDir((root) => {
      // The product claim compares two model FAMILIES under identical controlled
      // conditions. Different actor tools (grok vs codex) is a confound the review
      // must reject, even when each bundle independently passes its isolation gate.
      const grok = buildBundle(root, 'grok', { tool: 'grok' });
      const luna = buildBundle(root, 'luna', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const review = reviewPublication([grok, luna], REVIEW_OPTIONS);
      assert.equal(review.product_claim_eligible, false);
      assert.match(review.failures.join('; '), /actor tool differs/);
      assert.match(review.failures.join('; '), /reasoning effort differs/);
      // ...yet each family is recognized and the grok isolation boundary held.
      assert.deepEqual(review.model_families.sort(), ['grok', 'luna']);
    });
  });

  it('blocks same model family and weak score metrics', () => {
    withTempDir((root) => {
      const first = buildBundle(root, 'same-a', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const second = buildBundle(root, 'same-b', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const sameModel = reviewPublication([first, second], REVIEW_OPTIONS);
      assert.equal(sameModel.product_claim_eligible, false);
      assert.match(sameModel.failures.join('; '), /distinct pinned model IDs/);
      assert.match(sameModel.failures.join('; '), /distinct named model families/);

      const weak = buildBundle(root, 'weak', {
        model: 'gpt-5.6-terra',
        family: 'terra',
        weak: true,
      });
      const strong = buildBundle(root, 'strong', {
        model: 'gpt-5.6-sol',
        family: 'sol',
      });
      const weakReview = reviewPublication([weak, strong], REVIEW_OPTIONS);
      assert.equal(weakReview.product_claim_eligible, false);
      assert.match(weakReview.failures.join('; '), /gpt-5.6-terra: floor lift is below \+0.5/);
      assert.match(weakReview.failures.join('; '), /gpt-5.6-terra: physics lift is below \+0.4/);
      assert.match(weakReview.failures.join('; '), /gpt-5.6-terra: BASE floor\/physics failure rate is below 0.6/);
    });
  });

  it('refuses an existing publication output directory', () => {
    withTempDir((root) => {
      const reviewDir = path.join(root, 'review');
      fs.mkdirSync(reviewDir);
      assert.throws(
        () => writePublicationReview([], reviewDir, REVIEW_OPTIONS),
        /Refusing existing publication review directory/,
      );
    });
  });

  it('fails closed when a published bundle manifest is tampered', () => {
    withTempDir((root) => {
      const luna = buildBundle(root, 'luna', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const score = path.join(luna, 'trial-001', 'bank-kyc', 'BASE', 'score.json');
      fs.appendFileSync(score, '\n');

      assert.throws(
        () => reviewPublication([luna, luna], REVIEW_OPTIONS),
        /manifest mismatch for .*score\.json/,
      );
    });
  });

  it('rejects non-canonical schedules and swapped score receipts', () => {
    withTempDir((root) => {
      const luna = buildBundle(root, 'luna', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const configPath = path.join(luna, 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config.schedule.pop();
      fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
      writeManifest(luna);
      assert.throws(
        () => reviewPublication([luna, luna], REVIEW_OPTIONS),
        /schedule does not cover/i,
      );

      const fresh = buildBundle(root, 'fresh', {
        model: 'gpt-5.6-sol',
        family: 'sol',
      });
      const scorePath = path.join(fresh, 'trial-001', 'bank-kyc', 'BASE', 'score.json');
      const score = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
      score.arm = 'WITH';
      fs.writeFileSync(scorePath, `${JSON.stringify(score, null, 2)}\n`);
      writeManifest(fresh);
      assert.throws(
        () => reviewPublication([fresh, fresh], REVIEW_OPTIONS),
        /score identity mismatch/,
      );
    });
  });

  it('rejects manifest-covered extra files and independently scans expected files for secrets', () => {
    withTempDir((root) => {
      const luna = buildBundle(root, 'luna', {
        model: 'gpt-5.6-luna',
        family: 'luna',
      });
      const extra = path.join(luna, 'unreviewed-claim.md');
      fs.writeFileSync(extra, '# Trust me\n');
      writeManifest(luna);
      assert.throws(
        () => reviewPublication([luna, luna], REVIEW_OPTIONS),
        /missing or unrecognized artifacts/,
      );

      fs.rmSync(extra);
      const redaction = path.join(luna, 'REDACTION.md');
      fs.appendFileSync(redaction, '\nBearer definitely-not-redacted\n');
      writeManifest(luna);
      assert.throws(
        () => reviewPublication([luna, luna], REVIEW_OPTIONS),
        /obvious secret or private identifier/,
      );
    });
  });
});

function buildBundle(root, name, options) {
  const source = createRawPublishableRun(root, `${name}-raw`, options);
  return buildEvidenceBundle({
    source,
    out: path.join(root, name),
    provenanceVerifier: testProvenance,
  }).out;
}

const REVIEW_OPTIONS = { provenanceVerifier: testProvenance };

function testProvenance(config) {
  // Weak stub: only asserts the verifier is consulted with the parsed run config
  // carrying a full commit pin. Rejection is covered in csb-evidence.test.mjs.
  assert.match(config.git?.commit || '', /^[a-f0-9]{40}$/);
}

function withTempDir(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-publication-review-'));
  try {
    callback(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
