/**
 * In-memory port implementations shipped for tests and local runs
 * (Work Order A015 gate 8). ZERO external infrastructure: no Redis, no
 * Kafka, no Postgres — the "durable" side of the protocol is entirely
 * behind the ports, and these adapters keep everything in process memory.
 *
 *   - ManualClock / SystemClock — deterministic / wall time (never sleeps)
 *   - InMemoryJobStore          — records + submission dedup index
 *   - InMemoryEventSink         — per-job JobEventLogs + the AuditLog chain
 *
 * The adapters reuse @arena/job-protocol's validators (appendJobEventEnvelope,
 * appendAuditRecord, verifyAuditChain) so the PROTOCOL invariants are the
 * ones enforced at the persistence boundary.
 */

import type { Envelope } from '@arena/protocol-core';
import type {
  AuditLog,
  AuditRecord,
  JobEvent,
  JobEventLog,
  JobRecord,
  JobSubmissionIdentity,
  MutationAuditedEvent,
} from '@arena/job-protocol';
import {
  appendAuditRecord,
  appendJobEventEnvelope,
  createJobEventLog,
  EMPTY_AUDIT_LOG,
  isSameJobSubmission,
  jobSubmissionIdentityOf,
  JobError,
  JOB_ERROR_CODES,
  jobSubmissionKey,
  verifyAuditChain,
  verifyJobEventLog,
} from '@arena/job-protocol';
import type { Clock, EventSink, JobStore } from './ports.js';

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** Deterministic clock for tests: advances only when told to. */
export class ManualClock implements Clock {
  private currentMs: number;

  constructor(startMs: number = 0) {
    this.currentMs = startMs;
  }

  now(): number {
    return this.currentMs;
  }

  /** Advance by `ms` milliseconds (no sleeping — pure state). */
  advance(ms: number): this {
    this.currentMs += ms;
    return this;
  }

  /** Jump to an absolute epoch millisecond value. */
  setTo(ms: number): this {
    this.currentMs = ms;
    return this;
  }
}

/** Wall-clock adapter (reads time; still never sleeps). */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

// ---------------------------------------------------------------------------
// In-memory job store
// ---------------------------------------------------------------------------

export class InMemoryJobStore implements JobStore {
  private readonly byId = new Map<string, JobRecord>();
  private readonly bySubmission = new Map<string, JobRecord>();
  private readonly byCorrelation = new Map<string, readonly JobRecord[]>();

  async insert(record: JobRecord): Promise<void> {
    if (this.byId.has(record.jobId)) {
      throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `job id ${record.jobId} is already taken (job ids are unique)`,
        details: { jobId: record.jobId },
      });
    }
    const submissionKey = jobSubmissionKey(jobSubmissionIdentityOf(record));
    const existing = this.bySubmission.get(submissionKey);
    if (existing !== undefined) {
      throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `submission ${submissionKey} is already bound to job ${existing.jobId}`,
        details: { submission: submissionKey, jobId: existing.jobId },
      });
    }
    this.byId.set(record.jobId, record);
    this.bySubmission.set(submissionKey, record);
    const correlated = [...(this.byCorrelation.get(record.correlationId) ?? []), record];
    this.byCorrelation.set(record.correlationId, Object.freeze(correlated));
  }

  async update(record: JobRecord): Promise<void> {
    const current = this.byId.get(record.jobId);
    if (current === undefined) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: `job ${record.jobId} does not exist; only existing records can be updated`,
        details: { jobId: record.jobId },
      });
    }
    // Snapshots only move FORWARD: the embedded history never shrinks and
    // the submission identity is immutable.
    if (record.events.length < current.events.length) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `job ${record.jobId} cannot be updated to a shorter event history (append-only)`,
        details: { current: current.events.length, attempted: record.events.length },
      });
    }
    if (
      record.correlationId !== current.correlationId ||
      record.idempotencyKey !== current.idempotencyKey ||
      record.idempotencyScope !== current.idempotencyScope
    ) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: `job ${record.jobId} cannot change its submission identity (immutable addressability)`,
      });
    }
    this.byId.set(record.jobId, record);
    const submissionKey = jobSubmissionKey(jobSubmissionIdentityOf(record));
    this.bySubmission.set(submissionKey, record);
    const correlated = (this.byCorrelation.get(record.correlationId) ?? []).map((entry) =>
      entry.jobId === record.jobId ? record : entry,
    );
    this.byCorrelation.set(record.correlationId, Object.freeze([...correlated]));
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.byId.get(jobId);
  }

  async findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<JobRecord | undefined> {
    const candidate = this.bySubmission.get(jobSubmissionKey(identity));
    if (candidate === undefined) return undefined;
    if (!isSameJobSubmission(jobSubmissionIdentityOf(candidate), identity)) return undefined;
    return candidate;
  }

  async findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]> {
    return this.byCorrelation.get(correlationId) ?? [];
  }

  async list(): Promise<readonly JobRecord[]> {
    return Object.freeze([...this.byId.values()]);
  }
}

// ---------------------------------------------------------------------------
// In-memory event sink
// ---------------------------------------------------------------------------

export class InMemoryEventSink implements EventSink {
  private readonly jobLogs = new Map<string, JobEventLog>();
  private auditLog: AuditLog = EMPTY_AUDIT_LOG;
  private readonly appended: Envelope<JobEvent>[] = [];

  async appendJobEvent(envelope: Envelope<JobEvent>): Promise<void> {
    const jobId = envelope.payload.jobId;
    const current = this.jobLogs.get(jobId) ?? createJobEventLog(jobId);
    this.jobLogs.set(jobId, appendJobEventEnvelope(current, envelope));
    this.appended.push(envelope);
  }

  async appendAuditEvent(envelope: Envelope<MutationAuditedEvent>): Promise<AuditRecord> {
    if (envelope.payload.kind !== 'mutation-audited') {
      throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
        message: `appendAuditEvent requires a mutation-audited envelope, got ${String(envelope.payload.kind)}`,
      });
    }
    this.auditLog = await appendAuditRecord(this.auditLog, envelope.payload);
    const record = this.auditLog.records[this.auditLog.records.length - 1];
    if (record === undefined) {
      throw new JobError(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
        message: 'appendAuditEvent failed to chain the audit record',
      });
    }
    this.appended.push(envelope as Envelope<JobEvent>);
    return record;
  }

  lastAuditRecord(): AuditRecord | null {
    const last = this.auditLog.records[this.auditLog.records.length - 1];
    return last ?? null;
  }

  // -- observability (R33): read-only views for tests and dashboards --

  /** The per-job event log (envelope stream), if any events were emitted. */
  jobEventLog(jobId: string): JobEventLog | undefined {
    return this.jobLogs.get(jobId);
  }

  /** The full append-only audit chain. */
  auditRecords(): readonly AuditRecord[] {
    return this.auditLog.records;
  }

  /** Every envelope appended, in order. */
  envelopes(): readonly Envelope<JobEvent>[] {
    return Object.freeze([...this.appended]);
  }

  /** Re-validate every per-job log AND the audit chain (fail closed). */
  async verify(): Promise<void> {
    for (const log of this.jobLogs.values()) {
      verifyJobEventLog(log);
    }
    await verifyAuditChain(this.auditLog);
  }
}
