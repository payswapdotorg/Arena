/**
 * Shared role-context value types (Work Order B003; spec/roles-and-contexts.md
 * RC1.0; architecture-lock rule 11 — customer data is tenant-scoped and never
 * silently reused across tenants).
 *
 * @arena/role-context is a DOMAIN package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer) — never a sibling domain package and
 * never a service. Tenant ids, identity ids, workspace ids, grant ids, policy
 * ids, surface ids and canonical timestamps are defined HERE as validated
 * branded plain-string types, exactly like @arena/entitlements' shared.ts;
 * they are structurally compatible with the corresponding security /
 * entitlements types (plain strings accept branded strings).
 *
 * Closed vocabularies owned here (the RC1.0 / handoff §7 product-truth sets):
 *   - ROLE_IDS             the 8 reference roles (RC1.0 "Role contexts");
 *   - CANONICAL_STATE_KINDS the 11-term product-truth taxonomy
 *                          (handoff §7 "Product truth vocabulary");
 *   - CANONICAL_OBJECT_KINDS the canonical Arena object kinds addressable by
 *                          role projections (v1: capability-case and the
 *                          contract namespaces it interacts with).
 */

import type { Brand } from '@arena/protocol-core';
import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — the single source of truth for this package's shapes.
// Mirrored by packages/role-context/scripts/generate-contracts.mjs; parity is
// asserted by src/contracts.parity.test.ts.
// ---------------------------------------------------------------------------

export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const IDENTITY_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const WORKSPACE_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const ROLE_GRANT_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const POLICY_ID_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const SURFACE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
export const PROJECTION_ID_PATTERN_SOURCE =
  '^[a-z][a-z0-9-]{0,63}(?:\\.[a-z][a-z0-9-]{0,63}){1,3}$';
export const ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const PROVENANCE_NOTE_PATTERN_SOURCE = '^\\S.{0,199}$';
export const ROLE_CONTEXT_SEMVER_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';
/** Canonical object reference: `<kind>:<objectId>@<semver>` (same-object rule). */
export const CANONICAL_OBJECT_REF_PATTERN_SOURCE =
  '^[a-z][a-z0-9-]{0,63}:[a-z0-9][a-z0-9._:/-]{0,253}@(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';

const TENANT_ID_PATTERN = new RegExp(TENANT_ID_PATTERN_SOURCE);
const IDENTITY_ID_PATTERN = new RegExp(IDENTITY_ID_PATTERN_SOURCE);
const WORKSPACE_ID_PATTERN = new RegExp(WORKSPACE_ID_PATTERN_SOURCE);
const ROLE_GRANT_ID_PATTERN = new RegExp(ROLE_GRANT_ID_PATTERN_SOURCE);
const POLICY_ID_PATTERN = new RegExp(POLICY_ID_PATTERN_SOURCE);
const SURFACE_ID_PATTERN = new RegExp(SURFACE_ID_PATTERN_SOURCE);
const PROJECTION_ID_PATTERN = new RegExp(PROJECTION_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE);
const PROVENANCE_NOTE_PATTERN = new RegExp(PROVENANCE_NOTE_PATTERN_SOURCE);
const SEMVER_PATTERN = new RegExp(ROLE_CONTEXT_SEMVER_PATTERN_SOURCE);
const CANONICAL_OBJECT_REF_PATTERN = new RegExp(CANONICAL_OBJECT_REF_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type TenantId = Brand<string, 'RoleContextTenantId'>;
export type IdentityId = Brand<string, 'RoleContextIdentityId'>;
export type WorkspaceId = Brand<string, 'RoleContextWorkspaceId'>;
export type RoleGrantId = Brand<string, 'RoleContextRoleGrantId'>;
export type PermissionPolicyId = Brand<string, 'RoleContextPermissionPolicyId'>;
export type SurfaceId = Brand<string, 'RoleContextSurfaceId'>;
export type RoleContextTimestamp = Brand<string, 'RoleContextTimestamp'>;
export type RoleContextSemVer = Brand<string, 'RoleContextSemVer'>;
export type CanonicalObjectRef = Brand<string, 'RoleContextCanonicalObjectRef'>;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The 8 reference roles from RC1.0 "Role contexts", in canonical registry
 * order (sorted by id for deterministic serialization).
 */
export const ROLE_IDS = Object.freeze([
  'administrator',
  'agent-builder',
  'evaluator',
  'expert',
  'marketplace-participant',
  'operator',
  'owner',
  'researcher',
] as const);
export type RoleId = (typeof ROLE_IDS)[number];

/**
 * The product-truth taxonomy (handoff §7 "Product truth vocabulary"; the
 * post-v1 "Product truth requirement"). Every user-visible state must be
 * classifiable into EXACTLY one of these kinds, and the UI may never
 * collapse two different kinds into one generic badge.
 */
export const CANONICAL_STATE_KINDS = Object.freeze([
  'verified-fact',
  'evidence',
  'expert-judgment',
  'model-output',
  'simulation-replay',
  'evaluation-result',
  'certification',
  'suggestion-hypothesis',
  'demo-state',
  'pending',
  'unknown',
] as const);
export type CanonicalStateKind = (typeof CANONICAL_STATE_KINDS)[number];

/**
 * Canonical Arena object kinds addressable by role projections (v1).
 *
 * DISCLOSURE (B003 design choice, per the work-order brief): these kind ids
 * are literal contract strings + structural payload typing — NOT types
 * imported from a sibling domain package. @arena/protocol-core exposes no
 * domain object-kind vocabulary, and importing @arena/capability-case (a
 * heavy domain package) would make the projection layer depend on domain
 * internals, which the brief forbids ("the projection layer is about the
 * LENS, not the domain internals"). The strings match the canonical
 * contract namespaces (contracts/capability-case, contracts/task, ...).
 */
export const CANONICAL_OBJECT_KINDS = Object.freeze([
  'capability-case',
  'task',
  'agent-body',
  'trajectory',
  'evaluation',
  'verification',
  'certification',
] as const);
export type CanonicalObjectKind = (typeof CANONICAL_OBJECT_KINDS)[number];

/** Role-grant temporal inactivity reasons (closed set). */
export const ROLE_GRANT_INACTIVITY_REASONS = Object.freeze([
  'active',
  'expired',
  'not-yet-active',
] as const);
export type RoleGrantInactivityReason = (typeof ROLE_GRANT_INACTIVITY_REASONS)[number];

// ---------------------------------------------------------------------------
// Predicates / validators
// ---------------------------------------------------------------------------

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isIdentityId(value: unknown): value is IdentityId {
  return typeof value === 'string' && IDENTITY_ID_PATTERN.test(value);
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

export function isRoleGrantId(value: unknown): value is RoleGrantId {
  return typeof value === 'string' && ROLE_GRANT_ID_PATTERN.test(value);
}

export function isPermissionPolicyId(value: unknown): value is PermissionPolicyId {
  return typeof value === 'string' && POLICY_ID_PATTERN.test(value);
}

export function isSurfaceId(value: unknown): value is SurfaceId {
  return typeof value === 'string' && SURFACE_ID_PATTERN.test(value);
}

export function isProjectionId(value: unknown): value is string {
  return typeof value === 'string' && PROJECTION_ID_PATTERN.test(value);
}

/** Timestamps are canonical ms-precision UTC ISO-8601 strings. */
export function isRoleContextTimestamp(value: unknown): value is RoleContextTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function isProvenanceNote(value: unknown): value is string {
  return typeof value === 'string' && PROVENANCE_NOTE_PATTERN.test(value);
}

/** Core-style exact semver (major.minor.patch, no prerelease/build). */
export function isRoleContextSemVer(value: unknown): value is RoleContextSemVer {
  return typeof value === 'string' && SEMVER_PATTERN.test(value);
}

export function isCanonicalObjectRef(value: unknown): value is CanonicalObjectRef {
  return typeof value === 'string' && CANONICAL_OBJECT_REF_PATTERN.test(value);
}

export function isRoleId(value: unknown): value is RoleId {
  return typeof value === 'string' && (ROLE_IDS as readonly string[]).includes(value);
}

export function isCanonicalStateKind(value: unknown): value is CanonicalStateKind {
  return (
    typeof value === 'string' &&
    (CANONICAL_STATE_KINDS as readonly string[]).includes(value)
  );
}

export function isCanonicalObjectKind(value: unknown): value is CanonicalObjectKind {
  return (
    typeof value === 'string' &&
    (CANONICAL_OBJECT_KINDS as readonly string[]).includes(value)
  );
}

export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function toTenantId(value: string): TenantId {
  if (!isTenantId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid tenant id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: TENANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toIdentityId(value: string): IdentityId {
  if (!isIdentityId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid identity id: ${JSON.stringify(value)}`,
      details: { pattern: IDENTITY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toWorkspaceId(value: string): WorkspaceId {
  if (!isWorkspaceId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid workspace id: ${JSON.stringify(value)}`,
      details: { pattern: WORKSPACE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRoleGrantId(value: string): RoleGrantId {
  if (!isRoleGrantId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid role grant id: ${JSON.stringify(value)}`,
      details: { pattern: ROLE_GRANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toPermissionPolicyId(value: string): PermissionPolicyId {
  if (!isPermissionPolicyId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid permission policy id: ${JSON.stringify(value)}`,
      details: { pattern: POLICY_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSurfaceId(value: string): SurfaceId {
  if (!isSurfaceId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid surface id: ${JSON.stringify(value)} (kebab-case identifier required)`,
      details: { pattern: SURFACE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRoleContextTimestamp(value: string): RoleContextTimestamp {
  if (!isRoleContextTimestamp(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid role-context timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-02-01T09:30:00.000Z)`,
      details: { pattern: ROLE_CONTEXT_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toProvenanceNote(value: string): string {
  if (!isProvenanceNote(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_GRANT, {
      message: `invalid provenance note: ${JSON.stringify(value)} (1..200 characters, no leading whitespace)`,
      details: { pattern: PROVENANCE_NOTE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRoleContextSemVer(value: string): RoleContextSemVer {
  if (!isRoleContextSemVer(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_REGISTRY, {
      message: `invalid version: ${JSON.stringify(value)} (expected exact major.minor.patch semver, no prerelease)`,
      details: { pattern: ROLE_CONTEXT_SEMVER_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCanonicalObjectRef(value: string): CanonicalObjectRef {
  if (!isCanonicalObjectRef(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `invalid canonical object ref: ${JSON.stringify(value)} (expected <kind>:<objectId>@<semver>, e.g. capability-case:case-42@1.2.0)`,
      details: { pattern: CANONICAL_OBJECT_REF_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toRoleId(value: string): RoleId {
  if (!isRoleId(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND, {
      message: `unknown role id: ${JSON.stringify(value)} (known: ${ROLE_IDS.join(', ')})`,
      details: { known: [...ROLE_IDS] },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Plain-JSON screening (canonical serializability of payloads)
// ---------------------------------------------------------------------------

/** True iff the value is plain JSON (canonically serializable, no undefined). */
export function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item));
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every((item) => isPlainJsonValue(item));
    }
    default:
      return false;
  }
}

/** Fail closed with ROLE_CONTEXT_INVALID_STATE when a payload is not plain JSON. */
export function assertPlainJson(value: unknown, field: string): void {
  if (!isPlainJsonValue(value)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_STATE, {
      message: `${field} must be plain JSON (canonically serializable: no undefined, non-finite numbers, bigints, dates or class instances)`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

/** Recursively freeze a plain-JSON domain object; frozen inputs stay frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
