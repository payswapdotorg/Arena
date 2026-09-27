/**
 * Shared value-type validators — positive AND negative tests for every
 * exported constructor/validator in shared.ts (Work Order A015 gate 12).
 */

import { describe, expect, it } from 'vitest';
import {
  closeJobAttempt,
  isContentDigest,
  isCorrelationAddress,
  isJobAttempt,
  isJobAttemptOutcome,
  isJobErrorClass,
  isJobFailureKind,
  isJobId,
  isJobKindIdentity,
  isJobNamespace,
  isJobName,
  isJobPriorityClass,
  isJobSemver,
  isJobState,
  isJobTimestamp,
  isMutationName,
  isNeutralId,
  isPlainJsonValue,
  isPrincipalRef,
  isTerminalJobState,
  JOB_ATTEMPT_OUTCOMES,
  JOB_FAILURE_KINDS,
  JOB_PRIORITY_CLASSES,
  JOB_STATES,
  JOB_TERMINAL_STATES,
  PRINCIPAL_TYPES,
  TIMEOUT_ERROR_CLASS,
  toCorrelationAddress,
  toContentDigest,
  toJobErrorClass,
  toJobId,
  toJobKindIdentity,
  toJobKindIdentity as toKind,
  toJobName,
  toJobNamespace,
  toJobSemver,
  toJobTimestamp,
  toMutationName,
  toNeutralId,
  toPrincipalRef,
} from './shared.js';
import { JOB_ERROR_CODES, JobError } from './errors.js';

const T0 = '2026-01-15T09:30:00.000Z';
const T1 = '2026-01-15T09:31:00.000Z';

describe('shared — pattern validators (positive)', () => {
  it('accepts well-formed namespace / name / semver', () => {
    expect(toJobNamespace('billing')).toBe('billing');
    expect(toJobName('reconcile-ledger')).toBe('reconcile-ledger');
    expect(toJobSemver('1.2.3')).toBe('1.2.3');
    expect(toJobSemver('0.0.1-alpha.1')).toBe('0.0.1-alpha.1');
    expect(isJobNamespace('ab')).toBe(true);
    expect(isJobName('x9-y')).toBe(true);
    expect(isJobSemver('2.0.0-rc.1')).toBe(true);
    expect(isJobSemver('2.0')).toBe(false);
  });

  it('accepts digests, job ids, correlation addresses and neutral ids', () => {
    expect(toContentDigest('ab'.repeat(32))).toBe('ab'.repeat(32));
    expect(isContentDigest('ab'.repeat(32))).toBe(true);
    expect(isContentDigest('AB'.repeat(32))).toBe(false);
    expect(toJobId('job-0001')).toBe('job-0001');
    expect(isJobId('job-0001')).toBe(true);
    expect(isJobId('bad id')).toBe(false);
    expect(toJobId('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(toCorrelationAddress('arena/jobs/billing')).toBe('arena/jobs/billing');
    expect(toCorrelationAddress('single')).toBe('single');
    expect(toNeutralId('billing-reconcile')).toBe('billing-reconcile');
    expect(toJobErrorClass('transient')).toBe('transient');
    expect(toMutationName('job.submit')).toBe('job.submit');
    expect(toMutationName('job.timeout')).toBe('job.timeout');
  });

  it('accepts canonical millisecond timestamps only', () => {
    expect(toJobTimestamp(T0)).toBe(T0);
    expect(isJobTimestamp('2026-01-15T09:30:00.000Z')).toBe(true);
  });

  it('accepts kind identities and principal refs', () => {
    const kind = toKind({ namespace: 'billing', name: 'reconcile', version: '1.0.0' });
    expect(kind).toEqual({ namespace: 'billing', name: 'reconcile', version: '1.0.0' });
    expect(Object.isFrozen(kind)).toBe(true);
    const principal = toPrincipalRef({
      type: 'service',
      tenant: 'arena',
      principalId: 'job-orchestrator',
    });
    expect(principal.type).toBe('service');
    expect(Object.isFrozen(principal)).toBe(true);
  });

  it('validates attempts: pending are open, closed carry endedAt', () => {
    expect(
      isJobAttempt({ attempt: 1, startedAt: T0, outcome: 'pending' }),
    ).toBe(true);
    expect(
      isJobAttempt({
        attempt: 1,
        startedAt: T0,
        outcome: 'failed',
        endedAt: T1,
        errorClass: 'transient',
      }),
    ).toBe(true);
    expect(
      isJobAttempt({ attempt: 1, startedAt: T0, outcome: 'succeeded', endedAt: T1 }),
    ).toBe(true);
    const closed = closeJobAttempt(
      { attempt: 1, startedAt: T0, outcome: 'pending' },
      'failed',
      T1,
      'transient',
    );
    expect(closed.outcome).toBe('failed');
    expect(closed.endedAt).toBe(T1);
    expect(closed.errorClass).toBe('transient');
  });
});

describe('shared — pattern validators (negative)', () => {
  const rejects = (fn: () => unknown, code?: string) => {
    expect(fn).toThrow(JobError);
    if (code !== undefined) {
      try {
        fn();
      } catch (error) {
        expect((error as JobError).code).toBe(code);
      }
    }
  };

  it('rejects malformed namespace / name / semver', () => {
    rejects(() => toJobNamespace('Billing'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobNamespace(''), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobName('Nope'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobSemver('1.2'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobSemver('1.2.3+build'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobSemver('v1.2.3'), JOB_ERROR_CODES.INVALID_IDENTITY);
    expect(isJobNamespace(42)).toBe(false);
    expect(isJobName(null)).toBe(false);
  });

  it('rejects malformed digests / ids / addresses / neutral ids / error classes', () => {
    rejects(() => toContentDigest('AB'.repeat(32)), JOB_ERROR_CODES.INVALID_DIGEST);
    rejects(() => toContentDigest('ab'.repeat(31)), JOB_ERROR_CODES.INVALID_DIGEST);
    rejects(() => toJobId('bad id!'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobId(''), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toCorrelationAddress('Arena/Jobs'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toCorrelationAddress('a/'.repeat(9)), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toNeutralId('NOPE'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toJobErrorClass('Transient'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toMutationName('Job.Submit'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toMutationName('.job'), JOB_ERROR_CODES.INVALID_IDENTITY);
    rejects(() => toMutationName('a.b.c.d.e'), JOB_ERROR_CODES.INVALID_IDENTITY);
    expect(isCorrelationAddress('UPPER/x')).toBe(false);
    expect(isNeutralId('nope nope')).toBe(false);
    expect(isJobErrorClass('')).toBe(false);
    expect(isMutationName('X')).toBe(false);
  });

  it('rejects non-canonical timestamps', () => {
    rejects(() => toJobTimestamp('2026-01-15T09:30:00Z'), JOB_ERROR_CODES.INVALID_TIMESTAMP);
    rejects(() => toJobTimestamp('2026-01-15T09:30:00.000+00:00'), JOB_ERROR_CODES.INVALID_TIMESTAMP);
    rejects(() => toJobTimestamp('not a date'), JOB_ERROR_CODES.INVALID_TIMESTAMP);
    rejects(() => toJobTimestamp('2026-02-30T09:30:00.000Z'), JOB_ERROR_CODES.INVALID_TIMESTAMP);
    expect(isJobTimestamp(123)).toBe(false);
  });

  it('rejects malformed kind identities and principal refs', () => {
    expect(() => toJobKindIdentity({ namespace: 'X', name: 'y', version: '1.0.0' })).toThrow(
      JobError,
    );
    expect(isJobKindIdentity({ namespace: 'x', name: 'y', version: 'oops' })).toBe(false);
    expect(() =>
      toPrincipalRef({ type: 'robot', tenant: 'arena', principalId: 'x' }),
    ).toThrow(JobError);
    expect(() => toPrincipalRef({ type: 'user', tenant: 'Arena', principalId: 'x' })).toThrow(
      JobError,
    );
    expect(isPrincipalRef({ type: 'user', tenant: 'arena' })).toBe(false);
  });

  it('rejects malformed attempts and illegal closes', () => {
    expect(isJobAttempt({ attempt: 0, startedAt: T0, outcome: 'pending' })).toBe(false);
    expect(
      isJobAttempt({ attempt: 1, startedAt: T0, outcome: 'pending', endedAt: T1 }),
    ).toBe(false);
    // endedAt BEFORE startedAt is rejected (equal timestamps are a legal
    // zero-duration attempt)
    expect(
      isJobAttempt({
        attempt: 1,
        startedAt: T0,
        outcome: 'failed',
        endedAt: '2026-01-15T09:29:00.000Z',
        errorClass: 'x',
      }),
    ).toBe(false);
    expect(
      isJobAttempt({ attempt: 1, startedAt: T0, outcome: 'succeeded', endedAt: T1, errorClass: 'x' }),
    ).toBe(false);
    // closing an already-closed attempt is rejected
    const closed = closeJobAttempt(
      { attempt: 1, startedAt: T0, outcome: 'pending' },
      'failed',
      T1,
      'transient',
    );
    expect(() => closeJobAttempt(closed, 'succeeded', T1)).toThrow(JobError);
    // ending before starting is rejected
    expect(() =>
      closeJobAttempt({ attempt: 1, startedAt: T1, outcome: 'pending' }, 'succeeded', T0),
    ).toThrow(JobError);
    // failed/timed-out outcomes require an error class
    expect(() =>
      closeJobAttempt({ attempt: 1, startedAt: T0, outcome: 'pending' }, 'failed', T1),
    ).toThrow(JobError);
    expect(() =>
      closeJobAttempt({ attempt: 1, startedAt: T0, outcome: 'pending' }, 'succeeded', T1, 'x'),
    ).toThrow(JobError);
  });

  it('rejects non-plain-JSON values', () => {
    expect(isPlainJsonValue({ a: [1, 'two', null, true] })).toBe(true);
    expect(isPlainJsonValue(undefined)).toBe(false);
    expect(isPlainJsonValue(() => 1)).toBe(false);
    expect(isPlainJsonValue(Number.NaN)).toBe(false);
    expect(isPlainJsonValue(new Date())).toBe(false);
    expect(isPlainJsonValue({ a: 1n })).toBe(false);
  });
});

describe('shared — closed vocabularies', () => {
  it('states, terminals, priorities, outcomes and failure kinds are closed', () => {
    expect([...JOB_STATES]).toEqual(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
    expect([...JOB_TERMINAL_STATES]).toEqual(['succeeded', 'failed', 'cancelled']);
    expect([...JOB_PRIORITY_CLASSES]).toEqual(['low', 'normal', 'high', 'critical']);
    expect([...JOB_ATTEMPT_OUTCOMES]).toEqual([
      'pending',
      'succeeded',
      'failed',
      'timed-out',
      'cancelled',
    ]);
    expect([...JOB_FAILURE_KINDS]).toEqual(['error', 'timeout']);
    expect([...PRINCIPAL_TYPES]).toEqual(['agent-body', 'expert', 'user', 'service', 'system']);
    expect(isJobState('queued')).toBe(true);
    expect(isJobState('waiting')).toBe(false);
    expect(isTerminalJobState('succeeded')).toBe(true);
    expect(isTerminalJobState('running')).toBe(false);
    expect(isJobPriorityClass('critical')).toBe(true);
    expect(isJobPriorityClass('urgent')).toBe(false);
    expect(isJobAttemptOutcome('timed-out')).toBe(true);
    expect(isJobAttemptOutcome('timeout')).toBe(false);
    expect(isJobFailureKind('timeout')).toBe(true);
    expect(isJobFailureKind('crash')).toBe(false);
  });

  it('the timeout error class is the reserved branded constant', () => {
    expect(TIMEOUT_ERROR_CLASS).toBe('timeout');
  });
});

// The predicate is exercised directly (there is no toJobPriorityClass
// constructor — priority classes are validated through isJobPriorityClass
// at definition construction).

describe('shared — priority predicate', () => {
  it('accepts exactly the closed priority classes', () => {
    expect(isJobPriorityClass('low')).toBe(true);
    expect(isJobPriorityClass('normal')).toBe(true);
    expect(isJobPriorityClass('high')).toBe(true);
    expect(isJobPriorityClass('critical')).toBe(true);
    expect(isJobPriorityClass('urgent')).toBe(false);
    expect(isJobPriorityClass('')).toBe(false);
  });
});
