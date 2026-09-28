#!/usr/bin/env node
/**
 * Arena environment-runtime contract generator (Work Order A010).
 *
 * Follows the A001 generated-contracts convention
 * (scripts/generate-contracts.mjs) and the A002/A009 package-level
 * convention (packages/<name>/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id,
 *     repo-relative output path, builder). This generator owns the A010
 *     surfaces ONLY — it emits every schema for
 *     @arena/environment-runtime.
 *   - PLACEMENT NOTE (Work Order A010 §5): the repository-root
 *     contracts/environment-runtime/ directory is NOT part of this
 *     work order's owned surfaces, so the generated contracts ship as
 *     PACKAGE-LOCAL artifacts under packages/environment-runtime/
 *     contracts/. Moving them to the repository root (plus the root
 *     generate-contracts.mjs intake) is a Tech Lead wiring step.
 *   - Generated files are committed, deterministic (sorted keys,
 *     2-space indent, trailing newline) and carry a versioned SchemaRef
 *     $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and
 *     exits non-zero. The drift suite (src/drift.test.ts) runs this
 *     check as part of `pnpm test`, the package script `contracts:check`
 *     runs it directly, and the governance G9 check auto-discovers this
 *     generator through its packages/.../generate-contracts.mjs glob
 *     (the root manifest itself needs no edit — the A002 merge
 *     generalized G9 to run every package-level generator; services/*
 *     generators are NOT globbed by G9 today — noted in the A010
 *     report).
 *   - The deterministic serializer is duplicated from the A001
 *     generator (10 lines) instead of imported, because importing that
 *     module executes its CLI main() as an import side effect.
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
// Shared protocol constants — MUST match packages/environment-runtime/src
// (parity is asserted by src/contracts.parity.test.ts).
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = '1.0.0';

const TENANT_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const RUN_KEY_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const RUN_ID_PATTERN = '^[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,63}$';
const CONTENT_DIGEST_PATTERN = '^[0-9a-f]{64}$';
const RUN_TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const SEED_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const JOB_REF_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const HOSTNAME_PATTERN =
  '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$';
const MOUNT_PATH_PATTERN = '^/(?:[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*)?$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const TASK_VERSION_PATTERN = '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$';

const RUN_STATES = [
  'requested',
  'provisioning',
  'ready',
  'running',
  'checkpointing',
  'completed',
  'failed',
  'timed-out',
  'cleaned',
];
const RUN_LIFECYCLE_EVENTS = [
  'provision-started',
  'provisioned',
  'started',
  'checkpoint-started',
  'checkpoint-completed',
  'completed',
  'failed',
  'timed-out',
  'cleaned',
];
const EGRESS_PROTOCOLS = ['tcp', 'udp', 'http', 'https'];
const MOUNT_ACCESS_MODES = ['read-only', 'read-write'];
const MOUNT_SOURCES = ['initial-state', 'ephemeral', 'workspace', 'evidence'];
const FILESYSTEM_WRITE_MODES = ['read-only', 'declared-mounts-only'];
const SECRET_INJECTION_MECHANISMS = ['environment-binding', 'file-mount', 'stream'];
const ERROR_CATEGORIES = ['validation', 'encoding', 'versioning', 'integrity', 'unknown'];
const ERROR_CODES = [
  'ENVIRONMENT_RUNTIME_ADMISSION_REJECTED',
  'ENVIRONMENT_RUNTIME_CHECKPOINT_REJECTED',
  'ENVIRONMENT_RUNTIME_CREDENTIAL_REJECTED',
  'ENVIRONMENT_RUNTIME_EVENT_OUT_OF_ORDER',
  'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_DUPLICATE',
  'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_GAP',
  'ENVIRONMENT_RUNTIME_IDENTITY_CONFLICT',
  'ENVIRONMENT_RUNTIME_ILLEGAL_TRANSITION',
  'ENVIRONMENT_RUNTIME_INVALID_ADMISSION_VIEW',
  'ENVIRONMENT_RUNTIME_INVALID_CHECKPOINT',
  'ENVIRONMENT_RUNTIME_INVALID_ENVIRONMENT_REF',
  'ENVIRONMENT_RUNTIME_INVALID_EVENT',
  'ENVIRONMENT_RUNTIME_INVALID_FILESYSTEM_ENVELOPE',
  'ENVIRONMENT_RUNTIME_INVALID_JOB_REF',
  'ENVIRONMENT_RUNTIME_INVALID_NETWORK_ENVELOPE',
  'ENVIRONMENT_RUNTIME_INVALID_RECORD',
  'ENVIRONMENT_RUNTIME_INVALID_RESOURCE_ENVELOPE',
  'ENVIRONMENT_RUNTIME_INVALID_RUN_ID',
  'ENVIRONMENT_RUNTIME_INVALID_RUN_RESULT',
  'ENVIRONMENT_RUNTIME_INVALID_SECRET_ENVELOPE',
  'ENVIRONMENT_RUNTIME_INVALID_SEED',
  'ENVIRONMENT_RUNTIME_INVALID_SNAPSHOT_DIGEST',
  'ENVIRONMENT_RUNTIME_INVALID_TENANT',
  'ENVIRONMENT_RUNTIME_INVALID_TIMESTAMP',
  'ENVIRONMENT_RUNTIME_RUNTIME_LEAKAGE',
  'ENVIRONMENT_RUNTIME_RUN_RESULT_INCOMPLETE',
  'ENVIRONMENT_RUNTIME_TAMPERED',
  'ENVIRONMENT_RUNTIME_TENANT_ISOLATION_VIOLATION',
  'ENVIRONMENT_RUNTIME_TIME_LIMIT_EXCEEDED',
  'ENVIRONMENT_RUNTIME_UNKNOWN_ERROR',
];
const SCHEMA_NAMES = [
  'run-record',
  'run-state',
  'runtime-error',
  'run-checkpoint',
  'admission-decision',
  'run-result',
  'environment-event-log',
  'schema-registry',
  'run-submitted-event',
  'admission-decided-event',
  'state-transitioned-event',
  'workload-progressed-event',
  'checkpoint-recorded-event',
  'checkpoint-restored-event',
  'run-result-produced-event',
  'submit-run-command',
  'start-run-command',
  'advance-run-command',
  'checkpoint-run-command',
  'restore-run-command',
  'complete-run-command',
  'fail-run-command',
  'cleanup-run-command',
];

const ref = (name) => `arena:schema/environment-runtime/${name}@${SCHEMA_VERSION}`;
const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const digestSchema = { type: 'string', pattern: CONTENT_DIGEST_PATTERN };
const timestampSchema = { type: 'string', pattern: RUN_TIMESTAMP_PATTERN };
const runIdSchema = { type: 'string', pattern: RUN_ID_PATTERN };
const tenantSchema = { type: 'string', pattern: TENANT_PATTERN };
const positiveInteger = { type: 'integer', minimum: 1 };

function eventCommon() {
  return {
    eventVersion: { const: 1, description: 'Runtime event wire version.' },
    sequence: { ...positiveInteger, description: '1-based monotonic sequence within this run stream.' },
    occurredAt: { ...timestampSchema, description: 'Canonical ms-UTC occurrence timestamp.' },
    runId: { ...runIdSchema, description: 'The tenant-scoped run this event belongs to.' },
    tenantId: { ...tenantSchema, description: 'The owning tenant (tenant-scoped streams).' },
  };
}

function runTargetedCommand(extra) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['runId', 'tenantId', ...Object.keys(extra)],
    properties: {
      runId: { ...runIdSchema, description: 'The tenant-scoped run the command addresses.' },
      tenantId: { ...tenantSchema, description: 'The issuing tenant — must own the run (R29).' },
      ...extra,
    },
  };
}

function environmentVersionRefSchema(description) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['namespace', 'name', 'version', 'digest'],
    properties: {
      namespace: { type: 'string', pattern: NAMESPACE_PATTERN },
      name: { type: 'string', pattern: NAME_PATTERN },
      version: { type: 'string', pattern: SEMVER_PATTERN },
      digest: digestSchema,
    },
    description,
  };
}

function egressAllowSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['host', 'port', 'protocol'],
      properties: {
        host: { type: 'string', pattern: HOSTNAME_PATTERN },
        port: { type: 'integer', minimum: 1, maximum: 65535 },
        protocol: { enum: EGRESS_PROTOCOLS },
      },
    },
  };
}

function mountSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['mountPath', 'access', 'source'],
      properties: {
        mountPath: { type: 'string', pattern: MOUNT_PATH_PATTERN },
        access: { enum: MOUNT_ACCESS_MODES },
        source: { enum: MOUNT_SOURCES },
      },
    },
  };
}

function injectionPointSchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['secretId', 'mountPath', 'mechanism'],
      properties: {
        secretId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
        mountPath: { type: 'string', pattern: MOUNT_PATH_PATTERN },
        mechanism: { enum: SECRET_INJECTION_MECHANISMS },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Contract manifest — every schema owned by @arena/environment-runtime.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  // ----- data schemas -----------------------------------------------------
  {
    id: 'environment-runtime/run-record',
    output: 'packages/environment-runtime/contracts/run-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-record'),
        title: 'Arena environment-runtime RunRecord v1',
        description:
          'The content-addressed declaration of an environment run: tenant-scoped run id, content-addressed environment ref (A009 EnvironmentVersionRef), A015 job reference, initial snapshot digest, deterministic seed, submitted-at timestamp and the isolation envelope (A009 ResourceLimits / NetworkPolicy / FilesystemPolicy / SecretPolicy). The digest is sha256 over the canonical serialization of the digest-free view; same inputs produce the same digest, any change produces a new one.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'runId',
          'tenantId',
          'environment',
          'jobRef',
          'initialSnapshotDigest',
          'seed',
          'submittedAt',
          'resourceEnvelope',
          'networkEnvelope',
          'filesystemEnvelope',
          'secretEnvelope',
          'digest',
        ],
        properties: {
          recordVersion: { const: 1, description: 'Run record wire version.' },
          runId: { ...runIdSchema, description: 'Tenant-scoped run id (<tenant>/<run-key>) — the tenant is part of the address and of the digest.' },
          tenantId: { ...tenantSchema, description: 'The owning tenant; must equal the run id tenant half.' },
          environment: environmentVersionRefSchema('A009 EnvironmentVersionRef — the executable world pinned by content digest.'),
          jobRef: { type: 'string', pattern: JOB_REF_PATTERN, description: 'A015 job id whose workload this run executes.' },
          initialSnapshotDigest: { ...digestSchema, description: 'Digest of the initial state snapshot the run starts from.' },
          seed: {
            oneOf: [{ type: 'null' }, { type: 'string', pattern: SEED_PATTERN }],
            description: 'The deterministic seed (null when the environment admits none).',
          },
          submittedAt: { ...timestampSchema, description: 'Canonical ms-UTC submission timestamp.' },
          resourceEnvelope: {
            type: 'object',
            additionalProperties: false,
            required: ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
            properties: {
              cpuMillis: positiveInteger,
              memoryMiB: positiveInteger,
              wallClockSeconds: positiveInteger,
            },
            description: 'A009 ResourceLimits — the declared resource envelope (must fit the environment bound).',
          },
          networkEnvelope: {
            type: 'object',
            additionalProperties: false,
            required: ['egress', 'allows'],
            properties: {
              egress: { const: 'default-deny' },
              allows: egressAllowSchema(),
            },
            description: 'A009 NetworkPolicy — default-deny egress with explicit allows only.',
          },
          filesystemEnvelope: {
            type: 'object',
            additionalProperties: false,
            required: ['writeMode', 'mounts'],
            properties: {
              writeMode: { enum: FILESYSTEM_WRITE_MODES },
              mounts: mountSchema(),
            },
            description: 'A009 FilesystemPolicy — explicit mounts only; no blanket write mode exists.',
          },
          secretEnvelope: {
            type: 'object',
            additionalProperties: false,
            required: ['isolation', 'injectionPoints'],
            properties: {
              isolation: { const: 'isolation-boundary' },
              injectionPoints: injectionPointSchema(),
            },
            description: 'A009 SecretPolicy — reference-only injection points; secret VALUES never enter canonical objects.',
          },
          digest: { ...digestSchema, description: 'sha256 over the canonical serialization of the digest-free view.' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/run-state',
    output: 'packages/environment-runtime/contracts/run-state.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-state'),
        title: 'Arena environment-runtime RunStateSnapshot v1',
        description:
          'The event-sourced projection of a run current world: lifecycle status, transition/applied-event counters, world position (step + simulated elapsed), recorded checkpoint chain and the produced result digest. Snapshots are pure folds over the EnvironmentEventLog and are verified by replay.',
        type: 'object',
        additionalProperties: false,
        required: [
          'stateVersion',
          'runId',
          'tenantId',
          'recordDigest',
          'status',
          'transitions',
          'appliedEvents',
          'lastEventAt',
          'enteredStatusAt',
          'admitted',
          'worldStep',
          'worldElapsedMs',
          'checkpoints',
          'restoredToCheckpoint',
          'resultDigest',
        ],
        properties: {
          stateVersion: { const: 1 },
          runId: runIdSchema,
          tenantId: tenantSchema,
          recordDigest: digestSchema,
          status: { enum: RUN_STATES, description: 'Current lifecycle status (gate 3 state machine).' },
          transitions: { type: 'integer', minimum: 0 },
          appliedEvents: { type: 'integer', minimum: 0, description: 'Sequence of the last applied event.' },
          lastEventAt: timestampSchema,
          enteredStatusAt: timestampSchema,
          admitted: {
            oneOf: [{ type: 'null' }, { type: 'boolean' }],
            description: 'Admission outcome (null = not decided yet).',
          },
          worldStep: { type: 'integer', minimum: 0, description: 'World position: workload steps taken (0 = initial snapshot).' },
          worldElapsedMs: { type: 'integer', minimum: 0, description: 'Simulated elapsed workload milliseconds.' },
          checkpoints: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sequence', 'snapshotDigest', 'stepIndex', 'recordedAt'],
              properties: {
                sequence: positiveInteger,
                snapshotDigest: digestSchema,
                stepIndex: { type: 'integer', minimum: 0 },
                recordedAt: timestampSchema,
              },
            },
          },
          restoredToCheckpoint: {
            oneOf: [{ type: 'null' }, positiveInteger],
            description: 'Sequence of the checkpoint the world was last restored to.',
          },
          resultDigest: { oneOf: [{ type: 'null' }, digestSchema] },
        },
      };
    },
  },
  {
    id: 'environment-runtime/runtime-error',
    output: 'packages/environment-runtime/contracts/runtime-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('runtime-error'),
        title: 'Arena EnvironmentRuntimeError v1',
        description:
          'Structured, serializable form of the environment-runtime error taxonomy. Unknown codes are rejected when parsing (ENVIRONMENT_RUNTIME_UNKNOWN_ERROR). Illegal lifecycle transitions carry the offending from/to states in details.',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object', description: 'Structured, JSON-serializable context (e.g. from/to states).' },
          correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/run-checkpoint',
    output: 'packages/environment-runtime/contracts/run-checkpoint.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-checkpoint'),
        title: 'Arena environment-runtime RunCheckpoint v1',
        description:
          'A content-addressed checkpoint of a run world: snapshot digest, per-run sequence number, world step index and recorded-at timestamp. Restore validates the ref chain — a foreign run checkpoint can never restore this run world.',
        type: 'object',
        additionalProperties: false,
        required: [
          'checkpointVersion',
          'runId',
          'tenantId',
          'sequence',
          'snapshotDigest',
          'stepIndex',
          'recordedAt',
          'digest',
        ],
        properties: {
          checkpointVersion: { const: 1 },
          runId: runIdSchema,
          tenantId: tenantSchema,
          sequence: { ...positiveInteger, description: '1-based, contiguous per run.' },
          snapshotDigest: { ...digestSchema, description: 'Content address of the snapshotted world state.' },
          stepIndex: { type: 'integer', minimum: 0, description: 'World position captured by the snapshot.' },
          recordedAt: timestampSchema,
          digest: { ...digestSchema, description: 'sha256 over the canonical serialization of the digest-free view.' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/admission-decision',
    output: 'packages/environment-runtime/contracts/admission-decision.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('admission-decision'),
        title: 'Arena environment-runtime AdmissionDecision v1',
        description:
          'The pure outcome of an admission check: a run is admitted only if its declared isolation envelope (A009 policy types) fits the target environment bounds; every least-privilege / quota violation is enumerated.',
        type: 'object',
        additionalProperties: false,
        required: ['admitted', 'violations'],
        properties: {
          admitted: { type: 'boolean', description: 'True exactly when violations is empty.' },
          violations: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
            description: 'Every quota / least-privilege violation (empty when admitted).',
          },
        },
      };
    },
  },
  {
    id: 'environment-runtime/run-result',
    output: 'packages/environment-runtime/contracts/run-result.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-result'),
        title: 'Arena environment-runtime RunResult v1',
        description:
          'The evidence-addressable outcome of a COMPLETED run, binding A009 RunAddress (task version, environment version, run id, initial snapshot digest, trajectory digest, evidence digests — ALL required; a missing digest fails construction).',
        type: 'object',
        additionalProperties: false,
        required: [
          'resultVersion',
          'runId',
          'tenantId',
          'recordDigest',
          'finalState',
          'finishedAt',
          'runAddress',
          'digest',
        ],
        properties: {
          resultVersion: { const: 1 },
          runId: runIdSchema,
          tenantId: tenantSchema,
          recordDigest: digestSchema,
          finalState: { const: 'completed', description: 'Only completed runs produce results.' },
          finishedAt: timestampSchema,
          runAddress: {
            type: 'object',
            additionalProperties: false,
            required: [
              'taskVersion',
              'environmentVersion',
              'runId',
              'initialSnapshotDigest',
              'trajectoryDigest',
              'evidenceDigests',
            ],
            properties: {
              taskVersion: {
                type: 'object',
                additionalProperties: false,
                required: ['taskId', 'version'],
                properties: {
                  taskId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
                  version: { type: 'string', pattern: TASK_VERSION_PATTERN },
                },
              },
              environmentVersion: environmentVersionRefSchema('The content-addressed environment version the run executed.'),
              runId: { type: 'string', pattern: NEUTRAL_ID_PATTERN, description: 'The tenant-LOCAL run key (A009 neutral id).' },
              initialSnapshotDigest: digestSchema,
              trajectoryDigest: digestSchema,
              evidenceDigests: {
                type: 'array',
                minItems: 1,
                items: digestSchema,
                description: 'Digests of every produced evidence output (>= 1).',
              },
            },
            description: 'A009 RunAddress — the full evidence address of the run.',
          },
          digest: { ...digestSchema, description: 'sha256 over the canonical serialization of the digest-free view.' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/environment-event-log',
    output: 'packages/environment-runtime/contracts/environment-event-log.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('environment-event-log'),
        title: 'Arena environment-runtime EnvironmentEventLog v1',
        description:
          'The structured, append-only, cross-run event log: every lifecycle transition, admission decision, checkpoint record, workload step and cleanup as an Envelope<RuntimeEvent>. Per-run sequences are contiguous 1..n; kinds follow the closed adjacency; timestamps are monotonic per run; nothing may follow a cleaned run.',
        type: 'object',
        additionalProperties: false,
        required: ['entries'],
        properties: {
          entries: {
            type: 'array',
            description: 'Envelope<RuntimeEvent> wire forms, append order.',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['v', 'kind', 'schema', 'id', 'correlationId', 'idempotencyKey', 'issuedAt', 'payload'],
              properties: {
                v: { const: 1 },
                kind: { const: 'event' },
                schema: {
                  type: 'string',
                  pattern: '^arena:schema/environment-runtime/[a-z][a-z0-9-]*@1\\.0\\.0$',
                },
                id: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' },
                correlationId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
                idempotencyKey: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
                issuedAt: { type: 'string', format: 'date-time' },
                payload: { description: 'A RuntimeEvent payload (one of the event schemas).' },
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-runtime/schema-registry',
    output: 'packages/environment-runtime/contracts/schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('schema-registry'),
        title: 'Arena environment-runtime schema registry v1',
        description:
          'Enumerates the schemas defined by @arena/environment-runtime. A SchemaRef matching this enum is a known environment-runtime schema at the listed version; anything else is not.',
        type: 'string',
        enum: SCHEMA_NAMES.map((name) => ref(name)),
      };
    },
  },
  // ----- event payload schemas --------------------------------------------
  {
    id: 'environment-runtime/run-submitted-event',
    output: 'packages/environment-runtime/contracts/run-submitted-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-submitted-event'),
        title: 'Arena environment-runtime run-submitted event v1',
        description: 'The first event of every run stream: the content-addressed run record was created.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'recordDigest', 'jobRef', 'seed'],
        properties: {
          ...eventCommon(),
          kind: { const: 'run-submitted' },
          recordDigest: digestSchema,
          jobRef: { type: 'string', pattern: JOB_REF_PATTERN },
          seed: { oneOf: [{ type: 'null' }, { type: 'string', pattern: SEED_PATTERN }] },
        },
      };
    },
  },
  {
    id: 'environment-runtime/admission-decided-event',
    output: 'packages/environment-runtime/contracts/admission-decided-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('admission-decided-event'),
        title: 'Arena environment-runtime admission-decided event v1',
        description: 'The admission check outcome (fit / enumerated violations) — the observability artifact of gate 5.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'admitted', 'violations'],
        properties: {
          ...eventCommon(),
          kind: { const: 'admission-decided' },
          admitted: { type: 'boolean' },
          violations: { type: 'array', items: { type: 'string' } },
        },
      };
    },
  },
  {
    id: 'environment-runtime/state-transitioned-event',
    output: 'packages/environment-runtime/contracts/state-transitioned-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('state-transitioned-event'),
        title: 'Arena environment-runtime state-transitioned event v1',
        description:
          'Every lifecycle transition (requested to provisioning to ready to running, checkpointing loops, outcome states, cleanup) with the driving lifecycle event and optional reason.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'from', 'to', 'lifecycleEvent'],
        properties: {
          ...eventCommon(),
          kind: { const: 'state-transitioned' },
          from: { enum: RUN_STATES },
          to: { enum: RUN_STATES },
          lifecycleEvent: { enum: RUN_LIFECYCLE_EVENTS },
          reason: { type: 'string', description: 'Optional human-readable reason (e.g. wall-clock exhausted).' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/workload-progressed-event',
    output: 'packages/environment-runtime/contracts/workload-progressed-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('workload-progressed-event'),
        title: 'Arena environment-runtime workload-progressed event v1',
        description: 'One deterministic (seeded-LCG) simulated workload step with its cumulative simulated elapsed time.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'step', 'simulatedElapsedMs'],
        properties: {
          ...eventCommon(),
          kind: { const: 'workload-progressed' },
          step: positiveInteger,
          simulatedElapsedMs: { type: 'integer', minimum: 0 },
          note: { type: 'string' },
        },
      };
    },
  },
  {
    id: 'environment-runtime/checkpoint-recorded-event',
    output: 'packages/environment-runtime/contracts/checkpoint-recorded-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('checkpoint-recorded-event'),
        title: 'Arena environment-runtime checkpoint-recorded event v1',
        description: 'A checkpoint was taken while the run was executing: per-run sequence, snapshot digest and world step.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'checkpointSequence', 'snapshotDigest', 'stepIndex'],
        properties: {
          ...eventCommon(),
          kind: { const: 'checkpoint-recorded' },
          checkpointSequence: positiveInteger,
          snapshotDigest: digestSchema,
          stepIndex: { type: 'integer', minimum: 0 },
        },
      };
    },
  },
  {
    id: 'environment-runtime/checkpoint-restored-event',
    output: 'packages/environment-runtime/contracts/checkpoint-restored-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('checkpoint-restored-event'),
        title: 'Arena environment-runtime checkpoint-restored event v1',
        description: 'The world was reset to a recorded checkpoint of THIS run (validated ref chain) and continues from the restored world position.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'checkpointSequence', 'snapshotDigest', 'restoredStepIndex'],
        properties: {
          ...eventCommon(),
          kind: { const: 'checkpoint-restored' },
          checkpointSequence: positiveInteger,
          snapshotDigest: digestSchema,
          restoredStepIndex: { type: 'integer', minimum: 0 },
        },
      };
    },
  },
  {
    id: 'environment-runtime/run-result-produced-event',
    output: 'packages/environment-runtime/contracts/run-result-produced-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('run-result-produced-event'),
        title: 'Arena environment-runtime run-result-produced event v1',
        description: 'A completed run produced its content-addressed RunResult binding the A009 RunAddress evidence digests.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'runId', 'tenantId', 'kind', 'resultDigest', 'trajectoryDigest', 'evidenceDigests'],
        properties: {
          ...eventCommon(),
          kind: { const: 'run-result-produced' },
          resultDigest: digestSchema,
          trajectoryDigest: digestSchema,
          evidenceDigests: { type: 'array', minItems: 1, items: digestSchema },
        },
      };
    },
  },
  // ----- command payload schemas -------------------------------------------
  {
    id: 'environment-runtime/submit-run-command',
    output: 'packages/environment-runtime/contracts/submit-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('submit-run-command'),
        title: 'Arena environment-runtime submit-run command v1',
        description:
          'Orchestrator to runner command: declare and admit a run. The command envelope requires a non-null idempotency key (lock rule 17); re-submission with the same key and record digest is idempotent.',
        type: 'object',
        additionalProperties: false,
        required: ['declaration'],
        properties: {
          declaration: {
            type: 'object',
            additionalProperties: false,
            required: [
              'runKey',
              'tenantId',
              'environment',
              'jobRef',
              'taskVersion',
              'initialSnapshotDigest',
              'seed',
              'resourceEnvelope',
              'networkEnvelope',
              'filesystemEnvelope',
              'secretEnvelope',
            ],
            properties: {
              runKey: { type: 'string', pattern: RUN_KEY_PATTERN },
              tenantId: tenantSchema,
              environment: environmentVersionRefSchema('The content-addressed environment the run targets.'),
              jobRef: { type: 'string', pattern: JOB_REF_PATTERN },
              taskVersion: {
                type: 'object',
                additionalProperties: false,
                required: ['taskId', 'version'],
                properties: {
                  taskId: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
                  version: { type: 'string', pattern: TASK_VERSION_PATTERN },
                },
              },
              initialSnapshotDigest: digestSchema,
              seed: { oneOf: [{ type: 'null' }, { type: 'string', pattern: SEED_PATTERN }] },
              resourceEnvelope: {
                type: 'object',
                additionalProperties: false,
                required: ['cpuMillis', 'memoryMiB', 'wallClockSeconds'],
                properties: {
                  cpuMillis: positiveInteger,
                  memoryMiB: positiveInteger,
                  wallClockSeconds: positiveInteger,
                },
              },
              networkEnvelope: {
                type: 'object',
                additionalProperties: false,
                required: ['egress'],
                properties: {
                  egress: { const: 'default-deny' },
                  allows: egressAllowSchema(),
                },
              },
              filesystemEnvelope: {
                type: 'object',
                additionalProperties: false,
                required: ['writeMode'],
                properties: {
                  writeMode: { enum: FILESYSTEM_WRITE_MODES },
                  mounts: mountSchema(),
                },
              },
              secretEnvelope: {
                type: 'object',
                additionalProperties: false,
                required: ['isolation'],
                properties: {
                  isolation: { const: 'isolation-boundary' },
                  injectionPoints: injectionPointSchema(),
                },
              },
            },
          },
        },
      };
    },
  },
  {
    id: 'environment-runtime/start-run-command',
    output: 'packages/environment-runtime/contracts/start-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('start-run-command'),
        title: 'Arena environment-runtime start-run command v1',
        description: 'Orchestrator to runner command: begin provisioning an admitted run (requested to provisioning to ready to running).',
        ...runTargetedCommand({}),
      };
    },
  },
  {
    id: 'environment-runtime/advance-run-command',
    output: 'packages/environment-runtime/contracts/advance-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('advance-run-command'),
        title: 'Arena environment-runtime advance-run command v1',
        description: 'Orchestrator to runner command: execute one deterministic (seeded-LCG) simulated workload step; wall-clock exhaustion transitions the run to timed-out.',
        ...runTargetedCommand({}),
      };
    },
  },
  {
    id: 'environment-runtime/checkpoint-run-command',
    output: 'packages/environment-runtime/contracts/checkpoint-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('checkpoint-run-command'),
        title: 'Arena environment-runtime checkpoint-run command v1',
        description: 'Orchestrator to runner command: take a checkpoint of the running world (running to checkpointing to running).',
        ...runTargetedCommand({}),
      };
    },
  },
  {
    id: 'environment-runtime/restore-run-command',
    output: 'packages/environment-runtime/contracts/restore-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('restore-run-command'),
        title: 'Arena environment-runtime restore-run command v1',
        description:
          'Orchestrator to runner command: reset the world to a recorded checkpoint of THIS run (foreign-run checkpoints are rejected).',
        ...runTargetedCommand({
          checkpoint: {
            type: 'object',
            additionalProperties: false,
            required: ['runId', 'sequence', 'snapshotDigest'],
            properties: {
              runId: runIdSchema,
              sequence: positiveInteger,
              snapshotDigest: digestSchema,
            },
            description: 'The checkpoint ref to restore (must be recorded by this run).',
          },
        }),
      };
    },
  },
  {
    id: 'environment-runtime/complete-run-command',
    output: 'packages/environment-runtime/contracts/complete-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('complete-run-command'),
        title: 'Arena environment-runtime complete-run command v1',
        description: 'Orchestrator to runner command: complete the run and produce its evidence-addressed RunResult (running to completed).',
        ...runTargetedCommand({}),
      };
    },
  },
  {
    id: 'environment-runtime/fail-run-command',
    output: 'packages/environment-runtime/contracts/fail-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('fail-run-command'),
        title: 'Arena environment-runtime fail-run command v1',
        description: 'Orchestrator to runner command: fail the run with a typed error class (provisioning/ready/running/checkpointing to failed).',
        ...runTargetedCommand({
          errorClass: { type: 'string', pattern: NEUTRAL_ID_PATTERN, description: 'Neutral error class (e.g. workload-error).' },
          message: { type: 'string', minLength: 1 },
        }),
      };
    },
  },
  {
    id: 'environment-runtime/cleanup-run-command',
    output: 'packages/environment-runtime/contracts/cleanup-run-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: ref('cleanup-run-command'),
        title: 'Arena environment-runtime cleanup-run command v1',
        description: 'Orchestrator to runner command: clean up a terminal run (completed | failed | timed-out to cleaned); nothing may follow cleanup.',
        ...runTargetedCommand({}),
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
  const tempDir = join(tmpdir(), `arena-environment-runtime-contracts-${process.pid}-${Date.now()}`);
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
    // parent of the outputs) — never the whole tree.
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
