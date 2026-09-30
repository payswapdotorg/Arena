/**
 * Deterministic test support for @arena/security (Work Order A034).
 *
 * NOT exported from the package index (internal to the test suite).
 * Fixed timestamps, fixed ids, fixed digests — every test that needs
 * entropy takes it from here so failures are reproducible.
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { SecurityError } from './errors.js';

/**
 * Capture the SecurityError a synchronous function throws (for code-level
 * assertions — vitest's toThrowError(string) matches MESSAGES, not codes).
 */
export function captureSecurityError(fn: () => unknown): SecurityError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SecurityError) return error;
    throw error;
  }
  throw new Error('expected a SecurityError to be thrown');
}

/** Async variant. */
export async function captureSecurityErrorAsync(
  fn: () => Promise<unknown>,
): Promise<SecurityError> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof SecurityError) return error;
    throw error;
  }
  throw new Error('expected a SecurityError to be thrown');
}
import type { TenantId } from './shared.js';

export const T0 = '2026-09-30T00:00:00.000Z';
export const T1 = '2026-09-30T01:00:00.000Z';
export const T2 = '2026-09-30T02:00:00.000Z';
export const T3 = '2026-09-30T03:00:00.000Z';
export const T4 = '2026-09-30T04:00:00.000Z';
export const T5 = '2026-09-30T05:00:00.000Z';

export const TENANT_A = 'tenant-alpha' as TenantId;
export const TENANT_B = 'tenant-beta' as TenantId;

export const CORR_ID = 'corr-security-test-0001' as CorrelationId;
export const IDEM_KEY = 'idem-security-test-0001' as IdempotencyKey;

/** Fixed UUIDv4s (deterministic — no Math.random anywhere). */
export const UUID_1 = '00000000-0000-4000-8000-000000000001';
export const UUID_2 = '00000000-0000-4000-8000-000000000002';
export const UUID_3 = '00000000-0000-4000-8000-000000000003';
export const UUID_4 = '00000000-0000-4000-8000-000000000004';
export const UUID_5 = '00000000-0000-4000-8000-000000000005';

export function makePrincipalInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    principalId: 'principal-test-1',
    kind: 'customer-identity',
    tenantScope: TENANT_A,
    roles: ['tenant-member'],
    label: null,
    ...overrides,
  };
}

export function makeTenantScopedRefInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recordVersion: 1,
    tenantId: TENANT_A,
    boundaryClass: 'dataset',
    recordId: 'dataset-test-1',
    ...overrides,
  };
}

export function makeStatementInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    statementId: 'stmt-allow-read-dataset',
    effect: 'allow',
    tenantId: TENANT_A,
    roles: ['tenant-member'],
    action: 'read',
    boundaryClass: 'dataset',
    ...overrides,
  };
}

export function makeBundleInput(
  statements: Record<string, unknown>[],
): Record<string, unknown> {
  return {
    recordVersion: 1,
    bundleId: 'bundle-test',
    version: '1.0.0',
    statements,
  };
}

export function makeDataRightsInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recordVersion: 1,
    owner: TENANT_A,
    source: 'customer upload batch #7',
    permittedUse: 'cross-tenant-learning',
    contractRef: 'contract-2026-alpha-data',
    retention: {
      recordVersion: 1,
      mode: 'fixed-days',
      retentionDays: 365,
      expiresAt: null,
    },
    publicationStatus: 'tenant-internal',
    recordedAt: T0,
    ...overrides,
  };
}

export function makeGrantInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recordVersion: 1,
    grantId: 'grant-test-1',
    grantor: TENANT_A,
    datasets: [
      {
        recordVersion: 1,
        tenantId: TENANT_A,
        boundaryClass: 'dataset',
        recordId: 'dataset-test-1',
      },
    ],
    grantedAt: T0,
    expiresAt: T5,
    status: 'active',
    revokedAt: null,
    ...overrides,
  };
}

export function makeExpertRightsInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recordVersion: 1,
    rightsId: 'expert-rights-1',
    tenantId: TENANT_A,
    contributorIdentity: 'expert-principal-1',
    pseudonym: 'expert-pseudonym-1',
    compensationTerms: {
      contractRef: 'expert-contract-2026-001',
      status: 'agreed',
    },
    attributionPolicy: 'pseudonymous',
    derivedArtifactRights: 'attribution-required',
    withdrawalPolicy: {
      noticePeriodDays: 30,
      deletionApplicable: true,
      derivedArtifactTreatment: 'retain-anonymized',
    },
    status: 'active',
    withdrawnAt: null,
    ...overrides,
  };
}

export function makeModelDataPolicyInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recordVersion: 1,
    policyId: 'model-policy-1',
    tenantId: TENANT_A,
    taskPolicyRef: null,
    inputRetention: {
      recordVersion: 1,
      mode: 'fixed-days',
      retentionDays: 30,
      expiresAt: null,
    },
    outputRetention: {
      recordVersion: 1,
      mode: 'none',
      retentionDays: null,
      expiresAt: null,
    },
    defaultClassification: 'tenant-internal',
    ...overrides,
  };
}

export function makeAuditEventInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    recordVersion: 1,
    eventId: UUID_1,
    kind: 'authorization-decision',
    tenantId: TENANT_A,
    principalId: 'principal-test-1',
    action: 'read',
    boundaryClass: 'dataset',
    outcome: { effect: 'deny', reason: 'no-matching-policy' },
    correlationId: 'corr-security-test-0001',
    causationId: UUID_2,
    occurredAt: T1,
    ...overrides,
  };
}
