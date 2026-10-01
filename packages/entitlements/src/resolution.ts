/**
 * Tenant-scoped grant resolution with fail-closed defaults (Work Order A033;
 * requirements R31, R34; architecture-lock rule 11 — customer data is
 * tenant-scoped and never silently reused across tenants).
 *
 * Resolution is a PURE deterministic function of (grants, tenantId,
 * featureKey, at): no clock, no I/O. Fail-closed everywhere:
 *   - no grant for the feature at all        → denied, 'no-matching-feature';
 *   - grants exist but belong to other tenants → denied, 'tenant-mismatch'
 *     (a cross-tenant read can NEVER produce an allow);
 *   - tenant-matching grants exist but none is active → denied, with the
 *     closed inactivity precedence revoked > expired > not-yet-active;
 *   - only an active grant yields an allow, returning the active grants
 *     deterministically ordered by (issuedAt, grantId).
 *
 * Feature flags layer on top with the same fail-closed posture: an active
 * disabled flag DENIES (deny overrides), no flag grants at all means
 * 'flag-absent' (the caller's policy decides), and only an active enabled
 * flag permits.
 */

import { grantInactivityReason, isGrantActive } from './grant.js';
import type { EntitlementGrant, FeatureFlagGrant, GrantInactivityReason } from './grant.js';
import { ENTITLEMENT_ERROR_CODES, EntitlementError } from './errors.js';
import { GRANT_RESOLUTION_REASONS } from './shared.js';
import { isFeatureKey, isMeterTimestamp, isTenantId, toFeatureKey, toMeterTimestamp, toTenantId } from './shared.js';
import type { FeatureFlagReason, GrantResolutionReason } from './shared.js';

/** The result of resolving entitlements for one tenant + feature at a time. */
export interface GrantResolution {
  readonly allowed: boolean;
  readonly reason: GrantResolutionReason;
  /** Active grants (deterministically ordered); empty unless allowed. */
  readonly grants: readonly EntitlementGrant[];
}

/**
 * Resolve entitlements for (tenantId, featureKey) at time `at`.
 * FAILS CLOSED: every non-allow path above returns allowed: false.
 */
export function resolveEntitlements(
  grants: readonly EntitlementGrant[],
  tenantId: string,
  featureKey: string,
  at: string,
): GrantResolution {
  const tenant = toTenantId(tenantId);
  const feature = toFeatureKey(featureKey);
  const when = toMeterTimestamp(at);

  const matching = grants.filter((grant) => grant.featureKey === feature);
  if (matching.length === 0) {
    return { allowed: false, reason: 'no-matching-feature', grants: [] };
  }
  const tenantMatching = matching.filter((grant) => grant.tenantId === tenant);
  if (tenantMatching.length === 0) {
    return { allowed: false, reason: 'tenant-mismatch', grants: [] };
  }
  const active = tenantMatching.filter((grant) => isGrantActive(grant, when));
  if (active.length > 0) {
    const ordered = [...active].sort((a, b) =>
      a.issuedAt === b.issuedAt
        ? a.grantId.localeCompare(b.grantId)
        : a.issuedAt.localeCompare(b.issuedAt),
    );
    return { allowed: true, reason: 'grant-match', grants: ordered };
  }
  // Closed inactivity precedence: revoked > expired > not-yet-active.
  const reasons: readonly GrantInactivityReason[] = tenantMatching.map((grant) =>
    grantInactivityReason(grant, when),
  );
  let reason: GrantResolutionReason = 'grant-not-yet-active';
  if (reasons.includes('revoked')) reason = 'grant-revoked';
  else if (reasons.includes('expired')) reason = 'grant-expired';
  return { allowed: false, reason, grants: [] };
}

/** The result of evaluating feature-flag grants for one tenant + feature. */
export interface FeatureFlagDecision {
  readonly permitted: boolean;
  readonly reason: FeatureFlagReason;
}

/**
 * Evaluate feature-flag entitlements at time `at`. Deny overrides: ANY active
 * flag grant with enabled: false denies the feature; otherwise an active
 * enabled flag permits it; with no active flag grants at all the decision is
 * 'flag-absent' (not permitted, not disabled — the caller's policy decides).
 */
export function evaluateFeatureFlag(
  grants: readonly EntitlementGrant[],
  tenantId: string,
  featureKey: string,
  at: string,
): FeatureFlagDecision {
  const tenant = toTenantId(tenantId);
  const feature = toFeatureKey(featureKey);
  const when = toMeterTimestamp(at);

  const flags = grants.filter(
    (grant): grant is FeatureFlagGrant =>
      grant.kind === 'feature-flag' &&
      grant.tenantId === tenant &&
      grant.featureKey === feature &&
      isGrantActive(grant, when),
  );
  if (flags.length === 0) return { permitted: false, reason: 'flag-absent' };
  if (flags.some((flag) => !flag.enabled)) {
    return { permitted: false, reason: 'flag-disabled' };
  }
  return { permitted: true, reason: 'flag-enabled' };
}

/**
 * Guard form of tenant scoping for entitlement access: throws
 * ENTITLEMENT_TENANT_MISMATCH when `resourceTenant` differs from the
 * accessing tenant. Fail-closed: an invalid resource tenant also throws.
 */
export function assertEntitlementTenant(
  accessorTenant: string,
  resourceTenant: string,
): void {
  const accessor = toTenantId(accessorTenant);
  if (!isTenantId(resourceTenant) || resourceTenant !== accessor) {
    throw new EntitlementError(ENTITLEMENT_ERROR_CODES.TENANT_MISMATCH, {
      message: `entitlement resource belongs to tenant ${JSON.stringify(resourceTenant)}, not ${JSON.stringify(accessor)} — cross-tenant entitlement access fails closed`,
      details: { accessorTenant: accessor, resourceTenant },
    });
  }
}

/** Structural (non-throwing) validation helper for resolution inputs. */
export function isResolutionInput(
  tenantId: unknown,
  featureKey: unknown,
  at: unknown,
): boolean {
  return isTenantId(tenantId) && isFeatureKey(featureKey) && isMeterTimestamp(at);
}

/** All resolution reasons (closed vocabulary, exported for consumers). */
export const ENTITLEMENT_RESOLUTION_REASONS = GRANT_RESOLUTION_REASONS;
