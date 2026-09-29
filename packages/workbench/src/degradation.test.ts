/**
 * Degradation-model tests (Work Order A017, requirement R41 — the
 * graceful-degradation core):
 *
 *   - POSITIVE: healthy singleton; validated degraded modes; merging;
 *     structural checks;
 *   - NEGATIVE: unknown reason codes, empty reasons, empty details,
 *     `last-known-state` without a cause — all typed errors (fail
 *     loudly, never a silently misleading banner).
 */

import { describe, expect, it } from 'vitest';
import {
  DEGRADATION_REASON_CODES,
  degradationMode,
  isDegradationReason,
  isDegradationReasonCode,
  isDegradationState,
  mergeDegradation,
  noDegradation,
} from './degradation.js';
import { isWorkbenchError, WORKBENCH_ERROR_CODES } from './errors.js';
import { isDeepFrozen } from './freeze.js';

describe('noDegradation (positive)', () => {
  it('is the frozen healthy singleton', () => {
    const healthy = noDegradation();
    expect(healthy).toEqual({ degraded: false, reasons: [] });
    expect(noDegradation()).toBe(healthy);
    expect(isDeepFrozen(healthy)).toBe(true);
  });
});

describe('degradationMode (positive)', () => {
  it('builds a validated, deep-frozen degraded mode', () => {
    const state = degradationMode([
      { code: 'expert-supply-unavailable', detail: 'registry unreachable' },
      { code: 'last-known-state', detail: 'captured at 2026-10-05T09:00:00.000Z' },
    ]);
    expect(state.degraded).toBe(true);
    expect(state.reasons).toHaveLength(2);
    expect(state.reasons[0]?.code).toBe('expert-supply-unavailable');
    expect(state.reasons[1]?.detail).toBe('captured at 2026-10-05T09:00:00.000Z');
    expect(isDeepFrozen(state)).toBe(true);
    expect(isDegradationState(state)).toBe(true);
  });

  it('accepts every member of the closed vocabulary', () => {
    for (const code of DEGRADATION_REASON_CODES) {
      if (code === 'last-known-state') continue; // qualifier — tested separately
      expect(isDegradationReasonCode(code)).toBe(true);
      const state = degradationMode([{ code, detail: `fixture detail for ${code}` }]);
      expect(state.degraded).toBe(true);
    }
    expect(isDegradationReasonCode('not-a-code')).toBe(false);
    expect(isDegradationReasonCode(42)).toBe(false);
  });
});

describe('degradationMode — validation negatives (negative)', () => {
  it('rejects an empty reason list (no silent degradation)', () => {
    expect(() => degradationMode([])).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT,
    );
  });

  it('rejects unknown reason codes (closed vocabulary)', () => {
    let error: unknown;
    try {
      degradationMode([{ code: 'everything-is-fine', detail: 'trust me' }]);
    } catch (caught) {
      error = caught;
    }
    expect(isWorkbenchError(error)).toBe(true);
    expect((error as { code: string }).code).toBe(
      WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT,
    );
  });

  it('rejects empty details', () => {
    expect(() =>
      degradationMode([{ code: 'job-store-unavailable', detail: '' }]),
    ).toThrowError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT);
  });

  it('rejects non-object reasons', () => {
    expect(() => degradationMode(['job-store-unavailable'] as never)).toThrowError(
      WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT,
    );
  });

  it("rejects 'last-known-state' without a cause (a qualifier cannot stand alone)", () => {
    expect(() =>
      degradationMode([{ code: 'last-known-state', detail: 'some old snapshot' }]),
    ).toThrowError(WORKBENCH_ERROR_CODES.INVALID_DEGRADATION_INPUT);
  });
});

describe('structural checks (positive + negative)', () => {
  it('isDegradationReason accepts well-formed reasons only', () => {
    expect(isDegradationReason({ code: 'task-queue-unavailable', detail: 'x' })).toBe(true);
    expect(isDegradationReason({ code: 'nope', detail: 'x' })).toBe(false);
    expect(isDegradationReason({ code: 'task-queue-unavailable' })).toBe(false);
    expect(isDegradationReason(null)).toBe(false);
    expect(isDegradationReason('task-queue-unavailable')).toBe(false);
  });

  it('isDegradationState accepts healthy and well-formed degraded states only', () => {
    expect(isDegradationState(noDegradation())).toBe(true);
    expect(
      isDegradationState({
        degraded: true,
        reasons: [{ code: 'matching-unavailable', detail: 'engine down' }],
      }),
    ).toBe(true);
    // degraded: true with NO reasons is inconsistent.
    expect(isDegradationState({ degraded: true, reasons: [] })).toBe(false);
    // degraded: false WITH reasons is inconsistent.
    expect(
      isDegradationState({
        degraded: false,
        reasons: [{ code: 'matching-unavailable', detail: 'engine down' }],
      }),
    ).toBe(false);
    // last-known-state alone cannot carry a degraded state.
    expect(
      isDegradationState({
        degraded: true,
        reasons: [{ code: 'last-known-state', detail: 'old snapshot' }],
      }),
    ).toBe(false);
    expect(isDegradationState(null)).toBe(false);
    expect(isDegradationState('degraded')).toBe(false);
  });
});

describe('mergeDegradation (positive)', () => {
  it('healthy inputs merge to the healthy singleton', () => {
    expect(mergeDegradation([noDegradation(), noDegradation()])).toEqual(noDegradation());
    expect(mergeDegradation([])).toEqual(noDegradation());
  });

  it('any degraded input makes the merge degraded, with deduplicated reasons', () => {
    const jobs = degradationMode([{ code: 'job-store-unavailable', detail: 'store down' }]);
    const experts = degradationMode([
      { code: 'expert-supply-unavailable', detail: 'registry unreachable' },
      { code: 'last-known-state', detail: 'captured at 2026-10-05T09:00:00.000Z' },
    ]);
    const merged = mergeDegradation([noDegradation(), jobs, experts, jobs]);
    expect(merged.degraded).toBe(true);
    // The duplicate jobs reasons collapse; order follows input order.
    expect(merged.reasons).toHaveLength(3);
    expect(merged.reasons.map((reason) => reason.code)).toEqual([
      'job-store-unavailable',
      'expert-supply-unavailable',
      'last-known-state',
    ]);
  });
});
