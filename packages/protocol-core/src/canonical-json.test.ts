import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';
import { PROTOCOL_ERROR_CODES } from './protocol-error.js';
import { ProtocolError } from './protocol-error.js';

describe('canonicalJson (positive)', () => {
  it('sorts object keys by UTF-16 code unit order', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: 1, A: 2, 'é': 3 })).toBe('{"A":2,"z":1,"é":3}');
  });

  it('is independent of key insertion order', () => {
    const a = { outer: { d: 1, c: 2 }, list: [3, 2, 1] };
    const b: typeof a = { list: [3, 2, 1], outer: { c: 2, d: 1 } };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('preserves array element order', () => {
    expect(canonicalJson([3, 2, 1])).toBe('[3,2,1]');
  });

  it('serializes primitives deterministically', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson('a"b\\c\nd')).toBe(JSON.stringify('a"b\\c\nd'));
    expect(canonicalJson('héllo 🌍')).toBe(JSON.stringify('héllo 🌍'));
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(0.5)).toBe('0.5');
    expect(canonicalJson(1e21)).toBe('1e+21');
  });

  it('escapes lone surrogates (well-formed JSON.stringify)', () => {
    expect(canonicalJson('\uD800')).toBe('"\\ud800"');
  });

  it('maps undefined array elements to null and drops undefined object values', () => {
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('serializes empty containers', () => {
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson([])).toBe('[]');
  });

  it('handles deeply nested values', () => {
    expect(canonicalJson({ a: { b: { c: [{ d: [1, { e: null }] }] } } })).toBe(
      '{"a":{"b":{"c":[{"d":[1,{"e":null}]}]}}}',
    );
  });
});

describe('canonicalJson (negative — must throw)', () => {
  const expectFailure = (value: unknown): void => {
    expect(() => canonicalJson(value)).toThrow(ProtocolError);
  };

  it('rejects NaN and Infinity', () => {
    expectFailure(Number.NaN);
    expectFailure(Number.POSITIVE_INFINITY);
    expectFailure(Number.NEGATIVE_INFINITY);
  });

  it('rejects undefined, bigint, symbol and function values', () => {
    expectFailure(undefined);
    expectFailure(10n);
    expectFailure(Symbol('nope'));
    expectFailure(() => 1);
  });

  it('rejects circular references', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expectFailure(cyclic);
  });

  it('rejects non-plain objects (Date, Map, class instances)', () => {
    expectFailure(new Date('2026-01-01T00:00:00Z'));
    expectFailure(new Map([['a', 1]]));
    class Thing {
      value = 1;
    }
    expectFailure(new Thing());
  });

  it('failure carries the CANONICALIZATION_FAILED code', () => {
    try {
      canonicalJson(Number.NaN);
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolError);
      expect((error as ProtocolError).code).toBe(PROTOCOL_ERROR_CODES.CANONICALIZATION_FAILED);
      expect((error as ProtocolError).category).toBe('encoding');
    }
  });
});
