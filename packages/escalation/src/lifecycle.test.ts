/**
 * Lifecycle tests (Work Order C001) — the durable escalation state
 * machine: the full ES1.0 happy path, append-only history, terminal
 * finality, EXPLICIT timeout/cancellation/expert-replacement states,
 * machine-readable transition verdicts, deadline guard and DOMAIN-level
 * tenant isolation.
 */

import { describe, expect, it } from 'vitest';
import { createEscalationRequest } from './request.js';
import { createEscalationResult } from './results.js';
import {
  ESCALATION_ERROR_CODES,
} from './errors.js';
import {
  applyEscalationTransition,
  assertEscalationTenant,
  cancelEscalation,
  checkEscalationTransition,
  createEscalationRecord,
  escalationTenant,
  ESCALATION_TERMINAL_STATES,
  markEscalationTimedOut,
  replaceExpert,
  submitEscalationResult,
} from './lifecycle.js';
import { validEscalationRequestInput } from './test-support.js';

const NOW = '2026-10-07T10:05:00.000Z';

async function newRecord() {
  const request = await createEscalationRequest(validEscalationRequestInput());
  return createEscalationRecord(request, NOW);
}

function result() {
  return createEscalationResult({
    kind: 'solution',
    producedAt: NOW,
    summary: 'BOQ quantity takeoff completed with the corrected rate library.',
    payload: { total: 42_500 },
    steps: ['normalized drawings', 'applied rate library v3'],
  });
}

describe('escalation lifecycle state machine', () => {
  it('walks the full ES1.0 happy path to CLOSED', async () => {
    let record = await newRecord();
    const cost = {
      amountMinorUnits: 25_000,
      currency: 'USD',
      arenaFeeMinorUnits: 3_750,
      expertPayoutStatus: 'paid' as const,
    };
    const path: Array<Parameters<typeof applyEscalationTransition>[1]> = [
      'triaged',
      'matching',
      'offered',
      'accepted',
      'session_ready',
      'in_progress',
      'submitted',
      'validating',
      'result_accepted',
      'paid',
      'learning_captured',
      'closed',
    ];
    let previous = record.state;
    for (const target of path) {
      record = applyEscalationTransition(record, target, {
        now: NOW,
        ...(target === 'offered' ? { expertRef: 'expert-kwame' } : {}),
        ...(target === 'session_ready' ? { sessionRef: 'session-0001' } : {}),
        ...(target === 'submitted' ? { result: result() } : {}),
        ...(target === 'validating' ? { validationStatus: 'pending' as const } : {}),
        ...(target === 'result_accepted' ? { validationStatus: 'passed' as const } : {}),
        ...(target === 'paid' ? { cost } : {}),
      });
      expect(record.state).toBe(target);
      expect(record.history[record.history.length - 1]?.from).toBe(previous);
      previous = target;
    }
    expect(record.state).toBe('closed');
    expect(record.history.length).toBe(13);
    expect(record.cost).toEqual(cost);
    expect(record.result?.kind).toBe('solution');
    expect(record.validationStatus).toBe('passed');
    // Sequences are contiguous 1..n.
    expect(record.history.map((entry) => entry.sequence)).toEqual(
      Array.from({ length: record.history.length }, (_, i) => i + 1),
    );
  });

  it('REVISION_REQUIRED loops back into IN_PROGRESS', async () => {
    let record = await newRecord();
    for (const target of ['triaged', 'matching', 'offered', 'accepted', 'session_ready', 'in_progress'] as const) {
      record = applyEscalationTransition(record, target, {
        now: NOW,
        ...(target === 'offered' ? { expertRef: 'expert-kwame' } : {}),
        ...(target === 'session_ready' ? { sessionRef: 'session-0001' } : {}),
      });
    }
    record = submitEscalationResult(record, result(), { now: NOW });
    record = applyEscalationTransition(record, 'validating', { now: NOW, validationStatus: 'pending' });
    record = applyEscalationTransition(record, 'revision_required', { now: NOW, validationStatus: 'failed' });
    record = applyEscalationTransition(record, 'in_progress', { now: NOW });
    expect(record.state).toBe('in_progress');
  });

  it('expert replacement is an EXPLICIT state that returns to MATCHING', async () => {
    let record = await newRecord();
    record = applyEscalationTransition(record, 'triaged', { now: NOW });
    record = applyEscalationTransition(record, 'matching', { now: NOW });
    record = applyEscalationTransition(record, 'offered', { now: NOW, expertRef: 'expert-kwame' });
    record = replaceExpert(record, { now: NOW });
    expect(record.state).toBe('expert_replaced');
    record = applyEscalationTransition(record, 'matching', { now: NOW });
    expect(record.state).toBe('matching');
    record = applyEscalationTransition(record, 'offered', { now: NOW, expertRef: 'expert-ama' });
    expect(record.expertRef).toBe('expert-ama');
  });

  it('timeout is an EXPLICIT state and the ONLY post-deadline transition', async () => {
    const request = await createEscalationRequest(
      validEscalationRequestInput({ deadlineAt: '2026-10-07T10:30:00.000Z' }),
    );
    let record = createEscalationRecord(request, NOW);
    record = applyEscalationTransition(record, 'triaged', { now: NOW });
    const afterDeadline = '2026-10-07T10:31:00.000Z';
    const denied = checkEscalationTransition(record, 'matching', { now: afterDeadline });
    expect(denied).toEqual({
      allowed: false,
      reason: 'transition_deadline_passed',
      from: 'triaged',
      to: 'matching',
    });
    record = markEscalationTimedOut(record, { now: afterDeadline });
    expect(record.state).toBe('timed_out');
    expect(ESCALATION_TERMINAL_STATES).toContain('timed_out');
  });

  it('cancellation is an EXPLICIT state from pre-submission states', async () => {
    let record = await newRecord();
    record = applyEscalationTransition(record, 'triaged', { now: NOW });
    record = cancelEscalation(record, { now: NOW, actor: 'client-app:epoch-app' });
    expect(record.state).toBe('cancelled');
    expect(record.history[record.history.length - 1]?.actor).toBe('client-app:epoch-app');
  });

  it('terminal states are FINAL — every op fails closed', async () => {
    let record = await newRecord();
    record = cancelEscalation(record, { now: NOW });
    expect(() => applyEscalationTransition(record, 'triaged', { now: NOW })).toThrowError(
      expect.objectContaining({ code: ESCALATION_ERROR_CODES.TERMINAL_STATE }),
    );
    const verdict = checkEscalationTransition(record, 'triaged', { now: NOW });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toBe('transition_terminal_source');
  });

  it('non-adjacent transitions are denied with machine-readable reasons', async () => {
    const record = await newRecord();
    const verdict = checkEscalationTransition(record, 'closed', { now: NOW });
    expect(verdict.reason).toBe('transition_not_adjacent');
    expect(() => applyEscalationTransition(record, 'closed', { now: NOW })).toThrowError(
      expect.objectContaining({ code: ESCALATION_ERROR_CODES.INVALID_TRANSITION }),
    );
  });

  it('entering submitted REQUIRES a result', async () => {
    let record = await newRecord();
    for (const target of ['triaged', 'matching', 'offered', 'accepted', 'session_ready', 'in_progress'] as const) {
      record = applyEscalationTransition(record, target, { now: NOW });
    }
    const verdict = checkEscalationTransition(record, 'submitted', { now: NOW });
    expect(verdict.reason).toBe('transition_requires_result');
    const submitted = submitEscalationResult(record, result(), { now: NOW });
    expect(submitted.state).toBe('submitted');
    expect(submitted.result?.kind).toBe('solution');
  });

  it('leaving validating REQUIRES a validation status; entering paid REQUIRES cost', async () => {
    let record = await newRecord();
    for (const target of ['triaged', 'matching', 'offered', 'accepted', 'session_ready', 'in_progress'] as const) {
      record = applyEscalationTransition(record, target, { now: NOW });
    }
    record = submitEscalationResult(record, result(), { now: NOW });
    record = applyEscalationTransition(record, 'validating', { now: NOW });
    expect(checkEscalationTransition(record, 'result_accepted', { now: NOW }).reason).toBe(
      'transition_requires_validation',
    );
    record = applyEscalationTransition(record, 'result_accepted', { now: NOW, validationStatus: 'passed' });
    expect(checkEscalationTransition(record, 'paid', { now: NOW }).reason).toBe(
      'transition_requires_cost',
    );
  });

  it('enforces DOMAIN-level tenant isolation (typed cross-tenant failures)', async () => {
    const record = await newRecord();
    expect(() => assertEscalationTenant(record, 'tenant-beta')).toThrowError(
      expect.objectContaining({ code: ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS }),
    );
    const verdict = checkEscalationTransition(record, 'triaged', { now: NOW, tenantId: 'tenant-beta' });
    expect(verdict.reason).toBe('transition_tenant_mismatch');
    expect(() =>
      applyEscalationTransition(record, 'triaged', { now: NOW, tenantId: 'tenant-beta' }),
    ).toThrowError(expect.objectContaining({ code: ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS }));
    expect(escalationTenant(record)).toBe('tenant-alpha');
  });

  it('history is append-only, frozen and monotonic', async () => {
    const record = await newRecord();
    expect(() => {
      (record.history as unknown as Record<string, unknown>)['length'] = 99;
    }).toThrow();
    const next = applyEscalationTransition(record, 'triaged', { now: NOW });
    expect(record.history.length).toBe(1);
    expect(next.history.length).toBe(2);
    expect(() => {
      (next.history[0] as unknown as Record<string, unknown>)['to'] = 'cancelled';
    }).toThrow();
    // Clock running backwards is rejected (monotonic non-decreasing).
    expect(() =>
      applyEscalationTransition(next, 'matching', { now: '2026-10-07T10:04:59.999Z' }),
    ).toThrowError(expect.objectContaining({ code: ESCALATION_ERROR_CODES.INVALID_TRANSITION }));
  });
});
