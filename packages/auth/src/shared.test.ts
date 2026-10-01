/**
 * Shared vocabulary tests (Work Order B004) — session id branding, tenant
 * comparison across sibling brands, deep freeze.
 */

import { describe, expect, it } from 'vitest';
import { AuthError } from './errors.js';
import { deepFreeze, isDeepFrozen, isSessionId, sameTenantScope, toSessionId } from './shared.js';

describe('session id discipline', () => {
  it('accepts the record-id-compatible charset and rejects everything else', () => {
    expect(isSessionId('a')).toBe(true);
    expect(isSessionId('A1-b.c_d')).toBe(true);
    expect(isSessionId('')).toBe(false);
    expect(isSessionId('-leading-dash')).toBe(false);
    expect(isSessionId('has space')).toBe(false);
    expect(isSessionId('x'.repeat(128))).toBe(true);
    expect(isSessionId('x'.repeat(129))).toBe(false);
    expect(() => toSessionId('nope!')).toThrowError(AuthError);
  });
});

describe('cross-vocabulary tenant comparison', () => {
  it('compares by value across null/undefined and mismatched inputs', () => {
    expect(sameTenantScope('acme', 'acme')).toBe(true);
    expect(sameTenantScope('acme', 'globex')).toBe(false);
    expect(sameTenantScope('acme', 'untenanted')).toBe(false);
    expect(sameTenantScope(null, 'acme')).toBe(false);
    expect(sameTenantScope('acme', undefined)).toBe(false);
    expect(sameTenantScope(undefined, undefined)).toBe(false);
  });
});

describe('deep freeze', () => {
  it('freezes nested records and detects partial freezes', () => {
    const frozen = deepFreeze({ a: { b: [{ c: 1 }] } });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a.b[0])).toBe(true);
    expect(isDeepFrozen(frozen)).toBe(true);
    expect(isDeepFrozen({ a: { b: 1 } })).toBe(false);
    expect(isDeepFrozen(42)).toBe(true);
  });
});
