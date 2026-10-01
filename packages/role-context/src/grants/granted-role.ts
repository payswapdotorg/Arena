/**
 * GrantedRole — the "granted roles" link of the RC1.0 grant chain.
 *
 * A GrantedRole records that an identity holds a role in a tenant, WITH
 * grant provenance (who granted it, when, optional note) and a RECOMMENDED
 * expiry (matching the @arena/entitlements lineage style: a grant is active
 * at time `at` iff `validFrom <= at` and — when `expiresAt` is present —
 * `at < expiresAt`; a grant is EXPIRED exactly at its expiry instant).
 *
 * A grant references the permission policy in force (`policyId`) but NEVER
 * embeds or interprets policy content: holding a role is not a permission
 * (RC1.0; handoff §7 "A role is not permission").
 *
 * Revocation is deliberately NOT modeled here: grant lifecycle authority
 * (revoke/amend lineage) belongs to the auth/entitlements authority
 * (B004). The recommended pattern is expiry + re-grant; see README
 * limitations.
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import {
  deepFreeze,
  isIdentityId,
  isPermissionPolicyId,
  isProvenanceNote,
  isRoleContextTimestamp,
  isRoleId,
  isRoleGrantId,
  isTenantId,
  toIdentityId,
  toPermissionPolicyId,
  toProvenanceNote,
  toRoleContextTimestamp,
  toRoleId,
  toRoleGrantId,
  toTenantId,
} from '../shared.js';
import type {
  IdentityId,
  PermissionPolicyId,
  RoleContextTimestamp,
  RoleGrantInactivityReason,
  RoleGrantId,
  RoleId,
  TenantId,
} from '../shared.js';

export const ROLE_GRANT_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Grant provenance
// ---------------------------------------------------------------------------

/** Who granted a role, when, and why (bounded note). */
export interface GrantProvenance {
  readonly grantedBy: string;
  readonly grantedAt: RoleContextTimestamp;
  readonly note?: string;
}

function validateProvenance(input: {
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly note?: string;
}): GrantProvenance {
  if (typeof input.grantedBy !== 'string' || input.grantedBy.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `grant provenance grantedBy must be a non-empty string, got ${JSON.stringify(input.grantedBy)}`,
    });
  }
  if (input.grantedBy.length > 128) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `grant provenance grantedBy must be at most 128 characters, got ${String(input.grantedBy.length)}`,
    });
  }
  const grantedAt = toRoleContextTimestamp(input.grantedAt);
  const note =
    input.note !== undefined ? toProvenanceNote(input.note) : undefined;
  return deepFreeze({
    grantedBy: input.grantedBy,
    grantedAt,
    ...(note !== undefined ? { note } : {}),
  } satisfies GrantProvenance);
}

// ---------------------------------------------------------------------------
// GrantedRole
// ---------------------------------------------------------------------------

/**
 * One granted role: identity × tenant × role, with provenance and a
 * recommended expiry window. The grant references its permission policy by
 * id — the policy itself stays an opaque external authority.
 */
export interface GrantedRole {
  readonly recordVersion: typeof ROLE_GRANT_RECORD_VERSION;
  readonly grantId: RoleGrantId;
  readonly identityId: IdentityId;
  readonly tenantId: TenantId;
  readonly roleId: RoleId;
  readonly policyId: PermissionPolicyId;
  readonly provenance: GrantProvenance;
  readonly validFrom: RoleContextTimestamp;
  readonly expiresAt?: RoleContextTimestamp;
}

export function grantRole(input: {
  readonly grantId: string;
  readonly identityId: string;
  readonly tenantId: string;
  readonly roleId: string;
  readonly policyId: string;
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly note?: string;
  readonly validFrom: string;
  readonly expiresAt?: string;
}): GrantedRole {
  const grantId = toRoleGrantId(input.grantId);
  const identityId = toIdentityId(input.identityId);
  const tenantId = toTenantId(input.tenantId);
  // Unknown role ids are a typed rejection (closed ROLE_IDS vocabulary).
  const roleId = toRoleId(input.roleId);
  const policyId = toPermissionPolicyId(input.policyId);
  const provenance = validateProvenance({
    grantedBy: input.grantedBy,
    grantedAt: input.grantedAt,
    ...(input.note !== undefined ? { note: input.note } : {}),
  });
  const validFrom = toRoleContextTimestamp(input.validFrom);
  const expiresAt =
    input.expiresAt !== undefined ? toRoleContextTimestamp(input.expiresAt) : undefined;
  if (expiresAt !== undefined && expiresAt <= validFrom) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `grant expiresAt must be after validFrom (validFrom: ${validFrom}, expiresAt: ${expiresAt})`,
      details: { validFrom, expiresAt },
    });
  }
  if (validFrom < provenance.grantedAt) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `grant validFrom must not precede provenance grantedAt (grantedAt: ${provenance.grantedAt}, validFrom: ${validFrom})`,
      details: { grantedAt: provenance.grantedAt, validFrom },
    });
  }
  return deepFreeze({
    recordVersion: ROLE_GRANT_RECORD_VERSION,
    grantId,
    identityId,
    tenantId,
    roleId,
    policyId,
    provenance,
    validFrom,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  } satisfies GrantedRole);
}

/** Structural (non-throwing) check for a GrantedRole. */
export function isGrantedRole(value: unknown): value is GrantedRole {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ROLE_GRANT_RECORD_VERSION) return false;
  if (!isRoleGrantId(candidate['grantId'])) return false;
  if (!isIdentityId(candidate['identityId'])) return false;
  if (!isTenantId(candidate['tenantId'])) return false;
  if (!isRoleId(candidate['roleId'])) return false;
  if (!isPermissionPolicyId(candidate['policyId'])) return false;
  if (!isRoleContextTimestamp(candidate['validFrom'])) return false;
  const expiresAt = candidate['expiresAt'];
  if (expiresAt !== undefined && !isRoleContextTimestamp(expiresAt)) return false;
  const provenance = candidate['provenance'];
  if (typeof provenance !== 'object' || provenance === null) return false;
  const provenanceRecord = provenance as Record<string, unknown>;
  if (typeof provenanceRecord['grantedBy'] !== 'string' || provenanceRecord['grantedBy'].length === 0) {
    return false;
  }
  if (!isRoleContextTimestamp(provenanceRecord['grantedAt'])) return false;
  const note = provenanceRecord['note'];
  if (note !== undefined && !isProvenanceNote(note)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Activity / expiry semantics (entitlements lineage style)
// ---------------------------------------------------------------------------

/** True iff the grant is active at `at`: started and not expired. */
export function isRoleGrantActive(grant: GrantedRole, at: string): boolean {
  const when = toRoleContextTimestamp(at);
  if (when < grant.validFrom) return false;
  if (grant.expiresAt !== undefined && when >= grant.expiresAt) return false;
  return true;
}

/** Why a grant is inactive at `at` (closed vocabulary; 'active' when active). */
export function roleGrantInactivityReason(
  grant: GrantedRole,
  at: string,
): RoleGrantInactivityReason {
  const when = toRoleContextTimestamp(at);
  if (when < grant.validFrom) return 'not-yet-active';
  if (grant.expiresAt !== undefined && when >= grant.expiresAt) return 'expired';
  return 'active';
}

/** Stable key for a grant: `<tenantId>:<identityId>:<roleId>:<grantId>`. */
export function grantedRoleKey(grant: GrantedRole): string {
  return `${grant.tenantId}:${grant.identityId}:${grant.roleId}:${grant.grantId}`;
}
