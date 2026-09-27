#!/usr/bin/env node
/**
 * Arena agent-body contract generator (Work Order A003).
 *
 * Follows the A001/A002 generated-contracts convention
 * (scripts/generate-contracts.mjs, packages/artifact-protocol/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A003 surfaces ONLY — it
 *     emits every schema for @arena/agent-body into contracts/agent-body/ at
 *     the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part of
 *     `pnpm test`, the package script `contracts:check` runs it directly, and
 *     governance G9 runs every package-level generator with --check
 *     (scripts/governance-check.py), so this generator is wired into
 *     the repo-wide governance without ANY root-file edit.
 *   - The deterministic serializer is duplicated from the A001 generator
 *     (10 lines) instead of imported, because importing that module executes
 *     its CLI main() as an import side effect.
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
// Shared protocol constants — MUST match the TypeScript surfaces
// (packages/agent-body/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

// shared view patterns (character-for-character the A002 constants)
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const LICENSE_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';

// substrate identifier patterns
const MODEL_FAMILY_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const MODEL_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$';
const MODEL_REVISION_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';

// instance id pattern (allows UUIDv4)
const INSTANCE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

// shared vocabulary
const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
const COMMERCIAL_USE_POLICIES = ['allowed', 'requires-license', 'prohibited'];
const REDISTRIBUTION_POLICIES = ['allowed', 'tenant-only', 'prohibited'];
const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'];

// substrate vocabulary
const SUBSTRATE_MODALITIES = [
  'text-input',
  'text-output',
  'image-input',
  'image-output',
  'audio-input',
  'audio-output',
  'video-input',
  'structured-input',
  'structured-output',
];
const TOOL_CALLING_LEVELS = ['none', 'text-protocol', 'json-schema', 'function-calling'];
const SUBSTRATE_CONDITIONS = [
  'stable',
  'preview',
  'deprecated',
  'rate-limited',
  'region-restricted',
  'sovereign-only',
  'capacity-constrained',
];
const SUBSTRATE_RECORD_VERSION = 1;
const SUBSTRATE_MAX_UNITS_LIMIT = 2147483647;

// possession vocabulary
const MODEL_ARTIFACT_MATERIALITIES = ['behavioral', 'non-behavioral'];
const POSSESSION_RECORD_VERSION = 1;

// instance vocabulary
const INSTANCE_RUNTIME_STATES = ['initialized', 'running', 'suspended'];
const INSTANCE_TERMINATION_STATUSES = ['completed', 'failed', 'terminated'];
const INSTANCE_EVENT_KINDS = [
  'instance-created',
  'started',
  'state-changed',
  'observation',
  'action',
  'escalation',
  'error',
  'terminated',
];
const AGENT_INSTANCE_RECORD_VERSION = 1;

// body vocabulary
const BODY_VERSION_RECORD_VERSION = 1;
const AGENT_BODY_RECORD_VERSION = 1;

// error taxonomy
const AGENT_BODY_ERROR_CODES = [
  'AGENT_BODY_ARTIFACT_VERSION_CONFLICT',
  'AGENT_BODY_INSTANCE_TERMINATED',
  'AGENT_BODY_INVALID_BODY_VERSION',
  'AGENT_BODY_INVALID_COMPATIBILITY_PROFILE',
  'AGENT_BODY_INVALID_DIGEST',
  'AGENT_BODY_INVALID_IDENTITY',
  'AGENT_BODY_INVALID_INSTANCE',
  'AGENT_BODY_INVALID_INSTANCE_EVENT',
  'AGENT_BODY_INVALID_POLICY',
  'AGENT_BODY_INVALID_POSSESSION',
  'AGENT_BODY_INVALID_REF',
  'AGENT_BODY_INVALID_RIGHTS',
  'AGENT_BODY_INVALID_SUBSTRATE',
  'AGENT_BODY_INVALID_TIMESTAMP',
  'AGENT_BODY_INVALID_VERSION',
  'AGENT_BODY_MISSING_RIGHTS',
  'AGENT_BODY_POSSESSION_TAMPERED',
  'AGENT_BODY_PROVIDER_NAME_REJECTED',
  'AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN',
  'AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED',
  'AGENT_BODY_TAMPERED',
  'AGENT_BODY_UNKNOWN_ERROR',
  'AGENT_BODY_UNSUPPORTED_RECORD_VERSION',
  'AGENT_BODY_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];

const AGENT_BODY_SCHEMA_VERSION = '1.0.0';
const AGENT_BODY_SCHEMA_NAMES = [
  'agent-body',
  'agent-body-error',
  'agent-instance',
  'agent-instance-event',
  'agent-instance-terminated-event',
  'body-version',
  'body-version-ref',
  'cognitive-substrate',
  'create-possession-command',
  'model-specific-artifact',
  'possession',
  'possession-created-event',
  'register-substrate-command',
  'schema-registry',
  'substrate-compatibility-profile',
  'substrate-registered-event',
  'terminate-instance-command',
];

const aref = (name) => `arena:schema/agent-body/${name}@${AGENT_BODY_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// ---------------------------------------------------------------------------
// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001/A002 contracts).
// ---------------------------------------------------------------------------

const principalDef = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'tenant', 'principalId'],
  properties: {
    type: { enum: PRINCIPAL_TYPES },
    tenant: { type: 'string', pattern: NAMESPACE_PATTERN },
    principalId: { type: 'string', pattern: PRINCIPAL_ID_PATTERN },
  },
};

const rightsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['license', 'commercialUse', 'redistribution', 'customerData'],
  properties: {
    license: { type: 'string', pattern: LICENSE_PATTERN },
    commercialUse: { enum: COMMERCIAL_USE_POLICIES },
    redistribution: { enum: REDISTRIBUTION_POLICIES },
    customerData: { enum: CUSTOMER_DATA_POLICIES },
    professionalLimitations: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
  },
};

const versionedArtifactRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'name', 'version', 'digest'],
  properties: {
    namespace: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const policyDocumentDef = {
  type: 'object',
  additionalProperties: false,
  required: ['policyId', 'statements'],
  properties: {
    policyId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    statements: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    sources: {
      type: 'array',
      items: { $ref: '#/$defs/versionedArtifactRef' },
    },
  },
};

const bodyVersionRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'name', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const escalationPolicyDef = {
  type: 'object',
  additionalProperties: false,
  required: ['rules'],
  properties: {
    rules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['condition', 'target'],
        properties: {
          condition: { type: 'string', minLength: 1 },
          target: { $ref: '#/$defs/principal' },
        },
      },
    },
  },
};

const substrateCompatibilityProfileDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'requiredModalities',
    'requiredToolCalling',
    'contextRequirements',
    'requiredEvaluationSuites',
    'prohibitedConditions',
    'substrateAdaptations',
  ],
  properties: {
    requiredModalities: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { enum: SUBSTRATE_MODALITIES },
    },
    requiredToolCalling: { enum: TOOL_CALLING_LEVELS },
    contextRequirements: {
      type: 'object',
      additionalProperties: false,
      required: ['minContextUnits'],
      properties: {
        minContextUnits: {
          type: 'integer',
          minimum: 1,
          maximum: SUBSTRATE_MAX_UNITS_LIMIT,
        },
      },
    },
    costConstraints: {
      type: 'object',
      minProperties: 1,
      additionalProperties: false,
      properties: {
        maxCostPerMillionRequests: { type: 'number', exclusiveMinimum: 0 },
        maxP95LatencyMs: { type: 'integer', exclusiveMinimum: 0 },
      },
    },
    requiredEvaluationSuites: {
      type: 'array',
      items: { $ref: '#/$defs/versionedArtifactRef' },
    },
    prohibitedConditions: {
      type: 'array',
      uniqueItems: true,
      items: { enum: SUBSTRATE_CONDITIONS },
    },
    substrateAdaptations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['substrateDigest', 'adaptation'],
        properties: {
          substrateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          adaptation: { $ref: '#/$defs/versionedArtifactRef' },
        },
      },
    },
  },
};

const contextLimitsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['maxContextUnits', 'maxOutputUnits'],
  properties: {
    maxContextUnits: {
      type: 'integer',
      minimum: 1,
      maximum: SUBSTRATE_MAX_UNITS_LIMIT,
    },
    maxOutputUnits: {
      type: 'integer',
      minimum: 1,
      maximum: SUBSTRATE_MAX_UNITS_LIMIT,
    },
  },
};

const cognitiveSubstrateDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'adapterId',
    'adapterVersion',
    'modelFamily',
    'modelId',
    'modelRevision',
    'modalityProfile',
    'toolCallingProfile',
    'contextLimits',
    'conditions',
    'integrity',
  ],
  properties: {
    recordVersion: { const: SUBSTRATE_RECORD_VERSION },
    adapterId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    adapterVersion: { type: 'string', pattern: VERSION_PATTERN },
    modelFamily: { type: 'string', pattern: MODEL_FAMILY_PATTERN },
    modelId: { type: 'string', pattern: MODEL_ID_PATTERN },
    modelRevision: { type: 'string', pattern: MODEL_REVISION_PATTERN },
    modalityProfile: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: { enum: SUBSTRATE_MODALITIES },
    },
    toolCallingProfile: { enum: TOOL_CALLING_LEVELS },
    contextLimits: { $ref: '#/$defs/contextLimits' },
    conditions: {
      type: 'array',
      uniqueItems: true,
      items: { enum: SUBSTRATE_CONDITIONS },
    },
    integrity: {
      type: 'object',
      additionalProperties: false,
      required: ['digestAlgorithm', 'contentDigest'],
      properties: {
        digestAlgorithm: { const: 'sha256' },
        contentDigest: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
  },
};

const modelSpecificArtifactDef = {
  type: 'object',
  additionalProperties: false,
  required: ['artifactId', 'artifactVersion', 'digest', 'materiality'],
  properties: {
    artifactId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    artifactVersion: { type: 'string', pattern: VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
    materiality: { enum: MODEL_ARTIFACT_MATERIALITIES },
  },
};

const bodyVersionDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'body',
    'version',
    'mission',
    'role',
    'domainScope',
    'capabilities',
    'skills',
    'knowledge',
    'tools',
    'procedures',
    'memoryPolicy',
    'planningPolicy',
    'escalation',
    'authorityBoundaries',
    'safetyPolicy',
    'evaluationSuites',
    'verificationSuites',
    'environmentRequirements',
    'substrateCompatibility',
    'provenance',
    'lineage',
    'digest',
  ],
  properties: {
    recordVersion: { const: BODY_VERSION_RECORD_VERSION },
    body: {
      type: 'object',
      additionalProperties: false,
      required: ['tenant', 'name'],
      properties: {
        tenant: { type: 'string', pattern: NAMESPACE_PATTERN },
        name: { type: 'string', pattern: NAME_PATTERN },
      },
    },
    version: { type: 'string', pattern: VERSION_PATTERN },
    mission: { type: 'string', minLength: 1 },
    role: { type: 'string', minLength: 1 },
    domainScope: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    capabilities: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    skills: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
    knowledge: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
    tools: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
    procedures: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
    memoryPolicy: { $ref: '#/$defs/policyDocument' },
    planningPolicy: { $ref: '#/$defs/policyDocument' },
    escalation: { $ref: '#/$defs/escalationPolicy' },
    authorityBoundaries: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    safetyPolicy: { $ref: '#/$defs/policyDocument' },
    evaluationSuites: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/versionedArtifactRef' },
    },
    verificationSuites: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/versionedArtifactRef' },
    },
    environmentRequirements: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/versionedArtifactRef' },
    },
    substrateCompatibility: { $ref: '#/$defs/substrateCompatibilityProfile' },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['creator', 'createdAt', 'rights', 'records'],
      properties: {
        creator: { $ref: '#/$defs/principal' },
        createdAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        rights: { $ref: '#/$defs/rights' },
        records: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
      },
    },
    lineage: {
      type: 'object',
      additionalProperties: false,
      required: ['parents'],
      properties: {
        parents: { type: 'array', items: { $ref: '#/$defs/bodyVersionRef' } },
        supersedes: { $ref: '#/$defs/bodyVersionRef' },
      },
    },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const agentInstanceDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'instanceId',
    'possessionDigest',
    'environment',
    'runtimeState',
    'events',
    'termination',
  ],
  properties: {
    recordVersion: { const: AGENT_INSTANCE_RECORD_VERSION },
    instanceId: { type: 'string', pattern: INSTANCE_ID_PATTERN },
    possessionDigest: { type: 'string', pattern: DIGEST_PATTERN },
    environment: {
      type: 'object',
      additionalProperties: false,
      required: ['environmentId', 'environmentVersion', 'instanceId', 'snapshotDigest'],
      properties: {
        environmentId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
        environmentVersion: { type: 'string', pattern: VERSION_PATTERN },
        instanceId: { type: 'string', pattern: INSTANCE_ID_PATTERN },
        snapshotDigest: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
    runtimeState: { enum: INSTANCE_RUNTIME_STATES },
    events: {
      type: 'array',
      items: { $ref: '#/$defs/agentInstanceEvent' },
    },
    termination: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['status', 'terminatedAt', 'reason'],
          properties: {
            status: { enum: INSTANCE_TERMINATION_STATUSES },
            terminatedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
            reason: { type: 'string', minLength: 1 },
          },
        },
      ],
    },
  },
};

const agentInstanceEventDef = {
  type: 'object',
  additionalProperties: false,
  required: ['sequence', 'kind', 'occurredAt'],
  properties: {
    sequence: { type: 'integer', minimum: 1 },
    kind: { enum: INSTANCE_EVENT_KINDS },
    occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    payload: {},
  },
};

const policyBundleDef = {
  type: 'object',
  additionalProperties: false,
  required: ['bundleId', 'bundleVersion', 'policies'],
  properties: {
    bundleId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    bundleVersion: { type: 'string', pattern: VERSION_PATTERN },
    policies: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/policyDocument' },
    },
  },
};

const runtimeProfileDef = {
  type: 'object',
  additionalProperties: false,
  required: ['runtimeId', 'runtimeVersion', 'configuration'],
  properties: {
    runtimeId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    runtimeVersion: { type: 'string', pattern: VERSION_PATTERN },
    configuration: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
        ],
      },
    },
  },
};

const environmentProfileDef = {
  type: 'object',
  additionalProperties: false,
  required: ['environmentId', 'environmentVersion', 'constraints'],
  properties: {
    environmentId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    environmentVersion: { type: 'string', pattern: VERSION_PATTERN },
    constraints: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
};

const possessionDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'bodyVersion',
    'substrate',
    'runtime',
    'environment',
    'policies',
    'modelSpecificArtifacts',
    'digest',
  ],
  properties: {
    recordVersion: { const: POSSESSION_RECORD_VERSION },
    bodyVersion: { $ref: '#/$defs/bodyVersion' },
    substrate: { $ref: '#/$defs/cognitiveSubstrate' },
    runtime: { $ref: '#/$defs/runtimeProfile' },
    environment: { $ref: '#/$defs/environmentProfile' },
    policies: { $ref: '#/$defs/policyBundle' },
    modelSpecificArtifacts: {
      type: 'array',
      items: { $ref: '#/$defs/modelSpecificArtifact' },
    },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

// Full $defs map used by the possession contract (self-contained file).
const possessionDefs = {
  bodyVersion: bodyVersionDef,
  cognitiveSubstrate: cognitiveSubstrateDef,
  contextLimits: contextLimitsDef,
  environmentProfile: environmentProfileDef,
  escalationPolicy: escalationPolicyDef,
  modelSpecificArtifact: modelSpecificArtifactDef,
  policyBundle: policyBundleDef,
  policyDocument: policyDocumentDef,
  principal: principalDef,
  rights: rightsDef,
  runtimeProfile: runtimeProfileDef,
  substrateCompatibilityProfile: substrateCompatibilityProfileDef,
  versionedArtifactRef: versionedArtifactRefDef,
  bodyVersionRef: bodyVersionRefDef,
};

// Full $defs map used by the body-version contract.
const bodyVersionDefs = {
  bodyVersionRef: bodyVersionRefDef,
  escalationPolicy: escalationPolicyDef,
  policyDocument: policyDocumentDef,
  principal: principalDef,
  rights: rightsDef,
  substrateCompatibilityProfile: substrateCompatibilityProfileDef,
  versionedArtifactRef: versionedArtifactRefDef,
};

// Full $defs map used by the cognitive-substrate contract.
const substrateDefs = {
  contextLimits: contextLimitsDef,
};

// ---------------------------------------------------------------------------
// Contract manifest — the A003 owned generator set.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'agent-body/agent-body',
    output: 'contracts/agent-body/agent-body.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('agent-body'),
        title: 'Arena AgentBody v1',
        description:
          'The first-class persistent object for a professional/capability composition ' +
          '(architecture-lock rule 1): stable tenant-scoped identity, creation metadata, ' +
          'mandatory rights metadata (rule 23) and the content-addressed registry of its ' +
          'immutable BodyVersions in append order. New versions are appended purely via ' +
          'registerBodyVersion; the object is deep-frozen and never mutated.',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'identity', 'createdAt', 'creator', 'rights', 'versions'],
        properties: {
          recordVersion: { const: AGENT_BODY_RECORD_VERSION },
          identity: {
            type: 'object',
            additionalProperties: false,
            required: ['tenant', 'name'],
            properties: {
              tenant: { type: 'string', pattern: NAMESPACE_PATTERN },
              name: { type: 'string', pattern: NAME_PATTERN },
            },
          },
          createdAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          creator: { $ref: '#/$defs/principal' },
          rights: { $ref: '#/$defs/rights' },
          versions: {
            type: 'array',
            items: { $ref: '#/$defs/bodyVersionRef' },
          },
        },
        $defs: {
          principal: principalDef,
          rights: rightsDef,
          bodyVersionRef: bodyVersionRefDef,
        },
      };
    },
  },
  {
    id: 'agent-body/body-version-ref',
    output: 'contracts/agent-body/body-version-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('body-version-ref'),
        title: 'Arena BodyVersionRef v1',
        description:
          'A content-addressed reference to an immutable BodyVersion: body identity, ' +
          'version and the sha256 content digest of the referenced version. The unit of ' +
          'lineage parents, supersession and the AgentBody version registry.',
        ...bodyVersionRefDef,
      };
    },
  },
  {
    id: 'agent-body/body-version',
    output: 'contracts/agent-body/body-version.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('body-version'),
        title: 'Arena BodyVersion v1',
        description:
          'The immutable, content-addressed snapshot of a professional agent body ' +
          '(spec AB1.0; architecture-lock rules 1, 5). Carries every AB1.0 field: body ' +
          'identity/version; mission and role; domain scope; capabilities and SkillRefs; ' +
          'KnowledgeRefs; ToolRefs; procedures/workflows; memory policy; planning/decision ' +
          'policy; escalation/delegation; authority boundaries; safety policy; evaluation ' +
          'suite refs; verification suite refs; environment requirements; substrate ' +
          'compatibility profile; provenance and lineage; parent/supersession refs. The ' +
          'sha256 digest covers the canonical JSON of the digest-free view. Same content ' +
          'produces the same digest; any change produces a different digest. References to ' +
          'skills/knowledge/tools/suites are content-addressed versioned refs. A substrate ' +
          'compatibility profile may NOT declare any model as semantically identical to ' +
          'the Body (anti-alias rule).',
        ...bodyVersionDef,
        $defs: bodyVersionDefs,
      };
    },
  },
  {
    id: 'agent-body/cognitive-substrate',
    output: 'contracts/agent-body/cognitive-substrate.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('cognitive-substrate'),
        title: 'Arena CognitiveSubstrate v1',
        description:
          'Provider-neutral reference to a model/runtime capability (spec AB1.0; ' +
          'architecture-lock rule 2). Identifies: provider adapter (adapterId); model ' +
          'family/id (modelFamily, modelId); model revision; modality profile; ' +
          'tool-calling profile; context/profile limits in adapter-native units; adapter ' +
          'version; and integrity metadata (sha256 over the digest-free view). Credentials ' +
          'NEVER enter canonical objects — credential-shaped field names are rejected at ' +
          'construction (the closed property set below admits no credential field), and ' +
          'provider brand names are rejected in every identifier (rule 10: provider ' +
          'details remain behind adapters). A substrate is distinct from an Agent Body ' +
          'and is never asserted to be one.',
        ...cognitiveSubstrateDef,
        $defs: substrateDefs,
      };
    },
  },
  {
    id: 'agent-body/substrate-compatibility-profile',
    output: 'contracts/agent-body/substrate-compatibility-profile.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('substrate-compatibility-profile'),
        title: 'Arena SubstrateCompatibilityProfile v1',
        description:
          'What a BodyVersion requires from a cognitive substrate (spec AB1.0 ' +
          'Compatibility Profile; requirement R20): required modalities, tool semantics, ' +
          'context characteristics, cost/latency constraints where relevant, required ' +
          'evaluation suites, prohibited substrate conditions and optional ' +
          'substrate-specific adaptations (keyed by substrate CONTENT DIGEST, never by ' +
          'model identity). The closed property set deliberately has NO member that can ' +
          'declare any model as semantically identical to the Body — compatibility is ' +
          'declared per-profile, never as identity (anti-alias rule; requirements R43, ' +
          'R46: certification never infers Substrate = Profession).',
        ...substrateCompatibilityProfileDef,
        $defs: {
          versionedArtifactRef: versionedArtifactRefDef,
        },
      };
    },
  },
  {
    id: 'agent-body/model-specific-artifact',
    output: 'contracts/agent-body/model-specific-artifact.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('model-specific-artifact'),
        title: 'Arena ModelSpecificArtifact v1',
        description:
          'A versioned, content-addressed model-specific artifact bound into a Possession ' +
          '(architecture-lock rule 22: model-specific artifacts may exist but cannot ' +
          'silently redefine Body identity). An (artifactId, artifactVersion) pair is ' +
          'permanently bound to one content digest; behavioral artifacts that materially ' +
          'change professional behavior force a NEW possession version.',
        ...modelSpecificArtifactDef,
      };
    },
  },
  {
    id: 'agent-body/possession',
    output: 'contracts/agent-body/possession.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('possession'),
        title: 'Arena Possession v1',
        description:
          'The immutable, digest-bearing binding (spec AB1.0; architecture-lock rule 3): ' +
          'BodyVersion + CognitiveSubstrate + RuntimeProfile + EnvironmentProfile + ' +
          'PolicyBundle + optional ModelSpecificArtifacts, content-addressed by the sha256 ' +
          'digest over the canonical digest-free view. The full body version and substrate ' +
          'are embedded, so the possession digest transitively commits to both. A ' +
          'Possession is a VERSIONED BINDING, not an alias for the model: any component ' +
          'change (substrate upgrade included) produces a different possession digest.',
        ...possessionDef,
        $defs: possessionDefs,
      };
    },
  },
  {
    id: 'agent-body/agent-instance',
    output: 'contracts/agent-body/agent-instance.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('agent-instance'),
        title: 'Arena AgentInstance v1',
        description:
          'Ephemeral execution of a Possession (spec AB1.0): instance id; possession ' +
          'content digest; environment instance; runtime state; append-only event stream ' +
          '(contiguous sequences, monotonic timestamps); termination status. Terminal ' +
          'states (completed/failed/terminated) are FINAL — lifecycle operations on a ' +
          'terminated instance are rejected, and the object is deep-frozen so in-place ' +
          'mutation throws.',
        ...agentInstanceDef,
        $defs: {
          agentInstanceEvent: agentInstanceEventDef,
        },
      };
    },
  },
  {
    id: 'agent-body/agent-instance-event',
    output: 'contracts/agent-body/agent-instance-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('agent-instance-event'),
        title: 'Arena AgentInstanceEvent v1',
        description:
          'One append-only event in an agent instance stream: 1-based contiguous sequence, ' +
          'closed kind vocabulary, millisecond UTC timestamp and an optional plain-JSON ' +
          'payload. The reserved kinds (instance-created, started, state-changed, ' +
          'terminated) are managed exclusively by lifecycle transitions; user code appends ' +
          'observation/action/escalation/error events.',
        ...agentInstanceEventDef,
      };
    },
  },
  {
    id: 'agent-body/agent-body-error',
    output: 'contracts/agent-body/agent-body-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('agent-body-error'),
        title: 'Arena AgentBodyError v1',
        description:
          'Structured, serializable form of the agent body protocol error taxonomy. ' +
          'Unknown codes are rejected when parsing (AGENT_BODY_UNKNOWN_ERROR). Core-level ' +
          'failures still travel as @arena/protocol-core ProtocolError structures.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: AGENT_BODY_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'agent-body/register-substrate-command',
    output: 'contracts/agent-body/register-substrate-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('register-substrate-command'),
        title: 'Arena register-substrate command payload v1',
        description:
          'Idempotency-keyed command payload registering a provider-neutral cognitive ' +
          'substrate through its adapter (requirement R19). Travels inside Envelope<T>; ' +
          'the envelope idempotencyKey is REQUIRED non-null for commands ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['substrate', 'registrant'],
        properties: {
          substrate: { $ref: '#/$defs/cognitiveSubstrate' },
          registrant: { $ref: '#/$defs/principal' },
        },
        $defs: {
          cognitiveSubstrate: cognitiveSubstrateDef,
          contextLimits: contextLimitsDef,
          principal: principalDef,
        },
      };
    },
  },
  {
    id: 'agent-body/create-possession-command',
    output: 'contracts/agent-body/create-possession-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('create-possession-command'),
        title: 'Arena create-possession command payload v1',
        description:
          'Idempotency-keyed command payload binding a possession (BodyVersion × ' +
          'CognitiveSubstrate × RuntimeProfile × EnvironmentProfile × PolicyBundle × ' +
          'optional model-specific artifacts). Travels inside Envelope<T> (architecture-' +
          'lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['possession', 'creator'],
        properties: {
          possession: { $ref: '#/$defs/possession' },
          creator: { $ref: '#/$defs/principal' },
        },
        $defs: {
          ...possessionDefs,
        },
      };
    },
  },
  {
    id: 'agent-body/terminate-instance-command',
    output: 'contracts/agent-body/terminate-instance-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('terminate-instance-command'),
        title: 'Arena terminate-instance command payload v1',
        description:
          'Idempotency-keyed command payload terminating an agent instance with a FINAL ' +
          'terminal status (completed/failed/terminated). Travels inside Envelope<T> ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['instanceId', 'possessionDigest', 'status', 'reason', 'terminatedAt'],
        properties: {
          instanceId: { type: 'string', pattern: INSTANCE_ID_PATTERN },
          possessionDigest: { type: 'string', pattern: DIGEST_PATTERN },
          status: { enum: INSTANCE_TERMINATION_STATUSES },
          reason: { type: 'string', minLength: 1 },
          terminatedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
      };
    },
  },
  {
    id: 'agent-body/substrate-registered-event',
    output: 'contracts/agent-body/substrate-registered-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('substrate-registered-event'),
        title: 'Arena substrate-registered event payload v1',
        description:
          'Event payload emitted when a cognitive substrate is registered. Travels inside ' +
          'Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['substrate'],
        properties: {
          substrate: { $ref: '#/$defs/cognitiveSubstrate' },
        },
        $defs: {
          cognitiveSubstrate: cognitiveSubstrateDef,
          contextLimits: contextLimitsDef,
        },
      };
    },
  },
  {
    id: 'agent-body/possession-created-event',
    output: 'contracts/agent-body/possession-created-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('possession-created-event'),
        title: 'Arena possession-created event payload v1',
        description:
          'Event payload emitted when a possession binding is created. Travels inside ' +
          'Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['possession'],
        properties: {
          possession: { $ref: '#/$defs/possession' },
        },
        $defs: {
          ...possessionDefs,
        },
      };
    },
  },
  {
    id: 'agent-body/agent-instance-terminated-event',
    output: 'contracts/agent-body/agent-instance-terminated-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('agent-instance-terminated-event'),
        title: 'Arena agent-instance-terminated event payload v1',
        description:
          'Event payload emitted when an agent instance reaches a terminal state. ' +
          'Travels inside Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['instanceId', 'possessionDigest', 'termination'],
        properties: {
          instanceId: { type: 'string', pattern: INSTANCE_ID_PATTERN },
          possessionDigest: { type: 'string', pattern: DIGEST_PATTERN },
          termination: {
            type: 'object',
            additionalProperties: false,
            required: ['status', 'terminatedAt', 'reason'],
            properties: {
              status: { enum: INSTANCE_TERMINATION_STATUSES },
              terminatedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
              reason: { type: 'string', minLength: 1 },
            },
          },
        },
      };
    },
  },
  {
    id: 'agent-body/schema-registry',
    output: 'contracts/agent-body/agent-body-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('schema-registry'),
        title: 'Arena agent-body schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/agent-body. A SchemaRef matching this ' +
          'enum is a known agent-body schema at the listed version; anything else is not.',
        type: 'string',
        enum: AGENT_BODY_SCHEMA_NAMES.map((name) => aref(name)),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serialization (same algorithm as the A001 generator)
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
  const tempDir = join(tmpdir(), `arena-agent-body-contracts-${process.pid}-${Date.now()}`);
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
    // (contracts/agent-body) — never the whole tree, so running --check
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
        '[contracts] run: node packages/agent-body/scripts/generate-contracts.mjs   then commit the result',
      );
      return 1;
    }
    console.log(`[contracts] drift check clean (${generatedFiles.length} contract file(s) match)`);
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
  console.log('[contracts] regenerate committed with: git add contracts/agent-body');
}

main();
