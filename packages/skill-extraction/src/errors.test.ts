/**
 * Error taxonomy + shared guard tests (Work Order A019): closed code
 * sets, category mapping, strict struct parsing, branded guards and
 * strict shape enforcement.
 */

import { describe, expect, it } from 'vitest';
import {
  SKILL_EXTRACTION_ERROR_CODES,
  SkillExtractionError,
  categoryForSkillExtractionCode,
  fromSkillExtractionErrorStruct,
  isSkillExtractionError,
  normalizeToSkillExtractionError,
  toSkillExtractionErrorStruct,
} from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isContentDigest,
  isNeutralText,
  isSkillExtractionId,
  isSkillExtractionTimestamp,
  isSkillExtractionVersion,
  toContentDigest,
  toNeutralId,
  toSkillExtractionId,
  toSkillExtractionTimestamp,
  toSkillExtractionVersion,
  toNeutralText,
} from './shared.js';

describe('error taxonomy', () => {
  it('every code has a category and codes are unique', () => {
    const codes = Object.values(SKILL_EXTRACTION_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(typeof categoryForSkillExtractionCode(code)).toBe('string');
    }
  });

  it('round-trips through the structured wire form', () => {
    const error = new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.UNVALIDATED_TRAJECTORY, {
      message: 'no verification evidence',
      details: { trajectoryId: 'trajectory-0001' },
    });
    const struct = toSkillExtractionErrorStruct(error);
    expect(struct.code).toBe('SKILL_EXTRACTION_UNVALIDATED_TRAJECTORY');
    expect(struct.category).toBe('validation');
    const parsed = fromSkillExtractionErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('REJECTS malformed structs (unknown code, category mismatch, missing message)', () => {
    expect(() => fromSkillExtractionErrorStruct({ code: 'NOPE', category: 'validation', message: 'x' })).toThrow(
      SkillExtractionError,
    );
    expect(() =>
      fromSkillExtractionErrorStruct({
        code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
        category: 'validation', // integrity is the real category
        message: 'x',
      }),
    ).toThrow(SkillExtractionError);
    expect(() =>
      fromSkillExtractionErrorStruct({
        code: SKILL_EXTRACTION_ERROR_CODES.TAMPERED,
        category: 'integrity',
        message: '',
      }),
    ).toThrow(SkillExtractionError);
    expect(() => fromSkillExtractionErrorStruct(null)).toThrow(SkillExtractionError);
  });

  it('normalizes foreign thrown values', () => {
    expect(normalizeToSkillExtractionError(new Error('boom'))).toBeInstanceOf(SkillExtractionError);
    expect(normalizeToSkillExtractionError('plain')).toBeInstanceOf(SkillExtractionError);
    const typed = new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.NOT_FOUND, {
      message: 'x',
    });
    expect(normalizeToSkillExtractionError(typed)).toBe(typed);
    expect(isSkillExtractionError(typed)).toBe(true);
    expect(isSkillExtractionError(new Error('x'))).toBe(false);
  });
});

describe('shared guards', () => {
  it('content digests: accepts sha256 hex, rejects everything else', () => {
    const good = 'a'.repeat(64);
    expect(isContentDigest(good)).toBe(true);
    expect(toContentDigest(good, 'ctx')).toBe(good);
    expect(isContentDigest('A'.repeat(64))).toBe(false); // uppercase rejected
    expect(isContentDigest('a'.repeat(63))).toBe(false);
    expect(() => toContentDigest('nope', 'ctx')).toThrow(SkillExtractionError);
  });

  it('neutral ids and skill-extraction ids share the closed charset', () => {
    expect(isSkillExtractionId('skill-abc123')).toBe(true);
    expect(isSkillExtractionId('Bad_Id')).toBe(false);
    expect(toNeutralId('tenant-a', 'field')).toBe('tenant-a');
    expect(() => toNeutralId('BAD', 'field')).toThrow(SkillExtractionError);
    expect(() => toSkillExtractionId('BAD', 'ctx')).toThrow(SkillExtractionError);
  });

  it('timestamps: ms-precision UTC only', () => {
    expect(isSkillExtractionTimestamp('2026-03-01T08:00:00.000Z')).toBe(true);
    expect(isSkillExtractionTimestamp('2026-03-01T08:00:00Z')).toBe(false);
    expect(isSkillExtractionTimestamp('not-a-time')).toBe(false);
    expect(() => toSkillExtractionTimestamp('2026-03-01T08:00:00Z', 'f')).toThrow(
      SkillExtractionError,
    );
  });

  it('versions: semver without build metadata', () => {
    expect(isSkillExtractionVersion('1.0.0')).toBe(true);
    expect(isSkillExtractionVersion('1.0.0-rc.1')).toBe(true);
    expect(isSkillExtractionVersion('1.0.0+build')).toBe(false);
    expect(() => toSkillExtractionVersion('1.x', 'f')).toThrow(SkillExtractionError);
  });

  it('neutral text: printable ASCII, 1..4096', () => {
    expect(isNeutralText('hello')).toBe(true);
    expect(isNeutralText('')).toBe(false);
    expect(isNeutralText('a'.repeat(4097))).toBe(false);
    expect(() => toNeutralText('', 'f')).toThrow(SkillExtractionError);
  });

  it('expectFields enforces strict shapes (missing + unknown rejected)', () => {
    expectFields({ a: 1, b: 2 }, ['a'], ['b'], SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx');
    expect(() =>
      expectFields({ a: 1 }, ['a', 'b'], [], SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrow(SkillExtractionError);
    expect(() =>
      expectFields({ a: 1, c: 3 }, ['a'], [], SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrow(SkillExtractionError);
    expect(() =>
      expectFields(null, ['a'], [], SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrow(SkillExtractionError);
  });

  it('expectEnumMember rejects non-members', () => {
    expect(
      expectEnumMember('pass', ['pass', 'fail'], 'f', SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toBe('pass');
    expect(() =>
      expectEnumMember('maybe', ['pass', 'fail'], 'f', SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, 'ctx'),
    ).toThrow(SkillExtractionError);
  });

  it('deepFreeze freezes recursively and is idempotent', () => {
    const value = deepFreeze({ a: { b: [1, 2] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(deepFreeze(value)).toBe(value);
  });
});
