/**
 * G_CON — contract validate + answers cross-check (anti keyword theater).
 *
 * Negative rule: beautiful headings with weak floor *policy in answers* must fail
 * when domain is regulated.
 */
import { validateContract } from '../../../src/lib/contract.mjs';
import {
  CONSENT_RANK,
  RETENTION_RANK,
  meetsMin,
  inOneOf,
} from './levels.mjs';

/**
 * @param {string} recipeText
 * @param {object} answers
 * @param {object} oracle
 */
export function scoreContractGate(recipeText, answers, oracle) {
  const domain = oracle?.contract_domain || oracle?.domain || null;
  const sealed = oracle?.sealed || {};
  const checks = [];
  const errors = [];
  const run = (id, ok, detail) => {
    checks.push({ id, ok, detail });
    if (!ok) errors.push(detail);
  };

  const report = validateContract(recipeText || '', { domain: domain || undefined });
  run(
    'contract_validate',
    report.status === 'PASS',
    report.status === 'PASS'
      ? `contract validate PASS (domain=${report.domain || domain || 'n/a'})`
      : `contract validate FAIL: ${report.errors.join('; ')}`,
  );

  if (report.receipt) {
    const receipt = report.receipt;
    const comparisons = [
      ['receipt_surface_matches_answers', receipt.surface, answers.surface],
      ['receipt_consent_matches_answers', receipt.policy?.recording_consent, answers.recording_consent],
      ['receipt_retention_matches_answers', receipt.policy?.transcript_retention, answers.transcript_retention],
      ['receipt_handoff_matches_answers', receipt.policy?.human_handoff, answers.human_handoff],
    ];
    for (const [id, actual, expected] of comparisons) {
      const ok = actual === expected;
      run(id, ok, ok ? `${actual} matches answers` : `receipt ${actual ?? '(missing)'} != answers ${expected ?? '(missing)'}`);
    }
  }

  // Cross-check: answers must satisfy sealed floors (policy truth lives in answers)
  if (sealed.recording_consent?.min) {
    const ok = meetsMin(CONSENT_RANK, answers.recording_consent, sealed.recording_consent.min);
    run(
      'answers_consent_vs_oracle',
      ok,
      ok
        ? `answers consent ok (${answers.recording_consent})`
        : `answers consent ${answers.recording_consent ?? '(missing)'} < ${sealed.recording_consent.min} (contract keywords alone do not pass)`,
    );
  }
  if (sealed.transcript_retention?.min) {
    const ok = meetsMin(RETENTION_RANK, answers.transcript_retention, sealed.transcript_retention.min);
    run(
      'answers_retention_vs_oracle',
      ok,
      ok
        ? `answers retention ok (${answers.transcript_retention})`
        : `answers retention ${answers.transcript_retention ?? '(missing)'} < ${sealed.transcript_retention.min}`,
    );
  }
  if (sealed.human_handoff?.one_of) {
    const ok = inOneOf(answers.human_handoff, sealed.human_handoff.one_of);
    run(
      'answers_handoff_vs_oracle',
      ok,
      ok
        ? `answers handoff ok (${answers.human_handoff})`
        : `answers handoff ${answers.human_handoff ?? '(missing)'} not in oracle`,
    );
  }

  // Anti theater: only on regulated domains (not general/null).
  // "general" manifests must not inherit medical-style keyword theater.
  const regulatedDomains = new Set(['medical', 'banking', 'collections', 'legal', 'insurance']);
  if (regulatedDomains.has(domain) && answers.recording_consent === 'none') {
    const mentions = /\bconsent\b/i.test(recipeText || '');
    if (mentions) {
      run(
        'no_consent_keyword_theater',
        false,
        'contract mentions consent but answers.recording_consent=none (flag-only theater)',
      );
    }
  }

  return {
    pass: errors.length === 0,
    checks,
    errors,
    contractReport: report,
  };
}
