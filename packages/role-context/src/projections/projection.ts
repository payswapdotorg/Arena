/**
 * Role-aware projection contracts (Work Order B003; spec/roles-and-contexts.md
 * RC1.0 "Same-object / different-lens rule").
 *
 * "A Capability Case remains the same canonical object regardless of role.
 * The object is shared; the projection is role-specific."
 *
 * The generic contract:
 *
 *   RoleProjectionDefinition<TCanonical, TProjection>
 *     - roleId          which role lens this is;
 *     - canonicalKind   which canonical object KIND it projects (closed v1
 *                       vocabulary — see shared.ts CANONICAL_OBJECT_KINDS
 *                       for the literal-contract-strings disclosure);
 *     - projectionKind  which lens (e.g. 'owner-lens');
 *     - project         a PURE selector/transform over the canonical input.
 *
 * applyRoleProjection(def, canonical) verifies at runtime that the canonical
 * input's kind matches the definition's canonicalKind — a wrong-kind
 * projection is a TYPED rejection (CANONICAL_KIND_MISMATCH), not a
 * best-effort render.
 *
 * The output RoleProjection CARRIES the canonical object identity it
 * projects (the `canonical` ref): a projection without its source object is
 * inexpressible — the same-object rule is structural. Consumers can always
 * trace a role view back to the ONE canonical object every role is viewing.
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import { getRoleDefinition, REFERENCE_ROLE_REGISTRY } from '../roles/registry.js';
import {
  CANONICAL_OBJECT_KINDS,
  deepFreeze,
  isCanonicalObjectKind,
  isProjectionId,
  isRoleId,
  isTenantId,
  toRoleId,
} from '../shared.js';
import type { CanonicalObjectKind, RoleId, SurfaceId, TenantId } from '../shared.js';

export const ROLE_PROJECTION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Canonical object identity (the same-object anchor)
// ---------------------------------------------------------------------------

/** The identity of ONE canonical Arena object: kind + tenant + id + version. */
export interface CanonicalObjectIdentity {
  readonly kind: CanonicalObjectKind;
  readonly tenant: TenantId;
  readonly objectId: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// The generic projection contract
// ---------------------------------------------------------------------------

/**
 * The generic role-projection contract: one role's LENS over one canonical
 * object kind. `project` must be pure and deterministic (no clock, no I/O,
 * no randomness) — same canonical input, same projection output.
 */
export interface RoleProjectionDefinition<TCanonical, TProjection> {
  readonly projectionId: string;
  readonly recordVersion: typeof ROLE_PROJECTION_RECORD_VERSION;
  readonly roleId: RoleId;
  readonly canonicalKind: CanonicalObjectKind;
  readonly projectionKind: string;
  readonly lensQuestion: string;
  readonly description: string;
  readonly project: (canonical: TCanonical) => TProjection;
}

/** The rendered role projection: lens metadata + role-specific payload. */
export interface RoleProjection {
  readonly recordVersion: typeof ROLE_PROJECTION_RECORD_VERSION;
  readonly projectionId: string;
  readonly roleId: RoleId;
  readonly canonicalKind: CanonicalObjectKind;
  /** The SAME canonical object every lens projects (same-object rule). */
  readonly canonical: CanonicalObjectIdentity;
  readonly lensQuestion: string;
  readonly emphasis: readonly SurfaceId[];
  readonly recommendedActions: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Minimal structural requirement on canonical inputs: they self-identify
 * (kind + tenant + objectId + version) — the same-object anchor every
 * projection must carry.
 */
export interface CanonicalObjectView {
  readonly kind: CanonicalObjectKind;
  readonly tenant: string;
  readonly objectId: string;
  readonly version: string;
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function validateCanonicalIdentity(
  canonical: CanonicalObjectView,
  canonicalKind: CanonicalObjectKind,
): void {
  if (!isTenantId(canonical.tenant)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `canonical object of kind ${canonicalKind} requires a valid tenant, got ${JSON.stringify(canonical.tenant)}`,
    });
  }
  if (
    typeof canonical.objectId !== 'string' ||
    canonical.objectId.length === 0 ||
    canonical.objectId.length > 255
  ) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `canonical object of kind ${canonicalKind} requires a 1..255 character objectId`,
    });
  }
  if (
    typeof canonical.version !== 'string' ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(canonical.version)
  ) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `canonical object of kind ${canonicalKind} requires an exact semver version, got ${JSON.stringify(canonical.version)}`,
    });
  }
}

/**
 * Apply a role projection to a canonical object. Runtime-checked kind match:
 * projecting a definition built for kind A onto an object of kind B is a
 * TYPED rejection (CANONICAL_KIND_MISMATCH) — projections are
 * canonical-object-based, never duck-typed.
 */
export function applyRoleProjection<TCanonical extends CanonicalObjectView, TProjection>(
  definition: RoleProjectionDefinition<TCanonical, TProjection>,
  canonical: TCanonical,
): TProjection {
  if (!isProjectionId(definition.projectionId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `invalid projection id: ${JSON.stringify(definition.projectionId)}`,
    });
  }
  if (!isRoleId(definition.roleId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND, {
      message: `unknown role id on projection: ${JSON.stringify(definition.roleId)}`,
    });
  }
  // The role must be a registry role (the lens vocabulary is closed).
  getRoleDefinition(REFERENCE_ROLE_REGISTRY, definition.roleId);
  if (!isCanonicalObjectKind(definition.canonicalKind)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `unknown canonical object kind on projection: ${JSON.stringify(definition.canonicalKind)}`,
    });
  }
  const actualKind = canonical.kind;
  if (!isCanonicalObjectKind(actualKind)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.CANONICAL_KIND_MISMATCH, {
      message: `canonical input has unknown kind: ${JSON.stringify(actualKind)} (known kinds: ${CANONICAL_OBJECT_KINDS.join(', ')})`,
    });
  }
  if (actualKind !== definition.canonicalKind) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.CANONICAL_KIND_MISMATCH, {
      message: `projection ${definition.projectionId} expects canonical kind '${definition.canonicalKind}' but received '${actualKind}' — a role lens never re-kinds a canonical object`,
      details: { expected: definition.canonicalKind, actual: actualKind },
    });
  }
  // The same-object anchor is validated BEFORE the lens runs: every
  // projection carries a well-formed canonical identity.
  validateCanonicalIdentity(canonical, definition.canonicalKind);
  return definition.project(canonical);
}

// ---------------------------------------------------------------------------
// Definition builder (validated, frozen metadata)
// ---------------------------------------------------------------------------

/**
 * Build a validated RoleProjectionDefinition. The `project` transform is
 * checked for the metadata invariants here; its output shape is the
 * definition author's responsibility (the reference lenses produce
 * RoleProjection records via roleProjectionPayload below).
 */
export function defineRoleProjection<TCanonical extends CanonicalObjectView, TProjection>(
  input: {
    readonly projectionId: string;
    readonly roleId: string;
    readonly canonicalKind: CanonicalObjectKind;
    readonly projectionKind: string;
    readonly lensQuestion: string;
    readonly description: string;
    readonly project: (canonical: TCanonical) => TProjection;
  },
): RoleProjectionDefinition<TCanonical, TProjection> {
  if (!isProjectionId(input.projectionId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `invalid projection id: ${JSON.stringify(input.projectionId)} (expected <kind>.<lens> dotted identifier)`,
    });
  }
  const roleId = toRoleId(input.roleId);
  if (!isCanonicalObjectKind(input.canonicalKind)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `unknown canonical object kind: ${JSON.stringify(input.canonicalKind)}`,
    });
  }
  if (typeof input.projectionKind !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.projectionKind)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: `invalid projection kind: ${JSON.stringify(input.projectionKind)} (kebab-case identifier required)`,
    });
  }
  if (typeof input.lensQuestion !== 'string' || input.lensQuestion.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: 'lensQuestion must be a non-empty string',
    });
  }
  if (typeof input.description !== 'string' || input.description.length === 0) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: 'description must be a non-empty string',
    });
  }
  if (typeof input.project !== 'function') {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: 'project must be a pure function (canonical) => projection',
    });
  }
  return deepFreeze({
    projectionId: input.projectionId,
    recordVersion: ROLE_PROJECTION_RECORD_VERSION,
    roleId,
    canonicalKind: input.canonicalKind,
    projectionKind: input.projectionKind,
    lensQuestion: input.lensQuestion,
    description: input.description,
    project: input.project,
  } satisfies RoleProjectionDefinition<TCanonical, TProjection>);
}

/**
 * Assemble a frozen RoleProjection record — the common output shape for
 * reference lenses. `emphasis` must be surfaces of the lensing role
 * (validated against the reference registry).
 */
export function roleProjectionRecord(input: {
  readonly projectionId: string;
  readonly roleId: RoleId;
  readonly canonical: CanonicalObjectIdentity;
  readonly lensQuestion: string;
  readonly emphasis: readonly string[];
  readonly recommendedActions: readonly string[];
  readonly payload: Readonly<Record<string, unknown>>;
}): RoleProjection {
  const role = getRoleDefinition(REFERENCE_ROLE_REGISTRY, input.roleId);
  const emphasis = input.emphasis.map((surface) => {
    if (!role.primarySurfaces.includes(surface as SurfaceId)) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
        message: `projection emphasis surface '${surface}' is not a primary surface of role ${input.roleId}`,
        details: { roleId: input.roleId, surface, roleSurfaces: [...role.primarySurfaces] },
      });
    }
    return surface as SurfaceId;
  });
  for (const action of input.recommendedActions) {
    if (typeof action !== 'string' || action.length === 0 || action.length > 200) {
      throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
        message: `recommended actions must be non-empty strings of at most 200 characters, got ${JSON.stringify(action)}`,
      });
    }
  }
  if (
    typeof input.payload !== 'object' ||
    input.payload === null ||
    Array.isArray(input.payload)
  ) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_PROJECTION, {
      message: 'projection payload must be a plain object',
    });
  }
  return deepFreeze({
    recordVersion: ROLE_PROJECTION_RECORD_VERSION,
    projectionId: input.projectionId,
    roleId: input.roleId,
    canonicalKind: input.canonical.kind,
    canonical: input.canonical,
    lensQuestion: input.lensQuestion,
    emphasis: Object.freeze([...emphasis]),
    recommendedActions: Object.freeze([...input.recommendedActions]),
    payload: input.payload,
  } satisfies RoleProjection);
}
