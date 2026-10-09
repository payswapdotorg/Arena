/**
 * SQL transport seam for the Neon PostgreSQL adapter (Work Order B002).
 *
 * The adapter's ONLY infrastructure touchpoint is `SqlTransport.execute`:
 * named, parameterized statements. The default transport maps statements
 * onto the Neon serverless HTTP driver; tests (and alternative runtimes)
 * inject a transport implementing the same semantics — this is how the
 * FULL persistence contract suite runs against this adapter without live
 * credentials (FT2.0 "Local parity" / "Tests never require live provider
 * credentials").
 *
 * Statement names are stable identifiers (the prepared-statement idiom):
 * they let a test transport dispatch on semantics without parsing SQL,
 * and let the live transport reuse server-side prepared statements later.
 */

import { neon } from '@neondatabase/serverless';
import { PERSISTENCE_ERROR_CODES, PersistenceError } from '@arena/persistence';

/** One named, parameterized statement ($1..$n placeholders). */
export interface SqlStatement {
  /** Stable statement id (see SQL_STATEMENT_NAMES). */
  readonly name: string;
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** A result row: column name -> value. */
export interface SqlRow {
  readonly [column: string]: unknown;
}

/** The infrastructure seam this adapter requires. */
export interface SqlTransport {
  execute(statement: SqlStatement): Promise<readonly SqlRow[]>;
}

/** The closed statement-name vocabulary issued by this adapter. */
export const SQL_STATEMENT_NAMES = Object.freeze([
  'insert_control_record',
  'select_control_record',
  'select_control_records',
  'select_all_control_records',
  'count_control_records',
  'update_control_record',
  'delete_control_record',
  'ensure_migration_ledger',
  'list_applied_migrations',
  'record_applied_migration',
  'apply_migration',
  'select_1',
  // P002 durable host-runtime statements (see ./runtime-statements.ts).
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
] as const);

export type SqlStatementName = (typeof SQL_STATEMENT_NAMES)[number];

/**
 * Wrap transport failures in the typed TRANSPORT_FAILED error. Transport
 * error messages from the driver can carry endpoint detail — they are
 * attached as `cause` (never surfaced in the message) and the typed
 * message stays provider-detail-free.
 */
export async function executeStatement(
  transport: SqlTransport,
  statement: SqlStatement,
): Promise<readonly SqlRow[]> {
  try {
    return await transport.execute(statement);
  } catch (cause) {
    throw new PersistenceError(PERSISTENCE_ERROR_CODES.TRANSPORT_FAILED, {
      message: `statement ${statement.name} failed on the hosted control-plane transport`,
      details: { statement: statement.name },
      cause,
    });
  }
}

/**
 * The default transport over the Neon serverless HTTP driver (Vercel
 * compatible: plain fetch, no sockets). The connection string is used
 * ONLY to construct the driver client and is never logged.
 */
export function createNeonHttpSqlTransport(connectionString: string): SqlTransport {
  const sql = neon(connectionString);
  return {
    async execute(statement: SqlStatement): Promise<readonly SqlRow[]> {
      const rows = await sql(statement.sql, [...statement.params]);
      return rows as readonly SqlRow[];
    },
  };
}
