#!/usr/bin/env node
/**
 * Arena job-protocol contract generator (Work Order A015).
 *
 * Follows the A001/A002 generated-contracts convention
 * (scripts/generate-contracts.mjs, packages/artifact-protocol/scripts/generate-contracts.mjs):
 *
 *   - Contracts are declared in the CONTRACTS manifest below (id, repo-relative
 *     output path, builder). This generator owns the A015 surfaces ONLY — it
 *     emits every schema for @arena/job-protocol into contracts/events/ at
 *     the repository root.
 *   - Generated files are committed, deterministic (sorted keys, 2-space
 *     indent, trailing newline) and carry a versioned SchemaRef $id.
 *   - `--check` regenerates into a temp directory and compares with the
 *     committed copies; any missing / extra / changed file is drift and exits
 *     non-zero. The drift suite (src/drift.test.ts) runs this check as part
 *     of `pnpm test`, the package script `contracts:check` runs it directly,
 *     and the repo-wide governance G9 entry point picks this generator up
 *     automatically (scripts/governance-check.py runs every package-level
 *     generator under packages with a --check). The root
 *     scripts/generate-contracts.mjs manifest itself is NOT extended here
 *     because scripts/ is outside A015's owned surfaces — the root manifest
 *     entry is a one-line Tech Lead reconciliation (same as A002-A004).
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
// (packages/job-protocol/src/**). Parity is asserted by
// contracts.parity.test.ts; drift between these constants and the TS
// constants fails those tests.
// ---------------------------------------------------------------------------

const IDENTIFIER_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const SCHEMA_REF_PATTERN = '^arena:schema/[a-z][a-z0-9-]*/[a-z][a-z0-9-]*@\\d+\\.\\d+\\.\\d+$';
const NAMESPACE_PATTERN = '^[a-z][a-z0-9-]{1,62}$';
const NAME_PATTERN = '^[a-z][a-z0-9-]{1,127}$';
const SEMVER_PATTERN =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
const DIGEST_PATTERN = '^[0-9a-f]{64}$';
const TIMESTAMP_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
const JOB_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const CORRELATION_ADDRESS_PATTERN = '^[a-z][a-z0-9-]{0,63}(?:/[a-z][a-z0-9-]{0,63}){0,7}$';
const NEUTRAL_ID_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const ERROR_CLASS_PATTERN = '^[a-z][a-z0-9-]{0,63}$';
const MUTATION_NAME_PATTERN = '^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*){0,3}$';
const PRINCIPAL_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'];
const PRIORITY_CLASSES = ['low', 'normal', 'high', 'critical'];
const JOB_STATES = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
const ATTEMPT_OUTCOMES = ['pending', 'succeeded', 'failed', 'timed-out', 'cancelled'];
const FAILURE_KINDS = ['error', 'timeout'];
const JOB_ERROR_CODES = [
  'JOB_AUDIT_CHAIN_BROKEN',
  'JOB_EVENT_OUT_OF_ORDER',
  'JOB_EVENT_SEQUENCE_DUPLICATE',
  'JOB_EVENT_SEQUENCE_GAP',
  'JOB_IDENTITY_CONFLICT',
  'JOB_INVALID_ATTEMPT',
  'JOB_INVALID_DEFINITION',
  'JOB_INVALID_DIGEST',
  'JOB_INVALID_EVENT',
  'JOB_INVALID_IDENTITY',
  'JOB_INVALID_INPUT',
  'JOB_INVALID_POLICY',
  'JOB_INVALID_PRINCIPAL',
  'JOB_INVALID_RECORD',
  'JOB_INVALID_TIMESTAMP',
  'JOB_INVALID_TRANSITION',
  'JOB_TAMPERED',
  'JOB_TERMINAL_STATE',
  'JOB_UNKNOWN_ERROR',
  'JOB_UNSUPPORTED_RECORD_VERSION',
];
const ERROR_CATEGORIES = ['encoding', 'integrity', 'unknown', 'validation', 'versioning'];

const JOB_SCHEMA_VERSION = '1.0.0';
const JOB_DEFINITION_VERSION = 1;
const JOB_RECORD_VERSION = 1;
const JOB_EVENT_VERSION = 1;
const JOB_SCHEMA_NAMES = [
  'job-definition',
  'job-record',
  'job-error',
  'job-submitted-event',
  'job-started-event',
  'job-progressed-event',
  'job-retried-event',
  'job-completed-event',
  'job-failed-event',
  'job-cancelled-event',
  'mutation-audited-event',
  'audit-record',
  'submit-job-command',
  'schema-registry',
];

const jref = (name) => `arena:schema/events/${name}@${JOB_SCHEMA_VERSION}`;

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// Reusable $defs (inlined into each composite schema so every contract file
// is self-contained, exactly like the A001/A002 contracts).
const jobKindDef = {
  type: 'object',
  additionalProperties: false,
  required: ['namespace', 'name', 'version'],
  properties: {
    namespace: { type: 'string', pattern: NAMESPACE_PATTERN },
    name: { type: 'string', pattern: NAME_PATTERN },
    version: { type: 'string', pattern: SEMVER_PATTERN },
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

const jobAttemptDef = {
  type: 'object',
  additionalProperties: false,
  required: ['attempt', 'startedAt', 'outcome'],
  properties: {
    attempt: { type: 'integer', minimum: 1 },
    startedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    outcome: { enum: ATTEMPT_OUTCOMES },
    endedAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
    errorClass: { type: 'string', pattern: ERROR_CLASS_PATTERN },
  },
};

const retryPolicyDef = {
  type: 'object',
  additionalProperties: false,
  required: ['maxAttempts', 'backoffScheduleMs', 'retryableErrorClasses'],
  properties: {
    maxAttempts: { type: 'integer', minimum: 1 },
    backoffScheduleMs: { type: 'array', items: { type: 'number', minimum: 0 } },
    retryableErrorClasses: { type: 'array', items: { type: 'string', pattern: ERROR_CLASS_PATTERN } },
  },
};

const resourceHintsDef = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cpu: { type: 'number', exclusiveMinimum: 0 },
    memoryMb: { type: 'integer', minimum: 1 },
    weight: { type: 'number', minimum: 0, maximum: 1000 },
  },
};

const timestampDef = { type: 'string', pattern: TIMESTAMP_PATTERN };

const eventCommonProperties = {
  eventVersion: { const: JOB_EVENT_VERSION },
  sequence: { type: 'integer', minimum: 1 },
  occurredAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
  jobId: { type: 'string', pattern: JOB_ID_PATTERN },
};

// ---------------------------------------------------------------------------
// Contract manifest — the A015 owned generator set.
// ---------------------------------------------------------------------------

const CONTRACTS = [
  {
    id: 'job-protocol/job-definition',
    output: 'contracts/events/job-definition.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-definition'),
        title: 'Arena JobDefinition v1',
        description:
          'The versioned, content-addressed blueprint of a job kind: kind identity, input ' +
          'schema ref (referenced, never enforced, by this layer — schema authority stays with ' +
          'the owning domain, architecture-lock rule 16), correlation address, idempotency ' +
          'semantics (key scope), timeout policy, retry policy (pure data), priority class and ' +
          'resource hints. The sha256 digest covers the canonical serialization of the ' +
          'digest-free view (registry semantics: same definition content => same digest).',
        type: 'object',
        additionalProperties: false,
        required: [
          'definitionVersion',
          'kind',
          'inputSchema',
          'correlationAddress',
          'idempotency',
          'timeout',
          'retry',
          'priority',
          'resourceHints',
          'digest',
        ],
        properties: {
          definitionVersion: { const: JOB_DEFINITION_VERSION },
          kind: { $ref: '#/$defs/jobKind' },
          inputSchema: { type: 'string', pattern: SCHEMA_REF_PATTERN },
          correlationAddress: { type: 'string', pattern: CORRELATION_ADDRESS_PATTERN },
          idempotency: {
            type: 'object',
            additionalProperties: false,
            required: ['scope'],
            properties: {
              scope: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
              retentionMs: { type: 'integer', minimum: 1 },
            },
          },
          timeout: {
            type: 'object',
            additionalProperties: false,
            required: ['timeoutMs'],
            properties: {
              timeoutMs: { type: 'integer', minimum: 1 },
            },
          },
          retry: { $ref: '#/$defs/retryPolicy' },
          priority: { enum: PRIORITY_CLASSES },
          resourceHints: { $ref: '#/$defs/resourceHints' },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
        $defs: {
          jobKind: jobKindDef,
          retryPolicy: retryPolicyDef,
          resourceHints: resourceHintsDef,
        },
      };
    },
  },
  {
    id: 'job-protocol/job-record',
    output: 'contracts/events/job-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-record'),
        title: 'Arena JobRecord v1',
        description:
          'The append-only lifecycle state of one job: queued -> running -> succeeded | failed | ' +
          'cancelled (terminal states are final; mutations after terminal are rejected). Each ' +
          'transition appends one event to the embedded history (deep-frozen, never rewritten). ' +
          'A failed attempt whose retry policy has budget left re-queues the job with a ' +
          'backoff-gated nextRetryAt. Policies are pure data snapshots from the definition.',
        type: 'object',
        additionalProperties: false,
        required: [
          'recordVersion',
          'jobId',
          'definitionDigest',
          'kind',
          'correlationId',
          'idempotencyKey',
          'idempotencyScope',
          'input',
          'policy',
          'status',
          'attempts',
          'attemptHistory',
          'events',
          'submittedAt',
          'updatedAt',
        ],
        properties: {
          recordVersion: { const: JOB_RECORD_VERSION },
          jobId: { type: 'string', pattern: JOB_ID_PATTERN },
          definitionDigest: { type: 'string', pattern: DIGEST_PATTERN },
          kind: { $ref: '#/$defs/jobKind' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
          idempotencyKey: { type: 'string', pattern: IDENTIFIER_PATTERN },
          idempotencyScope: { type: 'string', pattern: NEUTRAL_ID_PATTERN },
          input: { description: 'Plain-JSON job input (validated against inputSchema by the owning domain, not here).' },
          policy: {
            type: 'object',
            additionalProperties: false,
            required: ['timeoutMs', 'retry'],
            properties: {
              timeoutMs: { type: 'integer', minimum: 1 },
              retry: { $ref: '#/$defs/retryPolicy' },
            },
          },
          status: { enum: JOB_STATES },
          attempts: { type: 'integer', minimum: 0 },
          attemptHistory: { type: 'array', items: { $ref: '#/$defs/jobAttempt' } },
          events: {
            type: 'array',
            description:
              'Embedded append-only lifecycle event history (mutation-audited events belong to ' +
              'the separate audit stream, never here).',
            items: {
              oneOf: [
                { $ref: 'job-submitted-event.v1.json' },
                { $ref: 'job-started-event.v1.json' },
                { $ref: 'job-progressed-event.v1.json' },
                { $ref: 'job-retried-event.v1.json' },
                { $ref: 'job-completed-event.v1.json' },
                { $ref: 'job-failed-event.v1.json' },
                { $ref: 'job-cancelled-event.v1.json' },
              ],
            },
          },
          submittedAt: { $ref: '#/$defs/timestamp' },
          updatedAt: { $ref: '#/$defs/timestamp' },
          timeoutAt: { $ref: '#/$defs/timestamp' },
          nextRetryAt: { $ref: '#/$defs/timestamp' },
          progress: {
            type: 'object',
            additionalProperties: false,
            required: ['attempt', 'at'],
            properties: {
              attempt: { type: 'integer', minimum: 1 },
              percent: { type: 'number', minimum: 0, maximum: 100 },
              note: { type: 'string', minLength: 1 },
              at: { $ref: '#/$defs/timestamp' },
            },
          },
          failure: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'errorClass', 'message'],
            properties: {
              kind: { enum: FAILURE_KINDS },
              errorClass: { type: 'string', pattern: ERROR_CLASS_PATTERN },
              message: { type: 'string', minLength: 1 },
            },
          },
          result: { description: 'Plain-JSON terminal result (succeeded jobs only).' },
          cancellation: {
            type: 'object',
            additionalProperties: false,
            required: ['reason', 'cancelledAt'],
            properties: {
              reason: { type: 'string', minLength: 1 },
              cancelledAt: { $ref: '#/$defs/timestamp' },
            },
          },
        },
        $defs: {
          jobKind: jobKindDef,
          jobAttempt: jobAttemptDef,
          retryPolicy: retryPolicyDef,
          timestamp: timestampDef,
        },
      };
    },
  },
  {
    id: 'job-protocol/job-error',
    output: 'contracts/events/job-error.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-error'),
        title: 'Arena JobError v1',
        description:
          'Structured, serializable form of the job protocol error taxonomy. Unknown codes are ' +
          'rejected when parsing (JOB_UNKNOWN_ERROR).',
        type: 'object',
        additionalProperties: false,
        required: ['code', 'category', 'message'],
        properties: {
          code: { enum: JOB_ERROR_CODES },
          category: { enum: ERROR_CATEGORIES },
          message: { type: 'string', minLength: 1 },
          details: { type: 'object' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-submitted-event',
    output: 'contracts/events/job-submitted-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-submitted-event'),
        title: 'Arena job-submitted event payload v1',
        description:
          'Emitted when a job is submitted (the first event of every job stream). Travels inside ' +
          'Envelope<T> with the correlation id and idempotency key of the submission.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'jobId', 'kind', 'definitionDigest', 'input'],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-submitted' },
          definitionDigest: { type: 'string', pattern: DIGEST_PATTERN },
          input: { description: 'Plain-JSON job input.' },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-started-event',
    output: 'contracts/events/job-started-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-started-event'),
        title: 'Arena job-started event payload v1',
        description:
          'Emitted when an attempt is claimed: queued -> running. Carries the 1-based attempt ' +
          'number and the attempt deadline derived from the timeout policy.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'jobId', 'kind', 'attempt', 'timeoutAt'],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-started' },
          attempt: { type: 'integer', minimum: 1 },
          timeoutAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-progressed-event',
    output: 'contracts/events/job-progressed-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-progressed-event'),
        title: 'Arena job-progressed event payload v1',
        description:
          'Emitted by executors to report progress on a running job (typed job observability, ' +
          'R33). Never a state machine input.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'jobId', 'kind', 'attempt'],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-progressed' },
          attempt: { type: 'integer', minimum: 1 },
          percent: { type: 'number', minimum: 0, maximum: 100 },
          note: { type: 'string', minLength: 1 },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-retried-event',
    output: 'contracts/events/job-retried-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-retried-event'),
        title: 'Arena job-retried event payload v1',
        description:
          'Emitted when a failed/timed-out attempt is re-queued because the retry policy has ' +
          'budget left and the error class is retryable. The backoff is pure data; the next ' +
          'claim is gated by nextRetryAt.',
        type: 'object',
        additionalProperties: false,
        required: [
          'eventVersion',
          'sequence',
          'occurredAt',
          'jobId',
          'kind',
          'failedAttempt',
          'errorClass',
          'message',
          'nextAttempt',
          'backoffMs',
          'nextRetryAt',
        ],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-retried' },
          failedAttempt: { type: 'integer', minimum: 1 },
          errorClass: { type: 'string', pattern: ERROR_CLASS_PATTERN },
          message: { type: 'string', minLength: 1 },
          nextAttempt: { type: 'integer', minimum: 1 },
          backoffMs: { type: 'number', minimum: 0 },
          nextRetryAt: { type: 'string', pattern: TIMESTAMP_PATTERN },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-completed-event',
    output: 'contracts/events/job-completed-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-completed-event'),
        title: 'Arena job-completed event payload v1',
        description:
          'Terminal: the running job completed. The orchestrator records the executor-reported ' +
          'result verbatim — it never judges domain outcomes (architecture-lock rule 16).',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'jobId', 'kind', 'attempt', 'result'],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-completed' },
          attempt: { type: 'integer', minimum: 1 },
          result: { description: 'Plain-JSON result as reported by the executor.' },
        },
      };
    },
  },
  {
    id: 'job-protocol/job-failed-event',
    output: 'contracts/events/job-failed-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-failed-event'),
        title: 'Arena job-failed event payload v1',
        description:
          'Terminal: the job failed (retries exhausted, or a non-retryable error class, or the ' +
          'timeout policy fired with no retry budget). Carries the full attempt history.',
        type: 'object',
        additionalProperties: false,
        required: [
          'eventVersion',
          'sequence',
          'occurredAt',
          'jobId',
          'kind',
          'attempts',
          'failureKind',
          'errorClass',
          'message',
          'attemptHistory',
        ],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-failed' },
          attempts: { type: 'integer', minimum: 1 },
          failureKind: { enum: FAILURE_KINDS },
          errorClass: { type: 'string', pattern: ERROR_CLASS_PATTERN },
          message: { type: 'string', minLength: 1 },
          attemptHistory: { type: 'array', items: { $ref: '#/$defs/jobAttempt' } },
        },
        $defs: { jobAttempt: jobAttemptDef },
      };
    },
  },
  {
    id: 'job-protocol/job-cancelled-event',
    output: 'contracts/events/job-cancelled-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('job-cancelled-event'),
        title: 'Arena job-cancelled event payload v1',
        description: 'Terminal: a queued or running job was cancelled.',
        type: 'object',
        additionalProperties: false,
        required: ['eventVersion', 'sequence', 'occurredAt', 'jobId', 'kind', 'reason'],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'job-cancelled' },
          reason: { type: 'string', minLength: 1 },
        },
      };
    },
  },
  {
    id: 'job-protocol/mutation-audited-event',
    output: 'contracts/events/mutation-audited-event.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('mutation-audited-event'),
        title: 'Arena mutation-audited event payload v1',
        description:
          'The generic consequential-mutation audit event (R28): emitted for EVERY consequential ' +
          'state mutation, naming the actor (principal ref), the mutation, the job id, the ' +
          'correlation id and the envelope id of the domain event it audits. Audit events form ' +
          'their own sha256-chained append-only stream (see audit-record.v1.json).',
        type: 'object',
        additionalProperties: false,
        required: [
          'eventVersion',
          'sequence',
          'occurredAt',
          'jobId',
          'kind',
          'mutation',
          'actor',
          'correlationId',
          'envelopeId',
        ],
        properties: {
          ...eventCommonProperties,
          kind: { const: 'mutation-audited' },
          mutation: { type: 'string', pattern: MUTATION_NAME_PATTERN },
          actor: { $ref: '#/$defs/principal' },
          correlationId: { type: 'string', pattern: IDENTIFIER_PATTERN },
          envelopeId: { type: 'string', pattern: UUID_PATTERN },
        },
        $defs: { principal: principalDef },
      };
    },
  },
  {
    id: 'job-protocol/audit-record',
    output: 'contracts/events/audit-record.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('audit-record'),
        title: 'Arena AuditRecord v1',
        description:
          'One tamper-evident entry in the append-only audit stream: the mutation-audited ' +
          'payload, the chain digest of the previous record (all-zero genesis for #1), and the ' +
          'sha256 digest over the canonical JSON of {payload, previousDigest, sequence} — every ' +
          'audit digest therefore INCLUDES the previous event\'s digest, so a broken chain fails ' +
          'verification (R28).',
        type: 'object',
        additionalProperties: false,
        required: ['sequence', 'previousDigest', 'payload', 'digest'],
        properties: {
          sequence: { type: 'integer', minimum: 1 },
          previousDigest: { type: 'string', pattern: DIGEST_PATTERN },
          payload: { $ref: 'mutation-audited-event.v1.json' },
          digest: { type: 'string', pattern: DIGEST_PATTERN },
        },
      };
    },
  },
  {
    id: 'job-protocol/submit-job-command',
    output: 'contracts/events/submit-job-command.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('submit-job-command'),
        title: 'Arena submit-job command payload v1',
        description:
          'Idempotency-keyed command payload submitting a job. Travels inside Envelope<T> with ' +
          'a REQUIRED non-null idempotency key and the submission correlation id (R27; ' +
          'architecture-lock rule 17).',
        type: 'object',
        additionalProperties: false,
        required: ['definition', 'input'],
        properties: {
          definition: { $ref: 'job-definition.v1.json' },
          input: { description: 'Plain-JSON job input.' },
        },
      };
    },
  },
  {
    id: 'job-protocol/schema-registry',
    output: 'contracts/events/schema-registry.v1.json',
    build() {
      return {
        $schema: DRAFT,
        $id: jref('schema-registry'),
        title: 'Arena events schema registry v1',
        description:
          'Enumerates the schemas owned by @arena/job-protocol. A SchemaRef matching this enum ' +
          'is a known events schema at the listed version; anything else is not.',
        type: 'string',
        enum: JOB_SCHEMA_NAMES.map((name) => jref(name)),
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
  const tempDir = join(tmpdir(), `arena-events-contracts-${process.pid}-${Date.now()}`);
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
    // (contracts/events) — never the whole tree, so running --check
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
        '[contracts] run: node packages/job-protocol/scripts/generate-contracts.mjs   then commit the result',
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
  console.log('[contracts] regenerate committed with: git add contracts/events');
}

main();
