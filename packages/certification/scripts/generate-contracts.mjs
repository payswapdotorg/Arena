#!/usr/bin/env node
/**
 * Arena certification-protocol contract generator (Work Order A023).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/verification/scripts/generate-contracts.mjs — the closest
 * sibling):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A023
 *     surfaces ONLY — it emits every schema for @arena/certification
 *     into contracts/certification/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the governance G9 check auto-discovers this generator
 *     through its packages/.../generate-contracts.mjs glob (the root
 *     manifest itself needs no edit — the A002 merge generalized G9 to
 *     run every package-level generator).
 *   - The deterministic serializer is duplicated from the A001 generator
 *     (10 lines) instead of imported, because importing that module
 *     executes its CLI main() as an import side effect.
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
// (packages/certification/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const CERTIFICATION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const WORKSPACE_ID_PATTERN = '^[a-z][a-z0-9.-]{0,63}$';
const TENANT_ID_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const CERTIFICATION_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const SCHEMA_REF_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]*$';
const SCHEMA_REF_VERSION_PATTERN = '^\\d+\\.\\d+\\.\\d+$';
const CORRELATION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
// A003 agent-body identity patterns (subject components reuse them verbatim).
const AGENT_BODY_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const AGENT_BODY_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const AGENT_BODY_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
// A002 artifact-protocol identity patterns (dataset pins reuse them verbatim).
const ARTIFACT_NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const ARTIFACT_NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';

const STAGE_KINDS = ['evaluation', 'verification', 'compatibility', 'dataset', 'composition'];
const GRANT_LEVELS = ['DEVELOPMENT', 'CANDIDATE', 'CERTIFIED'];
const LEVELS = ['DEVELOPMENT', 'CANDIDATE', 'CERTIFIED', 'CONDITIONAL', 'REVOKED'];
const VERDICTS = ['satisfied', 'not-satisfied', 'unknown'];
const UNKNOWN_REASONS = [
  'missing-evidence',
  'evidence-mismatch',
  'invalid-evidence',
  'method-limitation',
  'tenant-mismatch',
];
const STAGE_REASONS = [
  'stage-satisfied',
  'stage-failed',
  'composition-mismatch',
  'missing-evidence',
  'evidence-mismatch',
  'invalid-evidence',
  'method-limitation',
  'tenant-mismatch',
];
const RECORD_KINDS = ['certification-run', 'revocation'];
const VERDICT_QUALIFIERS = ['satisfied', 'did not satisfy', 'could not be determined against'];

const CERTIFICATION_ERROR_CODES = [
  'CERTIFICATION_DUPLICATE_STAGE',
  'CERTIFICATION_EVIDENCE_MISMATCH',
  'CERTIFICATION_IDEMPOTENCY_CONFLICT',
  'CERTIFICATION_IDENTITY_CONFLICT',
  'CERTIFICATION_INVALID_DIGEST',
  'CERTIFICATION_INVALID_IDENTITY',
  'CERTIFICATION_INVALID_LEVEL',
  'CERTIFICATION_INVALID_LIMITATIONS',
  'CERTIFICATION_INVALID_PROVENANCE',
  'CERTIFICATION_INVALID_RECORD',
  'CERTIFICATION_INVALID_SCHEMA_REF',
  'CERTIFICATION_INVALID_SCOPE',
  'CERTIFICATION_INVALID_STAGE',
  'CERTIFICATION_INVALID_STATEMENT',
  'CERTIFICATION_INVALID_SUBJECT',
  'CERTIFICATION_INVALID_SUITE',
  'CERTIFICATION_INVALID_TIMESTAMP',
  'CERTIFICATION_INVALID_VERDICT',
  'CERTIFICATION_NOT_FOUND',
  'CERTIFICATION_STAGE_MISMATCH',
  'CERTIFICATION_SUPERSESSION_CONFLICT',
  'CERTIFICATION_TAMPERED',
  'CERTIFICATION_TIMESTAMP_REGRESSION',
  'CERTIFICATION_UNSCOPED_STATEMENT',
  'CERTIFICATION_UNKNOWN_ERROR',
  'CERTIFICATION_UNSUPPORTED_RECORD_VERSION',
  'CERTIFICATION_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const CERTIFICATION_SCHEMA_VERSION = '1.0.0';
const CERTIFICATION_SCHEMA_NAMES = [
  'certification-suite',
  'certification-record',
  'certification-statement',
  'certification-outcome',
  'certification-level',
  'certification-error',
  'run-certification-command',
  'certification-recorded-event',
  'schema-registry',
];

const ref = (name) => `arena:schema/certification/${name}@${CERTIFICATION_SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });

const schemaRefDef = () => ({
  schemaRef: {
    additionalProperties: false,
    description:
      'Versioned SchemaRef (A001 core shape): arena:schema/<namespace>/<name>@<major.minor.patch>.',
    properties: {
      namespace: string(SCHEMA_REF_NAMESPACE_PATTERN),
      name: string(SCHEMA_REF_NAMESPACE_PATTERN),
      version: string(SCHEMA_REF_VERSION_PATTERN),
    },
    required: ['namespace', 'name', 'version'],
    type: 'object',
  },
});

const bodyVersionRefDef = () => ({
  bodyVersionRef: {
    additionalProperties: false,
    description:
      'A003 BodyVersionRef (reused validator, never redefined): tenant/name/version identity ' +
      'plus the sha256 digest of the body version.',
    properties: {
      tenant: string(AGENT_BODY_NAMESPACE_PATTERN),
      name: string(AGENT_BODY_NAME_PATTERN),
      version: string(AGENT_BODY_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['tenant', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const substrateRefDef = () => ({
  substrateRef: {
    additionalProperties: false,
    description:
      'The neutral cognitive-substrate reference (component M of the certification statement).',
    properties: {
      substrateId: string(NEUTRAL_ID_PATTERN),
      substrateVersion: string(CERTIFICATION_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['substrateId', 'substrateVersion', 'digest'],
    type: 'object',
  },
});

const environmentProfileDef = () => ({
  environmentProfile: {
    additionalProperties: false,
    description:
      'A003 EnvironmentProfileView (component E of the certification statement).',
    properties: {
      environmentId: string(NEUTRAL_ID_PATTERN),
      environmentVersion: string(CERTIFICATION_VERSION_PATTERN),
      constraints: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
    },
    required: ['environmentId', 'environmentVersion', 'constraints'],
    type: 'object',
  },
});

const runtimeProfileDef = () => ({
  runtimeProfile: {
    additionalProperties: false,
    description:
      'A003 RuntimeProfileView (component R of the certification statement): neutral runtime ' +
      'identity + closed scalar configuration map.',
    properties: {
      runtimeId: string(NEUTRAL_ID_PATTERN),
      runtimeVersion: string(CERTIFICATION_VERSION_PATTERN),
      configuration: {
        type: 'object',
        additionalProperties: {
          oneOf: [
            { type: 'string' },
            { type: 'number' },
            { type: 'boolean' },
            { type: 'null' },
          ],
        },
      },
    },
    required: ['runtimeId', 'runtimeVersion', 'configuration'],
    type: 'object',
  },
});

const subjectDef = () => ({
  subject: {
    additionalProperties: false,
    description:
      'The COMPOSITION UNDER TEST — the B/V × M × E × R half of the design-law statement. ' +
      'Every component is REQUIRED: a substrate-only subject is unrepresentable ' +
      '(architecture-lock rule 4; requirement R46).',
    properties: {
      bodyVersionRef: { $ref: '#/$defs/bodyVersionRef' },
      substrateRef: { $ref: '#/$defs/substrateRef' },
      environmentRef: { $ref: '#/$defs/environmentProfile' },
      runtimeProfile: { $ref: '#/$defs/runtimeProfile' },
      possessionRef: nullable(digest()),
      tenantId: nullable(string(TENANT_ID_PATTERN)),
      workspaceId: nullable(string(WORKSPACE_ID_PATTERN)),
    },
    required: [
      'bodyVersionRef',
      'substrateRef',
      'environmentRef',
      'runtimeProfile',
      'possessionRef',
      'tenantId',
      'workspaceId',
    ],
    type: 'object',
  },
});

const artifactPinDef = () => ({
  artifactPin: {
    additionalProperties: false,
    description:
      'An A002-style artifact reference pin: namespace/name/version identity plus the sha256 ' +
      'digest of the pinned material (dataset manifests, test suites).',
    properties: {
      namespace: string(ARTIFACT_NAMESPACE_PATTERN),
      name: string(ARTIFACT_NAME_PATTERN),
      version: string(CERTIFICATION_VERSION_PATTERN),
      digest: digest(),
    },
    required: ['namespace', 'name', 'version', 'digest'],
    type: 'object',
  },
});

const idVersionRequirementDefs = () => ({
  environmentRequirement: {
    additionalProperties: false,
    description: 'A composition-stage environment pin (id + version).',
    properties: {
      environmentId: string(NEUTRAL_ID_PATTERN),
      environmentVersion: string(CERTIFICATION_VERSION_PATTERN),
    },
    required: ['environmentId', 'environmentVersion'],
    type: 'object',
  },
  runtimeRequirement: {
    additionalProperties: false,
    description: 'A composition-stage runtime pin (id + version).',
    properties: {
      runtimeId: string(NEUTRAL_ID_PATTERN),
      runtimeVersion: string(CERTIFICATION_VERSION_PATTERN),
    },
    required: ['runtimeId', 'runtimeVersion'],
    type: 'object',
  },
});

const suiteStageDef = () => ({
  suiteStage: {
    additionalProperties: false,
    description:
      'One suite stage: the closed kind (evaluation | verification | compatibility | dataset | ' +
      'composition) plus the pins that kind requires. Evaluation stages carry evaluatorRef + ' +
      'criteriaRef; verification stages carry verifierRef; dataset stages carry datasetRef; ' +
      'composition stages carry environment/runtime requirements; compatibility stages carry ' +
      'optional required test-suite pins. Foreign pins are rejected by the TS constructor.',
    properties: {
      stageId: string(CERTIFICATION_ID_PATTERN),
      kind: { enum: STAGE_KINDS },
      evaluatorRef: nullable(digest()),
      criteriaRef: nullable(digest()),
      verifierRef: nullable(digest()),
      requiredTestSuites: { type: 'array', items: { $ref: '#/$defs/artifactPin' } },
      datasetRef: nullable({ $ref: '#/$defs/artifactPin' }),
      environmentRequirement: nullable({ $ref: '#/$defs/environmentRequirement' }),
      runtimeRequirement: nullable({ $ref: '#/$defs/runtimeRequirement' }),
    },
    required: [
      'stageId',
      'kind',
      'evaluatorRef',
      'criteriaRef',
      'verifierRef',
      'requiredTestSuites',
      'datasetRef',
      'environmentRequirement',
      'runtimeRequirement',
    ],
    type: 'object',
  },
});

const suiteProvenanceDef = () => ({
  suiteProvenance: {
    additionalProperties: false,
    description: 'Provenance of the suite declaration.',
    properties: {
      authoredBy: string(NEUTRAL_ID_PATTERN),
      submittedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['authoredBy', 'submittedAt', 'notes'],
    type: 'object',
  },
});

const unknownCauseDef = () => ({
  unknownCause: {
    additionalProperties: false,
    description:
      "The structured WHY of an unknown outcome: a closed reason taxonomy member plus the " +
      'deterministic detail naming the driving stage ids. REQUIRED iff the verdict is unknown; ' +
      'MUST be null otherwise.',
    properties: {
      reason: { enum: UNKNOWN_REASONS },
      detail: string(NEUTRAL_TEXT_PATTERN),
    },
    required: ['reason', 'detail'],
    type: 'object',
  },
});

const stageResultDef = () => ({
  stageResult: {
    additionalProperties: false,
    description:
      'One per-stage result: stage id + closed outcome + closed machine reason + the evidence ' +
      'digest that drove it + the structured unknown cause (required iff the stage outcome is ' +
      'unknown).',
    properties: {
      stageId: string(CERTIFICATION_ID_PATTERN),
      outcome: { enum: VERDICTS },
      reason: { enum: STAGE_REASONS },
      evidenceDigest: nullable(digest()),
      unknownCause: nullable({ $ref: '#/$defs/unknownCause' }),
    },
    required: ['stageId', 'outcome', 'reason', 'evidenceDigest', 'unknownCause'],
    type: 'object',
  },
});

const recordProvenanceDef = () => ({
  recordProvenance: {
    additionalProperties: false,
    description: 'Provenance of one certification run.',
    properties: {
      executedBy: string(NEUTRAL_ID_PATTERN),
      recordedAt: string(TIMESTAMP_PATTERN),
      notes: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: ['executedBy', 'recordedAt', 'notes'],
    type: 'object',
  },
});

const statementDef = () => ({
  statement: {
    additionalProperties: false,
    description:
      'The DERIVED scoped certification statement (the design law): all five scope components ' +
      '(body, substrate, environment, runtime, suite) + the suite revision (the suite digest) + ' +
      'the verdict qualifier + the granted level + the declared constraints + the mandated ' +
      'professional-limitations notice. Never caller-supplied; an unscoped statement is ' +
      'unrepresentable.',
    properties: {
      statementVersion: { const: 1 },
      scope: { $ref: '#/$defs/statementScope' },
      suiteRevision: digest(),
      verdictQualifier: { enum: VERDICT_QUALIFIERS },
      grantedLevel: nullable({ enum: LEVELS }),
      constraints: { type: 'array', items: string(NEUTRAL_TEXT_PATTERN) },
      limitations: string(NEUTRAL_TEXT_PATTERN),
      text: { type: 'string', minLength: 1 },
    },
    required: [
      'statementVersion',
      'scope',
      'suiteRevision',
      'verdictQualifier',
      'grantedLevel',
      'constraints',
      'limitations',
      'text',
    ],
    type: 'object',
  },
  statementScope: {
    additionalProperties: false,
    description:
      'The B/V/M/E/R/S scope components of the statement — every component required.',
    properties: {
      body: { type: 'string', minLength: 1 },
      bodyVersion: { type: 'string', minLength: 1 },
      substrate: { type: 'string', minLength: 1 },
      substrateVersion: { type: 'string', minLength: 1 },
      environment: { type: 'string', minLength: 1 },
      environmentVersion: { type: 'string', minLength: 1 },
      runtime: { type: 'string', minLength: 1 },
      runtimeVersion: { type: 'string', minLength: 1 },
      suite: { type: 'string', minLength: 1 },
      suiteVersion: { type: 'string', minLength: 1 },
    },
    required: [
      'body',
      'bodyVersion',
      'substrate',
      'substrateVersion',
      'environment',
      'environmentVersion',
      'runtime',
      'runtimeVersion',
      'suite',
      'suiteVersion',
    ],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A023 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'certification-protocol/certification-suite',
    output: 'contracts/certification/certification-suite.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-suite'),
        title: 'Arena CertificationSuite v1',
        description:
          'The content-addressed, versioned declaration of a certification suite: the ORDERED ' +
          'stage composition pinning the exact A012 evaluator+criteria digests, A013 verifier ' +
          'digests, A022 compatibility requirements, A014 dataset refs and environment/runtime ' +
          'composition requirements; the grant level (DEVELOPMENT | CANDIDATE | CERTIFIED — a ' +
          'suite declaring constraints grants CONDITIONAL), the professional-limitations notice, ' +
          'the supersedes lineage and provenance. Same suite ⇒ same digest; any change ⇒ a new ' +
          'version. The suite digest is the "revision X" of the certification statement.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'suiteId',
          'version',
          'levelGrant',
          'stages',
          'constraints',
          'limitations',
          'supersedes',
          'inputSchema',
          'outputSchema',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the suite shape.' },
          suiteId: string(CERTIFICATION_ID_PATTERN),
          version: string(CERTIFICATION_VERSION_PATTERN),
          levelGrant: { enum: GRANT_LEVELS },
          stages: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/suiteStage' },
            description: 'The stage composition; stage ids unique within it.',
          },
          constraints: {
            type: 'array',
            items: string(NEUTRAL_TEXT_PATTERN),
            description: 'Declared constraints — a satisfied run grants CONDITIONAL instead of levelGrant.',
          },
          limitations: nullable(string(NEUTRAL_TEXT_PATTERN)),
          supersedes: nullable(digest()),
          inputSchema: { $ref: '#/$defs/schemaRef' },
          outputSchema: { $ref: '#/$defs/schemaRef' },
          provenance: { $ref: '#/$defs/suiteProvenance' },
          digest: digest(),
        },
        $defs: {
          ...schemaRefDef(),
          ...artifactPinDef(),
          ...idVersionRequirementDefs(),
          ...suiteStageDef(),
          ...suiteProvenanceDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-record',
    output: 'contracts/certification/certification-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-record'),
        title: 'Arena CertificationRecord v1',
        description:
          'The append-once record of one certification run (kind certification-run) or one ' +
          'revocation (kind revocation). Run records bind the composition under test, the suite ' +
          'digest, one closed-vocabulary stage result per declared stage, the DERIVED verdict ' +
          '(satisfied | not-satisfied | unknown — never a score), the DERIVED structured unknown ' +
          'cause (required iff unknown), the DERIVED granted level (a failed or indeterminate ' +
          'run grants NOTHING), the DERIVED scoped statement (the design law) and the COMPUTED ' +
          'input digest (the R22 reproducibility anchor). Revocation records bind the revoked ' +
          'record digest + grounds. Frozen on creation; identical inputs ⇒ identical digest.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'kind',
          'subject',
          'suiteRef',
          'stages',
          'verdict',
          'unknownCause',
          'grantedLevel',
          'statement',
          'inputDigest',
          'supersedes',
          'revokes',
          'grounds',
          'correlationId',
          'idempotencyKey',
          'tenantId',
          'workspaceId',
          'startedAt',
          'finishedAt',
          'provenance',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the record shape.' },
          kind: { enum: RECORD_KINDS },
          subject: nullable({ $ref: '#/$defs/subject' }),
          suiteRef: nullable(digest()),
          stages: {
            type: 'array',
            items: { $ref: '#/$defs/stageResult' },
            description: 'One result per declared suite stage, in suite order (empty on revocations).',
          },
          verdict: nullable({ enum: VERDICTS }),
          unknownCause: nullable({ $ref: '#/$defs/unknownCause' }),
          grantedLevel: nullable({ enum: LEVELS }),
          statement: nullable({ $ref: '#/$defs/statement' }),
          inputDigest: nullable(digest()),
          supersedes: nullable(digest()),
          revokes: nullable(digest()),
          grounds: nullable(string(NEUTRAL_TEXT_PATTERN)),
          correlationId: string(CORRELATION_PATTERN),
          idempotencyKey: string(CORRELATION_PATTERN),
          tenantId: nullable(string(TENANT_ID_PATTERN)),
          workspaceId: nullable(string(WORKSPACE_ID_PATTERN)),
          startedAt: string(TIMESTAMP_PATTERN),
          finishedAt: string(TIMESTAMP_PATTERN),
          provenance: { $ref: '#/$defs/recordProvenance' },
          digest: digest(),
        },
        $defs: {
          ...subjectDef(),
          ...bodyVersionRefDef(),
          ...substrateRefDef(),
          ...environmentProfileDef(),
          ...runtimeProfileDef(),
          ...unknownCauseDef(),
          ...stageResultDef(),
          ...recordProvenanceDef(),
          ...statementDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-statement',
    output: 'contracts/certification/certification-statement.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-statement'),
        title: 'Arena CertificationStatement v1',
        description:
          'The design law, as a schema: "Agent Body B, version V, possessed by Cognitive ' +
          'Substrate M, under Environment E and Runtime Profile R, satisfied Certification ' +
          'Suite S at revision X." All five scope components are required; the limitations ' +
          'notice is mandatory (architecture-lock rule 23); Arena never certifies that M alone ' +
          'is a professional (requirement R46).',
        allOf: [{ $ref: '#/$defs/statement' }],
        $defs: { ...statementDef() },
      };
    },
  },
  {
    id: 'certification-protocol/certification-outcome',
    output: 'contracts/certification/certification-outcome.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-outcome'),
        title: 'Arena certification-outcome v1',
        description:
          'The verdict discipline: the closed suite-verdict vocabulary (satisfied | ' +
          'not-satisfied | unknown — never a score), the closed unknown-cause reason taxonomy ' +
          'and the closed per-stage machine reasons. Derivation is pure: any failed stage ⇒ ' +
          'not-satisfied; else any unknown stage ⇒ unknown (fail-closed); else satisfied.',
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'unknownCause', 'reasons'],
        properties: {
          verdict: { enum: VERDICTS },
          unknownCause: nullable({ $ref: '#/$defs/unknownCause' }),
          reasons: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
        $defs: { ...unknownCauseDef() },
      };
    },
  },
  {
    id: 'certification-protocol/certification-level',
    output: 'contracts/certification/certification-level.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-level'),
        title: 'Arena certification-level v1',
        description:
          'The quality-model certification levels — lifecycle states of a SCOPED claim, never ' +
          'universal professional ratings. The grant vocabulary is DEVELOPMENT | CANDIDATE | ' +
          'CERTIFIED; CONDITIONAL is derived from declared constraints; REVOKED is never granted ' +
          'by a run (it is the effective state of a prior claim after an append-only revocation).',
        type: 'object',
        additionalProperties: false,
        required: ['level', 'grantable'],
        properties: {
          level: { enum: LEVELS },
          grantable: {
            type: 'boolean',
            description: 'True for DEVELOPMENT | CANDIDATE | CERTIFIED (the grant vocabulary).',
          },
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-error',
    output: 'contracts/certification/certification-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-error'),
        title: 'Arena CertificationError v1',
        description:
          'Wire-safe structured form of a CertificationError: closed CERTIFICATION_* code set, ' +
          'core category mapping, strictly validating parse (unknown codes rejected).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: CERTIFICATION_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string(CORRELATION_PATTERN),
        },
      };
    },
  },
  {
    id: 'certification-protocol/run-certification-command',
    output: 'contracts/certification/run-certification-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('run-certification-command'),
        title: 'Arena run-certification-command v1',
        description:
          'Command envelope payload: run one certification. Carries the digest ref of the ' +
          'certification suite, the composition under test (all five scope components) and the ' +
          'evidence digest refs the run may consume; the fabric resolves the suite, evaluates ' +
          'every stage, derives the verdict / level / scoped statement and emits ' +
          'certification-recorded-event. Commands carry a REQUIRED non-null idempotency key ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['suiteRef', 'subject', 'evidenceRefs'],
        properties: {
          suiteRef: digest(),
          subject: { $ref: '#/$defs/subject' },
          evidenceRefs: {
            type: 'array',
            items: digest(),
            description: 'Digests of the sibling-protocol evidence records the run may consume.',
          },
        },
        $defs: {
          ...subjectDef(),
          ...bodyVersionRefDef(),
          ...substrateRefDef(),
          ...environmentProfileDef(),
          ...runtimeProfileDef(),
        },
      };
    },
  },
  {
    id: 'certification-protocol/certification-recorded-event',
    output: 'contracts/certification/certification-recorded-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('certification-recorded-event'),
        title: 'Arena certification-recorded-event v1',
        description:
          "Event envelope payload: the fabric's authoritative result — the frozen, " +
          'content-addressed CertificationRecord. The event carries the run command idempotency ' +
          'key when provided so event-stream replays are idempotency-addressable.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/certification/certification-record@${CERTIFICATION_SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'certification-protocol/schema-registry',
    output: 'contracts/certification/certification-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena certification-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/certification. A SchemaRef matching this enum ' +
          'is a known certification-protocol schema at the listed version; anything else is not.',
        type: 'string',
        enum: CERTIFICATION_SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-certification-contracts-${process.pid}-${Date.now()}`);
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

    // Extra-file check is scoped to the committed contract directory (never
    // the whole tree), so running --check against the repository root is safe.
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
      console.error('[contracts] run: node scripts/generate-contracts.mjs   then commit the result');
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
  console.log('[contracts] regenerate committed with: git add <contract files>');
}

main();
