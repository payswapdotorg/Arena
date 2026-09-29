/**
 * Error taxonomy tests - closed codes, category mapping, strict parse.
 */

import { describe, expect, it } from 'vitest';
import {
  LEARNING_ERROR_CODES,
  LEARNING_ERROR_CATEGORIES,
  LearningError,
  fromLearningErrorStruct,
  isLearningError,
  isLearningErrorCode,
  normalizeToLearningError,
  toLearningErrorStruct,
} from './errors.js';

describe('learning error taxonomy', () => {
  it('codes are unique and non-empty', () => {
    const values = Object.values(LEARNING_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) {
      expect(value.startsWith('LEARNING_')).toBe(true);
      expect(value.length > 'LEARNING_'.length).toBe(true);
    }
  });

  it('categories are the closed five', () => {
    expect([...LEARNING_ERROR_CATEGORIES]).toEqual([
      'validation',
      'encoding',
      'versioning',
      'integrity',
      'unknown',
    ]);
  });

  it('constructs typed errors with category mapping', () => {
    const error = new LearningError(LEARNING_ERROR_CODES.REWRITE_ATTEMPT, {
      message: 'boundary violation',
      details: { artifact: 'x' },
    });
    expect(error.name).toBe('LearningError');
    expect(error.code).toBe('LEARNING_REWRITE_ATTEMPT');
    expect(error.category).toBe('integrity');
    expect(isLearningError(error)).toBe(true);
    expect(isLearningError(new Error('no'))).toBe(false);
  });

  it('round-trips through the struct form', () => {
    const error = new LearningError(LEARNING_ERROR_CODES.METRIC_MISMATCH, {
      message: 'undeclared metric',
      details: { metricId: 'm-1' },
    });
    const struct = toLearningErrorStruct(error);
    expect(struct.code).toBe('LEARNING_METRIC_MISMATCH');
    expect(struct.category).toBe('validation');
    const parsed = fromLearningErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
  });

  it('REJECTS unknown codes at parse time', () => {
    expect(() =>
      fromLearningErrorStruct({ code: 'LEARNING_NOT_A_CODE', category: 'validation', message: 'x' }),
    ).toThrow(/unknown or missing learning error code/);
  });

  it('REJECTS category/code mismatch at parse time', () => {
    expect(() =>
      fromLearningErrorStruct({
        code: LEARNING_ERROR_CODES.TAMPERED,
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(/does not match code/);
  });

  it('REJECTS malformed structs', () => {
    expect(() => fromLearningErrorStruct(null)).toThrow(/plain object/);
    expect(() => fromLearningErrorStruct([])).toThrow(/plain object/);
    expect(() =>
      fromLearningErrorStruct({ code: LEARNING_ERROR_CODES.NOT_FOUND, category: 'validation' }),
    ).toThrow(/message/);
  });

  it('normalizes arbitrary thrown values', () => {
    expect(normalizeToLearningError('boom').code).toBe(LEARNING_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToLearningError(new Error('boom')).message).toBe('boom');
    const typed = new LearningError(LEARNING_ERROR_CODES.NOT_FOUND, { message: 'nf' });
    expect(normalizeToLearningError(typed)).toBe(typed);
  });

  it('isLearningErrorCode accepts only known codes', () => {
    expect(isLearningErrorCode(LEARNING_ERROR_CODES.TAMPERED)).toBe(true);
    expect(isLearningErrorCode('LEARNING_NOT_A_REAL_CODE')).toBe(false);
    expect(isLearningErrorCode(42)).toBe(false);
  });
});
