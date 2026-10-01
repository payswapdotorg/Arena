/**
 * SessionRecord tests (Work Order B004) — versioned shape, fail-closed
 * construction (anonymous/untenanted principals, cross-tenant material),
 * strict parsing of corrupted records, lifecycle predicates.
 */

import { describe, expect, it } from 'vitest';
import { makeAnonymousPrincipal, toSecurityPrincipal } from '@arena/security';
import { AuthError, AUTH_ERROR_CODES, isAuthError } from './errors.js';
import {
  createAuthMethodDescriptor,
  createSessionRecord,
  isSessionExpired,
  isSessionRecord,
  requiresSessionRotation,
  toSessionRecord,
  validateSessionPolicy,
} from './session.js';
import type { SessionRecord } from './session.js';
import { isDeepFrozen, toSessionId } from './shared.js';
import {
  fixturePrincipal,
  fixtureSessionRecord,
  fixtureWorkspaceContext,
  TENANT_A,
  TENANT_B,
  TEST_SESSION_POLICY,
} from './test-support.js';
import { newSessionId } from './token.js';

function expectAuthError(operation: () => unknown): AuthError {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }
  expect(isAuthError(caught), `expected AuthError, got ${String(caught)}`).toBe(true);
  return caught as AuthError;
}

describe('SessionRecord construction', () => {
  it('creates a frozen record with deterministic derived windows', () => {
    const record = fixtureSessionRecord({ issuedAt: 1_000 });
    expect(record.recordVersion).toBe(1);
    expect(record.issuedAt).toBe(1_000);
    expect(record.expiresAt).toBe(1_000 + TEST_SESSION_POLICY.sessionTtlMs);
    expect(record.rotatesAt).toBe(1_000 + TEST_SESSION_POLICY.rotationWindowMs);
    expect(record.revocationEpoch).toBe(0);
    expect(isDeepFrozen(record)).toBe(true);
    expect(isSessionRecord(record)).toBe(true);
  });

  it('defaults the tenant ref to the customer-identity boundary class', () => {
    const principal = fixturePrincipal();
    const record = fixtureSessionRecord({ principal });
    expect(record.tenantRef.tenantId).toBe(TENANT_A);
    expect(record.tenantRef.boundaryClass).toBe('customer-identity');
    expect(record.tenantRef.recordId).toBe(principal.principalId);
  });

  it('REJECTS the anonymous principal (fail closed — no anonymous sessions)', () => {
    const error = expectAuthError(() =>
      fixtureSessionRecord({ principal: makeAnonymousPrincipal() }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_PRINCIPAL);
    expect(error.message).toContain('anonymous');
  });

  it('REJECTS untenanted principals (sessions are tenant-scoped)', () => {
    const operator = toSecurityPrincipal({
      recordVersion: 1,
      principalId: 'principal-operator-1',
      kind: 'platform-operator',
      tenantScope: 'untenanted',
      roles: ['platform-operator'],
      label: null,
    });
    const error = expectAuthError(() => fixtureSessionRecord({ principal: operator }));
    expect(error.code).toBe(AUTH_ERROR_CODES.INVALID_PRINCIPAL);
  });

  it('REJECTS a principal whose scope belongs to another tenant (typed violation)', () => {
    const error = expectAuthError(() =>
      fixtureSessionRecord({ tenant: TENANT_A, principal: fixturePrincipal(TENANT_B) }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION);
    expect(error.category).toBe('integrity');
  });

  it('REJECTS a workspace context from another tenant (typed violation)', () => {
    const error = expectAuthError(() =>
      fixtureSessionRecord({ workspace: fixtureWorkspaceContext(TENANT_B) }),
    );
    expect(error.code).toBe(AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION);
  });

  it('REJECTS malformed policies, timestamps and auth methods (typed)', () => {
    expect(
      expectAuthError(() =>
        createSessionRecord({
          ...fixtureSessionInput(),
          policy: { sessionTtlMs: 5, rotationWindowMs: 10 },
        }),
      ).code,
    ).toBe(AUTH_ERROR_CODES.INVALID_TTL);
    expect(
      expectAuthError(() =>
        createSessionRecord({
          ...fixtureSessionInput(),
          policy: { sessionTtlMs: 120_000, rotationWindowMs: 500_000 },
        }),
      ).code,
    ).toBe(AUTH_ERROR_CODES.INVALID_WINDOW);
    expect(
      expectAuthError(() =>
        createSessionRecord({ ...fixtureSessionInput(), issuedAt: -1 }),
      ).code,
    ).toBe(AUTH_ERROR_CODES.INVALID_SESSION_RECORD);
    expect(
      expectAuthError(() =>
        createSessionRecord({
          ...fixtureSessionInput(),
          authMethod: createAuthMethodDescriptor({ method: 'NOT NEUTRAL' }),
        }),
      ).code,
    ).toBe(AUTH_ERROR_CODES.INVALID_AUTH_METHOD);
  });
});

describe('SessionRecord strict parsing (storage reads fail closed)', () => {
  it('round-trips a record through serialization + toSessionRecord', () => {
    const record = fixtureSessionRecord();
    const parsed = toSessionRecord(JSON.parse(JSON.stringify(record)) as unknown);
    expect(parsed).toEqual(record);
    // Embedded contracts survive as frozen objects.
    expect(isDeepFrozen(parsed)).toBe(true);
  });

  it('rejects corrupted records with typed codes (never a usable session)', () => {
    const base = JSON.parse(JSON.stringify(fixtureSessionRecord())) as Record<string, unknown>;
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ['bad version', { ...base, recordVersion: 99 }, AUTH_ERROR_CODES.INVALID_SESSION_RECORD],
      ['bad principal', { ...base, principal: { recordVersion: 1 } }, AUTH_ERROR_CODES.INVALID_PRINCIPAL],
      ['bad tenant', { ...base, tenantId: 'NOPE' }, AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION],
      ['bad ref', { ...base, tenantRef: null }, AUTH_ERROR_CODES.INVALID_TENANT_REF],
      ['bad workspace', { ...base, workspaceContext: { recordVersion: 1 } }, AUTH_ERROR_CODES.INVALID_WORKSPACE_CONTEXT],
      ['bad expiry', { ...base, expiresAt: base['issuedAt'] }, AUTH_ERROR_CODES.INVALID_SESSION_RECORD],
      ['bad epoch', { ...base, revocationEpoch: -1 }, AUTH_ERROR_CODES.INVALID_SESSION_RECORD],
      ['cross-tenant workspace', { ...base, workspaceContext: JSON.parse(JSON.stringify(fixtureWorkspaceContext(TENANT_B))) }, AUTH_ERROR_CODES.TENANT_SCOPE_VIOLATION],
    ];
    for (const [name, corrupted, expectedCode] of cases) {
      const error = expectAuthError(() => toSessionRecord(corrupted));
      expect(error.code, name).toBe(expectedCode);
    }
  });
});

describe('lifecycle predicates', () => {
  const record: SessionRecord = fixtureSessionRecord({ issuedAt: 0 });

  it('expires exactly at expiresAt; rotation-due is not a failure', () => {
    expect(isSessionExpired(record, TEST_SESSION_POLICY.sessionTtlMs - 1)).toBe(false);
    expect(isSessionExpired(record, TEST_SESSION_POLICY.sessionTtlMs)).toBe(true);
    expect(requiresSessionRotation(record, 0)).toBe(false);
    expect(requiresSessionRotation(record, TEST_SESSION_POLICY.rotationWindowMs)).toBe(true);
    expect(
      requiresSessionRotation(record, TEST_SESSION_POLICY.sessionTtlMs),
    ).toBe(false);
  });
});

describe('session policy validation', () => {
  it('accepts in-bounds policies and freezes the result', () => {
    const policy = validateSessionPolicy({
      sessionTtlMs: 120_000,
      rotationWindowMs: 60_000,
    });
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('rejects out-of-bounds and malformed policies (typed)', () => {
    const cases: readonly [string, { sessionTtlMs: number; rotationWindowMs: number }, string][] = [
      ['ttl below floor', { sessionTtlMs: 1_000, rotationWindowMs: 500 }, AUTH_ERROR_CODES.INVALID_TTL],
      ['ttl above ceiling', { sessionTtlMs: 31 * 24 * 60 * 60 * 1000, rotationWindowMs: 60_000 }, AUTH_ERROR_CODES.INVALID_TTL],
      ['non-integer ttl', { sessionTtlMs: 120_000.5, rotationWindowMs: 60_000 }, AUTH_ERROR_CODES.INVALID_TTL],
      ['window above ttl', { sessionTtlMs: 120_000, rotationWindowMs: 240_000 }, AUTH_ERROR_CODES.INVALID_WINDOW],
      ['window below floor', { sessionTtlMs: 120_000, rotationWindowMs: 100 }, AUTH_ERROR_CODES.INVALID_WINDOW],
    ];
    for (const [name, policy, expectedCode] of cases) {
      expect(expectAuthError(() => validateSessionPolicy(policy)).code, name).toBe(expectedCode);
    }
  });
});

describe('session id discipline', () => {
  it('mints UUID-shaped ids and brands them on validation', () => {
    const id = newSessionId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(toSessionId(id)).toBe(id);
    expect(() => toSessionId('bad id!')).toThrowError(AuthError);
  });
});

/** Helper: a valid createSessionRecord input built from the fixtures. */
function fixtureSessionInput(): {
  sessionId: string;
  principal: ReturnType<typeof fixturePrincipal>;
  tenantId: string;
  workspaceContext: ReturnType<typeof fixtureWorkspaceContext>;
  authMethod: ReturnType<typeof createAuthMethodDescriptor>;
  issuedAt: number;
  policy: typeof TEST_SESSION_POLICY;
} {
  return {
    sessionId: newSessionId(),
    principal: fixturePrincipal(),
    tenantId: TENANT_A,
    workspaceContext: fixtureWorkspaceContext(),
    authMethod: createAuthMethodDescriptor({ method: 'local' }),
    issuedAt: 0,
    policy: TEST_SESSION_POLICY,
  };
}
