#!/usr/bin/env node
/**
 * Arena expert-registry contract generator (Work Order A006).
 *
 * Follows the A001/A002/A004/A005 generated-contracts convention
 * (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A006
 *     surfaces ONLY — it emits every schema for @arena/expert-registry
 *     into contracts/expert/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this check
 *     as part of `pnpm test`, the package script `contracts:check` runs it
 *     directly, and the repo-wide governance G9 entry point runs every
 *     package-level generator (packages/<pkg>/scripts/generate-contracts.mjs)
 *     with --check, so this generator is wired into governance without any
 *     root file edit.
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
// Shared protocol constants — MUST match the TypeScript surface
// (packages/expert-registry/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';

// expert-registry constants (packages/expert-registry/src)
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const EXPERT_ID_PATTERN = '^expert-[a-z0-9][a-z0-9-]{0,61}$';
const EXPERT_VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
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
const COMPETENCY_NODE_KINDS = ['capability', 'sub-capability', 'skill', 'expert-competency'];
const NODE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const NEUTRAL_LOCATOR_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';
const IDENTITY_REF_KINDS = ['identity-attestation', 'contact-attestation', 'external-identifier'];
const CREDENTIAL_KINDS = [
  'professional-license',
  'certification',
  'degree',
  'training-certificate',
  'credential-attestation',
  'external-credential',
];
const QUALIFICATION_STATUSES = [
  'claimed',
  'attested',
  'verified',
  'expired',
  'revoked',
  'disputed',
];
const PROFICIENCY_LEVELS = [
  'introductory',
  'working',
  'proficient',
  'advanced',
  'distinguished',
];
const DOMAIN_METADATA_VALUE_TYPES = ['string', 'number', 'boolean'];
const DOMAIN_TYPE_PATTERN = '^[a-z][a-z0-9-]{0,63}(\\.[a-z][a-z0-9-]{0,63})*$';
const TASK_RECORD_TYPES = ['task-spec', 'task-assignment', 'task-outcome', 'trajectory'];
const TASK_RECORD_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const RELIABILITY_EVENT_KINDS = ['task-completed', 'task-failed', 'no-response'];
const AVAILABILITY_RECURRENCES = ['daily', 'weekly', 'one-time'];
const TIME_OF_DAY_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
const CALENDAR_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const COUNTRY_CODE_PATTERN = '^[A-Z]{2}$';
const REGION_CODE_PATTERN = '^[A-Z0-9]{1,3}$';
const LIMITATION_CLASSES = [
  'safety',
  'privacy',
  'licensing',
  'professional-scope',
  'jurisdictional',
  'capacity',
];
const EXPERT_STATUSES = ['draft', 'published', 'suspended', 'retired'];
const EXPERT_LIFECYCLE_EVENT_KINDS = [
  'profile-created',
  'profile-published',
  'profile-suspended',
  'profile-reinstated',
  'profile-retired',
  'profile-superseded',
  'evidence-attached',
  'task-recorded',
  'reliability-recorded',
];
const PUBLIC_VIEW_FIELD_GROUPS = [
  'identityRefs',
  'competencies',
  'qualifications',
  'evidence',
  'taskHistory',
  'reliability',
  'availability',
  'domainScope',
];
const FIELD_VISIBILITIES = ['public', 'tenant-internal'];
const DOMAIN_PACK_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const EXPERT_ERROR_CODES = [
  'EXPERT_AUTHORITY_FIELD_REJECTED',
  'EXPERT_CROSS_TENANT_ACCESS',
  'EXPERT_DUPLICATE_EVIDENCE',
  'EXPERT_EVIDENCE_REMOVAL',
  'EXPERT_EXPERT_NOT_FOUND',
  'EXPERT_IDENTITY_CONFLICT',
  'EXPERT_INVALID_AVAILABILITY',
  'EXPERT_INVALID_COMPETENCY',
  'EXPERT_INVALID_CREDENTIAL_REF',
  'EXPERT_INVALID_DIGEST',
  'EXPERT_INVALID_DOMAIN_METADATA',
  'EXPERT_INVALID_DOMAIN_PACK',
  'EXPERT_INVALID_DOMAIN_SCOPE',
  'EXPERT_INVALID_EVIDENCE',
  'EXPERT_INVALID_IDENTITY',
  'EXPERT_INVALID_IDENTITY_REF',
  'EXPERT_INVALID_JURISDICTION',
  'EXPERT_INVALID_LIFECYCLE',
  'EXPERT_INVALID_LIMITATION',
  'EXPERT_INVALID_PRINCIPAL',
  'EXPERT_INVALID_PRIVACY_POLICY',
  'EXPERT_INVALID_PROFILE',
  'EXPERT_INVALID_PUBLIC_VIEW',
  'EXPERT_INVALID_QUALIFICATION',
  'EXPERT_INVALID_RELIABILITY',
  'EXPERT_INVALID_REF',
  'EXPERT_INVALID_STATUS',
  'EXPERT_INVALID_SUPERSESSION',
  'EXPERT_INVALID_TASK_HISTORY',
  'EXPERT_INVALID_TIMESTAMP',
  'EXPERT_INVALID_TRANSITION',
  'EXPERT_INVALID_VERSION',
  'EXPERT_PII_FIELD_REJECTED',
  'EXPERT_RELIABILITY_MUTATION',
  'EXPERT_TAMPERED',
  'EXPERT_TASK_HISTORY_REMOVAL',
  'EXPERT_TERMINAL_STATE',
  'EXPERT_UNKNOWN_DOMAIN_COMPETENCY_TYPE',
  'EXPERT_UNKNOWN_ERROR',
  'EXPERT_UNSUPPORTED_RECORD_VERSION',
];
const ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'access',
  'unknown',
];
const IDENTITY_REF_VERSION = 1;
const COMPETENCY_VERSION = 1;
const QUALIFICATION_VERSION = 1;
const JURISDICTION_VERSION = 1;
const LIMITATION_VERSION = 1;
const DOMAIN_SCOPE_VERSION = 1;
const TASK_RECORD_REF_VERSION = 1;
const RELIABILITY_ENTRY_VERSION = 1;
const RELIABILITY_METRICS_VERSION = 1;
const EXPERT_AVAILABILITY_VERSION = 1;
const AVAILABILITY_WINDOW_VERSION = 1;
const EXPERT_PRIVACY_POLICY_VERSION = 1;
const EXPERT_DOMAIN_PACK_VERSION = 1;
const EXPERT_PUBLIC_VIEW_VERSION = 1;
const EXPERT_PROFILE_RECORD_VERSION = 1;
const EXPERT_LIFECYCLE_EVENT_VERSION = 1;
const EXPERT_REGISTRATION_RECORD_VERSION = 1;
const EXPERT_SCHEMA_VERSION = '1.0.0';
const EXPERT_SCHEMA_NAMES = [
  'expert-ref',
  'evidence-ref',
  'principal',
  'identity-ref',
  'credential-ref',
  'competency',
  'qualification',
  'jurisdiction',
  'limitation',
  'domain-scope',
  'task-record-ref',
  'reliability-entry',
  'reliability-metrics',
  'availability',
  'privacy-policy',
  'domain-pack',
  'public-view',
  'profile',
  'lifecycle-event',
  'registration-record',
  'error',
  'register-expert-command',
  'publish-profile-command',
  'suspend-profile-command',
  'reinstate-profile-command',
  'retire-profile-command',
  'supersede-profile-command',
  'attach-evidence-command',
  'record-task-command',
  'record-reliability-command',
  'expert-registered-event',
  'profile-published-event',
  'profile-suspended-event',
  'profile-reinstated-event',
  'profile-retired-event',
  'profile-superseded-event',
  'evidence-attached-event',
  'task-recorded-event',
  'reliability-recorded-event',
  'domain-pack-published-event',
  'schema-registry',
];

const eref = (name) => `arena:schema/expert/${name}@${EXPERT_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001/A002/A004/A005 contracts).

const expertIdentityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'expertId'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    expertId: { type: 'string', pattern: EXPERT_ID_PATTERN },
  },
};

const expertRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['tenant', 'expertId', 'version', 'digest'],
  properties: {
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    expertId: { type: 'string', pattern: EXPERT_ID_PATTERN },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
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
    id: { type: 'string', pattern: NODE_ID_PATTERN },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const competencyDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'competencyVersion',
    'capability',
    'proficiency',
    'proficiencyEvidence',
  ],
  properties: {
    competencyVersion: { const: COMPETENCY_VERSION },
    capability: {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'id', 'version', 'digest'],
      properties: {
        kind: { enum: COMPETENCY_NODE_KINDS },
        id: { type: 'string', pattern: NODE_ID_PATTERN },
        version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
        digest: { type: 'string', pattern: DIGEST_PATTERN },
      },
    },
    proficiency: { enum: PROFICIENCY_LEVELS },
    proficiencyEvidence: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/evidenceRef' },
    },
    domainType: { type: 'string', pattern: DOMAIN_TYPE_PATTERN },
    domainMetadata: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }],
      },
    },
  },
};

const identityRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['refVersion', 'kind', 'digest'],
  properties: {
    refVersion: { const: IDENTITY_REF_VERSION },
    kind: { enum: IDENTITY_REF_KINDS },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
    locator: { type: 'string', pattern: NEUTRAL_LOCATOR_PATTERN },
    note: { type: 'string', minLength: 1 },
  },
};

const credentialRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'reference'],
  properties: {
    kind: { enum: CREDENTIAL_KINDS },
    reference: { type: 'string', pattern: NEUTRAL_LOCATOR_PATTERN },
    issuer: { type: 'string', minLength: 1, maxLength: 255 },
  },
};

const jurisdictionDef = {
  type: 'object',
  additionalProperties: false,
  required: ['jurisdictionVersion', 'country'],
  properties: {
    jurisdictionVersion: { const: JURISDICTION_VERSION },
    country: { type: 'string', pattern: COUNTRY_CODE_PATTERN },
    region: { type: 'string', pattern: REGION_CODE_PATTERN },
  },
};

const limitationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['limitationVersion', 'class', 'statement'],
  properties: {
    limitationVersion: { const: LIMITATION_VERSION },
    class: { enum: LIMITATION_CLASSES },
    statement: { type: 'string', minLength: 1, maxLength: 2000 },
    jurisdiction: { $ref: '#/$defs/jurisdiction' },
    appliesUntil: { type: 'string', pattern: TIMESTAMP_PATTERN },
  },
};

const domainScopeDef = {
  type: 'object',
  additionalProperties: false,
  required: ['scopeVersion', 'domains', 'jurisdictions', 'limitations'],
  properties: {
    scopeVersion: { const: DOMAIN_SCOPE_VERSION },
    domains: {
      type: 'array',
      minItems: 1,
      items: {
        allOf: [
          { $ref: '#/$defs/capabilityNodeRef' },
          {
            type: 'object',
            properties: { kind: { const: 'domain' } },
          },
        ],
      },
    },
    jurisdictions: { type: 'array', items: { $ref: '#/$defs/jurisdiction' } },
    limitations: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/limitation' },
    },
  },
};

const taskRecordRefDef = {
  type: 'object',
  additionalProperties: false,
  required: ['refVersion', 'kind', 'tenant', 'taskId', 'version', 'digest', 'occurredAt'],
  properties: {
    refVersion: { const: TASK_RECORD_REF_VERSION },
    kind: { enum: TASK_RECORD_TYPES },
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    taskId: { type: 'string', pattern: TASK_RECORD_ID_PATTERN },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
    occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
  },
};

const reliabilityEntryDef = {
  type: 'object',
  additionalProperties: false,
  required: ['entryVersion', 'sequence', 'kind', 'occurredAt', 'recordedBy'],
  properties: {
    entryVersion: { const: RELIABILITY_ENTRY_VERSION },
    sequence: { type: 'integer', minimum: 1 },
    kind: { enum: RELIABILITY_EVENT_KINDS },
    occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    recordedBy: { $ref: '#/$defs/principal' },
    taskRecord: { $ref: '#/$defs/taskRecordRef' },
    note: { type: 'string', minLength: 1 },
    evidence: { type: 'array', minItems: 1, items: { $ref: '#/$defs/evidenceRef' } },
  },
};

const privacyPolicyDef = {
  type: 'object',
  additionalProperties: false,
  required: ['policyVersion', 'visibility'],
  properties: {
    policyVersion: { const: EXPERT_PRIVACY_POLICY_VERSION },
    visibility: {
      type: 'object',
      additionalProperties: false,
      required: [...PUBLIC_VIEW_FIELD_GROUPS],
      properties: Object.fromEntries(
        PUBLIC_VIEW_FIELD_GROUPS.map((group) => [group, { enum: FIELD_VISIBILITIES }]),
      ),
    },
  },
};

const availabilityWindowDef = {
  type: 'object',
  additionalProperties: false,
  required: ['windowVersion', 'recurrence', 'startUtc', 'endUtc'],
  properties: {
    windowVersion: { const: AVAILABILITY_WINDOW_VERSION },
    recurrence: { enum: AVAILABILITY_RECURRENCES },
    dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
    startUtc: { type: 'string', pattern: TIME_OF_DAY_PATTERN },
    endUtc: { type: 'string', pattern: TIME_OF_DAY_PATTERN },
    date: { type: 'string', pattern: CALENDAR_DATE_PATTERN },
    note: { type: 'string', minLength: 1 },
  },
};

const availabilityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['availabilityVersion', 'windows'],
  properties: {
    availabilityVersion: { const: EXPERT_AVAILABILITY_VERSION },
    windows: { type: 'array', minItems: 1, items: { $ref: '#/$defs/availabilityWindow' } },
    note: { type: 'string', minLength: 1 },
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
    eventVersion: { const: EXPERT_LIFECYCLE_EVENT_VERSION },
    sequence: { type: 'integer', minimum: 1 },
    kind: { enum: EXPERT_LIFECYCLE_EVENT_KINDS },
    occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    actor: { $ref: '#/$defs/principal' },
    fromStatus: { enum: EXPERT_STATUSES },
    toStatus: { enum: EXPERT_STATUSES },
    note: { type: 'string', minLength: 1 },
    evidenceAppended: { type: 'array', items: { $ref: '#/$defs/evidenceRef' } },
    taskRecordAppended: { type: 'array', items: { $ref: '#/$defs/taskRecordRef' } },
    reliabilityAppended: { type: 'array', items: { $ref: '#/$defs/reliabilityEntry' } },
    supersededBy: { $ref: '#/$defs/expertRef' },
  },
};

const qualificationDef = {
  type: 'object',
  additionalProperties: false,
  required: ['qualificationVersion', 'credential', 'evidence', 'status'],
  properties: {
    qualificationVersion: { const: QUALIFICATION_VERSION },
    credential: { $ref: '#/$defs/credentialRef' },
    evidence: { type: 'array', minItems: 1, items: { type: 'string', pattern: DIGEST_PATTERN } },
    status: { enum: QUALIFICATION_STATUSES },
    validFrom: { type: 'string', pattern: TIMESTAMP_PATTERN },
    validUntil: { type: 'string', pattern: TIMESTAMP_PATTERN },
    jurisdiction: { $ref: '#/$defs/jurisdiction' },
    note: { type: 'string', minLength: 1 },
  },
};

const profileDefs = {
  expertIdentity: expertIdentityDef,
  expertRef: expertRefDef,
  principal: principalDef,
  evidenceRef: evidenceRefDef,
  capabilityNodeRef: capabilityNodeRefDef,
  competency: competencyDef,
  identityRef: identityRefDef,
  qualification: qualificationDef,
  taskRecordRef: taskRecordRefDef,
  reliabilityEntry: reliabilityEntryDef,
  availability: availabilityDef,
  domainScope: domainScopeDef,
  privacyPolicy: privacyPolicyDef,
  lifecycleEvent: lifecycleEventDef,
};

const profileDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'recordVersion',
    'identity',
    'identityRefs',
    'version',
    'status',
    'competencies',
    'qualifications',
    'evidence',
    'taskHistory',
    'reliability',
    'availability',
    'domainScope',
    'privacyPolicy',
    'lifecycle',
    'declaredAt',
    'digest',
  ],
  properties: {
    recordVersion: { const: EXPERT_PROFILE_RECORD_VERSION },
    identity: { $ref: '#/$defs/expertIdentity' },
    identityRefs: { type: 'array', items: { $ref: '#/$defs/identityRef' } },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
    status: { enum: EXPERT_STATUSES },
    competencies: { type: 'array', minItems: 1, items: { $ref: '#/$defs/competency' } },
    qualifications: { type: 'array', items: { $ref: '#/$defs/qualification' } },
    evidence: { type: 'array', minItems: 1, items: { $ref: '#/$defs/evidenceRef' } },
    taskHistory: { type: 'array', items: { $ref: '#/$defs/taskRecordRef' } },
    reliability: { type: 'array', items: { $ref: '#/$defs/reliabilityEntry' } },
    availability: { $ref: '#/$defs/availability' },
    domainScope: { $ref: '#/$defs/domainScope' },
    privacyPolicy: { $ref: '#/$defs/privacyPolicy' },
    lifecycle: { type: 'array', minItems: 1, items: { $ref: '#/$defs/lifecycleEvent' } },
    supersedes: { $ref: '#/$defs/expertRef' },
    supersededBy: { $ref: '#/$defs/expertRef' },
    declaredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const publicViewDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'viewVersion',
    'tenant',
    'expertId',
    'version',
    'status',
    'sourceDigest',
    'derivedAt',
  ],
  properties: {
    viewVersion: { const: EXPERT_PUBLIC_VIEW_VERSION },
    tenant: { type: 'string', pattern: TENANT_PATTERN },
    expertId: { type: 'string', pattern: EXPERT_ID_PATTERN },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
    status: { enum: EXPERT_STATUSES },
    sourceDigest: { type: 'string', pattern: DIGEST_PATTERN },
    identityRefs: { type: 'array', items: { $ref: '#/$defs/identityRef' } },
    competencies: { type: 'array', items: { $ref: '#/$defs/competency' } },
    qualifications: { type: 'array', items: { $ref: '#/$defs/qualification' } },
    availability: { $ref: '#/$defs/availability' },
    domainScope: { $ref: '#/$defs/domainScope' },
    derivedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
  },
};

const domainPackDef = {
  type: 'object',
  additionalProperties: false,
  required: [
    'packVersion',
    'id',
    'version',
    'description',
    'competencyTypes',
    'metadataFields',
    'digest',
  ],
  properties: {
    packVersion: { const: EXPERT_DOMAIN_PACK_VERSION },
    id: { type: 'string', pattern: DOMAIN_PACK_ID_PATTERN },
    version: { type: 'string', pattern: EXPERT_VERSION_PATTERN },
    description: { type: 'string', minLength: 1 },
    competencyTypes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'description'],
        properties: {
          type: { type: 'string', pattern: DOMAIN_TYPE_PATTERN },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
    metadataFields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'valueType', 'required', 'description'],
        properties: {
          field: { type: 'string', minLength: 1 },
          valueType: { enum: DOMAIN_METADATA_VALUE_TYPES },
          required: { type: 'boolean' },
          description: { type: 'string', minLength: 1 },
        },
      },
    },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
};

const transitionCommandDef = (title, description, extraProperties, extraRequired) => ({
  $schema: DRAFT,
  $id: eref(title),
  title: `Arena ${title} command payload v1`,
  description,
  type: 'object',
  additionalProperties: false,
  required: ['currentStateDigest', 'at', 'actor', ...(extraRequired ?? [])],
  properties: {
    currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
    at: { type: 'string', pattern: TIMESTAMP_PATTERN },
    actor: { $ref: '#/$defs/principal' },
    note: { type: 'string', minLength: 1 },
    ...(extraProperties ?? {}),
  },
  $defs: { principal: principalDef },
});

const profileTransitionedEventDef = (title, description) => ({
  $schema: DRAFT,
  $id: eref(title),
  title: `Arena ${title} event payload v1`,
  description,
  type: 'object',
  additionalProperties: false,
  required: ['profile', 'event'],
  properties: {
    profile: { $ref: '#/$defs/profile' },
    event: { $ref: '#/$defs/lifecycleEvent' },
  },
  $defs: profileDefs,
});

// ---------------------------------------------------------------------------
// Contract manifest — every schema owned by @arena/expert-registry.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'expert/expert-ref',
    output: 'contracts/expert/expert-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('expert-ref'),
        title: 'Arena expert version ref v1',
        description:
          'A content-addressed reference to one exact expert-profile state: identity + ' +
          'version + the sha256 digest of that state canonical content.',
        ...expertRefDef,
      };
    },
  },
  {
    id: 'expert/evidence-ref',
    output: 'contracts/expert/evidence-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('evidence-ref'),
        title: 'Arena evidence ref v1',
        description:
          'A digest-addressed evidence reference. Evidence is append-only (architecture-lock rule 6).',
        ...evidenceRefDef,
      };
    },
  },
  {
    id: 'expert/principal',
    output: 'contracts/expert/principal.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('principal'),
        title: 'Arena principal ref v1',
        description:
          'The tenant-scoped actor (artifact-protocol convention; never a raw provider identity — lock rule 10).',
        ...principalDef,
      };
    },
  },
  {
    id: 'expert/identity-ref',
    output: 'contracts/expert/identity-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('identity-ref'),
        title: 'Arena declared identity ref v1',
        description:
          'A declared identity reference: digest-addressed attestation plus optional neutral ' +
          'locator. Personal data NEVER appears inline on a profile (PII minimization, §8 identity); ' +
          'the locator charset excludes email/phone shapes by construction.',
        ...identityRefDef,
      };
    },
  },
  {
    id: 'expert/credential-ref',
    output: 'contracts/expert/credential-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('credential-ref'),
        title: 'Arena credential ref v1',
        description:
          'A professional credential reference (kind, opaque neutral reference, optional issuing ' +
          'body). Qualification DATA — never an authorization grant (lock rule 9).',
        ...credentialRefDef,
      };
    },
  },
  {
    id: 'expert/competency',
    output: 'contracts/expert/competency.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('competency'),
        title: 'Arena expert competency v1',
        description:
          'One expert competency: a capability/skill node ref, a typed proficiency level, ' +
          '>= 1 digest-addressed proficiency evidence refs (R7), and optional pack-declared ' +
          'domain extension data (R37).',
        ...competencyDef,
        $defs: { evidenceRef: evidenceRefDef, capabilityNodeRef: capabilityNodeRefDef },
      };
    },
  },
  {
    id: 'expert/qualification',
    output: 'contracts/expert/qualification.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('qualification'),
        title: 'Arena expert qualification v1',
        description:
          'One typed qualification record: credential ref, evidence digests, closed status ' +
          'vocabulary (statuses are DATA about evidence, never authorization — lock rule 9).',
        ...qualificationDef,
        $defs: { credentialRef: credentialRefDef, jurisdiction: jurisdictionDef },
      };
    },
  },
  {
    id: 'expert/jurisdiction',
    output: 'contracts/expert/jurisdiction.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('jurisdiction'),
        title: 'Arena jurisdiction v1',
        description:
          'A typed ISO 3166 jurisdiction (country + optional subdivision). Professional-scope ' +
          'metadata, not personal location data (§8 domain/jurisdiction).',
        ...jurisdictionDef,
      };
    },
  },
  {
    id: 'expert/limitation',
    output: 'contracts/expert/limitation.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('limitation'),
        title: 'Arena professional limitation v1',
        description:
          'One explicit professional limitation over the closed class vocabulary (safety, privacy, ' +
          'licensing, professional-scope, jurisdictional, capacity) — architecture-lock rule 23.',
        ...limitationDef,
        $defs: { jurisdiction: jurisdictionDef },
      };
    },
  },
  {
    id: 'expert/domain-scope',
    output: 'contracts/expert/domain-scope.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('domain-scope'),
        title: 'Arena expert domain scope v1',
        description:
          'The expert domain/jurisdiction scope: >= 1 capability-graph domain node refs, 0+ typed ' +
          'jurisdictions, >= 1 explicit professional limitations (lock rule 23).',
        ...domainScopeDef,
        $defs: {
          capabilityNodeRef: capabilityNodeRefDef,
          jurisdiction: jurisdictionDef,
          limitation: limitationDef,
        },
      };
    },
  },
  {
    id: 'expert/task-record-ref',
    output: 'contracts/expert/task-record-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('task-record-ref'),
        title: 'Arena task record ref v1',
        description:
          'A content-addressed reference to one task-history record (task spec, assignment, ' +
          'outcome or trajectory), scoped to the profile tenant (lock rule 11).',
        ...taskRecordRefDef,
      };
    },
  },
  {
    id: 'expert/reliability-entry',
    output: 'contracts/expert/reliability-entry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('reliability-entry'),
        title: 'Arena reliability ledger entry v1',
        description:
          'One append-only reliability outcome event (task-completed | task-failed | no-response). ' +
          'Sequences are 1-based, strictly increasing, assigned by the ledger itself (lock rule 6; R32).',
        ...reliabilityEntryDef,
        $defs: {
          principal: principalDef,
          taskRecordRef: taskRecordRefDef,
          evidenceRef: evidenceRefDef,
        },
      };
    },
  },
  {
    id: 'expert/reliability-metrics',
    output: 'contracts/expert/reliability-metrics.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('reliability-metrics'),
        title: 'Arena reliability metrics v1',
        description:
          'The DERIVED reliability measurement (R32): completed/failed/no-response counters folded ' +
          'from the append-only ledger. Counters are recomputed from history — never directly ' +
          'mutable, never declarable on a profile (lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: [
          'metricsVersion',
          'tasksCompleted',
          'tasksFailed',
          'noResponse',
          'totalEvents',
        ],
        properties: {
          metricsVersion: { const: RELIABILITY_METRICS_VERSION },
          tasksCompleted: { type: 'integer', minimum: 0 },
          tasksFailed: { type: 'integer', minimum: 0 },
          noResponse: { type: 'integer', minimum: 0 },
          totalEvents: { type: 'integer', minimum: 0 },
          lastEventAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
      };
    },
  },
  {
    id: 'expert/availability',
    output: 'contracts/expert/availability.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('availability'),
        title: 'Arena expert availability v1',
        description:
          'The expert availability record: >= 1 typed windows (daily / weekly with ISO day 1-7 / ' +
          'one-time with an exact calendar date), all times UTC HH:MM.',
        ...availabilityDef,
        $defs: { availabilityWindow: availabilityWindowDef },
      };
    },
  },
  {
    id: 'expert/privacy-policy',
    output: 'contracts/expert/privacy-policy.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('privacy-policy'),
        title: 'Arena expert privacy policy v1',
        description:
          'The explicit per-group privacy marking governing public-view derivation (lock rule 23: ' +
          'privacy is explicit metadata). Every §8 content group must be declared public or tenant-internal.',
        ...privacyPolicyDef,
      };
    },
  },
  {
    id: 'expert/domain-pack',
    output: 'contracts/expert/domain-pack.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('domain-pack'),
        title: 'Arena expert domain pack v1',
        description:
          'A content-addressed domain pack descriptor (R37): ADDS domain competency types and ' +
          'typed metadata fields. Packs can never alter lifecycle semantics or inject authority/PII ' +
          'fields — both are machine-rejected.',
        ...domainPackDef,
      };
    },
  },
  {
    id: 'expert/public-view',
    output: 'contracts/expert/public-view.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('public-view'),
        title: 'Arena expert public view v1',
        description:
          'The DERIVED public view of an expert profile: tenant-internal-marked groups are ABSENT ' +
          '(lock rules 11, 23). Evidence, task history, reliability and the lifecycle log are ' +
          'structurally never public-view material.',
        ...publicViewDef,
        $defs: {
          identityRef: identityRefDef,
          competency: competencyDef,
          qualification: qualificationDef,
          availability: availabilityDef,
          domainScope: domainScopeDef,
          evidenceRef: evidenceRefDef,
          capabilityNodeRef: capabilityNodeRefDef,
          credentialRef: credentialRefDef,
          jurisdiction: jurisdictionDef,
          limitation: limitationDef,
          privacyPolicy: privacyPolicyDef,
          taskRecordRef: taskRecordRefDef,
          reliabilityEntry: reliabilityEntryDef,
          lifecycleEvent: lifecycleEventDef,
          availabilityWindow: availabilityWindowDef,
          principal: principalDef,
          expertRef: expertRefDef,
          expertIdentity: expertIdentityDef,
        },
      };
    },
  },
  {
    id: 'expert/profile',
    output: 'contracts/expert/profile.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('profile'),
        title: 'Arena expert profile v1',
        description:
          'The versioned, content-addressed expert profile carrying every §8 field (identity with ' +
          'PII minimization, competencies, qualifications, evidence, task history, reliability, ' +
          'availability, domain/jurisdiction with explicit limitations) plus the privacy policy. ' +
          'Qualification data only — no authorization grants, no system authority claims (lock rule 9). ' +
          'The digest is sha256 over the canonical digest-free view.',
        ...profileDef,
        $defs: profileDefs,
      };
    },
  },
  {
    id: 'expert/lifecycle-event',
    output: 'contracts/expert/lifecycle-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('lifecycle-event'),
        title: 'Arena expert lifecycle event v1',
        description:
          'One append-only lifecycle event: kind, timestamp, actor, status transition, and the data ' +
          'committed by structured kinds (appended evidence/task records/reliability entries, ' +
          'superseding ref). History is never rewritten (lock rule 6).',
        ...lifecycleEventDef,
        $defs: {
          principal: principalDef,
          evidenceRef: evidenceRefDef,
          taskRecordRef: taskRecordRefDef,
          reliabilityEntry: reliabilityEntryDef,
          expertRef: expertRefDef,
        },
      };
    },
  },
  {
    id: 'expert/registration-record',
    output: 'contracts/expert/registration-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('registration-record'),
        title: 'Arena expert registration record v1',
        description:
          'One append-only registry admission record: sequence, timestamp, recording principal, ' +
          'the admitted profile state and (for supersessions) the superseded state ref.',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'sequence', 'registeredAt', 'registeredBy', 'profile'],
        properties: {
          recordVersion: { const: EXPERT_REGISTRATION_RECORD_VERSION },
          sequence: { type: 'integer', minimum: 1 },
          registeredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          registeredBy: { $ref: '#/$defs/principal' },
          profile: { $ref: '#/$defs/profile' },
          supersedes: { $ref: '#/$defs/expertRef' },
        },
        $defs: profileDefs,
      };
    },
  },
  {
    id: 'expert/error',
    output: 'contracts/expert/expert-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('error'),
        title: 'Arena expert-registry error v1',
        description:
          'Structured, serializable form of the expert-registry error taxonomy. Unknown codes are ' +
          'rejected when parsing. EXPERT_AUTHORITY_FIELD_REJECTED and EXPERT_PII_FIELD_REJECTED are ' +
          'the lock-rule-9 separation-of-concerns screens.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: EXPERT_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: PRINCIPAL_ID_PATTERN },
        },
      };
    },
  },
  {
    id: 'expert/register-expert-command',
    output: 'contracts/expert/register-expert-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('register-expert-command'),
        title: 'Arena register-expert command payload v1',
        description:
          'Command payload admitting a fresh draft expert profile into the registry. Travels ' +
          'inside Envelope<T> with a REQUIRED idempotency key (lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['profile', 'registrar'],
        properties: {
          profile: { $ref: '#/$defs/profile' },
          registrar: { $ref: '#/$defs/principal' },
        },
        $defs: profileDefs,
      };
    },
  },
  {
    id: 'expert/publish-profile-command',
    output: 'contracts/expert/publish-profile-command.v1.json',
    build() {
      return transitionCommandDef(
        'publish-profile-command',
        'Command payload applying the DRAFT → PUBLISHED transition to the state addressed by ' +
          'currentStateDigest.',
      );
    },
  },
  {
    id: 'expert/suspend-profile-command',
    output: 'contracts/expert/suspend-profile-command.v1.json',
    build() {
      return transitionCommandDef(
        'suspend-profile-command',
        'Command payload applying the PUBLISHED → SUSPENDED transition to the state addressed by ' +
          'currentStateDigest.',
      );
    },
  },
  {
    id: 'expert/reinstate-profile-command',
    output: 'contracts/expert/reinstate-profile-command.v1.json',
    build() {
      return transitionCommandDef(
        'reinstate-profile-command',
        'Command payload applying the SUSPENDED → PUBLISHED reinstatement to the state addressed ' +
          'by currentStateDigest.',
      );
    },
  },
  {
    id: 'expert/retire-profile-command',
    output: 'contracts/expert/retire-profile-command.v1.json',
    build() {
      return transitionCommandDef(
        'retire-profile-command',
        'Command payload applying the → RETIRED (terminal) transition; the rationale note is REQUIRED.',
        { note: { type: 'string', minLength: 1 } },
        ['note'],
      );
    },
  },
  {
    id: 'expert/supersede-profile-command',
    output: 'contracts/expert/supersede-profile-command.v1.json',
    build() {
      return {
        ...transitionCommandDef(
          'supersede-profile-command',
          'Command payload marking the addressed state superseded by a new profile version ' +
            '(strictly higher semver, same logical expert).',
        ),
        required: ['currentStateDigest', 'at', 'actor', 'superseding'],
        properties: {
          currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          at: { type: 'string', pattern: TIMESTAMP_PATTERN },
          actor: { $ref: '#/$defs/principal' },
          note: { type: 'string', minLength: 1 },
          superseding: { $ref: '#/$defs/expertRef' },
        },
        $defs: { principal: principalDef, expertRef: expertRefDef },
      };
    },
  },
  {
    id: 'expert/attach-evidence-command',
    output: 'contracts/expert/attach-evidence-command.v1.json',
    build() {
      return {
        ...transitionCommandDef(
          'attach-evidence-command',
          'Command payload appending digest-addressed evidence refs (>= 1) to the addressed state ' +
            '(lock rule 6: evidence is append-only; there is no removal command).',
        ),
        required: ['currentStateDigest', 'at', 'actor', 'evidence'],
        properties: {
          currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          at: { type: 'string', pattern: TIMESTAMP_PATTERN },
          actor: { $ref: '#/$defs/principal' },
          note: { type: 'string', minLength: 1 },
          evidence: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/evidenceRef' },
          },
        },
        $defs: { principal: principalDef, evidenceRef: evidenceRefDef },
      };
    },
  },
  {
    id: 'expert/record-task-command',
    output: 'contracts/expert/record-task-command.v1.json',
    build() {
      return {
        ...transitionCommandDef(
          'record-task-command',
          'Command payload appending task record refs (>= 1) to the addressed state task history ' +
            '(append-only; tenant-scoped).',
        ),
        required: ['currentStateDigest', 'at', 'actor', 'records'],
        properties: {
          currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          at: { type: 'string', pattern: TIMESTAMP_PATTERN },
          actor: { $ref: '#/$defs/principal' },
          note: { type: 'string', minLength: 1 },
          records: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/taskRecordRef' },
          },
        },
        $defs: { principal: principalDef, taskRecordRef: taskRecordRefDef },
      };
    },
  },
  {
    id: 'expert/record-reliability-command',
    output: 'contracts/expert/record-reliability-command.v1.json',
    build() {
      return {
        ...transitionCommandDef(
          'record-reliability-command',
          'Command payload appending one event-sourced reliability outcome entry to the addressed ' +
            'state. The entry is SEQUENCE-LESS: the ledger assigns sequence positions itself (R32, ' +
            'lock rule 6).',
        ),
        required: ['currentStateDigest', 'at', 'actor', 'entry'],
        properties: {
          currentStateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          at: { type: 'string', pattern: TIMESTAMP_PATTERN },
          actor: { $ref: '#/$defs/principal' },
          note: { type: 'string', minLength: 1 },
          entry: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'occurredAt', 'recordedBy'],
            properties: {
              kind: { enum: RELIABILITY_EVENT_KINDS },
              occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
              recordedBy: { $ref: '#/$defs/principal' },
              taskRecord: { $ref: '#/$defs/taskRecordRef' },
              note: { type: 'string', minLength: 1 },
              evidence: {
                type: 'array',
                minItems: 1,
                items: { $ref: '#/$defs/evidenceRef' },
              },
            },
          },
        },
        $defs: {
          principal: principalDef,
          taskRecordRef: taskRecordRefDef,
          evidenceRef: evidenceRefDef,
        },
      };
    },
  },
  {
    id: 'expert/expert-registered-event',
    output: 'contracts/expert/expert-registered-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'expert-registered-event',
        'Event payload emitted when a fresh expert profile is admitted to the registry: the ' +
          'admitted state and its profile-created lifecycle event.',
      );
    },
  },
  {
    id: 'expert/profile-published-event',
    output: 'contracts/expert/profile-published-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'profile-published-event',
        'Event payload emitted when a profile state transitions DRAFT → PUBLISHED.',
      );
    },
  },
  {
    id: 'expert/profile-suspended-event',
    output: 'contracts/expert/profile-suspended-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'profile-suspended-event',
        'Event payload emitted when a profile state transitions PUBLISHED → SUSPENDED.',
      );
    },
  },
  {
    id: 'expert/profile-reinstated-event',
    output: 'contracts/expert/profile-reinstated-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'profile-reinstated-event',
        'Event payload emitted when a profile state transitions SUSPENDED → PUBLISHED.',
      );
    },
  },
  {
    id: 'expert/profile-retired-event',
    output: 'contracts/expert/profile-retired-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'profile-retired-event',
        'Event payload emitted when a profile state transitions to RETIRED (terminal).',
      );
    },
  },
  {
    id: 'expert/profile-superseded-event',
    output: 'contracts/expert/profile-superseded-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'profile-superseded-event',
        'Event payload emitted when a profile version is marked superseded by a new version; the ' +
          'superseded version stays immutable and addressable.',
      );
    },
  },
  {
    id: 'expert/evidence-attached-event',
    output: 'contracts/expert/evidence-attached-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'evidence-attached-event',
        'Event payload emitted when evidence is appended to a profile state.',
      );
    },
  },
  {
    id: 'expert/task-recorded-event',
    output: 'contracts/expert/task-recorded-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'task-recorded-event',
        'Event payload emitted when task record refs are appended to a profile state task history.',
      );
    },
  },
  {
    id: 'expert/reliability-recorded-event',
    output: 'contracts/expert/reliability-recorded-event.v1.json',
    build() {
      return profileTransitionedEventDef(
        'reliability-recorded-event',
        'Event payload emitted when an event-sourced reliability outcome entry is appended to a ' +
          'profile state ledger.',
      );
    },
  },
  {
    id: 'expert/domain-pack-published-event',
    output: 'contracts/expert/domain-pack-published-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('domain-pack-published-event'),
        title: 'Arena domain-pack-published event payload v1',
        description:
          'Event payload emitted when a domain pack descriptor is published: the content-addressed ' +
          'pack and the publishing principal.',
        type: 'object',
        additionalProperties: false,
        required: ['pack', 'publishedBy'],
        properties: {
          pack: { $ref: '#/$defs/domainPack' },
          publishedBy: { $ref: '#/$defs/principal' },
        },
        $defs: { domainPack: domainPackDef, principal: principalDef },
      };
    },
  },
  {
    id: 'expert/schema-registry',
    output: 'contracts/expert/expert-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: eref('schema-registry'),
        title: 'Arena expert schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/expert-registry. A SchemaRef matching this enum ' +
          'is a known expert schema at the listed version; anything else is not.',
        type: 'string',
        enum: EXPERT_SCHEMA_NAMES.map((name) => eref(name)),
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
    `arena-expert-contracts-${process.pid}-${Date.now()}`,
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
    // (contracts/expert) — never the whole tree, so running --check against
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
        '[contracts] run: node packages/expert-registry/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/expert');
}

main();
