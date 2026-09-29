/**
 * Hygiene suite (Work Order A023; the design law — Arena certifies
 * statements of the form "Agent Body B, version V, possessed by Cognitive
 * Substrate M, under Environment E and Runtime Profile R, satisfied
 * Certification Suite S at revision X." — Arena does NOT certify that M
 * alone is a professional):
 *
 *   1. SEPARATION NEGATIVES — no quantitative, scored or graded
 *      assessment vocabulary ANYWHERE in the domain package — not in the
 *      non-test sources, not in the committed generated contracts, not in
 *      the README, not in the manifest, not in the canonical form of the
 *      objects; and the public surface exports no quantitative symbols.
 *      The verdict vocabulary (pass / conditional-pass / fail / unknown)
 *      and the component verdicts (pass / fail / unknown) are
 *      SPEC-MANDATED and deliberately NOT on the deny-list.
 *   2. DESIGN-LAW NEGATIVE — no unscoped "is-a-professional" claim can be
 *      produced by the public surface. The certification statement ALWAYS
 *      carries the full Body×Substrate×Environment×RuntimeProfile×Suite+Rev
 *      scope (six fields, all content-addressed); the canonical record view
 *      carries the SCOPED statement only — never a free-form "M is a
 *      software engineer" or "M is a structural engineer" claim field.
 *   3. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported object
 *      is frozen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as certification from './index.js';
import { createCertificationSuite } from './index.js';
import { createCertificationRecord } from './index.js';
import {
  allPassSummary,
  makeRecordInput,
  makeSuiteInput,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Assessment / professional-claim vocabulary (case-insensitive). 'score',
 * 'judg', 'rating', 'confidence' cover quantitative and graded quality
 * labels. 'is-a-professional', 'is-a-software-engineer',
 * 'is-a-structural-engineer' (and the spaced variants) cover the
 * design-law-negative unscoped professional claim.
 *
 * The verdict vocabulary (pass / conditional-pass / fail / unknown),
 * component verdicts (pass / fail / unknown), and 'satisfied' (the
 * design-law verb) are SPEC-MANDATED and deliberately NOT on the deny-list.
 * 'evaluation', 'verification' and 'compatibility' (component kinds this
 * suite composes) are SPEC-MANDATED refs to sibling protocols and are NOT
 * on the deny-list — @arena/certification composes the A012 evaluation
 * protocol by content-addressed digest, it never emits its own assessment.
 */
const SEPARATION_DENY = [
  'score',
  'judg',
  'rating',
  'confidence',
  'is a professional',
  'is a software engineer',
  'is a structural engineer',
  'is-a-professional',
  'is-a-software-engineer',
  'is-a-structural-engineer',
];

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

describe('separation negatives (the design law: certification carries scoped statements ONLY)', () => {
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
    expect(
      violations,
      `assessment vocabulary leakage in sources:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the committed generated contracts contain NO assessment vocabulary', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'certification'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(8);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const text = readFileSync(file, 'utf-8');
      if (containsAssessmentVocabulary(text)) violations.push(file);
    }
    expect(
      violations,
      `assessment vocabulary leakage in contracts:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('the package README and manifest contain NO assessment vocabulary', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsAssessmentVocabulary(text), `${rel} leaks assessment vocabulary`).toBe(false);
    }
  });

  it('the public surface exports NO assessment symbols', () => {
    const exportNames = Object.keys(certification);
    expect(exportNames.length).toBeGreaterThan(80);
    const offenders = exportNames.filter((name) => SEPARATION_PATTERN.test(name));
    expect(offenders, `assessment exports found: ${offenders.join(', ')}`).toEqual([]);
    // Spot-check the certification vocabulary IS exported.
    for (const expected of [
      'CERTIFICATION_VERDICTS',
      'COMPONENT_VERDICTS',
      'deriveCertificationVerdict',
      'createCertificationSuite',
      'isCertificationSuiteDescriptor',
      'createCertificationRecord',
      'isCertificationRecord',
      'replayCertificationRecord',
      'recomputeCertificationRecordDigest',
      'buildCertificationStatement',
      'CERTIFICATION_SCHEMAS',
      'makeRunCertificationCommand',
      'makeCertificationRecordedEvent',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('canonical domain objects stay scoped-statement-only (runtime control — the design law)', async () => {
    const suite = await createCertificationSuite(await makeSuiteInput());
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(
      await makeRecordInput(suite, summary),
      suite,
    );
    const canonical = canonicalJson(record);
    expect(containsAssessmentVocabulary(canonical)).toBe(false);
    // The record carries the SCOPED statement only — no aggregate/graded/
    // professional-claim fields.
    const fields = Object.keys(certification.certificationRecordView(record)).sort();
    // The fields MUST include the scoped statement and the derived verdict —
    // and MUST NOT include any unscoped professional claim field.
    expect(fields).toContain('statement');
    expect(fields).toContain('verdict');
    expect(fields).not.toContain('isProfessional');
    expect(fields).not.toContain('professionalClaim');
    expect(fields).not.toContain('score');
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsAssessmentVocabulary('the score was 0.87')).toBe(true);
    expect(containsAssessmentVocabulary('a graded rating')).toBe(true);
    expect(containsAssessmentVocabulary('the judgment protocol')).toBe(true);
    expect(containsAssessmentVocabulary('calibrated confidence')).toBe(true);
    expect(containsAssessmentVocabulary('M is a professional')).toBe(true);
    expect(containsAssessmentVocabulary('M is a software engineer')).toBe(true);
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsAssessmentVocabulary('verdict: pass, fail or unknown')).toBe(false);
    expect(containsAssessmentVocabulary('conditional-pass')).toBe(false);
    expect(containsAssessmentVocabulary('unverifiable-component')).toBe(false);
    expect(containsAssessmentVocabulary('satisfied Certification Suite S at revision X')).toBe(false);
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

  it('the internal test-support module is not exported', () => {
    const exportNames = Object.keys(certification);
    for (const internal of [
      'makeSuiteInput',
      'makeThreeComponentSuiteInput',
      'makeRecordInput',
      'allPassSummary',
      'allFailSummary',
      'allUnknownSummary',
      'conditionalPassSummary',
      'TestLcg',
      'digestOf',
      'makeDigest',
      'defaultVerdictSemantics',
      'T0',
      'T1',
      'T2',
      'T3',
      'CORR',
      'IDEM',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(certification)) {
      if (typeof value === 'function') continue;
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
    const suite = await createCertificationSuite(await makeSuiteInput());
    expect(suite.digest).toMatch(/^[0-9a-f]{64}$/);
    const summary = await allPassSummary(suite);
    const record = await createCertificationRecord(
      await makeRecordInput(suite, summary),
      suite,
    );
    expect(record.verdict).toBe('pass');
    expect(record.statement.statementText).toContain(suite.digest);
  });
});
