/**
 * Expert-replacement tests (Work Order C009): typed triggers, the
 * C001 explicit replacement funnel guard, retained replaced-expert
 * history.
 */

import { describe, expect, it } from 'vitest';
import {
  REPLACEMENT_TRIGGERS,
  checkReplacementTrigger,
  createReplacementRequest,
  isReplacementRequest,
} from './replacement.js';
import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';

describe('checkReplacementTrigger (typed state/trigger guard)', () => {
  it('allows the beyond-revision trigger ONLY from result_rejected', () => {
    expect(checkReplacementTrigger('result_rejected', 'validation-failure-beyond-revision')).toEqual({
      allowed: true,
      reason: 'replacement-ok',
      from: 'result_rejected',
    });
    expect(
      checkReplacementTrigger('in_progress', 'validation-failure-beyond-revision'),
    ).toEqual({
      allowed: false,
      reason: 'replacement-trigger-incompatible-with-state',
      from: 'in_progress',
    });
  });

  it('allows timeout/withdrawal from the in-flight states', () => {
    for (const state of ['offered', 'accepted', 'session_ready', 'in_progress'] as const) {
      expect(checkReplacementTrigger(state, 'withdrawal').allowed).toBe(true);
      expect(checkReplacementTrigger(state, 'timeout').allowed).toBe(true);
    }
  });

  it('allows the in-flight validation-failure trigger only from in_progress', () => {
    expect(checkReplacementTrigger('in_progress', 'validation-failure').allowed).toBe(true);
    expect(checkReplacementTrigger('session_ready', 'validation-failure').allowed).toBe(false);
  });

  it('denies replacement from every other state (no silent mutation)', () => {
    for (const state of [
      'created',
      'triaged',
      'matching',
      'submitted',
      'validating',
      'revision_required',
      'result_accepted',
      'paid',
      'learning_captured',
      'expert_replaced',
      'closed',
      'cancelled',
      'timed_out',
    ] as const) {
      const verdict = checkReplacementTrigger(state, 'withdrawal');
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe('replacement-not-allowed-from-state');
    }
  });

  it('keeps the trigger vocabulary closed and frozen', () => {
    expect(Object.isFrozen(REPLACEMENT_TRIGGERS)).toBe(true);
    expect([...REPLACEMENT_TRIGGERS]).toHaveLength(4);
  });
});

describe('createReplacementRequest (typed record)', () => {
  const base = {
    requestId: 'esc_00000000000000000000000000000000',
    tenantId: 'tenant-alpha',
    reasonDetail: 'validation failed beyond the revision budget',
    occurredAt: '2026-10-07T12:30:00.000Z',
  };

  it('creates a frozen typed request routed back to MATCHING with retained expert ref', () => {
    const request = createReplacementRequest({
      ...base,
      trigger: 'validation-failure-beyond-revision',
      replacedExpertRef: 'expert-original-1',
    });
    expect(request.routedBackTo).toBe('matching');
    expect(request.replacedExpertRef).toBe('expert-original-1');
    expect(Object.isFrozen(request)).toBe(true);
    expect(isReplacementRequest(request)).toBe(true);
  });

  it('rejects an unknown trigger (closed vocabulary)', () => {
    expect(() =>
      createReplacementRequest({ ...base, trigger: 'vibes' as never }),
    ).toThrow(/closed vocabulary/u);
  });
});
