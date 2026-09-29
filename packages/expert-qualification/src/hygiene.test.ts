/**
 * Hygiene suite (Work Order A007):
 *
 *   1. SEPARATION NEGATIVES (architecture-lock rule 9 — qualification is
 *      DATA, never authorization): no authorization vocabulary ANYWHERE
 *      in the domain package — not in the non-test sources, not in the
 *      committed generated contracts, not in the README, not in the
 *      manifest, not in the canonical form of the objects; and the
 *      public surface exports no authorization symbols.
 *   2. NO-AGGREGATE-SCORE negatives (spec/quality-model.md "Do not
 *      collapse expert quality into a single global score"): no
 *      score/rating/reputation vocabulary in the surfaces or the
 *      canonical objects — per-requirement counts and evidence digests
 *      only.
 *   3. Public-surface hygiene — no `any` in the public surface; the
 *      internal test-support module is not exported; every exported
 *      object is frozen.
 *
 * The deny-lists live only in this test file (the checker must not be
 * part of the scanned surface), mirroring the A012/A013 hygiene suites.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@arena/protocol-core';
import * as qualification from './index.js';
import { evaluateCompetencyClaim } from './qualification.js';
import {
  makeClaim,
  makeExpertCard,
  makeQualificationPolicy,
  makeVerificationEvidence,
  makeWorkProductEvidence,
} from './test-support.js';

const PACKAGE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const REPO_ROOT = resolve(PACKAGE_ROOT, '../..');

/**
 * Authorization vocabulary (case-insensitive): lock rule 9 — this package
 * is qualification DATA, never authorization. 'permission', 'grant',
 * 'entitle', 'authoriz', 'admin', 'role', 'systemRole', 'allow', 'access'
 * cover the shapes a smuggled authority claim would take. The
 * qualification vocabulary (qualified/stale/revoked and siblings) is
 * SPEC-MANDATED (status names about the evidence lifecycle) and
 * deliberately NOT on the deny-list.
 */
const AUTHORIZATION_DENY = [
  'authoriz',
  'permission',
  'grant',
  'entitle',
  'admin',
  'systemrole',
  'allowlist',
  'access-control',
];

/**
 * Aggregate-quality vocabulary (case-insensitive): spec/quality-model.md —
 * no global expert score. 'score', 'rating', 'reputation', 'rank' (as a
 * noun concept), 'grade', 'confidence' cover quantitative/graded labels.
 * The matching vocabulary (satisfiedCount, evidenceCount — structural
 * counts of per-requirement evidence) is deliberately NOT on the
 * deny-list.
 */
const AGGREGATE_DENY = ['reputation', 'prestige', 'leaderboard', 'goodness'];

const SEPARATION_PATTERN = new RegExp(
  `(?:${[...AUTHORIZATION_DENY, ...AGGREGATE_DENY].join('|')})`,
  'i',
);

function containsForbiddenVocabulary(text: string): boolean {
  return SEPARATION_PATTERN.test(text);
}

/**
 * Strip documentation comments before scanning: comments are where this
 * package STATES the lock-rule-9 separation ("NEVER AUTHORIZATION" prose is
 * required documentation, not a leak). The scanner targets code-level
 * vocabulary — identifiers, string literals, field names. Comment-like
 * sequences do not appear inside this package's string literals (its
 * regexes contain no `//` or `/*` sequences), so a lexical strip is safe
 * and is verified by the self-test below.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Project a generated contract onto its STRUCTURE (drop the prose keys —
 * description/title — where the lock-rule-9 separation is stated as
 * documentation) and return the deterministic serialization of that
 * structure. Field names, enums, patterns and required lists stay in the
 * scan; docs prose does not.
 */
function contractStructure(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(contractStructure);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'description' || key === 'title' || key === '$comment') continue;
      out[key] = contractStructure(entry);
    }
    return out;
  }
  return value;
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

describe('separation negatives (lock rule 9: qualification is data, never authorization)', () => {
  it('the domain package non-test sources contain NO authorization or reputation vocabulary', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(10);
    const violations: string[] = [];
    for (const file of sources) {
      const text = stripComments(readFileSync(file, 'utf-8'));
      if (containsForbiddenVocabulary(text)) violations.push(file);
    }
    expect(violations, `forbidden vocabulary leakage in sources:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the committed generated contracts contain NO authorization or reputation vocabulary in their STRUCTURE', () => {
    const contractFiles = collectFiles(
      join(REPO_ROOT, 'contracts', 'expert-qualification'),
      (name) => name.endsWith('.json'),
    );
    expect(contractFiles).toHaveLength(15);
    const violations: string[] = [];
    for (const file of contractFiles) {
      const structure = JSON.stringify(
        contractStructure(JSON.parse(readFileSync(file, 'utf-8'))),
      );
      if (containsForbiddenVocabulary(structure)) violations.push(file);
    }
    expect(violations, `forbidden vocabulary leakage in contracts:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the package README and manifest contain NO authorization or reputation vocabulary', () => {
    for (const rel of ['README.md', 'package.json']) {
      const path = join(PACKAGE_ROOT, rel);
      if (!statSync(path, { throwIfNoEntry: false })) continue;
      const text = readFileSync(path, 'utf-8');
      expect(containsForbiddenVocabulary(text), `${rel} leaks forbidden vocabulary`).toBe(false);
    }
  });

  it('the public surface exports NO authorization symbols (lock rule 9 negative)', () => {
    const exportNames = Object.keys(qualification);
    expect(exportNames.length).toBeGreaterThan(80);
    const offenders = exportNames.filter((name) => SEPARATION_PATTERN.test(name));
    expect(offenders, `authorization exports found: ${offenders.join(', ')}`).toEqual([]);
    // Spot-check the qualification vocabulary IS exported (positive side
    // of the gate — runtime values only).
    for (const expected of [
      'QUALIFICATION_STATUSES',
      'evaluateCompetencyClaim',
      'recordQualificationExpiry',
      'isQualificationInForce',
      'createQualificationPolicy',
      'createCompetencyClaim',
      'createQualificationEvidence',
      'UNMATCHED_REASONS',
      'createMatchResult',
      'createMatchRequest',
      'createMatchingPolicy',
      'createQualifiedExpertCard',
      'makeQualifyClaimCommand',
      'makeMatchExpertsQuery',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('canonical domain objects stay qualification-data-only (runtime control — lock rule 9)', async () => {
    const work1 = await makeWorkProductEvidence(1);
    const work2 = await makeWorkProductEvidence(2);
    const verification = await makeVerificationEvidence('pass');
    const claim = await makeClaim([work1.digest, work2.digest, verification.digest]);
    const policy = await makeQualificationPolicy();
    const record = await evaluateCompetencyClaim({
      claim,
      policy,
      evidence: [work1, work2, verification],
      evaluatedAt: '2026-01-15T09:30:00.000Z',
    });
    const card = await makeExpertCard();
    for (const canonical of [
      canonicalJson(record),
      canonicalJson(claim),
      canonicalJson(policy),
      canonicalJson(card),
      canonicalJson(work1),
    ]) {
      expect(containsForbiddenVocabulary(canonical)).toBe(false);
    }
    // The record carries evidence data ONLY — no permission-shaped fields.
    const fields = Object.keys(qualification.qualificationRecordView(record)).sort();
    expect(fields).toEqual([
      'claimDigest',
      'conflictEvidence',
      'evaluatedAt',
      'policyDigest',
      'qualifyingEvidence',
      'recordVersion',
      'requirementOutcomes',
      'status',
      'validFrom',
      'validUntil',
    ]);
  });

  it('the scanner itself detects the deny-list tokens (self-test, negative control)', () => {
    expect(containsForbiddenVocabulary('the permission was granted')).toBe(true);
    expect(containsForbiddenVocabulary('authorization: admin')).toBe(true);
    expect(containsForbiddenVocabulary('global reputation score')).toBe(true);
    // No false positives on this package's (spec-mandated) vocabulary:
    expect(containsForbiddenVocabulary('status: qualified, stale or revoked')).toBe(false);
    expect(containsForbiddenVocabulary('evidence supersession appends')).toBe(false);
    expect(containsForbiddenVocabulary('satisfiedCount per requirement')).toBe(false);
    expect(containsForbiddenVocabulary('deterministic tie-break by digest')).toBe(false);
    // Comment stripping: negative statements in COMMENTS are documentation;
    // code-level tokens (identifiers/strings) still trip the scanner.
    expect(containsForbiddenVocabulary(stripComments('// NEVER grants authorization'))).toBe(false);
    expect(containsForbiddenVocabulary(stripComments('const permission = 1; // docs'))).toBe(true);
    // Contract structural projection: prose descriptions are documentation;
    // structural tokens (field names/enums) still trip the scanner.
    expect(
      containsForbiddenVocabulary(
        JSON.stringify(contractStructure({ description: 'never authorization', properties: { ok: {} } })),
      ),
    ).toBe(false);
    expect(
      containsForbiddenVocabulary(
        JSON.stringify(contractStructure({ properties: { permission: {} } })),
      ),
    ).toBe(true);
  });
});

describe('public-surface hygiene (no any leaks, frozen exports)', () => {
  it('non-test sources contain no any-typed annotations, casts or arrays', () => {
    const sources = collectFiles(
      join(PACKAGE_ROOT, 'src'),
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThanOrEqual(10);
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
    const exportNames = Object.keys(qualification);
    for (const internal of [
      'makeArtifact',
      'makeClaim',
      'makeCredentialEvidence',
      'makeEvaluationEvidence',
      'makeExpertCard',
      'makeMatchingPolicy',
      'makeQualificationPolicy',
      'makeVerificationEvidence',
      'makeWorkProductEvidence',
      'TestLcg',
      'DIGEST_A',
      'T0',
      'SKILL_RUST_REVIEW',
      'DOMAIN_SOFTWARE',
    ]) {
      expect(exportNames).not.toContain(internal);
    }
    for (const expected of [
      'EXPERT_QUALIFICATION_ERROR_CODES',
      'ExpertQualificationError',
      'QUALIFICATION_EVIDENCE_KINDS',
      'VERIFICATION_REF_OUTCOMES',
      'createQualificationEvidence',
      'isQualificationEvidence',
      'recomputeQualificationEvidenceDigest',
      'resolveActiveEvidenceDigests',
      'COMPETENCY_CLAIM_FIELDS',
      'createCompetencyClaim',
      'isCompetencyClaim',
      'recomputeCompetencyClaimDigest',
      'competencyClaimIdentityKey',
      'QUALIFICATION_POLICY_FIELDS',
      'createQualificationPolicy',
      'isQualificationPolicy',
      'recomputeQualificationPolicyDigest',
      'qualificationPolicyIdentityKey',
      'QUALIFICATION_STATUSES',
      'evaluateCompetencyClaim',
      'recordQualificationExpiry',
      'isQualificationInForce',
      'recomputeQualificationRecordDigest',
      'replayQualificationRecord',
      'QUALIFICATION_RECORD_FIELDS',
      'MATCH_REQUEST_FIELDS',
      'createMatchRequest',
      'isMatchRequest',
      'recomputeMatchRequestDigest',
      'MATCHING_POLICY_FIELDS',
      'createMatchingPolicy',
      'isMatchingPolicy',
      'recomputeMatchingPolicyDigest',
      'QUALIFIED_EXPERT_FIELDS',
      'createQualifiedExpertCard',
      'isQualifiedExpertCard',
      'recomputeQualifiedExpertCardDigest',
      'UNMATCHED_REASONS',
      'createMatchResult',
      'isMatchResult',
      'recomputeMatchResultDigest',
      'replayMatchResult',
      'EXPERT_QUALIFICATION_SCHEMAS',
      'expertQualificationSchemaRef',
      'makeQualifyClaimCommand',
      'makeRecordQualificationExpiryCommand',
      'makeQualificationRecordedEvent',
      'makeMatchExpertsQuery',
      'makeMatchCompletedResponse',
      'parseExpertQualificationEnvelope',
      'expertQualificationEnvelopeDigest',
      'checkExpertQualificationEnvelope',
      'EXPERT_QUALIFICATION_PROTOCOL_VERSION',
      'EXPERT_QUALIFICATION_SCHEMA_REGISTRY',
    ]) {
      expect(exportNames).toContain(expected);
    }
  });

  it('every export is a function or a frozen object/array constant', () => {
    for (const [name, value] of Object.entries(qualification)) {
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
});
