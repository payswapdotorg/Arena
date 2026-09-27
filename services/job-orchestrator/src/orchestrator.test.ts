/**
 * JobOrchestrator golden paths — positive AND negative tests (gates 4, 6,
 * 8): submission, idempotent dedup + conflicts, both addressability
 * lookups, claim/complete/fail/cancel, deterministic retry simulation with
 * injected time (NO wall-clock sleeps), timeout sweeps, and the audit
 * trail for every consequential mutation.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CreateJobDefinitionInput, JobDefinition } from '@arena/job-protocol';
import {
  createJobDefinition,
  JobError,
  JOB_ERROR_CODES,
  verifyAuditChain,
} from '@arena/job-protocol';
import { InMemoryEventSink, InMemoryJobStore, ManualClock } from './in-memory.js';
import { JobOrchestrator } from './orchestrator.js';

const CORR = toCorrelationId('corr-42');
const IDEM = toIdempotencyKey('idem-42');
const ACTOR = { type: 'user', tenant: 'arena', principalId: 'expert-7' } as const;

const START_MS = Date.parse('2026-01-15T09:30:00.000Z');

const BASE_INPUT: CreateJobDefinitionInput = {
  kind: { namespace: 'billing', name: 'reconcile-ledger', version: '1.2.0' },
  inputSchema: 'arena:schema/artifacts/material-artifact@1.0.0',
  correlationAddress: 'arena/jobs/billing/reconciliation',
  idempotency: { scope: 'billing-reconcile' },
  timeout: { timeoutMs: 30_000 },
  retry: {
    maxAttempts: 3,
    backoffScheduleMs: [1_000, 5_000],
    retryableErrorClasses: ['transient', 'timeout'],
  },
  priority: 'high',
};

async function definition(
  overrides: Partial<CreateJobDefinitionInput> = {},
): Promise<JobDefinition> {
  return createJobDefinition({ ...BASE_INPUT, ...overrides });
}

function harness(definition: JobDefinition) {
  const clock = new ManualClock(START_MS);
  const store = new InMemoryJobStore();
  const sink = new InMemoryEventSink();
  const orchestrator = new JobOrchestrator({ clock, store, sink });
  const submit = (idempotencyKey = IDEM, correlationId = CORR, jobId = 'job-0001') =>
    orchestrator.submit({
      definition,
      input: { ledger: 'q3' },
      correlationId,
      idempotencyKey,
      jobId,
      actor: ACTOR,
    });
  return { clock, store, sink, orchestrator, submit };
}

describe('orchestrator — submission + idempotency (gate 4)', () => {
  it('submits a queued job and emits submitted + audit events', async () => {
    const def = await definition();
    const { orchestrator, sink, submit } = harness(def);
    const record = await submit();
    expect(record.status).toBe('queued');
    expect(record.definitionDigest).toBe(def.digest);
    expect(record.events.map((event) => event.kind)).toEqual(['job-submitted']);
    expect((await orchestrator.get('job-0001'))?.status).toBe('queued');
    // the sink received the domain event AND the audit event
    expect(sink.envelopes()).toHaveLength(2);
    expect(sink.envelopes()[0]?.payload.kind).toBe('job-submitted');
    expect(sink.envelopes()[1]?.payload.kind).toBe('mutation-audited');
    expect(sink.auditRecords()).toHaveLength(1);
    expect(sink.auditRecords()[0]?.payload.mutation).toBe('job.submit');
    expect(sink.auditRecords()[0]?.payload.actor.principalId).toBe('expert-7');
  });

  it('same (idempotency key, correlation id) twice returns the SAME record — no duplicate execution', async () => {
    const def = await definition();
    const { orchestrator, sink, submit } = harness(def);
    const first = await submit();
    const second = await submit();
    expect(second).toBe(first); // the SAME record object
    expect(second.jobId).toBe(first.jobId);
    // no additional events or audit records for the idempotent hit
    expect(sink.envelopes()).toHaveLength(2);
    expect(sink.auditRecords()).toHaveLength(1);
    expect((await orchestrator.retryDue())).toHaveLength(0);
  });

  it('different correlation ids produce DISTINCT jobs', async () => {
    const def = await definition();
    const { orchestrator, submit } = harness(def);
    const a = await submit(IDEM, CORR, 'job-0001');
    const b = await submit(IDEM, toCorrelationId('corr-43'), 'job-0002');
    expect(b.jobId).not.toBe(a.jobId);
    expect(b.correlationId).toBe('corr-43');
    expect((await orchestrator.findByCorrelationId(CORR)).map((r) => r.jobId)).toEqual([a.jobId]);
    expect((await orchestrator.findByCorrelationId('corr-43')).map((r) => r.jobId)).toEqual([
      b.jobId,
    ]);
  });

  it('jobs are addressable by job id AND by correlation id', async () => {
    const def = await definition();
    const { orchestrator, submit } = harness(def);
    const record = await submit();
    const byId = await orchestrator.get('job-0001');
    expect(byId?.jobId).toBe(record.jobId);
    const byCorrelation = await orchestrator.findByCorrelationId(CORR);
    expect(byCorrelation).toHaveLength(1);
    expect(byCorrelation[0]?.jobId).toBe(record.jobId);
    expect(await orchestrator.get('nope')).toBeUndefined();
    expect(await orchestrator.findByCorrelationId('nope')).toEqual([]);
  });

  it('idempotency key reuse with a DIFFERENT definition digest is a CONFLICT', async () => {
    const defA = await definition();
    const defB = await definition({ timeout: { timeoutMs: 31_000 } });
    expect(defB.digest).not.toBe(defA.digest);
    const { orchestrator, submit } = harness(defA);
    await submit();
    // same (scope, key, correlation) but a different definition digest
    await expect(
      orchestrator.submit({
        definition: defB,
        input: { ledger: 'q3' },
        correlationId: CORR,
        idempotencyKey: IDEM,
        actor: ACTOR,
      }),
    ).rejects.toMatchObject({ code: JOB_ERROR_CODES.IDENTITY_CONFLICT });
  });

  it('a DIFFERENT idempotency scope is a different key space (no conflict)', async () => {
    const defA = await definition();
    const defB = await definition({ idempotency: { scope: 'other-scope' } });
    expect(defB.digest).not.toBe(defA.digest);
    const { orchestrator, submit } = harness(defA);
    await submit();
    const other = await orchestrator.submit({
      definition: defB,
      input: { ledger: 'q3' },
      correlationId: CORR,
      idempotencyKey: IDEM,
      jobId: 'job-0002',
      actor: ACTOR,
    });
    expect(other.jobId).toBe('job-0002');
  });

  it('rejects unknown jobs and duplicate job ids', async () => {
    const def = await definition();
    const { orchestrator, submit, store } = harness(def);
    await expect(orchestrator.claim({ jobId: 'nope', actor: ACTOR })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.INVALID_RECORD,
    });
    await submit();
    const record = await orchestrator.get('job-0001');
    expect(record).toBeDefined();
    if (record !== undefined) {
      await expect(store.insert(record)).rejects.toThrow(JobError);
    }
  });
});

describe('orchestrator — lifecycle + retry simulation (gate 6, NO sleeps)', () => {
  it('claim → complete golden path with audit trail', async () => {
    const def = await definition();
    const { orchestrator, sink, submit } = harness(def);
    await submit();
    const running = await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    expect(running.status).toBe('running');
    expect(running.attempts).toBe(1);
    expect(running.timeoutAt).toBe('2026-01-15T09:30:30.000Z');
    const progressed = await orchestrator.progress({
      jobId: 'job-0001',
      percent: 50,
      actor: ACTOR,
    });
    expect(progressed.progress?.percent).toBe(50);
    const done = await orchestrator.complete({
      jobId: 'job-0001',
      result: { rows: 10 },
      actor: ACTOR,
    });
    expect(done.status).toBe('succeeded');
    // every consequential mutation audited: submit, claim, progress, complete
    expect(sink.auditRecords().map((record) => record.payload.mutation)).toEqual([
      'job.submit',
      'job.claim',
      'job.progress',
      'job.complete',
    ]);
    // per-job event log: 4 lifecycle events in order
    const log = sink.jobEventLog('job-0001');
    expect(log?.envelopes.map((envelope) => envelope.payload.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-progressed',
      'job-completed',
    ]);
    await expect(sink.verify()).resolves.toBeUndefined();
  });

  it('terminal jobs are final: further mutations throw', async () => {
    const def = await definition();
    const { orchestrator, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    await orchestrator.complete({ jobId: 'job-0001', result: null, actor: ACTOR });
    for (const attempt of [
      () => orchestrator.claim({ jobId: 'job-0001', actor: ACTOR }),
      () => orchestrator.complete({ jobId: 'job-0001', result: null, actor: ACTOR }),
      () =>
        orchestrator.fail({
          jobId: 'job-0001',
          errorClass: 'transient',
          message: 'x',
          actor: ACTOR,
        }),
      () => orchestrator.cancel({ jobId: 'job-0001', reason: 'x', actor: ACTOR }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({
        code: JOB_ERROR_CODES.TERMINAL_STATE,
      });
    }
  });

  it('deterministic retry simulation: attempts, backoff gates, retryDue, exhaustion', async () => {
    const def = await definition(); // backoff [1000, 5000], maxAttempts 3, retryable: transient
    const { clock, orchestrator, submit } = harness(def);
    await submit(); // t = 09:30:00.000
    let record = await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    expect(record.attempts).toBe(1);

    // attempt 1 fails with a retryable class → requeued behind 1s backoff
    record = await orchestrator.fail({
      jobId: 'job-0001',
      errorClass: 'transient',
      message: 'flake 1',
      actor: ACTOR,
    });
    expect(record.status).toBe('queued');
    expect(record.nextRetryAt).toBe('2026-01-15T09:30:01.000Z');
    // not due yet (clock at 09:30:00)
    expect(await orchestrator.retryDue()).toHaveLength(0);
    // claiming inside the backoff window is rejected
    await expect(orchestrator.claim({ jobId: 'job-0001', actor: ACTOR })).rejects.toMatchObject({
      code: JOB_ERROR_CODES.INVALID_TRANSITION,
    });
    // advance 1s (no sleeps — injected clock) → due
    clock.advance(1_000);
    const due = await orchestrator.retryDue();
    expect(due.map((entry) => entry.jobId)).toEqual(['job-0001']);

    // attempt 2
    record = await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    expect(record.attempts).toBe(2);
    record = await orchestrator.fail({
      jobId: 'job-0001',
      errorClass: 'transient',
      message: 'flake 2',
      actor: ACTOR,
    });
    expect(record.nextRetryAt).toBe('2026-01-15T09:30:06.000Z'); // 09:30:01 + 5000ms

    // attempt 3 (after the 5s backoff) fails terminally: retries exhausted
    clock.advance(5_000);
    record = await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    expect(record.attempts).toBe(3);
    record = await orchestrator.fail({
      jobId: 'job-0001',
      errorClass: 'transient',
      message: 'flake 3',
      actor: ACTOR,
    });
    expect(record.status).toBe('failed');
    expect(record.failure).toEqual({
      kind: 'error',
      errorClass: 'transient',
      message: 'flake 3',
    });
    expect(record.attemptHistory.map((attempt) => attempt.outcome)).toEqual([
      'failed',
      'failed',
      'failed',
    ]);
  });

  it('non-retryable error classes fail terminally on the first attempt', async () => {
    const def = await definition();
    const { orchestrator, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    const record = await orchestrator.fail({
      jobId: 'job-0001',
      errorClass: 'permanent',
      message: 'bad shape',
      actor: ACTOR,
    });
    expect(record.status).toBe('failed');
    expect(record.attempts).toBe(1);
  });
});

describe('orchestrator — timeout policy (gate 6)', () => {
  it('timeoutDue marks a past-deadline running job timed-out (terminal, kind timeout)', async () => {
    const def = await definition({ retry: { maxAttempts: 1, backoffScheduleMs: [], retryableErrorClasses: [] } });
    const { clock, orchestrator, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR }); // deadline +30s
    // before the deadline: nothing to sweep
    expect(await orchestrator.timeoutDue()).toHaveLength(0);
    clock.advance(30_000); // exactly at the deadline
    const swept = await orchestrator.timeoutDue();
    expect(swept).toHaveLength(1);
    expect(swept[0]?.status).toBe('failed');
    expect(swept[0]?.failure?.kind).toBe('timeout');
    expect(swept[0]?.failure?.errorClass).toBe('timeout');
    expect(swept[0]?.attemptHistory[0]?.outcome).toBe('timed-out');
  });

  it('a retryable timeout re-queues the job (timeout in retryableErrorClasses)', async () => {
    const def = await definition(); // retryable includes 'timeout', maxAttempts 3
    const { clock, orchestrator, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    clock.advance(30_000);
    const swept = await orchestrator.timeoutDue();
    expect(swept[0]?.status).toBe('queued');
    expect(swept[0]?.nextRetryAt).toBe('2026-01-15T09:30:31.000Z'); // 09:30:30 + 1000ms backoff
    // claim again after the backoff → attempt 2
    clock.advance(1_000);
    const again = await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    expect(again.attempts).toBe(2);
  });
});

describe('orchestrator — audit trail integrity (gate 7)', () => {
  it('every consequential mutation appends to the tamper-evident chain', async () => {
    const def = await definition();
    const { orchestrator, sink, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    await orchestrator.cancel({ jobId: 'job-0001', reason: 'replaced', actor: ACTOR });
    const mutations = sink.auditRecords().map((record) => record.payload.mutation);
    expect(mutations).toEqual(['job.submit', 'job.claim', 'job.cancel']);
    // each audit names the job, correlation id AND the domain envelope id
    for (const record of sink.auditRecords()) {
      expect(record.payload.jobId).toBe('job-0001');
      expect(record.payload.correlationId).toBe(CORR);
      expect(record.payload.envelopeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
    await expect(sink.verify()).resolves.toBeUndefined();
  });

  it('a tampered audit chain fails verification (fail closed)', async () => {
    const def = await definition();
    const { sink, submit } = harness(def);
    await submit();
    // simulate an attacker rewriting the first audit payload
    const forged = JSON.parse(JSON.stringify(sink.auditRecords())) as unknown as {
      payload: { mutation: string };
    }[];
    const first = forged[0];
    if (first !== undefined) {
      first.payload.mutation = 'job.cancel';
    }
    await expect(
      verifyAuditChain({
        records: forged as unknown as Parameters<typeof verifyAuditChain>[0]['records'],
      }),
    ).rejects.toThrow();
  });

  it('timeout sweeps are audited with the service principal', async () => {
    const def = await definition({ retry: { maxAttempts: 1, backoffScheduleMs: [], retryableErrorClasses: [] } });
    const { clock, orchestrator, sink, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    clock.advance(30_000);
    await orchestrator.timeoutDue();
    const last = sink.auditRecords()[sink.auditRecords().length - 1];
    expect(last?.payload.mutation).toBe('job.timeout');
    expect(last?.payload.actor.principalId).toBe('job-orchestrator');
    expect(last?.payload.actor.type).toBe('service');
  });
});

describe('orchestrator — event stream integrity (gate 5)', () => {
  it('the per-job envelope log is contiguous and ordered', async () => {
    const def = await definition();
    const { orchestrator, sink, submit } = harness(def);
    await submit();
    await orchestrator.claim({ jobId: 'job-0001', actor: ACTOR });
    await orchestrator.complete({ jobId: 'job-0001', result: null, actor: ACTOR });
    const log = sink.jobEventLog('job-0001');
    expect(log?.envelopes.map((envelope) => envelope.payload.sequence)).toEqual([1, 2, 3]);
    // every envelope carries the job's correlation id + idempotency key
    for (const envelope of log?.envelopes ?? []) {
      expect(envelope.correlationId).toBe(CORR);
      expect(envelope.idempotencyKey).toBe(IDEM);
    }
    await expect(sink.verify()).resolves.toBeUndefined();
  });
});
