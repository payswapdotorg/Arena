/**
 * JobRecord lifecycle — positive AND negative tests (gates 3, 6, 12):
 * append-only transitions, terminal-final semantics, retry/timeout
 * decisions, embedded event history, deep-freeze, strict wire parsing.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CreateJobRecordInput } from './record.js';
import {
  cancelJob,
  claimJob,
  completeJob,
  createJobRecord,
  failJob,
  isJobRecord,
  isTerminalJobRecord,
  JOB_RECORD_VERSION,
  parseJobRecord,
  progressJob,
  timeoutJob,
} from './record.js';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import { TIMEOUT_ERROR_CLASS } from './shared.js';

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:30:30.000Z';
const T2 = '2026-01-15T09:31:00.000Z';
const T3 = '2026-01-15T09:31:30.000Z';
const DIGEST = 'cd'.repeat(32);
const CORR = toCorrelationId('corr-42');
const IDEM = toIdempotencyKey('idem-42');

const RETRY_3 = {
  maxAttempts: 3,
  backoffScheduleMs: [1_000, 5_000],
  retryableErrorClasses: ['transient'],
} as const;

const NO_RETRY = {
  maxAttempts: 1,
  backoffScheduleMs: [],
  retryableErrorClasses: ['transient'],
} as const;

const TIMEOUT_RETRYABLE = {
  maxAttempts: 2,
  backoffScheduleMs: [2_000],
  retryableErrorClasses: ['timeout'],
} as const;

function queued(policy: {
  maxAttempts: number;
  backoffScheduleMs: readonly number[];
  retryableErrorClasses: readonly string[];
}) {
  return createJobRecord({
    definitionDigest: DIGEST,
    kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
    correlationId: CORR,
    idempotencyKey: IDEM,
    idempotencyScope: 'billing-reconcile',
    input: { ledger: 'q3' },
    policy: { timeoutMs: 30_000, retry: policy },
    jobId: 'job-0001',
    submittedAt: T0,
  });
}

describe('record — creation (positive)', () => {
  it('creates a queued record seeded with the job-submitted event', () => {
    const record = queued(RETRY_3);
    expect(record.recordVersion).toBe(JOB_RECORD_VERSION);
    expect(record.status).toBe('queued');
    expect(record.attempts).toBe(0);
    expect(record.events).toHaveLength(1);
    expect(record.events[0]?.kind).toBe('job-submitted');
    expect(record.submittedAt).toBe(T0);
    expect(isTerminalJobRecord(record)).toBe(false);
    expect(isJobRecord(record)).toBe(true);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.events)).toBe(true);
    expect(Object.isFrozen(record.attemptHistory)).toBe(true);
    // deterministic job id when supplied
    expect(record.jobId).toBe('job-0001');
  });

  it('round-trips through the strict wire parser', () => {
    const record = parseJobRecord(JSON.parse(JSON.stringify(queued(RETRY_3))));
    expect(record).toEqual(queued(RETRY_3));
    expect(Object.isFrozen(record)).toBe(true);
  });
});

describe('record — creation (negative)', () => {
  const rejects = (input: unknown, code?: string) => {
    const attempt = () => createJobRecord(input as CreateJobRecordInput);
    if (code === undefined) {
      expect(attempt).toThrow(JobError);
      return;
    }
    expect(attempt).toThrow(expect.objectContaining({ code }));
  };

  it('rejects malformed ids, digests and addresses', () => {
    rejects(
      {
        ...{
          definitionDigest: DIGEST,
          kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
          correlationId: 'corr-42',
          idempotencyKey: 'idem-42',
          idempotencyScope: 'billing-reconcile',
          input: {},
          policy: { timeoutMs: 30_000, retry: RETRY_3 },
          submittedAt: T0,
        },
        jobId: 'bad id!',
      },
      JOB_ERROR_CODES.INVALID_IDENTITY,
    );
    rejects(
      {
        definitionDigest: 'nope',
        kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
        correlationId: 'corr-42',
        idempotencyKey: 'idem-42',
        idempotencyScope: 'billing-reconcile',
        input: {},
        policy: { timeoutMs: 30_000, retry: RETRY_3 },
        submittedAt: T0,
      },
      JOB_ERROR_CODES.INVALID_DIGEST,
    );
    rejects(
      {
        definitionDigest: DIGEST,
        kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
        correlationId: 'corr-42',
        idempotencyKey: 'idem-42',
        idempotencyScope: 'NOPE',
        input: {},
        policy: { timeoutMs: 30_000, retry: RETRY_3 },
        submittedAt: T0,
      },
      JOB_ERROR_CODES.INVALID_IDENTITY,
    );
    rejects(
      {
        definitionDigest: DIGEST,
        kind: { namespace: 'billing', name: 'reconcile', version: 'oops' },
        correlationId: 'corr-42',
        idempotencyKey: 'idem-42',
        idempotencyScope: 'billing-reconcile',
        input: {},
        policy: { timeoutMs: 30_000, retry: RETRY_3 },
        submittedAt: T0,
      },
      JOB_ERROR_CODES.INVALID_IDENTITY,
    );
  });

  it('rejects non-plain-JSON input and invalid policies/timestamps', () => {
    const base = {
      definitionDigest: DIGEST,
      kind: { namespace: 'billing', name: 'reconcile', version: '1.0.0' },
      correlationId: 'corr-42',
      idempotencyKey: 'idem-42',
      idempotencyScope: 'billing-reconcile',
      submittedAt: T0,
    };
    rejects(
      { ...base, input: new Date(), policy: { timeoutMs: 30_000, retry: RETRY_3 } },
      JOB_ERROR_CODES.INVALID_INPUT,
    );
    rejects(
      { ...base, input: {}, policy: { timeoutMs: 0, retry: RETRY_3 } },
      JOB_ERROR_CODES.INVALID_RECORD,
    );
    rejects(
      { ...base, input: {}, policy: { timeoutMs: 30_000, retry: { maxAttempts: 0 } } },
      JOB_ERROR_CODES.INVALID_RECORD,
    );
    rejects(
      { ...base, input: {}, policy: { timeoutMs: 30_000, retry: RETRY_3 }, submittedAt: 'nope' },
      JOB_ERROR_CODES.INVALID_TIMESTAMP,
    );
    rejects(
      { ...base, input: {}, policy: { timeoutMs: 30_000, retry: RETRY_3 }, correlationId: 'x y' },
      JOB_ERROR_CODES.INVALID_RECORD,
    );
    rejects(null, JOB_ERROR_CODES.INVALID_RECORD);
  });
});

describe('record — lifecycle happy paths (positive)', () => {
  it('queued → running → succeeded with an appended event per transition', () => {
    let record = queued(RETRY_3);
    record = claimJob(record, { at: T1 });
    expect(record.status).toBe('running');
    expect(record.attempts).toBe(1);
    expect(record.timeoutAt).toBe('2026-01-15T09:31:00.000Z'); // T1 + 30s
    expect(record.events.map((event) => event.kind)).toEqual(['job-submitted', 'job-started']);
    record = progressJob(record, { at: T2, percent: 50, note: 'halfway' });
    expect(record.progress?.percent).toBe(50);
    record = completeJob(record, { at: T3, result: { rows: 10 } });
    expect(record.status).toBe('succeeded');
    expect(record.result).toEqual({ rows: 10 });
    expect(record.attemptHistory).toHaveLength(1);
    expect(record.attemptHistory[0]?.outcome).toBe('succeeded');
    expect(record.timeoutAt).toBeUndefined();
    expect(record.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-progressed',
      'job-completed',
    ]);
    expect(isTerminalJobRecord(record)).toBe(true);
    // the terminal record still parses strictly
    expect(() => parseJobRecord(JSON.parse(JSON.stringify(record)))).not.toThrow();
  });

  it('fail with retry budget re-queues behind a backoff gate', () => {
    let record = queued(RETRY_3);
    record = claimJob(record, { at: T1 });
    record = failJob(record, { at: T2, errorClass: 'transient', message: 'flake' });
    expect(record.status).toBe('queued');
    expect(record.attempts).toBe(1);
    expect(record.nextRetryAt).toBe('2026-01-15T09:31:01.000Z'); // T2 + 1000ms
    expect(record.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-retried',
    ]);
    const retried = record.events[record.events.length - 1];
    expect(retried?.kind).toBe('job-retried');
    if (retried?.kind === 'job-retried') {
      expect(retried.backoffMs).toBe(1_000);
      expect(retried.nextAttempt).toBe(2);
      expect(retried.failedAttempt).toBe(1);
    }
    // claiming before the backoff elapses is rejected
    expect(() => claimJob(record, { at: '2026-01-15T09:31:00.500Z' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
    // claiming after the backoff elapses works
    const reclaimed = claimJob(record, { at: '2026-01-15T09:31:02.000Z' });
    expect(reclaimed.attempts).toBe(2);
    expect(reclaimed.nextRetryAt).toBeUndefined();
  });

  it('exhausted retries ⇒ failed with the FULL attempt history', () => {
    let record = queued(RETRY_3);
    record = claimJob(record, { at: T0 });
    record = failJob(record, { at: T1, errorClass: 'transient', message: 'flake 1' });
    // nextRetryAt = T1 + 1000ms = 09:30:31
    record = claimJob(record, { at: '2026-01-15T09:30:31.000Z' });
    record = failJob(record, { at: '2026-01-15T09:30:32.000Z', errorClass: 'transient', message: 'flake 2' });
    // nextRetryAt = 09:30:32 + 5000ms = 09:30:37
    record = claimJob(record, { at: '2026-01-15T09:30:37.000Z' });
    record = failJob(record, { at: '2026-01-15T09:30:38.000Z', errorClass: 'transient', message: 'flake 3' });
    expect(record.status).toBe('failed');
    expect(record.attempts).toBe(3);
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
    const failedEvent = record.events[record.events.length - 1];
    expect(failedEvent?.kind).toBe('job-failed');
    if (failedEvent?.kind === 'job-failed') {
      expect(failedEvent.attempts).toBe(3);
      expect(failedEvent.attemptHistory).toHaveLength(3);
    }
    expect(() => parseJobRecord(JSON.parse(JSON.stringify(record)))).not.toThrow();
  });

  it('non-retryable error classes fail terminally on the first attempt', () => {
    let record = queued(NO_RETRY);
    record = claimJob(record, { at: T0 });
    record = failJob(record, { at: T1, errorClass: 'permanent', message: 'bad input shape' });
    expect(record.status).toBe('failed');
    expect(record.failure?.kind).toBe('error');
    expect(record.attempts).toBe(1);
  });

  it('the timeout policy marks a running job timed-out (terminal, kind timeout)', () => {
    let record = queued(NO_RETRY);
    record = claimJob(record, { at: T0 }); // timeoutAt = T0 + 30s
    const timedOut = timeoutJob(record, { at: '2026-01-15T09:30:30.000Z' });
    expect(timedOut.status).toBe('failed');
    expect(timedOut.failure?.kind).toBe('timeout');
    expect(timedOut.failure?.errorClass).toBe(TIMEOUT_ERROR_CLASS);
    expect(timedOut.attemptHistory[0]?.outcome).toBe('timed-out');
    expect(timedOut.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-failed',
    ]);
    const failedEvent = timedOut.events[timedOut.events.length - 1];
    if (failedEvent?.kind === 'job-failed') {
      expect(failedEvent.failureKind).toBe('timeout');
    }
  });

  it('a retryable timeout re-queues the job', () => {
    let record = queued(TIMEOUT_RETRYABLE);
    record = claimJob(record, { at: T0 });
    record = timeoutJob(record, { at: '2026-01-15T09:30:30.000Z' });
    expect(record.status).toBe('queued');
    expect(record.nextRetryAt).toBe('2026-01-15T09:30:32.000Z');
    expect(record.attemptHistory[0]?.outcome).toBe('timed-out');
    expect(record.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-retried',
    ]);
  });

  it('cancellation is terminal from both queued and running', () => {
    const fromQueued = cancelJob(queued(RETRY_3), { at: T1, reason: 'not needed' });
    expect(fromQueued.status).toBe('cancelled');
    expect(fromQueued.cancellation?.reason).toBe('not needed');

    let record = queued(RETRY_3);
    record = claimJob(record, { at: T0 });
    const fromRunning = cancelJob(record, { at: T1, reason: 'replaced' });
    expect(fromRunning.status).toBe('cancelled');
    expect(fromRunning.attemptHistory[0]?.outcome).toBe('cancelled');
    expect(fromRunning.events.map((event) => event.kind)).toEqual([
      'job-submitted',
      'job-started',
      'job-cancelled',
    ]);
  });

  it('transitions are pure: the input record is never modified', () => {
    const original = queued(RETRY_3);
    const claimed = claimJob(original, { at: T1 });
    expect(original.status).toBe('queued');
    expect(original.events).toHaveLength(1);
    expect(claimed.status).toBe('running');
    expect(claimed).not.toBe(original);
    // deep-freeze: in-place mutation throws in strict mode
    expect(() => {
      'use strict';
      (original as unknown as { status: string }).status = 'running';
    }).toThrow();
  });
});

describe('record — lifecycle guards (negative)', () => {
  it('MUTATION AFTER TERMINAL THROWS (terminal = final), for every transition', () => {
    let record = queued(RETRY_3);
    record = claimJob(record, { at: T0 });
    const succeeded = completeJob(record, { at: T1, result: null });
    for (const attempt of [
      () => claimJob(succeeded, { at: T2 }),
      () => completeJob(succeeded, { at: T2, result: null }),
      () => failJob(succeeded, { at: T2, errorClass: 'transient', message: 'x' }),
      () => timeoutJob(succeeded, { at: T2 }),
      () => cancelJob(succeeded, { at: T2, reason: 'x' }),
      () => progressJob(succeeded, { at: T2, percent: 1 }),
    ]) {
      expect(attempt).toThrow(
        expect.objectContaining({ code: JOB_ERROR_CODES.TERMINAL_STATE }),
      );
    }
    expect(isTerminalJobRecord(succeeded)).toBe(true);
  });

  it('invalid source states are rejected', () => {
    const queuedRecord = queued(RETRY_3);
    expect(() => completeJob(queuedRecord, { at: T1, result: null })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
    expect(() => failJob(queuedRecord, { at: T1, errorClass: 'transient', message: 'x' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
    expect(() => progressJob(queuedRecord, { at: T1, percent: 1 })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
    expect(() => timeoutJob(queuedRecord, { at: T1 })).toThrow(JobError);
    const running = claimJob(queuedRecord, { at: T0 });
    expect(() => claimJob(running, { at: T1 })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
  });

  it('timeout before the deadline is rejected', () => {
    const record = claimJob(queued(NO_RETRY), { at: T0 });
    expect(() => timeoutJob(record, { at: '2026-01-15T09:30:29.999Z' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TRANSITION }),
    );
  });

  it('malformed transition inputs are rejected', () => {
    const record = claimJob(queued(RETRY_3), { at: T0 });
    expect(() => claimJob(queued(RETRY_3), { at: 'nope' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_TIMESTAMP }),
    );
    expect(() =>
      failJob(record, { at: T1, errorClass: 'Transient', message: 'x' }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_IDENTITY }));
    expect(() => failJob(record, { at: T1, errorClass: 'transient', message: '' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }),
    );
    expect(() => completeJob(record, { at: T1, result: new Date() })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_INPUT }),
    );
    expect(() => cancelJob(record, { at: T1, reason: '' })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }),
    );
    expect(() => progressJob(record, { at: T1, percent: 150 })).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.INVALID_EVENT }),
    );
  });
});

describe('record — strict wire parsing (negative)', () => {
  it('rejects a non-contiguous event sequence', () => {
    const record = queued(RETRY_3);
    const tampered = {
      ...JSON.parse(JSON.stringify(record)),
      events: [
        { ...JSON.parse(JSON.stringify(record)).events[0], sequence: 2 },
      ],
    };
    expect(() => parseJobRecord(tampered)).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_SEQUENCE_GAP }),
    );
  });

  it('rejects an out-of-order embedded history', () => {
    const base = JSON.parse(JSON.stringify(queued(RETRY_3)));
    const started = {
      eventVersion: 1,
      kind: 'job-started',
      sequence: 2,
      occurredAt: T1,
      jobId: 'job-0001',
      attempt: 1,
      timeoutAt: T2,
    };
    const completed = {
      eventVersion: 1,
      kind: 'job-completed',
      sequence: 2,
      occurredAt: T2,
      jobId: 'job-0001',
      attempt: 1,
      result: null,
    };
    // completed directly after submitted
    const badOrder = {
      ...base,
      status: 'succeeded',
      result: null,
      events: [base.events[0], completed],
    };
    expect(() => parseJobRecord(badOrder)).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }),
    );
    // events belonging to another job
    const foreign = {
      ...base,
      events: [base.events[0], { ...started, jobId: 'job-9999' }],
      status: 'running',
      attempts: 1,
      attemptHistory: [{ attempt: 1, startedAt: T1, outcome: 'pending' }],
      timeoutAt: T2,
    };
    expect(() => parseJobRecord(foreign)).toThrow(JobError);
    // a running record with a terminal last event
    const terminalWhileRunning = {
      ...base,
      status: 'running',
      events: [base.events[0], started, completed],
      attempts: 1,
      attemptHistory: [{ attempt: 1, startedAt: T1, outcome: 'pending' }],
    };
    expect(() => parseJobRecord(terminalWhileRunning)).toThrow(JobError);
    void started;
  });

  it('rejects status/detail incoherence and attempt-history drift', () => {
    const base = JSON.parse(JSON.stringify(queued(RETRY_3)));
    // succeeded without result
    expect(() => parseJobRecord({ ...base, status: 'succeeded' })).toThrow(JobError);
    // failed without failure
    expect(() => parseJobRecord({ ...base, status: 'failed' })).toThrow(JobError);
    // cancelled without cancellation
    expect(() => parseJobRecord({ ...base, status: 'cancelled' })).toThrow(JobError);
    // queued record carrying timeoutAt
    expect(() => parseJobRecord({ ...base, timeoutAt: T1 })).toThrow(JobError);
    // attempts disagrees with attemptHistory
    expect(() => parseJobRecord({ ...base, attempts: 2 })).toThrow(JobError);
    // an open attempt on a queued record
    expect(() =>
      parseJobRecord({
        ...base,
        attempts: 1,
        attemptHistory: [{ attempt: 1, startedAt: T1, outcome: 'pending' }],
      }),
    ).toThrow(JobError);
    // updatedAt before submittedAt
    expect(() =>
      parseJobRecord({ ...base, updatedAt: '2026-01-15T09:29:00.000Z' }),
    ).toThrow(JobError);
    // non-plain-JSON input
    expect(() => parseJobRecord({ ...base, input: { a: undefined } })).toThrow(JobError);
    // unknown recordVersion
    expect(() => parseJobRecord({ ...base, recordVersion: 2 })).toThrow(JobError);
    expect(isJobRecord({ ...base, recordVersion: 2 })).toBe(false);
  });
});
