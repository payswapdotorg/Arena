/**
 * @arena/role-context — the role/context model and role-aware projection
 * contracts (Work Order B003; spec/roles-and-contexts.md RC1.0; issue #65).
 *
 * Public surface (dependency order):
 *   errors                       — closed ROLE_CONTEXT_* error taxonomy
 *                                  (fail-closed parser)
 *   shared                       — branded ids, patterns, closed
 *                                  vocabularies (8 roles, 11 canonical
 *                                  state kinds, canonical object kinds),
 *                                  deep freeze
 *   schemas                      — SchemaRef registry for the
 *                                  arena:schema/role-context/* namespace
 *   roles/registry               — the 8 RC1.0 reference roles + the
 *                                  versioned RoleRegistry
 *   grants/identity              — Identity + TenantMembership (chain links
 *                                  1–2)
 *   grants/permission            — PermissionPolicy (opaque external
 *                                  authority descriptor)
 *   grants/granted-role          — GrantedRole (provenance + recommended
 *                                  expiry)
 *   grants/workspace             — WorkspaceContext + ActiveRoleContext +
 *                                  activateRole / resolveActiveContext (the
 *                                  structural "active role ≠ permission"
 *                                  invariant)
 *   projections/projection       — generic
 *                                  RoleProjectionDefinition<TCanonical,
 *                                  TProjection> + applyRoleProjection
 *   projections/capability-case-lenses
 *                                — the 5 RC1.0 same-object/different-lens
 *                                  reference projections
 *   states/canonical-state       — the product-truth taxonomy:
 *                                  CanonicalStateKind + classifyState +
 *                                  the distinctStateKinds contract
 *
 * The package's ONLY workspace dependency is @arena/protocol-core
 * (protocol layer) — never a sibling domain package, never a service.
 * Everything is pure, deterministic TypeScript: no clock reads, no I/O,
 * no randomness; identical inputs always produce identical outputs.
 */

export * from './errors.js';
export * from './shared.js';
export * from './schemas.js';
export * from './roles/registry.js';
export * from './grants/identity.js';
export * from './grants/permission.js';
export * from './grants/granted-role.js';
export * from './grants/workspace.js';
export * from './projections/projection.js';
export * from './projections/capability-case-lenses.js';
export * from './states/canonical-state.js';

import { ROLE_CONTEXT_SCHEMA_VERSION } from './schemas.js';

/** Version of this package's protocol surface. */
export const ROLE_CONTEXT_VERSION = ROLE_CONTEXT_SCHEMA_VERSION;
