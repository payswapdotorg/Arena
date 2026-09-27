/**
 * JobEvent taxonomy + append-only ordering — positive AND negative tests
 * (gates 3, 5, 12): closed kind set, structural validation, contiguous
 * sequences, kind ordering (out-of-order rejection), timestamp
 * monotonicity, and the mutation-audited construction helper.
 */

import { describe, expect, it } from 'vitest';
import {
  appendJobEvent,
  isJobEvent,
  isJobEventKind,
  isTerminalJobEventKind,
  JOB_EVENT_KINDS,
  JOB_EVENT_TERMINAL_KINDS,
  jobEventKey,
  makeMutationAuditedEvent,
  nextJobEventKinds,
  toJobEvent,
  validateJobEventAppend,
} from './events.js';
import { JOB_ERROR_CODES, JobError } from './errors.js';

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:31:00.000Z';
const T2 = '2026-01-15T09:32:00.000Z';
const DIGEST = 'ab'.repeat(32);

function submitted(sequence = 1, occurredAt = T0) {
  return {
    eventVersion: 1,
    kind: 'job-submitted',
    sequence,
    occurredAt,
    jobId: 'job-0001',
    definitionDigest: DIGEST,
    input: { ledger: 'q3' },
  } as const;
}

function started(sequence = 2, occurredAt = T1) {
  return {
    eventVersion: 1,
    kind: 'job-started',
    sequence,
    occurredAt,
    jobId: 'job-0001',
    attempt: 1,
    timeoutAt: T2,
  } as const;
}

describe('events — taxonomy (positive)', () => {
  it('the closed kind set is exactly the 8 v1 kinds', () => {
    expect([...JOB_EVENT_KINDS]).toEqual([
      'job-submitted',
      'job-started',
      'job-progressed',
      'job-retried',
      'job-completed',
      'job-failed',
      'job-cancelled',
      'mutation-audited',
    ]);
    expect([...JOB_EVENT_TERMINAL_KINDS]).toEqual([
      'job-completed',
      'job-failed',
      'job-cancelled',
    ]);
    expect(isJobEventKind('job-submitted')).toBe(true);
    expect(isJobEventKind('job-deleted')).toBe(false);
    expect(isTerminalJobEventKind('job-completed')).toBe(true);
    expect(isTerminalJobEventKind('job-retried')).toBe(false);
  });

  it('structural validation accepts well-formed payloads of every kind', () => {
    expect(isJobEvent(submitted())).toBe(true);
    expect(isJobEvent(started())).toBe(true);
    expect(
      isJobEvent({
        eventVersion: 1,
        kind: 'job-progressed',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempt: 1,
        percent: 50,
        note: 'halfway',
      }),
    ).toBe(true);
    expect(
      isJobEvent({
        eventVersion: 1,
        kind: 'job-retried',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        failedAttempt: 1,
        errorClass: 'transient',
        message: 'flake',
        nextAttempt: 2,
        backoffMs: 1_000,
        nextRetryAt: '2026-01-15T09:33:00.000Z',
      }),
    ).toBe(true);
    expect(
      isJobEvent({
        eventVersion: 1,
        kind: 'job-completed',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempt: 1,
        result: { ok: true },
      }),
    ).toBe(true);
    expect(
      isJobEvent({
        eventVersion: 1,
        kind: 'job-failed',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempts: 3,
        failureKind: 'timeout',
        errorClass: 'timeout',
        message: 'deadline',
        attemptHistory: [
          { attempt: 1, startedAt: T0, outcome: 'failed', endedAt: T1, errorClass: 'transient' },
        ],
      }),
    ).toBe(true);
    expect(
      isJobEvent({
        eventVersion: 1,
        kind: 'job-cancelled',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        reason: 'superseded',
      }),
    ).toBe(true);
  });

  it('toJobEvent validates and freezes, pinning the expected sequence', () => {
    const event = toJobEvent(submitted(), 1);
    expect(Object.isFrozen(event)).toBe(true);
    expect(jobEventKey(event)).toBe('job-submitted#1@job-0001');
    expect(() => toJobEvent(submitted(), 2)).toThrow(JobError);
  });

  it('makeMutationAuditedEvent builds a validated audit payload', () => {
    const audit = makeMutationAuditedEvent({
      sequence: 1,
      occurredAt: T0,
      jobId: 'job-0001',
      mutation: 'job.submit',
      actor: { type: 'service', tenant: 'arena', principalId: 'job-orchestrator' },
      correlationId: 'corr-42',
      envelopeId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(audit.kind).toBe('mutation-audited');
    expect(audit.actor.tenant).toBe('arena');
    expect(Object.isFrozen(audit)).toBe(true);
    expect(isJobEvent(audit)).toBe(true);
    expect(() =>
      makeMutationAuditedEvent({
        sequence: 0,
        occurredAt: T0,
        jobId: 'job-0001',
        mutation: 'job.submit',
        actor: { type: 'service', tenant: 'arena', principalId: 'x' },
        correlationId: 'corr-42',
        envelopeId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toThrow(JobError);
  });
});

describe('events — taxonomy (negative)', () => {
  it('structural validation rejects malformed payloads of every kind', () => {
    expect(isJobEvent({ ...submitted(), eventVersion: 2 })).toBe(false);
    expect(isJobEvent({ ...submitted(), kind: 'job-deleted' })).toBe(false);
    expect(isJobEvent({ ...submitted(), sequence: 0 })).toBe(false);
    expect(isJobEvent({ ...submitted(), occurredAt: '2026-01-15T09:30:00Z' })).toBe(false);
    expect(isJobEvent({ ...submitted(), jobId: 'bad id' })).toBe(false);
    expect(isJobEvent({ ...submitted(), definitionDigest: 'nope' })).toBe(false);
    expect(isJobEvent({ ...started(), attempt: 0 })).toBe(false);
    expect(isJobEvent({ ...started(), timeoutAt: 'nope' })).toBe(false);
    expect(
      isJobEvent({
        kind: 'job-progressed',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempt: 1,
        percent: 150,
      }),
    ).toBe(false);
    expect(
      isJobEvent({
        kind: 'job-retried',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        failedAttempt: 1,
        errorClass: 'Transient',
        message: 'x',
        nextAttempt: 2,
        backoffMs: 1,
        nextRetryAt: T2,
      }),
    ).toBe(false);
    expect(
      isJobEvent({
        kind: 'job-retried',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        failedAttempt: 1,
        errorClass: 'transient',
        message: '',
        nextAttempt: 2,
        backoffMs: 1,
        nextRetryAt: T2,
      }),
    ).toBe(false);
    expect(
      isJobEvent({
        kind: 'job-failed',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempts: 1,
        failureKind: 'crash',
        errorClass: 'transient',
        message: 'x',
        attemptHistory: [],
      }),
    ).toBe(false);
    expect(
      isJobEvent({
        kind: 'job-cancelled',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        reason: '',
      }),
    ).toBe(false);
    expect(
      isJobEvent({
        kind: 'mutation-audited',
        eventVersion: 1,
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        mutation: 'Not A Mutation',
        actor: { type: 'user', tenant: 'arena', principalId: 'u1' },
        correlationId: 'corr-1',
        envelopeId: 'not-a-uuid',
      }),
    ).toBe(false);
    expect(isJobEvent(null)).toBe(false);
    expect(isJobEvent('nope')).toBe(false);
  });

  it('toJobEvent rejects non-plain-JSON input/result payloads', () => {
    expect(() =>
      toJobEvent({ ...submitted(), input: new Date() }),
    ).toThrow(JobError);
    expect(() =>
      toJobEvent({
        eventVersion: 1,
        kind: 'job-completed',
        sequence: 1,
        occurredAt: T0,
        jobId: 'job-0001',
        attempt: 1,
        result: undefined,
      }),
    ).toThrow(JobError);
  });
});

describe('events — kind ordering table', () => {
  it('streams open with job-submitted only', () => {
    expect([...nextJobEventKinds(undefined)]).toEqual(['job-submitted']);
  });

  it('terminal kinds are followed by nothing', () => {
    expect([...nextJobEventKinds('job-completed')]).toEqual([]);
    expect([...nextJobEventKinds('job-failed')]).toEqual([]);
    expect([...nextJobEventKinds('job-cancelled')]).toEqual([]);
  });

  it('lifecycle edges are the closed set', () => {
    expect([...nextJobEventKinds('job-submitted')]).toEqual(['job-started', 'job-cancelled']);
    expect([...nextJobEventKinds('job-retried')]).toEqual(['job-started', 'job-cancelled']);
    expect([...nextJobEventKinds('job-started')]).toEqual([
      'job-progressed',
      'job-retried',
      'job-completed',
      'job-failed',
      'job-cancelled',
    ]);
    expect([...nextJobEventKinds('job-progressed')]).toEqual([
      'job-progressed',
      'job-retried',
      'job-completed',
      'job-failed',
      'job-cancelled',
    ]);
  });
});

describe('events — append-only ordering (embedded history)', () => {
  it('happy path: submitted → started → progressed → completed appends cleanly', () => {
    let events = appendJobEvent([], submitted());
    events = appendJobEvent(events, started(2, T1));
    events = appendJobEvent(events, {
      eventVersion: 1,
      kind: 'job-progressed',
      sequence: 3,
      occurredAt: T2,
      jobId: 'job-0001',
      attempt: 1,
      percent: 10,
    });
    events = appendJobEvent(events, {
      eventVersion: 1,
      kind: 'job-completed',
      sequence: 4,
      occurredAt: '2026-01-15T09:35:00.000Z',
      jobId: 'job-0001',
      attempt: 1,
      result: null,
    });
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('rejects a sequence GAP', () => {
    expect(() => appendJobEvent([submitted()], started(3, T1))).toThrow(JobError);
    expect(() => appendJobEvent([submitted()], started(3, T1))).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_SEQUENCE_GAP }),
    );
  });

  it('rejects a sequence DUPLICATE / regression', () => {
    const events = appendJobEvent([], submitted());
    expect(() => appendJobEvent(events, submitted(1, T1))).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE }),
    );
    expect(() => appendJobEvent(events, submitted(0, T1))).toThrow(JobError);
  });

  it('rejects OUT-OF-ORDER kinds (completed right after submitted)', () => {
    expect(() =>
      appendJobEvent([submitted()], {
        eventVersion: 1,
        kind: 'job-completed',
        sequence: 2,
        occurredAt: T1,
        jobId: 'job-0001',
        attempt: 1,
        result: null,
      }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }));
    // a stream that does not start with job-submitted is out of order
    expect(() => appendJobEvent([], started(1, T0))).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }),
    );
  });

  it('rejects anything after a TERMINAL event (terminal-final streams)', () => {
    const completed = appendJobEvent(
      [submitted(), started(2, T1)],
      {
        eventVersion: 1,
        kind: 'job-completed',
        sequence: 3,
        occurredAt: T2,
        jobId: 'job-0001',
        attempt: 1,
        result: null,
      },
    );
    expect(() =>
      appendJobEvent(completed, {
        eventVersion: 1,
        kind: 'job-progressed',
        sequence: 4,
        occurredAt: '2026-01-15T09:36:00.000Z',
        jobId: 'job-0001',
        attempt: 1,
      }),
    ).toThrow(expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }));
  });

  it('rejects timestamp REGRESSIONS', () => {
    expect(() => appendJobEvent([submitted(1, T1)], started(2, T0))).toThrow(
      expect.objectContaining({ code: JOB_ERROR_CODES.EVENT_OUT_OF_ORDER }),
    );
  });

  it('validateJobEventAppend never mutates the input history', () => {
    const events = appendJobEvent([], submitted());
    const lengthBefore = events.length;
    expect(() => validateJobEventAppend(events, started(5, T1))).toThrow();
    expect(events).toHaveLength(lengthBefore);
  });
});
