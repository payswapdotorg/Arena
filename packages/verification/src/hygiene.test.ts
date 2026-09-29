/**
 * Hygiene suite (Work Order A013):
 *
 *   1. SEPARATION NEGATIVES (architecture-lock rule 7 — verification
 *      establishes evidence support, NEVER emits numerical or graded
 *      quality assessments): no assessment vocabulary ANYWHERE in the
 *      domain package — not in the non-test sources, not in the
 *      committed generated contracts, not in the README, not in the
 *      manifest, not in the canonical form of the objects; and the
 *      public surface exports no assessment symbols (no aggregates, no
 *      graded labels, no calibrated numeric self-reports — the record
 *      carries pass/fail/unknown and the support summary ONLY). The
 *      deny-list lives only in this test file (the checker must not be
 *      part of the scanned surface), mirroring the A012 hygiene suite.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as verification from './index.js';
import { createVerifierDescriptor, createVerificationRecord } from './index.js';
import {
  makeArtifact,
  makeDescriptorInput,
  makeRecordInput,
  support,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Assessment vocabulary (case-insensitive). 'evaluat' covers the sibling
 * protocol's name and objects; 'score'/'judg'/'rating' cover quantitative
 * and graded quality labels; 'confidence' covers calibrated numeric
 * self-reports. The outcome vocabulary (pass/fail/unknown) and the
 * support statuses (present-supported and siblings, missing) are
 * SPEC-MANDATED (EV1.0) and deliberately NOT on the deny-list.
 */
const SEPARATION_DENY = ['evaluat', 'score', 'judg', 'rating', 'confidence'];

const SEPARATION_PATTERN = new RegExp(`(?:${SEPARATION_DENY.join('|')})`, 'i');

function containsAssessmentVocabulary(text: string): boolean {
  return SEPARATION_PATTERN.test(text);
}

function collectFiles(dir: string, filter: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(abs, filter));
    } else if (entry.isFile() && filter(entry.name)) {
      files.push(abs);
    }
  }
  return files;
}

describe('separation negatives (lock rule 7: verification carries evidence outcomes ONLY)', () => {
  it('the domain package non-test sources contain NO assessment vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(8);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsAssessmentVocabulary(text)) violations.push(file);
    }
    expect(violations, `assessment vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain NO assessment vocabulary', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'verification'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(7);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsAssessmentVocabulary(text)) violations.push(file);
    }
    expect(violations, `assessment vocabulary leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest contain NO assessment vocabulary', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsAssessmentVocabulary(text), `${rel} leaks assessment vocabulary`).toBe(false);
    }
  });

  it('the public surface exports NO assessment symbols (lock rule 7 negative)', () => {
    const exportNames = Object.keys(verification);
    expect(exportNames.length).toBeGreaterThan(80);
    const offenders = exportNames.filter((name) => SEPARATION_PATTERN.test(name));
    expect(
      offenders,
      `assessment exports found: ${offenders.join(', ')}`,
    ).toEqual([]);
    // Spot-check the evidence-outcome vocabulary IS exported (positive side
    // of the gate — runtime values only; type-only exports are invisible to
    // Object.keys).
    for (const expected of [
      'VERIFICATION_OUTCOMES',
      'deriveVerificationOutcome',
      'createVerificationRecord',
      'isVerificationRecord',
      'replayVerificationRecord',
      'recomputeVerificationRecordDigest',
      'EVIDENCE_SUPPORT_STATUSES',
      'assessEvidenceForRequirements',
      'validateEvidenceReference',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('canonical domain objects stay evidence-outcome-only (runtime control — lock rule 7)', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    const report = await makeArtifact(31);
    const balance = await makeArtifact(32);
    const record = await createVerificationRecord(
      makeRecordInput(
        descriptor.digest,
        [
          {
            evidenceKind: 'test-report',
            artifact: {
              namespace: report.identity.namespace,
              name: report.identity.name,
              version: report.identity.version,
              digest: report.digest,
            },
            provenance: { producedBy: 'arena-reference-fabric', producedAt: '2026-03-01T12:00:00.000Z', notes: null },
          },
          {
            evidenceKind: 'balance-proof',
            artifact: {
              namespace: balance.identity.namespace,
              name: balance.identity.name,
              version: balance.identity.version,
              digest: balance.digest,
            },
            provenance: { producedBy: 'erp-close-sandbox', producedAt: '2026-03-01T12:00:00.000Z', notes: null },
          },
        ],
        [
          support('requirement-001', 'present-supported', report.digest),
          support('requirement-002', 'present-unsupported', balance.digest),
        ],
      ),
      descriptor,
    );
    const canonical = canonicalJson(record);
    expect(containsAssessmentVocabulary(canonical)).toBe(false);
    // The record carries evidence outcomes ONLY — no aggregate/graded fields.
    const fields = Object.keys(verification.verificationRecordView(record)).sort();
    expect(fields).toEqual([
      'correlationId',
      'evidence',
      'evidenceSupport',
      'finishedAt',
      'idempotencyKey',
      'inputDigest',
      'outcome',
      'provenance',
      'recordVersion',
      'startedAt',
      'unknownCause',
      'verifierRef',
    ]);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsAssessmentVocabulary('the score was 0.87')).toBe(true);
    expect(containsAssessmentVocabulary('a graded rating')).toBe(true);
    expect(containsAssessmentVocabulary('the judgment protocol')).toBe(true);
    expect(containsAssessmentVocabulary('calibrated confidence')).toBe(true);
    expect(containsAssessmentVocabulary('this belongs to evaluation')).toBe(true);
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsAssessmentVocabulary('outcome: pass, fail or unknown')).toBe(false);
    expect(containsAssessmentVocabulary('present-supported evidence')).toBe(false);
    expect(containsAssessmentVocabulary('missing-evidence cause')).toBe(false);
    expect(containsAssessmentVocabulary('seeded-stochastic reproducibility')).toBe(false);
    expect(containsAssessmentVocabulary('evidence_provenance_validation method')).toBe(false);
  });
});

describe('public-surface hygiene (no any leaks, frozen exports)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(8);
    const anyPatterns = [
      /:\s*any\b/,
      /\bas\s+any\b/,
      /<any>/,
      /\bany\[\]/,
      /readonly\s+any\b/,
      /\bPromise<any>\b/,
    ];
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      for (const pattern of anyPatterns) {
        const match = pattern.exec(text);
        if (match) violations.push(`${file}: /${match[0]}/`);
      }
    }
    expect(violations, `any leaks found:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the public surface is rich but excludes the internal test-support module', () => {
    const exportNames = Object.keys(verification);
    for (const internal of [
      'makeArtifact',
      'makeDescriptorInput',
      'makeRecordInput',
      'support',
      'TestLcg',
      'DIGEST_A',
      'T0',
      'defaultRequirements',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'VERIFICATION_ERROR_CODES',
      'VerificationError',
      'VERIFIER_METHODS',
      'isVerifierMethod',
      'toVerifierMethod',
      'VERIFICATION_OUTCOMES',
      'UNKNOWN_REASONS',
      'EVIDENCE_SUPPORT_STATUSES',
      'deriveVerificationOutcome',
      'toOutcomeSemantics',
      'createVerifierDescriptor',
      'isVerifierDescriptor',
      'recomputeVerifierDescriptorDigest',
      'verifierIdentityKey',
      'VERIFIER_DESCRIPTOR_FIELDS',
      'VERIFIER_REPRODUCIBILITY_FIELDS',
      'VERIFIER_PROVENANCE_FIELDS',
      'createVerificationRecord',
      'isVerificationRecord',
      'recomputeVerificationRecordDigest',
      'replayVerificationRecord',
      'VERIFICATION_RECORD_FIELDS',
      'VERIFICATION_RECORD_PROVENANCE_FIELDS',
      'computeVerificationInputDigest',
      'assessEvidenceForRequirements',
      'validateEvidenceReference',
      'matchEvidenceForRequirement',
      'selectEvidenceForRequirement',
      'toEvidenceBundle',
      'toRequiredEvidence',
      'toEvidenceSupportSummary',
      'EVIDENCE_REQUIREMENT_FIELDS',
      'EVIDENCE_REFERENCE_FIELDS',
      'VERIFICATION_SCHEMAS',
      'verificationSchemaRef',
      'makeRunVerificationCommand',
      'makeVerificationRecordedEvent',
      'parseVerificationEnvelope',
      'verificationEnvelopeDigest',
      'checkVerificationEnvelope',
      'VERIFICATION_PROTOCOL_VERSION',
      'VERIFICATION_SCHEMA_REGISTRY',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(verification)) {
      if (typeof value === 'function') continue; // functions and classes
      if (typeof value === 'object' && value !== null) {
        expect(Object.isFrozen(value), `exported object ${name} must be frozen`).toBe(true);
        continue;
      }
      expect(typeof value, `unexpected export ${name} of type ${typeof value}`).toMatch(
        /^(string|number|object|function)$/,
      );
    }
  });

  it('descriptor and record objects are constructible end-to-end from the public surface (smoke)', async () => {
    const descriptor = await createVerifierDescriptor(makeDescriptorInput());
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
    const report = await makeArtifact(33);
    const record = await createVerificationRecord(
      makeRecordInput(
        descriptor.digest,
        [
          {
            evidenceKind: 'test-report',
            artifact: {
              namespace: report.identity.namespace,
              name: report.identity.name,
              version: report.identity.version,
              digest: report.digest,
            },
            provenance: { producedBy: 'arena-reference-fabric', producedAt: '2026-03-01T12:00:00.000Z', notes: null },
          },
        ],
        [support('requirement-001', 'present-supported', report.digest), support('requirement-002', 'missing')],
      ),
      descriptor,
    );
    expect(record.outcome).toBe('unknown');
    expect(record.unknownCause?.reason).toBe('missing-evidence');
  });
});
