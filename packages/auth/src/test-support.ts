/**
 * Shared test fixtures for @arena/auth (NOT part of the public surface —
 * hygiene.test.ts asserts it is not re-exported from index).
 *
 * Deterministic constants and builders only: fixed tenants, principals,
 * B003 workspace snapshots, timestamps and policies; no clock reads (the
 * contract suite injects a ManualAuthClock), no randomness except where
 * newSessionId() is explicitly called.
 */

import { toSecurityPrincipal } from '@arena/security';
import type { SecurityPrincipal, TenantId } from '@arena/security';
import {
  createPermissionPolicy,
  createTenantMembership,
  createWorkspaceContext,
  grantRole,
} from '@arena/role-context';
import type { WorkspaceContext } from '@arena/role-context';
import { createAuthMethodDescriptor } from './session.js';
import { createSessionRecord } from './session.js';
import type { AuthMethodDescriptor, SessionPolicy, SessionRecord } from './session.js';
import { newSessionId } from './token.js';

export const TENANT_A = 'northwind';
export const TENANT_B = 'contoso';
export const PRINCIPAL_DANA = 'principal-dana-001';
export const PRINCIPAL_ZED = 'principal-zed-002';
export const IDENTITY_DANA = 'dana-001';
export const IDENTITY_ZED = 'zed-002';
export const WORKSPACE_MAIN = 'ws-northwind-main';
export const WORKSPACE_B = 'ws-contoso-main';

/** Fixed role-context timestamps (B003 grant chain construction). */
export const T0_ISO = '2026-02-01T00:00:00.000Z';

/** The contract-suite session policy: 120s TTL, 60s rotation window. */
export const TEST_SESSION_POLICY: SessionPolicy = Object.freeze({
  sessionTtlMs: 120_000,
  rotationWindowMs: 60_000,
});

export function fixturePrincipal(
  tenant: string = TENANT_A,
  principalId: string = PRINCIPAL_DANA,
): SecurityPrincipal {
  return toSecurityPrincipal({
    recordVersion: 1,
    principalId,
    kind: 'customer-identity',
    tenantScope: tenant,
    roles: ['tenant-owner'],
    label: null,
  });
}

export function fixtureWorkspaceContext(
  tenant: string = TENANT_A,
  identityId: string = IDENTITY_DANA,
): WorkspaceContext {
  return createWorkspaceContext({
    identityId,
    tenantId: tenant,
    workspaceId: tenant === TENANT_A ? WORKSPACE_MAIN : WORKSPACE_B,
    permissionPolicy: createPermissionPolicy({
      policyId: `policy-${tenant}`,
      tenantId: tenant,
      descriptor: {
        authority: 'external-permission-authority',
        statements: [
          { effect: 'allow', action: 'case.read', resource: `tenant/${tenant}/case/*` },
        ],
        revision: 1,
      },
      issuedAt: T0_ISO,
    }),
    grantedRoles: [
      grantRole({
        grantId: `grant-${identityId}-owner`,
        identityId,
        tenantId: tenant,
        roleId: 'owner',
        policyId: `policy-${tenant}`,
        grantedBy: 'admin-bootstrap',
        grantedAt: T0_ISO,
        validFrom: T0_ISO,
      }),
    ],
    memberships: [
      createTenantMembership({ identityId, tenantId: tenant, joinedAt: T0_ISO }),
    ],
  });
}

export function fixtureAuthMethod(
  method: string = 'local',
): AuthMethodDescriptor {
  return createAuthMethodDescriptor({ method });
}

export interface FixtureSessionOverrides {
  readonly sessionId?: string;
  readonly tenant?: string;
  readonly principal?: SecurityPrincipal;
  readonly workspace?: WorkspaceContext;
  readonly issuedAt?: number;
  readonly policy?: SessionPolicy;
  readonly authMethod?: AuthMethodDescriptor;
}

/**
 * A valid session record for `tenant` (default fixtures: principal Dana in
 * tenant A with a B003 workspace snapshot).
 */
export function fixtureSessionRecord(
  overrides: FixtureSessionOverrides = {},
): SessionRecord {
  const tenant = (overrides.tenant ?? TENANT_A) as TenantId;
  const principal =
    overrides.principal ?? fixturePrincipal(tenant, PRINCIPAL_DANA);
  const workspace =
    overrides.workspace ?? fixtureWorkspaceContext(tenant, IDENTITY_DANA);
  return createSessionRecord({
    sessionId: overrides.sessionId ?? newSessionId(),
    principal,
    tenantId: tenant,
    workspaceContext: workspace,
    authMethod: overrides.authMethod ?? fixtureAuthMethod(),
    issuedAt: overrides.issuedAt ?? 0,
    policy: overrides.policy ?? TEST_SESSION_POLICY,
  });
}
