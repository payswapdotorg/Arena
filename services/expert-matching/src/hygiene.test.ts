/**
 * Hygiene suite (Work Order A007, service side):
 *
 *   1. SEPARATION NEGATIVES (architecture-lock rule 9 — the matching
 *      fabric ranks by per-requirement qualification evidence ONLY): no
 *      authorization vocabulary and no reputation/aggregate vocabulary in
 *      the service non-test sources (comment-stripped — negative
 *      statements in documentation comments are required, not leaks) and
 *      in the service README/manifest.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; the fabric class is
 *      constructible end-to-end (smoke).
 *
 * The deny-lists live only in this test file, mirroring the package-side
 * hygiene suite.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as fabric from './index.js';
import { ExpertMatchingFabric } from './fabric.js';
import { CORR_A, IDEM_A, T0, makeQualifiedScenario, makeMatchingPolicy, makeRequest } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

const DENY = ['authoriz', 'permission', 'grant', 'entitle', 'admin', 'systemrole', 'reputation', 'prestige', 'leaderboard'];
const SEPARATION_PATTERN = new RegExp(`(?:${DENY.join('|')})`, 'i');

function containsForbiddenVocabulary(text: string): boolean {
  return SEPARATION_PATTERN.test(text);
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
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

describe('separation negatives (lock rule 9 / quality model: evidence-only matching)', () => {
  it('the service non-test sources contain NO authorization or reputation vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(4);
    const violations: string[] = [];
    for (const file of sources) {
      const text = stripComments(readFileSync(file, 'utf-8'));
      if (containsForbiddenVocabulary(text)) violations.push(file);
    }
    expect(violations, `forbidden vocabulary leakage:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the service README and manifest contain NO authorization or reputation vocabulary', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!existsSync(path)) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsForbiddenVocabulary(text), `${rel} leaks forbidden vocabulary`).toBe(false);
    }
  });

  it('the public surface exports the fabric, pool and engine (and nothing internal)', () => {
    const exportNames = Object.keys(fabric);
    for (const internal of [
      'makeCard',
      'makePolicy',
      'makeRequest',
      'makeQualifiedScenario',
      'makeMatchingPolicy',
      'TestLcg',
      'T0',
      'SKILL_RUST',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'QualifiedExpertPool',
      'ExpertMatchingEngine',
      'ExpertMatchingFabric',
      'createExpertMatchingFabric',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('the scanner self-test detects deny-list tokens', () => {
    expect(containsForbiddenVocabulary('the permission system')).toBe(true);
    expect(containsForbiddenVocabulary(stripComments('// never grants rights'))).toBe(false);
    expect(containsForbiddenVocabulary(stripComments('const granted = 1;'))).toBe(true);
    expect(containsForbiddenVocabulary('satisfiedCount and evidenceCount')).toBe(false);
  });
});

describe('public-surface hygiene (no any leaks)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
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

  it('the fabric runs end-to-end from the public surface (smoke)', async () => {
    const instance = new ExpertMatchingFabric();
    const scenario = await makeQualifiedScenario();
    instance.registerExpertCard(scenario.card);
    for (const evidence of scenario.evidence) instance.registerEvidence(evidence);
    instance.registerQualificationPolicy(scenario.policy);
    instance.registerClaim(scenario.claim);
    const { record } = await instance.qualifyClaim(
      {
        claimRef: scenario.claim.digest,
        policyRef: scenario.policy.digest,
        evaluatedAt: T0,
        renew: false,
      },
      { correlationId: CORR_A, idempotencyKey: IDEM_A },
    );
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    const { result } = await instance.matchExperts(
      await makeRequest(),
      await makeMatchingPolicy(),
      { correlationId: CORR_A },
    );
    expect(result.candidates[0]?.satisfiedAll).toBe(true);
  });
});
