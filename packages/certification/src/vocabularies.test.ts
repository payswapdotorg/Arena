/**
 * Errors + shared + level + outcome vocabulary tests (Work Order A023).
 * Positive: closed vocabularies, structural guards, wire-safe struct
 * round trip. Negative: unknown codes/levels/verdicts/reasons rejected,
 * malformed structs rejected, strict shapes enforced.
 */

import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_ERROR_CATEGORIES,
  CERTIFICATION_ERROR_CODES,
  CertificationError,
  categoryForCertificationCode,
  fromCertificationErrorStruct,
  isCertificationError,
  normalizeToCertificationError,
  toCertificationErrorStruct,
} from './errors.js';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  deepFreeze,
  expectFields,
  isCertificationTimestamp,
  isCertificationVersion,
  isContentDigest,
  isNeutralText,
  toContentDigest,
  toOptionalContentDigest,
  toTenantId,
} from './shared.js';
import {
  CERTIFICATION_GRANT_LEVELS,
  CERTIFICATION_LEVELS,
  deriveGrantedLevel,
  isCertificationGrantLevel,
  isCertificationLevel,
  toCertificationGrantLevel,
  toCertificationLevel,
} from './level.js';
import {
  CERTIFICATION_UNKNOWN_REASONS,
  CERTIFICATION_VERDICTS,
  STAGE_REASONS,
  deriveCertificationOutcome,
  isCertificationUnknownCause,
  isCertificationVerdict,
  isStageResult,
  toCertificationVerdict,
} from './outcome.js';

const CODE = CERTIFICATION_ERROR_CODES;

describe('certification error taxonomy', () => {
  it('exposes a closed code set with category mappings', () => {
    const codes = Object.values(CERTIFICATION_ERROR_CODES);
    expect(codes.length).toBeGreaterThan(20);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(CERTIFICATION_ERROR_CATEGORIES).toContain(categoryForCertificationCode(code));
    }
  });

  it('round-trips the wire-safe struct', () => {
    const error = new CertificationError(CODE.INVALID_SUITE, {
      message: 'bad suite',
      details: { suiteId: 'x' },
    });
    const struct = toCertificationErrorStruct(error);
    expect(struct.code).toBe('CERTIFICATION_INVALID_SUITE');
    expect(struct.category).toBe('validation');
    const parsed = fromCertificationErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(isCertificationError(parsed)).toBe(true);
  });

  it('NEGATIVE: rejects unknown codes, category mismatches and malformed structs', () => {
    expect(() =>
      fromCertificationErrorStruct({ code: 'CERTIFICATION_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrow(CertificationError);
    expect(() =>
      fromCertificationErrorStruct({
        code: 'CERTIFICATION_INVALID_SUITE',
        category: 'integrity',
        message: 'x',
      }),
    ).toThrow(/does not match code/);
    expect(() => fromCertificationErrorStruct('nope')).toThrow(/plain object/);
    expect(() =>
      fromCertificationErrorStruct({ code: 'CERTIFICATION_INVALID_SUITE', category: 'validation', message: '' }),
    ).toThrow(/non-empty string/);
  });

  it('normalizes foreign throwables', () => {
    expect(normalizeToCertificationError(new Error('boom')).code).toBe(CODE.UNKNOWN_ERROR);
    expect(normalizeToCertificationError(42).message).toBe('42');
  });
});

describe('shared scalars and shapes', () => {
  it('validates digests, versions, timestamps and neutral text', () => {
    expect(isContentDigest('a'.repeat(64))).toBe(true);
    expect(isContentDigest('A'.repeat(64))).toBe(false);
    expect(toContentDigest('f'.repeat(64), 'ctx')).toBe('f'.repeat(64));
    expect(() => toContentDigest('xyz', 'ctx')).toThrow(CertificationError);
    expect(isCertificationVersion('1.2.3')).toBe(true);
    expect(isCertificationVersion('1.2')).toBe(false);
    expect(isCertificationTimestamp('2026-09-29T10:00:00.000Z')).toBe(true);
    expect(isCertificationTimestamp('2026-09-29 10:00:00')).toBe(false);
    expect(isNeutralText('plain text')).toBe(true);
    expect(isNeutralText('')).toBe(false);
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
  });

  it('optional helpers pass null through and reject non-strings', () => {
    expect(toOptionalContentDigest(null, 'ctx')).toBeNull();
    expect(toOptionalContentDigest('a'.repeat(64), 'ctx')).toBe('a'.repeat(64));
    expect(() => toOptionalContentDigest(42, 'ctx')).toThrow(CertificationError);
    expect(toTenantId('tenant-acme', 'f')).toBe('tenant-acme');
    expect(() => toTenantId('Bad Tenant', 'f')).toThrow(CertificationError);
  });

  it('NEGATIVE: expectFields rejects missing and unknown fields', () => {
    expect(() =>
      expectFields({ a: 1 }, ['a', 'b'], [], CODE.INVALID_RECORD, 'ctx'),
    ).toThrow(/missing required field 'b'/);
    expect(() =>
      expectFields({ a: 1, z: 2 }, ['a'], [], CODE.INVALID_RECORD, 'ctx'),
    ).toThrow(/unknown field 'z'/);
    expect(() => expectFields(null, ['a'], [], CODE.INVALID_RECORD, 'ctx')).toThrow(/plain object/);
    expect(expectFields({ a: 1, o: 2 }, ['a'], ['o'], CODE.INVALID_RECORD, 'ctx')).toEqual({
      a: 1,
      o: 2,
    });
  });

  it('deepFreeze freezes recursively', () => {
    const frozen = deepFreeze({ inner: { list: [1, 2] } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.inner)).toBe(true);
  });
});

describe('certification levels', () => {
  it('carries the quality-model vocabulary', () => {
    expect([...CERTIFICATION_LEVELS]).toEqual([
      'DEVELOPMENT',
      'CANDIDATE',
      'CERTIFIED',
      'CONDITIONAL',
      'REVOKED',
    ]);
    expect([...CERTIFICATION_GRANT_LEVELS]).toEqual(['DEVELOPMENT', 'CANDIDATE', 'CERTIFIED']);
    expect(isCertificationLevel('REVOKED')).toBe(true);
    expect(isCertificationGrantLevel('REVOKED')).toBe(false);
    expect(toCertificationLevel('CANDIDATE', 'ctx')).toBe('CANDIDATE');
    expect(toCertificationGrantLevel('CERTIFIED', 'ctx')).toBe('CERTIFIED');
  });

  it('NEGATIVE: rejects unknown levels', () => {
    expect(() => toCertificationLevel('GURU', 'ctx')).toThrow(CertificationError);
    expect(() => toCertificationGrantLevel('REVOKED', 'ctx')).toThrow(CertificationError);
  });

  it('derives CONDITIONAL from constraints and never grants REVOKED', () => {
    expect(deriveGrantedLevel('CERTIFIED', [])).toBe('CERTIFIED');
    expect(deriveGrantedLevel('CERTIFIED', ['only offline use'])).toBe('CONDITIONAL');
    expect(deriveGrantedLevel('DEVELOPMENT', [])).toBe('DEVELOPMENT');
  });
});

describe('certification outcome discipline', () => {
  it('keeps the verdict vocabulary closed and three-membered', () => {
    expect([...CERTIFICATION_VERDICTS]).toEqual(['satisfied', 'not-satisfied', 'unknown']);
    expect(isCertificationVerdict('satisfied')).toBe(true);
    expect(isCertificationVerdict('PASS')).toBe(false);
    expect(toCertificationVerdict('unknown', 'ctx')).toBe('unknown');
    expect(() => toCertificationVerdict('maybe', 'ctx')).toThrow(CertificationError);
  });

  it('keeps the unknown-reason and stage-reason taxonomies closed', () => {
    expect([...CERTIFICATION_UNKNOWN_REASONS]).toEqual([
      'missing-evidence',
      'evidence-mismatch',
      'invalid-evidence',
      'method-limitation',
      'tenant-mismatch',
    ]);
    expect(STAGE_REASONS).toContain('composition-mismatch');
    expect(isCertificationUnknownCause({ reason: 'missing-evidence', detail: 'why' })).toBe(true);
    expect(isCertificationUnknownCause({ reason: 'no-idea', detail: 'why' })).toBe(false);
  });

  it('derives the suite verdict purely from stage outcomes', () => {
    const sat = (stageId: string) => ({
      stageId,
      outcome: 'satisfied' as const,
      reason: 'stage-satisfied',
      evidenceDigest: null,
      unknownCause: null,
    });
    const unk = (stageId: string) => ({
      stageId,
      outcome: 'unknown' as const,
      reason: 'missing-evidence',
      evidenceDigest: null,
      unknownCause: { reason: 'missing-evidence' as const, detail: 'none supplied' },
    });
    const fail = (stageId: string) => ({
      stageId,
      outcome: 'not-satisfied' as const,
      reason: 'stage-failed',
      evidenceDigest: null,
      unknownCause: null,
    });
    expect(deriveCertificationOutcome([sat('a'), sat('b')]).verdict).toBe('satisfied');
    // FAIL dominates: a failed stage fails the suite even with unknowns present.
    const mixed = deriveCertificationOutcome([sat('a'), unk('b'), fail('c')]);
    expect(mixed.verdict).toBe('not-satisfied');
    expect(mixed.unknownCause).toBeNull();
    expect(mixed.reasons.join(' ')).toContain('stage c');
    // FAIL-CLOSED: unknown prevents a pass.
    const closed = deriveCertificationOutcome([sat('a'), unk('b')]);
    expect(closed.verdict).toBe('unknown');
    expect(closed.unknownCause?.reason).toBe('missing-evidence');
    expect(closed.unknownCause?.detail).toContain('stages b');
  });

  it('structural stage-result guard enforces the unknown⇔cause pairing', () => {
    const good = {
      stageId: 's1',
      outcome: 'unknown',
      reason: 'missing-evidence',
      evidenceDigest: null,
      unknownCause: { reason: 'missing-evidence', detail: 'why' },
    };
    expect(isStageResult(good)).toBe(true);
    expect(isStageResult({ ...good, unknownCause: null })).toBe(false);
    expect(
      isStageResult({ ...good, outcome: 'satisfied', unknownCause: good.unknownCause }),
    ).toBe(false);
    expect(isStageResult({ ...good, evidenceDigest: 'not-a-digest' })).toBe(false);
  });
});
