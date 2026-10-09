/**
 * The host runtime's injected port contracts (Work Order P002; issue
 * #154; ADR-P001-01/07 — the A015 law: ports are PURE DATA contracts;
 * implementations live behind them, the interface package performs NO
 * I/O).
 *
 * These are STRUCTURAL MIRRORS of the port shapes the composed services
 * already own:
 *
 *   - `JobStorePort` / `EventSinkPort` / `RuntimeClock` mirror
 *     services/job-orchestrator/src/ports.ts (the orchestrator is the
 *     deterministic engine; the host supplies DURABLE implementations);
 *   - `EscalationStorePort` / `WebhookOutboxPort` mirror
 *     services/escalation-api/src/ports.ts (C001's persistence seams),
 *     typed on @arena/escalation's records.
 *
 * Mirroring the SERVICE ports (instead of importing them) is the
 * boundary law at work: a domain package may never import a service
 * (B4 — dependencies flow downward only). ADR-P001-06 rule 2 / R-068
 * assign the host PARITY TESTS against the real producer surfaces;
 * those live in tests/runtime-host (which may import everything). The
 * typed seam stays consumer-owned, versioned and frozen — exactly the
 * pattern @arena/job-protocol/src/shared.ts documents for cross-package
 * structural types.
 */

import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import type {
  AuditRecord,
  JobRecord,
  JobSubmissionIdentity,
  JobEvent,
  MutationAuditedEvent,
} from '@arena/job-protocol';
import type {
  EscalationRecord,
  EscalationWebhookEvent,
} from '@arena/escalation';
import type { TruthLens } from './lens.js';

// ---------------------------------------------------------------------------
// Clock (A015 law: time is injected; the host never reads a wall clock)
// ---------------------------------------------------------------------------

/** Injected time source (epoch milliseconds). Mirrors the services' Clock. */
export interface RuntimeClock {
  now(): number;
}

// ---------------------------------------------------------------------------
// Durable job persistence (ADR-P001-01: ONE shared durable JobStore)
// ---------------------------------------------------------------------------

/**
 * Persistence port for job records — the structural mirror of the job
 * orchestrator's `JobStore`. The durable implementation over Neon/
 * Postgres ships in @arena/hosted-neon-postgres; claiming, lease and
 * dead-letter semantics ride the append-only record snapshots.
 */
export interface JobStorePort {
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

// ---------------------------------------------------------------------------
// Durable event sink (domain events + the tamper-evident audit chain)
// ---------------------------------------------------------------------------

/**
 * Append port for job-domain events and the audit stream — the
 * structural mirror of the job orchestrator's `EventSink`.
 */
export interface EventSinkPort {
  /** Append a job-domain event envelope (per-job ordering validated here). */
  appendJobEvent(envelope: Envelope<JobEvent>): Promise<void>;
  /**
   * Append a consequential-mutation audit event. The sink owns the audit
   * chain; it returns the tamper-evident AuditRecord it chained.
   */
  appendAuditEvent(envelope: Envelope<MutationAuditedEvent>): Promise<AuditRecord>;
  /** The most recent audit record, or null when the stream is empty. */
  lastAuditRecord(): AuditRecord | null;
}

// ---------------------------------------------------------------------------
// Durable escalation persistence (C001's store/outbox seams + the lens law)
// ---------------------------------------------------------------------------

/**
 * Persistence port for escalation records — mirrors C001's
 * `EscalationStore` with ONE host addition: the ADR-P001-02 truth lens
 * stamped at write time and enforced at read time (cross-lens reads
 * fail closed). The lens is DERIVED from the record's tenant (the
 * reserved demo tenant resolves `demo`; every other tenant resolves
 * `customer`) and persisted alongside the record.
 */
export interface EscalationStorePort {
  /** Persist a NEW record; throws on duplicate request id or duplicate submission key. */
  insert(record: EscalationRecord): Promise<void>;
  /** Replace the latest snapshot of an existing record (append-only at the event level). */
  update(record: EscalationRecord): Promise<void>;
  /** Tenant-scoped lookup by request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
  /**
   * INTERNAL unscoped lookup by request id — used ONLY to produce the
   * typed cross-tenant failure on lifecycle/act paths. Never exposed on
   * read surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
  /** Resolve an idempotent submission (A015 lock-rule-17 dedup path). */
  findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<EscalationRecord | undefined>;
  /** Correlation-addressable path (lock rule 17). */
  findByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]>;
  /** All records (timeout sweeps / scans). */
  list(): Promise<readonly EscalationRecord[]>;
  /** The lens a record was persisted under (ADR-P001-02; null when absent). */
  lensOf(requestId: string): Promise<TruthLens | null>;
  /** Fail-closed cross-lens read guard (ADR-P001-02 rule 2). */
  getByLens(requestId: string, tenantId: string, lens: TruthLens): Promise<EscalationRecord | undefined>;
}

/** One durable webhook delivery attempt in the at-least-once outbox. */
export interface WebhookDeliveryRecordJson {
  /** eventId — the idempotent consumer key for dedupe on the consumer side. */
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  /** The serialized event envelope (canonical JSON wire form). */
  readonly payload: string;
  readonly createdAt: number;
  readonly deliveredAt: number | null;
}

/**
 * Durable, at-least-once webhook outbox — mirrors C001's `WebhookOutbox`
 * with the envelope pre-serialized by the caller (the port is pure
 * data: the host persists the canonical wire form verbatim).
 */
export interface WebhookOutboxPort {
  /** Append one serialized event envelope; throws on duplicate eventId (dedupe). */
  append(envelope: Envelope<EscalationWebhookEvent>): Promise<void>;
  /** Pending (undelivered) deliveries in append order. */
  listPending(): Promise<readonly WebhookDeliveryRecordJson[]>;
  /** All deliveries (audit / tests). */
  listAll(): Promise<readonly WebhookDeliveryRecordJson[]>;
  /** Mark a delivery as delivered (idempotent). */
  markDelivered(eventId: string, at: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// Idempotency outcomes (P002 acceptance: retries return the RECORDED outcome)
// ---------------------------------------------------------------------------

/** A recorded idempotent outcome — replayed VERBATIM on retry. */
export interface RecordedIdempotencyOutcome {
  readonly idempotencyScope: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  /** The recorded outcome document (canonical JSON). */
  readonly outcome: Readonly<Record<string, unknown>>;
  readonly recordedAt: number;
}

/**
 * The durable idempotency-outcome store. C001's replay semantics ride
 * its own record store; this port is the HOST-level recording of
 * accepted outcomes so hard restarts and retries deterministically
 * return the recorded result (P002 acceptance criterion d).
 */
export interface IdempotencyOutcomeStorePort {
  /**
   * Record an outcome (first write wins; a differing rewrite is a typed
   * conflict — recorded outcomes are never silently rewritten).
   */
  record(outcome: RecordedIdempotencyOutcome): Promise<void>;
  /** Resolve a recorded outcome; undefined when none exists. */
  find(identity: JobSubmissionIdentity): Promise<RecordedIdempotencyOutcome | undefined>;
}

// ---------------------------------------------------------------------------
// Projection state (R-049/R-082 backstop sweeps; ADR-P001-01 feeding model)
// ---------------------------------------------------------------------------

/** The durable position of one named projection. */
export interface ProjectionState {
  /** The registered projection name (closed vocabulary in ./jobs.ts). */
  readonly projection: string;
  readonly tenantId: string;
  /** The last durably processed position (monotone). */
  readonly position: number;
  readonly updatedAt: number;
}

/** The projection-position store (checkpoint for backstop sweeps). */
export interface ProjectionStateStorePort {
  /** Persist the projection position (monotone; regressions fail closed). */
  save(state: ProjectionState): Promise<void>;
  /** Read the projection position; null when the projection never ran. */
  get(projection: string, tenantId: string): Promise<ProjectionState | null>;
}
