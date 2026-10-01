import { describe, expect, it } from 'vitest';
import {
  canonicalEqual,
  deepFreeze,
  isCoordinationKey,
  isJsonSafeValue,
  isRecordId,
  isRecordKind,
  isTenantId,
  toCoordinationKey,
  toRecordData,
} from './index.js';
import { PersistenceError } from './index.js';

describe('bounded identifier vocabulary', () => {
  it('accepts bounded ids and rejects the rest', () => {
    expect(isRecordId('case-1.revision_2')).toBe(true);
    expect(isRecordId(' leading-space')).toBe(false);
    expect(isRecordId('')).toBe(false);
    expect(isRecordId('x'.repeat(129))).toBe(false);

    expect(isTenantId('tenant-alpha')).toBe(true);
    expect(isTenantId('TenantAlpha')).toBe(false);
    expect(isTenantId('x'.repeat(65))).toBe(false);

    expect(isRecordKind('capability-case')).toBe(true);
    expect(isRecordKind('CapabilityCase')).toBe(false);

    expect(isCoordinationKey('rl:alpha:1')).toBe(true);
    expect(isCoordinationKey('bad key!')).toBe(false);
    expect(() => toCoordinationKey('bad key!')).toThrow(PersistenceError);
  });
});

describe('canonical-JSON-safe payloads', () => {
  it('accepts JSON-safe values and rejects the rest', () => {
    expect(isJsonSafeValue({ a: [1, 'x', null, true], b: { c: 0.5 } })).toBe(true);
    expect(isJsonSafeValue({ u: undefined })).toBe(false);
    expect(isJsonSafeValue({ s: Symbol('x') })).toBe(false);
    expect(isJsonSafeValue({ f: () => 1 })).toBe(false);
    expect(isJsonSafeValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonSafeValue(new Date(0))).toBe(false);
    expect(() => toRecordData({ s: Symbol('x') })).toThrow(PersistenceError);
    expect(() => toRecordData({ n: Number.NaN })).toThrow(PersistenceError);
  });

  it('canonical equality is key-order independent', () => {
    expect(canonicalEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(canonicalEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(canonicalEqual([1, 2], [2, 1])).toBe(false);
  });
});

describe('deep freeze', () => {
  it('freezes nested structures', () => {
    const value = deepFreeze({ a: { b: [1, { c: 2 }] } });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[1])).toBe(true);
    expect(() => {
      (value.a as { b?: number[] }).b = [9];
    }).toThrow();
  });
});
