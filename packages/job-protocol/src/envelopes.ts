/**
 * Envelope wiring for the job protocol (architecture-lock rules 17, 18,
 * 22; requirements R26, R27, R33).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * commands carry a REQUIRED non-null idempotency key, all messages carry a
 * correlation id, payloads are canonical-JSON serializable and digest-
 * verifiable, and unknown envelope versions are rejected by the core
 * parser (PROTOCOL_UNSUPPORTED_VERSION) — mirroring
 * @arena/artifact-protocol's envelope patterns exactly.
 *
 * Payload schemas are versioned SchemaRefs in the `events` namespace
 * (arena:schema/events/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/events/ (see
 * packages/job-protocol/scripts/generate-contracts.mjs).
 *
 * This module also owns the ENVELOPE-SIDE per-job event log
 * (JobEventLog): the wire-level stream of Envelope<JobEvent> per job,
 * append-only with contiguous per-job sequences, closed kind ordering
 * (out-of-order appends rejected) and monotonic timestamps.
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  verifyEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import type { JobDefinition } from './definition.js';
import { isJobDefinition } from './definition.js';
import type { JobEvent, JobEventKind, MutationAuditedEvent } from './events.js';
import { isJobEvent } from './events.js';

export const JOB_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/job-protocol. Mirrored by the
 * generated contract events/schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const JOB_SCHEMAS = Object.freeze({
  'events/job-definition': JOB_SCHEMA_VERSION,
  'events/job-record': JOB_SCHEMA_VERSION,
  'events/job-error': JOB_SCHEMA_VERSION,
  'events/job-submitted-event': JOB_SCHEMA_VERSION,
  'events/job-started-event': JOB_SCHEMA_VERSION,
  'events/job-progressed-event': JOB_SCHEMA_VERSION,
  'events/job-retried-event': JOB_SCHEMA_VERSION,
  'events/job-completed-event': JOB_SCHEMA_VERSION,
  'events/job-failed-event': JOB_SCHEMA_VERSION,
  'events/job-cancelled-event': JOB_SCHEMA_VERSION,
  'events/mutation-audited-event': JOB_SCHEMA_VERSION,
  'events/audit-record': JOB_SCHEMA_VERSION,
  'events/submit-job-command': JOB_SCHEMA_VERSION,
  'events/schema-registry': JOB_SCHEMA_VERSION,
} as const);

export type JobSchemaName = keyof typeof JOB_SCHEMAS;

/** Resolve a job-protocol schema name to its SchemaRef. */
export function jobSchemaRef(name: JobSchemaName): SchemaRef {
  const version = JOB_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new JobError(JOB_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown job protocol schema: ${String(name)}`,
      details: { known: Object.keys(JOB_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a job-protocol schema at the registered version. */
export function isKnownJobSchema(ref: SchemaRef): boolean {
  const registered = (JOB_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

/** Map an event kind to its payload schema name. */
export function jobEventSchemaName(kind: JobEventKind): JobSchemaName {
  switch (kind) {
    case 'job-submitted':
      return 'events/job-submitted-event';
    case 'job-started':
      return 'events/job-started-event';
    case 'job-progressed':
      return 'events/job-progressed-event';
    case 'job-retried':
      return 'events/job-retried-event';
    case 'job-completed':
      return 'events/job-completed-event';
    case 'job-failed':
      return 'events/job-failed-event';
    case 'job-cancelled':
      return 'events/job-cancelled-event';
    case 'mutation-audited':
      return 'events/mutation-audited-event';
    default:
      throw new JobError(JOB_ERROR_CODES.UNKNOWN_ERROR, {
        message: `unknown job event kind: ${String(kind)}`,
      });
  }
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

export interface SubmitJobCommandPayload {
  readonly definition: JobDefinition;
  readonly input: unknown;
}

// ---------------------------------------------------------------------------
// Command / event constructors (strictly validated payloads)
// ---------------------------------------------------------------------------

export interface JobEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
  /** Explicit envelope instance id (tests inject deterministic ids). */
  readonly id?: string;
  /** Explicit issuance timestamp (the orchestrator injects clock time). */
  readonly issuedAt?: string;
}

/**
 * Create the submit-job command envelope (R27: idempotent commands). The
 * payload definition must be structurally valid (digest included) and the
 * input plain JSON; the command REQUIRES a non-null idempotency key.
 */
export function makeSubmitJobCommand(
  payload: SubmitJobCommandPayload,
  context: JobEnvelopeContext,
): Envelope<SubmitJobCommandPayload> {
  if (!isJobDefinition(payload.definition)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_DEFINITION, {
      message: 'submit-job command payload requires a structurally valid job definition',
    });
  }
  if (context.idempotencyKey === undefined) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: jobSchemaRef('events/submit-job-command'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    payload,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

/**
 * Wrap a job event (any taxonomy kind, including mutation-audited) in a
 * versioned event Envelope carrying the job's correlation id and
 * idempotency key. The payload is validated structurally first.
 */
export function makeJobEventEnvelope(
  event: JobEvent,
  context: JobEnvelopeContext,
): Envelope<JobEvent> {
  if (!isJobEvent(event)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'job event envelopes require a structurally valid job event payload',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: jobSchemaRef(jobEventSchemaName(event.kind)),
    correlationId: context.correlationId,
    ...(context.idempotencyKey !== undefined
      ? { idempotencyKey: context.idempotencyKey }
      : {}),
    payload: event,
    ...(context.id !== undefined ? { id: context.id } : {}),
    ...(context.issuedAt !== undefined ? { issuedAt: context.issuedAt } : {}),
  });
}

// ---------------------------------------------------------------------------
// Parsing / verification
// ---------------------------------------------------------------------------

/**
 * Parse a wire envelope and pin its payload schema to a job-protocol
 * schema. The core parser rejects unknown envelope versions
 * (PROTOCOL_UNSUPPORTED_VERSION), malformed shapes (PROTOCOL_INVALID_ENVELOPE)
 * and commands without an idempotency key.
 */
export function parseJobEnvelope<T>(
  raw: string,
  expectedSchema?: JobSchemaName | SchemaRef,
): Envelope<T> {
  if (expectedSchema === undefined) {
    return parseEnvelopeAs<T>(raw);
  }
  const ref = typeof expectedSchema === 'string' ? jobSchemaRef(expectedSchema) : expectedSchema;
  return parseEnvelopeAs<T>(raw, ref);
}

/** sha256 digest over the canonical serialization of a job-protocol envelope. */
export async function jobEnvelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return envelopeDigest(envelope);
}

/**
 * Verify that `raw` parses as a valid job-protocol envelope whose
 * canonical digest equals `expectedDigest` (PROTOCOL_ENVELOPE_TAMPERED on
 * any mismatch — the core tamper tripwire, reused verbatim).
 */
export async function verifyJobEnvelope(
  raw: string,
  expectedDigest: string,
): Promise<Envelope<unknown>> {
  return verifyEnvelope(raw, expectedDigest);
}

// ---------------------------------------------------------------------------
// Envelope-side per-job event log (append-only, ordered, contiguous)
// ---------------------------------------------------------------------------

/**
 * The wire-side event stream of ONE job: every Envelope<JobEvent> the job
 * emitted, in order. Append-only: `appendJobEventEnvelope` validates the
 * per-job sequence (gap/duplicate rejection), the closed kind ordering
 * (out-of-order rejection), timestamp monotonicity and job identity, and
 * returns a NEW frozen log.
 */
export interface JobEventLog {
  readonly jobId: string;
  readonly envelopes: readonly Envelope<JobEvent>[];
}

export function createJobEventLog(jobId: string): JobEventLog {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(jobId)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job id for event log: ${JSON.stringify(jobId)}`,
    });
  }
  return Object.freeze({ jobId, envelopes: Object.freeze([]) });
}

/** Validate + append: returns a NEW log; the input log is never modified. */
export function appendJobEventEnvelope(
  log: JobEventLog,
  envelope: Envelope<JobEvent>,
): JobEventLog {
  const payload = envelope.payload;
  if (!isJobEvent(payload)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'event log appends require a structurally valid job event payload',
    });
  }
  if (payload.jobId !== log.jobId) {
    throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: `event belongs to job ${payload.jobId}, not ${log.jobId} (per-job logs are isolated)`,
      details: { logJobId: log.jobId, eventJobId: payload.jobId },
    });
  }
  const expected = log.envelopes.length + 1;
  if (payload.sequence < expected) {
    throw new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE, {
      message: `event sequence ${String(payload.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only logs never rewrite history)`,
      details: { expected, actual: payload.sequence, kind: payload.kind },
    });
  }
  if (payload.sequence > expected) {
    throw new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_GAP, {
      message: `event sequence ${String(payload.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-job sequences must be contiguous and monotonically increasing)`,
      details: { expected, actual: payload.sequence, kind: payload.kind },
    });
  }
  const last =
    log.envelopes.length > 0 ? log.envelopes[log.envelopes.length - 1] : undefined;
  if (last !== undefined) {
    const lastKind = last.payload.kind;
    const allowed = nextKindsFor(lastKind);
    if (!allowed.includes(payload.kind)) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event kind ${payload.kind} cannot follow ${lastKind} (out-of-order append rejected; allowed next: ${allowed.join(', ') || 'nothing (terminal)'})`,
        details: { lastKind, attemptedKind: payload.kind, allowed: [...allowed] },
      });
    }
    if (last.payload.occurredAt > payload.occurredAt) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event timestamps must be monotonically non-decreasing (last: ${last.payload.occurredAt}, attempted: ${payload.occurredAt})`,
        details: { last: last.payload.occurredAt, attempted: payload.occurredAt },
      });
    }
  } else if (payload.kind !== 'job-submitted') {
    throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: `a job event log must start with job-submitted, got ${payload.kind}`,
      details: { attemptedKind: payload.kind },
    });
  }
  return Object.freeze({
    jobId: log.jobId,
    envelopes: Object.freeze([...log.envelopes, envelope]),
  });
}

function nextKindsFor(lastKind: JobEventKind): readonly JobEventKind[] {
  switch (lastKind) {
    case 'job-submitted':
      return ['job-started', 'job-cancelled'];
    case 'job-started':
    case 'job-progressed':
      return ['job-progressed', 'job-retried', 'job-completed', 'job-failed', 'job-cancelled'];
    case 'job-retried':
      return ['job-started', 'job-cancelled'];
    default:
      return [];
  }
}

/**
 * Re-validate an entire log (contiguity, kind ordering, monotonic
 * timestamps, single job identity, structural payloads). Throws on any
 * violation — the verification entry point for persisted logs.
 */
export function verifyJobEventLog(log: JobEventLog): void {
  let reconstructed = createJobEventLog(log.jobId);
  for (const envelope of log.envelopes) {
    reconstructed = appendJobEventEnvelope(reconstructed, envelope);
  }
  if (reconstructed.envelopes.length !== log.envelopes.length) {
    throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: 'event log revalidation mismatch',
    });
  }
}

/** Extract the audit event from an envelope (typed accessor). */
export function asMutationAuditedEnvelope(
  envelope: Envelope<JobEvent>,
): Envelope<MutationAuditedEvent> {
  if (envelope.payload.kind !== 'mutation-audited') {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: `expected a mutation-audited envelope, got ${String(envelope.payload.kind)}`,
    });
  }
  return envelope as Envelope<MutationAuditedEvent>;
}
