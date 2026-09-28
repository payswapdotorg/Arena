/**
 * Error taxonomy tests — closed codes, category mapping, wire-safe
 * struct round-trip, strict parsing (unknown codes REJECTED), positive
 * AND negative paths (Work Order A011 gate 11).
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId } from '@arena/protocol-core';
import {
  TRAJECTORY_ERROR_CATEGORIES,
  TRAJECTORY_ERROR_CODES,
  TrajectoryError,
  categoryForTrajectoryCode,
  fromTrajectoryErrorStruct,
  isTrajectoryError,
  isTrajectoryErrorCode,
  normalizeToTrajectoryError,
  toTrajectoryErrorStruct,
} from './errors.js';

describe('trajectory error taxonomy', () => {
  it('exposes a closed code set mapped to core categories', () => {
    const codes = Object.values(TRAJECTORY_ERROR_CODES);
    expect(codes.length).toBe(19);
    expect(new Set(codes).size).toBe(codes.length); // all distinct
    for (const code of codes) {
      expect(code.startsWith('TRAJECTORY_')).toBe(true);
      expect(TRAJECTORY_ERROR_CATEGORIES).toContain(categoryForTrajectoryCode(code));
    }
    expect(categoryForTrajectoryCode(TRAJECTORY_ERROR_CODES.TAMPERED)).toBe('integrity');
    expect(categoryForTrajectoryCode(TRAJECTORY_ERROR_CODES.INVALID_ENTRY)).toBe('validation');
    expect(categoryForTrajectoryCode(TRAJECTORY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION)).toBe(
      'versioning',
    );
    expect(categoryForTrajectoryCode(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR)).toBe('unknown');
  });

  it('recognizes known codes and rejects everything else', () => {
    expect(isTrajectoryErrorCode('TRAJECTORY_TAMPERED')).toBe(true);
    expect(isTrajectoryErrorCode('TRAJECTORY_NOT_A_CODE')).toBe(false);
    expect(isTrajectoryErrorCode('')).toBe(false);
    expect(isTrajectoryErrorCode(42)).toBe(false);
    expect(isTrajectoryErrorCode('ENVIRONMENT_TAMPERED')).toBe(false); // sibling namespace
  });

  it('constructs typed errors carrying code, category, details, correlation id', () => {
    const correlationId = toCorrelationId('corr-1');
    const error = new TrajectoryError(TRAJECTORY_ERROR_CODES.SEQUENCE_GAP, {
      message: 'gap',
      details: { expected: 3, actual: 5 },
      correlationId,
    });
    expect(error.name).toBe('TrajectoryError');
    expect(error.code).toBe('TRAJECTORY_SEQUENCE_GAP');
    expect(error.category).toBe('integrity');
    expect(error.details).toEqual({ expected: 3, actual: 5 });
    expect(error.correlationId).toBe(correlationId);
    expect(isTrajectoryError(error)).toBe(true);
    expect(isTrajectoryError(new Error('plain'))).toBe(false);
  });
});

describe('wire-safe struct round-trip', () => {
  it('round-trips a full error through the struct form', () => {
    const original = new TrajectoryError(TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED, {
      message: 'frozen',
      details: { sequence: 7 },
      correlationId: toCorrelationId('corr-2'),
    });
    const struct = toTrajectoryErrorStruct(original);
    expect(struct).toEqual({
      code: 'TRAJECTORY_ALREADY_COMPLETED',
      category: 'integrity',
      message: 'frozen',
      details: { sequence: 7 },
      correlationId: 'corr-2',
    });
    const parsed = fromTrajectoryErrorStruct(struct);
    expect(parsed.code).toBe(original.code);
    expect(parsed.category).toBe(original.category);
    expect(parsed.message).toBe(original.message);
    expect(parsed.details).toEqual(original.details);
  });

  it('round-trips a minimal error (optional fields absent)', () => {
    const parsed = fromTrajectoryErrorStruct({
      code: 'TRAJECTORY_NOT_FOUND',
      category: 'validation',
      message: 'missing',
    });
    expect(parsed.code).toBe('TRAJECTORY_NOT_FOUND');
    expect(parsed.details).toBeUndefined();
    expect(parsed.correlationId).toBeUndefined();
  });
});

describe('strict struct parsing (negative paths)', () => {
  it('rejects non-objects', () => {
    expect(() => fromTrajectoryErrorStruct('nope')).toThrowError(/malformed structured/);
    expect(() => fromTrajectoryErrorStruct(null)).toThrowError();
    expect(() => fromTrajectoryErrorStruct([1, 2])).toThrowError();
  });

  it('rejects unknown or missing codes', () => {
    expect(() =>
      fromTrajectoryErrorStruct({ code: 'TRAJECTORY_NOPE', category: 'validation', message: 'x' }),
    ).toThrowError(/unknown or missing trajectory error code/);
    expect(() => fromTrajectoryErrorStruct({ category: 'validation', message: 'x' })).toThrowError();
  });

  it('rejects category/code mismatches', () => {
    expect(() =>
      fromTrajectoryErrorStruct({
        code: 'TRAJECTORY_TAMPERED',
        category: 'validation', // wrong: tampered is integrity
        message: 'x',
      }),
    ).toThrowError(/does not match code/);
  });

  it('rejects empty messages and malformed optional fields', () => {
    expect(() =>
      fromTrajectoryErrorStruct({ code: 'TRAJECTORY_NOT_FOUND', category: 'validation', message: '' }),
    ).toThrowError(/non-empty string/);
    expect(() =>
      fromTrajectoryErrorStruct({
        code: 'TRAJECTORY_NOT_FOUND',
        category: 'validation',
        message: 'x',
        details: 'not-an-object',
      }),
    ).toThrowError(/details must be a plain object/);
    expect(() =>
      fromTrajectoryErrorStruct({
        code: 'TRAJECTORY_NOT_FOUND',
        category: 'validation',
        message: 'x',
        correlationId: 'not! a! correlation! id',
      }),
    ).toThrowError(/correlationId must be a valid correlation id/);
  });
});

describe('normalizeToTrajectoryError', () => {
  it('passes through trajectory errors unchanged', () => {
    const error = new TrajectoryError(TRAJECTORY_ERROR_CODES.INVALID_HEADER, { message: 'x' });
    expect(normalizeToTrajectoryError(error)).toBe(error);
  });

  it('wraps plain errors and thrown values', () => {
    const wrapped = normalizeToTrajectoryError(new Error('boom'));
    expect(wrapped.code).toBe('TRAJECTORY_UNKNOWN_ERROR');
    expect(wrapped.message).toBe('boom');
    const wrappedValue = normalizeToTrajectoryError('raw');
    expect(wrappedValue.code).toBe('TRAJECTORY_UNKNOWN_ERROR');
    expect(wrappedValue.message).toBe('raw');
  });
});
