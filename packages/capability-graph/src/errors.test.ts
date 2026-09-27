/**
 * Error taxonomy tests — positive and negative (Work Order A004).
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_GRAPH_ERROR_CATEGORIES,
  CAPABILITY_GRAPH_ERROR_CODES,
  CapabilityGraphError,
  categoryForCapabilityGraphCode,
  fromCapabilityGraphErrorStruct,
  isCapabilityGraphError,
  isCapabilityGraphErrorCode,
  normalizeToCapabilityGraphError,
  toCapabilityGraphErrorStruct,
} from './errors.js';

describe('capability-graph error taxonomy (positive)', () => {
  it('every code maps to a category and categories are the core vocabulary', () => {
    expect([...CAPABILITY_GRAPH_ERROR_CATEGORIES].sort()).toEqual([
      'encoding',
      'integrity',
      'unknown',
      'validation',
      'versioning',
    ]);
    for (const code of Object.values(CAPABILITY_GRAPH_ERROR_CODES)) {
      expect(CAPABILITY_GRAPH_ERROR_CATEGORIES).toContain(
        categoryForCapabilityGraphCode(code),
      );
    }
  });

  it('constructs a structured error and round-trips it', () => {
    const error = new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.CYCLE_DETECTED, {
      message: 'cycle detected: a -> b -> a',
      details: { path: ['a', 'b', 'a'] },
    });
    expect(error.name).toBe('CapabilityGraphError');
    expect(error.code).toBe('CAPABILITY_GRAPH_CYCLE_DETECTED');
    expect(error.category).toBe('integrity');
    const structured = toCapabilityGraphErrorStruct(error);
    expect(structured.message).toBe('cycle detected: a -> b -> a');
    expect(structured.details).toEqual({ path: ['a', 'b', 'a'] });
    const roundTripped = fromCapabilityGraphErrorStruct(structured);
    expect(roundTripped.code).toBe(error.code);
    expect(roundTripped.message).toBe(error.message);
  });

  it('recognizes known codes and instances', () => {
    expect(isCapabilityGraphErrorCode('CAPABILITY_GRAPH_TAMPERED')).toBe(true);
    expect(isCapabilityGraphErrorCode('CAPABILITY_GRAPH_MADE_UP')).toBe(false);
    const error = new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.UNKNOWN_ERROR, {
      message: 'boom',
    });
    expect(isCapabilityGraphError(error)).toBe(true);
    expect(isCapabilityGraphError(new Error('boom'))).toBe(false);
  });

  it('normalizes unknown throwables', () => {
    expect(
      normalizeToCapabilityGraphError(new Error('plain')).code,
    ).toBe('CAPABILITY_GRAPH_UNKNOWN_ERROR');
    expect(normalizeToCapabilityGraphError(42).message).toBe('42');
    const already = new CapabilityGraphError(
      CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND,
      { message: 'missing' },
    );
    expect(normalizeToCapabilityGraphError(already)).toBe(already);
  });
});

describe('capability-graph error taxonomy (negative — malformed structures are rejected)', () => {
  it('rejects non-objects', () => {
    expect(() => fromCapabilityGraphErrorStruct(null)).toThrow(CapabilityGraphError);
    expect(() => fromCapabilityGraphErrorStruct([1, 2])).toThrow(CapabilityGraphError);
    expect(() => fromCapabilityGraphErrorStruct('nope')).toThrow(/plain object/);
  });

  it('rejects unknown or missing codes', () => {
    expect(() =>
      fromCapabilityGraphErrorStruct({ code: 'CAPABILITY_GRAPH_MADE_UP', category: 'unknown', message: 'x' }),
    ).toThrow(/unknown or missing capability-graph error code/);
    expect(() =>
      fromCapabilityGraphErrorStruct({ category: 'unknown', message: 'x' }),
    ).toThrow(/unknown or missing capability-graph error code/);
  });

  it('rejects category/code mismatches', () => {
    expect(() =>
      fromCapabilityGraphErrorStruct({
        code: 'CAPABILITY_GRAPH_TAMPERED',
        category: 'validation',
        message: 'x',
      }),
    ).toThrow(/does not match code/);
  });

  it('rejects missing or empty messages and malformed optional fields', () => {
    expect(() =>
      fromCapabilityGraphErrorStruct({ code: 'CAPABILITY_GRAPH_TAMPERED', category: 'integrity' }),
    ).toThrow(/non-empty string/);
    expect(() =>
      fromCapabilityGraphErrorStruct({ code: 'CAPABILITY_GRAPH_TAMPERED', category: 'integrity', message: '' }),
    ).toThrow(/non-empty string/);
    expect(() =>
      fromCapabilityGraphErrorStruct({
        code: 'CAPABILITY_GRAPH_TAMPERED',
        category: 'integrity',
        message: 'x',
        details: [1, 2],
      }),
    ).toThrow(/details must be a plain object/);
    expect(() =>
      fromCapabilityGraphErrorStruct({
        code: 'CAPABILITY_GRAPH_TAMPERED',
        category: 'integrity',
        message: 'x',
        correlationId: 'not a valid correlation id!!',
      }),
    ).toThrow(/correlation id/);
  });
});
