/**
 * TEST-ONLY in-memory reference transport for the durable host-runtime
 * statement set (Work Order P002; issue #154).
 *
 * This mirrors FakeSqlTransport's discipline (adapters/hosted/
 * neon-postgres/src/test-support.ts — private to its package, so this
 * battery-local twin exists) for the RUNTIME statements: an in-memory,
 * PostgreSQL-ish implementation of every named statement the durable
 * ports issue. It exists so the composition root's OWN unit tests run
 * without any database — the same FT2.0 "Local parity" posture the
 * control-plane contract suite established.
 *
 * EVIDENCE CLASS DISCLOSURE: this is a reference fabric, NOT a database.
 * The P002 acceptance evidence (migrate-from-zero, round-trip, restart
 * resume, deterministic replay, cross-tenant fail-closed) is produced
 * against REAL Postgres: an embedded real Postgres in the CI battery
 * (tests/runtime-host) and live Neon in the evidence run. This file is
 * unit-test scaffolding only — never a runtime path (ADR-P001-01
 * alternative 3 rejected in-memory fabrics as the production path).
 *
 * NOT exported from the package index (A033 hygiene: test-support stays
 * private; the tests/runtime-host battery reaches it through an explicit
 * source alias, the deploy/src/hosted precedent).
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '@arena/persistence';
import type { SqlRow, SqlStatement, SqlTransport } from '@arena/hosted-neon-postgres';

interface EscalationRow {
  request_id: string;
  tenant_id: string;
  lens: string;
  state: string;
  correlation_id: string;
  idempotency_scope: string;
  idempotency_key: string;
  history_length: number;
  record: unknown;
  created_at: number;
  updated_at: number;
}

interface EscalationEventRow {
  request_id: string;
  sequence: number;
  tenant_id: string;
  event: unknown;
  appended_at: number;
}

interface WebhookRow {
  event_id: string;
  request_id: string;
  tenant_id: string;
  sequence: number;
  payload: string;
  created_at: number;
  delivered_at: number | null;
}

interface JobRow {
  job_id: string;
  kind_namespace: string;
  kind_name: string;
  kind_version: string;
  definition_digest: string;
  correlation_id: string;
  idempotency_scope: string;
  idempotency_key: string;
  lens: string | null;
  status: string;
  attempts: number;
  events_length: number;
  record: unknown;
  lease_owner: string | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

interface JobEventRow {
  job_id: string;
  sequence: number;
  envelope: unknown;
  appended_at: number;
}

interface AuditRow {
  sequence: number;
  previous_digest: string;
  digest: string;
  payload: unknown;
  appended_at: number;
}

interface DeadLetterRow {
  job_id: string;
  reason: string;
  record: unknown;
  moved_at: number;
}

interface IdempotencyRow {
  idempotency_scope: string;
  idempotency_key: string;
  correlation_id: string;
  outcome: unknown;
  recorded_at: number;
}

interface ProjectionRow {
  projection: string;
  tenant_id: string;
  position: number;
  updated_at: number;
}

interface PaymentLedgerRow {
  request_id: string;
  tenant_id: string;
  correlation_id: string;
  currency: string;
  truth: string;
  state: string;
  entries_length: number;
  ledger: unknown;
  created_at: number;
  updated_at: number;
}

interface PaymentLedgerEntryRow {
  request_id: string;
  sequence: number;
  operation_key: string;
  tenant_id: string;
  entry: unknown;
  appended_at: number;
}

interface PaymentOutboxRow {
  event_id: string;
  request_id: string;
  tenant_id: string;
  sequence: number;
  payload: string;
  created_at: number;
  delivered_at: number | null;
}

interface LedgerRow {
  version: number;
  name: string;
  applied_at: number;
}

/**
 * The in-memory runtime transport. Construct with `migratedFromZero` to
 * require migrations before data statements (bootstrap-ordering proofs);
 * by default all tables are pre-created (post-migration world).
 */
export class MemoryRuntimeTransport implements SqlTransport {
  private readonly escalations = new Map<string, EscalationRow>();
  private readonly escalationEvents = new Map<string, EscalationEventRow>();
  private readonly webhookOutbox = new Map<string, WebhookRow>();
  private readonly jobs = new Map<string, JobRow>();
  private readonly jobEvents = new Map<string, JobEventRow>();
  private readonly auditRecords = new Map<number, AuditRow>();
  private readonly deadLetters = new Map<string, DeadLetterRow>();
  private readonly idempotency = new Map<string, IdempotencyRow>();
  private readonly projections = new Map<string, ProjectionRow>();
  private readonly paymentLedgers = new Map<string, PaymentLedgerRow>();
  private readonly paymentLedgerEntries = new Map<string, PaymentLedgerEntryRow>();
  private readonly paymentOutbox = new Map<string, PaymentOutboxRow>();
  private readonly ledger = new Map<number, LedgerRow>();
  private readonly tables = new Set<string>();
  readonly executedStatements: string[] = [];

  constructor(options: { readonly migratedFromZero?: boolean } = {}) {
    if (options.migratedFromZero !== true) {
      for (const table of [
        'arena_escalation_record',
        'arena_escalation_event',
        'arena_webhook_outbox',
        'arena_job_record',
        'arena_job_event',
        'arena_audit_record',
        'arena_job_dead_letter',
        'arena_runtime_idempotency',
        'arena_projection_state',
        'arena_payment_ledger',
        'arena_payment_ledger_entry',
        'arena_payment_outbox',
        'arena_migration_ledger',
        'arena_control_record',
      ]) {
        this.tables.add(table);
      }
    }
  }

  async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.executedStatements.push(statement.name);
    const p = (index: number): unknown => statement.params[index];
    switch (statement.name) {
      // -- migration runner -----------------------------------------------
      case 'ensure_migration_ledger':
        this.trackCreateTable(statement.sql);
        return [];
      case 'list_applied_migrations':
        this.requireTable('arena_migration_ledger');
        return [...this.ledger.values()]
          .sort((a, b) => a.version - b.version)
          .map((row) => ({ ...row }));
      case 'record_applied_migration': {
        this.requireTable('arena_migration_ledger');
        const version = Number(p(0));
        const name = String(p(1));
        const appliedAt = Number(p(2));
        this.ledger.set(version, { version, name, applied_at: appliedAt });
        return [];
      }
      case 'apply_migration':
        this.trackCreateTable(statement.sql);
        return [];
      case 'select_1':
        return [{ ok: 1 }];

      // -- escalation lifecycle records -----------------------------------
      case 'insert_escalation_record': {
        this.requireTable('arena_escalation_record');
        const requestId = String(p(0));
        if (this.escalations.has(requestId)) return [];
        this.escalations.set(requestId, {
          request_id: requestId,
          tenant_id: String(p(1)),
          lens: String(p(2)),
          state: String(p(3)),
          correlation_id: String(p(4)),
          idempotency_scope: String(p(5)),
          idempotency_key: String(p(6)),
          history_length: Number(p(7)),
          record: parseJson(p(8)),
          created_at: Number(p(9)),
          updated_at: Number(p(10)),
        });
        return [{ request_id: requestId }];
      }
      case 'select_escalation_record': {
        this.requireTable('arena_escalation_record');
        const row = this.escalations.get(String(p(0)));
        return row !== undefined ? [{ ...row, record: row.record }] : [];
      }
      case 'select_escalation_by_submission': {
        this.requireTable('arena_escalation_record');
        return this.filterEscalations(
          (row) =>
            row.idempotency_scope === String(p(0)) &&
            row.idempotency_key === String(p(1)) &&
            row.correlation_id === String(p(2)),
        );
      }
      case 'select_escalations_by_correlation': {
        this.requireTable('arena_escalation_record');
        return this.filterEscalations(
          (row) => row.tenant_id === String(p(0)) && row.correlation_id === String(p(1)),
        );
      }
      case 'select_all_escalations':
        this.requireTable('arena_escalation_record');
        return this.filterEscalations(() => true);
      case 'update_escalation_record': {
        this.requireTable('arena_escalation_record');
        const requestId = String(p(0));
        const historyLength = Number(p(7));
        const row = this.escalations.get(requestId);
        if (row === undefined || row.history_length >= historyLength) return [];
        const updated: EscalationRow = {
          ...row,
          tenant_id: String(p(1)),
          lens: String(p(2)),
          state: String(p(3)),
          correlation_id: String(p(4)),
          idempotency_scope: String(p(5)),
          idempotency_key: String(p(6)),
          history_length: historyLength,
          record: parseJson(p(8)),
          updated_at: Number(p(9)),
        };
        this.escalations.set(requestId, updated);
        return [{ ...updated, record: updated.record }];
      }
      case 'append_escalation_event': {
        this.requireTable('arena_escalation_event');
        const requestId = String(p(0));
        const sequence = Number(p(1));
        const key = `${requestId}:${String(sequence)}`;
        if (this.escalationEvents.has(key)) return [];
        this.escalationEvents.set(key, {
          request_id: requestId,
          sequence,
          tenant_id: String(p(2)),
          event: parseJson(p(3)),
          appended_at: Number(p(4)),
        });
        return [];
      }
      case 'select_escalation_events': {
        this.requireTable('arena_escalation_event');
        return [...this.escalationEvents.values()]
          .filter((row) => row.request_id === String(p(0)))
          .sort((a, b) => a.sequence - b.sequence)
          .map((row) => ({ ...row, event: row.event }));
      }

      // -- webhook outbox ---------------------------------------------------
      case 'insert_webhook_delivery': {
        this.requireTable('arena_webhook_outbox');
        const eventId = String(p(0));
        if (this.webhookOutbox.has(eventId)) return [];
        this.webhookOutbox.set(eventId, {
          event_id: eventId,
          request_id: String(p(1)),
          tenant_id: String(p(2)),
          sequence: Number(p(3)),
          payload: String(p(4)),
          created_at: Number(p(5)),
          delivered_at: null,
        });
        return [{ event_id: eventId }];
      }
      case 'select_pending_webhook_deliveries':
        this.requireTable('arena_webhook_outbox');
        return this.filterWebhooks((row) => row.delivered_at === null);
      case 'select_all_webhook_deliveries':
        this.requireTable('arena_webhook_outbox');
        return this.filterWebhooks(() => true);
      case 'mark_webhook_delivery_delivered': {
        this.requireTable('arena_webhook_outbox');
        const row = this.webhookOutbox.get(String(p(0)));
        if (row === undefined || row.delivered_at !== null) return [];
        row.delivered_at = Number(p(1));
        return [{ event_id: row.event_id }];
      }

      // -- idempotency outcomes ----------------------------------------------
      case 'record_idempotency_outcome': {
        this.requireTable('arena_runtime_idempotency');
        const key = `${String(p(0))}:${String(p(1))}:${String(p(2))}`;
        if (this.idempotency.has(key)) return [];
        this.idempotency.set(key, {
          idempotency_scope: String(p(0)),
          idempotency_key: String(p(1)),
          correlation_id: String(p(2)),
          outcome: parseJson(p(3)),
          recorded_at: Number(p(4)),
        });
        return [{ idempotency_key: String(p(1)) }];
      }
      case 'select_idempotency_outcome': {
        this.requireTable('arena_runtime_idempotency');
        const row = this.idempotency.get(`${String(p(0))}:${String(p(1))}:${String(p(2))}`);
        return row !== undefined ? [{ ...row, outcome: row.outcome }] : [];
      }

      // -- job records ---------------------------------------------------------
      case 'insert_job_record': {
        this.requireTable('arena_job_record');
        const jobId = String(p(0));
        if (this.jobs.has(jobId)) return [];
        this.jobs.set(jobId, {
          job_id: jobId,
          kind_namespace: String(p(1)),
          kind_name: String(p(2)),
          kind_version: String(p(3)),
          definition_digest: String(p(4)),
          correlation_id: String(p(5)),
          idempotency_scope: String(p(6)),
          idempotency_key: String(p(7)),
          lens: p(8) === null ? null : String(p(8)),
          status: String(p(9)),
          attempts: Number(p(10)),
          events_length: Number(p(11)),
          record: parseJson(p(12)),
          lease_owner: null,
          lease_expires_at: null,
          created_at: Number(p(13)),
          updated_at: Number(p(14)),
        });
        return [{ job_id: jobId }];
      }
      case 'select_job_record': {
        this.requireTable('arena_job_record');
        const row = this.jobs.get(String(p(0)));
        return row !== undefined ? [{ ...row, record: row.record }] : [];
      }
      case 'select_job_by_submission': {
        this.requireTable('arena_job_record');
        return this.filterJobs(
          (row) =>
            row.idempotency_scope === String(p(0)) &&
            row.idempotency_key === String(p(1)) &&
            row.correlation_id === String(p(2)),
        );
      }
      case 'select_jobs_by_correlation':
        this.requireTable('arena_job_record');
        return this.filterJobs((row) => row.correlation_id === String(p(0)));
      case 'select_all_jobs':
        this.requireTable('arena_job_record');
        return this.filterJobs(() => true);
      case 'update_job_record': {
        this.requireTable('arena_job_record');
        const jobId = String(p(0));
        const eventsLength = Number(p(11));
        const row = this.jobs.get(jobId);
        if (row === undefined || row.events_length >= eventsLength) return [];
        const updated: JobRow = {
          ...row,
          kind_namespace: String(p(1)),
          kind_name: String(p(2)),
          kind_version: String(p(3)),
          definition_digest: String(p(4)),
          correlation_id: String(p(5)),
          idempotency_scope: String(p(6)),
          idempotency_key: String(p(7)),
          lens: p(8) === null ? null : String(p(8)),
          status: String(p(9)),
          attempts: Number(p(10)),
          events_length: eventsLength,
          record: parseJson(p(12)),
          updated_at: Number(p(13)),
        };
        this.jobs.set(jobId, updated);
        return [{ ...updated, record: updated.record }];
      }
      case 'stamp_job_lease': {
        this.requireTable('arena_job_record');
        const row = this.jobs.get(String(p(0)));
        if (row === undefined) return [];
        row.lease_owner = String(p(1));
        row.lease_expires_at = Number(p(2));
        return [{ job_id: row.job_id }];
      }
      case 'clear_expired_job_leases': {
        this.requireTable('arena_job_record');
        const now = Number(p(0));
        const reclaimed: SqlRow[] = [];
        for (const row of this.jobs.values()) {
          if (row.status === 'running' && row.lease_expires_at !== null && row.lease_expires_at <= now) {
            row.lease_owner = null;
            row.lease_expires_at = null;
            reclaimed.push({ job_id: row.job_id });
          }
        }
        return reclaimed;
      }
      case 'insert_dead_letter': {
        this.requireTable('arena_job_dead_letter');
        const jobId = String(p(0));
        if (this.deadLetters.has(jobId)) return [];
        this.deadLetters.set(jobId, {
          job_id: jobId,
          reason: String(p(1)),
          record: parseJson(p(2)),
          moved_at: Number(p(3)),
        });
        return [];
      }
      case 'select_dead_letters':
        this.requireTable('arena_job_dead_letter');
        return [...this.deadLetters.values()]
          .sort((a, b) => a.moved_at - b.moved_at || (a.job_id < b.job_id ? -1 : 1))
          .map((row) => ({ ...row, record: row.record }));

      // -- job events + audit chain ---------------------------------------------
      case 'insert_job_event': {
        this.requireTable('arena_job_event');
        const jobId = String(p(0));
        const sequence = Number(p(1));
        const key = `${jobId}:${String(sequence)}`;
        if (this.jobEvents.has(key)) return [];
        this.jobEvents.set(key, {
          job_id: jobId,
          sequence,
          envelope: parseJson(p(2)),
          appended_at: Number(p(3)),
        });
        return [];
      }
      case 'select_job_events': {
        this.requireTable('arena_job_event');
        return [...this.jobEvents.values()]
          .filter((row) => row.job_id === String(p(0)))
          .sort((a, b) => a.sequence - b.sequence)
          .map((row) => ({ ...row, envelope: row.envelope }));
      }
      case 'insert_audit_record': {
        this.requireTable('arena_audit_record');
        const sequence = Number(p(0));
        if (this.auditRecords.has(sequence)) return [];
        this.auditRecords.set(sequence, {
          sequence,
          previous_digest: String(p(1)),
          digest: String(p(2)),
          payload: parseJson(p(3)),
          appended_at: Number(p(4)),
        });
        return [];
      }
      case 'select_last_audit_record': {
        this.requireTable('arena_audit_record');
        const rows = [...this.auditRecords.values()].sort((a, b) => a.sequence - b.sequence);
        const last = rows[rows.length - 1];
        return last !== undefined ? [{ ...last, payload: last.payload }] : [];
      }
      case 'select_all_audit_records':
        this.requireTable('arena_audit_record');
        return [...this.auditRecords.values()]
          .sort((a, b) => a.sequence - b.sequence)
          .map((row) => ({ ...row, payload: row.payload }));

      // -- projection state ---------------------------------------------------------
      case 'upsert_projection_state': {
        this.requireTable('arena_projection_state');
        const key = `${String(p(0))}:${String(p(1))}`;
        this.projections.set(key, {
          projection: String(p(0)),
          tenant_id: String(p(1)),
          position: Number(p(2)),
          updated_at: Number(p(3)),
        });
        return [];
      }
      case 'select_projection_state': {
        this.requireTable('arena_projection_state');
        const row = this.projections.get(`${String(p(0))}:${String(p(1))}`);
        return row !== undefined ? [{ ...row }] : [];
      }

      // -- payment escrow ledger + entry rows + payment outbox (P002-F1) ----
      case 'insert_payment_ledger': {
        this.requireTable('arena_payment_ledger');
        const requestId = String(p(0));
        if (this.paymentLedgers.has(requestId)) return [];
        this.paymentLedgers.set(requestId, {
          request_id: requestId,
          tenant_id: String(p(1)),
          correlation_id: String(p(2)),
          currency: String(p(3)),
          truth: String(p(4)),
          state: String(p(5)),
          entries_length: Number(p(6)),
          ledger: parseJson(p(7)),
          created_at: Number(p(8)),
          updated_at: Number(p(9)),
        });
        return [{ request_id: requestId }];
      }
      case 'select_payment_ledger': {
        this.requireTable('arena_payment_ledger');
        const row = this.paymentLedgers.get(String(p(0)));
        return row !== undefined ? [{ ...row, ledger: row.ledger }] : [];
      }
      case 'select_all_payment_ledgers': {
        this.requireTable('arena_payment_ledger');
        return [...this.paymentLedgers.values()]
          .sort((a, b) => (a.request_id < b.request_id ? -1 : 1))
          .map((row) => ({ ...row, ledger: row.ledger }));
      }
      case 'update_payment_ledger': {
        this.requireTable('arena_payment_ledger');
        const requestId = String(p(0));
        const entriesLength = Number(p(6));
        const row = this.paymentLedgers.get(requestId);
        if (row === undefined || row.entries_length >= entriesLength) return [];
        const updated: PaymentLedgerRow = {
          ...row,
          tenant_id: String(p(1)),
          correlation_id: String(p(2)),
          currency: String(p(3)),
          truth: String(p(4)),
          state: String(p(5)),
          entries_length: entriesLength,
          ledger: parseJson(p(7)),
          updated_at: Number(p(8)),
        };
        this.paymentLedgers.set(requestId, updated);
        return [{ request_id: requestId }];
      }
      case 'insert_payment_ledger_entry': {
        this.requireTable('arena_payment_ledger_entry');
        const requestId = String(p(0));
        const sequence = Number(p(1));
        const operationKey = String(p(2));
        const key = `${requestId}:${String(sequence)}`;
        if (this.paymentLedgerEntries.has(key)) return [];
        // The UNIQUE (request_id, operation_key) exactly-once gate: a
        // same-key row at a DIFFERENT sequence raises (fail closed),
        // exactly like the real unique index does.
        for (const row of this.paymentLedgerEntries.values()) {
          if (row.request_id === requestId && row.operation_key === operationKey) {
            throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
              message: `duplicate key value violates unique constraint "arena_payment_ledger_operation_idx" on (request_id, operation_key)`,
              details: { requestId, operationKey },
            });
          }
        }
        this.paymentLedgerEntries.set(key, {
          request_id: requestId,
          sequence,
          operation_key: operationKey,
          tenant_id: String(p(3)),
          entry: parseJson(p(4)),
          appended_at: Number(p(5)),
        });
        return [{ sequence }];
      }
      case 'insert_payment_outbox_delivery': {
        this.requireTable('arena_payment_outbox');
        const eventId = String(p(0));
        if (this.paymentOutbox.has(eventId)) return [];
        this.paymentOutbox.set(eventId, {
          event_id: eventId,
          request_id: String(p(1)),
          tenant_id: String(p(2)),
          sequence: Number(p(3)),
          payload: String(p(4)),
          created_at: Number(p(5)),
          delivered_at: null,
        });
        return [{ event_id: eventId }];
      }
      case 'select_pending_payment_outbox_deliveries':
        this.requireTable('arena_payment_outbox');
        return this.filterPaymentOutbox((row) => row.delivered_at === null);
      case 'select_all_payment_outbox_deliveries':
        this.requireTable('arena_payment_outbox');
        return this.filterPaymentOutbox(() => true);
      case 'mark_payment_outbox_delivery_delivered': {
        this.requireTable('arena_payment_outbox');
        const row = this.paymentOutbox.get(String(p(0)));
        if (row === undefined || row.delivered_at !== null) return [];
        row.delivered_at = Number(p(1));
        return [{ event_id: row.event_id }];
      }

      default:
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
          message: `MemoryRuntimeTransport does not implement statement: ${statement.name}`,
        });
    }
  }

  /** Tables created by executed DDL (bootstrap-ordering assertions). */
  createdTables(): readonly string[] {
    return [...this.tables];
  }

  private filterEscalations(predicate: (row: EscalationRow) => boolean): SqlRow[] {
    return [...this.escalations.values()]
      .filter(predicate)
      .sort((a, b) => (a.request_id < b.request_id ? -1 : 1))
      .map((row) => ({ ...row, record: row.record }));
  }

  private filterWebhooks(predicate: (row: WebhookRow) => boolean): SqlRow[] {
    return [...this.webhookOutbox.values()]
      .filter(predicate)
      .sort((a, b) => a.created_at - b.created_at || (a.event_id < b.event_id ? -1 : 1))
      .map((row) => ({ ...row }));
  }

  private filterJobs(predicate: (row: JobRow) => boolean): SqlRow[] {
    return [...this.jobs.values()]
      .filter(predicate)
      .sort((a, b) => (a.job_id < b.job_id ? -1 : 1))
      .map((row) => ({ ...row, record: row.record }));
  }

  private filterPaymentOutbox(predicate: (row: PaymentOutboxRow) => boolean): SqlRow[] {
    return [...this.paymentOutbox.values()]
      .filter(predicate)
      .sort((a, b) => a.created_at - b.created_at || (a.event_id < b.event_id ? -1 : 1))
      .map((row) => ({ ...row }));
  }

  private trackCreateTable(sql: string): void {
    const pattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi;
    let match = pattern.exec(sql);
    while (match !== null) {
      this.tables.add(match[1] as string);
      match = pattern.exec(sql);
    }
  }

  private requireTable(name: string): void {
    if (!this.tables.has(name)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
        message: `relation "${name}" does not exist (migration required)`,
      });
    }
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
