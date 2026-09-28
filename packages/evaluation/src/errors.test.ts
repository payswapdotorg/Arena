/**
 * Evaluation protocol error taxonomy tests (Work Order A012):
 * positive AND negative coverage for every constructor/validator.
 */

import { describe, expect, it } from 'vitest';
import {
  EVALUATION_ERROR_CODES,
  EvaluationError,
  categoryForEvaluationCode,
  fromEvaluationErrorStruct,
  isEvaluationError,
  isEvaluationErrorCode,
  normalizeToEvaluationError,
  toEvaluationErrorStruct,
} from './errors.js';
import { toCorrelationId } from '@arena/protocol-core';

describe('EvaluationError codes', () => {
  it('exposes a closed, non-empty code set with unique values (positive)', () => {
    const codes = Object.values(EVALUATION_ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(20);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^EVALUATION_[A-Z0-9_]+$/);
    }
  });

  it('every code maps to a known category (positive)', () => {
    for (const code of Object.values(EVALUATION_ERROR_CODES)) {
      expect(categoryForEvaluationCode(code)).toMatch(/^(validation|encoding|versioning|integrity|unknown)$/);
    }
  });

  it('isEvaluationErrorCode accepts known codes and rejects unknown ones (positive + negative)', () => {
    expect(isEvaluationErrorCode(EVALUATION_ERROR_CODES.INVALID_KIND)).toBe(true);
    expect(isEvaluationErrorCode('EVALUATION_NOT_A_REAL_CODE')).toBe(false);
    expect(isEvaluationErrorCode(42)).toBe(false);
    expect(isEvaluationErrorCode(null)).toBe(false);
    expect(isEvaluationErrorCode(undefined)).toBe(false);
  });
});

describe('EvaluationError class', () => {
  it('carries code, category, details and correlation id (positive)', () => {
    const correlationId = toCorrelationId('corr-0001');
    const error = new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: 'bad criteria',
      details: { field: 'entries' },
      correlationId,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EvaluationError');
    expect(error.code).toBe('EVALUATION_INVALID_CRITERIA');
    expect(error.category).toBe('validation');
    expect(error.message).toBe('bad criteria');
    expect(error.details).toEqual({ field: 'entries' });
    expect(error.correlationId).toBe(correlationId);
    expect(isEvaluationError(error)).toBe(true);
  });

  it('optional fields stay absent when not supplied (positive)', () => {
    const error = new EvaluationError(EVALUATION_ERROR_CODES.NOT_FOUND, {
      message: 'missing evaluator',
    });
    expect(error.details).toBeUndefined();
    expect(error.correlationId).toBeUndefined();
  });

  it('isEvaluationError rejects foreign values (negative)', () => {
    expect(isEvaluationError(new Error('plain'))).toBe(false);
    expect(isEvaluationError('string')).toBe(false);
    expect(isEvaluationError(null)).toBe(false);
  });
});

describe('toEvaluationErrorStruct / fromEvaluationErrorStruct round trip', () => {
  it('round-trips code, category, message, details, correlation id (positive)', () => {
    const error = new EvaluationError(EVALUATION_ERROR_CODES.TAMPERED, {
      message: 'digest mismatch',
      details: { expected: 'a'.repeat(64), actual: 'b'.repeat(64) },
      correlationId: toCorrelationId('corr-0002'),
    });
    const struct = toEvaluationErrorStruct(error);
    expect(struct.code).toBe('EVALUATION_TAMPERED');
    expect(struct.category).toBe('integrity');
    const parsed = fromEvaluationErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
    expect(parsed.correlationId).toBe(error.correlationId);
  });

  it('rejects non-object input (negative)', () => {
    for (const bad of [null, undefined, 42, 'error', [], true]) {
      expect(() => fromEvaluationErrorStruct(bad)).toThrowError(EvaluationError);
    }
  });

  it('rejects unknown codes (negative)', () => {
    expect(() =>
      fromEvaluationErrorStruct({ code: 'EVALUATION_MADE_UP', category: 'validation', message: 'x' }),
    ).toThrowError(/unknown or missing evaluation error code/);
  });

  it('rejects category/code mismatch (negative)', () => {
    expect(() =>
      fromEvaluationErrorStruct({
        code: EVALUATION_ERROR_CODES.TAMPERED,
        category: 'validation', // integrity is correct
        message: 'x',
      }),
    ).toThrowError(/does not match code/);
  });

  it('rejects missing/empty message (negative)', () => {
    expect(() =>
      fromEvaluationErrorStruct({
        code: EVALUATION_ERROR_CODES.NOT_FOUND,
        category: 'validation',
        message: '',
      }),
    ).toThrowError(/message must be a non-empty string/);
  });

  it('rejects malformed optional fields (negative)', () => {
    expect(() =>
      fromEvaluationErrorStruct({
        code: EVALUATION_ERROR_CODES.NOT_FOUND,
        category: 'validation',
        message: 'x',
        details: ['not', 'an', 'object'],
      }),
    ).toThrowError(/details must be a plain object/);
    expect(() =>
      fromEvaluationErrorStruct({
        code: EVALUATION_ERROR_CODES.NOT_FOUND,
        category: 'validation',
        message: 'x',
        correlationId: 'invalid id with spaces!',
      }),
    ).toThrowError(/correlationId must be a valid/);
  });
});

describe('normalizeToEvaluationError', () => {
  it('passes through EvaluationErrors (positive)', () => {
    const error = new EvaluationError(EVALUATION_ERROR_CODES.UNKNOWN_ERROR, { message: 'x' });
    expect(normalizeToEvaluationError(error)).toBe(error);
  });

  it('wraps foreign Errors and primitives (positive)', () => {
    const wrapped = normalizeToEvaluationError(new Error('boom'));
    expect(wrapped.code).toBe(EVALUATION_ERROR_CODES.UNKNOWN_ERROR);
    expect(wrapped.message).toBe('boom');
    const wrappedPrimitive = normalizeToEvaluationError('oops');
    expect(wrappedPrimitive.code).toBe(EVALUATION_ERROR_CODES.UNKNOWN_ERROR);
    expect(wrappedPrimitive.message).toBe('oops');
  });
});
