#!/usr/bin/env node
/**
 * Arena model-substrate contract generator (Work Order A016).
 *
 * Follows the A001/A002 generated-contracts convention
 * (scripts/generate-contracts.mjs, packages/artifact-protocol/scripts):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A016 contracts ONLY — it
 *     emits every schema for @arena/model-substrate into
 *     contracts/model-substrate/ at the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part
 *     of `pnpm test`, the package script `contracts:check` runs it directly,
 *     and governance G9 auto-discovers every package-level generator (the
 *     packages-anything/scripts/generate-contracts.mjs convention), so
 *     per-package contract drift is governed centrally without any
 *     root-file edit.
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

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ---------------------------------------------------------------------------
// Shared constants (must match packages/model-substrate/src — parity is
// asserted by packages/model-substrate/src/contracts.parity.test.ts).
// ---------------------------------------------------------------------------

const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const VERSION_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const MODEL_FAMILY_PATTERN = '^[a-z0-9][a-z0-9-]{0,63}$';
const MODEL_ID_PATTERN = '^[a-z0-9][a-z0-9._-]{0,127}$';
const MODEL_REVISION_PATTERN = '^[a-z0-9][a-z0-9._-]{0,63}$';
const MODALITIES = [
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
const CONDITIONS = [
  'stable',
  'preview',
  'deprecated',
  'rate-limited',
  'region-restricted',
  'sovereign-only',
  'capacity-constrained',
];
const HEALTH_STATUSES = ['healthy', 'degraded', 'unavailable'];
const OUTCOMES = ['pass', 'fail', 'inconclusive'];
const ERROR_CATEGORIES = ['validation', 'encoding', 'versioning', 'integrity', 'unknown'];
const ERROR_CODES = [
  'MODEL_SUBSTRATE_INVALID_IDENTITY',
  'MODEL_SUBSTRATE_INVALID_REF',
  'MODEL_SUBSTRATE_INVALID_DIGEST',
  'MODEL_SUBSTRATE_INVALID_VERSION',
  'MODEL_SUBSTRATE_INVALID_TIMESTAMP',
  'MODEL_SUBSTRATE_INVALID_ADAPTER_DESCRIPTOR',
  'MODEL_SUBSTRATE_INVALID_SUBSTRATE',
  'MODEL_SUBSTRATE_INVALID_CAPABILITY_PROFILE',
  'MODEL_SUBSTRATE_INVALID_HEALTH_REPORT',
  'MODEL_SUBSTRATE_INVALID_REGISTRATION',
  'MODEL_SUBSTRATE_REGISTRY_CONFLICT',
  'MODEL_SUBSTRATE_ADAPTER_MISMATCH',
  'MODEL_SUBSTRATE_CAPABILITY_EXCEEDED',
  'MODEL_SUBSTRATE_INVALID_COMPATIBILITY_TEST',
  'MODEL_SUBSTRATE_INVALID_COMPATIBILITY_RESULT',
  'MODEL_SUBSTRATE_INVALID_UPGRADE',
  'MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN',
  'MODEL_SUBSTRATE_PROVIDER_NAME_REJECTED',
  'MODEL_SUBSTRATE_CREDENTIAL_REJECTED',
  'MODEL_SUBSTRATE_SUBSTRATE_ALIAS_FORBIDDEN',
  'MODEL_SUBSTRATE_TAMPERED',
  'MODEL_SUBSTRATE_UNSUPPORTED_VERSION',
  'MODEL_SUBSTRATE_UNKNOWN_ERROR',
];
const SCHEMA_VERSION = '1.0.0';

const ref = (name) => `arena:schema/model-substrate/${name}@${SCHEMA_VERSION}`;

const UNITS_LIMIT = 2147483647;

const contextLimitsDef = {
  additionalProperties: false,
  properties: {
    maxContextUnits: { type: 'integer', minimum: 1, maximum: UNITS_LIMIT },
    maxOutputUnits: { type: 'integer', minimum: 1, maximum: UNITS_LIMIT },
  },
  required: ['maxContextUnits', 'maxOutputUnits'],
  type: 'object',
};

const versionedArtifactRefDef = {
  additionalProperties: false,
  properties: {
    namespace: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
  required: ['namespace', 'name', 'version', 'digest'],
  type: 'object',
};

const bodyVersionRefDef = {
  additionalProperties: false,
  properties: {
    tenant: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: VERSION_PATTERN },
    digest: { type: 'string', pattern: DIGEST_PATTERN },
  },
  required: ['tenant', 'name', 'version', 'digest'],
  type: 'object',
};

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// ---------------------------------------------------------------------------
// Contract manifest — the A016 schema surface.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'model-substrate/adapter-descriptor',
    output: 'contracts/model-substrate/adapter-descriptor.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('adapter-descriptor'),
        title: 'Arena model adapter AdapterDescriptor v1',
        description:
          'Content-addressed identity of a SubstrateAdapter build: neutral adapter id, adapter semver, ' +
          'the protocol surface version it implements (must be the exact version this registry of contracts ' +
          'describes — unknown versions are rejected), the capability envelope it can register (supported ' +
          'modalities, maximum tool-calling level, context ceiling in adapter-native units), and the sha256 ' +
          'digest over the canonical digest-free view. Same descriptor content ⇒ same digest (registry-style ' +
          'dedup). No provider brand names, no credential-shaped fields — both are rejected at construction.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'adapterId',
          'adapterVersion',
          'protocolVersion',
          'supportedModalities',
          'supportedToolCalling',
          'contextCeiling',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1 },
          adapterId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          adapterVersion: { type: 'string', pattern: VERSION_PATTERN },
          protocolVersion: { type: 'string', pattern: VERSION_PATTERN },
          supportedModalities: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: MODALITIES },
          },
          supportedToolCalling: { enum: TOOL_CALLING_LEVELS },
          contextCeiling: { $ref: '#/$defs/contextLimits' },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
        $defs: { contextLimits: contextLimitsDef },
      };
    },
  },
  {
    id: 'model-substrate/substrate-registration-descriptor',
    output: 'contracts/model-substrate/substrate-registration-descriptor.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('substrate-registration-descriptor'),
        title: 'Arena substrate registration descriptor v1',
        description:
          'The neutral descriptor a SubstrateAdapter accepts in registerSubstrate(descriptor): model family, ' +
          'model id, model revision, modality profile, tool-calling profile, context limits (adapter-native ' +
          'units) and declared conditions. Closed shape; the ADAPTER contributes its own identity. Provider ' +
          'brand names and credential-shaped fields are rejected at construction (architecture-lock rule 10).',
        type: 'object',
        additionalProperties: false,
        required: [
          'modelFamily',
          'modelId',
          'modelRevision',
          'modalityProfile',
          'toolCallingProfile',
          'contextLimits',
          'conditions',
        ],
        properties: {
          modelFamily: { type: 'string', pattern: MODEL_FAMILY_PATTERN },
          modelId: { type: 'string', pattern: MODEL_ID_PATTERN },
          modelRevision: { type: 'string', pattern: MODEL_REVISION_PATTERN },
          modalityProfile: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: MODALITIES },
          },
          toolCallingProfile: { enum: TOOL_CALLING_LEVELS },
          contextLimits: { $ref: '#/$defs/contextLimits' },
          conditions: { type: 'array', uniqueItems: true, items: { enum: CONDITIONS } },
        },
        $defs: { contextLimits: contextLimitsDef },
      };
    },
  },
  {
    id: 'model-substrate/substrate-record',
    output: 'contracts/model-substrate/substrate-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('substrate-record'),
        title: 'Arena substrate record (CognitiveSubstrate shape) v1',
        description:
          'The substrate record materialized by SubstrateAdapter.registerSubstrate — EXACTLY the ' +
          '@arena/agent-body CognitiveSubstrate shape (spec AB1.0, all eight identified items; parity with ' +
          'contracts/agent-body/cognitive-substrate.v1.json is asserted by the package parity suite). The ' +
          'integrity digest is sha256 over the canonical digest-free view. A substrate is distinct from an ' +
          'Agent Body (lock rule 2) and never carries provider details (lock rule 10).',
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
          recordVersion: { const: 1 },
          adapterId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          adapterVersion: { type: 'string', pattern: VERSION_PATTERN },
          modelFamily: { type: 'string', pattern: MODEL_FAMILY_PATTERN },
          modelId: { type: 'string', pattern: MODEL_ID_PATTERN },
          modelRevision: { type: 'string', pattern: MODEL_REVISION_PATTERN },
          modalityProfile: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: MODALITIES },
          },
          toolCallingProfile: { enum: TOOL_CALLING_LEVELS },
          contextLimits: { $ref: '#/$defs/contextLimits' },
          conditions: { type: 'array', uniqueItems: true, items: { enum: CONDITIONS } },
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
        $defs: { contextLimits: contextLimitsDef },
      };
    },
  },
  {
    id: 'model-substrate/capability-profile',
    output: 'contracts/model-substrate/capability-profile.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('capability-profile'),
        title: 'Arena substrate capability profile v1',
        description:
          "The modality / tool-calling / context profile reported by SubstrateAdapter.probeCapabilities() — " +
          "the adapter's current envelope in neutral terms (what it can register/probe right now).",
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'modalityProfile',
          'toolCallingProfile',
          'contextLimits',
          'conditions',
        ],
        properties: {
          recordVersion: { const: 1 },
          modalityProfile: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { enum: MODALITIES },
          },
          toolCallingProfile: { enum: TOOL_CALLING_LEVELS },
          contextLimits: { $ref: '#/$defs/contextLimits' },
          conditions: { type: 'array', uniqueItems: true, items: { enum: CONDITIONS } },
        },
        $defs: { contextLimits: contextLimitsDef },
      };
    },
  },
  {
    id: 'model-substrate/adapter-health',
    output: 'contracts/model-substrate/adapter-health.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('adapter-health'),
        title: 'Arena adapter health report v1',
        description:
          "Health/integrity report produced by SubstrateAdapter.reportHealth(): current status (closed " +
          "vocabulary), the UTC millisecond check time, the content digest of the descriptor the report was " +
          "produced for, and the result of the adapter's integrity self-check. integrityVerified=false is a " +
          "well-formed report of a FAILED self-check (fail-closed reporting, not a schema violation).",
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'status',
          'checkedAt',
          'descriptorDigest',
          'integrityVerified',
        ],
        properties: {
          recordVersion: { const: 1 },
          status: { enum: HEALTH_STATUSES },
          checkedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          descriptorDigest: { type: 'string', pattern: DIGEST_PATTERN },
          integrityVerified: { type: 'boolean' },
        },
      };
    },
  },
  {
    id: 'model-substrate/substrate-registration',
    output: 'contracts/model-substrate/substrate-registration.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('substrate-registration'),
        title: 'Arena substrate registration record v1',
        description:
          'Append-only registration record of the SubstrateRegistry: binds a neutral substrate id to a ' +
          'substrate (by content digest) and the adapter descriptor that registered it. Re-registering the ' +
          'same digest under the same id with the same adapter is idempotent; a different descriptor under ' +
          'the same neutral id is a conflict (rejected). The registrationDigest is sha256 over the canonical ' +
          'digest-free view (recordVersion, substrateId, substrateDigest, adapterDigest, registeredAt).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'substrateId',
          'substrate',
          'adapterDescriptor',
          'registeredAt',
          'registrationDigest',
        ],
        properties: {
          recordVersion: { const: 1 },
          substrateId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          substrate: { $ref: 'substrate-record.v1.json' },
          adapterDescriptor: { $ref: 'adapter-descriptor.v1.json' },
          registeredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
          registrationDigest: { type: 'string', pattern: DIGEST_PATTERN },
        },
      };
    },
  },
  {
    id: 'model-substrate/substrate-registry',
    output: 'contracts/model-substrate/substrate-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('substrate-registry'),
        title: 'Arena substrate registry snapshot v1',
        description:
          'An append-only snapshot of substrate registration records, in registration order. The in-memory ' +
          'registry is protocol-level; durable ledgers are owned by services.',
        type: 'array',
        uniqueItems: true,
        items: { $ref: 'substrate-registration.v1.json' },
      };
    },
  },
  {
    id: 'model-substrate/compatibility-test',
    output: 'contracts/model-substrate/compatibility-test.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('compatibility-test'),
        title: 'Arena substrate compatibility test v1',
        description:
          'SubstrateCompatibilityTest descriptor: binds a BodyVersion reference + a substrate reference (by ' +
          'content digest) + the profile requirements asserted (required modalities, minimum tool-calling ' +
          'level, minimum context units, prohibited substrate conditions). Pure data contract — the ' +
          'compatibility ENGINE is A022. No field may assert a substrate/model ≡ body identity alias ' +
          '(rejected at construction; spec AB1.0 hard rule).',
        type: 'object',
        additionalProperties: false,
        required: ['recordVersion', 'testId', 'bodyVersion', 'substrateDigest', 'spec'],
        properties: {
          recordVersion: { const: 1 },
          testId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          bodyVersion: { $ref: '#/$defs/bodyVersionRef' },
          substrateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          spec: {
            type: 'object',
            additionalProperties: false,
            required: [
              'requiredModalities',
              'requiredToolCalling',
              'minContextUnits',
              'prohibitedConditions',
            ],
            properties: {
              requiredModalities: {
                type: 'array',
                minItems: 1,
                uniqueItems: true,
                items: { enum: MODALITIES },
              },
              requiredToolCalling: { enum: TOOL_CALLING_LEVELS },
              minContextUnits: { type: 'integer', minimum: 1, maximum: UNITS_LIMIT },
              prohibitedConditions: {
                type: 'array',
                uniqueItems: true,
                items: { enum: CONDITIONS },
              },
            },
          },
        },
        $defs: { bodyVersionRef: bodyVersionRefDef },
      };
    },
  },
  {
    id: 'model-substrate/compatibility-result',
    output: 'contracts/model-substrate/compatibility-result.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('compatibility-result'),
        title: 'Arena substrate compatibility result v1',
        description:
          'Typed RESULT record of a substrate compatibility test: outcome (pass / fail / inconclusive — no ' +
          '"equivalent" verdict exists), reasons (pass carries none; fail/inconclusive carry at least one) and ' +
          "content-addressed evidence references. Pure result typing — the DECISION logic is A022's engine.",
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'testId',
          'bodyVersionDigest',
          'substrateDigest',
          'outcome',
          'reasons',
          'evidenceRefs',
        ],
        properties: {
          recordVersion: { const: 1 },
          testId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          bodyVersionDigest: { type: 'string', pattern: DIGEST_PATTERN },
          substrateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          outcome: { enum: OUTCOMES },
          reasons: { type: 'array', items: { type: 'string', minLength: 1 } },
          evidenceRefs: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
        },
        $defs: { versionedArtifactRef: versionedArtifactRefDef },
      };
    },
  },
  {
    id: 'model-substrate/substrate-upgrade',
    output: 'contracts/model-substrate/substrate-upgrade.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('substrate-upgrade'),
        title: 'Arena substrate upgrade v1',
        description:
          'SubstrateUpgrade declaration (requirement R45): old substrate digest → new substrate digest, with ' +
          'recertification REQUIRED — the field is the literal true, so no value of this shape can claim a ' +
          'recertification-free upgrade. An upgrade NEVER silently rebinds a Possession: the closed property ' +
          'set admits no possession-shaped field (a new Possession version is required — enforced at ' +
          'construction with MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN). Adaptation artifacts are ' +
          'content-addressed (lock rule 22).',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'upgradeId',
          'fromSubstrateDigest',
          'toSubstrateDigest',
          'recertificationRequired',
          'adaptations',
          'declaredAt',
        ],
        properties: {
          recordVersion: { const: 1 },
          upgradeId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          fromSubstrateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          toSubstrateDigest: { type: 'string', pattern: DIGEST_PATTERN },
          recertificationRequired: { const: true },
          adaptations: { type: 'array', items: { $ref: '#/$defs/versionedArtifactRef' } },
          declaredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
        $defs: { versionedArtifactRef: versionedArtifactRefDef },
      };
    },
  },
  {
    id: 'model-substrate/model-substrate-error',
    output: 'contracts/model-substrate/model-substrate-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('model-substrate-error'),
        title: 'Arena ModelSubstrateError v1',
        description:
          'Structured, serializable form of the model substrate error taxonomy. Unknown codes are rejected ' +
          'when parsing (MODEL_SUBSTRATE_UNKNOWN_ERROR).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context.' },
          correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
        },
      };
    },
  },
  {
    id: 'model-substrate/register-substrate-command',
    output: 'contracts/model-substrate/register-substrate-command.v1.json',
    build() {
      return commandContract('register-substrate-command', {
        description:
          'Command payload: append a substrate registration to the registry (idempotent per substrate digest + ' +
          'neutral id + adapter descriptor; conflicting re-use of a neutral id is rejected). Travels inside an ' +
          'Envelope with a REQUIRED non-null idempotency key (architecture-lock rule 17).',
        required: ['registration'],
        properties: { registration: { $ref: 'substrate-registration.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/declare-substrate-upgrade-command',
    output: 'contracts/model-substrate/declare-substrate-upgrade-command.v1.json',
    build() {
      return commandContract('declare-substrate-upgrade-command', {
        description:
          'Command payload: declare a substrate upgrade (old digest → new digest, recertification required). ' +
          'The upgrade never rebinds a Possession — a new possession version must be created explicitly. ' +
          'Travels inside an Envelope with a REQUIRED non-null idempotency key (lock rule 17).',
        required: ['upgrade'],
        properties: { upgrade: { $ref: 'substrate-upgrade.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/record-compatibility-result-command',
    output: 'contracts/model-substrate/record-compatibility-result-command.v1.json',
    build() {
      return commandContract('record-compatibility-result-command', {
        description:
          'Command payload: record a substrate compatibility result (typed outcome + evidence refs; the ' +
          'decision is made by the A022 engine, never by this payload). Travels inside an Envelope with a ' +
          'REQUIRED non-null idempotency key (lock rule 17).',
        required: ['result'],
        properties: { result: { $ref: 'compatibility-result.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/substrate-registered-event',
    output: 'contracts/model-substrate/substrate-registered-event.v1.json',
    build() {
      return eventContract('substrate-registered-event', {
        description:
          'Event payload: a substrate registration was appended (register-substrate succeeded, or was an ' +
          'idempotent replay). Travels inside an Envelope; idempotency key null.',
        required: ['registration'],
        properties: { registration: { $ref: 'substrate-registration.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/substrate-upgrade-declared-event',
    output: 'contracts/model-substrate/substrate-upgrade-declared-event.v1.json',
    build() {
      return eventContract('substrate-upgrade-declared-event', {
        description:
          'Event payload: a substrate upgrade was declared (declare-substrate-upgrade succeeded). Travels ' +
          'inside an Envelope; idempotency key null.',
        required: ['upgrade'],
        properties: { upgrade: { $ref: 'substrate-upgrade.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/compatibility-result-recorded-event',
    output: 'contracts/model-substrate/compatibility-result-recorded-event.v1.json',
    build() {
      return eventContract('compatibility-result-recorded-event', {
        description:
          'Event payload: a substrate compatibility result was recorded. Travels inside an Envelope; ' +
          'idempotency key null.',
        required: ['result'],
        properties: { result: { $ref: 'compatibility-result.v1.json' } },
      });
    },
  },
  {
    id: 'model-substrate/schema-registry',
    output: 'contracts/model-substrate/model-substrate-schema-registry.v1.json',
    build() {
      const names = [
        'adapter-descriptor',
        'substrate-registration-descriptor',
        'substrate-record',
        'capability-profile',
        'adapter-health',
        'substrate-registration',
        'substrate-registry',
        'compatibility-test',
        'compatibility-result',
        'substrate-upgrade',
        'model-substrate-error',
        'register-substrate-command',
        'declare-substrate-upgrade-command',
        'record-compatibility-result-command',
        'substrate-registered-event',
        'substrate-upgrade-declared-event',
        'compatibility-result-recorded-event',
        'schema-registry',
      ];
      return {
        $schema: DRAFT,
        $id: ref('schema-registry'),
        title: 'Arena model-substrate schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/model-substrate. A SchemaRef matching this enum is a known ' +
          'model-substrate schema at the listed version; anything else is not.',
        type: 'string',
        enum: names.map((name) => `arena:schema/model-substrate/${name}@${SCHEMA_VERSION}`),
      };
    },
  },
];

function commandContract(name, { description, required, properties }) {
  return {
    $schema: DRAFT,
    $id: ref(name),
    title: `Arena ${name} v1`,
    description: `${description} Payload schema only — the envelope wire shape is arena:schema/protocol/envelope@1.0.`,
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function eventContract(name, { description, required, properties }) {
  return commandContract(name, { description, required, properties });
}

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

function serializeDeterministic(value) {
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
  const tempDir = join(tmpdir(), `arena-model-substrate-contracts-${process.pid}-${Date.now()}`);
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

    // Extra-file check is scoped to the committed contract directory (the
    // parent of the declared outputs) — never the whole tree.
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
        '[contracts] run: node packages/model-substrate/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add <contract files>');
}

main();
