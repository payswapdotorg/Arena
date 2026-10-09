/**
 * Durable port implementation unit tests (Work Order P002; issue #154)
 * — the store-level semantics over the in-memory reference transport:
 * append-only guards, submission dedup, dead-letter parking, webhook
 * dedupe, audit-chain hydration and the monotone projection checkpoint.
 *
 * REAL-database acceptance (embedded Postgres + live Neon) lives in
 * tests/runtime-host — a different evidence class.
 */

import { describe, expect, it } from 'vitest';
import { ManualClock } from '@arena/persistence';
import { isPersistenceError } from '@arena/persistence';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { claimJob, createJobRecord, makeJobEventEnvelope, makeMutationAuditedEvent } from '@arena/job-protocol';
import type { Envelope } from '@arena/protocol-core';
import type { JobRecord, MutationAuditedEvent } from '@arena/job-protocol';
import { toJobSubmissionIdentity } from '@arena/job-protocol';
import {
  applyHoldOperation,
  applyOfferOperation,
  openPaymentLedger,
  toMoney,
} from '@arena/payments';
import type { PaymentLedger } from '@arena/payments';
import {
  DurableEscalationStore,
  DurableEventSink,
  DurableIdempotencyStore,
  DurableJobStore,
  DurablePaymentEventOutbox,
  DurablePaymentLedgerStore,
  DurableProjectionStateStore,
  DurableWebhookOutbox,
} from './durable.js';
import { MemoryRuntimeTransport } from './memory-transport.js';

const T0 = 1_700_000_000_000;

function escalationRecordFixture(overrides: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly historyLength?: number;
}) {
  const now = new Date(T0).toISOString();
  return {
    recordVersion: 1,
    request: {
      requestVersion: 1,
      requestId: overrides.requestId,
      clientAppId: 'epoch-app',
      tenantId: overrides.tenantId,
      sourceWorkflowRef: 'workflow-1',
      sourceRunRef: 'run-1',
      capabilityNeed: 'boq-estimation.quantity-takeoff',
      escalationModes: ['solve'],
      urgency: 'priority',
      createdAt: now,
      deadline: new Date(T0 + 3_600_000).toISOString(),
      budget: { amountMinorUnits: 25_000, currency: 'USD' },
      expertRequirements: { requiredCapabilities: ['boq-estimation.quantity-takeoff'] },
      locale: 'en',
      desiredOutputSchema: { type: 'object' },
      environmentSessionPolicy: { sessionMode: 'bounded-replica' },
      privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
      permittedActions: ['read-context'],
      learningPermissions: {
        allowKnowledgeCapture: true,
        allowToolGapSignals: true,
        allowArtifactReuse: false,
        requireApproval: true,
      },
      retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
      idempotencyKey: overrides.idempotencyKey,
      correlationId: overrides.correlationId,
    },
    state: 'created',
    history: Array.from({ length: overrides.historyLength ?? 1 }, (_, index) => ({
      eventVersion: 1,
      kind: 'escalation.created',
      sequence: index + 1,
      occurredAt: now,
      requestId: overrides.requestId,
      tenantId: overrides.tenantId,
      from: null,
      to: 'created',
      reason: 'created',
    })),
    createdAt: now,
    updatedAt: now,
  } as unknown as Parameters<DurableEscalationStore['insert']>[0];
}

describe('DurableEscalationStore (over the reference transport)', () => {
  it('inserts and reads back tenant-scoped with the lens stamped from the tenant', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableEscalationStore({ transport, clock });
    const record = escalationRecordFixture({
      requestId: 'esc_1',
      tenantId: 'tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });
    await store.insert(record);
    const read = await store.get('esc_1', 'tenant-alpha');
    expect(read?.request.requestId).toBe('esc_1');
    expect(await store.lensOf('esc_1')).toBe('customer');
    // Cross-tenant read returns undefined (never a leak).
    expect(await store.get('esc_1', 'tenant-beta')).toBeUndefined();
  });

  it('rejects duplicate request ids and duplicate submissions (fail closed)', async () => {
    const transport = new MemoryRuntimeTransport();
    const store = new DurableEscalationStore({ transport, clock: new ManualClock(T0) });
    await store.insert(
      escalationRecordFixture({
        requestId: 'esc_1',
        tenantId: 'tenant-alpha',
        idempotencyKey: 'idem-1',
        correlationId: 'corr-1',
      }),
    );
    await expect(
      store.insert(
        escalationRecordFixture({
          requestId: 'esc_1',
          tenantId: 'tenant-alpha',
          idempotencyKey: 'idem-9',
          correlationId: 'corr-9',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_RECORD_EXISTS' });
    await expect(
      store.insert(
        escalationRecordFixture({
          requestId: 'esc_2',
          tenantId: 'tenant-alpha',
          idempotencyKey: 'idem-1',
          correlationId: 'corr-1',
        }),
      ),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_RECORD_EXISTS' });
  });

  it('enforces the append-only history guard on update (no regressions, no rewrites)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableEscalationStore({ transport, clock });
    const base = escalationRecordFixture({
      requestId: 'esc_1',
      tenantId: 'tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });
    await store.insert(base);
    // Same-length rewrite: rejected.
    await expect(store.update(base)).rejects.toMatchObject({
      code: 'PERSISTENCE_REVISION_CONFLICT',
    });
    // Growing history: accepted; the event rows stay idempotent.
    const grown = {
      ...base,
      state: 'triaged',
      history: [
        ...base.history,
        { ...base.history[0], sequence: 2, kind: 'escalation.triaged', to: 'triaged' },
      ],
    } as unknown as Parameters<DurableEscalationStore['update']>[0];
    await store.update(grown);
    expect((await store.get('esc_1', 'tenant-alpha'))?.state).toBe('triaged');
    // A regressing update (shorter history built from the older snapshot): rejected.
    await expect(store.update(grown)).rejects.toMatchObject({
      code: 'PERSISTENCE_REVISION_CONFLICT',
    });
  });
});

describe('DurableWebhookOutbox + DurableIdempotencyStore', () => {
  it('dedupes webhook events by eventId and marks deliveries idempotently', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const outbox = new DurableWebhookOutbox({ transport, clock });
    const event = {
      eventVersion: 1,
      eventId: 'evt_1',
      eventType: 'escalation.created',
      requestId: 'esc_1',
      tenantId: 'tenant-alpha',
      sequence: 1,
      occurredAt: new Date(T0).toISOString(),
      state: 'created',
      data: {},
    } as unknown as Parameters<DurableWebhookOutbox['append']>[0];
    const envelope = {
      envelopeVersion: 1,
      id: 'env_1',
      issuedAt: new Date(T0).toISOString(),
      correlationId: 'corr-1',
      idempotencyKey: 'idem-1',
      payload: event,
    } as unknown as Parameters<DurableWebhookOutbox['append']>[1];
    await outbox.append(event, envelope);
    await expect(outbox.append(event, envelope)).rejects.toMatchObject({
      code: 'PERSISTENCE_RECORD_EXISTS',
    });
    expect(await outbox.listPending()).toHaveLength(1);
    await outbox.markDelivered('evt_1', T0 + 1);
    await outbox.markDelivered('evt_1', T0 + 2); // idempotent
    expect(await outbox.listPending()).toEqual([]);
    expect(await outbox.listAll()).toHaveLength(1);
    expect((await outbox.listAll())[0]?.deliveredAt).toBe(T0 + 1);
  });

  it('records outcomes first-write-wins and replays them deterministically', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableIdempotencyStore({ transport, clock });
    const identity = toJobSubmissionIdentity({
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1',
      correlationId: 'corr-1',
    });
    const outcome = {
      idempotencyScope: 'escalation-tenant-alpha',
      idempotencyKey: 'idem-1' as never,
      correlationId: 'corr-1' as never,
      outcome: { kind: 'created', requestId: 'esc_1' },
      recordedAt: T0,
    };
    await store.record(outcome);
    // Identical re-record: idempotent no-op.
    await store.record(outcome);
    // Differing rewrite: typed conflict (recorded outcomes are never rewritten).
    await expect(
      store.record({ ...outcome, outcome: { kind: 'created', requestId: 'esc_OTHER' } }),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_RECORD_EXISTS' });
    const found = await store.find(identity);
    expect(found?.outcome).toEqual({ kind: 'created', requestId: 'esc_1' });
  });
});

describe('DurableJobStore claiming semantics', () => {
  /** A protocol-valid queued record built through the protocol's own constructor. */
  function jobFixture(jobId: string): JobRecord {
    return createJobRecord({
      definitionDigest: 'ab'.repeat(32),
      kind: { namespace: 'arena-runtime', name: 'retention-sweep', version: '1.0.0' },
      correlationId: toCorrelationId('corr-job'),
      idempotencyKey: toIdempotencyKey('idem-job'),
      idempotencyScope: 'runtime-retention-sweep',
      input: {},
      policy: {
        timeoutMs: 60_000,
        retry: { maxAttempts: 2, backoffScheduleMs: [100], retryableErrorClasses: [] },
      },
      jobId,
      submittedAt: new Date(T0).toISOString(),
    });
  }

  async function insertJob(store: DurableJobStore, jobId: string): Promise<JobRecord> {
    const record = jobFixture(jobId);
    await store.insert(record);
    return record;
  }

  it('stamps leases, reclaims expired ones and parks dead letters idempotently', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableJobStore({ transport, clock });
    const record = await insertJob(store, 'job_1');

    // Claim the job first (running) — the reclaim statement only touches
    // RUNNING jobs with a lease (parity with clear_expired_job_leases).
    const running = claimJob(record, { at: new Date(T0 + 1_000).toISOString() });
    await store.update(running);

    await store.stampLease('job_1', 'host-A', T0 + 60_000);
    // Not yet expired: no reclaim.
    expect(await store.clearExpiredLeases(T0 + 59_999)).toEqual([]);
    // Expired: reclaimed.
    expect(await store.clearExpiredLeases(T0 + 60_001)).toEqual(['job_1']);

    await store.markDeadLetter('job_1', 'terminal-failure:test');
    // Idempotent park.
    await store.markDeadLetter('job_1', 'terminal-failure:test');
    expect(await store.listDeadLetters()).toEqual([
      { jobId: 'job_1', reason: 'terminal-failure:test' },
    ]);
    // The record stays queryable (the lot is the operator surface).
    expect((await store.get('job_1'))?.jobId).toBe('job_1');
    expect(running.status).toBe('running');
  });

  it('enforces the append-only event guard and immutable submission identity on update', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableJobStore({ transport, clock });
    const record = await insertJob(store, 'job_1');
    // Same-length rewrite: rejected.
    await expect(store.update(record)).rejects.toMatchObject({ code: 'JOB_EVENT_OUT_OF_ORDER' });
    // Identity change: rejected (the record stays structurally valid — only
    // the store's immutable-addressability guard fires).
    const claimed = claimJob(record, { at: new Date(T0 + 1_000).toISOString() });
    const identityChanged = { ...claimed, idempotencyKey: 'idem-OTHER' } as JobRecord;
    await expect(store.update(identityChanged)).rejects.toMatchObject({ code: 'JOB_INVALID_RECORD' });
    // Legitimate growing update: accepted.
    await store.update(claimed);
    expect((await store.get('job_1'))?.status).toBe('running');
  });
});

describe('DurableProjectionStateStore + DurableEventSink hydration', () => {
  it('keeps projection checkpoints monotone (regressions fail closed)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurableProjectionStateStore({ transport, clock });
    await store.save({ projection: 'p1', tenantId: 'tenant-alpha', position: 5, updatedAt: T0 });
    await store.save({ projection: 'p1', tenantId: 'tenant-alpha', position: 7, updatedAt: T0 + 1 });
    await expect(
      store.save({ projection: 'p1', tenantId: 'tenant-alpha', position: 6, updatedAt: T0 + 2 }),
    ).rejects.toMatchObject({ code: 'PERSISTENCE_INVALID_RECORD_DATA' });
    expect((await store.get('p1', 'tenant-alpha'))?.position).toBe(7);
    expect(await store.get('p1', 'tenant-beta')).toBeNull();
  });

  it('hydrates the audit tail (a fresh sink continues the durable chain)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const sinkA = new DurableEventSink({ transport, clock });
    await sinkA.hydrate();
    expect(sinkA.lastAuditRecord()).toBeNull();

    // A protocol-valid mutation-audited envelope, built through the
    // protocol's own constructors (the same way the orchestrator does).
    const ACTOR = { type: 'service', tenant: 'arena', principalId: 'test' };
    const auditEnvelope = (
      sequence: number,
      envelopeId: string,
    ): Envelope<MutationAuditedEvent> => {
      const event = makeMutationAuditedEvent({
        sequence,
        occurredAt: new Date(T0 + sequence).toISOString(),
        jobId: 'job_1',
        mutation: 'job.submit',
        actor: ACTOR,
        correlationId: 'corr-a',
        envelopeId,
      });
      return makeJobEventEnvelope(event, {
        correlationId: toCorrelationId('corr-a'),
        idempotencyKey: toIdempotencyKey('idem-a'),
        id: envelopeId,
        issuedAt: new Date(T0 + sequence).toISOString(),
      }) as Envelope<MutationAuditedEvent>;
    };

    // A fresh sink that did NOT hydrate still appends correctly: the
    // DURABLE tail cross-check (not the cache) is the authority.
    const sinkUnhydrated = new DurableEventSink({ transport, clock });
    const first = auditEnvelope(1, '0b6b1a4a-1111-4111-8111-111111111111');
    const record = await sinkUnhydrated.appendAuditEvent(first);
    expect(record.sequence).toBe(1);

    // A SECOND process (fresh sink) continues the chain.
    const sinkB = new DurableEventSink({ transport, clock });
    const continuing = auditEnvelope(2, '0b6b1a4a-2222-4222-8222-222222222222');
    let failure: unknown;
    try {
      await sinkB.appendAuditEvent(continuing);
    } catch (error) {
      failure = error;
    }
    // Without hydration the cached tail is null but the DURABLE tail is 1 —
    // the cross-check fails closed... unless the payload continues it.
    // (sequence 2 continues the durable tail, so this append SUCCEEDS even
    // unhydrated: the durable cross-check is the authority, not the cache.)
    expect(isPersistenceError(failure)).toBe(false);
    await sinkB.hydrate();
    expect(sinkB.lastAuditRecord()?.sequence).toBe(2);
    const chain = await sinkB.auditRecords();
    expect(chain.map((entry) => entry.sequence)).toEqual([1, 2]);
  });
});

describe('DurablePaymentLedgerStore + DurablePaymentEventOutbox (P002-F1, F-09)', () => {
  /**
   * A domain-valid escrow ledger built through the domain's own
   * constructors (openPaymentLedger + applyHoldOperation), the same way
   * the payments service produces one.
   */
  async function ledgerFixture(options: {
    readonly requestId: string;
    readonly holdKey: string;
    readonly amountMinorUnits?: number;
  }): Promise<PaymentLedger> {
    const base = openPaymentLedger({
      requestId: options.requestId,
      tenantId: 'tenant-alpha',
      correlationId: 'corr-pay',
      currency: 'USD',
      truth: 'demo',
      now: T0,
    });
    const result = await applyHoldOperation(base, {
      amount: toMoney({ amount: options.amountMinorUnits ?? 25_000, currency: 'USD' }),
      operationKey: options.holdKey,
      lifecycleState: 'created',
      now: T0,
    });
    return result.ledger;
  }

  it('inserts and reads back tenant-scoped; duplicate request ids fail closed typed', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurablePaymentLedgerStore({ transport, clock });
    const ledger = await ledgerFixture({ requestId: 'req_pay_1', holdKey: 'op-hold-1' });
    await store.insert(ledger);
    const read = await store.get('req_pay_1', 'tenant-alpha');
    expect(read?.requestId).toBe('req_pay_1');
    expect(read?.state).toBe('held');
    // Cross-tenant read returns undefined (never a leak).
    expect(await store.get('req_pay_1', 'tenant-beta')).toBeUndefined();
    expect((await store.findById('req_pay_1'))?.requestId).toBe('req_pay_1');
    // A concurrent insert of the SAME request id loses exactly-once.
    await expect(store.insert(ledger)).rejects.toMatchObject({
      code: 'PERSISTENCE_RECORD_EXISTS',
    });
    expect((await store.list())).toHaveLength(1);
  });

  it('enforces the append-only entry guard on update (no regressions, no rewrites)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurablePaymentLedgerStore({ transport, clock });
    const base = await ledgerFixture({ requestId: 'req_pay_1', holdKey: 'op-hold-1' });
    await store.insert(base);
    // Same-length rewrite: rejected typed.
    await expect(store.update(base)).rejects.toMatchObject({
      code: 'PERSISTENCE_REVISION_CONFLICT',
    });
    // Growing history (hold → offer): accepted.
    const offered = await applyOfferOperation(base, {
      amount: toMoney({ amount: 25_000, currency: 'USD' }),
      operationKey: 'op-offer-1',
      lifecycleState: 'offered',
      now: T0 + 1,
    });
    await store.update(offered.ledger);
    expect((await store.get('req_pay_1', 'tenant-alpha'))?.state).toBe('offered');
    // A stale-base same-length update (the racing loser's shape): rejected.
    await expect(store.update(offered.ledger)).rejects.toMatchObject({
      code: 'PERSISTENCE_REVISION_CONFLICT',
    });
  });

  it('makes a second application of the SAME operation key unrepresentable (the F-09 gate)', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const store = new DurablePaymentLedgerStore({ transport, clock });
    const base = await ledgerFixture({ requestId: 'req_pay_1', holdKey: 'op-hold-1' });
    await store.insert(base);

    // (a) The DOMAIN idempotency index (the sequential-replay guard): a
    // same-key re-submission against the recorded ledger replays as a
    // duplicate — nothing new is appended.
    const reHeld = await applyHoldOperation(base, {
      amount: toMoney({ amount: 25_000, currency: 'USD' }),
      operationKey: 'op-hold-1',
      lifecycleState: 'created',
      now: T0 + 1,
    });
    expect(reHeld.outcome).toBe('duplicate');

    // (b) The STORAGE-level exactly-once gate: a structurally-valid ledger
    // document that grew while REPEATING an already-recorded operation key
    // (the charge-succeeded/record-failed double-act shape — exactly what a
    // racing loser would try to append) is refused by the UNIQUE
    // (request_id, operation_key) index — fail closed, never a silent
    // double-application.
    const doubleAct = {
      ...base,
      entries: [
        ...base.entries,
        { ...base.entries[0], sequence: 2, occurredAt: new Date(T0 + 1).toISOString() },
      ],
      operations: [...base.operations],
      updatedAt: new Date(T0 + 1).toISOString(),
    } as unknown as PaymentLedger;
    await expect(store.update(doubleAct)).rejects.toBeInstanceOf(Error);

    // The durable state is untouched: still exactly ONE entry row for the
    // operation key, still the recorded state.
    const read = await store.get('req_pay_1', 'tenant-alpha');
    expect(read?.entries.length).toBe(1);
    expect(read?.state).toBe('held');
  });

  it('dedupes payment outbox events by eventId and marks deliveries idempotently', async () => {
    const transport = new MemoryRuntimeTransport();
    const clock = new ManualClock(T0);
    const outbox = new DurablePaymentEventOutbox({ transport, clock });
    const event = {
      eventVersion: 1,
      eventId: 'evt_pay_1',
      eventType: 'escalation.payment.updated',
      requestId: 'req_pay_1',
      tenantId: 'tenant-alpha',
      sequence: 1,
      occurredAt: new Date(T0).toISOString(),
      state: null,
      data: {},
    } as unknown as Parameters<DurablePaymentEventOutbox['append']>[0];
    const envelope = {
      envelopeVersion: 1,
      id: 'env_pay_1',
      issuedAt: new Date(T0).toISOString(),
      correlationId: 'corr-pay',
      idempotencyKey: 'idem-pay',
      payload: event,
    } as unknown as Parameters<DurablePaymentEventOutbox['append']>[1];
    await outbox.append(event, envelope);
    await expect(outbox.append(event, envelope)).rejects.toMatchObject({
      code: 'PERSISTENCE_RECORD_EXISTS',
    });
    expect(await outbox.listPending()).toHaveLength(1);
    await outbox.markDelivered('evt_pay_1', T0 + 1);
    await outbox.markDelivered('evt_pay_1', T0 + 2); // idempotent
    expect(await outbox.listPending()).toEqual([]);
    expect(await outbox.listAll()).toHaveLength(1);
    expect((await outbox.listAll())[0]?.deliveredAt).toBe(T0 + 1);
  });
});
