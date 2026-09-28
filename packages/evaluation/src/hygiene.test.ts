/**
 * Hygiene suite (Work Order A012 gates 7, 10, 11):
 *
 *   1. SEPARATION NEGATIVES (architecture-lock rule 7 — evaluation is
 *      judgment, never an evidence claim): no verifier-semantics tokens
 *      ANYWHERE in the domain package — not in the non-test sources, not
 *      in the committed generated contracts, not in the README, not in
 *      the canonical form of the objects; and the public surface exports
 *      no verification-claim symbols (no verify/verified/verification/
 *      pass-fail exports; EvaluationRecord carries scores/judgments
 *      ONLY). The deny-list lives only in this test file (the checker
 *      must not be part of the scanned surface), mirroring the
 *      A009/A010/A011 hygiene suites.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as evaluation from './index.js';
import {
  createEvaluationCriteria,
  createEvaluationRecord,
  createEvaluatorDescriptor,
} from './index.js';
import {
  makeCriteriaInput,
  makeDescriptorInput,
  makeVerdicts,
  T0,
  T1,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Verifier-semantics tokens (case-insensitive). 'verif' covers verify,
 * verified, verifier and verification; 'pass-fail' covers the compound
 * evidence-claim vocabulary. The aggregation policy 'pass-threshold' is
 * SPEC-MANDATED vocabulary (criteria thresholds, not evidence claims)
 * and deliberately NOT on the deny-list.
 */
const SEPARATION_DENY = ['verif', 'pass-fail'];

const SEPARATION_PATTERN = new RegExp(`(?:${SEPARATION_DENY.join('|')})`, 'i');

function containsVerifierSemantics(text: string): boolean {
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

describe('separation negatives (gate 7 — lock rule 7: evaluation carries judgment ONLY)', () => {
  it('the domain package non-test sources contain NO verifier-semantics tokens', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsVerifierSemantics(text)) violations.push(file);
    }
    expect(violations, `verifier-semantics leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain NO verifier-semantics tokens', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'evaluation'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(7);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsVerifierSemantics(text)) violations.push(file);
    }
    expect(violations, `verifier-semantics leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest contain NO verifier-semantics tokens', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsVerifierSemantics(text), `${rel} leaks verifier semantics`).toBe(false);
    }
  });

  it('the public surface exports NO verification-claim symbols (gate 7 negative)', () => {
    const exportNames = Object.keys(evaluation);
    expect(exportNames.length).toBeGreaterThan(80);
    const offenders = exportNames.filter((name) => SEPARATION_PATTERN.test(name));
    expect(
      offenders,
      `verification-claim exports found: ${offenders.join(', ')}`,
    ).toEqual([]);
    // Spot-check the judgment vocabulary IS exported (positive side of the gate —
    // runtime values only; type-only exports are invisible to Object.keys).
    for (const expected of [
      'AGGREGATE_OUTCOMES',
      'aggregateCriterionVerdicts',
      'createEvaluationRecord',
      'isEvaluationRecord',
      'replayEvaluationRecord',
      'recomputeEvaluationRecordDigest',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('canonical domain objects stay judgment-only (runtime control — gate 7)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    const record = await createEvaluationRecord(
      {
        evaluatorRef: 'c'.repeat(64),
        caseRef: 'a'.repeat(64),
        trajectoryRef: 'b'.repeat(64),
        criteriaRef: criteria.digest,
        seed: 'seed-1234',
        verdicts: makeVerdicts(3, { scores: [1, 1, 1] }),
        confidence: 0.9,
        limitations: null,
        startedAt: T0,
        finishedAt: T1,
        provenance: { executedBy: 'evaluator-instance-01', recordedAt: T1, notes: null },
      },
      criteria,
    );
    const canonical = canonicalJson(record);
    expect(containsVerifierSemantics(canonical)).toBe(false);
    // The record carries scores/judgments ONLY — no evidence-bearing fields.
    const fields = Object.keys(evaluation.evaluationRecordView(record)).sort();
    expect(fields).toEqual([
      'aggregate',
      'caseRef',
      'confidence',
      'criteriaRef',
      'evaluatorRef',
      'finishedAt',
      'limitations',
      'provenance',
      'recordVersion',
      'seed',
      'startedAt',
      'trajectoryRef',
      'verdicts',
    ]);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsVerifierSemantics('the verifier rejected the run')).toBe(true);
    expect(containsVerifierSemantics('verified evidence claim')).toBe(true);
    expect(containsVerifierSemantics('a pass-fail gate')).toBe(true);
    expect(containsVerifierSemantics('verification is another protocol')).toBe(true);
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsVerifierSemantics('pass-threshold aggregation policy')).toBe(false);
    expect(containsVerifierSemantics('meets-criteria judgment')).toBe(false);
    expect(containsVerifierSemantics('per-criterion verdicts and aggregate outcome')).toBe(false);
    expect(containsVerifierSemantics('rubric-level scoring')).toBe(false);
  });
});

describe('public-surface hygiene (gates 10, 11 — no any leaks, frozen exports)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(7);
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
    const exportNames = Object.keys(evaluation);
    for (const internal of [
      'makeCriteriaInput',
      'makeDescriptorInput',
      'makeVerdicts',
      'TestLcg',
      'DIGEST_A',
      'T0',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'EVALUATION_ERROR_CODES',
      'EvaluationError',
      'EVALUATOR_KINDS',
      'isEvaluatorKind',
      'toEvaluatorKind',
      'AGGREGATION_POLICIES',
      'AGGREGATE_OUTCOMES',
      'createEvaluationCriteria',
      'isEvaluationCriteria',
      'recomputeEvaluationCriteriaDigest',
      'CRITERION_ENTRY_FIELDS',
      'EVALUATION_CRITERIA_FIELDS',
      'createEvaluatorDescriptor',
      'isEvaluatorDescriptor',
      'recomputeEvaluatorDescriptorDigest',
      'evaluatorIdentityKey',
      'EVALUATOR_DESCRIPTOR_FIELDS',
      'EVALUATOR_INPUT_FIELDS',
      'EVALUATOR_REPRODUCIBILITY_FIELDS',
      'EVALUATOR_PROVENANCE_FIELDS',
      'createEvaluationRecord',
      'isEvaluationRecord',
      'aggregateCriterionVerdicts',
      'recomputeEvaluationRecordDigest',
      'replayEvaluationRecord',
      'CRITERION_VERDICT_FIELDS',
      'EVALUATION_RECORD_FIELDS',
      'EVALUATION_RECORD_PROVENANCE_FIELDS',
      'EVALUATION_SCHEMAS',
      'evaluationSchemaRef',
      'makeRunEvaluationCommand',
      'makeEvaluationRecordedEvent',
      'parseEvaluationEnvelope',
      'evaluationEnvelopeDigest',
      'checkEvaluationEnvelope',
      'EVALUATION_PROTOCOL_VERSION',
      'EVALUATION_SCHEMA_REGISTRY',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(evaluation)) {
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

  it('descriptor objects are constructible end-to-end from the public surface (smoke)', async () => {
    const descriptor = await createEvaluatorDescriptor(makeDescriptorInput());
    expect(descriptor.digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
