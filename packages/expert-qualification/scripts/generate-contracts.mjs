#!/usr/bin/env node
/**
 * Arena expert-qualification-protocol contract generator (Work Order A007).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the package-level convention
 * (packages/expert-registry, packages/evaluation,
 * packages/verification scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A007
 *     surfaces ONLY — it emits every schema for
 *     @arena/expert-qualification into contracts/expert-qualification/ at
 *     the repository root.
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
// (packages/expert-qualification/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const QUALIFICATION_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const NEUTRAL_LOCATOR_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const NEUTRAL_TEXT_PATTERN = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const CAPABILITY_NODE_ID_PATTERN = '^[a-z][a-z0-9-]{0,127}$';
const COUNTRY_PATTERN = '^[A-Z]{2}$';
const REGION_PATTERN = '^[A-Z0-9]{1,3}$';
const TIME_OF_DAY_PATTERN = '^([01]\\d|2[0-3]):[0-5]\\d$';
const CALENDAR_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const CORRELATION_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const EVIDENCE_KINDS = ['credential-ref', 'work-product-ref', 'verification-ref', 'evaluation-ref'];
const VERIFICATION_REF_OUTCOMES = ['pass', 'fail', 'unknown'];
const CREDENTIAL_KINDS = [
  'professional-license',
  'certification',
  'degree',
  'training-certificate',
  'credential-attestation',
  'external-credential',
];
const COMPETENCY_NODE_KINDS = ['capability', 'sub-capability', 'skill', 'expert-competency'];
const PROFICIENCY_LEVELS = ['introductory', 'working', 'proficient', 'advanced', 'distinguished'];
const AVAILABILITY_RECURRENCES = ['daily', 'weekly', 'one-time'];
const QUALIFICATION_STATUSES = ['qualified', 'unqualified', 'stale', 'expired', 'revoked'];
const UNMATCHED_REASONS = [
  'no-competency-claim',
  'qualification-missing',
  'qualification-unqualified',
  'qualification-stale',
  'qualification-expired',
  'qualification-revoked',
  'proficiency-below-threshold',
  'domain-mismatch',
  'jurisdiction-mismatch',
  'availability-conflict',
];

const EXPERT_QUALIFICATION_ERROR_CODES = [
  'EXPERT_QUALIFICATION_DUPLICATE_EVIDENCE',
  'EXPERT_QUALIFICATION_DUPLICATE_REQUIREMENT',
  'EXPERT_QUALIFICATION_IDEMPOTENCY_CONFLICT',
  'EXPERT_QUALIFICATION_IDENTITY_CONFLICT',
  'EXPERT_QUALIFICATION_INVALID_CLAIM',
  'EXPERT_QUALIFICATION_INVALID_DIGEST',
  'EXPERT_QUALIFICATION_INVALID_EVIDENCE',
  'EXPERT_QUALIFICATION_INVALID_EXPERT_CARD',
  'EXPERT_QUALIFICATION_INVALID_IDENTITY',
  'EXPERT_QUALIFICATION_INVALID_MATCHING_POLICY',
  'EXPERT_QUALIFICATION_INVALID_POLICY',
  'EXPERT_QUALIFICATION_INVALID_RECORD',
  'EXPERT_QUALIFICATION_INVALID_REF',
  'EXPERT_QUALIFICATION_INVALID_REQUEST',
  'EXPERT_QUALIFICATION_INVALID_RESULT',
  'EXPERT_QUALIFICATION_INVALID_TIMESTAMP',
  'EXPERT_QUALIFICATION_MISSING_EVIDENCE',
  'EXPERT_QUALIFICATION_NOT_FOUND',
  'EXPERT_QUALIFICATION_SUPERSESSION_CONFLICT',
  'EXPERT_QUALIFICATION_TAMPERED',
  'EXPERT_QUALIFICATION_UNKNOWN_ERROR',
  'EXPERT_QUALIFICATION_UNSUPPORTED_RECORD_VERSION',
  'EXPERT_QUALIFICATION_VERSION_CONFLICT',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const SCHEMA_VERSION = '1.0.0';
const SCHEMA_NAMES = [
  'qualification-evidence',
  'competency-claim',
  'qualification-policy',
  'qualification-record',
  'qualified-expert',
  'match-request',
  'matching-policy',
  'match-result',
  'error',
  'qualify-claim-command',
  'record-qualification-expiry-command',
  'qualification-recorded-event',
  'match-experts-query',
  'match-completed-response',
  'schema-registry',
];

const ref = (name) => `arena:schema/expert-qualification/${name}@${SCHEMA_VERSION}`;

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

const string = (pattern) => ({ type: 'string', pattern });
const digest = () => string(DIGEST_PATTERN);
const nullable = (schema) => ({ oneOf: [{ type: 'null' }, schema] });

const capabilityRefDef = () => ({
  capabilityRef: {
    additionalProperties: false,
    description:
      'A content-addressed Capability Graph node reference (the A006/A004 view). Matching ' +
      'compares these refs EXACTLY (kind:id@version#digest) — content-addressed matching.',
    properties: {
      kind: { enum: [...COMPETENCY_NODE_KINDS, 'domain'] },
      id: string(CAPABILITY_NODE_ID_PATTERN),
      version: string(VERSION_PATTERN),
      digest: digest(),
    },
    required: ['kind', 'id', 'version', 'digest'],
    type: 'object',
  },
});

const credentialRefDef = () => ({
  credentialRef: {
    additionalProperties: false,
    description:
      'A professional credential reference (structurally @arena/expert-registry CredentialRefView): ' +
      'kind, neutral opaque reference and optional issuing organization.',
    properties: {
      kind: { enum: CREDENTIAL_KINDS },
      reference: string(NEUTRAL_LOCATOR_PATTERN),
      issuer: { type: 'string', minLength: 1, maxLength: 255 },
    },
    required: ['kind', 'reference'],
    type: 'object',
  },
});

const jurisdictionDef = () => ({
  jurisdiction: {
    additionalProperties: false,
    description:
      'A typed ISO 3166 jurisdiction (structurally @arena/expert-registry JurisdictionView). ' +
      'Professional-scope metadata, not personal location data.',
    properties: {
      jurisdictionVersion: { const: 1 },
      country: string(COUNTRY_PATTERN),
      region: string(REGION_PATTERN),
    },
    required: ['jurisdictionVersion', 'country'],
    type: 'object',
  },
});

const availabilityWindowDef = () => ({
  availabilityWindow: {
    additionalProperties: false,
    description:
      'One typed availability window (structurally @arena/expert-registry AvailabilityWindow): ' +
      'daily/weekly/one-time recurrences with HH:MM-HH:MM UTC intervals.',
    properties: {
      windowVersion: { const: 1 },
      recurrence: { enum: AVAILABILITY_RECURRENCES },
      dayOfWeek: { type: 'integer', minimum: 1, maximum: 7 },
      startUtc: string(TIME_OF_DAY_PATTERN),
      endUtc: string(TIME_OF_DAY_PATTERN),
      date: string(CALENDAR_DATE_PATTERN),
    },
    required: ['windowVersion', 'recurrence', 'startUtc', 'endUtc'],
    type: 'object',
  },
});

const policyRequirementDef = () => ({
  policyRequirement: {
    additionalProperties: false,
    description:
      'One evidence requirement of a qualification policy: the evidence kind and the minimum ' +
      'FRESH count required at evaluation time.',
    properties: {
      requirementId: string(QUALIFICATION_ID_PATTERN),
      evidenceKind: { enum: EVIDENCE_KINDS },
      minimumCount: { type: 'integer', minimum: 1 },
    },
    required: ['requirementId', 'evidenceKind', 'minimumCount'],
    type: 'object',
  },
});

const conflictRuleDef = () => ({
  conflictRule: {
    additionalProperties: false,
    description:
      'One conflict rule: evidence of the declared kind (for verification refs, optionally ' +
      'restricted to a declared derived outcome) revokes the qualification regardless of ' +
      'positive evidence (spec/quality-model.md conflicts/limitations).',
    properties: {
      evidenceKind: { enum: EVIDENCE_KINDS },
      outcome: nullable({ enum: VERIFICATION_REF_OUTCOMES }),
    },
    required: ['evidenceKind', 'outcome'],
    type: 'object',
  },
});

const requirementOutcomeDef = () => ({
  requirementOutcome: {
    additionalProperties: false,
    description:
      'The per-requirement sufficiency evidence: the policy demand, the evidence supply ' +
      '(present/fresh counts, supersession-resolved) and the satisfied flag. Counts and ' +
      'booleans ONLY — no scores, no aggregates (spec/quality-model.md).',
    properties: {
      requirementId: string(QUALIFICATION_ID_PATTERN),
      evidenceKind: { enum: EVIDENCE_KINDS },
      requiredCount: { type: 'integer', minimum: 1 },
      presentCount: { type: 'integer', minimum: 0 },
      freshCount: { type: 'integer', minimum: 0 },
      satisfied: { type: 'boolean' },
      reason: nullable(string(NEUTRAL_TEXT_PATTERN)),
    },
    required: [
      'requirementId',
      'evidenceKind',
      'requiredCount',
      'presentCount',
      'freshCount',
      'satisfied',
      'reason',
    ],
    type: 'object',
  },
});

const evidenceRecordVariant = (kind, payloadProperties, payloadRequired, payloadDescription) => ({
  additionalProperties: false,
  description: `The ${kind} evidence variant. ${payloadDescription}`,
  properties: {
    recordVersion: { const: 1, description: 'Wire version of the evidence record shape.' },
    kind: { const: kind },
    observedAt: string(TIMESTAMP_PATTERN),
    supersedes: digest(),
    ...payloadProperties,
    note: string(NEUTRAL_TEXT_PATTERN),
    digest: digest(),
  },
  required: ['recordVersion', 'kind', 'observedAt', ...payloadRequired, 'digest'],
  type: 'object',
});

const evidenceRecordOneOf = () => [
  evidenceRecordVariant(
    'credential-ref',
    { credential: { $ref: '#/$defs/credentialRef' } },
    ['credential'],
    'Payload: a professional credential reference (A006-shaped).',
  ),
  evidenceRecordVariant(
    'work-product-ref',
    {
      workProduct: {
        additionalProperties: false,
        description: 'A digest-addressed work product reference (the A006 EvidenceRef convention).',
        properties: {
          digest: digest(),
          description: string(NEUTRAL_TEXT_PATTERN),
        },
        required: ['digest', 'description'],
        type: 'object',
      },
    },
    ['workProduct'],
    'Payload: a digest-addressed work product with a human-auditable description.',
  ),
  evidenceRecordVariant(
    'verification-ref',
    {
      verification: {
        additionalProperties: false,
        description:
          'A reference to an A013 VerificationRecord by content digest plus its DERIVED outcome ' +
          '(pass | fail | unknown) — data ABOUT the record; the A013 fabric stays the authority.',
        properties: {
          recordDigest: digest(),
          outcome: { enum: VERIFICATION_REF_OUTCOMES },
        },
        required: ['recordDigest', 'outcome'],
        type: 'object',
      },
    },
    ['verification'],
    'Payload: an A013 verification-record reference with its derived outcome.',
  ),
  evidenceRecordVariant(
    'evaluation-ref',
    {
      evaluation: {
        additionalProperties: false,
        description: 'A reference to an A012 EvaluationRecord by content digest.',
        properties: {
          recordDigest: digest(),
        },
        required: ['recordDigest'],
        type: 'object',
      },
    },
    ['evaluation'],
    'Payload: an A012 evaluation-record reference.',
  ),
];

const perRequirementEntryDef = () => {
  const satisfiedEntry = {
    additionalProperties: false,
    description:
      'A SATISFIED per-requirement entry: the matched proficiency, the matched claim, the ' +
      'in-force qualification record and the qualifying evidence digests.',
    properties: {
      requirementId: string(QUALIFICATION_ID_PATTERN),
      satisfied: { const: true },
      matchedProficiency: { enum: PROFICIENCY_LEVELS },
      claimDigest: digest(),
      recordDigest: digest(),
      evidenceDigests: { type: 'array', items: digest(), minItems: 1 },
    },
    required: [
      'requirementId',
      'satisfied',
      'matchedProficiency',
      'claimDigest',
      'recordDigest',
      'evidenceDigests',
    ],
    type: 'object',
  };
  const unsatisfiedEntry = {
    additionalProperties: false,
    description:
      'An UNSATISFIED per-requirement entry: the explicit unmatched reason from the closed ' +
      'vocabulary (no silent best-effort).',
    properties: {
      requirementId: string(QUALIFICATION_ID_PATTERN),
      satisfied: { const: false },
      evidenceDigests: { type: 'array', items: digest(), maxItems: 0 },
      unmatchedReason: { enum: UNMATCHED_REASONS },
    },
    required: ['requirementId', 'satisfied', 'evidenceDigests', 'unmatchedReason'],
    type: 'object',
  };
  return {
    perRequirementEntry: {
      oneOf: [
        { $ref: '#/$defs/satisfiedEntry' },
        { $ref: '#/$defs/unsatisfiedEntry' },
      ],
    },
    satisfiedEntry,
    unsatisfiedEntry,
  };
};

const matchCandidateDef = () => ({
  matchCandidate: {
    additionalProperties: false,
    description:
      'One ranked candidate: the expert, the aggregate-free counters derived from the entries ' +
      '(satisfiedCount/evidenceCount are structural counts of per-requirement evidence, not ' +
      'quality scores) and the per-requirement entries.',
    properties: {
      expertId: string(NEUTRAL_LOCATOR_PATTERN),
      tenant: string(TENANT_PATTERN),
      satisfiedAll: { type: 'boolean' },
      satisfiedCount: { type: 'integer', minimum: 0 },
      evidenceCount: { type: 'integer', minimum: 0 },
      perRequirement: {
        type: 'array',
        minItems: 1,
        items: { $ref: '#/$defs/perRequirementEntry' },
      },
    },
    required: [
      'expertId',
      'tenant',
      'satisfiedAll',
      'satisfiedCount',
      'evidenceCount',
      'perRequirement',
    ],
    type: 'object',
  },
});

// ---------------------------------------------------------------------------
// Contract manifest — the A007 owned schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'expert-qualification/qualification-evidence',
    output: 'contracts/expert-qualification/qualification-evidence.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualification-evidence'),
        title: 'Arena QualificationEvidence v1',
        description:
          'A typed, digest-addressed evidence record backing a competency claim over the CLOSED ' +
          'four-member kind vocabulary (credential refs from the A006 expert registry, work-product ' +
          'refs, verification refs via the A013 verification protocol, evaluation refs via the A012 ' +
          'evaluation protocol). Append-only (lock rule 6): records are immutable, content-addressed ' +
          '(same record => same digest), and supersession APPENDS via the supersedes digest — the ' +
          'superseded record is never edited. observedAt is the recency dimension bound by ' +
          'qualification policies. QUALIFICATION IS DATA, NEVER AUTHORIZATION (lock rule 9).',
        oneOf: evidenceRecordOneOf(),
        $defs: {
          ...credentialRefDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/competency-claim',
    output: 'contracts/expert-qualification/competency-claim.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('competency-claim'),
        title: 'Arena CompetencyClaim v1',
        description:
          "An expert's claim on a capability/skill node ref with a typed proficiency level (A006's " +
          'closed vocabulary) and the evidence digests backing it (>= 1, unique — an evidence-free ' +
          'claim is structurally not a claim, R7). Content-addressed, immutable; tenant-scoped ' +
          '(lock rule 11); re-claiming APPENDS a superseding claim (lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: [
          'claimVersion',
          'expertId',
          'tenant',
          'capability',
          'proficiency',
          'evidence',
          'declaredAt',
          'digest',
        ],
        properties: {
          claimVersion: { const: 1, description: 'Wire version of the claim shape.' },
          expertId: string(NEUTRAL_LOCATOR_PATTERN),
          tenant: string(TENANT_PATTERN),
          capability: { $ref: '#/$defs/capabilityRef' },
          proficiency: { enum: PROFICIENCY_LEVELS },
          evidence: {
            type: 'array',
            minItems: 1,
            items: digest(),
            description: 'The evidence digests backing the claim (unique).',
          },
          declaredAt: string(TIMESTAMP_PATTERN),
          supersedes: digest(),
          digest: digest(),
        },
        $defs: {
          ...capabilityRefDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/qualification-policy',
    output: 'contracts/expert-qualification/qualification-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualification-policy'),
        title: 'Arena QualificationPolicy v1',
        description:
          'The versioned, content-addressed rules stating WHAT EVIDENCE QUALIFIES a competency ' +
          'claim: per-kind minimum FRESH counts (requirement ids unique), the freshness window ' +
          '(recency bound), the validity window (renewal/decay) and the conflict rules (evidence ' +
          'that revokes regardless of positive evidence). Same policy => same digest; changing a ' +
          'policy requires a new version. The policy is DATA about evidence adjudication — it ' +
          'grants NOTHING (lock rule 9).',
        type: 'object',
        additionalProperties: false,
        required: [
          'policyVersion',
          'policyId',
          'version',
          'description',
          'requirements',
          'freshnessWindowDays',
          'validityWindowDays',
          'conflictEvidence',
          'digest',
        ],
        properties: {
          policyVersion: { const: 1, description: 'Wire version of the policy shape.' },
          policyId: string(QUALIFICATION_ID_PATTERN),
          version: string(VERSION_PATTERN),
          description: string(NEUTRAL_TEXT_PATTERN),
          requirements: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/policyRequirement' },
            description: 'The evidence requirements; requirement ids unique within the policy.',
          },
          freshnessWindowDays: { type: 'integer', minimum: 1 },
          validityWindowDays: { type: 'integer', minimum: 1 },
          conflictEvidence: {
            type: 'array',
            items: { $ref: '#/$defs/conflictRule' },
            description: 'Conflict rules; (evidenceKind, outcome) pairs unique.',
          },
          digest: digest(),
        },
        $defs: {
          ...policyRequirementDef(),
          ...conflictRuleDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/qualification-record',
    output: 'contracts/expert-qualification/qualification-record.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualification-record'),
        title: 'Arena QualificationRecord v1',
        description:
          'The COMPUTED qualification state of one claim under one declared policy at one fixed ' +
          'time: the closed status vocabulary (qualified | unqualified | stale | expired | revoked), ' +
          'the per-requirement sufficiency outcomes (counts + freshness, no scores), the qualifying ' +
          'and conflict evidence digests, the validity window (present iff qualified) and the ' +
          'supersession chain. Derived by the PURE engine (conflict first, freshness next, ' +
          'sufficiency last); expiry APPENDS decay records and never rewrites history (lock rule 6). ' +
          'QUALIFICATION IS DATA, NEVER AUTHORIZATION (lock rule 9) — the record is an input to ' +
          'matching and audit, nothing more.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'claimDigest',
          'policyDigest',
          'status',
          'evaluatedAt',
          'requirementOutcomes',
          'qualifyingEvidence',
          'conflictEvidence',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Wire version of the record shape.' },
          claimDigest: digest(),
          policyDigest: digest(),
          status: {
            enum: QUALIFICATION_STATUSES,
            description:
              'Data about the evidence lifecycle of a claim; no member is a permission (lock rule 9).',
          },
          evaluatedAt: string(TIMESTAMP_PATTERN),
          requirementOutcomes: {
            type: 'array',
            items: { $ref: '#/$defs/requirementOutcome' },
            description:
              'One outcome per declared policy requirement, in policy order. EMPTY iff the status ' +
              'is expired (decay records document the lapse, not a fresh evaluation).',
          },
          qualifyingEvidence: {
            type: 'array',
            items: digest(),
            description: 'The fresh evidence digests that satisfied requirements (sorted).',
          },
          conflictEvidence: {
            type: 'array',
            items: digest(),
            description: 'The conflict evidence digests that drove a revocation (sorted).',
          },
          validFrom: string(TIMESTAMP_PATTERN),
          validUntil: string(TIMESTAMP_PATTERN),
          supersedes: digest(),
          note: string(NEUTRAL_TEXT_PATTERN),
          digest: digest(),
        },
        $defs: {
          ...requirementOutcomeDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/qualified-expert',
    output: 'contracts/expert-qualification/qualified-expert.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualified-expert'),
        title: 'Arena QualifiedExpertCard v1',
        description:
          'The tenant-scoped matching-side view of an expert (structurally compatible with A006 ' +
          'profile data, consumed as DATA — never modified): neutral expert id, tenant scope, ' +
          'declared domain node refs, typed jurisdictions and typed availability windows. Carries ' +
          'NO quality aggregate and NO task history — matching ranks by per-requirement ' +
          'qualification evidence only (spec/quality-model.md).',
        type: 'object',
        additionalProperties: false,
        required: ['cardVersion', 'expertId', 'tenant', 'domainRefs', 'jurisdictions', 'availability', 'digest'],
        properties: {
          cardVersion: { const: 1, description: 'Wire version of the expert-card shape.' },
          expertId: string(NEUTRAL_LOCATOR_PATTERN),
          tenant: string(TENANT_PATTERN),
          domainRefs: {
            type: 'array',
            items: { $ref: '#/$defs/capabilityRef' },
            description: 'The capability-graph DOMAIN nodes the expert scope covers (0+).',
          },
          jurisdictions: {
            type: 'array',
            items: { $ref: '#/$defs/jurisdiction' },
            description: 'The typed jurisdictions the expert scope covers (0+).',
          },
          availability: {
            type: 'array',
            items: { $ref: '#/$defs/availabilityWindow' },
            description: 'The typed availability windows (0+ — no availability declared).',
          },
          digest: digest(),
        },
        $defs: {
          ...capabilityRefDef(),
          ...jurisdictionDef(),
          ...availabilityWindowDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/match-request',
    output: 'contracts/expert-qualification/match-request.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('match-request'),
        title: 'Arena MatchRequest v1',
        description:
          "A task's expert requirements: the requesting tenant (lock rule 11 — only same-tenant or " +
          'public experts are evaluated), competency refs with proficiency thresholds (ids unique, ' +
          'capability refs content-addressed), optional domain/jurisdiction constraints, an optional ' +
          'UTC availability window and the FIXED evaluation time (the determinism anchor — no clock ' +
          'reads). Content-addressed, immutable.',
        type: 'object',
        additionalProperties: false,
        required: ['requestVersion', 'tenant', 'requirements', 'evaluatedAt', 'digest'],
        properties: {
          requestVersion: { const: 1, description: 'Wire version of the request shape.' },
          tenant: string(TENANT_PATTERN),
          requirements: {
            type: 'array',
            minItems: 1,
            items: {
              additionalProperties: false,
              description: 'One competency requirement: the capability ref + the proficiency threshold.',
              properties: {
                requirementId: string(QUALIFICATION_ID_PATTERN),
                capability: { $ref: '#/$defs/capabilityRef' },
                minimumProficiency: { enum: PROFICIENCY_LEVELS },
              },
              required: ['requirementId', 'capability', 'minimumProficiency'],
              type: 'object',
            },
          },
          evaluatedAt: string(TIMESTAMP_PATTERN),
          domainRef: { $ref: '#/$defs/capabilityRef' },
          jurisdictions: {
            type: 'array',
            minItems: 1,
            items: { $ref: '#/$defs/jurisdiction' },
          },
          availabilityWindow: {
            additionalProperties: false,
            description: 'The requested UTC availability window (until strictly after from).',
            properties: {
              from: string(TIMESTAMP_PATTERN),
              until: string(TIMESTAMP_PATTERN),
            },
            required: ['from', 'until'],
            type: 'object',
          },
          digest: digest(),
        },
        $defs: {
          ...capabilityRefDef(),
          ...jurisdictionDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/matching-policy',
    output: 'contracts/expert-qualification/matching-policy.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('matching-policy'),
        title: 'Arena MatchingPolicy v1',
        description:
          'The versioned, deterministic, pure rules of the matching fabric: maxCandidates (the ' +
          'result cap), includePartialMatches (partial candidates appear WITH explicit unmatched ' +
          'reasons) and availabilityRequired (fail closed on availability conflicts). The RANKING ' +
          'is fixed and deterministic — fully-satisfying candidates first, then satisfied-count ' +
          'descending, then evidence depth descending, then tie-break by content digest — with NO ' +
          'aggregate quality score and NO reputation input anywhere (spec/quality-model.md).',
        type: 'object',
        additionalProperties: false,
        required: [
          'policyVersion',
          'policyId',
          'version',
          'description',
          'maxCandidates',
          'includePartialMatches',
          'availabilityRequired',
          'digest',
        ],
        properties: {
          policyVersion: { const: 1, description: 'Wire version of the matching-policy shape.' },
          policyId: string(QUALIFICATION_ID_PATTERN),
          version: string(VERSION_PATTERN),
          description: string(NEUTRAL_TEXT_PATTERN),
          maxCandidates: { type: 'integer', minimum: 1 },
          includePartialMatches: { type: 'boolean' },
          availabilityRequired: { type: 'boolean' },
          digest: digest(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/match-result',
    output: 'contracts/expert-qualification/match-result.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('match-result'),
        title: 'Arena MatchResult v1',
        description:
          'The deterministic result of one match run: ranked candidates, each carrying FOR EACH ' +
          'request requirement the satisfaction evidence (matched claim digest, in-force ' +
          'qualification record digest, qualifying evidence digests) or an EXPLICIT unmatched ' +
          'reason from the closed vocabulary — no silent best-effort, no aggregate score. ' +
          'requirementsUnmet lists the request requirements NO returned candidate satisfies; ' +
          'truncated flags a cap-driven cut. Content-addressed.',
        type: 'object',
        additionalProperties: false,
        required: [
          'resultVersion',
          'requestDigest',
          'matchingPolicyDigest',
          'evaluatedAt',
          'candidates',
          'requirementsUnmet',
          'truncated',
          'digest',
        ],
        properties: {
          resultVersion: { const: 1, description: 'Wire version of the result shape.' },
          requestDigest: digest(),
          matchingPolicyDigest: digest(),
          evaluatedAt: string(TIMESTAMP_PATTERN),
          candidates: {
            type: 'array',
            items: { $ref: '#/$defs/matchCandidate' },
          },
          requirementsUnmet: {
            type: 'array',
            items: string(QUALIFICATION_ID_PATTERN),
          },
          truncated: { type: 'boolean' },
          digest: digest(),
        },
        $defs: {
          ...perRequirementEntryDef(),
          ...matchCandidateDef(),
        },
      };
    },
  },
  {
    id: 'expert-qualification/error',
    output: 'contracts/expert-qualification/expert-qualification-error.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('error'),
        title: 'Arena ExpertQualificationError v1',
        description:
          'Wire-safe structured form of an ExpertQualificationError: closed ' +
          'EXPERT_QUALIFICATION_* code set, core category mapping, strictly validating parse ' +
          '(unknown codes rejected). No code grants, implies or records a permission (lock rule 9).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: EXPERT_QUALIFICATION_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: string(CORRELATION_PATTERN),
        },
      };
    },
  },
  {
    id: 'expert-qualification/qualify-claim-command',
    output: 'contracts/expert-qualification/qualify-claim-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualify-claim-command'),
        title: 'Arena qualify-claim-command v1',
        description:
          'Command envelope payload: evaluate one competency claim under one qualification policy ' +
          'at one fixed time. Carries the digest refs of the claim and the policy, the evaluation ' +
          'time (determinism anchor) and the renew flag (true to supersede the latest record of ' +
          'the claim). Commands carry a REQUIRED non-null idempotency key (architecture-lock ' +
          'rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['claimRef', 'policyRef', 'evaluatedAt', 'renew'],
        properties: {
          claimRef: digest(),
          policyRef: digest(),
          evaluatedAt: string(TIMESTAMP_PATTERN),
          renew: { type: 'boolean' },
        },
      };
    },
  },
  {
    id: 'expert-qualification/record-qualification-expiry-command',
    output: 'contracts/expert-qualification/record-qualification-expiry-command.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('record-qualification-expiry-command'),
        title: 'Arena record-qualification-expiry-command v1',
        description:
          'Command envelope payload: append the decay record for a qualification whose validity ' +
          'window has elapsed (expiry NEVER rewrites history — this appends the expired record ' +
          'that supersedes the lapsed one). Commands carry a REQUIRED non-null idempotency key ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['claimRef', 'evaluatedAt'],
        properties: {
          claimRef: digest(),
          evaluatedAt: string(TIMESTAMP_PATTERN),
        },
      };
    },
  },
  {
    id: 'expert-qualification/qualification-recorded-event',
    output: 'contracts/expert-qualification/qualification-recorded-event.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('qualification-recorded-event'),
        title: 'Arena qualification-recorded-event v1',
        description:
          "Event envelope payload: the fabric's authoritative result — the frozen, " +
          'content-addressed QualificationRecord (any status, including decay records). The event ' +
          'carries the causal command idempotency key when provided.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: {
            $ref: `arena:schema/expert-qualification/qualification-record@${SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'expert-qualification/match-experts-query',
    output: 'contracts/expert-qualification/match-experts-query.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('match-experts-query'),
        title: 'Arena match-experts-query v1',
        description:
          'Query envelope payload: match one request under one matching policy. Queries are pure — ' +
          'no idempotency key is required (lock rule 17 command discipline applies to mutations).',
        type: 'object',
        additionalProperties: false,
        required: ['request', 'policy'],
        properties: {
          request: {
            $ref: `arena:schema/expert-qualification/match-request@${SCHEMA_VERSION}`,
          },
          policy: {
            $ref: `arena:schema/expert-qualification/matching-policy@${SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'expert-qualification/match-completed-response',
    output: 'contracts/expert-qualification/match-completed-response.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('match-completed-response'),
        title: 'Arena match-completed-response v1',
        description:
          'Response envelope payload: the authoritative match result of a match-experts query.',
        type: 'object',
        additionalProperties: false,
        required: ['result'],
        properties: {
          result: {
            $ref: `arena:schema/expert-qualification/match-result@${SCHEMA_VERSION}`,
          },
        },
      };
    },
  },
  {
    id: 'expert-qualification/schema-registry',
    output: 'contracts/expert-qualification/expert-qualification-schema-registry.v1.json',
    build() {
      return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: ref('schema-registry'),
        title: 'Arena expert-qualification-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/expert-qualification. A SchemaRef matching this ' +
          'enum is a known expert-qualification-protocol schema at the listed version; anything ' +
          'else is not.',
        type: 'string',
        enum: SCHEMA_NAMES.map((name) => ref(name)),
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
  const tempDir = join(tmpdir(), `arena-expert-qualification-contracts-${process.pid}-${Date.now()}`);
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
