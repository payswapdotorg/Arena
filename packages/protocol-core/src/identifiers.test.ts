import { describe, expect, it } from 'vitest';
import {
  isCorrelationId,
  isIdempotencyKey,
  newCorrelationId,
  newIdempotencyKey,
  toCorrelationId,
  toIdempotencyKey,
} from './identifiers.js';
import { PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { ProtocolError } from './protocol-error.js';

describe('identifier guards (positive)', () => {
  it('accepts well-formed identifiers', () => {
    expect(isCorrelationId('abc')).toBe(true);
    expect(isCorrelationId('A1-b_2.3')).toBe(true);
    expect(isCorrelationId('a'.repeat(128))).toBe(true);
    expect(isIdempotencyKey('task-42.run-7')).toBe(true);
  });

  it('accepts generated identifiers', () => {
    expect(isCorrelationId(newCorrelationId())).toBe(true);
    expect(isIdempotencyKey(newIdempotencyKey())).toBe(true);
  });

  it('generates unique identifiers across many draws', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(newCorrelationId());
    expect(ids.size).toBe(1000);
  });
});

describe('identifier guards (negative)', () => {
  it('rejects empty, oversized, and badly charsetted strings', () => {
    expect(isCorrelationId('')).toBe(false);
    expect(isCorrelationId('a'.repeat(129))).toBe(false);
    expect(isCorrelationId('-leadingDash')).toBe(false);
    expect(isCorrelationId('.leadingDot')).toBe(false);
    expect(isCorrelationId('with space')).toBe(false);
    expect(isCorrelationId('with:colon')).toBe(false);
    expect(isCorrelationId('with/slash')).toBe(false);
    expect(isCorrelationId('héllo')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isCorrelationId(123)).toBe(false);
    expect(isCorrelationId(null)).toBe(false);
    expect(isCorrelationId(undefined)).toBe(false);
    expect(isCorrelationId({})).toBe(false);
    expect(isIdempotencyKey(42)).toBe(false);
  });

  it('toCorrelationId throws PROTOCOL_INVALID_CORRELATION_ID on bad input', () => {
    expect(() => toCorrelationId('')).toThrow(ProtocolError);
    try {
      toCorrelationId('bad id');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.INVALID_CORRELATION_ID);
      expect((error as ProtocolError).category).toBe('validation');
    }
  });

  it('toIdempotencyKey throws PROTOCOL_INVALID_IDEMPOTENCY_KEY on bad input', () => {
    expect(() => toIdempotencyKey('nope!')).toThrow(ProtocolError);
    try {
      toIdempotencyKey('nope!');
      expect.unreachable('must throw');
    } catch (error) {
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
    }
  });

  it('toCorrelationId/toIdempotencyKey return branded strings on valid input', () => {
    const id = toCorrelationId('case-123');
    expect(typeof id).toBe('string');
    expect(id).toBe('case-123');
    expect(toIdempotencyKey('run-9')).toBe('run-9');
  });
});
