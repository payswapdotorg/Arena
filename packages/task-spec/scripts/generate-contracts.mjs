#!/usr/bin/env node
/**
 * Arena task-spec contract generator (Work Order A008).
 *
 * Follows the A001/A002/A004/A005/A007/A012 generated-contracts convention
 * (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A008 surfaces ONLY — it
 *     emits every schema for @arena/task-spec into contracts/task/ at the
 *     repository root.
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
// (packages/task-spec/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const TASK_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const CAPABILITY_LABEL_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const NODE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const CASE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const TASK_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const COMPILATION_KEY_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

// task-spec constants (packages/task-spec/src)
const TASK_CLASSES = [
  'demonstration',
  'correction',
  'critique',
  'preference',
  'diagnosis',
  'long-horizon-execution',
  'tool-use',
  'environment-exploration',
  'adversarial',
  'benchmark',
  'recovery-failure',
];
const TASK_DIFFICULTY_SCALES = ['arena:task-difficulty@1'];
const TASK_DIFFICULTY_CLASSES = ['exploratory', 'standard', 'routine'];
const TASK_QUALITY_DIMENSIONS = [
  'realistic-context',
  'discriminative-difficulty',
  'observable-success',
  'reproducible-evaluation',
  'low-leakage',
  'clear-provenance',
  'declared-limitations',
];
const QUALITY_PROVENANCE_SOURCES = [
  'compilation-policy',
  'case-evidence',
  'expert-declaration',
];
const DATA_RIGHTS_CLASSIFICATIONS = [
  'private-tenant',
  'tenant-shareable',
  'arena-internal',
  'public',
];
const COMPETENCY_NODE_KINDS = ['capability', 'sub-capability', 'skill'];
const POLICY_COMPILABLE_CASE_STATUSES = ['triaged', 'active'];
const CLASS_SELECTION_MATCHER_KINDS = [
  'always',
  'difficulty-is',
  'tools-present',
  'shortcuts-present',
  'evidence-at-least',
];
const POLICY_DIFFICULTY_MODES = ['from-case', 'declared'];
const OBJECTIVES_MAPPING_MODES = ['pass-through', 'first'];
const CONSTRAINTS_MAPPING_MODES = ['pass-through', 'union'];
const SHORTCUTS_MAPPING_MODES = ['pass-through', 'union'];
const TOOLS_MAPPING_MODES = ['pass-through', 'none'];
const OUTPUTS_MAPPING_MODES = ['from-success-conditions', 'declared'];
const INSTRUCTION_PLACEHOLDERS = [
  '{caseId}',
  '{domain}',
  '{capability}',
  '{objectives}',
  '{difficulty}',
  '{evidenceCount}',
];
const ENVIRONMENT_SELECTION_MODES = ['first', 'each'];
const EXPERT_QUALIFICATION_MODES = ['from-target-capability', 'declare'];
const TASK_SPEC_ERROR_CODES = [
  'TASK_SPEC_CASE_NOT_FOUND',
  'TASK_SPEC_CROSS_FIELD_CONSISTENCY',
  'TASK_SPEC_CROSS_TENANT_ACCESS',
  'TASK_SPEC_IDEMPOTENCY_CONFLICT',
  'TASK_SPEC_IDENTITY_CONFLICT',
  'TASK_SPEC_INVALID_BINDING',
  'TASK_SPEC_INVALID_CLASS',
  'TASK_SPEC_INVALID_CLASS_SELECTION',
  'TASK_SPEC_INVALID_DATA_RIGHTS',
  'TASK_SPEC_INVALID_DIFF',
  'TASK_SPEC_INVALID_DIFFICULTY',
  'TASK_SPEC_INVALID_DIGEST',
  'TASK_SPEC_INVALID_ENVIRONMENT',
  'TASK_SPEC_INVALID_FIELD_MAPPING',
  'TASK_SPEC_INVALID_IDENTITY',
  'TASK_SPEC_INVALID_POLICY',
  'TASK_SPEC_INVALID_PROVENANCE',
  'TASK_SPEC_INVALID_QUALITY',
  'TASK_SPEC_INVALID_RECORD',
  'TASK_SPEC_INVALID_REF',
  'TASK_SPEC_INVALID_REQUIREMENTS',
  'TASK_SPEC_INVALID_SPEC',
  'TASK_SPEC_INVALID_SUPERSESSION',
  'TASK_SPEC_INVALID_TIMESTAMP',
  'TASK_SPEC_INVALID_VERSION',
  'TASK_SPEC_POLICY_NOT_FOUND',
  'TASK_SPEC_TASK_NOT_FOUND',
  'TASK_SPEC_TAMPERED',
  'TASK_SPEC_UNKNOWN_ERROR',
  'TASK_SPEC_UNSUPPORTED_RECORD_VERSION',
  'TASK_SPEC_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = [
  'access',
  'encoding',
  'integrity',
  'unknown',
  'validation',
  'versioning',
];
const TASK_SPEC_RECORD_VERSION = 1;
const COMPILATION_POLICY_VERSION = 1;
const COMPILATION_RECORD_VERSION = 1;
const TASK_SPEC_SCHEMA_VERSION = '1.0.0';
const TASK_SPEC_SCHEMA_NAMES = [
  'task-spec',
  'task-class',
  'compilation-policy',
  'compilation-record',
  'run-compilation-command',
  'compilation-recorded-event',
  'error',
  'schema-registry',
];

const tref = (name) => `arena:schema/task/${name}@${TASK_SPEC_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the sibling contracts).

const taskIdentityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'taskId'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    taskId: { type: 'string', pattern: TASK_ID_PATTERN },
  },
};

const taskVersionRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'taskId', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    taskId: { type: 'string', pattern: TASK_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const nodeRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id', 'version', 'digest'],
  properties: {
    kind: {
      type: 'string',
      enum: [
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
      ],
    },
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
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
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const caseRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'caseId', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    caseId: { type: 'string', pattern: CASE_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const policyRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['policyId', 'version', 'digest'],
  properties: {
    policyId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const evaluatorBindingDef = {
  type: 'object',
  additionalProperties: false,
  required: ['evaluatorId', 'version', 'descriptorDigest'],
  properties: {
    evaluatorId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    descriptorDigest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const verifierBindingDef = {
  type: 'object',
  additionalProperties: false,
  required: ['verifierId', 'version', 'descriptorDigest'],
  properties: {
    verifierId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
    version: { type: 'string', pattern: TASK_VERSION_PATTERN },
    descriptorDigest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const difficultyDef = {
  type: 'object',
  additionalProperties: false,
  required: ['scale', 'class'],
  properties: {
    scale: { type: 'string', enum: TASK_DIFFICULTY_SCALES },
    class: { type: 'string', enum: TASK_DIFFICULTY_CLASSES },
  },
};

const qualityDeclarationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['dimension', 'satisfied', 'justification', 'provenance'],
  properties: {
    dimension: { type: 'string', enum: TASK_QUALITY_DIMENSIONS },
    satisfied: { type: 'boolean' },
    justification: { type: 'string', minLength: 1 },
    provenance: {
      type: 'object',
      additionalProperties: false,
      required: ['source', 'ref'],
      properties: {
        source: { type: 'string', enum: QUALITY_PROVENANCE_SOURCES },
        ref: { type: 'string', minLength: 1 },
      },
    },
  },
};

const longHorizonEvidenceDef = {
  type: 'object',
  additionalProperties: false,
  required: ['intermediateStateEvidence', 'recoveryCriteria'],
  properties: {
    intermediateStateEvidence: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 1 },
    },
    recoveryCriteria: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
};

const initialStateDef = {
  type: 'object',
  additionalProperties: false,
  required: ['environment', 'seed', 'note'],
  properties: {
    environment: artifactRefDef,
    seed: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
    note: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
  },
};

const environmentRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['environments', 'constraints'],
  properties: {
    environments: { type: 'array', minItems: 1, items: artifactRefDef },
    constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
};

const expertQualificationRequirementsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['competencies', 'qualificationPolicy', 'expectations'],
  properties: {
    competencies: {
      type: 'array',
      minItems: 1,
      items: {
        allOf: [
          nodeRefDef,
          { type: 'object', properties: { kind: { enum: COMPETENCY_NODE_KINDS } } },
        ],
      },
    },
    qualificationPolicy: { oneOf: [{ type: 'null' }, policyRefDef] },
    expectations: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  },
};

const dataRightsDef = {
  type: 'object',
  additionalProperties: false,
  required: ['classification', 'tenantScope', 'crossTenantReuse', 'licensing', 'privacyNotes'],
  properties: {
    classification: { type: 'string', enum: DATA_RIGHTS_CLASSIFICATIONS },
    tenantScope: { type: 'string', pattern: TENANT_PATTERN },
    crossTenantReuse: { type: 'boolean' },
    licensing: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
    privacyNotes: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
  },
};

const derivationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['caseRef', 'policyRef'],
  properties: {
    caseRef: caseRefDef,
    policyRef: policyRefDef,
  },
};

// ---------------------------------------------------------------------------
// Contract manifest
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'task-spec/task-spec',
    output: 'contracts/task/task-spec.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('task-spec'),
        title: 'Arena TaskSpec v1',
        description:
          'The versioned, content-addressed reproducible unit of work (spec/task-spec.md TS1.0; ' +
          'docs/architecture.md §6). Carries every TS1.0 structure field plus long-horizon ' +
          'evidence (REQUIRED for the long-horizon-execution class), the seven declared quality ' +
          'dimensions and the derivation provenance. Cross-field rules (enforced by the guards): ' +
          'private-tenant data rights forbid cross-tenant reuse; the pinned initial-state ' +
          'environment must be among the required environment declarations; supersession targets ' +
          'the same logical task at strictly lower semver precedence.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'identity',
          'version',
          'taskClass',
          'capabilityLabels',
          'difficulty',
          'domain',
          'initialState',
          'instructions',
          'objectives',
          'constraints',
          'permittedTools',
          'prohibitedShortcuts',
          'expectedOutputs',
          'completionCriteria',
          'evidenceCriteria',
          'longHorizonEvidence',
          'environmentRequirements',
          'evaluatorBindings',
          'verifierBindings',
          'expertQualificationRequirements',
          'quality',
          'dataRights',
          'derivedFrom',
          'digest',
        ],
        properties: {
          recordVersion: { const: TASK_SPEC_RECORD_VERSION, description: 'Wire version.' },
          identity: taskIdentityDef,
          version: {
            type: 'string',
            pattern: TASK_VERSION_PATTERN,
            description: 'Semver version of this task version (no build metadata).',
          },
          supersedes: {
            ...taskVersionRefDef,
            description: 'Append-only supersession: the version this one replaces.',
          },
          taskClass: { type: 'string', enum: TASK_CLASSES },
          capabilityLabels: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', pattern: CAPABILITY_LABEL_PATTERN },
          },
          difficulty: difficultyDef,
          domain: {
            allOf: [nodeRefDef, { type: 'object', properties: { kind: { enum: ['domain'] } } }],
          },
          initialState: initialStateDef,
          instructions: { type: 'string', minLength: 1 },
          objectives: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          constraints: { type: 'array', items: { type: 'string', minLength: 1 } },
          permittedTools: { type: 'array', items: artifactRefDef },
          prohibitedShortcuts: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description: 'FIRST-CLASS field: shortcut resistance is a TS1.0 quality dimension.',
          },
          expectedOutputs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          completionCriteria: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
          evidenceCriteria: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
          longHorizonEvidence: {
            oneOf: [{ type: 'null' }, longHorizonEvidenceDef],
            description:
              'Intermediate state + recoveries as first-class evidence. REQUIRED for ' +
              'long-horizon-execution; permitted for recovery-failure; null otherwise.',
          },
          environmentRequirements: environmentRequirementsDef,
          evaluatorBindings: {
            type: 'array',
            minItems: 1,
            items: evaluatorBindingDef,
            description: 'A012 EvaluatorDescriptor digest triples (lock rule 7: distinct).',
          },
          verifierBindings: {
            type: 'array',
            minItems: 1,
            items: verifierBindingDef,
            description: 'A013 VerifierDescriptor digest triples (lock rule 7: distinct).',
          },
          expertQualificationRequirements: expertQualificationRequirementsDef,
          quality: {
            type: 'array',
            minItems: TASK_QUALITY_DIMENSIONS.length,
            maxItems: TASK_QUALITY_DIMENSIONS.length,
            items: qualityDeclarationDef,
            description:
              'EXACTLY one declaration per dimension — all seven, no duplicates, none missing.',
          },
          dataRights: dataRightsDef,
          derivedFrom: derivationDef,
          digest: {
            type: 'string',
            pattern: DIGEST_PATTERN,
            description: 'sha256 over the canonical serialization of the digest-free view.',
          },
        },
      };
    },
  },
  {
    id: 'task-spec/task-class',
    output: 'contracts/task/task-class.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('task-class'),
        title: 'Arena task-class vocabulary v1',
        description:
          'The CLOSED eleven-class task vocabulary (spec/task-spec.md TS1.0 "Task classes"). ' +
          "The spec's 'recovery/failure' maps to the kebab-case 'recovery-failure' (the id " +
          'charset is lowercase kebab).',
        type: 'string',
        enum: TASK_CLASSES,
      };
    },
  },
  {
    id: 'task-spec/compilation-policy',
    output: 'contracts/task/compilation-policy.v1.json',
    build() {
      const classSelectionRuleDef = {
        type: 'object',
        additionalProperties: false,
        required: ['matcher', 'class'],
        properties: {
          matcher: { type: 'string', enum: CLASS_SELECTION_MATCHER_KINDS },
          class: { type: 'string', enum: TASK_CLASSES },
          difficulty: { type: 'string', enum: TASK_DIFFICULTY_CLASSES },
          count: { type: 'integer', minimum: 1 },
        },
      };
      return {
        $schema: DRAFT,
        $id: tref('compilation-policy'),
        title: 'Arena CompilationPolicy v1',
        description:
          'The versioned, content-addressed rule set the TaskCompiler compiles Capability ' +
          'Cases under (requirement R6). Cross-field rules: the LAST class-selection rule must ' +
          "be the 'always' matcher (total function); rules that can select " +
          "'long-horizon-execution' REQUIRE declared longHorizon evidence; compilableStatuses " +
          'is a non-empty subset of the A005 compilable set {triaged, active} (narrow-only).',
        type: 'object',
        additionalProperties: false,
        required: [
          'policyVersion',
          'policyId',
          'version',
          'description',
          'eligibility',
          'classSelection',
          'difficulty',
          'fieldMapping',
          'environment',
          'identity',
          'expertQualification',
          'quality',
          'longHorizon',
          'dataRights',
          'digest',
        ],
        properties: {
          policyVersion: { const: COMPILATION_POLICY_VERSION },
          policyId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          version: { type: 'string', pattern: TASK_VERSION_PATTERN },
          description: { type: 'string', minLength: 1 },
          eligibility: {
            type: 'object',
            additionalProperties: false,
            required: ['compilableStatuses', 'minimumEvidenceCount'],
            properties: {
              compilableStatuses: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: { type: 'string', enum: POLICY_COMPILABLE_CASE_STATUSES },
              },
              minimumEvidenceCount: { type: 'integer', minimum: 1 },
            },
          },
          classSelection: {
            type: 'object',
            additionalProperties: false,
            required: ['rules'],
            properties: {
              rules: {
                type: 'array',
                minItems: 1,
                items: classSelectionRuleDef,
              },
            },
          },
          difficulty: {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'scale', 'declaredClass'],
            properties: {
              mode: { type: 'string', enum: POLICY_DIFFICULTY_MODES },
              scale: { type: 'string', enum: TASK_DIFFICULTY_SCALES },
              declaredClass: {
                oneOf: [{ type: 'null' }, { type: 'string', enum: TASK_DIFFICULTY_CLASSES }],
              },
            },
          },
          fieldMapping: {
            type: 'object',
            additionalProperties: false,
            required: [
              'objectives',
              'constraints',
              'prohibitedShortcuts',
              'permittedTools',
              'expectedOutputs',
              'instructions',
            ],
            properties: {
              objectives: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: OBJECTIVES_MAPPING_MODES },
                  count: { type: 'integer', minimum: 1 },
                },
              },
              constraints: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: CONSTRAINTS_MAPPING_MODES },
                  additional: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
              },
              prohibitedShortcuts: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: SHORTCUTS_MAPPING_MODES },
                  additional: { type: 'array', items: { type: 'string', minLength: 1 } },
                },
              },
              permittedTools: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: { mode: { type: 'string', enum: TOOLS_MAPPING_MODES } },
              },
              expectedOutputs: {
                type: 'object',
                additionalProperties: false,
                required: ['mode'],
                properties: {
                  mode: { type: 'string', enum: OUTPUTS_MAPPING_MODES },
                  outputs: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
                },
              },
              instructions: {
                type: 'object',
                additionalProperties: false,
                required: ['mode', 'template'],
                properties: {
                  mode: { const: 'template' },
                  template: {
                    type: 'string',
                    minLength: 1,
                    description: `Placeholders restricted to: ${INSTRUCTION_PLACEHOLDERS.join(' ')}`,
                  },
                },
              },
            },
          },
          environment: {
            type: 'object',
            additionalProperties: false,
            required: ['selection', 'seed', 'note'],
            properties: {
              selection: { type: 'string', enum: ENVIRONMENT_SELECTION_MODES },
              seed: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
              note: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
            },
          },
          identity: {
            type: 'object',
            additionalProperties: false,
            required: ['taskIdPrefix', 'initialVersion'],
            properties: {
              taskIdPrefix: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
              initialVersion: { type: 'string', pattern: TASK_VERSION_PATTERN },
            },
          },
          expertQualification: {
            type: 'object',
            additionalProperties: false,
            required: ['mode', 'declared', 'expectations', 'qualificationPolicy'],
            properties: {
              mode: { type: 'string', enum: EXPERT_QUALIFICATION_MODES },
              declared: {
                oneOf: [{ type: 'null' }, expertQualificationRequirementsDef],
              },
              expectations: {
                oneOf: [
                  { type: 'null' },
                  { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
                ],
              },
              qualificationPolicy: { oneOf: [{ type: 'null' }, policyRefDef] },
            },
          },
          quality: {
            type: 'array',
            minItems: TASK_QUALITY_DIMENSIONS.length,
            maxItems: TASK_QUALITY_DIMENSIONS.length,
            items: qualityDeclarationDef,
          },
          longHorizon: { oneOf: [{ type: 'null' }, longHorizonEvidenceDef] },
          dataRights: {
            type: 'object',
            additionalProperties: false,
            required: ['classification', 'licensing', 'privacyNotes'],
            properties: {
              classification: { type: 'string', enum: DATA_RIGHTS_CLASSIFICATIONS },
              licensing: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
              privacyNotes: { oneOf: [{ type: 'null' }, { type: 'string', minLength: 1 }] },
            },
          },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
      };
    },
  },
  {
    id: 'task-spec/compilation-record',
    output: 'contracts/task/compilation-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('compilation-record'),
        title: 'Arena CompilationRecord v1',
        description:
          'The append-only, idempotency-keyed record of one compilation run (lock rule 17). ' +
          'Records what a run proposed; pins nothing — specs are proposals until pinned, and ' +
          'the case is never mutated (lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'compilationKey',
          'correlationId',
          'caseRef',
          'targetDigest',
          'policyRef',
          'emittedSpecs',
          'compiledAt',
          'digest',
        ],
        properties: {
          recordVersion: { const: COMPILATION_RECORD_VERSION },
          compilationKey: {
            type: 'string',
            pattern: COMPILATION_KEY_PATTERN,
            description: 'The idempotency key that authorized the run.',
          },
          correlationId: {
            type: 'string',
            pattern: IDENTIFIER_PATTERN,
            description: 'Correlation identifier of the causal flow.',
          },
          caseRef: caseRefDef,
          targetDigest: {
            type: 'string',
            pattern: DIGEST_PATTERN,
            description: 'The A005 TaskCompilationTarget digest the run consumed.',
          },
          policyRef: policyRefDef,
          emittedSpecs: {
            type: 'array',
            items: taskVersionRefDef,
            description: 'Content-addressed refs of the emitted TaskSpec proposals.',
          },
          compiledAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
      };
    },
  },
  {
    id: 'task-spec/run-compilation-command',
    output: 'contracts/task/run-compilation-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('run-compilation-command'),
        title: 'Arena run-compilation-command payload v1',
        description:
          'COMMAND payload (travels inside @arena/protocol-core Envelope<T> with a REQUIRED ' +
          'non-null idempotency key — lock rule 17): compile one registered case (by content ' +
          'digest) under one registered compilation policy. Timestamps are explicit inputs — ' +
          'the reference fabric takes no clock reads.',
        type: 'object',
        additionalProperties: false,
        required: ['caseDigest', 'policyRef', 'derivedAt', 'compiledAt'],
        properties: {
          caseDigest: { type: 'string', pattern: DIGEST_PATTERN },
          policyRef: policyRefDef,
          derivedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          compiledAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
      };
    },
  },
  {
    id: 'task-spec/compilation-recorded-event',
    output: 'contracts/task/compilation-recorded-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('compilation-recorded-event'),
        title: 'Arena compilation-recorded-event payload v1',
        description:
          'EVENT payload: the resulting CompilationRecord plus the emitted TaskSpec proposals.',
        type: 'object',
        additionalProperties: false,
        required: ['record', 'specs'],
        properties: {
          record: { $ref: tref('compilation-record') },
          specs: {
            type: 'array',
            items: { $ref: tref('task-spec') },
          },
        },
      };
    },
  },
  {
    id: 'task-spec/error',
    output: 'contracts/task/task-spec-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('error'),
        title: 'Arena TaskSpecError v1',
        description:
          'Structured, serializable form of the task-spec protocol error taxonomy. Unknown ' +
          'codes are rejected when parsing (TASK_SPEC_UNKNOWN_ERROR).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: TASK_SPEC_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'task-spec/schema-registry',
    output: 'contracts/task/task-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: tref('schema-registry'),
        title: 'Arena task-spec schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/task-spec. A SchemaRef matching this enum ' +
          'is a known task-spec schema at the listed version; anything else is not.',
        type: 'string',
        enum: TASK_SPEC_SCHEMA_NAMES.map((name) => tref(name)),
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Deterministic serialization
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
    `arena-task-spec-contracts-${process.pid}-${Date.now()}`,
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
    // (contracts/task) — never the whole tree, so running --check against
    // the repository root is safe.
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
        '[contracts] run: node packages/task-spec/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/task');
}

main();
