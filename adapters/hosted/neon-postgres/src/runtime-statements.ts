/**
 * Named parameterized SQL statements for the durable host-runtime tables
 * (Work Order P002; issue #154; ADR-P001-01/02/07). Pure data: every
 * statement is a (name, sql, params) triple, so the SQL surface stays
 * reviewable and unit-testable without a live database — the same
 * discipline statements.ts established for the control-plane tables.
 *
 * Tables (migrations 0003-0006):
 *   arena_escalation_record     — escalation lifecycle snapshots + lens
 *   arena_escalation_event      — append-only lifecycle event records
 *   arena_webhook_outbox        — the durable at-least-once webhook outbox
 *   arena_job_record            — job snapshots + claim/lease columns
 *   arena_job_event             — per-job append-only event envelopes
 *   arena_audit_record          — the tamper-evident audit chain
 *   arena_job_dead_letter       — the poison-job lot (ADR-P001-01)
 *   arena_runtime_idempotency   — recorded outcomes for deterministic replay
 *   arena_projection_state      — projection sweep checkpoints
 *   arena_payment_ledger        — payment escrow ledger snapshots (F-09)
 *   arena_payment_ledger_entry  — per-operation entry rows (UNIQUE operation
 *                                 key — the durable exactly-once gate)
 *   arena_payment_outbox        — the durable payment event outbox (F-09)
 */

import type { JsonSafeValue } from '@arena/persistence';
import type { SqlStatement } from './sql-transport.js';

const ESCALATION_RECORD_COLUMNS =
  'request_id, tenant_id, lens, state, correlation_id, idempotency_scope, idempotency_key, history_length, record, created_at, updated_at';
const JOB_RECORD_COLUMNS =
  'job_id, kind_namespace, kind_name, kind_version, definition_digest, correlation_id, idempotency_scope, idempotency_key, lens, status, attempts, events_length, record, lease_owner, lease_expires_at, created_at, updated_at';

// ---------------------------------------------------------------------------
// Escalation lifecycle records
// ---------------------------------------------------------------------------

export function insertEscalationRecordStatement(row: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly lens: string;
  readonly state: string;
  readonly correlationId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly historyLength: number;
  readonly recordJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'insert_escalation_record',
    // RETURNING request_id: a REAL Postgres returns zero rows for a
    // plain INSERT ... ON CONFLICT DO NOTHING on BOTH success and
    // conflict — the RETURNING row is the ONLY success signal the
    // caller can dispatch on (the same shape insert_webhook_delivery /
    // insert_job_record / record_idempotency_outcome carry). Found by
    // the P002 real-database acceptance battery (PGlite).
    sql: `INSERT INTO arena_escalation_record (${ESCALATION_RECORD_COLUMNS})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
ON CONFLICT (request_id) DO NOTHING
RETURNING request_id`,
    params: [
      row.requestId,
      row.tenantId,
      row.lens,
      row.state,
      row.correlationId,
      row.idempotencyScope,
      row.idempotencyKey,
      row.historyLength,
      row.recordJson,
      row.createdAt,
      row.updatedAt,
    ],
  };
}

export function selectEscalationRecordStatement(requestId: string): SqlStatement {
  return {
    name: 'select_escalation_record',
    sql: `SELECT ${ESCALATION_RECORD_COLUMNS} FROM arena_escalation_record WHERE request_id = $1`,
    params: [requestId],
  };
}

export function selectEscalationBySubmissionStatement(input: {
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): SqlStatement {
  return {
    name: 'select_escalation_by_submission',
    sql: `SELECT ${ESCALATION_RECORD_COLUMNS} FROM arena_escalation_record
WHERE idempotency_scope = $1 AND idempotency_key = $2 AND correlation_id = $3`,
    params: [input.idempotencyScope, input.idempotencyKey, input.correlationId],
  };
}

export function selectEscalationsByCorrelationStatement(
  tenantId: string,
  correlationId: string,
): SqlStatement {
  return {
    name: 'select_escalations_by_correlation',
    sql: `SELECT ${ESCALATION_RECORD_COLUMNS} FROM arena_escalation_record
WHERE tenant_id = $1 AND correlation_id = $2 ORDER BY request_id ASC`,
    params: [tenantId, correlationId],
  };
}

export function selectAllEscalationsStatement(): SqlStatement {
  return {
    name: 'select_all_escalations',
    sql: `SELECT ${ESCALATION_RECORD_COLUMNS} FROM arena_escalation_record ORDER BY request_id ASC`,
    params: [],
  };
}

/**
 * Replace the lifecycle snapshot. The guard is append-only at the event
 * level: the new history must be STRICTLY LONGER than the stored one
 * (a same-length rewrite is also rejected — lifecycle moves forward).
 */
export function updateEscalationRecordStatement(row: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly lens: string;
  readonly state: string;
  readonly correlationId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly historyLength: number;
  readonly recordJson: string;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'update_escalation_record',
    sql: `UPDATE arena_escalation_record
SET tenant_id = $2, lens = $3, state = $4, correlation_id = $5,
    idempotency_scope = $6, idempotency_key = $7, history_length = $8,
    record = $9::jsonb, updated_at = $10
WHERE request_id = $1 AND history_length < $8
RETURNING ${ESCALATION_RECORD_COLUMNS}`,
    params: [
      row.requestId,
      row.tenantId,
      row.lens,
      row.state,
      row.correlationId,
      row.idempotencyScope,
      row.idempotencyKey,
      row.historyLength,
      row.recordJson,
      row.updatedAt,
    ],
  };
}

/** Append one lifecycle event record (idempotent on (request_id, sequence)). */
export function appendEscalationEventStatement(input: {
  readonly requestId: string;
  readonly sequence: number;
  readonly tenantId: string;
  readonly eventJson: string;
  readonly appendedAt: number;
}): SqlStatement {
  return {
    name: 'append_escalation_event',
    sql: `INSERT INTO arena_escalation_event (request_id, sequence, tenant_id, event, appended_at)
VALUES ($1, $2, $3, $4::jsonb, $5)
ON CONFLICT (request_id, sequence) DO NOTHING`,
    params: [input.requestId, input.sequence, input.tenantId, input.eventJson, input.appendedAt],
  };
}

export function selectEscalationEventsStatement(requestId: string): SqlStatement {
  return {
    name: 'select_escalation_events',
    sql: 'SELECT request_id, sequence, tenant_id, event, appended_at FROM arena_escalation_event WHERE request_id = $1 ORDER BY sequence ASC',
    params: [requestId],
  };
}

// ---------------------------------------------------------------------------
// Webhook outbox (durable, at-least-once)
// ---------------------------------------------------------------------------

export function insertWebhookDeliveryStatement(input: {
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly payload: string;
  readonly createdAt: number;
}): SqlStatement {
  return {
    name: 'insert_webhook_delivery',
    sql: `INSERT INTO arena_webhook_outbox (event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at)
VALUES ($1, $2, $3, $4, $5, $6, NULL)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id`,
    params: [input.eventId, input.requestId, input.tenantId, input.sequence, input.payload, input.createdAt],
  };
}

export function selectPendingWebhookDeliveriesStatement(): SqlStatement {
  return {
    name: 'select_pending_webhook_deliveries',
    sql: `SELECT event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at
FROM arena_webhook_outbox WHERE delivered_at IS NULL ORDER BY created_at ASC, event_id ASC`,
    params: [],
  };
}

export function selectAllWebhookDeliveriesStatement(): SqlStatement {
  return {
    name: 'select_all_webhook_deliveries',
    sql: `SELECT event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at
FROM arena_webhook_outbox ORDER BY created_at ASC, event_id ASC`,
    params: [],
  };
}

/** Idempotent delivered-mark: only an UNDELIVERED row flips (RETURNING). */
export function markWebhookDeliveryDeliveredStatement(
  eventId: string,
  deliveredAt: number,
): SqlStatement {
  return {
    name: 'mark_webhook_delivery_delivered',
    sql: `UPDATE arena_webhook_outbox SET delivered_at = $2
WHERE event_id = $1 AND delivered_at IS NULL RETURNING event_id`,
    params: [eventId, deliveredAt],
  };
}

// ---------------------------------------------------------------------------
// Idempotency outcomes (deterministic replay)
// ---------------------------------------------------------------------------

export function recordIdempotencyOutcomeStatement(input: {
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly outcomeJson: string;
  readonly recordedAt: number;
}): SqlStatement {
  return {
    name: 'record_idempotency_outcome',
    sql: `INSERT INTO arena_runtime_idempotency (idempotency_scope, idempotency_key, correlation_id, outcome, recorded_at)
VALUES ($1, $2, $3, $4::jsonb, $5)
ON CONFLICT (idempotency_scope, idempotency_key, correlation_id) DO NOTHING
RETURNING idempotency_key`,
    params: [
      input.idempotencyScope,
      input.idempotencyKey,
      input.correlationId,
      input.outcomeJson,
      input.recordedAt,
    ],
  };
}

export function selectIdempotencyOutcomeStatement(input: {
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): SqlStatement {
  return {
    name: 'select_idempotency_outcome',
    sql: `SELECT idempotency_scope, idempotency_key, correlation_id, outcome, recorded_at
FROM arena_runtime_idempotency
WHERE idempotency_scope = $1 AND idempotency_key = $2 AND correlation_id = $3`,
    params: [input.idempotencyScope, input.idempotencyKey, input.correlationId],
  };
}

// ---------------------------------------------------------------------------
// Job records (claim/lease/dead-letter per ADR-P001-01)
// ---------------------------------------------------------------------------

export function insertJobRecordStatement(row: {
  readonly jobId: string;
  readonly kindNamespace: string;
  readonly kindName: string;
  readonly kindVersion: string;
  readonly definitionDigest: string;
  readonly correlationId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly lens: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly eventsLength: number;
  readonly recordJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'insert_job_record',
    sql: `INSERT INTO arena_job_record (${JOB_RECORD_COLUMNS})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, NULL, NULL, $14, $15)
ON CONFLICT (job_id) DO NOTHING
RETURNING job_id`,
    params: [
      row.jobId,
      row.kindNamespace,
      row.kindName,
      row.kindVersion,
      row.definitionDigest,
      row.correlationId,
      row.idempotencyScope,
      row.idempotencyKey,
      row.lens,
      row.status,
      row.attempts,
      row.eventsLength,
      row.recordJson,
      row.createdAt,
      row.updatedAt,
    ],
  };
}

export function selectJobRecordStatement(jobId: string): SqlStatement {
  return {
    name: 'select_job_record',
    sql: `SELECT ${JOB_RECORD_COLUMNS} FROM arena_job_record WHERE job_id = $1`,
    params: [jobId],
  };
}

export function selectJobBySubmissionStatement(input: {
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): SqlStatement {
  return {
    name: 'select_job_by_submission',
    sql: `SELECT ${JOB_RECORD_COLUMNS} FROM arena_job_record
WHERE idempotency_scope = $1 AND idempotency_key = $2 AND correlation_id = $3`,
    params: [input.idempotencyScope, input.idempotencyKey, input.correlationId],
  };
}

export function selectJobsByCorrelationStatement(correlationId: string): SqlStatement {
  return {
    name: 'select_jobs_by_correlation',
    sql: `SELECT ${JOB_RECORD_COLUMNS} FROM arena_job_record
WHERE correlation_id = $1 ORDER BY job_id ASC`,
    params: [correlationId],
  };
}

export function selectAllJobsStatement(): SqlStatement {
  return {
    name: 'select_all_jobs',
    sql: `SELECT ${JOB_RECORD_COLUMNS} FROM arena_job_record ORDER BY job_id ASC`,
    params: [],
  };
}

/**
 * Replace the job snapshot. Append-only guard identical to the escalation
 * one: the new embedded event history must be strictly longer, and the
 * submission identity columns are immutable (guarded in the adapter).
 */
export function updateJobRecordStatement(row: {
  readonly jobId: string;
  readonly kindNamespace: string;
  readonly kindName: string;
  readonly kindVersion: string;
  readonly definitionDigest: string;
  readonly correlationId: string;
  readonly idempotencyScope: string;
  readonly idempotencyKey: string;
  readonly lens: string | null;
  readonly status: string;
  readonly attempts: number;
  readonly eventsLength: number;
  readonly recordJson: string;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'update_job_record',
    sql: `UPDATE arena_job_record
SET kind_namespace = $2, kind_name = $3, kind_version = $4, definition_digest = $5,
    correlation_id = $6, idempotency_scope = $7, idempotency_key = $8, lens = $9,
    status = $10, attempts = $11, events_length = $12, record = $13::jsonb, updated_at = $14
WHERE job_id = $1 AND events_length < $12
RETURNING ${JOB_RECORD_COLUMNS}`,
    params: [
      row.jobId,
      row.kindNamespace,
      row.kindName,
      row.kindVersion,
      row.definitionDigest,
      row.correlationId,
      row.idempotencyScope,
      row.idempotencyKey,
      row.lens,
      row.status,
      row.attempts,
      row.eventsLength,
      row.recordJson,
      row.updatedAt,
    ],
  };
}

/** Stamp the execution lease on a job (the claiming semantics' lock). */
export function stampJobLeaseStatement(input: {
  readonly jobId: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: number;
}): SqlStatement {
  return {
    name: 'stamp_job_lease',
    sql: `UPDATE arena_job_record SET lease_owner = $2, lease_expires_at = $3
WHERE job_id = $1 RETURNING job_id`,
    params: [input.jobId, input.leaseOwner, input.leaseExpiresAt],
  };
}

/**
 * Reclaim expired leases (the restart-recovery path): running jobs whose
 * lease has elapsed lose the lease; the sweep then fails the orphaned
 * attempt through the protocol (requeue or terminal by retry policy).
 */
export function clearExpiredJobLeasesStatement(now: number): SqlStatement {
  return {
    name: 'clear_expired_job_leases',
    sql: `UPDATE arena_job_record SET lease_owner = NULL, lease_expires_at = NULL
WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1
RETURNING job_id`,
    params: [now],
  };
}

/** Park a poison job in the dead-letter lot (idempotent on job_id). */
export function insertDeadLetterStatement(input: {
  readonly jobId: string;
  readonly reason: string;
  readonly recordJson: string;
  readonly movedAt: number;
}): SqlStatement {
  return {
    name: 'insert_dead_letter',
    sql: `INSERT INTO arena_job_dead_letter (job_id, reason, record, moved_at)
VALUES ($1, $2, $3::jsonb, $4)
ON CONFLICT (job_id) DO NOTHING`,
    params: [input.jobId, input.reason, input.recordJson, input.movedAt],
  };
}

export function selectDeadLettersStatement(): SqlStatement {
  return {
    name: 'select_dead_letters',
    sql: 'SELECT job_id, reason, record, moved_at FROM arena_job_dead_letter ORDER BY moved_at ASC, job_id ASC',
    params: [],
  };
}

// ---------------------------------------------------------------------------
// Job event envelopes + the tamper-evident audit chain
// ---------------------------------------------------------------------------

export function insertJobEventStatement(input: {
  readonly jobId: string;
  readonly sequence: number;
  readonly envelopeJson: string;
  readonly appendedAt: number;
}): SqlStatement {
  return {
    name: 'insert_job_event',
    sql: `INSERT INTO arena_job_event (job_id, sequence, envelope, appended_at)
VALUES ($1, $2, $3::jsonb, $4)
ON CONFLICT (job_id, sequence) DO NOTHING`,
    params: [input.jobId, input.sequence, input.envelopeJson, input.appendedAt],
  };
}

export function selectJobEventsStatement(jobId: string): SqlStatement {
  return {
    name: 'select_job_events',
    sql: 'SELECT job_id, sequence, envelope, appended_at FROM arena_job_event WHERE job_id = $1 ORDER BY sequence ASC',
    params: [jobId],
  };
}

export function insertAuditRecordStatement(input: {
  readonly sequence: number;
  readonly previousDigest: string;
  readonly digest: string;
  readonly payloadJson: string;
  readonly appendedAt: number;
}): SqlStatement {
  return {
    name: 'insert_audit_record',
    sql: `INSERT INTO arena_audit_record (sequence, previous_digest, digest, payload, appended_at)
VALUES ($1, $2, $3, $4::jsonb, $5)
ON CONFLICT (sequence) DO NOTHING`,
    params: [input.sequence, input.previousDigest, input.digest, input.payloadJson, input.appendedAt],
  };
}

export function selectLastAuditRecordStatement(): SqlStatement {
  return {
    name: 'select_last_audit_record',
    sql: 'SELECT sequence, previous_digest, digest, payload, appended_at FROM arena_audit_record ORDER BY sequence DESC LIMIT 1',
    params: [],
  };
}

export function selectAllAuditRecordsStatement(): SqlStatement {
  return {
    name: 'select_all_audit_records',
    sql: 'SELECT sequence, previous_digest, digest, payload, appended_at FROM arena_audit_record ORDER BY sequence ASC',
    params: [],
  };
}

// ---------------------------------------------------------------------------
// Payment escrow ledger + entry rows + the payment event outbox
// (P002-F1; F-09 remediation — migration 0006)
// ---------------------------------------------------------------------------

const PAYMENT_LEDGER_COLUMNS =
  'request_id, tenant_id, correlation_id, currency, truth, state, entries_length, ledger, created_at, updated_at';

export function insertPaymentLedgerStatement(row: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly truth: string;
  readonly state: string;
  readonly entriesLength: number;
  readonly ledgerJson: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'insert_payment_ledger',
    // RETURNING request_id: zero rows means the INSERT lost the primary-key
    // race — the ONLY success signal the caller can dispatch on (the
    // insert_escalation_record / insert_job_record shape).
    sql: `INSERT INTO arena_payment_ledger (${PAYMENT_LEDGER_COLUMNS})
VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
ON CONFLICT (request_id) DO NOTHING
RETURNING request_id`,
    params: [
      row.requestId,
      row.tenantId,
      row.correlationId,
      row.currency,
      row.truth,
      row.state,
      row.entriesLength,
      row.ledgerJson,
      row.createdAt,
      row.updatedAt,
    ],
  };
}

export function selectPaymentLedgerStatement(requestId: string): SqlStatement {
  return {
    name: 'select_payment_ledger',
    sql: `SELECT ${PAYMENT_LEDGER_COLUMNS} FROM arena_payment_ledger WHERE request_id = $1`,
    params: [requestId],
  };
}

export function selectAllPaymentLedgersStatement(): SqlStatement {
  return {
    name: 'select_all_payment_ledgers',
    sql: `SELECT ${PAYMENT_LEDGER_COLUMNS} FROM arena_payment_ledger ORDER BY request_id ASC`,
    params: [],
  };
}

/**
 * Replace the ledger snapshot. Append-only guard identical to the escalation/
 * job snapshots: the new entry history must be STRICTLY LONGER than the
 * stored one — a regressing or same-length rewrite is unrepresentable at the
 * SQL layer, so a concurrent update race surfaces as zero rows (the caller
 * resolves the typed revision conflict).
 */
export function updatePaymentLedgerStatement(row: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly truth: string;
  readonly state: string;
  readonly entriesLength: number;
  readonly ledgerJson: string;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'update_payment_ledger',
    sql: `UPDATE arena_payment_ledger
SET tenant_id = $2, correlation_id = $3, currency = $4, truth = $5,
    state = $6, entries_length = $7, ledger = $8::jsonb, updated_at = $9
WHERE request_id = $1 AND entries_length < $7
RETURNING request_id`,
    params: [
      row.requestId,
      row.tenantId,
      row.correlationId,
      row.currency,
      row.truth,
      row.state,
      row.entriesLength,
      row.ledgerJson,
      row.updatedAt,
    ],
  };
}

/**
 * Append one ledger entry row (idempotent on (request_id, sequence)). The
 * UNIQUE (request_id, operation_key) index is THE exactly-once gate: a
 * same-key row at a different sequence RAISES instead of silently skipping,
 * so the storage layer alone makes a double-application unrepresentable.
 */
export function insertPaymentLedgerEntryStatement(input: {
  readonly requestId: string;
  readonly sequence: number;
  readonly operationKey: string;
  readonly tenantId: string;
  readonly entryJson: string;
  readonly appendedAt: number;
}): SqlStatement {
  return {
    name: 'insert_payment_ledger_entry',
    sql: `INSERT INTO arena_payment_ledger_entry (request_id, sequence, operation_key, tenant_id, entry, appended_at)
VALUES ($1, $2, $3, $4, $5::jsonb, $6)
ON CONFLICT (request_id, sequence) DO NOTHING
RETURNING sequence`,
    params: [
      input.requestId,
      input.sequence,
      input.operationKey,
      input.tenantId,
      input.entryJson,
      input.appendedAt,
    ],
  };
}

export function insertPaymentOutboxDeliveryStatement(input: {
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  readonly payload: string;
  readonly createdAt: number;
}): SqlStatement {
  return {
    name: 'insert_payment_outbox_delivery',
    sql: `INSERT INTO arena_payment_outbox (event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at)
VALUES ($1, $2, $3, $4, $5, $6, NULL)
ON CONFLICT (event_id) DO NOTHING
RETURNING event_id`,
    params: [input.eventId, input.requestId, input.tenantId, input.sequence, input.payload, input.createdAt],
  };
}

export function selectPendingPaymentOutboxDeliveriesStatement(): SqlStatement {
  return {
    name: 'select_pending_payment_outbox_deliveries',
    sql: `SELECT event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at
FROM arena_payment_outbox WHERE delivered_at IS NULL ORDER BY created_at ASC, event_id ASC`,
    params: [],
  };
}

export function selectAllPaymentOutboxDeliveriesStatement(): SqlStatement {
  return {
    name: 'select_all_payment_outbox_deliveries',
    sql: `SELECT event_id, request_id, tenant_id, sequence, payload, created_at, delivered_at
FROM arena_payment_outbox ORDER BY created_at ASC, event_id ASC`,
    params: [],
  };
}

/** Idempotent delivered-mark: only an UNDELIVERED row flips (RETURNING). */
export function markPaymentOutboxDeliveryDeliveredStatement(
  eventId: string,
  deliveredAt: number,
): SqlStatement {
  return {
    name: 'mark_payment_outbox_delivery_delivered',
    sql: `UPDATE arena_payment_outbox SET delivered_at = $2
WHERE event_id = $1 AND delivered_at IS NULL RETURNING event_id`,
    params: [eventId, deliveredAt],
  };
}

// ---------------------------------------------------------------------------
// Projection state
// ---------------------------------------------------------------------------

export function upsertProjectionStateStatement(input: {
  readonly projection: string;
  readonly tenantId: string;
  readonly position: number;
  readonly updatedAt: number;
}): SqlStatement {
  return {
    name: 'upsert_projection_state',
    sql: `INSERT INTO arena_projection_state (projection, tenant_id, position, updated_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (projection, tenant_id) DO UPDATE
SET position = excluded.position, updated_at = excluded.updated_at`,
    params: [input.projection, input.tenantId, input.position, input.updatedAt],
  };
}

export function selectProjectionStateStatement(
  projection: string,
  tenantId: string,
): SqlStatement {
  return {
    name: 'select_projection_state',
    sql: 'SELECT projection, tenant_id, position, updated_at FROM arena_projection_state WHERE projection = $1 AND tenant_id = $2',
    params: [projection, tenantId],
  };
}

/** The closed runtime statement-name vocabulary (mirrors SQL_STATEMENT_NAMES). */
export const RUNTIME_SQL_STATEMENT_NAMES = Object.freeze([
  'insert_escalation_record',
  'select_escalation_record',
  'select_escalation_by_submission',
  'select_escalations_by_correlation',
  'select_all_escalations',
  'update_escalation_record',
  'append_escalation_event',
  'select_escalation_events',
  'insert_webhook_delivery',
  'select_pending_webhook_deliveries',
  'select_all_webhook_deliveries',
  'mark_webhook_delivery_delivered',
  'record_idempotency_outcome',
  'select_idempotency_outcome',
  'insert_job_record',
  'select_job_record',
  'select_job_by_submission',
  'select_jobs_by_correlation',
  'select_all_jobs',
  'update_job_record',
  'stamp_job_lease',
  'clear_expired_job_leases',
  'insert_dead_letter',
  'select_dead_letters',
  'insert_job_event',
  'select_job_events',
  'insert_audit_record',
  'select_last_audit_record',
  'select_all_audit_records',
  'upsert_projection_state',
  'select_projection_state',
  'insert_payment_ledger',
  'select_payment_ledger',
  'select_all_payment_ledgers',
  'update_payment_ledger',
  'insert_payment_ledger_entry',
  'insert_payment_outbox_delivery',
  'select_pending_payment_outbox_deliveries',
  'select_all_payment_outbox_deliveries',
  'mark_payment_outbox_delivery_delivered',
] as const);

export type RuntimeSqlStatementName = (typeof RUNTIME_SQL_STATEMENT_NAMES)[number];

/** JSON-value helper shared with the control-plane statements (stringify). */
export function toJsonParam(value: JsonSafeValue | Readonly<Record<string, unknown>>): string {
  return JSON.stringify(value);
}
