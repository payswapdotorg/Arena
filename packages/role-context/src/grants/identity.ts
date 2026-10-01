/**
 * Identity and TenantMembership — the first two links of the RC1.0 grant
 * chain:
 *
 *   Identity → TenantMembership → PermissionPolicy → GrantedRole →
 *   ActiveRoleContext → UI workflow
 *
 * An Identity is a neutral record (id + display name) — never a provider
 * account, never a permission holder. A TenantMembership records that an
 * identity belongs to a tenant (tenancy, architecture-lock rule 11); it
 * grants NOTHING by itself — it is a scope fact the resolver checks before
 * any role activation.
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import {
  deepFreeze,
  isIdentityId,
  isRoleContextTimestamp,
  isTenantId,
  toIdentityId,
  toRoleContextTimestamp,
  toTenantId,
} from '../shared.js';
import type { IdentityId, RoleContextTimestamp, TenantId } from '../shared.js';

export const IDENTITY_RECORD_VERSION = 1 as const;
export const TENANT_MEMBERSHIP_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** A neutral identity record: id + display name. No permissions live here. */
export interface Identity {
  readonly recordVersion: typeof IDENTITY_RECORD_VERSION;
  readonly identityId: IdentityId;
  readonly displayName: string;
}

export function createIdentity(input: {
  readonly identityId: string;
  readonly displayName: string;
}): Identity {
  const identityId = toIdentityId(input.identityId);
  if (typeof input.displayName !== 'string' || input.displayName.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `identity displayName must be a non-empty string, got ${JSON.stringify(input.displayName)}`,
    });
  }
  if (input.displayName.length > 200) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `identity displayName must be at most 200 characters, got ${String(input.displayName.length)}`,
    });
  }
  return deepFreeze({
    recordVersion: IDENTITY_RECORD_VERSION,
    identityId,
    displayName: input.displayName,
  } satisfies Identity);
}

/** Structural (non-throwing) check for an Identity. */
export function isIdentity(value: unknown): value is Identity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === IDENTITY_RECORD_VERSION &&
    isIdentityId(candidate['identityId']) &&
    typeof candidate['displayName'] === 'string' &&
    candidate['displayName'].length > 0 &&
    candidate['displayName'].length <= 200
  );
}

// ---------------------------------------------------------------------------
// TenantMembership
// ---------------------------------------------------------------------------

/** An identity's membership in one tenant (scope fact, never a permission). */
export interface TenantMembership {
  readonly recordVersion: typeof TENANT_MEMBERSHIP_RECORD_VERSION;
  readonly identityId: IdentityId;
  readonly tenantId: TenantId;
  readonly joinedAt: RoleContextTimestamp;
}

export function createTenantMembership(input: {
  readonly identityId: string;
  readonly tenantId: string;
  readonly joinedAt: string;
}): TenantMembership {
  const identityId = toIdentityId(input.identityId);
  const tenantId = toTenantId(input.tenantId);
  const joinedAt = toRoleContextTimestamp(input.joinedAt);
  return deepFreeze({
    recordVersion: TENANT_MEMBERSHIP_RECORD_VERSION,
    identityId,
    tenantId,
    joinedAt,
  } satisfies TenantMembership);
}

/** Structural (non-throwing) check for a TenantMembership. */
export function isTenantMembership(value: unknown): value is TenantMembership {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === TENANT_MEMBERSHIP_RECORD_VERSION &&
    isIdentityId(candidate['identityId']) &&
    isTenantId(candidate['tenantId']) &&
    isRoleContextTimestamp(candidate['joinedAt'])
  );
}

/** True iff the memberships prove `identityId` belongs to `tenantId`. */
export function isMemberOfTenant(
  memberships: readonly TenantMembership[],
  identityId: string,
  tenantId: string,
): boolean {
  const identity = toIdentityId(identityId);
  const tenant = toTenantId(tenantId);
  return memberships.some(
    (membership) =>
      membership.identityId === identity && membership.tenantId === tenant,
  );
}
