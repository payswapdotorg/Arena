import { describe, expect, it } from 'vitest';
import { READ_MODEL_ERROR_CODES, ReadModelError } from './errors.js';
import {
  READ_MODEL_MAX_PAGE_SIZE,
  decodeContinuation,
  effectiveLimit,
  encodeByKindContinuation,
  encodeByTenantContinuation,
  encodeContinuation,
  validateReadQuery,
} from './queries.js';

describe('validateReadQuery', () => {
  it('accepts well-formed by-id queries', () => {
    const query = validateReadQuery({ kind: 'by-id', recordId: 'cap-1' });
    expect(query).toEqual({ kind: 'by-id', recordId: 'cap-1' });
    expect(Object.isFrozen(query)).toBe(true);
  });

  it('accepts well-formed by-kind and by-tenant queries', () => {
    expect(validateReadQuery({ kind: 'by-kind', recordKind: 'capability-case' })).toEqual({
      kind: 'by-kind',
      recordKind: 'capability-case',
    });
    expect(validateReadQuery({ kind: 'by-tenant', limit: 10, continuation: 'tok' })).toEqual({
      kind: 'by-tenant',
      limit: 10,
      continuation: 'tok',
    });
  });

  it('rejects non-objects and unknown query kinds', () => {
    expect(() => validateReadQuery(null)).toThrowError(ReadModelError);
    expect(() => validateReadQuery('by-id')).toThrowError(ReadModelError);
    expect(() => validateReadQuery({ kind: 'delete-everything' })).toThrowError(ReadModelError);
    expect(() => validateReadQuery({})).toThrowError(ReadModelError);
  });

  it('rejects empty recordId', () => {
    expect(() => validateReadQuery({ kind: 'by-id', recordId: '' })).toThrowError(ReadModelError);
  });

  it('rejects undisclosed record kinds', () => {
    let error: unknown;
    try {
      validateReadQuery({ kind: 'by-kind', recordKind: 'not-a-kind' });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_QUERY);
  });

  it('bounds page sizes (>= 1, <= max)', () => {
    expect(() => validateReadQuery({ kind: 'by-kind', recordKind: 'certification', limit: 0 }))
      .toThrowError(ReadModelError);
    expect(() => validateReadQuery({ kind: 'by-kind', recordKind: 'certification', limit: 1.5 }))
      .toThrowError(ReadModelError);
    let error: unknown;
    try {
      validateReadQuery({ kind: 'by-kind', recordKind: 'certification', limit: READ_MODEL_MAX_PAGE_SIZE + 1 });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_QUERY);
    expect(validateReadQuery({ kind: 'by-kind', recordKind: 'certification', limit: READ_MODEL_MAX_PAGE_SIZE }))
      .toMatchObject({ limit: READ_MODEL_MAX_PAGE_SIZE });
  });

  it('the query grammar has NO tenant field — tenant fields are rejected', () => {
    let error: unknown;
    try {
      validateReadQuery({ kind: 'by-id', recordId: 'cap-1', tenantId: 'tenant-a' });
    } catch (thrown) {
      error = thrown;
    }
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_QUERY);
    expect((error as ReadModelError).message).toContain('NO tenant field');
    expect(() =>
      validateReadQuery({ kind: 'by-tenant', tenantId: 'tenant-a' }),
    ).toThrowError(ReadModelError);
  });

  it('effectiveLimit defaults and honors bounded limits', () => {
    expect(effectiveLimit({})).toBe(50);
    expect(effectiveLimit({ limit: 25 })).toBe(25);
  });
});

describe('continuation tokens', () => {
  it('encodes deterministically (same state → same token)', () => {
    const a = encodeByKindContinuation('capability-case', 50);
    const b = encodeByKindContinuation('capability-case', 50);
    expect(a).toBe(b);
    expect(encodeByTenantContinuation(50)).not.toBe(a);
    expect(encodeByKindContinuation('certification', 50)).not.toBe(a);
    expect(encodeByKindContinuation('capability-case', 100)).not.toBe(a);
  });

  it('round-trips through decode with scope + kind validation', () => {
    const token = encodeByKindContinuation('capability-case', 50);
    const payload = decodeContinuation(token, 'by-kind', 'capability-case');
    expect(payload).toEqual({ v: 1, scope: 'by-kind', recordKind: 'capability-case', offset: 50 });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(decodeContinuation(encodeByTenantContinuation(10), 'by-tenant').offset).toBe(10);
  });

  it('rejects malformed tokens fail-closed', () => {
    expect(() => decodeContinuation('', 'by-kind', 'certification')).toThrowError(ReadModelError);
    expect(() => decodeContinuation('!!!not-base64!!!', 'by-kind', 'certification')).toThrowError(ReadModelError);
    expect(() => decodeContinuation(Buffer.from('[]').toString('base64url'), 'by-kind')).toThrowError(ReadModelError);
    expect(() => decodeContinuation(42, 'by-tenant')).toThrowError(ReadModelError);
  });

  it('rejects scope mismatches and kind mismatches', () => {
    const byKind = encodeByKindContinuation('certification', 10);
    let error: unknown;
    try {
      decodeContinuation(byKind, 'by-tenant');
    } catch (thrown) {
      error = thrown;
    }
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION);

    error = undefined;
    try {
      decodeContinuation(byKind, 'by-kind', 'agent-body');
    } catch (thrown) {
      error = thrown;
    }
    expect((error as ReadModelError).code).toBe(READ_MODEL_ERROR_CODES.INVALID_CONTINUATION);
  });

  it('rejects unsupported token versions and bad offsets', () => {
    const badVersion = Buffer.from(JSON.stringify({ v: 99, scope: 'by-tenant', offset: 0 }))
      .toString('base64url');
    expect(() => decodeContinuation(badVersion, 'by-tenant')).toThrowError(ReadModelError);

    const badOffset = Buffer.from(JSON.stringify({ v: 1, scope: 'by-tenant', offset: -3 }))
      .toString('base64url');
    expect(() => decodeContinuation(badOffset, 'by-tenant')).toThrowError(ReadModelError);

    expect(() => encodeContinuation({ v: 1, scope: 'by-tenant', offset: -1 })).toThrowError(ReadModelError);
    expect(() =>
      encodeContinuation({ v: 1, scope: 'by-kind', recordKind: 'nope', offset: 0 }),
    ).toThrowError(ReadModelError);
  });
});
