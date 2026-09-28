/**
 * Shared scalar/guard tests (Work Order A012): positive AND negative
 * coverage for every branded scalar, converter and shape helper.
 */

import { describe, expect, it } from 'vitest';
import {
  CONTENT_DIGEST_PATTERN_SOURCE,
  EVALUATION_ID_PATTERN_SOURCE,
  EVALUATION_TIMESTAMP_PATTERN_SOURCE,
  EVALUATION_VERSION_PATTERN_SOURCE,
  NEUTRAL_ID_PATTERN_SOURCE,
  NEUTRAL_TEXT_PATTERN_SOURCE,
  SEED_PATTERN_SOURCE,
  expectEnumMember,
  expectFields,
  expectNumberInRange,
  expectPositiveInteger,
  isContentDigest,
  isEvaluationId,
  isEvaluationSeed,
  isEvaluationTimestamp,
  isEvaluationVersion,
  isNeutralId,
  isNeutralText,
  toContentDigest,
  toEvaluationId,
  toEvaluationSeed,
  toEvaluationTimestamp,
  toEvaluationVersion,
  toNeutralId,
  toNeutralText,
  toOutputSchemaRef,
} from './shared.js';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import { deepFreeze } from './shared.js';

const GOOD_DIGEST = 'a'.repeat(64);
const GOOD_ID = 'evaluator-000042';
const GOOD_TS = '2026-01-15T09:30:00.000Z';
const GOOD_SEED = 'seed-1234';
const GOOD_VERSION = '1.2.3';

describe('branded scalar guards (positive + negative)', () => {
  it('isContentDigest', () => {
    expect(isContentDigest(GOOD_DIGEST)).toBe(true);
    expect(isContentDigest('A'.repeat(64))).toBe(false); // uppercase rejected
    expect(isContentDigest('a'.repeat(63))).toBe(false); // short
    expect(isContentDigest('g'.repeat(64))).toBe(false); // non-hex
    expect(isContentDigest(123)).toBe(false);
    expect(isContentDigest(null)).toBe(false);
  });

  it('isEvaluationId / isNeutralId', () => {
    expect(isEvaluationId(GOOD_ID)).toBe(true);
    expect(isEvaluationId('a')).toBe(true); // single lowercase letter
    expect(isEvaluationId('A-bad')).toBe(false);
    expect(isEvaluationId('1-bad')).toBe(false);
    expect(isEvaluationId('-bad')).toBe(false);
    expect(isEvaluationId('x'.repeat(65))).toBe(false);
    expect(isEvaluationId(42)).toBe(false);
    expect(isNeutralId(GOOD_ID)).toBe(true);
    expect(isNeutralId('UPPER')).toBe(false);
  });

  it('isEvaluationTimestamp', () => {
    expect(isEvaluationTimestamp(GOOD_TS)).toBe(true);
    expect(isEvaluationTimestamp('2026-01-15T09:30:00.00Z')).toBe(false); // 2-digit ms
    expect(isEvaluationTimestamp('2026-01-15T09:30:00Z')).toBe(false); // no ms
    expect(isEvaluationTimestamp('2026-13-45T09:30:00.000Z')).toBe(false); // invalid date parts
    expect(isEvaluationTimestamp('not a timestamp')).toBe(false);
    expect(isEvaluationTimestamp(42)).toBe(false);
  });

  it('isEvaluationSeed', () => {
    expect(isEvaluationSeed(GOOD_SEED)).toBe(true);
    expect(isEvaluationSeed('a')).toBe(true);
    expect(isEvaluationSeed('-bad')).toBe(false); // leading dash rejected
    expect(isEvaluationSeed('x'.repeat(129))).toBe(false);
    expect(isEvaluationSeed(null)).toBe(false);
  });

  it('isEvaluationVersion', () => {
    expect(isEvaluationVersion(GOOD_VERSION)).toBe(true);
    expect(isEvaluationVersion('1.2.3-beta.1')).toBe(true); // prerelease allowed
    expect(isEvaluationVersion('1.2.3+build.5')).toBe(false); // no build metadata
    expect(isEvaluationVersion('1.2')).toBe(false);
    expect(isEvaluationVersion('v1.2.3')).toBe(false);
    expect(isEvaluationVersion('')).toBe(false);
  });

  it('isNeutralText', () => {
    expect(isNeutralText('plain description')).toBe(true);
    expect(isNeutralText('multi\nline\ttext')).toBe(true);
    expect(isNeutralText('')).toBe(false); // empty rejected
    expect(isNeutralText('x'.repeat(4097))).toBe(false);
    expect(isNeutralText('unicode — dash')).toBe(false); // non-ASCII rejected
    expect(isNeutralText(42)).toBe(false);
  });
});

describe('converters throw typed errors on malformed input (negative)', () => {
  it('toContentDigest', () => {
    expect(toContentDigest(GOOD_DIGEST, 'ctx')).toBe(GOOD_DIGEST);
    expect(() => toContentDigest('nope', 'ctx')).toThrowError(EvaluationError);
    expect(() => toContentDigest('nope', 'ctx')).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DIGEST }),
    );
  });

  it('toEvaluationId / toNeutralId', () => {
    expect(toEvaluationId(GOOD_ID, 'ctx')).toBe(GOOD_ID);
    expect(() => toEvaluationId('BAD', 'ctx')).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(toNeutralId(GOOD_ID, 'field')).toBe(GOOD_ID);
    expect(() => toNeutralId('BAD', 'field')).toThrowError(EvaluationError);
  });

  it('toEvaluationTimestamp', () => {
    expect(toEvaluationTimestamp(GOOD_TS, 'field')).toBe(GOOD_TS);
    expect(() => toEvaluationTimestamp('nope', 'field')).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_TIMESTAMP }),
    );
  });

  it('toEvaluationSeed', () => {
    expect(toEvaluationSeed(GOOD_SEED)).toBe(GOOD_SEED);
    expect(() => toEvaluationSeed('-bad')).toThrowError(EvaluationError);
  });

  it('toEvaluationVersion', () => {
    expect(toEvaluationVersion(GOOD_VERSION, 'field')).toBe(GOOD_VERSION);
    expect(() => toEvaluationVersion('1.2', 'field')).toThrowError(EvaluationError);
  });

  it('toNeutralText', () => {
    expect(toNeutralText('fine', 'field')).toBe('fine');
    expect(() => toNeutralText('', 'field')).toThrowError(EvaluationError);
  });

  it('toOutputSchemaRef rejects malformed refs (negative)', () => {
    expect(
      toOutputSchemaRef({ namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' }),
    ).toEqual({ namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' });
    expect(() =>
      toOutputSchemaRef({ namespace: 'Eval', name: 'record', version: '1.0.0' }),
    ).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_SCHEMA_REF }),
    );
    expect(() =>
      toOutputSchemaRef({ namespace: 'evaluation', name: 'record', version: '1.0.0-beta' }),
    ).toThrowError(EvaluationError);
  });
});

describe('pattern sources are exported for parity checks (positive)', () => {
  it('every declared pattern source is a stable string', () => {
    expect(CONTENT_DIGEST_PATTERN_SOURCE).toBe('^[0-9a-f]{64}$');
    expect(EVALUATION_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
    expect(NEUTRAL_ID_PATTERN_SOURCE).toBe('^[a-z][a-z0-9-]{0,63}$');
    expect(EVALUATION_TIMESTAMP_PATTERN_SOURCE).toBe(
      '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$',
    );
    expect(SEED_PATTERN_SOURCE).toBe('^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
    expect(EVALUATION_VERSION_PATTERN_SOURCE).toBe(
      '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$',
    );
    expect(NEUTRAL_TEXT_PATTERN_SOURCE).toBe('^[\\x20-\\x7E\\n\\t]{1,4096}$');
  });
});

describe('expectFields (strict shape enforcement)', () => {
  it('accepts objects with exactly the required fields (positive)', () => {
    const record = expectFields(
      { a: 1, b: 'x' },
      ['a', 'b'],
      [],
      EVALUATION_ERROR_CODES.INVALID_RECORD,
      'ctx',
    );
    expect(record['a']).toBe(1);
  });

  it('accepts optional fields when present (positive)', () => {
    expect(() =>
      expectFields({ a: 1, c: 2 }, ['a'], ['c'], EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).not.toThrow();
  });

  it('rejects non-objects (negative)', () => {
    for (const bad of [null, undefined, 42, 'str', [1], true]) {
      expect(() =>
        expectFields(bad, ['a'], [], EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
      ).toThrowError(/expected a plain object/);
    }
  });

  it('rejects missing required fields (negative)', () => {
    expect(() =>
      expectFields({ a: 1 }, ['a', 'b'], [], EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrowError(/missing required field 'b'/);
  });

  it('rejects unknown fields (negative)', () => {
    expect(() =>
      expectFields({ a: 1, z: 9 }, ['a'], [], EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrowError(/unknown field 'z'/);
  });
});

describe('expectPositiveInteger / expectNumberInRange / expectEnumMember', () => {
  it('positive integers accepted, everything else rejected', () => {
    expect(expectPositiveInteger(3, 'n', EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toBe(3);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '3', null]) {
      expect(() =>
        expectPositiveInteger(bad, 'n', EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
      ).toThrowError(/must be a positive integer/);
    }
  });

  it('range numbers accepted, out-of-range rejected', () => {
    expect(expectNumberInRange(0.5, 'c', 0, 1, EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toBe(0.5);
    expect(expectNumberInRange(1, 'c', 0, 1, EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx')).toBe(1);
    for (const bad of [-0.01, 1.01, Number.NaN, '0.5', null]) {
      expect(() =>
        expectNumberInRange(bad, 'c', 0, 1, EVALUATION_ERROR_CODES.INVALID_RECORD, 'ctx'),
      ).toThrowError(/must be a finite number in/);
    }
  });

  it('enum members accepted, unknown members rejected', () => {
    expect(
      expectEnumMember('rubric', ['deterministic-test', 'rubric'], 'kind', EVALUATION_ERROR_CODES.INVALID_KIND, 'ctx'),
    ).toBe('rubric');
    expect(() =>
      expectEnumMember('mystery', ['deterministic-test', 'rubric'], 'kind', EVALUATION_ERROR_CODES.INVALID_KIND, 'ctx'),
    ).toThrowError(/must be one of/);
  });
});

describe('deepFreeze', () => {
  it('freezes nested objects and arrays (gate 10)', () => {
    const frozen = deepFreeze({ outer: { inner: [1, 2] }, list: [{ x: 1 }] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.outer)).toBe(true);
    expect(Object.isFrozen(frozen.outer.inner)).toBe(true);
    expect(Object.isFrozen(frozen.list)).toBe(true);
    expect(Object.isFrozen(frozen.list[0])).toBe(true);
  });

  it('mutation attempts throw TypeError in strict mode (immutability negative)', () => {
    const frozen = deepFreeze({ a: 1 });
    const mutate = frozen as { a?: number };
    expect(() => {
      mutate['a'] = 2;
    }).toThrowError(TypeError);
    expect(frozen.a).toBe(1);
  });

  it('passes through primitives and already-frozen values', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('str')).toBe('str');
    expect(deepFreeze(null)).toBe(null);
    const preFrozen = Object.freeze({ x: 1 });
    expect(deepFreeze(preFrozen)).toBe(preFrozen);
  });
});
