/**
 * Error taxonomy suite (Work Order B003) — closed ROLE_CONTEXT_* codes,
 * category mapping, structured round-trip and the fail-closed parser.
 */

import { describe, expect, it } from 'vitest';
import {
  categoryForRoleContextCode,
  fromRoleContextErrorStruct,
  isRoleContextError,
  isRoleContextErrorCode,
  normalizeToRoleContextError,
  ROLE_CONTEXT_ERROR_CATEGORIES,
  ROLE_CONTEXT_ERROR_CODES,
  RoleContextError,
  toRoleContextErrorStruct,
} from './index.js';

describe('role-context error taxonomy', () => {
  it('owns a closed code set with a category for every code', () => {
    const codes = Object.values(ROLE_CONTEXT_ERROR_CODES);
    expect(codes).toHaveLength(19);
    expect(new Set(codes).size).toBe(19);
    for (const code of codes) {
      expect(ROLE_CONTEXT_ERROR_CATEGORIES).toContain(categoryForRoleContextCode(code));
    }
    expect(isRoleContextErrorCode('ROLE_CONTEXT_ROLE_NOT_GRANTED')).toBe(true);
    expect(isRoleContextErrorCode('ROLE_CONTEXT_NOPE')).toBe(false);
    expect(isRoleContextErrorCode(42)).toBe(false);
  });

  it('the three RC1.0 structural rejections have dedicated codes', () => {
    expect(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_GRANTED).toBe('ROLE_CONTEXT_ROLE_NOT_GRANTED');
    expect(ROLE_CONTEXT_ERROR_CODES.TENANT_SCOPE_VIOLATION).toBe(
      'ROLE_CONTEXT_TENANT_SCOPE_VIOLATION',
    );
    expect(ROLE_CONTEXT_ERROR_CODES.GRANT_EXPIRED).toBe('ROLE_CONTEXT_GRANT_EXPIRED');
  });

  it('round-trips through the structured (wire-safe) form', () => {
    const error = new RoleContextError(ROLE_CONTEXT_ERROR_CODES.REGISTRY_VERSION_MISMATCH, {
      message: 'registry is 2.0.0, consumer expects 1.0.0',
      details: { registryVersion: '2.0.0', expectedRegistryVersion: '1.0.0' },
    });
    const struct = toRoleContextErrorStruct(error);
    expect(struct).toEqual({
      code: 'ROLE_CONTEXT_REGISTRY_VERSION_MISMATCH',
      category: 'versioning',
      message: 'registry is 2.0.0, consumer expects 1.0.0',
      details: { registryVersion: '2.0.0', expectedRegistryVersion: '1.0.0' },
    });
    const parsed = fromRoleContextErrorStruct(JSON.parse(JSON.stringify(struct)));
    expect(parsed.code).toBe(error.code);
    expect(parsed.category).toBe(error.category);
    expect(parsed.message).toBe(error.message);
    expect(parsed.details).toEqual(error.details);
    expect(isRoleContextError(parsed)).toBe(true);
  });

  it('parses fail-closed: malformed structs throw UNKNOWN_ERROR', () => {
    const cases: readonly unknown[] = [
      null,
      'not an object',
      { code: 'ROLE_CONTEXT_NOPE', category: 'validation', message: 'x' },
      { code: 'ROLE_CONTEXT_ROLE_NOT_FOUND', category: 'access', message: 'x' }, // wrong category
      { code: 'ROLE_CONTEXT_ROLE_NOT_FOUND', category: 'validation' }, // missing message
      { code: 'ROLE_CONTEXT_ROLE_NOT_FOUND', category: 'validation', message: '' },
    ];
    for (const bad of cases) {
      try {
        fromRoleContextErrorStruct(bad);
        expect.unreachable('must throw');
      } catch (error) {
        const roleContextError = error as RoleContextError;
        expect(roleContextError.code).toBe(ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR);
        expect(isRoleContextError(roleContextError)).toBe(true);
      }
    }
  });

  it('normalizes foreign throwables into RoleContextError', () => {
    expect(normalizeToRoleContextError(new Error('boom')).code).toBe(
      ROLE_CONTEXT_ERROR_CODES.UNKNOWN_ERROR,
    );
    expect(normalizeToRoleContextError('boom').message).toBe('boom');
    const original = new RoleContextError(ROLE_CONTEXT_ERROR_CODES.TAMPERED, { message: 't' });
    expect(normalizeToRoleContextError(original)).toBe(original);
  });
});
