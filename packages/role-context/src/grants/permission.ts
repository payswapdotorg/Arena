/**
 * PermissionPolicy — an OPAQUE permission descriptor (Work Order B003;
 * spec/roles-and-contexts.md RC1.0 "Core distinction").
 *
 * RC1.0: "Changing the active role context ... never grants new
 * permissions." Permission is an EXTERNAL authority in Arena: the policy
 * internals are interpreted by the permission authority (B004 auth /
 * policy services), NOT by this package. @arena/role-context therefore:
 *
 *   - carries the descriptor as an opaque, deep-frozen, plain-JSON record;
 *   - validates ONLY its serializability — never its meaning;
 *   - NEVER derives, filters or rewrites it. No function in this package
 *     reads any field of `descriptor`.
 *
 * The structural invariant (activating a role can never change permissions)
 * is enforced by construction: `activateRole` (see workspace.ts) takes no
 * permission input of any kind and copies `permissionPolicy` by reference
 * into the new workspace; `permissionFingerprint` below gives callers and
 * tests a canonical byte-level comparison (reusing @arena/protocol-core's
 * canonicalJson — never reimplemented here) to prove the policy is
 * byte-identical across every role switch.
 */

import { canonicalJson } from '@arena/protocol-core';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import {
  assertPlainJson,
  deepFreeze,
  isPermissionPolicyId,
  isRoleContextTimestamp,
  isTenantId,
  toPermissionPolicyId,
  toRoleContextTimestamp,
  toTenantId,
} from '../shared.js';
import type { PermissionPolicyId, RoleContextTimestamp, TenantId } from '../shared.js';

export const PERMISSION_POLICY_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// PermissionPolicy
// ---------------------------------------------------------------------------

/**
 * A tenant-scoped permission policy: an OPAQUE descriptor issued by the
 * external permission authority. This package carries it; it never
 * interprets it.
 */
export interface PermissionPolicy {
  readonly recordVersion: typeof PERMISSION_POLICY_RECORD_VERSION;
  readonly policyId: PermissionPolicyId;
  readonly tenantId: TenantId;
  /**
   * Opaque descriptor — plain JSON so it is wire/canonically serializable,
   * but its CONTENT is owned by the external permission authority. Nothing
   * in @arena/role-context reads it.
   */
  readonly descriptor: Readonly<Record<string, unknown>>;
  readonly issuedAt: RoleContextTimestamp;
}

export function createPermissionPolicy(input: {
  readonly policyId: string;
  readonly tenantId: string;
  readonly descriptor: Readonly<Record<string, unknown>>;
  readonly issuedAt: string;
}): PermissionPolicy {
  const policyId = toPermissionPolicyId(input.policyId);
  const tenantId = toTenantId(input.tenantId);
  const issuedAt = toRoleContextTimestamp(input.issuedAt);
  if (typeof input.descriptor !== 'object' || input.descriptor === null || Array.isArray(input.descriptor)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_POLICY, {
      message: `permission policy descriptor must be a plain object, got ${typeof input.descriptor}`,
    });
  }
  assertPlainJson(input.descriptor, 'permission policy descriptor');
  return deepFreeze({
    recordVersion: PERMISSION_POLICY_RECORD_VERSION,
    policyId,
    tenantId,
    descriptor: input.descriptor,
    issuedAt,
  } satisfies PermissionPolicy);
}

/** Structural (non-throwing) check for a PermissionPolicy (shape only — the descriptor stays opaque). */
export function isPermissionPolicy(value: unknown): value is PermissionPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== PERMISSION_POLICY_RECORD_VERSION) return false;
  if (!isPermissionPolicyId(candidate['policyId'])) return false;
  if (!isTenantId(candidate['tenantId'])) return false;
  if (!isRoleContextTimestamp(candidate['issuedAt'])) return false;
  const descriptor = candidate['descriptor'];
  if (typeof descriptor !== 'object' || descriptor === null || Array.isArray(descriptor)) {
    return false;
  }
  return true;
}

/**
 * Canonical byte-level fingerprint of a permission policy: canonical JSON
 * over the whole record. Two policies with identical fingerprints are
 * byte-identical; the §5 invariant test uses this to prove switching the
 * active role never touches permissions.
 */
export function permissionFingerprint(policy: PermissionPolicy): string {
  return canonicalJson({
    recordVersion: policy.recordVersion,
    policyId: policy.policyId,
    tenantId: policy.tenantId,
    descriptor: policy.descriptor,
    issuedAt: policy.issuedAt,
  });
}
