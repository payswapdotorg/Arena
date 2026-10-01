# @arena/role-context

The role/context model and role-aware projection contracts for Arena
(Work Order B003; spec/roles-and-contexts.md RC1.0; issue #65).

`@arena/role-context` is a DOMAIN package whose only workspace import is
`@arena/protocol-core` (protocol layer) — never a sibling domain package and
never a service. It owns the RC1.0 grant chain:

```
Identity → TenantMembership → PermissionPolicy → GrantedRole →
ActiveRoleContext → UI workflow
```

and the two product-truth contracts B001's shell and B007's cockpit will
consume: role-aware projections and canonical state classification.

## What it owns

- **Reference role registry** (`src/roles/`): the 8 RC1.0 reference roles —
  `owner`, `agent-builder`, `expert`, `evaluator`, `researcher`,
  `operator`, `marketplace-participant`, `administrator` — each a
  `RoleDefinition { recordVersion, roleId, name, goal, primarySurfaces,
  version }` transcribed verbatim from RC1.0, in a versioned
  `RoleRegistry` (append-only-style: add ⇒ minor bump, change/remove ⇒
  major bump). Unknown role ids are a typed rejection (`ROLE_NOT_FOUND`);
  a registry whose version the consumer does not expect is rejected
  (`REGISTRY_VERSION_MISMATCH`), never silently interpreted.
- **Grant chain** (`src/grants/`): `Identity`, `TenantMembership`
  (a scope fact, never a permission), `PermissionPolicy` — an OPAQUE
  descriptor issued by the external permission authority, carried and
  deep-frozen but never interpreted (no function in this package reads any
  field of `descriptor`) — `GrantedRole` (identity × tenant × role + grant
  provenance + recommended expiry in the entitlements lineage style),
  `ActiveRoleContext` (the single currently-selected role + activation
  provenance + preserved display context) and `WorkspaceContext`
  (tenant/workspace + granted-role set + opaque policy + active role).
- **The structural invariant** (`src/grants/workspace.ts`): activating a
  role can NEVER change permissions. `activateRole(workspace, roleId,
  activatedAt, preserved?)` has no permission-shaped parameter at all; the
  returned workspace carries `permissionPolicy` and `grantedRoles` over BY
  REFERENCE. Typed rejections: `ROLE_NOT_GRANTED` (ungranted activation),
  `TENANT_SCOPE_VIOLATION` (cross-tenant — a tenant-A grant can never
  activate in tenant B, and cannot even enter a tenant-B workspace),
  `GRANT_EXPIRED` / `GRANT_INACTIVE` (temporal), `ROLE_NOT_FOUND`
  (unknown id). A dedicated test asserts the permission fingerprint
  (canonical JSON over policy + grant set) is byte-identical across every
  switch.
- **Role-aware projections** (`src/projections/`): the generic
  `RoleProjectionDefinition<TCanonical, TProjection>` (role id, canonical
  object kind, projection kind, pure selector) + `applyRoleProjection`
  with a runtime-checked canonical-kind match (`CANONICAL_KIND_MISMATCH`
  on wrong kind), and the five RC1.0 same-object/different-lens reference
  projections for ONE canonical Capability Case — Owner ("Why is my agent
  struggling?"), Expert ("What work am I being asked to perform?"),
  Builder ("What capability is missing from the Body?"), Researcher
  ("What evidence supports the capability hypothesis?"), Operator ("Is
  the workflow/job healthy?"). Every projection CARRIES the canonical
  object identity it projects — the same-object rule is structural.
- **Canonical state classification** (`src/states/`): the product-truth
  taxonomy (handoff §7) as a closed 11-kind `CanonicalStateKind` union —
  verified-fact, evidence, expert-judgment, model-output,
  simulation-replay, evaluation-result, certification,
  suggestion-hypothesis, demo-state, pending, unknown — plus the TOTAL
  `classifyState` (anything unclassifiable is `unknown`, never an error)
  and the distinctStateKinds contract: `stateKindDisplayGroup` is
  injective (each kind is its own display group) and
  `areStateKindsDisplayEquivalent` is true ONLY for kind identity, so the
  UI can never collapse two product-truth kinds into one badge.

## Design disclosures (B003 choices)

- **Canonical object kinds are literal contract strings + structural
  payload typing** (`CANONICAL_OBJECT_KINDS` in `src/shared.ts`), NOT types
  imported from a sibling domain package: `@arena/protocol-core` exposes no
  domain object-kind vocabulary, and importing `@arena/capability-case`
  would make the projection layer depend on domain internals ("the
  projection layer is about the LENS, not the domain internals").
- **`CapabilityCaseView` is a narrow structural VIEW owned by this
  package**, not the capability-case domain model. The read model (B005)
  is expected to map canonical case records into this view.
- **Permission stays an external authority**: this package models the
  policy as an opaque descriptor and models NOTHING about policy
  internals, evaluation or enforcement (B004 owns identity/session
  integration; the permission authority interprets descriptors).
- **Grant revocation is not modeled** — the recommended v1 pattern is
  expiry + re-grant; full append-only grant lineage belongs to the
  auth/entitlements authority (see Limitations).

## Generated contracts

`scripts/generate-contracts.mjs` (house pattern of
`packages/expert-registry/scripts/generate-contracts.mjs`) deterministically
generates the seven `arena:schema/role-context/<name>@1.0.0` JSON schemas
into `contracts/role-context/` at the repository root:

- `role-definition.v1.json`
- `granted-role.v1.json`
- `active-role-context.v1.json`
- `workspace-context.v1.json`
- `role-projection.v1.json`
- `canonical-state-kind.v1.json`
- `role-registry.v1.json`

The artifacts are committed; `--check` regenerates into a temp directory
and diffs against the committed copies (exit 0 ⇔ no drift). The check is
wired into three independent tripwires: `pnpm test` (drift suite),
`pnpm contracts:check`, and repo governance G9 (auto-discovers
`packages/*/scripts/generate-contracts.mjs`).

## Purity

Everything is pure, deterministic TypeScript: no clock reads, no I/O, no
randomness. All records are deep-frozen; every mutation returns a NEW
frozen record. Identical inputs always produce identical outputs
(property-tested with a seeded LCG — never `Math.random`).

## Scripts

- `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` — package battery
- `pnpm contracts:generate` — regenerate contracts in place
- `pnpm contracts:check` — drift check against the committed artifacts
