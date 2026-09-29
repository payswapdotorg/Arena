/**
 * Shared guard tests (Work Order A013): branded-scalar patterns, strict
 * shape enforcement (expectFields), enum member validation and deep
 * freezing.
 */

import { describe, expect, it } from 'vitest';
import { VerificationError } from './errors.js';
import { VERIFICATION_ERROR_CODES } from './errors.js';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
  VERIFICATION_ID_PATTERN_SOURCE,
  VERIFICATION_TIMESTAMP_PATTERN_SOURCE,
  VERIFICATION_VERSION_PATTERN_SOURCE,
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isVerificationId,
  isVerificationSeed,
  isVerificationTimestamp,
  isVerificationVersion,
  toContentDigest,
  toNeutralText,
  toVerificationId,
  toVerificationTimestamp,
  toVerificationVersion,
} from './shared.js';

describe('pattern sources are exported and stable', () => {
  it('exports the canonical pattern sources (parity-checked against contracts)', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
    expect(VERIFICATION_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
    expect(NEUTRAL_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
    expect(VERIFICATION_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
    expect(SEED_PATTERN_SOURCE).toBe('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
    expect(VERIFICATION_VERSION_PATTERN_SOURCE).toBe(
      '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
    );
    expect(NEUTRAL_TEXT_PATTERN_SOURCE).toBe('^[\\x20-\\x7E\\n\\t]{1,4096}$');
  });
});

describe('structural guards', () => {
  it('content digests: 64-char lowercase hex only', () => {
    expect(isContentDigest('a'.repeat(64))).toBe(true);
    expect(isContentDigest('A'.repeat(64))).toBe(false);
    expect(isContentDigest('a'.repeat(63))).toBe(false);
    expect(isContentDigest('g'.repeat(64))).toBe(false);
    expect(isContentDigest(123)).toBe(false);
  });

  it('verification ids: lowercase neutral ids', () => {
    expect(isVerificationId('verifier-000042')).toBe(true);
    expect(isVerificationId('req-1')).toBe(true);
    expect(isVerificationId('Bad_ID')).toBe(false);
    expect(isVerificationId('')).toBe(false);
    expect(isNeutralId('arena-reference-fabric')).toBe(true);
  });

  it('timestamps: ms-precision UTC and parseable', () => {
    expect(isVerificationTimestamp('2026-01-15T09:30:00.000Z')).toBe(true);
    expect(isVerificationTimestamp('2026-01-15T09:30:00Z')).toBe(false);
    expect(isVerificationTimestamp('2026-13-45T09:30:00.000Z')).toBe(false);
    expect(isVerificationTimestamp('not a time')).toBe(false);
  });

  it('versions: semver without build metadata', () => {
    expect(isVerificationVersion('1.0.0')).toBe(true);
    expect(isVerificationVersion('2.11.3-alpha.1')).toBe(true);
    expect(isVerificationVersion('1.0')).toBe(false);
    expect(isVerificationVersion('1.0.0+build')).toBe(false);
  });

  it('seeds and neutral text', () => {
    expect(isVerificationSeed('seed-1234')).toBe(true);
    expect(isVerificationSeed('')).toBe(false);
    expect(isVerificationSeed('has space')).toBe(false);
    expect(isNeutralText('printable text')).toBe(true);
    expect(isNeutralText('')).toBe(false);
    expect(isNeutralText(`with\ttab\nnewline`)).toBe(true);
    expect(isNeutralText('bad\x00control')).toBe(false);
  });
});

describe('throwing validators', () => {
  it('toContentDigest rejects with INVALID_DIGEST', () => {
    expect(() => toContentDigest('xyz', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_DIGEST }),
    );
  });

  it('toVerificationId / toVerificationVersion / toVerificationTimestamp reject with typed codes', () => {
    expect(() => toVerificationId('BAD', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() => toVerificationVersion('1.x', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() => toVerificationTimestamp('nope', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP }),
    );
    expect(() => toNeutralText('', 'ctx')).toThrowError(
      expect.objectContaining({ code: VERIFICATION_ERROR_CODES.INVALID_OUTCOME }),
    );
  });
});

describe('expectFields (strict shape — additionalProperties: false)', () => {
  const REQUIRED = ['a', 'b'];

  it('accepts exact and optional-superset shapes', () => {
    expect(expectFields({ a: 1, b: 2 }, REQUIRED, [], VERIFICATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toEqual({
      a: 1,
      b: 2,
    });
    expect(expectFields({ a: 1, b: 2, c: 3 }, REQUIRED, ['c'], VERIFICATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toEqual({
      a: 1,
      b: 2,
      c: 3,
    });
  });

  it('rejects non-objects', () => {
    for (const bad of [null, undefined, 3, 'x', []]) {
      expect(() => expectFields(bad, REQUIRED, [], VERIFICATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toThrowError(
        VerificationError,
      );
    }
  });

  it('rejects missing required fields with the field name in details', () => {
    try {
      expectFields({ a: 1 }, REQUIRED, [], VERIFICATION_ERROR_CODES.INVALID_RECORD, 'ctx');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as VerificationError).code).toBe('VERIFICATION_INVALID_RECORD');
      expect((error as VerificationError).message).toContain("missing required field 'b'");
    }
  });

  it('rejects unknown fields — the construction-level no-extra-fields gate', () => {
    try {
      expectFields({ a: 1, b: 2, rogue: 0.87 }, REQUIRED, [], VERIFICATION_ERROR_CODES.INVALID_RECORD, 'ctx');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as VerificationError).code).toBe('VERIFICATION_INVALID_RECORD');
      expect((error as VerificationError).message).toContain("unknown field 'rogue'");
    }
  });
});

describe('expectEnumMember', () => {
  it('accepts members and rejects non-members with the closed list', () => {
    const members = ['pass', 'fail', 'unknown'] as const;
    expect(expectEnumMember('pass', members, 'outcome', VERIFICATION_ERROR_CODES.INVALID_OUTCOME, 'ctx')).toBe('pass');
    expect(() => expectEnumMember('excellent', members, 'outcome', VERIFICATION_ERROR_CODES.INVALID_OUTCOME, 'ctx')).toThrowError(
      /must be one of \[pass, fail, unknown\]/,
    );
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays', () => {
    const value = deepFreeze({ outer: { inner: [1, 2, { deep: true }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.outer)).toBe(true);
    expect(Object.isFrozen(value.outer.inner)).toBe(true);
    expect(Object.isFrozen((value.outer.inner as unknown[])[2])).toBe(true);
  });

  it('passes primitives through', () => {
    expect(deepFreeze(7)).toBe(7);
    expect(deepFreeze(null)).toBe(null);
  });
});
