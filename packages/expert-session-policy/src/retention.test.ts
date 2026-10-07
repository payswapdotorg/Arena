/**
 * Retention engine tests (Work Order C018 acceptance: unit —
 * retention/disposition transitions; adversarial — deletion double-spend
 * → typed duplicate outcome, no double effect).
 */

import { describe, expect, it } from 'vitest';
import {
  applyDispositionTransition,
  createRetentionSubject,
  evaluateRetentionExpiry,
  executeDisposition,
  requestCustomerErasure,
  requestExpertWithdrawal,
} from './retention.js';
import type { RetentionScheduleEntry } from './retention.js';
import { ExpertSessionPolicyError } from './errors.js';
import { TENANT_A, T0, T1, T2 } from './test-support.js';

const entry = (overrides: Partial<RetentionScheduleEntry> = {}): RetentionScheduleEntry => ({
  artifactClass: 'session-transcript',
  retentionDays: 30,
  disposition: 'ANONYMIZE',
  ...overrides,
});

function subject(overrides: Partial<Parameters<typeof createRetentionSubject>[0]> = {}) {
  return createRetentionSubject({
    subjectId: 'subject-0001',
    tenantId: TENANT_A,
    requestId: 'esc_11111111111111111111111111111111',
    artifactClass: 'session-transcript',
    entry: entry(),
    now: T0,
    ...overrides,
  });
}

describe('retention subjects', () => {
  it('creates a RETAIN subject with computed expiry and empty history', () => {
    const record = subject();
    expect(record.state).toBe('RETAIN');
    expect(record.recordedAt).toBe(T0);
    expect(record.expiresAt).toBe(T1); // +30 days
    expect(record.history).toEqual([]);
  });

  it('evaluates expiry as a typed verdict (within-window → disposition-due)', () => {
    const record = subject();
    expect(evaluateRetentionExpiry(record, '2026-10-20T10:00:00.000Z').outcome).toBe('within-window');
    expect(evaluateRetentionExpiry(record, T1).outcome).toBe('disposition-due');
    expect(evaluateRetentionExpiry(record, T2).outcome).toBe('disposition-due');
  });
});

describe('disposition transitions (closed state machine)', () => {
  it('walks RETAIN → ANONYMIZE → DELETE_PENDING → DELETED with audit history appended at every step', () => {
    let record = subject();
    record = applyDispositionTransition(record, { to: 'ANONYMIZE', reason: 'retention-expiry', now: T1 });
    expect(record.state).toBe('ANONYMIZE');
    expect(record.history.length).toBe(1);
    record = applyDispositionTransition(record, { to: 'DELETE_PENDING', reason: 'customer-erasure', requestId: 'erasure-1', now: T1 });
    expect(record.state).toBe('DELETE_PENDING');
    expect(record.erasureRequestIds).toEqual(['erasure-1']);
    record = applyDispositionTransition(record, { to: 'DELETED', reason: 'disposition-executed', now: T2 });
    expect(record.state).toBe('DELETED');
    expect(record.history.length).toBe(3);
    // THE AUDIT HISTORY OUTLIVES THE DATA (security.md revocation law).
    expect(record.history.map((step) => step.to)).toEqual(['ANONYMIZE', 'DELETE_PENDING', 'DELETED']);
  });

  it('rejects illegal transitions with typed failures (RETAIN → DELETED skips states)', () => {
    const record = subject();
    expect(() =>
      applyDispositionTransition(record, { to: 'DELETED', reason: 'disposition-executed', now: T1 }),
    ).toThrow(ExpertSessionPolicyError);
  });

  it('DELETED is terminal: any further transition throws the typed terminal failure', () => {
    let record = subject();
    record = applyDispositionTransition(record, { to: 'DELETE_PENDING', reason: 'customer-erasure', requestId: 'e1', now: T1 });
    record = executeDisposition(record, T2);
    expect(() => applyDispositionTransition(record, { to: 'ANONYMIZE', reason: 'retention-expiry', now: T2 })).toThrow(
      ExpertSessionPolicyError,
    );
  });
});

describe('customer erasure (explicit state machine, double-spend safe)', () => {
  it('schedules erasure RETAIN → DELETE_PENDING and records the request id', () => {
    const record = subject();
    const verdict = requestCustomerErasure(record, { requestId: 'erasure-0001', now: T1 });
    expect(verdict.outcome).toBe('erasure-scheduled');
    expect(verdict.subject.state).toBe('DELETE_PENDING');
    expect(verdict.subject.erasureRequestIds).toEqual(['erasure-0001']);
  });

  it('DELETION DOUBLE-SPEND: a second request is the typed duplicate outcome with NO second effect', () => {
    let record = subject();
    const first = requestCustomerErasure(record, { requestId: 'erasure-0001', now: T1 });
    record = first.subject;
    const second = requestCustomerErasure(record, { requestId: 'erasure-0002', now: T2 });
    expect(second.outcome).toBe('duplicate-erasure-request');
    expect(second.subject).toBe(record); // unchanged — no double effect
    expect(second.subject.erasureRequestIds).toEqual(['erasure-0001']);
    expect(second.subject.history.length).toBe(1);
    const replayedSameId = requestCustomerErasure(record, { requestId: 'erasure-0001', now: T2 });
    expect(replayedSameId.outcome).toBe('duplicate-erasure-request');
  });

  it('a duplicate request against a DELETED subject is still typed and effect-free', () => {
    let record = subject();
    record = requestCustomerErasure(record, { requestId: 'erasure-0001', now: T1 }).subject;
    record = executeDisposition(record, T2);
    const verdict = requestCustomerErasure(record, { requestId: 'erasure-0009', now: T2 });
    expect(verdict.outcome).toBe('duplicate-erasure-request');
    expect(verdict.subject.history.length).toBe(2);
  });

  it('executing disposition twice throws the typed DUPLICATE_DISPOSITION failure', () => {
    let record = subject();
    record = requestCustomerErasure(record, { requestId: 'erasure-0001', now: T1 }).subject;
    record = executeDisposition(record, T2);
    expect(() => executeDisposition(record, T2)).toThrow(ExpertSessionPolicyError);
  });
});

describe('expert withdrawal (explicit state machine, never a silent drop)', () => {
  it('anonymizes the subject RETAIN → ANONYMIZE with the withdrawal reason', () => {
    const record = subject();
    const verdict = requestExpertWithdrawal(record, { requestId: 'withdraw-0001', now: T1 });
    expect(verdict.outcome).toBe('withdrawal-applied');
    expect(verdict.subject.state).toBe('ANONYMIZE');
    expect(verdict.subject.history[0]?.reason).toBe('expert-withdrawal');
  });

  it('rejects withdrawal on an already-anonymized or deleted subject (typed, no effect)', () => {
    let record = subject();
    record = requestExpertWithdrawal(record, { requestId: 'withdraw-0001', now: T1 }).subject;
    const verdict = requestExpertWithdrawal(record, { requestId: 'withdraw-0002', now: T2 });
    expect(verdict.outcome).toBe('withdrawal-rejected');
    expect(verdict.subject.state).toBe('ANONYMIZE');
  });
});
