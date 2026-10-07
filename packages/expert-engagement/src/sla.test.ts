/**
 * SLA policy, clocks and breach-record unit + adversarial tests
 * (Work Order C011).
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SLA_POLICY,
  SLA_BREACH_REASONS,
  SLA_CLOCK_KINDS,
  SLA_CLOCK_STATES,
  createSlaBreachRecord,
  createSlaPolicy,
  deriveSlaClocks,
  evaluateSlaClocks,
  isSlaBreachRecord,
  isSlaClockState,
  slaBreachReasonFor,
  toSlaBreachSummary,
  verifySlaBreachRecordDigest,
} from './sla.js';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';

const T0 = '2026-10-07T09:00:00.000Z';
const ACCEPTED = '2026-10-07T09:20:00.000Z';
const ACTIVATED = '2026-10-07T10:00:00.000Z';
const DEADLINE = '2026-10-07T21:00:00.000Z';
const DIGEST = 'e'.repeat(64);

function expectCode(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(ExpertEngagementError);
  expect((error as ExpertEngagementError).code).toBe(code);
}

describe('SlaPolicy', () => {
  it('the default policy covers all four urgency classes with positive windows', () => {
    for (const urgency of ['routine', 'priority', 'urgent', 'critical'] as const) {
      const windows = DEFAULT_SLA_POLICY.windowsByUrgency[urgency];
      expect(windows.acceptMs).toBeGreaterThan(0);
      expect(windows.startMs).toBeGreaterThan(0);
      expect(windows.submitMs).toBeGreaterThan(0);
    }
  });

  it('custom policies must be explicit and complete (never silent defaults)', () => {
    expect(() => createSlaPolicy({ windowsByUrgency: {} })).toThrow(ExpertEngagementError);
    expect(() =>
      createSlaPolicy({
        windowsByUrgency: {
          routine: { acceptMs: 1, startMs: 1, submitMs: 1 },
          priority: { acceptMs: 1, startMs: 1, submitMs: 1 },
          urgent: { acceptMs: 1, startMs: 1, submitMs: 0 },
          critical: { acceptMs: 1, startMs: 1, submitMs: 1 },
        },
      }),
    ).toThrow(ExpertEngagementError);
    const policy = createSlaPolicy({
      windowsByUrgency: {
        routine: { acceptMs: 1, startMs: 2, submitMs: 3 },
        priority: { acceptMs: 4, startMs: 5, submitMs: 6 },
        urgent: { acceptMs: 7, startMs: 8, submitMs: 9 },
        critical: { acceptMs: 10, startMs: 11, submitMs: 12 },
      },
    });
    expect(policy.windowsByUrgency.urgent?.submitMs).toBe(9);
    expect(Object.isFrozen(policy)).toBe(true);
  });
});

describe('deriveSlaClocks (deadline-aware arithmetic)', () => {
  it('accept-by = offer + acceptMs; start-by chains off acceptance; submit-by off activation', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'urgent', requestDeadline: DEADLINE, offerIssuedAt: T0, acceptedAt: ACCEPTED, activatedAt: ACTIVATED },
      DEFAULT_SLA_POLICY,
    );
    // urgent: accept 1h, start 4h, submit 24h
    expect(clocks.acceptBy).toBe('2026-10-07T10:00:00.000Z');
    expect(clocks.startBy).toBe('2026-10-07T13:20:00.000Z');
    expect(clocks.submitBy).toBe(DEADLINE); // 24h submit window exceeds the deadline
    expect(clocks.submitByIsDeadlineCapped).toBe(true);
  });

  it('submit-by equals the request deadline exactly when the policy window exceeds it', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'urgent', requestDeadline: DEADLINE, offerIssuedAt: T0 },
      DEFAULT_SLA_POLICY,
    );
    expect(clocks.submitBy).toBe(DEADLINE);
    expect(clocks.submitByIsDeadlineCapped).toBe(true);
  });

  it('pre-acceptance derivation falls back to the accept-by origin (deterministic)', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'critical', requestDeadline: DEADLINE, offerIssuedAt: T0 },
      DEFAULT_SLA_POLICY,
    );
    // critical: accept 15m → accept-by 09:15; start 1h → 10:15; submit 4h → 14:15 (< deadline)
    expect(clocks.acceptBy).toBe('2026-10-07T09:15:00.000Z');
    expect(clocks.startBy).toBe('2026-10-07T10:15:00.000Z');
    expect(clocks.submitBy).toBe('2026-10-07T14:15:00.000Z');
    expect(clocks.submitByIsDeadlineCapped).toBe(false);
  });

  it('rejects a deadline at/before the offer (DEADLINE_PASSED)', () => {
    expect(() =>
      deriveSlaClocks({ urgency: 'urgent', requestDeadline: T0, offerIssuedAt: T0 }),
    ).toThrow(ExpertEngagementError);
  });

  it('rejects unknown urgency classes', () => {
    expect(() =>
      deriveSlaClocks({ urgency: 'whenever', requestDeadline: DEADLINE, offerIssuedAt: T0 }),
    ).toThrow(ExpertEngagementError);
  });
});

describe('evaluateSlaClocks (states with machine-readable reasons)', () => {
  it('on-track far from due; at-risk in the last quarter; breached past due', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'urgent', requestDeadline: DEADLINE, offerIssuedAt: T0 },
      DEFAULT_SLA_POLICY,
    );
    // accept-by 10:00, window 1h → at-risk when remaining <= 15m.
    const early = evaluateSlaClocks({
      clocks,
      urgency: 'urgent',
      at: '2026-10-07T09:16:00.000Z',
    });
    expect(early.acceptClock.state).toBe('on-track');
    const near = evaluateSlaClocks({
      clocks,
      urgency: 'urgent',
      at: '2026-10-07T09:46:00.000Z',
    });
    expect(near.acceptClock.state).toBe('at-risk');
    expect(near.acceptClock.reasons).toContain('clock-at-risk-remaining-quarter');
    const late = evaluateSlaClocks({
      clocks,
      urgency: 'urgent',
      at: '2026-10-07T10:00:00.001Z',
    });
    expect(late.acceptClock.state).toBe('breached');
    expect(late.acceptClock.reasons).toContain('clock-breached-deadline-passed');
  });

  it('a milestone before due satisfies the clock (never a breach)', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'urgent', requestDeadline: DEADLINE, offerIssuedAt: T0, acceptedAt: ACCEPTED },
      DEFAULT_SLA_POLICY,
    );
    const evaluation = evaluateSlaClocks({
      clocks,
      urgency: 'urgent',
      at: '2026-10-07T20:00:00.000Z',
      acceptedAt: ACCEPTED,
    });
    expect(evaluation.acceptClock.state).toBe('satisfied');
    expect(evaluation.acceptClock.reasons).toContain('clock-satisfied-before-due');
  });

  it('the derived evaluation carries one placeholder breach per breached clock', () => {
    const clocks = deriveSlaClocks(
      { urgency: 'urgent', requestDeadline: DEADLINE, offerIssuedAt: T0 },
      DEFAULT_SLA_POLICY,
    );
    const evaluation = evaluateSlaClocks({
      clocks,
      urgency: 'urgent',
      at: '2026-10-07T21:00:00.001Z', // past the deadline: every unmet clock is breached
    });
    expect(evaluation.submitClock.state).toBe('breached');
    expect(evaluation.breaches.length).toBe(3); // accept + start + submit all unmet
    const clockKinds = evaluation.breaches.map((breach) => breach.clock);
    expect(clockKinds).toEqual(['accept', 'start', 'submit']);
    expect(evaluation.breaches[2]?.reason).toBe('submit-deadline-passed-unsubmitted');
  });

  it('the closed vocabularies are exactly the spec sets', () => {
    expect([...SLA_CLOCK_KINDS]).toEqual(['accept', 'start', 'submit']);
    expect([...SLA_CLOCK_STATES]).toEqual(['satisfied', 'on-track', 'at-risk', 'breached']);
    expect([...SLA_BREACH_REASONS]).toEqual([
      'accept-deadline-passed-unaccepted',
      'start-deadline-passed-unstarted',
      'submit-deadline-passed-unsubmitted',
    ]);
    expect(isSlaClockState('breached')).toBe(true);
    expect(isSlaClockState('late')).toBe(false);
    expect(slaBreachReasonFor('accept')).toBe('accept-deadline-passed-unaccepted');
  });
});

describe('SlaBreachRecord (append-only events with reasons)', () => {
  it('constructs a frozen, content-addressed breach record', async () => {
    const record = await createSlaBreachRecord({
      breachId: 'sla-breach-1',
      tenant: 'tenant-a',
      engagementId: 'eng-alpha-1',
      engagementRef: DIGEST,
      clock: 'accept',
      dueAt: '2026-10-07T10:00:00.000Z',
      observedAt: '2026-10-07T10:00:00.000Z',
      reason: 'accept-deadline-passed-unaccepted',
    });
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(isSlaBreachRecord(record)).toBe(true);
  });

  it('rejects a pre-breach observation (observed must be >= due)', async () => {
    await expect(
      createSlaBreachRecord({
        breachId: 'sla-breach-2',
        tenant: 'tenant-a',
        engagementId: 'eng-alpha-1',
        engagementRef: DIGEST,
        clock: 'accept',
        dueAt: '2026-10-07T10:00:00.000Z',
        observedAt: '2026-10-07T09:00:00.000Z',
        reason: 'accept-deadline-passed-unaccepted',
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD);
      return true;
    });
  });

  it('rejects unknown clocks/reasons (closed vocabularies)', async () => {
    await expect(
      createSlaBreachRecord({
        breachId: 'sla-breach-3',
        tenant: 'tenant-a',
        engagementId: 'eng-alpha-1',
        engagementRef: DIGEST,
        clock: 'respond',
        dueAt: '2026-10-07T10:00:00.000Z',
        observedAt: '2026-10-07T10:00:00.000Z',
        reason: 'accept-deadline-passed-unaccepted',
      }),
    ).rejects.toThrow(ExpertEngagementError);
    await expect(
      createSlaBreachRecord({
        breachId: 'sla-breach-4',
        tenant: 'tenant-a',
        engagementId: 'eng-alpha-1',
        engagementRef: DIGEST,
        clock: 'accept',
        dueAt: '2026-10-07T10:00:00.000Z',
        observedAt: '2026-10-07T10:00:00.000Z',
        reason: 'expert-was-slow',
      }),
    ).rejects.toThrow(ExpertEngagementError);
  });

  it('ADVERSARIAL: a tampered breach record fails digest verification (TAMPERED)', async () => {
    const record = await createSlaBreachRecord({
      breachId: 'sla-breach-5',
      tenant: 'tenant-a',
      engagementId: 'eng-alpha-1',
      engagementRef: DIGEST,
      clock: 'submit',
      dueAt: '2026-10-07T21:00:00.000Z',
      observedAt: '2026-10-07T21:00:00.000Z',
      reason: 'submit-deadline-passed-unsubmitted',
    });
    await expect(verifySlaBreachRecordDigest(record)).resolves.toBe(record.digest);
    const tampered = { ...record, reason: 'accept-deadline-passed-unaccepted' as const };
    await expect(verifySlaBreachRecordDigest(tampered)).rejects.toSatisfy(
      (error: unknown) => {
        expectCode(error, EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED);
        return true;
      },
    );
  });

  it('folds into the C021 observability summary (one engagement only)', async () => {
    const base = {
      tenant: 'tenant-a',
      engagementId: 'eng-alpha-1',
      engagementRef: DIGEST,
      dueAt: '2026-10-07T10:00:00.000Z',
      observedAt: '2026-10-07T10:00:00.000Z',
    };
    const a = await createSlaBreachRecord({
      ...base,
      breachId: 'sla-breach-6',
      clock: 'accept',
      reason: 'accept-deadline-passed-unaccepted',
    });
    const b = await createSlaBreachRecord({
      ...base,
      breachId: 'sla-breach-7',
      clock: 'submit',
      reason: 'submit-deadline-passed-unsubmitted',
    });
    const summary = toSlaBreachSummary([a, b]);
    expect(summary?.totalBreaches).toBe(2);
    expect(summary?.breachedClocks).toEqual(['accept', 'submit']);
    const crossEngagement = await createSlaBreachRecord({
      ...base,
      breachId: 'sla-breach-8',
      engagementId: 'eng-alpha-2',
      clock: 'accept',
      reason: 'accept-deadline-passed-unaccepted',
    });
    expect(() => toSlaBreachSummary([a, crossEngagement])).toThrow(ExpertEngagementError);
    expect(toSlaBreachSummary([])).toBeNull();
  });
});
