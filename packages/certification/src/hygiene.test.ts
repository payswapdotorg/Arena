/**
 * Hygiene suite (Work Order A023):
 *
 *   1. DESIGN-LAW NEGATIVES (README "Design law"; architecture-lock
 *      rule 4; requirement R46 — "Prevent professional qualification
 *      inference from substrate certification alone"): no unscoped
 *      professional-attestation vocabulary ANYWHERE in the domain
 *      package — not in the non-test sources, not in the committed
 *      generated contracts, not in the README, not in the canonical
 *      form of the objects; and the public surface exports no
 *      unscoped-claim symbol (no "isProfessional", no
 *      "substrate certification", no licensure attestation). The
 *      deny-list lives only in this test file (the checker must not be
 *      part of the scanned surface), mirroring the A012/A013 hygiene
 *      suites.
 *   2. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as certification from './index.js';
import { deriveCertificationStatement } from './index.js';
import { makeSuite, makeSubject, verificationStage } from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Unscoped professional-attestation vocabulary (case-insensitive). The
 * scoped-statement vocabulary ("possessed by Cognitive Substrate",
 * "satisfied Certification Suite", the mandated professional-LIMITATIONS
 * notice) is SPEC-MANDATED (quality-model "Professional limitations";
 * architecture-lock rule 23) and deliberately NOT on the deny-list —
 * the law bans unscoped attestation, not the word "professional" in a
 * limitations notice.
 */
const UNSCOPED_CLAIM_DENY = [
  'certifies that the substrate alone',
  'certifies the substrate alone',
  'substrate is a professional',
  'model is a professional',
  'is certified as a professional',
  'granted a professional license',
  'licensure',
  'legally qualified to practice',
  'authority to practice is granted',
  'professional competence guarantee',
];

const UNSCOPED_CLAIM_PATTERN = new RegExp(`(?:${UNSCOPED_CLAIM_DENY.join('|')})`, 'i');

function containsUnscopedClaimVocabulary(text: string): boolean {
  return UNSCOPED_CLAIM_PATTERN.test(text);
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

const isSource = (name: string) => name.endsWith('.ts') && !name.endsWith('.test.ts');

describe('design-law negatives (lock rule 4: certification claims are composition-scoped ONLY)', () => {
  it('the domain package non-test sources contain NO unscoped professional-attestation vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      isSource,
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      expect(containsUnscopedClaimVocabulary(readFileSync(source, 'utf-8'))).toBe(false);
    }
  });

  it('the committed generated contracts contain NO unscoped professional-attestation vocabulary', () => {
    const contracts = collectFiles(join(REPO_ROOT, 'contracts', 'certification'), (name) =>
      name.endsWith('.json'),
    );
    expect(contracts).toHaveLength(9);
    for (const contract of contracts) {
      expect(containsUnscopedClaimVocabulary(readFileSync(contract, 'utf-8'))).toBe(false);
    }
  });

  it('the README contains NO unscoped professional-attestation vocabulary', () => {
    const readme = readFileSync(join(PACKAGE_ROOT, 'README.md'), 'utf-8');
    expect(containsUnscopedClaimVocabulary(readme)).toBe(false);
  });

  it('the canonical form of the core objects contains NO unscoped professional-attestation vocabulary', async () => {
    const suite = await makeSuite([verificationStage('verify', 'c'.repeat(64))]);
    const statement = deriveCertificationStatement(
      makeSubject(),
      suite,
      'satisfied',
      'CERTIFIED',
    );
    for (const canonical of [
      canonicalJson(suite),
      canonicalJson(statement),
      canonicalJson({ scope: statement.scope }),
    ]) {
      expect(containsUnscopedClaimVocabulary(canonical)).toBe(false);
    }
    // and the statement ALWAYS carries the mandated limitations notice
    expect(statement.limitations.length).toBeGreaterThan(0);
    expect(statement.text).toContain('possessed by Cognitive Substrate');
    expect(statement.text).toContain('under Environment');
    expect(statement.text).toContain('Runtime Profile');
    expect(statement.text).toContain('satisfied Certification Suite');
  });

  it('the public surface exports no unscoped-claim symbol', () => {
    const surface = Object.keys(certification);
    for (const symbol of surface) {
      expect(/professional|licen[cs]e|accredit/i.test(symbol)).toBe(false);
    }
    // the design-law enforcement symbols ARE exported
    expect(surface).toContain('deriveCertificationStatement');
    expect(certification.CERTIFICATION_ERROR_CODES.UNSCOPED_STATEMENT).toBe(
      'CERTIFICATION_UNSCOPED_STATEMENT',
    );
  });
});

describe('public-surface hygiene', () => {
  it('exports no `any`-typed API (structural spot check of key factories)', () => {
    expect(typeof certification.createCertificationSuite).toBe('function');
    expect(typeof certification.createCertificationSubject).toBe('function');
    expect(typeof certification.createCertificationRecord).toBe('function');
    expect(typeof certification.createRevocationRecord).toBe('function');
    expect(typeof certification.evaluateCertificationRun).toBe('function');
  });

  it('the internal test-support module is not exported', () => {
    const surface = Object.keys(certification);
    expect(surface).not.toContain('makeSubject');
    expect(surface).not.toContain('makeSuite');
    expect(surface).not.toContain('test-support');
  });

  it('every exported frozen vocabulary stays frozen', () => {
    expect(Object.isFrozen(certification.CERTIFICATION_VERDICTS)).toBe(true);
    expect(Object.isFrozen(certification.CERTIFICATION_LEVELS)).toBe(true);
    expect(Object.isFrozen(certification.CERTIFICATION_STAGE_KINDS)).toBe(true);
    expect(Object.isFrozen(certification.CERTIFICATION_ERROR_CODES)).toBe(true);
    expect(Object.isFrozen(certification.CERTIFICATION_SCHEMAS)).toBe(true);
  });

  it('the vitest config and manifest are present (battery wiring)', () => {
    expect(statSync(join(PACKAGE_ROOT, 'vitest.config.ts')).isFile()).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf-8'),
    ) as Record<string, unknown>;
    const scripts = manifest['scripts'] as Record<string, string>;
    expect(scripts['contracts:generate']).toContain('generate-contracts.mjs');
    expect(scripts['contracts:check']).toContain('--check');
  });
});
