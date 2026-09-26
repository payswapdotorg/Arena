import { describe, expect, it } from 'vitest';
import { toCorrelationId } from './identifiers.js';
import {
  categoryForCode,
  fromStructured,
  isProtocolError,
  isProtocolErrorCode,
  normalizeUnknownError,
  PROTOCOL_ERROR_CATEGORIES,
  PROTOCOL_ERROR_CODES,
  ProtocolError,
  toStructured,
} from './protocol-error.js';

describe('taxonomy (positive)', () => {
  it('every code maps to a category', () => {
    const codes = Object.values(PROTOCOL_ERROR_CODES);
    expect(codes).toHaveLength(12);
    for (const code of codes) {
      expect(PROTOCOL_ERROR_CATEGORIES).toContain(categoryForCode(code));
    }
  });

  it('representative codes map to the designed categories', () => {
    expect(categoryForCode(PROTOCOL_ERROR_CODES.INVALID_JSON)).toBe('encoding');
    expect(categoryForCode(PROTOCOL_ERROR_CODES.UNSUPPORTED_VERSION)).toBe('versioning');
    expect(categoryForCode(PROTOCOL_ERROR_CODES.INVALID_ENVELOPE)).toBe('validation');
    expect(categoryForCode(PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED)).toBe('integrity');
    expect(categoryForCode(PROTOCOL_ERROR_CODES.UNCLASSIFIED_ERROR)).toBe('unknown');
  });

  it('code guard accepts known codes only', () => {
    expect(isProtocolErrorCode('PROTOCOL_INVALID_JSON')).toBe(true);
    expect(isProtocolErrorCode('TOTALLY_FAKE')).toBe(false);
    expect(isProtocolErrorCode(42)).toBe(false);
    expect(isProtocolErrorCode(undefined)).toBe(false);
  });

  it('constructs a typed error carrying code, category and cause', () => {
    const cause = new Error('inner');
    const error = new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: 'bad ref',
      details: { ref: 'nope' },
      correlationId: toCorrelationId('case-1'),
      cause,
    });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ProtocolError');
    expect(error.code).toBe('PROTOCOL_INVALID_SCHEMA_REF');
    expect(error.category).toBe('validation');
    expect(error.details).toEqual({ ref: 'nope' });
    expect(error.correlationId).toBe('case-1');
    expect(error.cause).toBe(cause);
  });

  it('structured form round-trips through fromStructured', () => {
    const error = new ProtocolError(PROTOCOL_ERROR_CODES.ENVELOPE_TAMPERED, {
      message: 'digest mismatch',
      details: { expected: 'aa', actual: 'bb' },
    });
    const revived = fromStructured(JSON.parse(JSON.stringify(toStructured(error))));
    expect(revived.code).toBe(error.code);
    expect(revived.category).toBe(error.category);
    expect(revived.message).toBe(error.message);
    expect(revived.details).toEqual(error.details);
  });

  it('structured form omits optional fields when absent', () => {
    const error = new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_JSON, { message: 'x' });
    const struct = toStructured(error);
    expect('details' in struct).toBe(false);
    expect('correlationId' in struct).toBe(false);
  });

  it('normalizeUnknownError passes ProtocolError through', () => {
    const error = new ProtocolError(PROTOCOL_ERROR_CODES.UNKNOWN_SCHEMA, { message: 'x' });
    expect(normalizeUnknownError(error)).toBe(error);
  });

  it('normalizeUnknownError wraps foreign errors and primitives', () => {
    const wrapped = normalizeUnknownError(new Error('boom'));
    expect(wrapped.code).toBe(PROTOCOL_ERROR_CODES.UNCLASSIFIED_ERROR);
    expect(wrapped.message).toBe('boom');
    expect(wrapped.cause).toBeInstanceOf(Error);

    const fromString = normalizeUnknownError('nope');
    expect(fromString.code).toBe(PROTOCOL_ERROR_CODES.UNCLASSIFIED_ERROR);
    expect(fromString.message).toBe('nope');
  });
});

describe('taxonomy (negative — malformed structured errors must fail)', () => {
  const expectMalformed = (value: unknown, detail: string): void => {
    try {
      fromStructured(value);
      expect.unreachable(detail);
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.UNKNOWN_ERROR_CODE);
    }
  };

  it('rejects non-objects', () => {
    expectMalformed(null, 'null must fail');
    expectMalformed('PROTOCOL_INVALID_JSON', 'strings must fail');
    expectMalformed(5, 'numbers must fail');
    expectMalformed([toStructured(new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_JSON, { message: 'x' }))], 'arrays must fail');
  });

  it('rejects unknown or missing codes', () => {
    expectMalformed({ code: 'NOT_A_REAL_CODE', category: 'unknown', message: 'x' }, 'unknown code');
    expectMalformed({ category: 'unknown', message: 'x' }, 'missing code');
  });

  it('rejects category/code mismatches', () => {
    expectMalformed(
      { code: 'PROTOCOL_INVALID_JSON', category: 'validation', message: 'x' },
      'wrong category',
    );
  });

  it('rejects missing or empty messages', () => {
    expectMalformed({ code: 'PROTOCOL_INVALID_JSON', category: 'encoding' }, 'missing message');
    expectMalformed({ code: 'PROTOCOL_INVALID_JSON', category: 'encoding', message: '' }, 'empty message');
  });

  it('rejects invalid optional fields', () => {
    expectMalformed(
      { code: 'PROTOCOL_INVALID_JSON', category: 'encoding', message: 'x', details: 'not-an-object' },
      'details must be an object',
    );
    expectMalformed(
      { code: 'PROTOCOL_INVALID_JSON', category: 'encoding', message: 'x', correlationId: 'bad id!' },
      'correlationId must be valid',
    );
  });

  it('isProtocolError recognizes only real ProtocolError instances', () => {
    expect(isProtocolError(new ProtocolError(PROTOCOL_ERROR_CODES.INVALID_JSON, { message: 'x' }))).toBe(true);
    expect(isProtocolError(new Error('plain'))).toBe(false);
    expect(isProtocolError('PROTOCOL_INVALID_JSON')).toBe(false);
  });
});
