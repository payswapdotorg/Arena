/**
 * Error taxonomy tests (Work Order A006) — positive and negative for the
 * closed code set, category mapping, structured wire form and the
 * strictly validating parser.
 */

import { describe, expect, it } from 'vitest';
import {
  EXPERT_ERROR_CATEGORIES,
  EXPERT_ERROR_CODES,
  ExpertRegistryError,
  categoryForExpertCode,
  fromExpertErrorStruct,
  isExpertErrorCode,
  isExpertRegistryError,
  normalizeToExpertRegistryError,
  toExpertErrorStruct,
} from './errors.js';

const ALL_CODES = Object.values(EXPERT_ERROR_CODES);

describe('expert error taxonomy (positive)', () => {
  it('exposes a closed, non-empty code set', () => {
    expect(ALL_CODES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(ALL_CODES).size).toBe(ALL_CODES.length);
  });

  it('every code maps to a known category', () => {
    for (const code of ALL_CODES) {
      expect(EXPERT_ERROR_CATEGORIES).toContain(categoryForExpertCode(code));
    }
  });

  it('lock-rule-9 screens map to the access category', () => {
    expect(categoryForExpertCode(EXPERT_ERROR_CODES.AUTHORITY_FIELD_REJECTED)).toBe('access');
    expect(categoryForExpertCode(EXPERT_ERROR_CODES.PII_FIELD_REJECTED)).toBe('access');
    expect(categoryForExpertCode(EXPERT_ERROR_CODES.CROSS_TENANT_ACCESS)).toBe('access');
  });

  it('recognizes every code and rejects unknown strings (negative)', () => {
    for (const code of ALL_CODES) expect(isExpertErrorCode(code)).toBe(true);
    expect(isExpertErrorCode('EXPERT_NOT_A_CODE')).toBe(false);
    expect(isExpertErrorCode(undefined)).toBe(false);
    expect(isExpertErrorCode(42)).toBe(false);
  });

  it('constructs an ExpertRegistryError with code, category, details', () => {
    const error = new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PROFILE, {
      message: 'broken profile',
      details: { field: 'competencies' },
    });
    expect(error instanceof Error).toBe(true);
    expect(isExpertRegistryError(error)).toBe(true);
    expect(error.code).toBe('EXPERT_INVALID_PROFILE');
    expect(error.category).toBe('validation');
    expect(error.details).toEqual({ field: 'competencies' });
  });

  it('round-trips the structured wire form', () => {
    const error = new ExpertRegistryError(EXPERT_ERROR_CODES.TAMPERED, {
      message: 'digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
    });
    const struct = toExpertErrorStruct(error);
    expect(struct.code).toBe('EXPERT_TAMPERED');
    expect(struct.category).toBe('integrity');
    expect(fromExpertErrorStruct(struct).message).toBe('digest mismatch');
  });

  it('normalizes foreign throwables into EXPERT_UNKNOWN_ERROR', () => {
    expect(normalizeToExpertRegistryError(new Error('boom')).code).toBe(
      EXPERT_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToExpertRegistryError('boom').message).toBe('boom');
    const already = new ExpertRegistryError(EXPERT_ERROR_CODES.EXPERT_NOT_FOUND, {
      message: 'nope',
    });
    expect(normalizeToExpertRegistryError(already)).toBe(already);
  });
});

describe('expert error structured parser (negative)', () => {
  it('rejects non-objects', () => {
    expect(() => fromExpertErrorStruct(null)).toThrow(ExpertRegistryError);
    expect(() => fromExpertErrorStruct('EXPERT_TAMPERED')).toThrow(ExpertRegistryError);
    expect(() => fromExpertErrorStruct([1, 2])).toThrow(ExpertRegistryError);
  });

  it('rejects unknown or missing codes', () => {
    expect(() =>
      fromExpertErrorStruct({ code: 'EXPERT_MADE_UP', category: 'validation', message: 'x' }),
    ).toThrow(/unknown or missing expert-registry error code/);
    expect(() => fromExpertErrorStruct({ category: 'validation', message: 'x' })).toThrow(
      ExpertRegistryError,
    );
  });

  it('rejects category/code mismatches', () => {
    expect(() =>
      fromExpertErrorStruct({
        code: EXPERT_ERROR_CODES.TAMPERED,
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(/does not match code/);
  });

  it('rejects empty messages and malformed optional fields', () => {
    expect(() =>
      fromExpertErrorStruct({ code: EXPERT_ERROR_CODES.INVALID_PROFILE, category: 'validation' }),
    ).toThrow(/message must be a non-empty string/);
    expect(() =>
      fromExpertErrorStruct({
        code: EXPERT_ERROR_CODES.INVALID_PROFILE,
        category: 'validation',
        message: 'x',
        details: ['not', 'an', 'object'],
      }),
    ).toThrow(/details must be a plain object/);
    expect(() =>
      fromExpertErrorStruct({
        code: EXPERT_ERROR_CODES.INVALID_PROFILE,
        category: 'validation',
        message: 'x',
        correlationId: 'not!an!identifier',
      }),
    ).toThrow(/correlationId must be a valid correlation id/);
  });
});
