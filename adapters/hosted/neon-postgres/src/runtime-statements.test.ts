/**
 * Durable host-runtime statement-set discipline (Work Order P002; issue
 * #154) — credential-free proofs over the PURE SQL DATA in
 * ./runtime-statements.ts + migrations 0003-0005:
 *
 *   1. the runtime statement vocabulary is CLOSED and registered in the
 *      transport's SQL_STATEMENT_NAMES (the prepared-statement idiom);
 *   2. every builder emits exactly the parameters its SQL placeholders
 *      reference (no orphan params, no unbound placeholders);
 *   3. the SQL touches ONLY the P002 runtime tables — no control-plane
 *      table, no ad-hoc relation, no SELECT *;
 *   4. snapshot replacement statements carry the APPEND-ONLY guard
 *      (history_length < $n / events_length < $n) so a regressing or
 *      same-length rewrite is unrepresentable at the SQL layer;
 *   5. the idempotent inserts (event rows, outbox rows, dead letters,
 *      audit rows, projection state) declare ON CONFLICT DO NOTHING (or
 *      the guarded upsert) — replayed appends never duplicate;
 *   6. migrations 0003-0005 create EXACTLY the tables the statement set
 *      addresses (the schema/statement coupling is machine-checked).
 */

import { describe, expect, it } from 'vitest';
import { SQL_STATEMENT_NAMES } from './sql-transport.js';
import type { SqlStatement } from './sql-transport.js';
import {
  appendEscalationEventStatement,
  clearExpiredJobLeasesStatement,
  insertAuditRecordStatement,
  insertDeadLetterStatement,
  insertEscalationRecordStatement,
  insertJobEventStatement,
  insertJobRecordStatement,
  insertWebhookDeliveryStatement,
  markWebhookDeliveryDeliveredStatement,
  recordIdempotencyOutcomeStatement,
  RUNTIME_SQL_STATEMENT_NAMES,
  selectAllAuditRecordsStatement,
  selectAllEscalationsStatement,
  selectAllJobsStatement,
  selectAllWebhookDeliveriesStatement,
  selectDeadLettersStatement,
  selectEscalationBySubmissionStatement,
  selectEscalationEventsStatement,
  selectEscalationRecordStatement,
  selectEscalationsByCorrelationStatement,
  selectIdempotencyOutcomeStatement,
  selectJobBySubmissionStatement,
  selectJobEventsStatement,
  selectJobRecordStatement,
  selectJobsByCorrelationStatement,
  selectLastAuditRecordStatement,
  selectPendingWebhookDeliveriesStatement,
  selectProjectionStateStatement,
  stampJobLeaseStatement,
  updateEscalationRecordStatement,
  updateJobRecordStatement,
  upsertProjectionStateStatement,
} from './runtime-statements.js';
import { SQL_MIGRATION_SOURCES } from './migrations.js';

/** The P002 runtime tables (migrations 0003-0005) — the ONLY relations allowed. */
const RUNTIME_TABLES = Object.freeze([
  'arena_escalation_record',
  'arena_escalation_event',
  'arena_webhook_outbox',
  'arena_job_record',
  'arena_job_event',
  'arena_audit_record',
  'arena_job_dead_letter',
  'arena_runtime_idempotency',
  'arena_projection_state',
] as const);

/** The control-plane relations the runtime SQL must never touch. */
const FORBIDDEN_TABLES = Object.freeze([
  'arena_control_record',
  'arena_migration_ledger',
] as const);

/** One sample statement per builder (params are irrelevant shape-wise). */
function sampleStatements(): readonly SqlStatement[] {
  return Object.freeze([
    insertEscalationRecordStatement({
      requestId: 'req-1',
      tenantId: 'tenant-alpha',
      lens: 'customer',
      state: 'triaged',
      correlationId: 'corr-1',
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      historyLength: 3,
      recordJson: '{}',
      createdAt: 1,
      updatedAt: 1,
    }),
    selectEscalationRecordStatement('req-1'),
    selectEscalationBySubmissionStatement({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    }),
    selectEscalationsByCorrelationStatement('tenant-alpha', 'corr-1'),
    selectAllEscalationsStatement(),
    updateEscalationRecordStatement({
      requestId: 'req-1',
      tenantId: 'tenant-alpha',
      lens: 'customer',
      state: 'matching',
      correlationId: 'corr-1',
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      historyLength: 4,
      recordJson: '{}',
      updatedAt: 2,
    }),
    appendEscalationEventStatement({
      requestId: 'req-1',
      sequence: 4,
      tenantId: 'tenant-alpha',
      eventJson: '{}',
      appendedAt: 2,
    }),
    selectEscalationEventsStatement('req-1'),
    insertWebhookDeliveryStatement({
      eventId: 'evt-1',
      requestId: 'req-1',
      tenantId: 'tenant-alpha',
      sequence: 4,
      payload: '{}',
      createdAt: 2,
    }),
    selectPendingWebhookDeliveriesStatement(),
    selectAllWebhookDeliveriesStatement(),
    markWebhookDeliveryDeliveredStatement('evt-1', 3),
    recordIdempotencyOutcomeStatement({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
      outcomeJson: '{}',
      recordedAt: 2,
    }),
    selectIdempotencyOutcomeStatement({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    }),
    insertJobRecordStatement({
      jobId: 'job-1',
      kindNamespace: 'arena-runtime',
      kindName: 'retention-sweep',
      kindVersion: '1.0.0',
      definitionDigest: 'sha256:deadbeef',
      correlationId: 'corr-1',
      idempotencyScope: 'runtime-retention-sweep',
      idempotencyKey: 'idem-1',
      lens: null,
      status: 'queued',
      attempts: 0,
      eventsLength: 0,
      recordJson: '{}',
      createdAt: 1,
      updatedAt: 1,
    }),
    selectJobRecordStatement('job-1'),
    selectJobBySubmissionStatement({
      idempotencyScope: 'runtime-retention-sweep',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    }),
    selectJobsByCorrelationStatement('corr-1'),
    selectAllJobsStatement(),
    updateJobRecordStatement({
      jobId: 'job-1',
      kindNamespace: 'arena-runtime',
      kindName: 'retention-sweep',
      kindVersion: '1.0.0',
      definitionDigest: 'sha256:deadbeef',
      correlationId: 'corr-1',
      idempotencyScope: 'runtime-retention-sweep',
      idempotencyKey: 'idem-1',
      lens: null,
      status: 'running',
      attempts: 1,
      eventsLength: 1,
      recordJson: '{}',
      updatedAt: 2,
    }),
    stampJobLeaseStatement({ jobId: 'job-1', leaseOwner: 'host-1', leaseExpiresAt: 3 }),
    clearExpiredJobLeasesStatement(3),
    insertDeadLetterStatement({
      jobId: 'job-1',
      reason: 'terminal-failed',
      recordJson: '{}',
      movedAt: 3,
    }),
    selectDeadLettersStatement(),
    insertJobEventStatement({ jobId: 'job-1', sequence: 1, envelopeJson: '{}', appendedAt: 2 }),
    selectJobEventsStatement('job-1'),
    insertAuditRecordStatement({
      sequence: 1,
      previousDigest: 'sha256:genesis',
      digest: 'sha256:one',
      payloadJson: '{}',
      appendedAt: 2,
    }),
    selectLastAuditRecordStatement(),
    selectAllAuditRecordsStatement(),
    upsertProjectionStateStatement({
      projection: 'learning-candidate-projection',
      tenantId: 'tenant-alpha',
      position: 7,
      updatedAt: 2,
    }),
    selectProjectionStateStatement('learning-candidate-projection', 'tenant-alpha'),
  ]);
}

function placeholderCount(sql: string): number {
  const numbers = [...sql.matchAll(/\$(\d+)/g)].map((match) => Number(match[1]));
  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

function referencedTables(sql: string): readonly string[] {
  // Neutralize the UPSERT's "DO UPDATE SET" clause first so the UPDATE
  // matcher cannot capture "SET" as a relation name.
  const neutral = sql.replace(/DO\s+UPDATE/gi, 'DO__UPDATE');
  const pattern = /\b(?:FROM|INTO|UPDATE|ON\s+CONFLICT\s+ON|TABLE\s+IF\s+NOT\s+EXISTS)\s+([a-z_][a-z0-9_]*)/gi;
  const tables = new Set<string>();
  let match = pattern.exec(neutral);
  while (match !== null) {
    tables.add(match[1] as string);
    match = pattern.exec(neutral);
  }
  return [...tables];
}

describe('runtime statement-set discipline (P002 durable host runtime)', () => {
  it('keeps the runtime vocabulary closed and registered in the transport names', () => {
    const transportNames = new Set<string>(SQL_STATEMENT_NAMES);
    for (const name of RUNTIME_SQL_STATEMENT_NAMES) {
      expect(transportNames.has(name), `${name} must be in SQL_STATEMENT_NAMES`).toBe(true);
    }
    // One-for-one: every registered runtime name is issued by exactly one builder.
    const issued = new Set(sampleStatements().map((statement) => statement.name));
    expect([...issued].sort()).toEqual([...RUNTIME_SQL_STATEMENT_NAMES].sort());
  });

  it('binds every parameter to a referenced placeholder (no orphans, no unbound)', () => {
    for (const statement of sampleStatements()) {
      const placeholders = placeholderCount(statement.sql);
      expect(
        statement.params.length,
        `${statement.name}: params must cover every $n placeholder`,
      ).toBe(placeholders);
    }
  });

  it('touches ONLY the P002 runtime tables (no control-plane relations, no SELECT *)', () => {
    for (const statement of sampleStatements()) {
      const tables = referencedTables(statement.sql);
      expect(tables.length, `${statement.name}: must reference at least one table`).toBeGreaterThan(0);
      for (const table of tables) {
        expect(
          (RUNTIME_TABLES as readonly string[]).includes(table),
          `${statement.name} references unexpected relation ${table}`,
        ).toBe(true);
        expect((FORBIDDEN_TABLES as readonly string[]).includes(table)).toBe(false);
      }
      expect(statement.sql.includes('SELECT *')).toBe(false);
    }
  });

  it('guards snapshot replacement with the append-only history predicate', () => {
    const escalationUpdate = updateEscalationRecordStatement({
      requestId: 'req-1',
      tenantId: 'tenant-alpha',
      lens: 'customer',
      state: 'matching',
      correlationId: 'corr-1',
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      historyLength: 4,
      recordJson: '{}',
      updatedAt: 2,
    });
    expect(escalationUpdate.sql).toContain('WHERE request_id = $1 AND history_length < $8');
    expect(escalationUpdate.sql).toContain('RETURNING');

    const jobUpdate = updateJobRecordStatement({
      jobId: 'job-1',
      kindNamespace: 'arena-runtime',
      kindName: 'retention-sweep',
      kindVersion: '1.0.0',
      definitionDigest: 'sha256:deadbeef',
      correlationId: 'corr-1',
      idempotencyScope: 'runtime-retention-sweep',
      idempotencyKey: 'idem-1',
      lens: null,
      status: 'running',
      attempts: 1,
      eventsLength: 1,
      recordJson: '{}',
      updatedAt: 2,
    });
    expect(jobUpdate.sql).toContain('WHERE job_id = $1 AND events_length < $12');
    expect(jobUpdate.sql).toContain('RETURNING');
  });

  it('makes replayed appends idempotent (ON CONFLICT DO NOTHING / guarded upsert)', () => {
    const idempotent = [
      appendEscalationEventStatement({
        requestId: 'req-1',
        sequence: 4,
        tenantId: 'tenant-alpha',
        eventJson: '{}',
        appendedAt: 2,
      }),
      insertWebhookDeliveryStatement({
        eventId: 'evt-1',
        requestId: 'req-1',
        tenantId: 'tenant-alpha',
        sequence: 4,
        payload: '{}',
        createdAt: 2,
      }),
      recordIdempotencyOutcomeStatement({
        idempotencyScope: 'escalation-tenant-alpha',
        idempotencyKey: 'idem-1',
        correlationId: 'corr-1',
        outcomeJson: '{}',
        recordedAt: 2,
      }),
      insertJobEventStatement({ jobId: 'job-1', sequence: 1, envelopeJson: '{}', appendedAt: 2 }),
      insertAuditRecordStatement({
        sequence: 1,
        previousDigest: 'sha256:genesis',
        digest: 'sha256:one',
        payloadJson: '{}',
        appendedAt: 2,
      }),
      insertDeadLetterStatement({
        jobId: 'job-1',
        reason: 'terminal-failed',
        recordJson: '{}',
        movedAt: 3,
      }),
    ];
    for (const statement of idempotent) {
      expect(
        statement.sql.includes('ON CONFLICT') || statement.sql.includes('ON CONFLICT DO NOTHING'),
        `${statement.name} must be replay-idempotent`,
      ).toBe(true);
    }
    // The projection checkpoint is a monotone-position UPSERT.
    expect(upsertProjectionStateStatement({
      projection: 'p',
      tenantId: 't',
      position: 1,
      updatedAt: 1,
    }).sql).toContain('ON CONFLICT (projection, tenant_id) DO UPDATE');
    // Lease reclaim only flips RUNNING rows with elapsed leases.
    expect(clearExpiredJobLeasesStatement(1).sql).toContain("status = 'running'");
    expect(clearExpiredJobLeasesStatement(1).sql).toContain('lease_expires_at <= $1');
  });

  it('creates EXACTLY the tables the statement set addresses (0003-0005)', () => {
    const runtimeMigrations = SQL_MIGRATION_SOURCES.filter((source) => source.version >= 3);
    expect(runtimeMigrations.map((source) => source.version)).toEqual([3, 4, 5]);
    const created = new Set<string>();
    for (const source of runtimeMigrations) {
      for (const table of referencedTables(source.sql)) {
        if (source.sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
          created.add(table);
        }
      }
    }
    expect([...created].sort()).toEqual([...RUNTIME_TABLES].sort());
  });
});
