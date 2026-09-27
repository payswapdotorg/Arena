#!/usr/bin/env node
/**
 * Arena capability-case contract generator (Work Order A005).
 *
 * Follows the A001/A002/A004 generated-contracts convention
 * (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A005 surfaces ONLY — it
 *     emits every schema for @arena/capability-case into
 *     contracts/capability-case/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part
 *     of `pnpm test`, the package script `contracts:check` runs it directly,
 *     and the repo-wide governance G9 entry point runs every package-level
 *     generator (packages/<pkg>/scripts/generate-contracts.mjs) with
 *     --check, so this generator is wired into governance without any root
 *     file edit.
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
// Shared protocol constants — MUST match the TypeScript surface
// (packages/capability-case/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

// capability-case constants (packages/capability-case/src)
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const CASE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const CASE_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const NODE_KINDS = [
  'domain',
  'capability',
  'sub-capability',
  'skill',
  'tool',
  'task-family',
  'evaluator',
  'verifier',
  'expert-competency',
  'observed-failure',
  'body-version',
];
const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
const CASE_STATUSES = [
  'draft',
  'submitted',
  'triaged',
  'active',
  'resolved',
  'superseded',
];
const CASE_LIFECYCLE_EVENT_KINDS = [
  'case-created',
  'case-submitted',
  'case-triaged',
  'case-activated',
  'case-resolved',
  'case-superseded',
  'evidence-attached',
];
const CASE_PRIORITIES = ['low', 'normal', 'high', 'critical'];
const CASE_RISK_LEVELS = ['low', 'moderate', 'high', 'severe'];
const TASK_DIFFICULTY_LEVELS = ['exploratory', 'standard', 'routine'];
const SUBSTRATE_ADAPTER_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const SUBSTRATE_MODEL_FAMILY_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const SUBSTRATE_MODEL_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$';
const SUBSTRATE_MODEL_REVISION_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
const CAPABILITY_CASE_ERROR_CODES = [
  'CAPABILITY_CASE_CASE_NOT_FOUND',
  'CAPABILITY_CASE_CROSS_TENANT_ACCESS',
  'CAPABILITY_CASE_DUPLICATE_EVIDENCE',
  'CAPABILITY_CASE_EVIDENCE_REMOVAL',
  'CAPABILITY_CASE_IDENTITY_CONFLICT',
  'CAPABILITY_CASE_INVALID_CASE',
  'CAPABILITY_CASE_INVALID_COMPILATION_TARGET',
  'CAPABILITY_CASE_INVALID_DIGEST',
  'CAPABILITY_CASE_INVALID_EVIDENCE',
  'CAPABILITY_CASE_INVALID_IDENTITY',
  'CAPABILITY_CASE_INVALID_LIFECYCLE',
  'CAPABILITY_CASE_INVALID_PRINCIPAL',
  'CAPABILITY_CASE_INVALID_REF',
  'CAPABILITY_CASE_INVALID_REQUIREMENTS',
  'CAPABILITY_CASE_INVALID_STATUS',
  'CAPABILITY_CASE_INVALID_SUPERSESSION',
  'CAPABILITY_CASE_INVALID_TIMESTAMP',
  'CAPABILITY_CASE_INVALID_TRANSITION',
  'CAPABILITY_CASE_INVALID_VERSION',
  'CAPABILITY_CASE_TAMPERED',
  'CAPABILITY_CASE_TERMINAL_STATE',
  'CAPABILITY_CASE_UNKNOWN_ERROR',
  'CAPABILITY_CASE_UNSUPPORTED_RECORD_VERSION',
];
const ERROR_CATEGORIES = [
  'access',
  'encoding',
  'integrity',
  'unknown',
  'validation',
  'versioning',
];
const RECORD_VERSION = 1;
const EVENT_VERSION = 1;
const TARGET_VERSION = 1;
const CAPABILITY_CASE_SCHEMA_VERSION = '1.0.0';
const CAPABILITY_CASE_SCHEMA_NAMES = [
  'case-ref',
  'evidence-ref',
  'principal',
  'observed-failure',
  'expert-requirements',
  'environment-requirements',
  'task-requirements',
  'evaluation-requirements',
  'verification-requirements',
  'case',
  'lifecycle-event',
  'compilation-target',
  'error',
  'register-case-command',
  'submit-case-command',
  'triage-case-command',
  'activate-case-command',
  'resolve-case-command',
  'supersede-case-command',
  'attach-evidence-command',
  'case-registered-event',
  'case-submitted-event',
  'case-triaged-event',
  'case-activated-event',
  'case-resolved-event',
  'case-superseded-event',
  'evidence-attached-event',
  'compilation-target-derived-event',
  'schema-registry',
];

const cref = (name) =>
  `arena:schema/capability-case/${name}@${CAPABILITY_CASE_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001/A002/A004 contracts).

const caseIdentityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'caseId'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    caseId: { type: 'string', pattern: CASE_ID_PATTERN },
  },
};

const caseRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'caseId', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    caseId: { type: 'string', pattern: CASE_ID_PATTERN },
    version: { type: 'string', pattern: CASE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const principalDef = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'tenant', 'principalId'],
  properties: {
    type: { enum: PRINCIPAL_TYPES },
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    principalId: { type: 'string', pattern: PRINCIPAL_ID_PATTERN },
  },
};

const evidenceRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['digest', 'description'],
  properties: {
    digest: { type: 'string', pattern: DIGEST_PATTERN },
    description: { type: 'string', minLength: 1 },
  },
};

const capabilityNodeRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'version', 'digest'],
  properties: {
    kind: { enum: NODE_KINDS },
    id: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,127}$' },
    version: { type: 'string', pattern: CASE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const artifactRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'name', 'version', 'digest'],
  properties: {
    namespace: { type: 'string', pattern: ARTIFACT_NAMESPACE_PATTERN },
    name: { type: 'string', pattern: ARTIFACT_NAME_PATTERN },
    version: { type: 'string', pattern: CASE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const provenanceRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['recordDigest'],
  properties: {
    recordDigest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const bodyRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'name', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    name: { type: 'string', pattern: ARTIFACT_NAME_PATTERN },
    version: { type: 'string', pattern: CASE_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const substrateRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['adapterId', 'modelFamily', 'modelId', 'modelRevision', 'contentDigest'],
  properties: {
    adapterId: { type: 'string', pattern: SUBSTRATE_ADAPTER_ID_PATTERN },
    modelFamily: { type: 'string', pattern: SUBSTRATE_MODEL_FAMILY_PATTERN },
    modelId: { type: 'string', pattern: SUBSTRATE_MODEL_ID_PATTERN },
    modelRevision: { type: 'string', pattern: SUBSTRATE_MODEL_REVISION_PATTERN },
    contentDigest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const observedFailureDef = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'observedAt'],
  properties: {
    summary: { type: 'string', minLength: 1 },
    observedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    reproduction: { type: 'string', minLength: 1 },
    failureNode: { $ref: '#/$defs/capabilityNodeRef' },
  },
};

const expertRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['competencies', 'qualifications'],
  properties: {
    competencies: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/capabilityNodeRef' },
    },
    qualifications: { type: 'array', items: { type: 'string', minLength: 1 } },
    availability: { type: 'string', minLength: 1 },
  },
};

const environmentRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['environments', 'constraints'],
  properties: {
    environments: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/artifactRef' },
    },
    constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const taskRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'objectives',
    'constraints',
    'allowedTools',
    'forbiddenShortcuts',
    'successConditions',
    'evidenceCriteria',
    'difficulty',
  ],
  properties: {
    objectives: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
    allowedTools: { type: 'array', items: { $ref: '#/$defs/artifactRef' } },
    forbiddenShortcuts: { type: 'array', items: { type: 'string', minLength: 1 } },
    successConditions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    evidenceCriteria: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    difficulty: { enum: TASK_DIFFICULTY_LEVELS },
  },
};

const evaluationRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluators', 'criteria'],
  properties: {
    evaluators: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/capabilityNodeRef' },
    },
    criteria: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
};

const verificationRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['verifiers', 'evidenceStandards'],
  properties: {
    verifiers: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/capabilityNodeRef' },
    },
    evidenceStandards: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
  },
};

const lifecycleEventDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'eventVersion',
    'sequence',
    'kind',
    'occurredAt',
    'actor',
    'fromStatus',
    'toStatus',
  ],
  properties: {
    eventVersion: { const: EVENT_VERSION },
    sequence: { type: 'integer', minimum: 1 },
    kind: { enum: CASE_LIFECYCLE_EVENT_KINDS },
    occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    actor: { $ref: '#/$defs/principal' },
    fromStatus: { enum: CASE_STATUSES },
    toStatus: { enum: CASE_STATUSES },
    note: { type: 'string', minLength: 1 },
    evidenceAppended: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/evidenceRef' },
    },
    supersededBy: { $ref: '#/$defs/caseRef' },
  },
};

const caseDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'identity',
    'version',
    'status',
    'source',
    'problemStatement',
    'targetCapability',
    'domain',
    'context',
    'observedFailure',
    'evidence',
    'unknowns',
    'desiredOutcome',
    'expertRequirements',
    'environmentRequirements',
    'taskRequirements',
    'evaluationRequirements',
    'verificationRequirements',
    'provenance',
    'priority',
    'risk',
    'lifecycle',
    'digest',
  ],
  properties: {
    recordVersion: { const: RECORD_VERSION },
    identity: { $ref: '#/$defs/caseIdentity' },
    version: { type: 'string', pattern: CASE_VERSION_PATTERN },
    status: { enum: CASE_STATUSES },
    source: { $ref: '#/$defs/principal' },
    problemStatement: { type: 'string', minLength: 1 },
    targetCapability: { $ref: '#/$defs/capabilityNodeRef' },
    domain: { $ref: '#/$defs/capabilityNodeRef' },
    context: { type: 'string', minLength: 1 },
    observedFailure: { $ref: '#/$defs/observedFailure' },
    evidence: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/evidenceRef' },
    },
    unknowns: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    desiredOutcome: { type: 'string', minLength: 1 },
    expertRequirements: { $ref: '#/$defs/expertRequirements' },
    environmentRequirements: { $ref: '#/$defs/environmentRequirements' },
    taskRequirements: { $ref: '#/$defs/taskRequirements' },
    evaluationRequirements: { $ref: '#/$defs/evaluationRequirements' },
    verificationRequirements: { $ref: '#/$defs/verificationRequirements' },
    currentBody: { $ref: '#/$defs/bodyRef' },
    currentSubstrate: { $ref: '#/$defs/substrateRef' },
    provenance: { $ref: '#/$defs/provenanceRef' },
    priority: { enum: CASE_PRIORITIES },
    risk: { enum: CASE_RISK_LEVELS },
    parent: { $ref: '#/$defs/caseRef' },
    supersedes: { $ref: '#/$defs/caseRef' },
    supersededBy: { $ref: '#/$defs/caseRef' },
    lifecycle: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/lifecycleEvent' },
    },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

/** The full $defs bundle for the case schema (self-contained contract). */
const caseDefs = {
  caseIdentity: caseIdentityDef,
  caseRef: caseRefDef,
  principal: principalDef,
  evidenceRef: evidenceRefDef,
  capabilityNodeRef: capabilityNodeRefDef,
  artifactRef: artifactRefDef,
  provenanceRef: provenanceRefDef,
  bodyRef: bodyRefDef,
  substrateRef: substrateRefDef,
  observedFailure: observedFailureDef,
  expertRequirements: expertRequirementsDef,
  environmentRequirements: environmentRequirementsDef,
  taskRequirements: taskRequirementsDef,
  evaluationRequirements: evaluationRequirementsDef,
  verificationRequirements: verificationRequirementsDef,
  lifecycleEvent: lifecycleEventDef,
};

const compilationTargetDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'targetVersion',
    'caseRef',
    'domain',
    'targetCapability',
    'taskRequirements',
    'environmentRequirements',
    'evaluationRequirements',
    'verificationRequirements',
    'evidence',
    'derivedAt',
    'digest',
  ],
  properties: {
    targetVersion: { const: TARGET_VERSION },
    caseRef: { $ref: '#/$defs/caseRef' },
    domain: { $ref: '#/$defs/capabilityNodeRef' },
    targetCapability: { $ref: '#/$defs/capabilityNodeRef' },
    taskRequirements: { $ref: '#/$defs/taskRequirements' },
    environmentRequirements: { $ref: '#/$defs/environmentRequirements' },
    evaluationRequirements: { $ref: '#/$defs/evaluationRequirements' },
    verificationRequirements: { $ref: '#/$defs/verificationRequirements' },
    evidence: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/evidenceRef' },
    },
    currentBody: { $ref: '#/$defs/bodyRef' },
    currentSubstrate: { $ref: '#/$defs/substrateRef' },
    derivedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const transitionCommandDefs = {
  principal: principalDef,
  caseRef: caseRefDef,
  evidenceRef: evidenceRefDef,
};

function transitionCommandDef(extra) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['currentStateDigest', 'at', 'actor', ...extra.required],
    properties: {
      currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
      at: { type: 'string', pattern: TIMESTAMP_PATTERN },
      actor: { $ref: '#/$defs/principal' },
      note: { type: 'string', minLength: 1 },
      ...extra.properties,
    },
  };
}

function caseTransitionedEventDef() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['caseRecord', 'event'],
    properties: {
      caseRecord: { $ref: '#/$defs/case' },
      event: { $ref: '#/$defs/lifecycleEvent' },
    },
  };
}

// ---------------------------------------------------------------------------
// Contract manifest — every schema owned by @arena/capability-case
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'capability-case/case-ref',
    output: 'contracts/capability-case/case-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-ref'),
        title: 'Arena capability-case version ref v1',
        description:
          'A content-addressed reference to one exact case-version STATE: tenant/caseId ' +
          'identity, semver version, and the sha256 digest of that state (the digest pins ' +
          'the exact lifecycle state because status and history are part of the content).',
        ...caseRefDef,
      };
    },
  },
  {
    id: 'capability-case/evidence-ref',
    output: 'contracts/capability-case/evidence-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('evidence-ref'),
        title: 'Arena evidence reference v1',
        description:
          'A digest-addressed evidence reference: the sha256 content digest of the ' +
          'evidence artifact plus a statement of what the evidence shows. Evidence lists ' +
          'are append-only (architecture-lock rule 6); no API removes or rewrites them.',
        ...evidenceRefDef,
      };
    },
  },
  {
    id: 'capability-case/principal',
    output: 'contracts/capability-case/principal.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('principal'),
        title: 'Arena capability-case principal v1',
        description:
          'The tenant-scoped principal that raised or acted on a case (spec CC1.0 ' +
          '"source"). Structurally compatible with @arena/artifact-protocol PrincipalRef; ' +
          'never a raw provider identity (lock rule 10).',
        ...principalDef,
      };
    },
  },
  {
    id: 'capability-case/observed-failure',
    output: 'contracts/capability-case/observed-failure.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('observed-failure'),
        title: 'Arena observed-failure record v1',
        description:
          'The recorded observation that motivated a case (spec CC1.0 "observed ' +
          'failure/opportunity"), optionally mapped to a capability-graph observed-failure ' +
          'node (a FailureCluster). Changing a hypothesis never deletes the observations.',
        ...observedFailureDef,
        $defs: { capabilityNodeRef: capabilityNodeRefDef },
      };
    },
  },
  {
    id: 'capability-case/expert-requirements',
    output: 'contracts/capability-case/expert-requirements.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('expert-requirements'),
        title: 'Arena expert requirements v1',
        description:
          'What a case requires of experts: competency graph nodes (expert-competency ' +
          'kind), qualification expectations and optional availability needs. ' +
          'Qualification is distinct from system authority (lock rule 9).',
        ...expertRequirementsDef,
        $defs: { capabilityNodeRef: capabilityNodeRefDef },
      };
    },
  },
  {
    id: 'capability-case/environment-requirements',
    output: 'contracts/capability-case/environment-requirements.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('environment-requirements'),
        title: 'Arena environment requirements v1',
        description:
          'What a case requires of execution environments: content-addressed environment ' +
          'declarations (ENV1.0 references, owned by @arena/environment-protocol) plus ' +
          'explicit constraint statements.',
        ...environmentRequirementsDef,
        $defs: { artifactRef: artifactRefDef },
      };
    },
  },
  {
    id: 'capability-case/task-requirements',
    output: 'contracts/capability-case/task-requirements.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('task-requirements'),
        title: 'Arena task requirements v1',
        description:
          'What a case requires of the tasks compiled from it, in the TaskSpec §6 ' +
          'vocabulary. The A008 compiler flattens these into TaskSpecs; this object is ' +
          'the requirement source, not a compiled task.',
        ...taskRequirementsDef,
        $defs: { artifactRef: artifactRefDef },
      };
    },
  },
  {
    id: 'capability-case/evaluation-requirements',
    output: 'contracts/capability-case/evaluation-requirements.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('evaluation-requirements'),
        title: 'Arena evaluation requirements v1',
        description:
          'What a case requires of EVALUATION (judging performance against criteria): ' +
          'evaluator bindings and criteria. Evaluation and verification are distinct ' +
          'responsibilities (architecture-lock rule 7).',
        ...evaluationRequirementsDef,
        $defs: { capabilityNodeRef: capabilityNodeRefDef },
      };
    },
  },
  {
    id: 'capability-case/verification-requirements',
    output: 'contracts/capability-case/verification-requirements.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('verification-requirements'),
        title: 'Arena verification requirements v1',
        description:
          'What a case requires of VERIFICATION (establishing evidence/proof): verifier ' +
          'bindings and evidence standards. Verification and evaluation are distinct ' +
          'responsibilities (architecture-lock rule 7).',
        ...verificationRequirementsDef,
        $defs: { capabilityNodeRef: capabilityNodeRefDef },
      };
    },
  },
  {
    id: 'capability-case/lifecycle-event',
    output: 'contracts/capability-case/lifecycle-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('lifecycle-event'),
        title: 'Arena capability-case lifecycle event v1',
        description:
          'One append-only lifecycle event: kind, timestamp, actor, the status ' +
          'transition, and the structured data the event commits (appended evidence / ' +
          'the superseding version ref). History is append-only and never rewritten ' +
          '(architecture-lock rule 6).',
        ...lifecycleEventDef,
        $defs: {
          principal: principalDef,
          caseRef: caseRefDef,
          evidenceRef: evidenceRefDef,
        },
      };
    },
  },
  {
    id: 'capability-case/case',
    output: 'contracts/capability-case/case.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case'),
        title: 'Arena CapabilityCase v1',
        description:
          'The bridge from observed failure to capability development (architecture §5): ' +
          'a versioned, content-addressed, deep-frozen record of target capability, ' +
          'domain, context, observed failure, evidence, current body/substrate (both ' +
          'optional), uncertainty, desired outcome, expert/environment/task/evaluation/' +
          'verification requirements, source, problem statement, priority, risk, ' +
          'provenance, lifecycle status and append-only history. Every case is ' +
          'tenant-scoped (lock rule 11); evidence is append-only (lock rule 6).',
        ...caseDef,
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/compilation-target',
    output: 'contracts/capability-case/compilation-target.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('compilation-target'),
        title: 'Arena TaskCompilationTarget v1',
        description:
          "The typed data contract between Capability Cases and the TaskSpec compiler " +
          '(A008): a case\'s requirements flattened into compiler-consumable refs, ' +
          'content-addressed and derived only from TRIAGED or ACTIVE cases. Pure data ' +
          'contract — no compiler logic lives in @arena/capability-case.',
        ...compilationTargetDef,
        $defs: {
          caseRef: caseRefDef,
          capabilityNodeRef: capabilityNodeRefDef,
          artifactRef: artifactRefDef,
          bodyRef: bodyRefDef,
          substrateRef: substrateRefDef,
          evidenceRef: evidenceRefDef,
          taskRequirements: taskRequirementsDef,
          environmentRequirements: environmentRequirementsDef,
          evaluationRequirements: evaluationRequirementsDef,
          verificationRequirements: verificationRequirementsDef,
        },
      };
    },
  },
  {
    id: 'capability-case/error',
    output: 'contracts/capability-case/capability-case-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('error'),
        title: 'Arena CapabilityCaseError v1',
        description:
          'Structured, serializable form of the capability-case error taxonomy. Unknown ' +
          'codes are rejected when parsing (CAPABILITY_CASE_UNKNOWN_ERROR).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: CAPABILITY_CASE_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
        },
      };
    },
  },
  {
    id: 'capability-case/register-case-command',
    output: 'contracts/capability-case/register-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('register-case-command'),
        title: 'Arena register-case command payload v1',
        description:
          'Command payload: register a fresh case in a case registry. Commands travel ' +
          'inside Envelope<T> with a REQUIRED idempotency key (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['caseRecord', 'registrar'],
        properties: {
          caseRecord: { $ref: '#/$defs/case' },
          registrar: { $ref: '#/$defs/principal' },
        },
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/submit-case-command',
    output: 'contracts/capability-case/submit-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('submit-case-command'),
        title: 'Arena submit-case command payload v1',
        description:
          'Command payload: submit the case state addressed by currentStateDigest for ' +
          'triage (DRAFT → SUBMITTED). Commands carry a REQUIRED idempotency key.',
        ...transitionCommandDef({ required: [], properties: {} }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/triage-case-command',
    output: 'contracts/capability-case/triage-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('triage-case-command'),
        title: 'Arena triage-case command payload v1',
        description:
          'Command payload: record the triage decision (SUBMITTED → TRIAGED). The note ' +
          'is REQUIRED — the selection rationale remains inspectable (spec CC1.0).',
        ...transitionCommandDef({ required: ['note'], properties: {} }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/activate-case-command',
    output: 'contracts/capability-case/activate-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('activate-case-command'),
        title: 'Arena activate-case command payload v1',
        description:
          'Command payload: activate a triaged case (TRIAGED → ACTIVE) — capability ' +
          'development begins. Commands carry a REQUIRED idempotency key.',
        ...transitionCommandDef({ required: [], properties: {} }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/resolve-case-command',
    output: 'contracts/capability-case/resolve-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('resolve-case-command'),
        title: 'Arena resolve-case command payload v1',
        description:
          'Command payload: resolve an active case (ACTIVE → RESOLVED, terminal). The ' +
          'resolution statement is REQUIRED.',
        ...transitionCommandDef({
          required: ['resolution'],
          properties: {
            resolution: { type: 'string', minLength: 1 },
          },
        }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/supersede-case-command',
    output: 'contracts/capability-case/supersede-case-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('supersede-case-command'),
        title: 'Arena supersede-case command payload v1',
        description:
          'Command payload: mark the case state addressed by currentStateDigest ' +
          'SUPERSEDED by the superseding version ref (terminal; the superseded version ' +
          'stays immutable and addressable).',
        ...transitionCommandDef({
          required: ['superseding'],
          properties: {
            superseding: { $ref: '#/$defs/caseRef' },
          },
        }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/attach-evidence-command',
    output: 'contracts/capability-case/attach-evidence-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('attach-evidence-command'),
        title: 'Arena attach-evidence command payload v1',
        description:
          'Command payload: append digest-addressed evidence refs to a case (append-only; ' +
          'no removal or rewrite API exists — architecture-lock rule 6).',
        ...transitionCommandDef({
          required: ['evidence'],
          properties: {
            evidence: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/$defs/evidenceRef' },
            },
          },
        }),
        $defs: transitionCommandDefs,
      };
    },
  },
  {
    id: 'capability-case/case-registered-event',
    output: 'contracts/capability-case/case-registered-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-registered-event'),
        title: 'Arena case-registered event payload v1',
        description:
          'Event payload emitted when a case is registered: the resulting case state and ' +
          'its case-created lifecycle event. Travels inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/case-submitted-event',
    output: 'contracts/capability-case/case-submitted-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-submitted-event'),
        title: 'Arena case-submitted event payload v1',
        description:
          'Event payload emitted when a case is submitted for triage: the resulting case ' +
          'state and its case-submitted lifecycle event. Travels inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/case-triaged-event',
    output: 'contracts/capability-case/case-triaged-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-triaged-event'),
        title: 'Arena case-triaged event payload v1',
        description:
          'Event payload emitted when the triage decision is recorded: the resulting case ' +
          'state and its case-triaged lifecycle event (rationale included). Travels inside ' +
          'Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/case-activated-event',
    output: 'contracts/capability-case/case-activated-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-activated-event'),
        title: 'Arena case-activated event payload v1',
        description:
          'Event payload emitted when a triaged case is activated: the resulting case ' +
          'state and its case-activated lifecycle event. Travels inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/case-resolved-event',
    output: 'contracts/capability-case/case-resolved-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-resolved-event'),
        title: 'Arena case-resolved event payload v1',
        description:
          'Event payload emitted when a case is resolved (terminal): the resulting case ' +
          'state and its case-resolved lifecycle event (resolution included). Travels ' +
          'inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/case-superseded-event',
    output: 'contracts/capability-case/case-superseded-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('case-superseded-event'),
        title: 'Arena case-superseded event payload v1',
        description:
          'Event payload emitted when a case version is superseded (terminal): the ' +
          'resulting case state (carrying the supersededBy ref) and its case-superseded ' +
          'lifecycle event. Travels inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/evidence-attached-event',
    output: 'contracts/capability-case/evidence-attached-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('evidence-attached-event'),
        title: 'Arena evidence-attached event payload v1',
        description:
          'Event payload emitted when evidence is appended to a case: the resulting case ' +
          'state and its evidence-attached lifecycle event. Travels inside Envelope<T>.',
        ...caseTransitionedEventDef(),
        $defs: caseDefs,
      };
    },
  },
  {
    id: 'capability-case/compilation-target-derived-event',
    output: 'contracts/capability-case/compilation-target-derived-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('compilation-target-derived-event'),
        title: 'Arena compilation-target-derived event payload v1',
        description:
          'Event payload emitted when a TaskCompilationTarget is derived from a case ' +
          'state: the content-addressed target and the deriving principal. Travels ' +
          'inside Envelope<T>.',
        type: 'object',
        additionalProperties: false,
        required: ['target', 'derivedBy'],
        properties: {
          target: { $ref: '#/$defs/compilationTarget' },
          derivedBy: { $ref: '#/$defs/principal' },
        },
        $defs: {
          compilationTarget: compilationTargetDef,
          caseRef: caseRefDef,
          capabilityNodeRef: capabilityNodeRefDef,
          artifactRef: artifactRefDef,
          bodyRef: bodyRefDef,
          substrateRef: substrateRefDef,
          evidenceRef: evidenceRefDef,
          taskRequirements: taskRequirementsDef,
          environmentRequirements: environmentRequirementsDef,
          evaluationRequirements: evaluationRequirementsDef,
          verificationRequirements: verificationRequirementsDef,
          principal: principalDef,
        },
      };
    },
  },
  {
    id: 'capability-case/schema-registry',
    output: 'contracts/capability-case/capability-case-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: cref('schema-registry'),
        title: 'Arena capability-case schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/capability-case. A SchemaRef matching ' +
          'this enum is a known capability-case schema at the listed version; anything ' +
          'else is not.',
        type: 'string',
        enum: CAPABILITY_CASE_SCHEMA_NAMES.map((name) => cref(name)),
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
  const tempDir = join(
    tmpdir(),
    `arena-capability-case-contracts-${process.pid}-${Date.now()}`,
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
    // (contracts/capability-case) — never the whole tree, so running --check
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
        '[contracts] run: node packages/capability-case/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/capability-case');
}

main();
