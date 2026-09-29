/**
 * Shared view types + guards tests (Work Order A023).
 */

import { describe, expect, it } from 'vitest';
import {
  CERTIFICATION_ID_PATTERN_SOURCE,
  CONTENT_DIGEST_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  CERTIFICATION_TIMESTAMP_PATTERN_SOURCE,
  CERTIFICATION_VERSION_PATTERN_SOURCE,
  isCertificationId,
  isCertificationTimestamp,
  isCertificationVersion,
  isContentDigest,
  isNeutralId,
  isNeutralText,
  isSuiteRevision,
  toCertificationId,
  toCertificationTimestamp,
  toCertificationVersion,
  toContentDigest,
  toNeutralId,
  toNeutralText,
  toSuiteRevision,
  expectFields,
  expectEnumMember,
  deepFreeze,
} from './shared.js';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';

describe('pattern sources (mirror @arena/agent-body / @arena/protocol-core constants)', () => {
  it('mirrors the content-digest pattern source', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
  });
  it('mirrors the certification-id pattern source', () => {
    expect(CERTIFICATION_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
  it('mirrors the neutral-id pattern source', () => {
    expect(NEUTRAL_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
  });
  it('mirrors the timestamp pattern source', () => {
    expect(CERTIFICATION_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
  });
  it('mirrors the version pattern source', () => {
    expect(CERTIFICATION_VERSION_PATTERN_SOURCE).toBe(
      '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
    );
  });
  it('mirrors the neutral-text pattern source', () => {
    expect(NEUTRAL_TEXT_PATTERN_SOURCE).toBe('^[\\x20-\\x7E\\n\\t]{1,4096}$');
  });
});

describe('branded-scalar guards', () => {
  it('accepts a lowercase sha256 hex string as a content digest', () => {
    expect(isContentDigest('0'.repeat(64))).toBe(true);
    expect(isContentDigest('a'.repeat(64))).toBe(true);
    expect(isContentDigest('X'.repeat(64))).toBe(false);
    expect(isContentDigest('0'.repeat(63))).toBe(false);
    expect(isContentDigest(42)).toBe(false);
  });
  it('accepts a valid certification id (lowercase neutral identifier)', () => {
    expect(isCertificationId('suite-reference-0001')).toBe(true);
    expect(isCertificationId('Suite-Reference')).toBe(false); // uppercase
    expect(isCertificationId('')).toBe(false);
    expect(isCertificationId('x'.repeat(65))).toBe(false);
  });
  it('accepts a valid neutral id', () => {
    expect(isNeutralId('arena-reference-fabric')).toBe(true);
    expect(isNeutralId('Arena')).toBe(false);
  });
  it('accepts a valid ms-precision UTC timestamp', () => {
    expect(isCertificationTimestamp('2026-02-01T10:00:00.000Z')).toBe(true);
    expect(isCertificationTimestamp('2026-02-01T10:00:00Z')).toBe(false); // missing ms
    expect(isCertificationTimestamp('not-a-date')).toBe(false);
  });
  it('accepts a valid semver version', () => {
    expect(isCertificationVersion('1.0.0')).toBe(true);
    expect(isCertificationVersion('1.0.0-rc.1')).toBe(true);
    expect(isCertificationVersion('1.0')).toBe(false);
    expect(isCertificationVersion('v1.0.0')).toBe(false);
  });
  it('accepts valid neutral text', () => {
    expect(isNeutralText('hello world')).toBe(true);
    expect(isNeutralText('')).toBe(false);
    expect(isNeutralText('line\nbreak\ttab')).toBe(true);
    expect(isNeutralText('null\x00byte')).toBe(false);
  });
  it('suiteRevision uses the sha256-hex pattern', () => {
    expect(isSuiteRevision('0'.repeat(64))).toBe(true);
    expect(isSuiteRevision('0'.repeat(63))).toBe(false);
  });
});

describe('branded-scalar constructors (fail-closed)', () => {
  it('toContentDigest throws on malformed input', () => {
    expect(() => toContentDigest('X'.repeat(64), 'test')).toThrowError(CertificationError);
    try {
      toContentDigest('bad', 'test');
    } catch (error) {
      expect((error as CertificationError).code).toBe(
        CERTIFICATION_ERROR_CODES.INVALID_DIGEST,
      );
    }
  });
  it('toCertificationId throws on malformed input', () => {
    expect(() => toCertificationId('UPPER', 'test')).toThrowError(CertificationError);
  });
  it('toNeutralId throws on malformed input', () => {
    expect(() => toNeutralId('UPPER', 'test')).toThrowError(CertificationError);
  });
  it('toCertificationTimestamp throws on malformed input', () => {
    expect(() => toCertificationTimestamp('bad', 'test')).toThrowError(CertificationError);
  });
  it('toCertificationVersion throws on malformed input', () => {
    expect(() => toCertificationVersion('v1', 'test')).toThrowError(CertificationError);
  });
  it('toNeutralText throws on malformed input', () => {
    expect(() => toNeutralText('', 'test')).toThrowError(CertificationError);
  });
  it('toSuiteRevision throws on malformed input', () => {
    expect(() => toSuiteRevision('bad', 'test')).toThrowError(CertificationError);
  });
});

describe('expectFields (strict shape enforcement)', () => {
  it('accepts a plain object with exactly the required fields', () => {
    const record = expectFields(
      { a: 1, b: 'two' },
      ['a', 'b'],
      [],
      CERTIFICATION_ERROR_CODES.INVALID_RECORD,
      'test',
    );
    expect(record['a']).toBe(1);
    expect(record['b']).toBe('two');
  });
  it('rejects a missing required field', () => {
    expect(() =>
      expectFields(
        { a: 1 },
        ['a', 'b'],
        [],
        CERTIFICATION_ERROR_CODES.INVALID_RECORD,
        'test',
      ),
    ).toThrowError(CertificationError);
  });
  it('rejects an unknown field', () => {
    expect(() =>
      expectFields(
        { a: 1, b: 2, c: 3 },
        ['a', 'b'],
        [],
        CERTIFICATION_ERROR_CODES.INVALID_RECORD,
        'test',
      ),
    ).toThrowError(CertificationError);
  });
  it('accepts optional fields', () => {
    const record = expectFields(
      { a: 1, c: 3 },
      ['a'],
      ['c'],
      CERTIFICATION_ERROR_CODES.INVALID_RECORD,
      'test',
    );
    expect(record['c']).toBe(3);
  });
  it('rejects a non-object', () => {
    expect(() =>
      expectFields(
        null,
        ['a'],
        [],
        CERTIFICATION_ERROR_CODES.INVALID_RECORD,
        'test',
      ),
    ).toThrowError(CertificationError);
  });
});

describe('expectEnumMember (closed enum guard)', () => {
  it('accepts a known member', () => {
    const v = expectEnumMember(
      'pass',
      ['pass', 'fail'] as const,
      'verdict',
      CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
      'test',
    );
    expect(v).toBe('pass');
  });
  it('rejects an unknown member', () => {
    expect(() =>
      expectEnumMember(
        'bad',
        ['pass', 'fail'] as const,
        'verdict',
        CERTIFICATION_ERROR_CODES.INVALID_VERDICT,
        'test',
      ),
    ).toThrowError(CertificationError);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects', () => {
    const v = deepFreeze({ a: 1, b: { c: 2 } });
    expect(Object.isFrozen(v)).toBe(true);
    expect(Object.isFrozen(v.b)).toBe(true);
  });
  it('does not freeze primitives', () => {
    expect(deepFreeze(42)).toBe(42);
  });
});
