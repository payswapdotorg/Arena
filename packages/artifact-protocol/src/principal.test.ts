import { describe, expect, it } from 'vitest';
import {
  PRINCIPAL_ID_PATTERN_SOURCE,
  PRINCIPAL_TYPES,
  isPrincipalId,
  isPrincipalRef,
  isPrincipalType,
  toPrincipalRef,
} from './principal.js';
import { ARTIFACT_ERROR_CODES, ArtifactError } from './errors.js';

const VALID = { type: 'agent-body', tenant: 'acme', principalId: 'structural-engineer.v4' };

describe('PrincipalRef (positive)', () => {
  it('constructs and freezes a valid tenant-scoped principal', () => {
    const principal = toPrincipalRef(VALID);
    expect(principal.type).toBe('agent-body');
    expect(principal.tenant).toBe('acme');
    expect(principal.principalId).toBe('structural-engineer.v4');
    expect(Object.isFrozen(principal)).toBe(true);
    expect(isPrincipalRef(principal)).toBe(true);
  });

  it('supports every known principal type', () => {
    for (const type of PRINCIPAL_TYPES) {
      const principal = toPrincipalRef({ ...VALID, type });
      expect(principal.type).toBe(type);
      expect(isPrincipalType(type)).toBe(true);
    }
  });

  it('accepts the public namespace for system-scope principals', () => {
    const principal = toPrincipalRef({ ...VALID, tenant: 'public', type: 'system' });
    expect(principal.tenant).toBe('public');
  });
});

describe('PrincipalRef (negative — NEVER a raw provider identity)', () => {
  it('rejects unknown principal types, including any model/provider notion', () => {
    for (const type of ['model', 'llm', 'provider', 'substrate', 'openai', '', 42, null]) {
      expect(() => toPrincipalRef({ ...VALID, type: type as string })).toThrow(ArtifactError);
    }
    expect(isPrincipalType('model')).toBe(false);
    try {
      toPrincipalRef({ ...VALID, type: 'model' });
    } catch (error) {
      expect((error as ArtifactError).code).toBe(ARTIFACT_ERROR_CODES.INVALID_PRINCIPAL);
    }
  });

  it('rejects raw provider identity shapes as principal ids', () => {
    for (const principalId of [
      'user@example.com',
      'https://accounts.provider.example/users/1',
      'org-123/agent-456',
      'accounts:openai:org-1',
      'a b',
      '',
      '-leading',
    ]) {
      expect(() => toPrincipalRef({ ...VALID, principalId })).toThrow(ArtifactError);
    }
    expect(isPrincipalId('user@example.com')).toBe(false);
  });

  it('rejects invalid tenants structurally', () => {
    expect(isPrincipalRef({ ...VALID, tenant: 'Not A Tenant' })).toBe(false);
    expect(isPrincipalRef({ type: 'agent-body', tenant: 'acme' })).toBe(false);
    expect(isPrincipalRef(null)).toBe(false);
  });

  it('pattern source anchors contract parity', () => {
    expect(PRINCIPAL_ID_PATTERN_SOURCE).toBe('^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$');
  });
});
