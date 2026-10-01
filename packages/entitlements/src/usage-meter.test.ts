import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_ERROR_CODES,
  EntitlementError,
  appendUsageMeterEvent,
  createUsageMeterLog,
  isUsageMeterEvent,
  meteredTotals,
  toUsageRecordedEvent,
  toUsageRevisedEvent,
  verifyUsageMeterLog,
} from './index.js';
import { FEATURE_COMPUTE, TENANT_A, TENANT_B, T0, T1, T2 } from './test-support.js';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EntitlementError);
    expect((error as EntitlementError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected EntitlementError ${code}`);
}

describe('usage-meter event validation', () => {
  it('accepts a usage-recorded event with bounded positive units', () => {
    const event = toUsageRecordedEvent({
      sequence: 1,
      occurredAt: T0,
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      units: 5,
      jobId: 'job-001',
    });
    expect(event.kind).toBe('usage-recorded');
    expect(isUsageMeterEvent(event)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
  });

  it('accepts a usage-revised event with a non-zero signed delta', () => {
    const event = toUsageRevisedEvent({
      sequence: 2,
      occurredAt: T1,
      tenantId: TENANT_A,
      featureKey: FEATURE_COMPUTE,
      delta: -3,
      reason: 'duplicate ingestion corrected',
    });
    expect(event.kind).toBe('usage-revised');
    expect(isUsageMeterEvent(event)).toBe(true);
  });

  it('rejects zero/negative units and zero deltas', () => {
    expectCode(
      () =>
        toUsageRecordedEvent({
          sequence: 1,
          occurredAt: T0,
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          units: 0,
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
    expectCode(
      () =>
        toUsageRevisedEvent({
          sequence: 1,
          occurredAt: T0,
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          delta: 0,
          reason: 'no-op revision',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
  });

  it('rejects blank revision reasons and invalid job ids', () => {
    expectCode(
      () =>
        toUsageRevisedEvent({
          sequence: 1,
          occurredAt: T0,
          tenantId: TENANT_A,
          featureKey: FEATURE_COMPUTE,
          delta: 1,
          reason: '',
        }),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
    expect(
      isUsageMeterEvent({
        eventVersion: 1,
        kind: 'usage-recorded',
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 1,
        jobId: 'bad job id!',
      }),
    ).toBe(false);
  });
});

describe('per-tenant usage meter log (append-only)', () => {
  it('appends contiguous events and keeps running totals', () => {
    let log = createUsageMeterLog(TENANT_A);
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 5,
      }),
    );
    log = appendUsageMeterEvent(
      log,
      toUsageRevisedEvent({
        sequence: 2,
        occurredAt: T1,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        delta: -2,
        reason: 'partial correction',
      }),
    );
    expect(log.events).toHaveLength(2);
    expect(meteredTotals(log)[FEATURE_COMPUTE]).toBe(3);
    expect(verifyUsageMeterLog(log)).toBeUndefined();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.events)).toBe(true);
  });

  it('a log must start with usage-recorded', () => {
    const log = createUsageMeterLog(TENANT_A);
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRevisedEvent({
            sequence: 1,
            occurredAt: T0,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            delta: 1,
            reason: 'revision before any recording',
          }),
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
  });

  it('rejects sequence gaps and duplicates', () => {
    let log = createUsageMeterLog(TENANT_A);
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 1,
      }),
    );
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRecordedEvent({
            sequence: 3,
            occurredAt: T1,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            units: 1,
          }),
        ),
      ENTITLEMENT_ERROR_CODES.METER_SEQUENCE_GAP,
    );
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRecordedEvent({
            sequence: 1,
            occurredAt: T1,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            units: 1,
          }),
        ),
      ENTITLEMENT_ERROR_CODES.METER_SEQUENCE_DUPLICATE,
    );
  });

  it('rejects timestamp regressions (meter-window discipline)', () => {
    let log = createUsageMeterLog(TENANT_A);
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T2,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 1,
      }),
    );
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRecordedEvent({
            sequence: 2,
            occurredAt: T1,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            units: 1,
          }),
        ),
      ENTITLEMENT_ERROR_CODES.INVALID_METER_EVENT,
    );
  });

  it('rejects events from another tenant (cross-tenant denial)', () => {
    const log = createUsageMeterLog(TENANT_A);
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRecordedEvent({
            sequence: 1,
            occurredAt: T0,
            tenantId: TENANT_B,
            featureKey: FEATURE_COMPUTE,
            units: 1,
          }),
        ),
      ENTITLEMENT_ERROR_CODES.TENANT_MISMATCH,
    );
  });

  it('rejects revisions that would drive a feature total below zero', () => {
    let log = createUsageMeterLog(TENANT_A);
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 2,
      }),
    );
    expectCode(
      () =>
        appendUsageMeterEvent(
          log,
          toUsageRevisedEvent({
            sequence: 2,
            occurredAt: T1,
            tenantId: TENANT_A,
            featureKey: FEATURE_COMPUTE,
            delta: -3,
            reason: 'over-correction',
          }),
        ),
      ENTITLEMENT_ERROR_CODES.METER_NEGATIVE_TOTAL,
    );
  });

  it('verifyUsageMeterLog rejects a tampered (rebuilt) log', () => {
    let log = createUsageMeterLog(TENANT_A);
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 1,
        occurredAt: T0,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 2,
      }),
    );
    log = appendUsageMeterEvent(
      log,
      toUsageRecordedEvent({
        sequence: 2,
        occurredAt: T1,
        tenantId: TENANT_A,
        featureKey: FEATURE_COMPUTE,
        units: 3,
      }),
    );
    // Simulate dropping the middle event (history rewrite attempt): the
    // rebuild hits the contiguous-sequence invariant — sequence 2 cannot be
    // the first event of a log.
    const tampered = { tenantId: TENANT_A, events: [log.events[1]!] };
    expectCode(() => verifyUsageMeterLog(tampered), ENTITLEMENT_ERROR_CODES.METER_SEQUENCE_GAP);
    expect(meteredTotals(log)[FEATURE_COMPUTE]).toBe(5);
  });
});
