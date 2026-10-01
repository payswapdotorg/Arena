/**
 * Shared test fixtures for @arena/role-context (NOT part of the public
 * surface — hygiene.test.ts asserts it is not re-exported from index).
 *
 * Deterministic constants and builders only: fixed tenants, identities,
 * workspaces, timestamps and a canonical Capability Case view; no
 * randomness, no clock reads.
 */

import {
  createIdentity,
  createPermissionPolicy,
  createTenantMembership,
  createWorkspaceContext,
  grantRole,
} from './index.js';
import type {
  CapabilityCaseView,
  GrantedRole,
  Identity,
  PermissionPolicy,
  RoleContextTimestamp,
  RoleId,
  TenantMembership,
  WorkspaceContext,
} from './index.js';

export const TENANT_A = 'acme';
export const TENANT_B = 'globex';
export const IDENTITY_OWNER_BUILDER = 'dana-001';
export const IDENTITY_B_ONLY = 'ishtar-002';
export const WORKSPACE_MAIN = 'ws-main';
export const WORKSPACE_B = 'ws-globex';

/** Fixed canonical timestamps (ms-UTC, strictly increasing; branded for record interfaces). */
export const T0 = '2026-02-01T00:00:00.000Z' as RoleContextTimestamp;
export const T1 = '2026-02-01T06:00:00.000Z' as RoleContextTimestamp;
export const T2 = '2026-02-01T12:00:00.000Z' as RoleContextTimestamp;
export const T3 = '2026-02-01T18:00:00.000Z' as RoleContextTimestamp;
export const T4 = '2026-02-02T00:00:00.000Z' as RoleContextTimestamp;
export const T_EXPIRY = '2026-03-01T00:00:00.000Z' as RoleContextTimestamp;
export const T_AFTER_EXPIRY = '2026-03-01T00:00:00.001Z' as RoleContextTimestamp;

/** The multi-role fixture identity: holds Owner + Builder + Researcher. */
export const MULTI_ROLE_ID = IDENTITY_OWNER_BUILDER;

export function fixturePolicy(tenant: string = TENANT_A): PermissionPolicy {
  return createPermissionPolicy({
    policyId: `policy-${tenant}`,
    tenantId: tenant,
    descriptor: {
      authority: 'external-permission-authority',
      statements: [
        { effect: 'allow', action: 'case.read', resource: `tenant/${tenant}/case/*` },
        { effect: 'allow', action: 'task.execute', resource: `tenant/${tenant}/task/*` },
        { effect: 'deny', action: 'case.delete', resource: `tenant/${tenant}/case/*` },
      ],
      revision: 7,
    },
    issuedAt: T0,
  });
}

export function fixtureGrant(
  roleId: RoleId,
  overrides: {
    readonly grantId?: string;
    readonly tenantId?: string;
    readonly identityId?: string;
    readonly expiresAt?: string;
    readonly validFrom?: string;
  } = {},
): GrantedRole {
  return grantRole({
    grantId: overrides.grantId ?? `grant-${roleId}`,
    identityId: overrides.identityId ?? MULTI_ROLE_ID,
    tenantId: overrides.tenantId ?? TENANT_A,
    roleId,
    policyId: `policy-${overrides.tenantId ?? TENANT_A}`,
    grantedBy: 'admin-bootstrap',
    grantedAt: T0,
    validFrom: overrides.validFrom ?? T0,
    ...(overrides.expiresAt !== undefined ? { expiresAt: overrides.expiresAt } : {}),
  });
}

export function fixtureMemberships(identity: string = MULTI_ROLE_ID): readonly TenantMembership[] {
  return [
    createTenantMembership({ identityId: identity, tenantId: TENANT_A, joinedAt: T0 }),
  ];
}

export function fixtureIdentity(identity: string = MULTI_ROLE_ID): Identity {
  return createIdentity({ identityId: identity, displayName: `Dana (${identity})` });
}

/** The multi-role workspace: Owner + Builder + Researcher granted, none active yet. */
export function fixtureMultiRoleWorkspace(): WorkspaceContext {
  return createWorkspaceContext({
    identityId: MULTI_ROLE_ID,
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_MAIN,
    permissionPolicy: fixturePolicy(),
    grantedRoles: [
      fixtureGrant('owner'),
      fixtureGrant('agent-builder', { grantId: 'grant-builder-2' }),
      fixtureGrant('researcher', { grantId: 'grant-researcher-3' }),
    ],
    memberships: fixtureMemberships(),
  });
}

/**
 * A workspace holding ALL 8 reference roles — used by the full-chain and
 * switch-matrix tests (an identity CAN hold every role; RC1.0: "A person
 * can hold several or all of them").
 */
export function fixtureAllRolesWorkspace(): WorkspaceContext {
  const roleIds: readonly RoleId[] = [
    'owner',
    'agent-builder',
    'expert',
    'evaluator',
    'researcher',
    'operator',
    'marketplace-participant',
    'administrator',
  ];
  return createWorkspaceContext({
    identityId: MULTI_ROLE_ID,
    tenantId: TENANT_A,
    workspaceId: WORKSPACE_MAIN,
    permissionPolicy: fixturePolicy(),
    grantedRoles: roleIds.map((roleId, index) =>
      fixtureGrant(roleId, { grantId: `grant-${String(index + 1).padStart(2, '0')}-${roleId}` }),
    ),
    memberships: fixtureMemberships(),
  });
}

/**
 * The canonical Capability Case view — ONE canonical object that every
 * reference lens projects (same-object / different-lens rule).
 */
export const CANONICAL_CASE: CapabilityCaseView = Object.freeze({
  kind: 'capability-case',
  tenant: TENANT_A,
  objectId: 'case-42',
  version: '1.2.0',
  status: 'in-development',
  targetCapability: 'invoice-reconciliation',
  domain: 'finance-ops',
  observedFailure: 'Agent miscategorizes cross-currency invoices under partial evidence.',
  desiredOutcome: 'Reconcile cross-currency invoices with at most 1% error on the benchmark suite.',
  uncertainty: 'high',
  evidence: Object.freeze([
    Object.freeze({ evidenceId: 'ev-failure-log-1', stateKind: 'evidence' }),
    Object.freeze({ evidenceId: 'ev-expert-note-7', stateKind: 'expert-judgment' }),
    Object.freeze({ evidenceId: 'ev-model-trace-3', stateKind: 'model-output' }),
    Object.freeze({ evidenceId: 'ev-bench-run-9', stateKind: 'evaluation-result' }),
  ]),
  currentBodyVersion: '9.4.1',
  substrate: 'substrate-standard',
  missingCapabilities: Object.freeze(['fx-rate-lookup', 'partial-evidence-reasoning']),
  assignedExpertId: 'expert-nadia',
  openTaskCount: 3,
  resolvedTaskCount: 11,
  jobHealth: 'degraded',
  lastEvaluation: Object.freeze({
    result: 'fail',
    score: 61.5,
    stateKind: 'evaluation-result',
  }),
});

/** All 8 reference role ids as a plain readonly array (for seeded picks). */
export const ROLE_IDS_ALL: readonly RoleId[] = [
  'owner',
  'agent-builder',
  'expert',
  'evaluator',
  'researcher',
  'operator',
  'marketplace-participant',
  'administrator',
];

/** A deterministic LCG (house property-test discipline: no Math.random). */
export class Lcg {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    const index = this.int(0, items.length - 1);
    return items[index] as T;
  }
}
