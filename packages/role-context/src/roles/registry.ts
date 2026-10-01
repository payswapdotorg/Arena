/**
 * Reference role registry (Work Order B003; spec/roles-and-contexts.md RC1.0
 * "Role contexts"; docs/LLM-ARCHITECT-HANDOFF.md §5 "Role architecture").
 *
 * The 8 reference roles are immutable data, transcribed VERBATIM from RC1.0:
 * goal and primary surfaces of each role. A RoleDefinition carries a stable
 * per-role `version`; the registry itself is versioned (`registryVersion`,
 * RoleRegistryVersion) and append-only in spirit:
 *
 *   - ADDING a new role definition      → registry minor bump;
 *   - CHANGING/REMOVING an existing one → registry major bump (breaking).
 *
 * The registry never models permissions. A role is a LENS (goal + surfaces);
 * what an identity may DO is decided by the external permission authority
 * (see grants/permission.ts — PermissionPolicy is an opaque descriptor).
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import { deepFreeze, isRoleId, isRoleContextSemVer, isSurfaceId, toSurfaceId } from '../shared.js';
import type { RoleContextSemVer, RoleId, SurfaceId } from '../shared.js';

export const ROLE_DEFINITION_RECORD_VERSION = 1 as const;
export const ROLE_REGISTRY_RECORD_VERSION = 1 as const;

/** Version of the reference RoleRegistry (RoleRegistryVersion). */
export const ROLE_REGISTRY_VERSION = '1.0.0' as RoleContextSemVer;

/** Stable per-role definition version for the 8 v1 reference roles. */
export const REFERENCE_ROLE_DEFINITION_VERSION = '1.0.0' as RoleContextSemVer;

// ---------------------------------------------------------------------------
// RoleDefinition
// ---------------------------------------------------------------------------

/**
 * One reference role: id, display name, goal (RC1.0 verbatim) and primary
 * surfaces (RC1.0 verbatim, normalized to kebab-case surface ids).
 */
export interface RoleDefinition {
  readonly recordVersion: typeof ROLE_DEFINITION_RECORD_VERSION;
  readonly roleId: RoleId;
  readonly name: string;
  readonly goal: string;
  readonly primarySurfaces: readonly SurfaceId[];
  readonly version: RoleContextSemVer;
}

const ROLE_DEFINITION_DATA: ReadonlyArray<
  Pick<RoleDefinition, 'roleId' | 'name' | 'goal'> & { readonly surfaces: readonly string[] }
> = [
  {
    roleId: 'owner',
    name: 'Owner / Customer',
    goal: 'Understand capability gaps, track outcomes, procure expertise, and consume released capabilities.',
    surfaces: [
      'capability-inbox',
      'active-cases',
      'progress-outcomes',
      'body-library',
      'marketplace',
      'release-adoption',
    ],
  },
  {
    roleId: 'agent-builder',
    name: 'Agent Builder',
    goal: 'Assemble and improve Agent Bodies.',
    surfaces: [
      'body-studio',
      'skills',
      'tools',
      'knowledge',
      'possession-matrix',
      'compatibility',
      'certification',
      'release',
    ],
  },
  {
    roleId: 'expert',
    name: 'Expert',
    goal: 'Perform high-value professional work.',
    surfaces: [
      'assigned-work',
      'workbench',
      'evidence',
      'review',
      'compensation-status',
      'capability-history',
    ],
  },
  {
    roleId: 'evaluator',
    name: 'Evaluator',
    goal: 'Make "good" measurable.',
    surfaces: [
      'evaluator-builder',
      'criteria',
      'verifier-bindings',
      'suites',
      'runs',
      'failure-analysis',
    ],
  },
  {
    roleId: 'researcher',
    name: 'Researcher',
    goal: 'Discover capability boundaries and measure improvement.',
    surfaces: [
      'benchmark-lab',
      'experiments',
      'body-substrate-comparisons',
      'capability-graph',
      'datasets',
      'research-reports',
    ],
  },
  {
    roleId: 'operator',
    name: 'Operator',
    goal: 'Keep Arena healthy and understandable.',
    surfaces: [
      'jobs',
      'environments',
      'telemetry',
      'slos',
      'incidents',
      'audit',
      'quotas',
    ],
  },
  {
    roleId: 'marketplace-participant',
    name: 'Marketplace Participant',
    goal: 'Publish, discover, and use capability artifacts.',
    surfaces: [
      'catalog',
      'artifact-detail',
      'provenance',
      'verification',
      'offers-grants',
      'review',
      'usage',
    ],
  },
  {
    roleId: 'administrator',
    name: 'Administrator',
    goal: 'Manage identity, tenant policy, entitlements, integrations, and audit.',
    surfaces: ['members', 'roles', 'policies', 'providers', 'entitlements', 'audit'],
  },
];

function toRoleDefinition(
  data: (typeof ROLE_DEFINITION_DATA)[number],
): RoleDefinition {
  const surfaces: SurfaceId[] = data.surfaces.map((surface) => toSurfaceId(surface));
  return deepFreeze({
    recordVersion: ROLE_DEFINITION_RECORD_VERSION,
    roleId: data.roleId,
    name: data.name,
    goal: data.goal,
    primarySurfaces: Object.freeze(surfaces),
    version: REFERENCE_ROLE_DEFINITION_VERSION,
  } satisfies RoleDefinition);
}

// ---------------------------------------------------------------------------
// RoleRegistry
// ---------------------------------------------------------------------------

/**
 * The versioned role registry: every known role definition, deterministically
 * ordered by roleId. Append-only-style versioned (see the module doc).
 */
export interface RoleRegistry {
  readonly recordVersion: typeof ROLE_REGISTRY_RECORD_VERSION;
  readonly registryVersion: RoleContextSemVer;
  readonly roles: readonly RoleDefinition[];
}

function buildReferenceRoleRegistry(): RoleRegistry {
  const roles = ROLE_DEFINITION_DATA.map(toRoleDefinition).sort((a, b) =>
    a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0,
  );
  return deepFreeze({
    recordVersion: ROLE_REGISTRY_RECORD_VERSION,
    registryVersion: ROLE_REGISTRY_VERSION,
    roles: Object.freeze(roles),
  } satisfies RoleRegistry);
}

/** The frozen RC1.0 reference registry (8 roles, registryVersion 1.0.0). */
export const REFERENCE_ROLE_REGISTRY: RoleRegistry = buildReferenceRoleRegistry();

/** All role ids in the registry, in canonical (sorted) order. */
export function listRoleIds(registry: RoleRegistry): readonly RoleId[] {
  return registry.roles.map((role) => role.roleId);
}

/**
 * Look up one role definition. Unknown role ids are a TYPED rejection
 * (ROLE_NOT_FOUND) — never a silent undefined.
 */
export function getRoleDefinition(registry: RoleRegistry, roleId: string): RoleDefinition {
  if (!isRoleId(roleId)) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND, {
      message: `unknown role id: ${JSON.stringify(roleId)} (known: ${registry.roles
        .map((role) => role.roleId)
        .join(', ')})`,
      details: { known: registry.roles.map((role) => role.roleId) },
    });
  }
  const found = registry.roles.find((role) => role.roleId === roleId);
  if (found === undefined) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.ROLE_NOT_FOUND, {
      message: `role id ${JSON.stringify(roleId)} is not in registry version ${registry.registryVersion}`,
      details: { registryVersion: registry.registryVersion, roleId },
    });
  }
  return found;
}

// ---------------------------------------------------------------------------
// Structural validation / parsing (loads from stores)
// ---------------------------------------------------------------------------

function invalidRegistry(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_REGISTRY, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Structural (non-throwing) check for a RoleDefinition. */
export function isRoleDefinition(value: unknown): value is RoleDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ROLE_DEFINITION_RECORD_VERSION) return false;
  if (!isRoleId(candidate['roleId'])) return false;
  if (typeof candidate['name'] !== 'string' || candidate['name'].length === 0) return false;
  if (typeof candidate['goal'] !== 'string' || candidate['goal'].length === 0) return false;
  if (!isRoleContextSemVer(candidate['version'])) return false;
  const surfaces = candidate['primarySurfaces'];
  if (!Array.isArray(surfaces) || surfaces.length === 0) return false;
  if (!surfaces.every((surface) => isSurfaceId(surface))) return false;
  return true;
}

/** Structural (non-throwing) check for a RoleRegistry. */
export function isRoleRegistry(value: unknown): value is RoleRegistry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ROLE_REGISTRY_RECORD_VERSION) return false;
  if (!isRoleContextSemVer(candidate['registryVersion'])) return false;
  const roles = candidate['roles'];
  if (!Array.isArray(roles) || roles.length === 0) return false;
  if (!roles.every((role) => isRoleDefinition(role))) return false;
  const ids = roles.map((role) => (role as RoleDefinition).roleId);
  if (new Set(ids).size !== ids.length) return false;
  const sorted = [...ids].sort();
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] !== sorted[i]) return false;
  }
  return true;
}

/**
 * Validate and deep-freeze a RoleRegistry loaded from a store. Fails closed
 * on any malformed shape (INVALID_REGISTRY) and — REQUIRED by B003 — on a
 * registry version the consumer does not expect (REGISTRY_VERSION_MISMATCH):
 * a future registry (e.g. 2.0.0) can never be silently interpreted by code
 * built against 1.0.0.
 */
export function toRoleRegistry(
  value: unknown,
  expectedRegistryVersion: string = ROLE_REGISTRY_VERSION,
): RoleRegistry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidRegistry(`a role registry must be a plain object, got ${typeof value}`);
  }
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ROLE_REGISTRY_RECORD_VERSION) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `unsupported role registry record version: ${String(candidate['recordVersion'])} (expected ${String(ROLE_REGISTRY_RECORD_VERSION)})`,
    });
  }
  const registryVersion = candidate['registryVersion'];
  if (!isRoleContextSemVer(registryVersion)) {
    invalidRegistry(`invalid registry version: ${JSON.stringify(registryVersion)}`);
  }
  if (registryVersion !== expectedRegistryVersion) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.REGISTRY_VERSION_MISMATCH, {
      message: `role registry version mismatch: registry is ${registryVersion}, consumer expects ${expectedRegistryVersion}`,
      details: { registryVersion, expectedRegistryVersion },
    });
  }
  const roles = candidate['roles'];
  if (!Array.isArray(roles) || roles.length === 0) {
    invalidRegistry('role registry roles must be a non-empty array of role definitions');
  }
  const parsed: RoleDefinition[] = [];
  const seen = new Set<string>();
  for (const role of roles) {
    if (!isRoleDefinition(role)) {
      invalidRegistry(`invalid role definition: ${JSON.stringify(role)}`);
    }
    if (seen.has(role.roleId)) {
      invalidRegistry(`duplicate role id in registry: ${role.roleId}`);
    }
    seen.add(role.roleId);
    parsed.push(
      deepFreeze({
        recordVersion: role.recordVersion,
        roleId: role.roleId,
        name: role.name,
        goal: role.goal,
        primarySurfaces: Object.freeze([...role.primarySurfaces]),
        version: role.version,
      } satisfies RoleDefinition),
    );
  }
  parsed.sort((a, b) => (a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0));
  return deepFreeze({
    recordVersion: ROLE_REGISTRY_RECORD_VERSION,
    registryVersion: registryVersion as RoleContextSemVer,
    roles: Object.freeze(parsed),
  } satisfies RoleRegistry);
}
