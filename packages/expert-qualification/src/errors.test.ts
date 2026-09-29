/**
 * Error taxonomy tests (Work Order A007) — closed codes, categories,
 * structured wire form round-trips, strict parsing of malformed structs.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId } from '@arena/protocol-core';
import {
  EXPERT_QUALIFICATION_ERROR_CATEGORIES,
  EXPERT_QUALIFICATION_ERROR_CODES,
  ExpertQualificationError,
  categoryForExpertQualificationCode,
  fromExpertQualificationErrorStruct,
  isExpertQualificationError,
  isExpertQualificationErrorCode,
  normalizeToExpertQualificationError,
  toExpertQualificationErrorStruct,
} from './errors.js';
import { CORR_A } from './test-support.js';

describe('ExpertQualificationError', () => {
  it('every code maps to a declared category', () => {
    const codes = Object.values(EXPERT_QUALIFICATION_ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(20);
    for (const code of codes) {
      expect(EXPERT_QUALIFICATION_ERROR_CATEGORIES).toContain(
        categoryForExpertQualificationCode(code),
      );
      expect(isExpertQualificationErrorCode(code)).toBe(true);
    }
  });

  it('constructs with code, category and details; is an ExpertQualificationError', () => {
    const error = new ExpertQualificationError(
      EXPERT_QUALIFICATION_ERROR_CODES.INVALID_CLAIM,
      { message: 'bad claim', details: { field: 'evidence' }, correlationId: toCorrelationId(CORR_A) },
    );
    expect(error.name).toBe('ExpertQualificationError');
    expect(error.code).toBe('EXPERT_QUALIFICATION_INVALID_CLAIM');
    expect(error.category).toBe('validation');
    expect(isExpertQualificationError(error)).toBe(true);
    expect(isExpertQualificationError(new Error('plain'))).toBe(false);
  });

  it('round-trips the structured wire form', () => {
    const error = new ExpertQualificationError(EXPERT_QUALIFICATION_ERROR_CODES.TAMPERED, {
      message: 'digest mismatch',
      details: { expected: 'a', actual: 'b' },
      correlationId: toCorrelationId(CORR_A),
    });
    const struct = toExpertQualificationErrorStruct(error);
    const parsed = fromExpertQualificationErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe('integrity');
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual({ expected: 'a', actual: 'b' });
    expect(parsed.correlationId).toBe(CORR_A);
  });

  it('rejects malformed structured errors (adversarial)', () => {
    expect(() => fromExpertQualificationErrorStruct(null)).toThrow(ExpertQualificationError);
    expect(() => fromExpertQualificationErrorStruct('nope')).toThrow(ExpertQualificationError);
    expect(() => fromExpertQualificationErrorStruct({})).toThrow(/unknown or missing/);
    expect(() =>
      fromExpertQualificationErrorStruct({
        code: 'EXPERT_QUALIFICATION_NOT_A_CODE',
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(/unknown or missing expert-qualification error code/);
    expect(() =>
      fromExpertQualificationErrorStruct({
        code: 'EXPERT_QUALIFICATION_TAMPERED',
        category: 'validation', // wrong: integrity
        message: 'x',
      }),
    ).toThrow(/does not match code/);
    expect(() =>
      fromExpertQualificationErrorStruct({
        code: 'EXPERT_QUALIFICATION_TAMPERED',
        category: 'integrity',
        message: '',
      }),
    ).toThrow(/non-empty string/);
    expect(() =>
      fromExpertQualificationErrorStruct({
        code: 'EXPERT_QUALIFICATION_TAMPERED',
        category: 'integrity',
        message: 'x',
        details: [1, 2],
      }),
    ).toThrow(/details must be a plain object/);
  });

  it('normalizes foreign thrown values', () => {
    expect(
      normalizeToExpertQualificationError(new Error('boom')).code,
    ).toBe('EXPERT_QUALIFICATION_UNKNOWN_ERROR');
    expect(normalizeToExpertQualificationError(42).message).toBe('42');
    const original = new ExpertQualificationError(
      EXPERT_QUALIFICATION_ERROR_CODES.NOT_FOUND,
      { message: 'keep me' },
    );
    expect(normalizeToExpertQualificationError(original)).toBe(original);
  });
});
