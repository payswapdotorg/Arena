/**
 * Durable host-runtime port implementations over the Neon/Postgres
 * SqlTransport seam (Work Order P002; issue #154; ADR-P001-01/02/07).
 *
 *   - DurableEscalationStore       — escalation lifecycle snapshots +
 *                                    append-only event records + the lens
 *   - DurableWebhookOutbox         — the durable at-least-once outbox
 *   - DurableIdempotencyStore      — recorded outcomes (deterministic replay)
 *   - DurableJobStore              — job snapshots + claim/lease/dead-letter
 *   - DurableEventSink             — job-event envelopes + the audit chain
 *   - DurableProjectionStateStore  — projection sweep checkpoints
 *   - DurablePaymentLedgerStore    — payment escrow ledger snapshots +
 *                                    per-operation-key entry rows (F-09)
 *   - DurablePaymentEventOutbox    — the durable payment event outbox (F-09)
 *
 * Posture (identical to the control-plane adapter):
 *   - configuration comes ONLY from server-side env vars (see ./env.ts);
 *     values are never committed and never logged;
 *   - without configuration / a transport every operation fails closed
 *     with the typed PERSISTENCE_CAPACITY_DISABLED error BEFORE any
 *     network call (no crash, no value leakage);
 *   - the infrastructure touchpoint is the injected SqlTransport seam, so
 *     the full surface runs against ANY Postgres speaking the same
 *     statements — the Neon HTTP driver in production, an embedded real
 *     Postgres in the acceptance battery;
 *   - records round-trip through the DOMAIN validators (parseJobRecord /
 *     isEscalationRecord) — a row that does not map onto the domain shape
 *     fails closed with a typed error, never a silent best-effort.
 */

import { serializeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import type {
  AuditRecord,
  JobRecord,
  JobSubmissionIdentity,
  JobEvent,
  MutationAuditedEvent,
} from '@arena/job-protocol';
import {
  appendAuditRecord,
  appendJobEventEnvelope,
  createJobEventLog,
  isJobRecord,
  isSameJobSubmission,
  JobError,
  JOB_ERROR_CODES,
  jobSubmissionIdentityOf,
  jobSubmissionKey,
  parseJobRecord,
  toJobSubmissionIdentity,
} from '@arena/job-protocol';
import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import { isEscalationRecord } from '@arena/escalation';
import {
  LensError,
  LENS_ERROR_CODES,
  lensForTenant,
  type EscalationStorePort,
  type EventSinkPort,
  type IdempotencyOutcomeStorePort,
  type JobStorePort,
  type ProjectionState,
  type ProjectionStateStorePort,
  type RecordedIdempotencyOutcome,
  type TruthLens,
  type WebhookDeliveryRecordJson,
  type WebhookOutboxPort,
} from '@arena/runtime-host';
import {
  PERSISTENCE_ERROR_CODES,
  PersistenceCapacityError,
  PersistenceError,
  SystemClock,
} from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import { missingNeonEnvVarNames, readNeonConfigFromEnv } from '@arena/hosted-neon-postgres';
import { createNeonHttpSqlTransport, executeStatement } from '@arena/hosted-neon-postgres';
import type { SqlRow, SqlTransport } from '@arena/hosted-neon-postgres';
import { isPaymentLedger } from '@arena/payments';
import type { PaymentLedger } from '@arena/payments';
import {
  appendEscalationEventStatement,
  clearExpiredJobLeasesStatement,
  insertAuditRecordStatement,
  insertDeadLetterStatement,
  insertEscalationRecordStatement,
  insertJobEventStatement,
  insertJobRecordStatement,
  insertPaymentLedgerEntryStatement,
  insertPaymentLedgerStatement,
  insertPaymentOutboxDeliveryStatement,
  insertWebhookDeliveryStatement,
  markPaymentOutboxDeliveryDeliveredStatement,
  markWebhookDeliveryDeliveredStatement,
  recordIdempotencyOutcomeStatement,
  selectAllAuditRecordsStatement,
  selectAllEscalationsStatement,
  selectAllJobsStatement,
  selectAllPaymentLedgersStatement,
  selectAllPaymentOutboxDeliveriesStatement,
  selectAllWebhookDeliveriesStatement,
  selectDeadLettersStatement,
  selectEscalationBySubmissionStatement,
  selectEscalationsByCorrelationStatement,
  selectEscalationRecordStatement,
  selectIdempotencyOutcomeStatement,
  selectJobBySubmissionStatement,
  selectJobEventsStatement,
  selectJobRecordStatement,
  selectJobsByCorrelationStatement,
  selectLastAuditRecordStatement,
  selectPaymentLedgerStatement,
  selectPendingPaymentOutboxDeliveriesStatement,
  selectPendingWebhookDeliveriesStatement,
  selectProjectionStateStatement,
  stampJobLeaseStatement,
  updateEscalationRecordStatement,
  updateJobRecordStatement,
  updatePaymentLedgerStatement,
  upsertProjectionStateStatement,
} from '@arena/hosted-neon-postgres';

// ---------------------------------------------------------------------------
// Shared options / gate
// ---------------------------------------------------------------------------

/** Options shared by every durable runtime adapter. */
export interface DurableRuntimeAdapterOptions {
  /** Env source; defaults to process.env (values never logged). */
  readonly env?: Record<string, string | undefined>;
  /** Injected transport (tests / embedded real Postgres). Overrides env discovery. */
  readonly transport?: SqlTransport;
  readonly clock?: Clock;
}

/**
 * The full durable runtime component set over ONE shared transport. The
 * composition site (deploy/runtime — the M1-designated wiring point)
 * builds this ONCE and shares the instances between the composed service
 * engines and the host core, so the audit-chain cache stays singular
 * (the orchestrator's writes and the host's hydration read the same
 * DurableEventSink).
 *
 * P002-F1 (F-09): the set now carries the durable payment components too —
 * the escrow-ledger store and the payment event outbox the payments
 * service's ports consume (structurally — services/payments owns the port
 * contracts; a service may never import another service, so the adapters
 * here are typed directly on the @arena/payments domain document).
 */
export interface DurableRuntimeComponents {
  readonly escalationStore: DurableEscalationStore;
  readonly webhookOutbox: DurableWebhookOutbox;
  readonly idempotencyStore: DurableIdempotencyStore;
  readonly jobStore: DurableJobStore;
  readonly eventSink: DurableEventSink;
  readonly projectionStore: DurableProjectionStateStore;
  readonly paymentLedgerStore: DurablePaymentLedgerStore;
  readonly paymentOutbox: DurablePaymentEventOutbox;
}

/**
 * Build every durable port over one transport (fail-closed per adapter
 * when the transport/env yields no configuration). The composition site
 * decides HOW the transport is discovered (injected SqlTransport, Neon
 * HTTP driver from env, embedded real Postgres).
 */
export function createDurableRuntimeComponents(
  options: DurableRuntimeAdapterOptions = {},
): DurableRuntimeComponents {
  return Object.freeze({
    escalationStore: new DurableEscalationStore(options),
    webhookOutbox: new DurableWebhookOutbox(options),
    idempotencyStore: new DurableIdempotencyStore(options),
    jobStore: new DurableJobStore(options),
    eventSink: new DurableEventSink(options),
    projectionStore: new DurableProjectionStateStore(options),
    paymentLedgerStore: new DurablePaymentLedgerStore(options),
    paymentOutbox: new DurablePaymentEventOutbox(options),
  });
}

/** Internal shared base: transport discovery + the fail-closed gate. */
class GatedTransport {
  protected readonly transport: SqlTransport | null;
  protected readonly clock: Clock;
  protected readonly missingEnvNames: readonly string[];

  constructor(options: DurableRuntimeAdapterOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    if (options.transport !== undefined) {
      this.transport = options.transport;
      this.missingEnvNames = [];
    } else {
      const config = readNeonConfigFromEnv(options.env ?? process.env);
      // No configuration -> DISABLED (fail closed; no client is constructed).
      this.transport =
        config !== null ? createNeonHttpSqlTransport(config.connectionString) : null;
      this.missingEnvNames = missingNeonEnvVarNames(options.env ?? process.env);
    }
  }

  /** True when the adapter has configuration / a transport (not DISABLED). */
  get enabled(): boolean {
    return this.transport !== null;
  }

  protected gate(): SqlTransport {
    if (this.transport === null) {
      throw new PersistenceCapacityError(
        PERSISTENCE_ERROR_CODES.CAPACITY_DISABLED,
        'DISABLED',
        [{ code: 'configuration-missing' }],
        {
          message:
            'the hosted runtime adapter is disabled: no connection configuration was provided (fail closed)',
          details: { missingEnvVarNames: this.missingEnvNames },
        },
      );
    }
    return this.transport;
  }
}

// ---------------------------------------------------------------------------
// Row mapping (fail closed on shape; jsonb may arrive parsed or as string)
// ---------------------------------------------------------------------------

function rowJson(value: unknown): unknown {
  return typeof value === 'string' ? safeParse(value) : value;
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function numeric(value: unknown): number {
  // Some drivers return BIGINT/int8 as strings; epoch ms always fit Number.
  return Number(value);
}

function toEscalationRecord(row: SqlRow): EscalationRecord {
  const candidate = rowJson(row['record']);
  if (!isEscalationRecord(candidate)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: 'escalation record row does not map onto the domain record shape (fail closed)',
      details: { requestId: String(row['request_id']) },
    });
  }
  return candidate;
}

function toJobRecord(row: SqlRow): JobRecord {
  // parseJobRecord re-validates the FULL protocol shape (fail closed).
  return parseJobRecord(rowJson(row['record']));
}

function jobLens(row: SqlRow): string | null {
  const lens = row['lens'];
  return typeof lens === 'string' ? lens : null;
}

// ---------------------------------------------------------------------------
// DurableEscalationStore
// ---------------------------------------------------------------------------

/**
 * The durable escalation store over arena_escalation_record /
 * arena_escalation_event. Satisfies C001's EscalationStore structurally
 * (the lensOf/getByLens additions are host-only) and stamps the
 * ADR-P001-02 lens at write time (derived from the record's tenant).
 */
export class DurableEscalationStore extends GatedTransport implements EscalationStorePort {
  async insert(record: EscalationRecord): Promise<void> {
    const transport = this.gate();
    if (!isEscalationRecord(record)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: 'escalation record is not a valid domain record (fail closed)',
      });
    }
    const identity = jobSubmissionIdentityOfEscalation(record);
    // Dedup pre-checks (same select-replay-or-conflict posture as the
    // control-plane adapter): duplicate request id or duplicate submission.
    const existingById = await executeStatement(
      transport,
      selectEscalationRecordStatement(record.request.requestId),
    );
    if (existingById.length > 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `escalation ${record.request.requestId} already exists`,
        details: { requestId: record.request.requestId },
      });
    }
    const existingSubmission = await executeStatement(
      transport,
      selectEscalationBySubmissionStatement(identity),
    );
    if (existingSubmission.length > 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `escalation submission ${jobSubmissionKey(identity)} is already bound`,
        details: { submission: jobSubmissionKey(identity) },
      });
    }
    const now = this.clock.now();
    const inserted = await executeStatement(
      transport,
      insertEscalationRecordStatement({
        requestId: record.request.requestId,
        tenantId: record.request.tenantId,
        lens: lensForTenant(record.request.tenantId),
        state: record.state,
        correlationId: record.request.correlationId,
        idempotencyScope: identity.idempotencyScope,
        idempotencyKey: identity.idempotencyKey,
        historyLength: record.history.length,
        recordJson: JSON.stringify(record),
        createdAt: now,
        updatedAt: now,
      }),
    );
    if (inserted.length === 0) {
      // Lost an insert race on the primary key — fail closed, never silent.
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `escalation ${record.request.requestId} already exists (concurrent insert won)`,
        details: { requestId: record.request.requestId },
      });
    }
    await this.appendHistoryRows(transport, record, now);
  }

  async update(record: EscalationRecord): Promise<void> {
    const transport = this.gate();
    if (!isEscalationRecord(record)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: 'escalation record is not a valid domain record (fail closed)',
      });
    }
    const identity = jobSubmissionIdentityOfEscalation(record);
    const currentRows = await executeStatement(
      transport,
      selectEscalationRecordStatement(record.request.requestId),
    );
    if (currentRows.length === 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `escalation ${record.request.requestId} not found; only existing records can be updated`,
        details: { requestId: record.request.requestId },
      });
    }
    const current = toEscalationRecord(currentRows[0] as SqlRow);
    // Submission identity and tenant are immutable addressability.
    if (
      current.request.tenantId !== record.request.tenantId ||
      current.request.correlationId !== record.request.correlationId ||
      current.request.idempotencyKey !== record.request.idempotencyKey
    ) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `escalation ${record.request.requestId} cannot change its submission identity or tenant (immutable addressability)`,
        details: { requestId: record.request.requestId },
      });
    }
    if (record.history.length <= current.history.length) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `escalation ${record.request.requestId} cannot be updated to a non-growing event history (append-only)`,
        details: { current: current.history.length, attempted: record.history.length },
      });
    }
    const updated = await executeStatement(
      transport,
      updateEscalationRecordStatement({
        requestId: record.request.requestId,
        tenantId: record.request.tenantId,
        lens: lensForTenant(record.request.tenantId),
        state: record.state,
        correlationId: record.request.correlationId,
        idempotencyScope: identity.idempotencyScope,
        idempotencyKey: identity.idempotencyKey,
        historyLength: record.history.length,
        recordJson: JSON.stringify(record),
        updatedAt: this.clock.now(),
      }),
    );
    if (updated.length === 0) {
      // Lost a concurrent update race between the guard and the write.
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `escalation ${record.request.requestId} update lost the append-only guard (concurrent update won)`,
        details: { requestId: record.request.requestId },
      });
    }
    await this.appendHistoryRows(transport, record, this.clock.now());
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectEscalationRecordStatement(requestId));
    if (rows.length === 0) return undefined;
    const row = rows[0] as SqlRow;
    // Tenant-scoped lookup: a cross-tenant read is simply not found.
    if (row['tenant_id'] !== tenantId) return undefined;
    return toEscalationRecord(row);
  }

  async findById(requestId: string): Promise<EscalationRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectEscalationRecordStatement(requestId));
    return rows.length > 0 ? toEscalationRecord(rows[0] as SqlRow) : undefined;
  }

  async findByIdempotencyKey(
    identity: JobSubmissionIdentity,
  ): Promise<EscalationRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectEscalationBySubmissionStatement(identity));
    return rows.length > 0 ? toEscalationRecord(rows[0] as SqlRow) : undefined;
  }

  async findByCorrelationId(
    tenantId: string,
    correlationId: string,
  ): Promise<readonly EscalationRecord[]> {
    const transport = this.gate();
    const rows = await executeStatement(
      transport,
      selectEscalationsByCorrelationStatement(tenantId, correlationId),
    );
    return Object.freeze(rows.map((row) => toEscalationRecord(row)));
  }

  async list(): Promise<readonly EscalationRecord[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllEscalationsStatement());
    return Object.freeze(rows.map((row) => toEscalationRecord(row)));
  }

  async lensOf(requestId: string): Promise<TruthLens | null> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectEscalationRecordStatement(requestId));
    if (rows.length === 0) return null;
    const lens = rows[0]?.['lens'];
    return lens === 'demo' || lens === 'customer' ? lens : null;
  }

  async getByLens(
    requestId: string,
    tenantId: string,
    lens: TruthLens,
  ): Promise<EscalationRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectEscalationRecordStatement(requestId));
    if (rows.length === 0) return undefined;
    const row = rows[0] as SqlRow;
    if (row['tenant_id'] !== tenantId) return undefined;
    const recordedLens = row['lens'];
    if (recordedLens !== 'demo' && recordedLens !== 'customer') {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `escalation ${requestId} carries an unknown lens ${JSON.stringify(recordedLens)} (fail closed)`,
      });
    }
    // Cross-lens reads fail closed (ADR-P001-02 rule 2) — typed conflict.
    if (recordedLens !== lens) {
      throw new LensError(LENS_ERROR_CODES.LENS_CONFLICT, 'cross-lens read rejected (fail closed)', {
        recorded: recordedLens,
        caller: lens,
      });
    }
    return toEscalationRecord(row);
  }

  /** Append-only event records for every history entry not yet recorded. */
  private async appendHistoryRows(
    transport: SqlTransport,
    record: EscalationRecord,
    appendedAt: number,
  ): Promise<void> {
    for (const [index, entry] of record.history.entries()) {
      const sequence = index + 1;
      // Idempotent per (request_id, sequence): a replayed snapshot append
      // is a no-op, so a restarted host never duplicates a transition record.
      await executeStatement(
        transport,
        appendEscalationEventStatement({
          requestId: record.request.requestId,
          sequence,
          tenantId: record.request.tenantId,
          eventJson: JSON.stringify(entry),
          appendedAt,
        }),
      );
    }
  }
}

/** The submission identity an escalation record carries (C001's binding). */
function jobSubmissionIdentityOfEscalation(record: EscalationRecord): JobSubmissionIdentity {
  return toJobSubmissionIdentity({
    idempotencyScope: `escalation-${record.request.tenantId}`,
    idempotencyKey: record.request.idempotencyKey,
    correlationId: record.request.correlationId,
  });
}

// ---------------------------------------------------------------------------
// DurableWebhookOutbox
// ---------------------------------------------------------------------------

/** The durable at-least-once webhook outbox over arena_webhook_outbox. */
export class DurableWebhookOutbox extends GatedTransport implements WebhookOutboxPort {
  async append(
    event: EscalationWebhookEvent,
    envelope: Envelope<EscalationWebhookEvent>,
  ): Promise<void> {
    const transport = this.gate();
    // PARITY with C001's InMemoryWebhookOutbox: the payload is the
    // serialized event ENVELOPE (the canonical JSON wire form the
    // delivery adapter signs and posts); createdAt rides the event's
    // occurredAt (deterministic replay), falling back to the clock.
    const payload = serializeEnvelope(envelope);
    const createdAt = event.occurredAt ? Date.parse(event.occurredAt) : this.clock.now();
    const inserted = await executeStatement(
      transport,
      insertWebhookDeliveryStatement({
        eventId: event.eventId,
        requestId: event.requestId,
        tenantId: event.tenantId,
        sequence: event.sequence,
        payload,
        createdAt,
      }),
    );
    if (inserted.length === 0) {
      // Duplicate eventId — the dedupe contract (typed failure, no rewrite).
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `webhook event ${event.eventId} is already in the outbox (dedupe)`,
        details: { eventId: event.eventId },
      });
    }
  }

  async listPending(): Promise<readonly WebhookDeliveryRecordJson[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectPendingWebhookDeliveriesStatement());
    return Object.freeze(rows.map((row) => toWebhookDelivery(row)));
  }

  async listAll(): Promise<readonly WebhookDeliveryRecordJson[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllWebhookDeliveriesStatement());
    return Object.freeze(rows.map((row) => toWebhookDelivery(row)));
  }

  async markDelivered(eventId: string, at: number): Promise<void> {
    const transport = this.gate();
    // Idempotent: an already-delivered row returns no rows — not an error.
    await executeStatement(transport, markWebhookDeliveryDeliveredStatement(eventId, at));
  }
}

function toWebhookDelivery(row: SqlRow): WebhookDeliveryRecordJson {
  const deliveredAt = row['delivered_at'];
  return Object.freeze({
    eventId: String(row['event_id']),
    requestId: String(row['request_id']),
    tenantId: String(row['tenant_id']),
    sequence: Number(row['sequence']),
    payload: String(row['payload']),
    createdAt: numeric(row['created_at']),
    deliveredAt:
      deliveredAt === null || deliveredAt === undefined ? null : numeric(deliveredAt),
  });
}

// ---------------------------------------------------------------------------
// DurablePaymentLedgerStore (P002-F1 — findings-register F-09)
// ---------------------------------------------------------------------------

function toPaymentLedger(row: SqlRow): PaymentLedger {
  const candidate = rowJson(row['ledger']);
  if (!isPaymentLedger(candidate)) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
      message: 'payment ledger row does not map onto the domain ledger shape (fail closed)',
      details: { requestId: String(row['request_id']) },
    });
  }
  return candidate;
}

/**
 * The durable escrow-ledger store over arena_payment_ledger +
 * arena_payment_ledger_entry (migration 0006). Satisfies the payments
 * service's `PaymentLedgerStore` port STRUCTURALLY (the port contract is
 * consumer-owned in services/payments/src/ports.ts; boundary law B2 keeps
 * this service from importing it).
 *
 * THE F-09 REMEDIATION — durable per-operation-key uniqueness:
 *   - `insert` is a single guarded INSERT (ON CONFLICT (request_id) DO
 *     NOTHING + RETURNING): a concurrent fresh-ledger race resolves
 *     exactly-once — the loser gets the typed RECORD_EXISTS, never a
 *     second application;
 *   - `update` appends the entry rows under UNIQUE (request_id,
 *     operation_key) — a second application of the SAME operation key is
 *     UNREPRESENTABLE at the storage layer (the unique index raises
 *     BEFORE the snapshot row is touched, so the read model never records
 *     the refused double-act);
 *   - the snapshot replacement carries the same strictly-longer
 *     entries_length guard the escalation/job snapshots established, so a
 *     concurrent update race surfaces as the typed REVISION_CONFLICT.
 * The payments service's port seam catches those two typed conflicts and
 * re-drives the operation through the domain idempotency index, returning
 * the RECORDED outcome with the replay marker (the C001 law under
 * contention) — the service layer owns that conversion (services/payments/
 * src/service.ts, `settleDurably`).
 */
export class DurablePaymentLedgerStore extends GatedTransport {
  async insert(ledger: PaymentLedger): Promise<void> {
    const transport = this.gate();
    const requestId = ledger.requestId;
    if (!isPaymentLedger(ledger)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: 'payment ledger is not a valid domain ledger (fail closed)',
        details: { requestId },
      });
    }
    // Entry rows FIRST (the exactly-once gate): a refused entry append
    // raises before the snapshot row exists, so a hand-carried invalid
    // document never materializes as durable read state. A racing loser's
    // entry rows are either content-identical to the winner's (same
    // operation key) or (request_id, sequence)-conflicting (a different
    // operation racing for the same sequence) — both no-ops.
    await this.appendEntryRows(transport, ledger, this.clock.now());
    const inserted = await executeStatement(
      transport,
      insertPaymentLedgerStatement({
        requestId: ledger.requestId,
        tenantId: ledger.tenantId,
        correlationId: ledger.correlationId,
        currency: ledger.currency,
        truth: ledger.truth,
        state: ledger.state,
        entriesLength: ledger.entries.length,
        ledgerJson: JSON.stringify(ledger),
        createdAt: this.clock.now(),
        updatedAt: this.clock.now(),
      }),
    );
    if (inserted.length === 0) {
      // Lost the primary-key race: a concurrent create of the SAME
      // escalation's escrow ledger won — typed conflict, never a silent
      // overwrite (exactly-once at the storage layer).
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `escrow ledger ${ledger.requestId} already exists (concurrent insert won)`,
        details: { requestId: ledger.requestId },
      });
    }
  }

  async update(ledger: PaymentLedger): Promise<void> {
    const transport = this.gate();
    const requestId = ledger.requestId;
    if (!isPaymentLedger(ledger)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: 'payment ledger is not a valid domain ledger (fail closed)',
        details: { requestId },
      });
    }
    const currentRows = await executeStatement(
      transport,
      selectPaymentLedgerStatement(ledger.requestId),
    );
    if (currentRows.length === 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `escrow ledger ${ledger.requestId} not found; only existing ledgers can be updated`,
        details: { requestId: ledger.requestId },
      });
    }
    const current = toPaymentLedger(currentRows[0] as SqlRow);
    if (
      current.tenantId !== ledger.tenantId ||
      current.currency !== ledger.currency ||
      current.truth !== ledger.truth
    ) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `escrow ledger ${ledger.requestId} cannot change its tenant, currency or truth label (immutable addressability)`,
        details: { requestId: ledger.requestId },
      });
    }
    if (ledger.entries.length <= current.entries.length) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `escrow ledger ${ledger.requestId} cannot be updated to a non-growing entry history (append-only)`,
        details: { current: current.entries.length, attempted: ledger.entries.length },
      });
    }
    // Entry rows FIRST (the exactly-once gate): a refused entry append
    // raises BEFORE the snapshot row is replaced, so the read model never
    // records a double-act the unique index refused. A crash between the
    // entry appends and the guarded snapshot replacement below is healed
    // by the NEXT update's idempotent re-append (every entry row is
    // (request_id, sequence)-addressed).
    await this.appendEntryRows(transport, ledger, this.clock.now());
    // Guarded snapshot replacement: the strictly-longer entries_length
    // predicate makes a lost concurrent update race unrepresentable (zero
    // rows → typed revision conflict).
    const updated = await executeStatement(
      transport,
      updatePaymentLedgerStatement({
        requestId: ledger.requestId,
        tenantId: ledger.tenantId,
        correlationId: ledger.correlationId,
        currency: ledger.currency,
        truth: ledger.truth,
        state: ledger.state,
        entriesLength: ledger.entries.length,
        ledgerJson: JSON.stringify(ledger),
        updatedAt: this.clock.now(),
      }),
    );
    if (updated.length === 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `escrow ledger ${ledger.requestId} update lost the append-only guard (concurrent update won)`,
        details: { requestId: ledger.requestId },
      });
    }
  }

  async get(requestId: string, tenantId: string): Promise<PaymentLedger | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectPaymentLedgerStatement(requestId));
    if (rows.length === 0) return undefined;
    const row = rows[0] as SqlRow;
    // TENANT SCOPING: a cross-tenant read is simply not found.
    if (row['tenant_id'] !== tenantId) return undefined;
    return toPaymentLedger(row);
  }

  async findById(requestId: string): Promise<PaymentLedger | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectPaymentLedgerStatement(requestId));
    return rows.length > 0 ? toPaymentLedger(rows[0] as SqlRow) : undefined;
  }

  async list(): Promise<readonly PaymentLedger[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllPaymentLedgersStatement());
    return Object.freeze(rows.map((row) => toPaymentLedger(row)));
  }

  /**
   * Append entry rows for every entry (idempotent on (request_id,
   * sequence): a replayed snapshot append is a no-op). The UNIQUE
   * (request_id, operation_key) index makes a second application of the
   * same operation key RAISE — the storage-level exactly-once gate the
   * F-09 remediation is; the raised violation surfaces as the typed
   * TRANSPORT_FAILED and the application is refused (fail closed).
   */
  private async appendEntryRows(
    transport: SqlTransport,
    ledger: PaymentLedger,
    appendedAt: number,
  ): Promise<void> {
    for (const entry of ledger.entries) {
      await executeStatement(
        transport,
        insertPaymentLedgerEntryStatement({
          requestId: ledger.requestId,
          sequence: entry.sequence,
          operationKey: entry.operationKey,
          tenantId: ledger.tenantId,
          entryJson: JSON.stringify(entry),
          appendedAt,
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// DurablePaymentEventOutbox (P002-F1 — findings-register F-09)
// ---------------------------------------------------------------------------

/**
 * The durable at-least-once payment event outbox over arena_payment_outbox
 * (migration 0006). Satisfies the payments service's `PaymentEventOutbox`
 * port STRUCTURALLY; event_id IS the idempotent consumer key (the webhook
 * outbox's dedupe contract, verbatim).
 */
export class DurablePaymentEventOutbox extends GatedTransport {
  async append(
    event: EscalationWebhookEvent,
    envelope: Envelope<EscalationWebhookEvent>,
  ): Promise<void> {
    const transport = this.gate();
    // PARITY with C010's InMemoryPaymentEventOutbox and the durable
    // webhook outbox: the payload is the serialized event ENVELOPE and
    // createdAt rides the event's occurredAt (deterministic replay).
    const payload = serializeEnvelope(envelope);
    const createdAt = event.occurredAt ? Date.parse(event.occurredAt) : this.clock.now();
    const inserted = await executeStatement(
      transport,
      insertPaymentOutboxDeliveryStatement({
        eventId: event.eventId,
        requestId: event.requestId,
        tenantId: event.tenantId,
        sequence: event.sequence,
        payload,
        createdAt,
      }),
    );
    if (inserted.length === 0) {
      // Duplicate eventId — the dedupe contract (typed failure, no rewrite).
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `payment event ${event.eventId} is already in the outbox (dedupe)`,
        details: { eventId: event.eventId },
      });
    }
  }

  async listPending(): Promise<readonly WebhookDeliveryRecordJson[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectPendingPaymentOutboxDeliveriesStatement());
    return Object.freeze(rows.map((row) => toWebhookDelivery(row)));
  }

  async listAll(): Promise<readonly WebhookDeliveryRecordJson[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllPaymentOutboxDeliveriesStatement());
    return Object.freeze(rows.map((row) => toWebhookDelivery(row)));
  }

  async markDelivered(eventId: string, at: number): Promise<void> {
    const transport = this.gate();
    // Idempotent: an already-delivered row returns no rows — not an error.
    await executeStatement(transport, markPaymentOutboxDeliveryDeliveredStatement(eventId, at));
  }
}

// ---------------------------------------------------------------------------
// DurableIdempotencyStore
// ---------------------------------------------------------------------------

/**
 * The durable idempotency-outcome store over arena_runtime_idempotency.
 * First write wins; a DIFFERING rewrite is a typed conflict (recorded
 * outcomes are never silently rewritten — deterministic replay).
 */
export class DurableIdempotencyStore
  extends GatedTransport
  implements IdempotencyOutcomeStorePort
{
  async record(outcome: RecordedIdempotencyOutcome): Promise<void> {
    const transport = this.gate();
    const identity = toJobSubmissionIdentity({
      idempotencyScope: outcome.idempotencyScope,
      idempotencyKey: outcome.idempotencyKey,
      correlationId: outcome.correlationId,
    });
    const existing = await this.findRaw(transport, identity);
    if (existing !== undefined) {
      const identical =
        existing.idempotencyScope === outcome.idempotencyScope &&
        existing.idempotencyKey === outcome.idempotencyKey &&
        existing.correlationId === outcome.correlationId &&
        canonicalJsonEqual(existing.outcome, outcome.outcome);
      if (!identical) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
          message: `idempotency outcome ${jobSubmissionKey(identity)} is already recorded with different content (recorded outcomes are never rewritten)`,
          details: { submission: jobSubmissionKey(identity) },
        });
      }
      return; // identical re-record: idempotent no-op
    }
    const inserted = await executeStatement(
      transport,
      recordIdempotencyOutcomeStatement({
        idempotencyScope: outcome.idempotencyScope,
        idempotencyKey: outcome.idempotencyKey,
        correlationId: outcome.correlationId,
        outcomeJson: JSON.stringify(outcome.outcome),
        recordedAt: outcome.recordedAt,
      }),
    );
    if (inserted.length === 0) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
        message: `idempotency outcome ${jobSubmissionKey(identity)} lost a concurrent first write (fail closed)`,
      });
    }
  }

  async find(identity: JobSubmissionIdentity): Promise<RecordedIdempotencyOutcome | undefined> {
    return this.findRaw(this.gate(), identity);
  }

  private async findRaw(
    transport: SqlTransport,
    identity: JobSubmissionIdentity,
  ): Promise<RecordedIdempotencyOutcome | undefined> {
    const rows = await executeStatement(transport, selectIdempotencyOutcomeStatement(identity));
    if (rows.length === 0) return undefined;
    const row = rows[0] as SqlRow;
    return Object.freeze({
      idempotencyScope: String(row['idempotency_scope']),
      idempotencyKey: row['idempotency_key'] as never,
      correlationId: row['correlation_id'] as never,
      outcome: deepFreezeJson(rowJson(row['outcome'])) as Readonly<Record<string, unknown>>,
      recordedAt: numeric(row['recorded_at']),
    });
  }
}

function canonicalJsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function deepFreezeJson(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreezeJson((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// DurableJobStore
// ---------------------------------------------------------------------------

/**
 * The ONE shared durable job store over arena_job_record
 * (ADR-P001-01). Satisfies the job orchestrator's JobStore port
 * structurally; the lease/dead-letter operations are the host runner's
 * claiming semantics (see services/runtime-host).
 */
export class DurableJobStore extends GatedTransport implements JobStorePort {
  async insert(record: JobRecord): Promise<void> {
    const transport = this.gate();
    if (!isJobRecord(record)) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: 'job record is not a valid protocol record (fail closed)',
      });
    }
    const identity = jobSubmissionIdentityOf(record);
    const existingId = await executeStatement(transport, selectJobRecordStatement(record.jobId));
    if (existingId.length > 0) {
      throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `job id ${record.jobId} is already taken (job ids are unique)`,
        details: { jobId: record.jobId },
      });
    }
    const existingSubmission = await executeStatement(
      transport,
      selectJobBySubmissionStatement(identity),
    );
    if (existingSubmission.length > 0) {
      throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `submission ${jobSubmissionKey(identity)} is already bound to job ${(existingSubmission[0] as SqlRow)['job_id']}`,
        details: { submission: jobSubmissionKey(identity) },
      });
    }
    const inserted = await executeStatement(
      transport,
      insertJobRecordStatement({
        jobId: record.jobId,
        kindNamespace: record.kind.namespace,
        kindName: record.kind.name,
        kindVersion: record.kind.version,
        definitionDigest: record.definitionDigest,
        correlationId: record.correlationId,
        idempotencyScope: record.idempotencyScope,
        idempotencyKey: record.idempotencyKey,
        lens: null,
        status: record.status,
        attempts: record.attempts,
        eventsLength: record.events.length,
        recordJson: JSON.stringify(record),
        createdAt: this.clock.now(),
        updatedAt: this.clock.now(),
      }),
    );
    if (inserted.length === 0) {
      throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `job id ${record.jobId} lost a concurrent insert (fail closed)`,
        details: { jobId: record.jobId },
      });
    }
  }

  async update(record: JobRecord): Promise<void> {
    const transport = this.gate();
    if (!isJobRecord(record)) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: 'job record is not a valid protocol record (fail closed)',
      });
    }
    const currentRows = await executeStatement(transport, selectJobRecordStatement(record.jobId));
    if (currentRows.length === 0) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: `job ${record.jobId} does not exist; only existing records can be updated`,
        details: { jobId: record.jobId },
      });
    }
    const current = toJobRecord(currentRows[0] as SqlRow);
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
    const updated = await executeStatement(
      transport,
      updateJobRecordStatement({
        jobId: record.jobId,
        kindNamespace: record.kind.namespace,
        kindName: record.kind.name,
        kindVersion: record.kind.version,
        definitionDigest: record.definitionDigest,
        correlationId: record.correlationId,
        idempotencyScope: record.idempotencyScope,
        idempotencyKey: record.idempotencyKey,
        lens: jobLens(currentRows[0] as SqlRow),
        status: record.status,
        attempts: record.attempts,
        eventsLength: record.events.length,
        recordJson: JSON.stringify(record),
        updatedAt: this.clock.now(),
      }),
    );
    if (updated.length === 0) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `job ${record.jobId} update lost the append-only guard (concurrent update won)`,
        details: { jobId: record.jobId },
      });
    }
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectJobRecordStatement(jobId));
    return rows.length > 0 ? toJobRecord(rows[0] as SqlRow) : undefined;
  }

  async findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<JobRecord | undefined> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectJobBySubmissionStatement(identity));
    if (rows.length === 0) return undefined;
    const candidate = toJobRecord(rows[0] as SqlRow);
    if (!isSameJobSubmission(jobSubmissionIdentityOf(candidate), identity)) return undefined;
    return candidate;
  }

  async findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]> {
    const transport = this.gate();
    const rows = await executeStatement(
      transport,
      selectJobsByCorrelationStatement(correlationId),
    );
    return Object.freeze(rows.map((row) => toJobRecord(row)));
  }

  async list(): Promise<readonly JobRecord[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllJobsStatement());
    return Object.freeze(rows.map((row) => toJobRecord(row)));
  }

  // -- host-side claiming semantics (ADR-P001-01) --------------------------

  /** Stamp the execution lease on a job (owner + expiry). */
  async stampLease(jobId: string, leaseOwner: string, leaseExpiresAt: number): Promise<void> {
    const transport = this.gate();
    await executeStatement(
      transport,
      stampJobLeaseStatement({ jobId, leaseOwner, leaseExpiresAt }),
    );
  }

  /** Reclaim expired leases: returns the reclaimed job ids. */
  async clearExpiredLeases(now: number): Promise<readonly string[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, clearExpiredJobLeasesStatement(now));
    return Object.freeze(rows.map((row) => String((row as SqlRow)['job_id'])));
  }

  /** Park a poison job in the dead-letter lot (idempotent on job_id). */
  async markDeadLetter(jobId: string, reason: string): Promise<void> {
    const transport = this.gate();
    const record = await this.get(jobId);
    if (record === undefined) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: `job ${jobId} does not exist; only existing jobs can be dead-lettered`,
        details: { jobId },
      });
    }
    await executeStatement(
      transport,
      insertDeadLetterStatement({
        jobId,
        reason,
        recordJson: JSON.stringify(record),
        movedAt: this.clock.now(),
      }),
    );
  }

  /** The dead-letter lot (operator surface). */
  async listDeadLetters(): Promise<readonly { jobId: string; reason: string }[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectDeadLettersStatement());
    return Object.freeze(
      rows.map((row) => {
        const typed = row as SqlRow;
        return Object.freeze({
          jobId: String(typed['job_id']),
          reason: String(typed['reason']),
        });
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// DurableEventSink
// ---------------------------------------------------------------------------

/**
 * The durable event sink over arena_job_event + arena_audit_record.
 * The audit-chain tail is cached in memory and MUST be hydrated after a
 * restart (hydrate()) — a stale cache would compute a duplicate audit
 * sequence, which appendAuditEvent detects and rejects (fail closed).
 */
export class DurableEventSink extends GatedTransport implements EventSinkPort {
  private auditTail: AuditRecord | null = null;
  private hydrated = false;

  /**
   * Load the audit-chain tail from the durable store. The host calls this
   * once during start (before any mutation flows) — the cache then stays
   * current because every append updates it.
   */
  async hydrate(): Promise<void> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectLastAuditRecordStatement());
    this.auditTail = rows.length > 0 ? toAuditRecord(rows[0] as SqlRow) : null;
    this.hydrated = true;
  }

  async appendJobEvent(envelope: Envelope<JobEvent>): Promise<void> {
    const transport = this.gate();
    const jobId = envelope.payload.jobId;
    // Rebuild the per-job log from the durable rows and append through the
    // PROTOCOL validator (contiguity, gap/duplicate rejection) — the same
    // discipline the in-memory sink applies at the persistence boundary.
    const rows = await executeStatement(transport, selectJobEventsStatement(jobId));
    let log = createJobEventLog(jobId);
    for (const row of rows) {
      log = appendJobEventEnvelope(log, rowJson((row as SqlRow)['envelope']) as Envelope<JobEvent>);
    }
    const next = appendJobEventEnvelope(log, envelope);
    const appendedEnvelope = next.envelopes[next.envelopes.length - 1];
    if (appendedEnvelope === undefined) {
      throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
        message: `job ${jobId} produced no appended envelope (protocol violation)`,
      });
    }
    await executeStatement(
      transport,
      insertJobEventStatement({
        jobId,
        sequence: appendedEnvelope.payload.sequence,
        envelopeJson: JSON.stringify(envelope),
        appendedAt: this.clock.now(),
      }),
    );
  }

  async appendAuditEvent(envelope: Envelope<MutationAuditedEvent>): Promise<AuditRecord> {
    const transport = this.gate();
    if (envelope.payload.kind !== 'mutation-audited') {
      throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
        message: `appendAuditEvent requires a mutation-audited envelope, got ${String(envelope.payload.kind)}`,
      });
    }
    // Cross-check the durable tail: a stale cache computing a duplicate
    // sequence must fail closed, never silently drop the audit record.
    const tailRows = await executeStatement(transport, selectLastAuditRecordStatement());
    const durableTail = tailRows.length > 0 ? toAuditRecord(tailRows[0] as SqlRow) : null;
    if (durableTail !== null && envelope.payload.sequence !== durableTail.sequence + 1) {
      throw new JobError(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
        message: `audit sequence ${String(envelope.payload.sequence)} does not continue the durable chain tail ${String(durableTail.sequence)} (hydrate the sink after a restart; fail closed)`,
        details: { attempted: envelope.payload.sequence, durableTail: durableTail.sequence },
      });
    }
    if (durableTail === null && envelope.payload.sequence !== 1) {
      throw new JobError(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
        message: `audit sequence ${String(envelope.payload.sequence)} does not start a fresh chain (expected 1)`,
      });
    }
    // Chain through the protocol (digest includes the previous digest).
    const chainedLog = await appendAuditRecord(
      durableTail === null ? { records: [] } : { records: [durableTail] },
      envelope.payload,
    );
    const record = chainedLog.records[chainedLog.records.length - 1];
    if (record === undefined) {
      throw new JobError(JOB_ERROR_CODES.AUDIT_CHAIN_BROKEN, {
        message: 'appendAuditEvent failed to chain the audit record',
      });
    }
    await executeStatement(
      transport,
      insertAuditRecordStatement({
        sequence: record.sequence,
        previousDigest: record.previousDigest,
        digest: record.digest,
        payloadJson: JSON.stringify(record.payload),
        appendedAt: this.clock.now(),
      }),
    );
    this.auditTail = record;
    this.hydrated = true;
    return record;
  }

  lastAuditRecord(): AuditRecord | null {
    // The cached tail (hydrated at start; updated on every append). When
    // not yet hydrated this reports null — the same empty-stream view a
    // fresh sink has; appendAuditEvent cross-checks against the durable
    // tail so a stale cache can never corrupt the chain.
    return this.auditTail;
  }

  /** True once hydrate() loaded the durable tail (host wiring check). */
  get isHydrated(): boolean {
    return this.hydrated;
  }

  /** The full durable audit chain (verification / evidence surface). */
  async auditRecords(): Promise<readonly AuditRecord[]> {
    const transport = this.gate();
    const rows = await executeStatement(transport, selectAllAuditRecordsStatement());
    return Object.freeze(rows.map((row) => toAuditRecord(row)));
  }
}

function toAuditRecord(row: SqlRow): AuditRecord {
  const payload = rowJson(row['payload']);
  return Object.freeze({
    sequence: Number(row['sequence']),
    previousDigest: String(row['previous_digest']),
    digest: String(row['digest']),
    payload: deepFreezeJson(payload) as MutationAuditedEvent,
  });
}

// ---------------------------------------------------------------------------
// DurableProjectionStateStore
// ---------------------------------------------------------------------------

/** The durable projection checkpoint store over arena_projection_state. */
export class DurableProjectionStateStore
  extends GatedTransport
  implements ProjectionStateStorePort
{
  async save(state: ProjectionState): Promise<void> {
    const transport = this.gate();
    const current = await this.get(state.projection, state.tenantId);
    if (current !== null && state.position < current.position) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `projection ${state.projection} position cannot regress (monotone; fail closed)`,
        details: { projection: state.projection, current: current.position, attempted: state.position },
      });
    }
    await executeStatement(
      transport,
      upsertProjectionStateStatement({
        projection: state.projection,
        tenantId: state.tenantId,
        position: state.position,
        updatedAt: state.updatedAt,
      }),
    );
  }

  async get(projection: string, tenantId: string): Promise<ProjectionState | null> {
    const transport = this.gate();
    const rows = await executeStatement(
      transport,
      selectProjectionStateStatement(projection, tenantId),
    );
    if (rows.length === 0) return null;
    const row = rows[0] as SqlRow;
    return Object.freeze({
      projection: String(row['projection']),
      tenantId: String(row['tenant_id']),
      position: Number(row['position']),
      updatedAt: numeric(row['updated_at']),
    });
  }
}
