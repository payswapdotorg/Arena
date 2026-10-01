import { describe, expect, it } from 'vitest';
import {
  READ_MODEL_ERROR_CODES,
  ReadModelError,
  categoryForReadModelCode,
  fromReadModelErrorStruct,
  isReadModelErrorCode,
  isReadModelError,
  normalizeToReadModelError,
  toReadModelErrorStruct,
} from './errors.js';

describe('read-model error taxonomy', () => {
  it('exposes a closed code set with categories', () => {
    expect(categoryForReadModelCode(READ_MODEL_ERROR_CODES.KIND_MISMATCH)).toBe('validation');
    expect(categoryForReadModelCode(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION)).toBe('scope');
    expect(categoryForReadModelCode(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR)).toBe('unknown');
    // Tenant scope violation and not-found are DISTINCT codes.
    expect(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION).not.toBe(
      READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND,
    );
  });

  it('recognizes known codes and rejects unknown ones', () => {
    expect(isReadModelErrorCode('READ_MODEL_INVALID_QUERY')).toBe(true);
    expect(isReadModelErrorCode('NOPE')).toBe(false);
    expect(isReadModelErrorCode(42)).toBe(false);
  });

  it('round-trips through the wire-safe struct form', () => {
    const error = new ReadModelError(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
      message: 'record belongs to another tenant',
      details: { recordTenant: 'tenant-a', contextTenant: 'tenant-b' },
    });
    const struct = toReadModelErrorStruct(error);
    expect(struct.code).toBe('READ_MODEL_TENANT_SCOPE_VIOLATION');
    expect(struct.category).toBe('scope');
    expect(struct.details).toEqual({ recordTenant: 'tenant-a', contextTenant: 'tenant-b' });
    const restored = fromReadModelErrorStruct(struct);
    expect(restored.code).toBe(error.code);
    expect(restored.category).toBe(error.category);
    expect(restored.message).toBe(error.message);
  });

  it('parses structs fail-closed (unknown code, category mismatch, malformed)', () => {
    expect(() => fromReadModelErrorStruct({ code: 'NOPE', category: 'validation', message: 'x' }))
      .toThrowError(ReadModelError);
    expect(() =>
      fromReadModelErrorStruct({
        code: 'READ_MODEL_INVALID_QUERY',
        category: 'scope',
        message: 'x',
      }),
    ).toThrowError(ReadModelError);
    expect(() => fromReadModelErrorStruct(null)).toThrowError(ReadModelError);
    expect(() => fromReadModelErrorStruct('nope')).toThrowError(ReadModelError);
    expect(() =>
      fromReadModelErrorStruct({ code: 'READ_MODEL_INVALID_QUERY', category: 'validation', message: '' }),
    ).toThrowError(ReadModelError);
  });

  it('normalizes arbitrary thrown values into ReadModelError', () => {
    expect(normalizeToReadModelError(new Error('boom')).code).toBe(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalizeToReadModelError('nope').code).toBe(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR);
    const direct = new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_RECORD, { message: 'x' });
    expect(normalizeToReadModelError(direct)).toBe(direct);
  });

  it('identifies ReadModelError instances', () => {
    expect(isReadModelError(new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, { message: 'x' }))).toBe(true);
    expect(isReadModelError(new Error('x'))).toBe(false);
  });
});
