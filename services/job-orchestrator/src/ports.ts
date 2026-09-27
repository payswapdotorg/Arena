/**
 * Orchestrator ports (Work Order A015 gate 8) — the ONLY things
 * services/job-orchestrator depends on besides @arena/job-protocol and
 * @arena/protocol-core.
 *
 * The orchestrator is a deterministic in-process state machine over the
 * job protocol; ALL effects beyond pure decisions go through these ports:
 *
 *   - Clock      — time is INJECTED (the engine never sleeps and never
 *                  reads a wall clock; architecture-lock rule 17);
 *   - JobStore   — persistence port for job records (the dedup index for
 *                  idempotent submissions lives behind this port);
 *   - EventSink  — where domain-event envelopes and audit records go
 *                  (per-job ordering is enforced by the protocol's
 *                  JobEventLog; the audit chain by the protocol's
 *                  AuditLog).
 *
 * Authority boundary (architecture-lock rule 16 — one responsibility, one
 * authority): the orchestrator OWNS lifecycle orchestration (state
 * transitions, idempotency dedup, retry/timeout scheduling, event
 * emission, audit chaining). It NEVER judges domain outcomes: results are
 * recorded verbatim from executors, input-schema validation belongs to
 * the domain that owns the schema, and actor access is recorded, never
 * granted. See README.md.
 */

import type { Envelope } from '@arena/protocol-core';
import type {
  AuditRecord,
  JobRecord,
  JobSubmissionIdentity,
  JobEvent,
  MutationAuditedEvent,
} from '@arena/job-protocol';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** Persistence port for job records (all lookups the orchestrator needs). */
export interface JobStore {
  /** Persist a NEW record; throws on duplicate job id or duplicate submission identity. */
  insert(record: JobRecord): Promise<void>;
  /** Replace the latest snapshot of an existing record (append-only at the event level). */
  update(record: JobRecord): Promise<void>;
  /** Look up a job by job id (correlation-addressable path 1). */
  get(jobId: string): Promise<JobRecord | undefined>;
  /** Resolve an idempotent submission (lock rule 17 dedup path). */
  findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<JobRecord | undefined>;
  /** Look up jobs by correlation id (correlation-addressable path 2). */
  findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]>;
  /** All records (scans for retryDue / timeoutDue). */
  list(): Promise<readonly JobRecord[]>;
}

/** Append port for domain events and the tamper-evident audit stream. */
export interface EventSink {
  /** Append a job-domain event envelope (per-job ordering validated here). */
  appendJobEvent(envelope: Envelope<JobEvent>): Promise<void>;
  /**
   * Append a consequential-mutation audit event. The sink owns the audit
   * chain; it returns the tamper-evident AuditRecord it chained (the
   * orchestrator only supplies the payload).
   */
  appendAuditEvent(envelope: Envelope<MutationAuditedEvent>): Promise<AuditRecord>;
  /** The most recent audit record, or null when the stream is empty. */
  lastAuditRecord(): AuditRecord | null;
}
