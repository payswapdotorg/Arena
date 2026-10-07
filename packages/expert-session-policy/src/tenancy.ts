/**
 * Cross-tenant pack reuse authorization (Work Order C018; spec/security.md
 * S1.0 "Customer data is never used for cross-tenant learning without
 * explicit authorization"; AGENTS.md tenancy law; architecture-lock rule
 * 11 — tenant data never silently cross-reused).
 *
 * Pack reads and resolutions are TENANT-SCOPED. Reusing another tenant's
 * pack requires an EXPLICIT typed authorization bound to the exact pack
 * id + version + consuming tenant, with expiry and revocation. Every
 * check returns a closed machine-readable verdict — never a bare boolean,
 * never a silent fallback to the source tenant's pack.
 */

import { ExpertSessionPolicyError } from './errors.js';
import { deepFreeze, expectPolicyId, expectPolicyTimestamp, expectTenantId } from './shared.js';
import type { PolicyPack } from './pack.js';

/** Wire version of the cross-tenant authorization shape. */
export const CROSS_TENANT_AUTHORIZATION_VERSION = 1 as const;

/** The closed authorization-decision reason vocabulary. */
export const CROSS_TENANT_AUTHORIZATION_REASONS = Object.freeze([
  'authorized',
  'authorization-missing',
  'authorization-expired',
  'authorization-revoked',
  'authorization-pack-mismatch',
  'authorization-tenant-mismatch',
  'authorization-version-mismatch',
] as const);
export type CrossTenantAuthorizationReason = (typeof CROSS_TENANT_AUTHORIZATION_REASONS)[number];

/**
 * An explicit grant: consumingTenantId may resolve `packId` @ `packVersion`
 * owned by sourceTenantId until `expiresAt` (null = no expiry), unless
 * revoked. Revocation is a STATUS TRANSITION (records stay auditable).
 */
export interface CrossTenantPackAuthorization {
  readonly authorizationVersion: typeof CROSS_TENANT_AUTHORIZATION_VERSION;
  readonly authorizationId: string;
  readonly packId: string;
  readonly packVersion: number;
  readonly sourceTenantId: string;
  readonly consumingTenantId: string;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface CreateCrossTenantAuthorizationInput {
  readonly authorizationId: string;
  readonly packId: string;
  readonly packVersion: number;
  readonly sourceTenantId: string;
  readonly consumingTenantId: string;
  readonly now: number | string | Date;
  readonly expiresAt?: number | string | Date | null;
}

export function createCrossTenantPackAuthorization(
  input: CreateCrossTenantAuthorizationInput,
): CrossTenantPackAuthorization {
  const authorizationId = expectPolicyId(input.authorizationId, 'CrossTenantPackAuthorization.authorizationId');
  const packId = expectPolicyId(input.packId, 'CrossTenantPackAuthorization.packId');
  if (!Number.isInteger(input.packVersion) || input.packVersion < 1) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUTHORIZATION', {
      message: 'authorization packVersion must be an integer >= 1',
      details: { received: String(input.packVersion) },
    });
  }
  const sourceTenantId = expectTenantId(input.sourceTenantId, 'CrossTenantPackAuthorization.sourceTenantId');
  const consumingTenantId = expectTenantId(
    input.consumingTenantId,
    'CrossTenantPackAuthorization.consumingTenantId',
  );
  if (sourceTenantId === consumingTenantId) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUTHORIZATION', {
      message: 'a cross-tenant authorization must span two DIFFERENT tenants (same-tenant is not cross-tenant)',
      details: { tenantId: sourceTenantId },
    });
  }
  const grantedAt = expectPolicyTimestamp(
    input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'number' ? new Date(input.now).toISOString() : input.now,
    'CrossTenantPackAuthorization.grantedAt',
  );
  const expiresAt =
    input.expiresAt === undefined || input.expiresAt === null
      ? null
      : expectPolicyTimestamp(
          input.expiresAt instanceof Date
            ? input.expiresAt.toISOString()
            : typeof input.expiresAt === 'number'
              ? new Date(input.expiresAt).toISOString()
              : input.expiresAt,
          'CrossTenantPackAuthorization.expiresAt',
        );
  if (expiresAt !== null && Date.parse(expiresAt) <= Date.parse(grantedAt)) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_AUTHORIZATION', {
      message: 'authorization expiresAt must be after grantedAt',
      details: { grantedAt, expiresAt },
    });
  }
  return deepFreeze({
    authorizationVersion: CROSS_TENANT_AUTHORIZATION_VERSION,
    authorizationId,
    packId,
    packVersion: input.packVersion,
    sourceTenantId,
    consumingTenantId,
    grantedAt,
    expiresAt,
    revokedAt: null,
  });
}

/** Revocation — a status transition, never a record removal. */
export function revokeCrossTenantPackAuthorization(
  authorization: CrossTenantPackAuthorization,
  now: number | string | Date,
): CrossTenantPackAuthorization {
  const revokedAt = expectPolicyTimestamp(
    now instanceof Date ? now.toISOString() : typeof now === 'number' ? new Date(now).toISOString() : now,
    'CrossTenantPackAuthorization.revokedAt',
  );
  if (authorization.revokedAt !== null) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_TRANSITION', {
      message: `authorization '${authorization.authorizationId}' is already revoked (revocation is a single status transition)`,
      details: { authorizationId: authorization.authorizationId },
    });
  }
  return deepFreeze({ ...authorization, revokedAt });
}

/** The machine-readable cross-tenant authorization verdict. */
export interface CrossTenantAuthorizationCheck {
  readonly allowed: boolean;
  readonly reason: CrossTenantAuthorizationReason;
  readonly authorizationId: string | null;
  readonly packRef: { readonly packId: string; readonly version: number };
  readonly consumingTenantId: string;
}

/**
 * May `consumingTenantId` resolve `pack` as of `asOf`? The authorization
 * must exist, match the exact pack id + version, belong to the consuming
 * tenant, be unexpired and unrevoked. Anything else denies — fail-closed.
 */
export function checkCrossTenantPackAuthorization(
  authorization: CrossTenantPackAuthorization | null | undefined,
  pack: PolicyPack,
  consumingTenantId: string,
  asOf: string,
): CrossTenantAuthorizationCheck {
  const packRef = deepFreeze({ packId: pack.packId, version: pack.version });
  const deny = (reason: CrossTenantAuthorizationReason, authorizationId: string | null = null): CrossTenantAuthorizationCheck =>
    deepFreeze({ allowed: false, reason, authorizationId, packRef, consumingTenantId });
  if (authorization === null || authorization === undefined) {
    return deny('authorization-missing');
  }
  if (authorization.packId !== pack.packId) {
    return deny('authorization-pack-mismatch', authorization.authorizationId);
  }
  if (authorization.packVersion !== pack.version) {
    return deny('authorization-version-mismatch', authorization.authorizationId);
  }
  if (authorization.sourceTenantId !== pack.tenantId || authorization.consumingTenantId !== consumingTenantId) {
    return deny('authorization-tenant-mismatch', authorization.authorizationId);
  }
  if (authorization.revokedAt !== null) {
    return deny('authorization-revoked', authorization.authorizationId);
  }
  if (authorization.expiresAt !== null && Date.parse(asOf) >= Date.parse(authorization.expiresAt)) {
    return deny('authorization-expired', authorization.authorizationId);
  }
  return deepFreeze({
    allowed: true,
    reason: 'authorized',
    authorizationId: authorization.authorizationId,
    packRef,
    consumingTenantId,
  });
}

/** Guard form: throws the typed CROSS_TENANT_POLICY failure on denial. */
export function assertCrossTenantPackAuthorized(
  authorization: CrossTenantPackAuthorization | null | undefined,
  pack: PolicyPack,
  consumingTenantId: string,
  asOf: string,
): void {
  const check = checkCrossTenantPackAuthorization(authorization, pack, consumingTenantId, asOf);
  if (!check.allowed) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY', {
      message: `cross-tenant pack reuse denied (${check.reason}): tenant '${consumingTenantId}' cannot resolve pack '${pack.packId}' v${String(pack.version)} of tenant '${pack.tenantId}' without an explicit typed authorization`,
      details: { reason: check.reason, packRef: check.packRef, consumingTenantId, packOwnerTenant: pack.tenantId },
    });
  }
}
