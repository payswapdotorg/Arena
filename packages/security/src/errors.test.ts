/**
 * Error taxonomy tests (Work Order A034): closed codes, category
 * mapping, wire-safe normalization, strict parsing.
 */

import { describe, expect, it } from 'vitest';
import {
  isSecurityErrorCode,
  isWireSafeSecurityError,
  normalizeToSecurityError,
  parseWireSafeSecurityError,
  SECURITY_ERROR_CATEGORIES,
  SECURITY_ERROR_CODES,
  SecurityError,
  toWireSafeSecurityError,
} from './index.js';
import type { CorrelationId } from '@arena/protocol-core';

describe('the error code set is closed', () => {
  it('every code is prefixed and unique', () => {
    const codes = Object.values(SECURITY_ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code.startsWith('SECURITY_')).toBe(true);
    }
  });

  it('isSecurityErrorCode rejects unknown codes', () => {
    expect(isSecurityErrorCode('SECURITY_TENANT_MISMATCH')).toBe(true);
    expect(isSecurityErrorCode('SECURITY_ROOT_ACCESS')).toBe(false);
    expect(isSecurityErrorCode('not-a-code')).toBe(false);
  });

  it('the category vocabulary is closed', () => {
    expect(SECURITY_ERROR_CATEGORIES).toContain('authorization');
    expect(SECURITY_ERROR_CATEGORIES).toContain('tenancy');
    expect(SECURITY_ERROR_CATEGORIES).toContain('integrity');
  });
});

describe('wire-safe form', () => {
  it('toWireSafeSecurityError strips the stack and freezes', () => {
    const error = new SecurityError(SECURITY_ERROR_CODES.TENANT_MISMATCH, {
      message: 'crossing',
      correlationId: 'corr-1' as CorrelationId,
    });
    const wire = toWireSafeSecurityError(error);
    expect(wire.code).toBe('SECURITY_TENANT_MISMATCH');
    expect(wire.category).toBe('tenancy');
    expect(JSON.stringify(wire)).not.toContain('at ');
    expect(Object.isFrozen(wire)).toBe(true);
    expect(isWireSafeSecurityError(wire)).toBe(true);
  });

  it('parseWireSafeSecurityError rejects unknown codes and category mismatches', () => {
    expect(() =>
      parseWireSafeSecurityError({
        name: 'SecurityError',
        code: 'SECURITY_NEW_SHINY',
        category: 'validation',
        message: 'x',
        details: { message: 'x' },
      }),
    ).toThrowError(SecurityError);

    expect(() =>
      parseWireSafeSecurityError({
        name: 'SecurityError',
        code: 'SECURITY_TENANT_MISMATCH',
        category: 'validation',
        message: 'x',
        details: { message: 'x' },
      }),
    ).toThrowError(/category mismatch/);
  });

  it('normalizeToSecurityError maps unknown failures to SECURITY_UNKNOWN_ERROR', () => {
    const normalized = normalizeToSecurityError(new Error('boom'));
    expect(normalized.code).toBe(SECURITY_ERROR_CODES.UNKNOWN_ERROR);
    expect(normalized.category).toBe('unknown');
    const passthrough = normalizeToSecurityError(
      new SecurityError(SECURITY_ERROR_CODES.FORBIDDEN, { message: 'no' }),
    );
    expect(passthrough.code).toBe(SECURITY_ERROR_CODES.FORBIDDEN);
  });

  it('errors carry the correlation id when provided', () => {
    const normalized = normalizeToSecurityError(
      new Error('boom'),
      'corr-attach-1' as CorrelationId,
    );
    expect(normalized.details.correlationId).toBe('corr-attach-1');
  });
});
