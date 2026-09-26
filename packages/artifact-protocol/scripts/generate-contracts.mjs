#!/usr/bin/env node
/**
 * Arena artifact-protocol contract generator (Work Order A002).
 *
 * Follows the A001 generated-contracts convention (scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A002 surfaces ONLY — it
 *     emits every schema for @arena/artifact-protocol and @arena/provenance
 *     into contracts/artifacts/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part
 *     of `pnpm test`, the package script `contracts:check` runs it directly,
 *     and wiring this manifest into the repo-wide governance G9 entry point
 *     is a one-line Tech Lead reconciliation (see the A002 final report —
 *     scripts/ is outside A002's owned surfaces).
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
// (packages/artifact-protocol/src/**, packages/provenance/src/**). Parity is
// asserted by contracts.parity.test.ts in both packages; drift between these
// constants and the TS constants fails those tests.
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

// artifact-protocol constants
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const LICENSE_PATTERN = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';
const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
const COMMERCIAL_USE_POLICIES = ['allowed', 'requires-license', 'prohibited'];
const REDISTRIBUTION_POLICIES = ['allowed', 'tenant-only', 'prohibited'];
const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'];
const PUBLICATION_ACTIONS = ['publish', 'retract'];
const PUBLICATION_RECORD_VERSION = 1;
const ARTIFACT_ERROR_CODES = [
  'ARTIFACT_ALREADY_PUBLISHED',
  'ARTIFACT_IDENTITY_CONFLICT',
  'ARTIFACT_INVALID_ARTIFACT',
  'ARTIFACT_INVALID_DIGEST',
  'ARTIFACT_INVALID_IDENTITY',
  'ARTIFACT_INVALID_PRINCIPAL',
  'ARTIFACT_INVALID_PUBLICATION',
  'ARTIFACT_INVALID_RIGHTS',
  'ARTIFACT_INVALID_TIMESTAMP',
  'ARTIFACT_MISSING_RIGHTS',
  'ARTIFACT_TAMPERED',
  'ARTIFACT_UNKNOWN_ERROR',
  'ARTIFACT_UNRESOLVED_REF',
  'ARTIFACT_UNSUPPORTED_RECORD_VERSION',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];
const ARTIFACT_SCHEMA_VERSION = '1.0.0';
const ARTIFACT_SCHEMA_NAMES = [
  'artifact-identity',
  'artifact-published-event',
  'artifact-ref',
  'artifact-error',
  'content-digest',
  'material-artifact',
  'principal',
  'publication',
  'publication-ledger',
  'publish-artifact-command',
  'retract-publication-command',
  'rights',
  'schema-registry',
  'timestamp',
];

// provenance constants
const LINEAGE_RELATIONS = ['adapted-from', 'composed-of', 'derived-from', 'extracted-from'];
const VERIFICATION_KINDS = ['attestation', 'certification', 'evaluation', 'verification'];
const PROVENANCE_RECORD_VERSION = 1;
const PROVENANCE_ERROR_CODES = [
  'PROVENANCE_CYCLE_DETECTED',
  'PROVENANCE_IDENTITY_CONFLICT',
  'PROVENANCE_INVALID_PRINCIPAL',
  'PROVENANCE_INVALID_RECORD',
  'PROVENANCE_INVALID_REF',
  'PROVENANCE_INVALID_RIGHTS',
  'PROVENANCE_INVALID_TIMESTAMP',
  'PROVENANCE_MISSING_RIGHTS',
  'PROVENANCE_UNKNOWN_ERROR',
  'PROVENANCE_UNSUPPORTED_RECORD_VERSION',
];
const PROVENANCE_SCHEMA_VERSION = '1.0.0';
const PROVENANCE_SCHEMA_NAMES = [
  'lineage-edge',
  'provenance-error',
  'provenance-record',
  'provenance-recorded-event',
  'record-provenance-command',
  'schema-registry',
  'transformation-lineage',
  'verification-ref',
];

const aref = (name) => `arena:schema/artifacts/${name}@${ARTIFACT_SCHEMA_VERSION}`;
const pref = (name) => `arena:schema/provenance/${name}@${PROVENANCE_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001 contracts).
const artifactIdentityDef = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'name', 'version'],
  properties: {
    namespace: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: VERSION_PATTERN },
  },
};
const artifactRefDef = {
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

// ---------------------------------------------------------------------------
// Contract manifest — the A002 owned generator set.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'artifact-protocol/artifact-identity',
    output: 'contracts/artifacts/artifact-identity.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('artifact-identity'),
        title: 'Arena ArtifactIdentity v1',
        description:
          'Stable, provider-neutral identity of a material artifact: tenant-scoped namespace ' +
          "(or the reserved 'public' namespace), name, and a semver-compatible version " +
          '(major.minor.patch with optional prerelease; build metadata is rejected). ' +
          'Identities are immutable: identity + version + content digest are frozen together ' +
          'on the MaterialArtifact (architecture-lock rules 5, 18).',
        ...artifactIdentityDef,
      };
    },
  },
  {
    id: 'artifact-protocol/artifact-ref',
    output: 'contracts/artifacts/artifact-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('artifact-ref'),
        title: 'Arena ArtifactRef v1',
        description:
          'A content-addressed reference to a material artifact: identity plus the sha256 ' +
          'content digest of the referenced artifact. The unit of lineage edges, embedded ' +
          'references and publication records.',
        ...artifactRefDef,
      };
    },
  },
  {
    id: 'artifact-protocol/content-digest',
    output: 'contracts/artifacts/content-digest.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('content-digest'),
        title: 'Arena ContentDigest v1',
        description:
          'sha256 content digest (lowercase hex) over the canonical JSON serialization of an ' +
          "artifact's digest-free view {identity, refs, content}. Computed with " +
          '@arena/protocol-core digestCanonical — never reimplemented.',
        type: 'string',
        pattern: DIGEST_PATTERN,
      };
    },
  },
  {
    id: 'artifact-protocol/material-artifact',
    output: 'contracts/artifacts/material-artifact.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('material-artifact'),
        title: 'Arena MaterialArtifact v1',
        description:
          'The immutable, content-addressed artifact unit: identity, embedded artifact ' +
          'references, arbitrary plain-JSON content, and the sha256 digest over the canonical ' +
          'serialization of the digest-free view. Deep-frozen at creation; no mutation API ' +
          'exists (architecture-lock rules 5, 6, 18).',
        type: 'object',
        additionalProperties: false,
        required: ['identity', 'refs', 'content', 'digest'],
        properties: {
          identity: { $ref: '#/$defs/artifactIdentity' },
          refs: {
            type: 'array',
            items: { $ref: '#/$defs/artifactRef' },
          },
          content: {
            description: 'Arbitrary plain-JSON material content (canonically serializable).',
          },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
        $defs: {
          artifactIdentity: artifactIdentityDef,
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'artifact-protocol/principal',
    output: 'contracts/artifacts/principal.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('principal'),
        title: 'Arena PrincipalRef v1',
        description:
          'Tenant-scoped principal (creator/publisher/actor). NEVER a raw provider identity: ' +
          'the closed type enum has no model/provider member and the identifier charset ' +
          'excludes the characters provider identity shapes require ' +
          '(architecture-lock rules 10, 23; docs/architecture.md §15, §17).',
        ...principalDef,
      };
    },
  },
  {
    id: 'artifact-protocol/rights',
    output: 'contracts/artifacts/rights.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('rights'),
        title: 'Arena RightsMetadata v1',
        description:
          'Explicit licensing and usage constraints. REQUIRED on provenance records and ' +
          'publication records — missing rights metadata is rejected (architecture-lock ' +
          'rule 23; requirements R47, R48).',
        ...rightsDef,
      };
    },
  },
  {
    id: 'artifact-protocol/timestamp',
    output: 'contracts/artifacts/timestamp.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('timestamp'),
        title: 'Arena artifact Timestamp v1',
        description:
          'UTC ISO-8601 timestamp with EXACTLY millisecond precision and an explicit Z ' +
          'designator. Lexically and calendar-validated (impossible dates are rejected).',
        type: 'string',
        pattern: TIMESTAMP_PATTERN,
      };
    },
  },
  {
    id: 'artifact-protocol/publication',
    output: 'contracts/artifacts/publication.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('publication'),
        title: 'Arena PublicationRecord v1',
        description:
          'Explicit, immutable publication record making an artifact public ' +
          '(architecture-lock rule 12). Append-only (rule 6): retraction appends a NEW ' +
          'record with action "retract" whose supersedes field carries the record digest of ' +
          'the superseded publication — the original is never rewritten. Rights metadata is ' +
          'mandatory on the public record (rule 23).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'action',
          'artifact',
          'publisher',
          'rights',
          'publishedAt',
        ],
        properties: {
          recordVersion: { const: PUBLICATION_RECORD_VERSION },
          action: { enum: PUBLICATION_ACTIONS },
          artifact: { $ref: '#/$defs/artifactRef' },
          publisher: { $ref: '#/$defs/principal' },
          rights: { $ref: '#/$defs/rights' },
          publishedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          supersedes: {
            type: 'string',
            pattern: DIGEST_PATTERN,
            description: 'Retract records only: record digest of the superseded publication.',
          },
        },
        $defs: {
          artifactRef: artifactRefDef,
          principal: principalDef,
          rights: rightsDef,
        },
      };
    },
  },
  {
    id: 'artifact-protocol/publication-ledger',
    output: 'contracts/artifacts/publication-ledger.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('publication-ledger'),
        title: 'Arena PublicationLedger v1',
        description:
          'Append-only publication history. Pure append operations return new ledgers; ' +
          'records are never edited or reordered. Enforces identity immutability (one digest ' +
          'per identity, forever) and retraction targeting.',
        type: 'array',
        uniqueItems: true,
        items: { $ref: 'publication.v1.json' },
      };
    },
  },
  {
    id: 'artifact-protocol/artifact-error',
    output: 'contracts/artifacts/artifact-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('artifact-error'),
        title: 'Arena ArtifactError v1',
        description:
          'Structured, serializable form of the artifact protocol error taxonomy. Unknown ' +
          'codes are rejected when parsing (ARTIFACT_UNKNOWN_ERROR). Core-level failures ' +
          'still travel as @arena/protocol-core ProtocolError structures.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ARTIFACT_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'artifact-protocol/publish-artifact-command',
    output: 'contracts/artifacts/publish-artifact-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('publish-artifact-command'),
        title: 'Arena publish-artifact command payload v1',
        description:
          'Idempotency-keyed command payload making an artifact public. Travels inside ' +
          'Envelope<T>; the envelope idempotencyKey is REQUIRED non-null for commands ' +
          '(architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['artifact', 'publisher', 'rights'],
        properties: {
          artifact: { $ref: '#/$defs/materialArtifact' },
          publisher: { $ref: '#/$defs/principal' },
          rights: { $ref: '#/$defs/rights' },
        },
        $defs: {
          materialArtifact: {
            type: 'object',
            additionalProperties: false,
            required: ['identity', 'refs', 'content', 'digest'],
            properties: {
              identity: { $ref: '#/$defs/artifactIdentity' },
              refs: { type: 'array', items: { $ref: '#/$defs/artifactRef' } },
              content: {},
              digest: { type: 'string', pattern: DIGEST_PATTERN },
            },
          },
          artifactIdentity: artifactIdentityDef,
          artifactRef: artifactRefDef,
          principal: principalDef,
          rights: rightsDef,
        },
      };
    },
  },
  {
    id: 'artifact-protocol/retract-publication-command',
    output: 'contracts/artifacts/retract-publication-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('retract-publication-command'),
        title: 'Arena retract-publication command payload v1',
        description:
          'Idempotency-keyed command payload appending a retraction record for a published ' +
          'artifact. The referenced publication is never rewritten (append-only, ' +
          'architecture-lock rule 6).',
        type: 'object',
        additionalProperties: false,
        required: ['publicationDigest', 'publisher'],
        properties: {
          publicationDigest: { type: 'string', pattern: DIGEST_PATTERN },
          publisher: { $ref: '#/$defs/principal' },
        },
        $defs: {
          principal: principalDef,
        },
      };
    },
  },
  {
    id: 'artifact-protocol/artifact-published-event',
    output: 'contracts/artifacts/artifact-published-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('artifact-published-event'),
        title: 'Arena artifact-published event payload v1',
        description:
          'Event payload emitted when a publication record is appended to the ledger. ' +
          'Travels inside Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['publication'],
        properties: {
          publication: { $ref: '#/$defs/publication' },
        },
        $defs: {
          publication: {
            type: 'object',
            additionalProperties: false,
            required: [
              'recordVersion',
              'action',
              'artifact',
              'publisher',
              'rights',
              'publishedAt',
            ],
            properties: {
              recordVersion: { const: PUBLICATION_RECORD_VERSION },
              action: { enum: PUBLICATION_ACTIONS },
              artifact: { $ref: '#/$defs/artifactRef' },
              publisher: { $ref: '#/$defs/principal' },
              rights: { $ref: '#/$defs/rights' },
              publishedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
              supersedes: { type: 'string', pattern: DIGEST_PATTERN },
            },
          },
          artifactRef: artifactRefDef,
          principal: principalDef,
          rights: rightsDef,
        },
      };
    },
  },
  {
    id: 'artifact-protocol/schema-registry',
    output: 'contracts/artifacts/artifacts-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: aref('schema-registry'),
        title: 'Arena artifact-protocol schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/artifact-protocol. A SchemaRef matching ' +
          'this enum is a known artifact-protocol schema at the listed version; anything else ' +
          'is not.',
        type: 'string',
        enum: ARTIFACT_SCHEMA_NAMES.map((name) => aref(name)),
      };
    },
  },
  // ----- provenance package schemas -------------------------------------
  {
    id: 'provenance/lineage-edge',
    output: 'contracts/artifacts/lineage-edge.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('lineage-edge'),
        title: 'Arena LineageEdge v1',
        description:
          'One parent edge of a provenance record: the parent artifact reference plus the ' +
          'lineage relation. Self-references are rejected at record construction.',
        type: 'object',
        additionalProperties: false,
        required: ['parent', 'relation'],
        properties: {
          parent: { $ref: '#/$defs/artifactRef' },
          relation: { enum: LINEAGE_RELATIONS },
        },
        $defs: {
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'provenance/transformation-lineage',
    output: 'contracts/artifacts/transformation-lineage.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('transformation-lineage'),
        title: 'Arena TransformationLineage v1',
        description:
          'What transform produced this artifact from which parents: the transform is itself ' +
          'a content-addressed artifact reference; inputs reference the consumed parents ' +
          '(every input must also appear among the record parents).',
        type: 'object',
        additionalProperties: false,
        required: ['transform', 'inputs'],
        properties: {
          transform: { $ref: '#/$defs/artifactRef' },
          inputs: {
            type: 'array',
            items: { $ref: '#/$defs/artifactRef' },
          },
        },
        $defs: {
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'provenance/verification-ref',
    output: 'contracts/artifacts/verification-ref.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('verification-ref'),
        title: 'Arena VerificationRef v1',
        description:
          'A reference to evidence about an artifact: the verification kind plus the ' +
          'content-addressed evidence artifact. Evaluation and verification are distinct ' +
          'responsibilities (architecture-lock rule 7).',
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'evidence'],
        properties: {
          kind: { enum: VERIFICATION_KINDS },
          evidence: { $ref: '#/$defs/artifactRef' },
        },
        $defs: {
          artifactRef: artifactRefDef,
        },
      };
    },
  },
  {
    id: 'provenance/provenance-record',
    output: 'contracts/artifacts/provenance-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('provenance-record'),
        title: 'Arena ProvenanceRecord v1',
        description:
          'Full provenance for a material artifact (docs/architecture.md §15): stable ' +
          'identity + version + digest, source/creator (tenant-scoped principal, never a raw ' +
          'provider identity), timestamps (UTC millisecond precision), parent refs (lineage ' +
          'edges), rights metadata (mandatory), transformation lineage and verification refs. ' +
          'Self-references and duplicate parents are rejected at construction.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'artifact',
          'creator',
          'createdAt',
          'recordedAt',
          'parents',
          'transformation',
          'rights',
          'verification',
        ],
        properties: {
          recordVersion: { const: PROVENANCE_RECORD_VERSION },
          artifact: { $ref: '#/$defs/artifactRef' },
          creator: { $ref: '#/$defs/principal' },
          createdAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          recordedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          parents: {
            type: 'array',
            items: { $ref: '#/$defs/lineageEdge' },
          },
          transformation: { $ref: '#/$defs/transformationLineage' },
          rights: { $ref: '#/$defs/rights' },
          verification: {
            type: 'array',
            items: { $ref: '#/$defs/verificationRef' },
          },
        },
        $defs: {
          artifactRef: artifactRefDef,
          lineageEdge: {
            type: 'object',
            additionalProperties: false,
            required: ['parent', 'relation'],
            properties: {
              parent: { $ref: '#/$defs/artifactRef' },
              relation: { enum: LINEAGE_RELATIONS },
            },
          },
          principal: principalDef,
          rights: rightsDef,
          transformationLineage: {
            type: 'object',
            additionalProperties: false,
            required: ['transform', 'inputs'],
            properties: {
              transform: { $ref: '#/$defs/artifactRef' },
              inputs: { type: 'array', items: { $ref: '#/$defs/artifactRef' } },
            },
          },
          verificationRef: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'evidence'],
            properties: {
              kind: { enum: VERIFICATION_KINDS },
              evidence: { $ref: '#/$defs/artifactRef' },
            },
          },
        },
      };
    },
  },
  {
    id: 'provenance/provenance-error',
    output: 'contracts/artifacts/provenance-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('provenance-error'),
        title: 'Arena ProvenanceError v1',
        description:
          'Structured, serializable form of the provenance error taxonomy. Unknown codes are ' +
          'rejected when parsing (PROVENANCE_UNKNOWN_ERROR).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: PROVENANCE_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'provenance/record-provenance-command',
    output: 'contracts/artifacts/record-provenance-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('record-provenance-command'),
        title: 'Arena record-provenance command payload v1',
        description:
          'Idempotency-keyed command payload appending a provenance record to the lineage ' +
          'store. Travels inside Envelope<T> (architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: { $ref: 'provenance-record.v1.json' },
        },
      };
    },
  },
  {
    id: 'provenance/provenance-recorded-event',
    output: 'contracts/artifacts/provenance-recorded-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('provenance-recorded-event'),
        title: 'Arena provenance-recorded event payload v1',
        description:
          'Event payload emitted when a provenance record is stored. Travels inside ' +
          'Envelope<T> with a correlation id and canonical serialization.',
        type: 'object',
        additionalProperties: false,
        required: ['record'],
        properties: {
          record: { $ref: 'provenance-record.v1.json' },
        },
      };
    },
  },
  {
    id: 'provenance/schema-registry',
    output: 'contracts/artifacts/provenance-schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: pref('schema-registry'),
        title: 'Arena provenance schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/provenance. A SchemaRef matching this enum ' +
          'is a known provenance schema at the listed version; anything else is not.',
        type: 'string',
        enum: PROVENANCE_SCHEMA_NAMES.map((name) => pref(name)),
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
  const tempDir = join(tmpdir(), `arena-artifact-contracts-${process.pid}-${Date.now()}`);
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
    // (contracts/artifacts) — never the whole tree, so running --check
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
        '[contracts] run: node packages/artifact-protocol/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/artifacts');
}

main();
