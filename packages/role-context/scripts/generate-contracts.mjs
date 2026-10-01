#!/usr/bin/env node
/**
 * Arena role-context contract generator (Work Order B003).
 *
 * Follows the A006 expert-registry generated-contracts convention
 * (packages/expert-registry/scripts/generate-contracts.mjs), which itself
 * follows the A001/A002/A004/A005 convention (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the B003
 *     surfaces ONLY — it emits every schema for @arena/role-context into
 *     contracts/role-context/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id of the
 *     form arena:schema/role-context/<name>@1.0.0.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the repo-wide governance G9 entry point runs every
 *     package-level generator (packages/<pkg>/scripts/generate-contracts.mjs)
 *     with --check, so this generator is wired into governance without any
 *     root file edit.
 *   - The deterministic serializer is duplicated from the A001/A006
 *     generators (10 lines) instead of imported, because importing those
 *     modules executes their CLI main() as an import side effect.
 *
 * Usage:
 *   node scripts/generate-contracts.mjs                    # regenerate in place
 *   node scripts/generate-contracts.mjs --output DIR       # write under DIR
 *   node scripts/generate-contracts.mjs --check [--against DIR]
 *   node scripts/generate-contracts.mjs --list
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// ---------------------------------------------------------------------------
// Shared protocol constants — MUST match the TypeScript surface
// (packages/role-context/src/**). Parity is asserted by
// src/contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const IDENTITY_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const WORKSPACE_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const ROLE_GRANT_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const POLICY_ID_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const SURFACE_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const PROJECTION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}(?:\\.[a-z][a-z0-9-]{0,63}){1,3}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const PROVENANCE_NOTE_PATTERN = '^\\S.{0,199}$';
const SEMVER_PATTERN = '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';
const CANONICAL_OBJECT_REF_PATTERN =
  '^[a-z][a-z0-9-]{0,63}:[a-z0-9][a-z0-9._:/-]{0,253}@(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$';

const ROLE_IDS = [
  'administrator',
  'agent-builder',
  'evaluator',
  'expert',
  'marketplace-participant',
  'operator',
  'owner',
  'researcher',
];
const CANONICAL_STATE_KINDS = [
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
];
const CANONICAL_OBJECT_KINDS = [
  'capability-case',
  'task',
  'agent-body',
  'trajectory',
  'evaluation',
  'verification',
  'certification',
];
const PERMISSION_POLICY_RECORD_VERSION = 1;
const ROLE_GRANT_RECORD_VERSION = 1;
const ROLE_DEFINITION_RECORD_VERSION = 1;
const ROLE_REGISTRY_RECORD_VERSION = 1;
const ACTIVE_ROLE_CONTEXT_RECORD_VERSION = 1;
const WORKSPACE_CONTEXT_RECORD_VERSION = 1;
const ROLE_PROJECTION_RECORD_VERSION = 1;
const CANONICAL_STATE_RECORD_VERSION = 1;
const ROLE_CONTEXT_SCHEMA_VERSION = '1.0.0';
const ROLE_CONTEXT_SCHEMA_NAMES = [
  'role-definition',
  'granted-role',
  'active-role-context',
  'workspace-context',
  'role-projection',
  'canonical-state-kind',
  'role-registry',
];

// The 8 RC1.0 reference role definitions (goal + primary surfaces verbatim
// from spec/roles-and-contexts.md RC1.0; surfaces normalized to kebab ids).
// MUST match packages/role-context/src/roles/registry.ts — parity asserted
// by src/contracts.parity.test.ts.
const ROLE_DEFINITIONS = [
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

// The product-truth taxonomy descriptors (handoff §7). MUST match
// packages/role-context/src/states/canonical-state.ts.
const CANONICAL_STATE_DESCRIPTORS = [
  {
    kind: 'verified-fact',
    label: 'Verified fact',
    meaning: 'A claim checked against an authoritative source by the verification authority.',
    guidance: 'Display as established truth only with its verification provenance.',
  },
  {
    kind: 'evidence',
    label: 'Evidence',
    meaning: 'An artifact that supports or challenges a claim without deciding it.',
    guidance: 'Display as support material; never present evidence as proof.',
  },
  {
    kind: 'expert-judgment',
    label: 'Expert judgment',
    meaning: 'A qualified human professional opinion, attributed to the expert.',
    guidance: 'A model is not automatically a professional; always attribute the expert.',
  },
  {
    kind: 'model-output',
    label: 'Model output',
    meaning: 'Raw output produced by a model; unverified by any authority.',
    guidance: 'Never display model output as verified fact or expert judgment.',
  },
  {
    kind: 'simulation-replay',
    label: 'Simulation / Replay',
    meaning: 'An observational replay of recorded execution; not a live-world mutation.',
    guidance: 'A replay is not a live-world mutation; mark replay views as observational.',
  },
  {
    kind: 'evaluation-result',
    label: 'Evaluation result',
    meaning: 'A measured outcome of running an evaluator against a target.',
    guidance: 'Scoped to the tested composition; never generalize beyond the run.',
  },
  {
    kind: 'certification',
    label: 'Certification',
    meaning: 'A certification claim over the tested composition (Body Version × substrate × config).',
    guidance: 'A purchased artifact is not automatically certified.',
  },
  {
    kind: 'suggestion-hypothesis',
    label: 'Suggestion / Hypothesis',
    meaning: 'A proposal or conjecture awaiting validation.',
    guidance: 'Display as tentative; never as a finding or a result.',
  },
  {
    kind: 'demo-state',
    label: 'Demo state',
    meaning: 'Deterministic demonstration state, not customer-authoritative state.',
    guidance: 'Demo state is never customer-authoritative state; label it visibly.',
  },
  {
    kind: 'pending',
    label: 'Pending',
    meaning: 'A decision or process that is in flight and not yet resolvable.',
    guidance: 'Display as unresolved; do not guess the outcome.',
  },
  {
    kind: 'unknown',
    label: 'Unknown',
    meaning: 'The state cannot be classified with the information available.',
    guidance: 'Fail honest: display unknown rather than collapsing into another badge.',
  },
];

const rref = (name) => `arena:schema/role-context/${name}@${ROLE_CONTEXT_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// ---------------------------------------------------------------------------
// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001–A006 contracts).
// ---------------------------------------------------------------------------

const roleDefinitionDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordVersion', 'roleId', 'name', 'goal', 'primarySurfaces', 'version'],
  properties: {
    recordVersion: { const: ROLE_DEFINITION_RECORD_VERSION },
    roleId: { enum: [...ROLE_IDS] },
    name: { type: 'string', minLength: 1, maxLength: 200 },
    goal: { type: 'string', minLength: 1, maxLength: 2000 },
    primarySurfaces: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { type: 'string', pattern: SURFACE_ID_PATTERN },
    },
    version: { type: 'string', pattern: SEMVER_PATTERN },
  },
};

const grantProvenanceDef = {
  type: 'object',
  additionalProperties: false,
  required: ['grantedBy', 'grantedAt'],
  properties: {
    grantedBy: { type: 'string', minLength: 1, maxLength: 128 },
    grantedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    note: { type: 'string', pattern: PROVENANCE_NOTE_PATTERN },
  },
};

const grantedRoleDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'grantId',
    'identityId',
    'tenantId',
    'roleId',
    'policyId',
    'provenance',
    'validFrom',
  ],
  properties: {
    recordVersion: { const: ROLE_GRANT_RECORD_VERSION },
    grantId: { type: 'string', pattern: ROLE_GRANT_ID_PATTERN },
    identityId: { type: 'string', pattern: IDENTITY_ID_PATTERN },
    tenantId: { type: 'string', pattern: TENANT_PATTERN },
    roleId: { enum: [...ROLE_IDS] },
    policyId: { type: 'string', pattern: POLICY_ID_PATTERN },
    provenance: { $ref: '#/$defs/grantProvenance' },
    validFrom: { type: 'string', pattern: TIMESTAMP_PATTERN },
    expiresAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
  },
};

const permissionPolicyDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordVersion', 'policyId', 'tenantId', 'descriptor', 'issuedAt'],
  properties: {
    recordVersion: { const: PERMISSION_POLICY_RECORD_VERSION },
    policyId: { type: 'string', pattern: POLICY_ID_PATTERN },
    tenantId: { type: 'string', pattern: TENANT_PATTERN },
    descriptor: {
      type: 'object',
      minProperties: 1,
      description:
        'Opaque descriptor owned by the external permission authority; @arena/role-context carries it and never interprets it.',
    },
    issuedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
  },
};

const switchPreservationDef = {
  type: 'object',
  additionalProperties: false,
  properties: {
    canonicalObjectRef: { type: 'string', pattern: CANONICAL_OBJECT_REF_PATTERN },
    navigationBreadcrumb: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1, maxLength: 200 },
    },
    unsavedDraftKeys: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1, maxLength: 200 },
    },
    selectedTimeRange: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'string', pattern: TIMESTAMP_PATTERN },
        to: { type: 'string', pattern: TIMESTAMP_PATTERN },
      },
    },
    filters: {
      type: 'object',
      minProperties: 1,
      additionalProperties: { type: 'string', maxLength: 200 },
    },
  },
};

const activeRoleContextDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'identityId',
    'tenantId',
    'workspaceId',
    'roleId',
    'grantId',
    'activatedAt',
    'registryVersion',
  ],
  properties: {
    recordVersion: { const: ACTIVE_ROLE_CONTEXT_RECORD_VERSION },
    identityId: { type: 'string', pattern: IDENTITY_ID_PATTERN },
    tenantId: { type: 'string', pattern: TENANT_PATTERN },
    workspaceId: { type: 'string', pattern: WORKSPACE_ID_PATTERN },
    roleId: { enum: [...ROLE_IDS] },
    grantId: { type: 'string', pattern: ROLE_GRANT_ID_PATTERN },
    activatedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    registryVersion: { type: 'string', pattern: SEMVER_PATTERN },
    preserved: { $ref: '#/$defs/switchPreservation' },
  },
};

const canonicalObjectIdentityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'tenant', 'objectId', 'version'],
  properties: {
    kind: { enum: [...CANONICAL_OBJECT_KINDS] },
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    objectId: { type: 'string', minLength: 1, maxLength: 255 },
    version: { type: 'string', pattern: SEMVER_PATTERN },
  },
};

const canonicalStateDescriptorDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordVersion', 'kind', 'label', 'meaning', 'guidance'],
  properties: {
    recordVersion: { const: CANONICAL_STATE_RECORD_VERSION },
    kind: { enum: [...CANONICAL_STATE_KINDS] },
    label: { type: 'string', minLength: 1, maxLength: 200 },
    meaning: { type: 'string', minLength: 1, maxLength: 2000 },
    guidance: { type: 'string', minLength: 1, maxLength: 2000 },
  },
};

// ---------------------------------------------------------------------------
// Manifest self-consistency — the mirrored data above must be internally
// consistent before any contract is emitted (fail closed at generation
// time, never emit a self-contradictory contract).
// ---------------------------------------------------------------------------

function assertManifestConsistency() {
  const contractIds = CONTRACTS.map((contract) => contract.id);
  for (const name of ROLE_CONTEXT_SCHEMA_NAMES) {
    if (!contractIds.includes(`role-context/${name}`)) {
      throw new Error(`ROLE_CONTEXT_SCHEMA_NAMES lists a schema with no contract: ${name}`);
    }
  }
  if (contractIds.length !== ROLE_CONTEXT_SCHEMA_NAMES.length) {
    throw new Error(`CONTRACTS has ${contractIds.length} entries, ROLE_CONTEXT_SCHEMA_NAMES has ${ROLE_CONTEXT_SCHEMA_NAMES.length}`);
  }
  const roleIds = ROLE_DEFINITIONS.map((role) => role.roleId);
  if (roleIds.length !== ROLE_IDS.length) {
    throw new Error(`ROLE_DEFINITIONS has ${roleIds.length} entries, ROLE_IDS has ${ROLE_IDS.length}`);
  }
  for (const roleId of roleIds) {
    if (!ROLE_IDS.includes(roleId)) {
      throw new Error(`ROLE_DEFINITIONS references unknown role id: ${roleId}`);
    }
  }
  if (new Set(roleIds).size !== roleIds.length) {
    throw new Error('ROLE_DEFINITIONS contains duplicate role ids');
  }
  const stateKinds = CANONICAL_STATE_DESCRIPTORS.map((descriptor) => descriptor.kind);
  if (stateKinds.length !== CANONICAL_STATE_KINDS.length) {
    throw new Error(`CANONICAL_STATE_DESCRIPTORS has ${stateKinds.length} entries, CANONICAL_STATE_KINDS has ${CANONICAL_STATE_KINDS.length}`);
  }
  for (const kind of stateKinds) {
    if (!CANONICAL_STATE_KINDS.includes(kind)) {
      throw new Error(`CANONICAL_STATE_DESCRIPTORS references unknown kind: ${kind}`);
    }
  }
}

// ---------------------------------------------------------------------------
// The CONTRACTS manifest — every schema owned by @arena/role-context.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'role-context/role-definition',
    output: 'contracts/role-context/role-definition.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('role-definition'),
        title: 'Arena role definition v1',
        description:
          'One RC1.0 reference role: id, display name, goal (RC1.0 verbatim) and primary surfaces (RC1.0 verbatim, kebab-normalized). A role is a LENS (goal + surfaces), never a permission.',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'roleId', 'name', 'goal', 'primarySurfaces', 'version'],
        properties: roleDefinitionDef.properties,
      };
    },
  },
  {
    id: 'role-context/granted-role',
    output: 'contracts/role-context/granted-role.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('granted-role'),
        title: 'Arena granted role v1',
        description:
          'One granted role: identity × tenant × role, with grant provenance (grantedBy / grantedAt / optional note), a recommended expiry window and the id of the permission policy in force. Holding a role is not a permission (RC1.0).',
        type: 'object',
        additionalProperties: false,
        required: grantedRoleDef.required,
        properties: grantedRoleDef.properties,
        $defs: { grantProvenance: grantProvenanceDef },
      };
    },
  },
  {
    id: 'role-context/active-role-context',
    output: 'contracts/role-context/active-role-context.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('active-role-context'),
        title: 'Arena active role context v1',
        description:
          'The single currently-selected role within one workspace: which granted role the UI lenses through, its activation provenance (grantId), the registry snapshot it validated against and the display context preserved across the switch. Carries NO permission of its own.',
        type: 'object',
        additionalProperties: false,
        required: activeRoleContextDef.required,
        properties: activeRoleContextDef.properties,
        $defs: { switchPreservation: switchPreservationDef },
      };
    },
  },
  {
    id: 'role-context/workspace-context',
    output: 'contracts/role-context/workspace-context.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('workspace-context'),
        title: 'Arena workspace context v1',
        description:
          'Tenant/workspace-scoped context: the granted-role set (deterministically ordered, same tenant + identity), the OPAQUE permission policy (carried, never interpreted, byte-identical across every role switch) and the optional active role. Activating a role can never change permissions — the API shape makes it impossible.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'identityId',
          'tenantId',
          'workspaceId',
          'grantedRoles',
          'permissionPolicy',
        ],
        properties: {
          recordVersion: { const: WORKSPACE_CONTEXT_RECORD_VERSION },
          identityId: { type: 'string', pattern: IDENTITY_ID_PATTERN },
          tenantId: { type: 'string', pattern: TENANT_PATTERN },
          workspaceId: { type: 'string', pattern: WORKSPACE_ID_PATTERN },
          grantedRoles: {
            type: 'array',
            minItems: 0,
            items: { $ref: '#/$defs/grantedRole' },
          },
          permissionPolicy: { $ref: '#/$defs/permissionPolicy' },
          activeRole: { $ref: '#/$defs/activeRoleContext' },
        },
        $defs: {
          grantedRole: grantedRoleDef,
          permissionPolicy: permissionPolicyDef,
          activeRoleContext: activeRoleContextDef,
          grantProvenance: grantProvenanceDef,
          switchPreservation: switchPreservationDef,
        },
      };
    },
  },
  {
    id: 'role-context/role-projection',
    output: 'contracts/role-context/role-projection.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('role-projection'),
        title: 'Arena role projection v1',
        description:
          'The rendered output of a role lens over ONE canonical object (RC1.0 same-object / different-lens rule): the projection always carries the canonical object identity it projects, the lens question, the emphasized surfaces of the lensing role, recommended next actions and a role-specific payload.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'projectionId',
          'roleId',
          'canonicalKind',
          'canonical',
          'lensQuestion',
          'emphasis',
          'recommendedActions',
          'payload',
        ],
        properties: {
          recordVersion: { const: ROLE_PROJECTION_RECORD_VERSION },
          projectionId: { type: 'string', pattern: PROJECTION_ID_PATTERN },
          roleId: { enum: [...ROLE_IDS] },
          canonicalKind: { enum: [...CANONICAL_OBJECT_KINDS] },
          canonical: { $ref: '#/$defs/canonicalObjectIdentity' },
          lensQuestion: { type: 'string', minLength: 1, maxLength: 500 },
          emphasis: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', pattern: SURFACE_ID_PATTERN },
          },
          recommendedActions: {
            type: 'array',
            items: { type: 'string', minLength: 1, maxLength: 200 },
          },
          payload: { type: 'object', minProperties: 1 },
        },
        $defs: { canonicalObjectIdentity: canonicalObjectIdentityDef },
      };
    },
  },
  {
    id: 'role-context/canonical-state-kind',
    output: 'contracts/role-context/canonical-state-kind.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('canonical-state-kind'),
        title: 'Arena canonical state kind v1',
        description:
          'The product-truth taxonomy (handoff §7): one descriptor per canonical state kind. Every user-visible state must classify into exactly one kind; the UI may never collapse two different kinds into one generic badge — the only permitted display equivalence is kind identity.',
        type: 'object',
        additionalProperties: false,
        required: canonicalStateDescriptorDef.required,
        properties: canonicalStateDescriptorDef.properties,
      };
    },
  },
  {
    id: 'role-context/role-registry',
    output: 'contracts/role-context/role-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: rref('role-registry'),
        title: 'Arena role registry v1',
        description:
          'The versioned, append-only-style registry of role definitions (8 RC1.0 reference roles at registryVersion 1.0.0). Consumers reject registries whose version they do not expect (REGISTRY_VERSION_MISMATCH).',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'registryVersion', 'roles'],
        properties: {
          recordVersion: { const: ROLE_REGISTRY_RECORD_VERSION },
          registryVersion: { type: 'string', pattern: SEMVER_PATTERN },
          roles: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/roleDefinition' },
          },
        },
        $defs: { roleDefinition: roleDefinitionDef },
      };
    },
  },
];

assertManifestConsistency();

// ---------------------------------------------------------------------------
// Deterministic serialization (same algorithm as the A001/A006 generators)
// ---------------------------------------------------------------------------

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObjectKeys(value[key])]),
    );
  }
  return value;
}

export function serializeDeterministic(value) {
  return `${JSON.stringify(sortObjectKeys(value), null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Output / check
// ---------------------------------------------------------------------------

function listFilesRecursive(dir, prefix = '') {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFilesRecursive(join(dir, entry.name), rel));
    else files.push(rel);
  }
  return files;
}

function writeContracts(outputDir) {
  for (const contract of CONTRACTS) {
    const target = join(outputDir, contract.output);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, serializeDeterministic(contract.build()), 'utf-8');
    console.log(`[contracts] wrote ${contract.output} (${contract.id})`);
  }
}

function checkContracts(againstDir) {
  const tempDir = join(
    tmpdir(),
    `arena-role-context-contracts-${process.pid}-${Date.now()}`,
  );
  try {
    writeContracts(tempDir);
    const generatedFiles = listFilesRecursive(tempDir);
    const drift = [];

    for (const rel of generatedFiles) {
      const againstPath = join(againstDir, rel);
      let committed;
      try {
        committed = readFileSync(againstPath, 'utf-8');
      } catch {
        drift.push(`missing generated contract: ${rel}`);
        continue;
      }
      const generated = readFileSync(join(tempDir, rel), 'utf-8');
      if (committed !== generated) drift.push(`drifted generated contract: ${rel}`);
    }

    // Extra-file check is scoped to this generator's output directory
    // (contracts/role-context) — never the whole tree, so running --check
    // against the repository root is safe.
    const contractDirs = [...new Set(CONTRACTS.map((c) => dirname(c.output)))];
    const generatedSet = new Set(generatedFiles);
    for (const contractDir of contractDirs) {
      const committedDir = join(againstDir, contractDir);
      if (!statSync(committedDir, { throwIfNoEntry: false })?.isDirectory()) continue;
      for (const rel of listFilesRecursive(committedDir, contractDir)) {
        if (!generatedSet.has(rel)) drift.push(`unexpected extra contract file: ${rel}`);
      }
    }

    if (drift.length > 0) {
      console.error(`[contracts] DRIFT DETECTED (${drift.length} problem(s)):`);
      for (const d of drift) console.error(`  - ${d}`);
      console.error(
        '[contracts] run: node packages/role-context/scripts/generate-contracts.mjs   then commit the result',
      );
      return 1;
    }
    console.log(
      `[contracts] drift check clean (${generatedFiles.length} contract file(s) match)`,
    );
    return 0;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const contract of CONTRACTS) {
      console.log(`${contract.id} -> ${contract.output}`);
    }
    process.exit(0);
  }
  if (args.includes('--check')) {
    const againstIndex = args.indexOf('--against');
    const againstDir =
      againstIndex !== -1 && args[againstIndex + 1]
        ? resolve(args[againstIndex + 1])
        : REPO_ROOT;
    process.exit(checkContracts(againstDir));
  }
  const outputIndex = args.indexOf('--output');
  if (outputIndex !== -1 && args[outputIndex + 1]) {
    writeContracts(resolve(args[outputIndex + 1]));
    process.exit(0);
  }
  if (args.length > 0) {
    console.error(`unknown arguments: ${args.join(' ')}`);
    process.exit(2);
  }
  writeContracts(REPO_ROOT);
  console.log('[contracts] regenerate committed with: git add contracts/role-context');
}

main();
