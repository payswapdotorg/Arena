/**
 * SLA measurement tests (Work Order C021; issue #127): clock arithmetic
 * through the C011 evaluator, the four-clock vocabulary, the evidence
 * law (fabricated 'met' fails closed) and the supersession invariant
 * (no retroactive silent edits).
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SLA_MEASUREMENT_WINDOWS,
  MEASURED_SLA_CLOCK_KINDS,
  createMeasuredSlaRecord,
  createSlaMeasurementDefinition,
  effectiveMeasuredSlaRecords,
  measureSlaClocks,
  measuredSlaRecordId,
  supersedeMeasuredSlaRecord,
} from './sla.js';
import { EscalationObservabilityError } from './errors.js';

const TENANT = 'acme';
const REQUEST = 'esc_11111111111111111111111111111111';
const OFFER_AT = '2026-10-01T09:00:00.000Z';
const DEADLINE = '2026-10-02T09:00:00.000Z';
const EV = ['evt_1', 'evt_2'];

describe('SLA measurement definitions', () => {
  it('builds a complete definition for all four urgency classes', () => {
    const definition = createSlaMeasurementDefinition({
      windowsByUrgency: {
        routine: { acceptMs: 1000, startMs: 2000, submitMs: 3000, validateMs: 4000 },
        priority: { acceptMs: 1000, startMs: 2000, submitMs: 3000, validateMs: 4000 },
        urgent: { acceptMs: 1000, startMs: 2000, submitMs: 3000, validateMs: 4000 },
        critical: { acceptMs: 1000, startMs: 2000, submitMs: 3000, validateMs: 4000 },
      },
    });
    expect(definition.windowsByUrgency.critical.validateMs).toBe(4000);
    expect(Object.isFrozen(definition)).toBe(true);
  });

  it('fails closed on incomplete definitions (never silent defaults)', () => {
    expect(() =>
      createSlaMeasurementDefinition({
        windowsByUrgency: {
          routine: { acceptMs: 1, startMs: 1, submitMs: 1, validateMs: 1 },
          priority: { acceptMs: 1, startMs: 1, submitMs: 1, validateMs: 1 },
          urgent: { acceptMs: 1, startMs: 1, submitMs: 1, validateMs: 1 },
        },
      }),
    ).toThrowError(/missing windows for urgency class 'critical'/);
  });

  it('defaults keep the C011 windows and derive validate-by from the accept window', () => {
    expect(DEFAULT_SLA_MEASUREMENT_WINDOWS.urgent.validateMs).toBe(3600_000);
    expect(DEFAULT_SLA_MEASUREMENT_WINDOWS.routine.acceptMs).toBe(24 * 3600_000);
  });
});

describe('measureSlaClocks', () => {
  it('measures all four clocks with the C011 arithmetic (met path)', () => {
    const { clocks } = measureSlaClocks({
      tenant: TENANT,
      requestId: REQUEST,
      urgency: 'urgent',
      requestDeadline: DEADLINE,
      offerIssuedAt: OFFER_AT,
      milestones: {
        acceptedAt: '2026-10-01T09:30:00.000Z',
        activatedAt: '2026-10-01T10:00:00.000Z',
        submittedAt: '2026-10-01T12:00:00.000Z',
        validationVerdictAt: '2026-10-01T12:30:00.000Z',
      },
      at: '2026-10-01T13:00:00.000Z',
      evidenceEventIds: EV,
    });
    expect(clocks.map((clock) => clock.clock)).toEqual([...MEASURED_SLA_CLOCK_KINDS]);
    expect(clocks.map((clock) => clock.state)).toEqual(['met', 'met', 'met', 'met']);
    // urgent accept window is 1h — accepted at +30m is inside.
    expect(clocks[0]?.dueAt).toBe('2026-10-01T10:00:00.000Z');
    // validate window = urgent accept window (1h) from submission, capped by deadline.
    expect(clocks[3]?.dueAt).toBe('2026-10-01T13:00:00.000Z');
  });

  it('measures breaches with machine-readable reasons', () => {
    const { clocks } = measureSlaClocks({
      tenant: TENANT,
      requestId: REQUEST,
      urgency: 'urgent',
      requestDeadline: DEADLINE,
      offerIssuedAt: OFFER_AT,
      milestones: {},
      at: '2026-10-01T11:00:00.000Z',
    });
    // accept-by was 10:00 — at 11:00 with no acceptance the clock breached.
    expect(clocks[0]?.state).toBe('breached');
    expect(clocks[0]?.reasons).toContain('clock-breached-deadline-passed');
  });

  it('maps at-risk from the C011 evaluator (last quarter of the window)', () => {
    // urgent accept window 1h; at 09:50 only 10m remain (<= 15m quarter).
    const { clocks } = measureSlaClocks({
      tenant: TENANT,
      requestId: REQUEST,
      urgency: 'urgent',
      requestDeadline: DEADLINE,
      offerIssuedAt: OFFER_AT,
      milestones: {},
      at: '2026-10-01T09:50:00.000Z',
    });
    expect(clocks[0]?.state).toBe('at-risk');
    expect(clocks[0]?.reasons).toContain('clock-at-risk-remaining-quarter');
  });

  it('is deterministic given identical inputs', () => {
    const input = {
      tenant: TENANT,
      requestId: REQUEST,
      urgency: 'routine',
      requestDeadline: DEADLINE,
      offerIssuedAt: OFFER_AT,
      milestones: { acceptedAt: '2026-10-01T10:00:00.000Z' },
      at: '2026-10-01T11:00:00.000Z',
    } as const;
    expect(measureSlaClocks(input)).toEqual(measureSlaClocks(input));
  });

  it('fails closed on an unknown urgency class', () => {
    expect(() =>
      measureSlaClocks({
        tenant: TENANT,
        requestId: REQUEST,
        urgency: 'whenever',
        requestDeadline: DEADLINE,
        offerIssuedAt: OFFER_AT,
        milestones: {},
        at: '2026-10-01T10:00:00.000Z',
      }),
    ).toThrowError(EscalationObservabilityError);
  });
});

describe('createMeasuredSlaRecord (evidence law)', () => {
  const base = {
    slaRecordId: 'obs_' + 'a'.repeat(32),
    tenant: TENANT,
    requestId: REQUEST,
    urgency: 'urgent',
    clock: 'accept',
    dueAt: '2026-10-01T10:00:00.000Z',
    milestoneAt: '2026-10-01T09:30:00.000Z',
    state: 'met',
    reasons: ['clock-met-before-due'],
    observedAt: '2026-10-01T13:00:00.000Z',
    evidenceEventIds: EV,
  };

  it('accepts an evidence-backed met record and freezes it', () => {
    const record = createMeasuredSlaRecord(base);
    expect(record.state).toBe('met');
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.evidenceEventIds).toEqual(EV);
  });

  it('ADVERSARIAL: a fabricated met record without events fails closed', () => {
    expect(() =>
      createMeasuredSlaRecord({ ...base, evidenceEventIds: [] }),
    ).toThrowError(/EVIDENCE LAW/);
    expect(() => createMeasuredSlaRecord({ ...base, milestoneAt: null })).toThrowError(
      /EVIDENCE LAW/,
    );
  });

  it('requires the breached reason on breached records', () => {
    expect(() =>
      createMeasuredSlaRecord({
        ...base,
        state: 'breached',
        milestoneAt: null,
        reasons: ['clock-pending-before-due'],
      }),
    ).toThrowError(/clock-breached-deadline-passed/);
  });

  it('rejects unknown states/clocks/reasons and bad tenants', () => {
    expect(() => createMeasuredSlaRecord({ ...base, state: 'fine' })).toThrowError(
      /state must be one of/,
    );
    expect(() => createMeasuredSlaRecord({ ...base, clock: 'respond' })).toThrowError(
      /clock must be one of/,
    );
    expect(() => createMeasuredSlaRecord({ ...base, reasons: ['because'] })).toThrowError(
      /reason must be one of/,
    );
    expect(() => createMeasuredSlaRecord({ ...base, tenant: 'Acme!' })).toThrowError(
      EscalationObservabilityError,
    );
  });

  it('mints deterministic content-addressed record ids', async () => {
    const a = await measuredSlaRecordId(REQUEST, 'accept', '2026-10-01T13:00:00.000Z');
    const b = await measuredSlaRecordId(REQUEST, 'accept', '2026-10-01T13:00:00.000Z');
    const c = await measuredSlaRecordId(REQUEST, 'start', '2026-10-01T13:00:00.000Z');
    expect(a).toBe(b);
    expect(a).toMatch(/^obs_[0-9a-f]{32}$/);
    expect(a).not.toBe(c);
  });
});

describe('supersession (corrections are supersessions)', () => {
  function original() {
    return createMeasuredSlaRecord({
      slaRecordId: 'obs_' + '1'.repeat(32),
      tenant: TENANT,
      requestId: REQUEST,
      urgency: 'urgent',
      clock: 'submit',
      dueAt: '2026-10-01T14:00:00.000Z',
      milestoneAt: null,
      state: 'pending',
      reasons: ['clock-pending-before-due'],
      observedAt: '2026-10-01T13:00:00.000Z',
      evidenceEventIds: EV,
    });
  }

  it('supersedes into a NEW record referencing the prior id (prior untouched)', () => {
    const prior = original();
    const correction = supersedeMeasuredSlaRecord(prior, {
      slaRecordId: 'obs_' + '2'.repeat(32),
      state: 'met',
      reasons: ['clock-met-before-due'],
      milestoneAt: '2026-10-01T13:30:00.000Z',
      observedAt: '2026-10-01T14:30:00.000Z',
      evidenceEventIds: ['evt_3'],
    });
    expect(correction.supersedes).toBe(prior.slaRecordId);
    expect(correction.reasons).toContain('correction-supersedes-prior-record');
    expect(correction.state).toBe('met');
    // The PRIOR record is structurally immutable — append-only store.
    expect(prior.state).toBe('pending');
    expect(() => {
      (prior as { state: string }).state = 'met';
    }).toThrow();
  });

  it('ADVERSARIAL: a retroactive correction (observed before the prior) fails closed', () => {
    const prior = original();
    expect(() =>
      supersedeMeasuredSlaRecord(prior, {
        slaRecordId: 'obs_' + '2'.repeat(32),
        state: 'met',
        reasons: ['clock-met-before-due'],
        milestoneAt: '2026-10-01T13:30:00.000Z',
        observedAt: '2026-10-01T12:00:00.000Z',
      }),
    ).toThrowError(/never retroactive edits/);
  });

  it('rejects a correction reusing the prior record id', () => {
    const prior = original();
    expect(() =>
      supersedeMeasuredSlaRecord(prior, {
        slaRecordId: prior.slaRecordId,
        state: 'met',
        reasons: ['clock-met-before-due'],
        milestoneAt: '2026-10-01T13:30:00.000Z',
        observedAt: '2026-10-01T14:30:00.000Z',
      }),
    ).toThrowError(/its OWN id/);
  });

  it('effective records: the last observation per clock wins deterministically', () => {
    const prior = original();
    const correction = supersedeMeasuredSlaRecord(prior, {
      slaRecordId: 'obs_' + '2'.repeat(32),
      state: 'breached',
      reasons: ['clock-breached-deadline-passed'],
      milestoneAt: '2026-10-01T15:00:00.000Z',
      observedAt: '2026-10-01T15:30:00.000Z',
    });
    const effective = effectiveMeasuredSlaRecords([correction, prior]);
    expect(effective).toHaveLength(1);
    expect(effective[0]?.slaRecordId).toBe(correction.slaRecordId);
  });
});
