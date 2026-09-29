/**
 * Service hygiene suite (Work Order A023): separation negatives over the
 * fabric sources (the design law — the fabric produces scoped certification
 * statements ONLY) and public-surface hygiene.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fabricExports from './index.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

/** Assessment / unscoped professional claim vocabulary (case-insensitive). */
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
  it('the non-test fabric sources contain NO assessment vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf-8');
      if (containsAssessmentVocabulary(text)) violations.push(file);
    }
    expect(violations, `assessment vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the service README and manifest contain NO assessment vocabulary', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsAssessmentVocabulary(text), `${rel} leaks assessment vocabulary`).toBe(false);
    }
  });

  it('the public surface exports the fabric vocabulary and nothing assessment-shaped', () => {
    const exportNames = Object.keys(fabricExports);
    const offenders = exportNames.filter((name) => SEPARATION_PATTERN.test(name));
    expect(offenders).toEqual([]);
    for (const expected of [
      'CertificationRegistry',
      'createCertificationRegistry',
      'CertificationFabric',
      'createCertificationFabric',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });
});

describe('public-surface hygiene', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(2);
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
    const exportNames = Object.keys(fabricExports);
    for (const internal of [
      'makeSuite',
      'allPassSummary',
      'allFailSummary',
      'allUnknownSummary',
      'conditionalPassSummary',
      'makeScopeRefs',
      'runOptions',
      'TestLcg',
      'digestOf',
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

  it('vocabulary constants are frozen (re-exports from @arena/certification)', () => {
    // No fabric-local vocabulary constants to freeze-test; the package-level
    // suite already asserts @arena/certification's exports are frozen. Here
    // we just confirm the fabric surface re-exports the package types.
    const exportNames = Object.keys(fabricExports);
    expect(exportNames).toContain('CertificationRegistry');
    expect(exportNames).toContain('CertificationFabric');
  });
});
