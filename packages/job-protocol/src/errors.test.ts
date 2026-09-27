/**
 * JobError taxonomy — positive AND negative tests (gate 12): closed code
 * set, category mapping, structured wire form, strictly validating parser.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId } from '@arena/protocol-core';
import {
  categoryForJobCode,
  fromJobErrorStruct,
  isJobError,
  isJobErrorCode,
  JOB_ERROR_CATEGORIES,
  JOB_ERROR_CODES,
  JobError,
  normalizeToJobError,
  toJobErrorStruct,
} from './errors.js';

describe('errors — taxonomy (positive)', () => {
  it('every code maps to exactly one category from the core vocabulary', () => {
    for (const code of Object.values(JOB_ERROR_CODES)) {
      expect(JOB_ERROR_CATEGORIES).toContain(categoryForJobCode(code));
    }
    expect(categoryForJobCode(JOB_ERROR_CODES.TERMINAL_STATE)).toBe('validation');
    expect(categoryForJobCode(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN)).toBe('integrity');
    expect(categoryForJobCode(JOB_ERROR_CODES.IDENTITY_CONFLICT)).toBe('integrity');
    expect(categoryForJobCode(JOB_ERROR_CODES.UNSUPPORTED_RECORD_VERSION)).toBe('versioning');
    expect(categoryForJobCode(JOB_ERROR_CODES.INVALID_INPUT)).toBe('encoding');
  });

  it('recognizes its own codes and rejects foreign ones', () => {
    expect(isJobErrorCode('JOB_TERMINAL_STATE')).toBe(true);
    expect(isJobErrorCode('ARTIFACT_TAMPERED')).toBe(false);
    expect(isJobErrorCode(42)).toBe(false);
    expect(isJobErrorCode(undefined)).toBe(false);
  });

  it('round-trips through the structured wire form', () => {
    const error = new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_GAP, {
      message: 'gap',
      details: { expected: 3, actual: 5 },
      correlationId: toCorrelationId('corr-1'),
    });
    const struct = toJobErrorStruct(error);
    expect(struct.code).toBe('JOB_EVENT_SEQUENCE_GAP');
    expect(struct.category).toBe('integrity');
    expect(struct.details).toEqual({ expected: 3, actual: 5 });
    expect(struct.correlationId).toBe('corr-1');
    const parsed = fromJobErrorStruct(struct);
    expect(parsed.code).toBe(error.code);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
    expect(isJobError(parsed)).toBe(true);
    expect(isJobError(new Error('plain'))).toBe(false);
  });

  it('normalizes unknown thrown values', () => {
    expect(normalizeToJobError(new Error('boom')).code).toBe(JOB_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToJobError('boom').message).toBe('boom');
    const original = new JobError(JOB_ERROR_CODES.TAMPERED, { message: 'x' });
    expect(normalizeToJobError(original)).toBe(original);
  });
});

describe('errors — taxonomy (negative)', () => {
  it('rejects unknown / missing codes at parse time', () => {
    expect(() => fromJobErrorStruct({ code: 'JOB_MADE_UP', category: 'validation', message: 'x' })).toThrow(
      JobError,
    );
    expect(() =>
      fromJobErrorStruct({ category: 'validation', message: 'x' }),
    ).toThrow(JobError);
  });

  it('rejects category/code mismatches', () => {
    expect(() =>
      fromJobErrorStruct({
        code: 'JOB_TERMINAL_STATE',
        category: 'integrity',
        message: 'x',
      }),
    ).toThrow(JobError);
  });

  it('rejects malformed shapes (non-object, arrays, bad message, bad optionals)', () => {
    expect(() => fromJobErrorStruct(null)).toThrow(JobError);
    expect(() => fromJobErrorStruct('nope')).toThrow(JobError);
    expect(() => fromJobErrorStruct([1, 2])).toThrow(JobError);
    expect(() =>
      fromJobErrorStruct({ code: 'JOB_TAMPERED', category: 'integrity', message: '' }),
    ).toThrow(JobError);
    expect(() =>
      fromJobErrorStruct({ code: 'JOB_TAMPERED', category: 'integrity', message: 'x', details: 5 }),
    ).toThrow(JobError);
    expect(() =>
      fromJobErrorStruct({
        code: 'JOB_TAMPERED',
        category: 'integrity',
        message: 'x',
        correlationId: 'bad id!',
      }),
    ).toThrow(JobError);
  });

  it('a hypothetical extra code would not be recognized', () => {
    expect(isJobErrorCode('JOB_EVENT_SEQUENCE_REGRESSION')).toBe(false);
    expect(Object.keys(JOB_ERROR_CODES)).toHaveLength(20);
  });
});
