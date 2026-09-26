/**
 * Canonical JSON serialization (RFC 8785-aligned subset).
 *
 * Deterministic form for digests and content addressing:
 *   - object keys sorted by UTF-16 code unit order;
 *   - no insignificant whitespace;
 *   - arrays preserve element order;
 *   - `undefined` array elements become `null`; `undefined` object values
 *     drop the key (matching JSON.stringify semantics);
 *   - non-finite numbers, bigints, symbols, functions, dates, maps and class
 *     instances are REJECTED (ProtocolError PROTOCOL_CANONICALIZATION_FAILED);
 *   - strings serialize via well-formed JSON.stringify (lone surrogates are
 *     escaped deterministically).
 *
 * Note: JSON.parse collapses duplicate keys (last wins) before
 * canonicalization; duplicate-key detection on raw wire bytes is out of
 * scope for the canonical form itself.
 */

import { PROTOCOL_ERROR_CODES, ProtocolError } from './protocol-error.js';

export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set());
}

function fail(reason: string): never {
  throw new ProtocolError(PROTOCOL_ERROR_CODES.CANONICALIZATION_FAILED, {
    message: reason,
  });
}

function canonicalize(value: unknown, seen: Set<object>): string {
  switch (typeof value) {
    case 'undefined':
      return fail('undefined is not canonically serializable');
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return canonicalNumber(value);
    case 'string':
      return JSON.stringify(value);
    case 'bigint':
      return fail('bigint is not canonically serializable');
    case 'symbol':
      return fail('symbol is not canonically serializable');
    case 'function':
      return fail('function is not canonically serializable');
    case 'object': {
      if (value === null) return 'null';
      if (seen.has(value)) return fail('circular reference detected');
      seen.add(value);
      try {
        if (Array.isArray(value)) {
          return `[${value
            .map((item) => (item === undefined ? 'null' : canonicalize(item, seen)))
            .join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
          return fail(
            'only plain JSON values are canonically serializable (wrap dates/errors in plain data first)',
          );
        }
        const record = value as Record<string, unknown>;
        const parts: string[] = [];
        for (const key of Object.keys(record).sort()) {
          const item = record[key];
          if (item === undefined) continue;
          parts.push(`${JSON.stringify(key)}:${canonicalize(item, seen)}`);
        }
        return `{${parts.join(',')}}`;
      } finally {
        seen.delete(value);
      }
    }
  }
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return fail('non-finite numbers are not canonically serializable');
  }
  return JSON.stringify(value);
}
