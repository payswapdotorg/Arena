/**
 * Service unit tests (Work Order C009): the C007 seam implementation
 * (plan routing, lifecycle binding, deterministic idempotent receipt),
 * adjudication verdict binding, the revision loop, expert replacement
 * and event emission.
 */

import { describe, expect, it } from 'vitest';
import {
  applyEscalationTransition,
  createEscalationResult,
} from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';
import { EscalationValidationError } from '@arena/escalation-validation';
import { FixedClock, ReferenceEvaluationStage, ScriptedRoutingPort } from './fabric.js';
import type { ValidationHandoffPort } from './ports.js';
import { EscalationValidationService } from './service.js';
import {
  handoffCommand,
  validConditionInput,
  validatorCandidate,
  wiredService,
} from './test-support.js';

const REQUEST = { requestId: 'esc_00000000000000000000000000000000', tenantId: 'tenant-alpha' };
const CRITERION = 'boq-estimation.quantity-takeoff.completeness';

async function routed() {
  const ctx = await wiredService();
  await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
  const receipt = await ctx.service.route(handoffCommand());
  return { ...ctx, receipt };
}

/** A service whose escalation is rejected (one attempt, failing evaluation). */
async function rejectedService() {
  const ctx = await wiredService({
    evaluation: { scores: { [CRITERION]: 0.5 } },
  });
  await ctx.service.declareValidationCondition({
    ...REQUEST,
    condition: validConditionInput({ maxRevisionAttempts: 1 }),
  });
  await ctx.service.route(handoffCommand());
  await ctx.service.adjudicate(REQUEST);
  return ctx;
}

/** Move a revision_required escalation back to submitted (the expert revised). */
function revise(escalation: EscalationRecord): EscalationRecord {
  const result = createEscalationResult({
    kind: 'solution',
    producedAt: '2026-10-07T10:42:00.000Z',
    summary: 'Revised quantity takeoff.',
    payload: { total: 1260 },
    steps: ['remeasure walls'],
  });
  let record = applyEscalationTransition(escalation, 'in_progress', { now: '2026-10-07T10:40:00.000Z' });
  record = applyEscalationTransition(record, 'submitted', {
    now: '2026-10-07T10:43:00.000Z',
    result,
  });
  return record;
}

describe('route (THE C007 VALIDATION SEAM — the real engine)', () => {
  it('routes onto the derived plan, binds SUBMITTED → VALIDATING and returns stub: FALSE', async () => {
    const { escalationPort, eventSink, receipt } = await routed();
    expect(receipt.stub).toBe(false);
    expect(receipt.status).toBe('routed');
    expect(receipt.routedTo).toBe('evaluation-fabric');
    expect(receipt.validationCondition.source).toBe('c009-validation-plan');
    expect(receipt.receiptId).toBe('vh-esc_00000000000000000000000000000000-solve');
    const escalation = await escalationPort.findById(REQUEST.requestId);
    expect(escalation?.state).toBe('validating');
    expect(escalation?.validationStatus).toBe('pending');
    const events = eventSink.ofType('escalation.validation.updated');
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toMatchObject({ routedTo: 'evaluation-fabric' });
  });

  it('is IDEMPOTENT: a replayed handoff returns the same receipt with no second transition or event', async () => {
    const { service, escalationPort, eventSink, receipt } = await routed();
    const again = await service.route(handoffCommand());
    expect(again).toEqual(receipt);
    const escalation = await escalationPort.findById(REQUEST.requestId);
    expect(escalation?.history).toHaveLength(9); // 8 + validating: no re-transition on replay
    expect(eventSink.ofType('escalation.validation.updated')).toHaveLength(1);
  });

  it('fail-closes when no validation condition was declared (never invents a default)', async () => {
    const { service } = await wiredService();
    await expect(service.route(handoffCommand())).rejects.toThrow(/no declared validation condition/u);
  });

  it('fail-closes when the escalation is not SUBMITTED', async () => {
    const { service } = await wiredService();
    await service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await service.route(handoffCommand());
    await expect(service.route({ ...handoffCommand(), mode: 'review' })).rejects.toThrow(
      /requires escalation state 'submitted'/u,
    );
  });

  it('fail-closes (typed NO_VALIDATOR) when an expert-driven plan has no conflict-free validator', async () => {
    const { service } = await wiredService({
      candidates: [validatorCandidate('expert-submitter-1')], // COI: the submitting expert
    });
    await service.declareValidationCondition({
      ...REQUEST,
      condition: validConditionInput({ kind: 'expert-review-approval' }),
    });
    await expect(service.route(handoffCommand())).rejects.toThrow(EscalationValidationError);
  });

  it('structurally satisfies the C007 ValidationHandoffPort (the seam contract)', async () => {
    const { service } = await wiredService();
    const port: ValidationHandoffPort = service;
    expect(typeof port.route).toBe('function');
  });
});

describe('adjudicate (the two EXPLICITLY DISTINCT stages)', () => {
  it('ACCEPTS: evaluation meets criteria AND verification passes → result_accepted (validation passed)', async () => {
    const { service, escalationPort, eventSink } = await routed();
    const run = await service.adjudicate(REQUEST);
    expect(run.outcome.verdict).toBe('accepted');
    expect(run.outcome.validationStatus).toBe('passed');
    expect(run.escalation?.state).toBe('result_accepted');
    const escalation = await escalationPort.findById(REQUEST.requestId);
    expect(escalation?.validationStatus).toBe('passed');
    const events = eventSink.ofType('escalation.validation.updated');
    expect(events.at(-1)?.data).toMatchObject({ verdict: 'accepted' });
    expect(run.outcome.reasons.map((reason) => reason.code)).toContain('evaluation-meets-criteria');
    expect(run.outcome.reasons.map((reason) => reason.code)).toContain('verification-pass');
    expect(run.outcome.evaluationStage.recordDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(run.outcome.verificationStage.recordDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('REVISION_REQUIRED: a failed stage while attempts remain → revision_required + typed revision request', async () => {
    const ctx = await wiredService({ evaluation: { scores: { [CRITERION]: 0.5 } } });
    await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await ctx.service.route(handoffCommand());
    const run = await ctx.service.adjudicate(REQUEST);
    expect(run.outcome.verdict).toBe('revision_required');
    expect(run.escalation?.state).toBe('revision_required');
    expect(run.revisionRequest?.attemptNumber).toBe(1);
    expect(run.revisionRequest?.requiredChanges.map((change) => change.code)).toEqual([
      'criteria-not-met',
    ]);
    expect(run.revisionRequest?.resubmissionDeadline).toBe('2026-10-07T11:00:00.000Z'); // the request deadline dominates
    const escalation = await ctx.escalationPort.findById(REQUEST.requestId);
    expect(escalation?.validationStatus).toBe('failed');
  });

  it('NEEDS_MORE_EVIDENCE: an inconclusive stage keeps the escalation VALIDATING with a typed evidence request', async () => {
    const ctx = await wiredService({ evaluation: { inconclusive: true } });
    await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await ctx.service.route(handoffCommand());
    const run = await ctx.service.adjudicate(REQUEST);
    expect(run.outcome.verdict).toBe('needs_more_evidence');
    expect(run.escalation).toBeUndefined();
    expect(run.evidenceRequest?.reasons).toContain('evaluation-inconclusive');
    const escalation = await ctx.escalationPort.findById(REQUEST.requestId);
    expect(escalation?.state).toBe('validating');
    expect(escalation?.validationStatus).toBe('pending');
  });

  it('requires state VALIDATING (fail-closed on every other state)', async () => {
    const { service } = await wiredService();
    await expect(service.adjudicate(REQUEST)).rejects.toThrow(
      /requires escalation state 'validating'/u,
    );
  });
});

describe('the bounded revision loop (resubmission round)', () => {
  it('round 2 accepts the revised submission (revision loop closes on ACCEPTED)', async () => {
    const ctx = await wiredService({ evaluation: { scores: { [CRITERION]: 0.5 } } });
    await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await ctx.service.route(handoffCommand());
    const first = await ctx.service.adjudicate(REQUEST);
    expect(first.outcome.verdict).toBe('revision_required');
    if (first.escalation === undefined) throw new Error('unreachable');

    // The expert revises: revision_required → in_progress → submitted (C001).
    await ctx.escalationPort.update(revise(first.escalation));

    // Re-route the revised submission; round 2 now meets the criteria
    // (a passing evaluation stage is wired through the SAME service).
    const passing = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:45:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      eventSink: ctx.eventSink,
    });
    await passing.route(handoffCommand());
    const second = await passing.adjudicate({ ...REQUEST, now: '2026-10-07T10:46:00.000Z' });
    expect(second.outcome.attemptNumber).toBe(2);
    expect(second.outcome.verdict).toBe('accepted');
    expect(second.escalation?.state).toBe('result_accepted');
    expect(
      second.validation.entries.filter((entry) => entry.kind === 'adjudication-recorded'),
    ).toHaveLength(2);
  });

  it('exhausted attempts REJECT with reasons (attempt 2 of 2)', async () => {
    const ctx = await wiredService({ evaluation: { scores: { [CRITERION]: 0.5 } } });
    await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await ctx.service.route(handoffCommand());
    const first = await ctx.service.adjudicate(REQUEST);
    if (first.escalation === undefined) throw new Error('unreachable');
    await ctx.escalationPort.update(revise(first.escalation));
    const secondRound = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:45:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      eventSink: ctx.eventSink,
      evaluationStage: new ReferenceEvaluationStage({ scores: { [CRITERION]: 0.5 } }),
    });
    await secondRound.route(handoffCommand());
    const second = await secondRound.adjudicate({ ...REQUEST, now: '2026-10-07T10:46:00.000Z' });
    expect(second.outcome.verdict).toBe('rejected');
    expect(second.outcome.reasons.map((reason) => reason.code)).toContain('revision-budget-exhausted');
    expect(second.escalation?.state).toBe('result_rejected');
  });
});

describe('requestExpertReplacement (typed triggers → C001 funnel → C002 seam)', () => {
  it('replaces after REJECTED: expert_replaced → matching → offered with the new expert (history retained)', async () => {
    const ctx = await rejectedService();
    const replacementService = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:50:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      eventSink: ctx.eventSink,
      routing: new ScriptedRoutingPort([{ outcome: 'matched', expertRef: 'expert-replacement-2' }]),
    });
    const run = await replacementService.requestExpertReplacement({
      ...REQUEST,
      trigger: 'validation-failure-beyond-revision',
    });
    expect(run.replacement.replacedExpertRef).toBe('expert-submitter-1');
    expect(run.replacement.routedBackTo).toBe('matching');
    expect(run.routingDecision).toEqual({ outcome: 'matched', expertRef: 'expert-replacement-2' });
    expect(run.escalation.state).toBe('offered');
    expect(run.escalation.expertRef).toBe('expert-replacement-2');
    // The C001 history retains the full funnel (append-only).
    const escalation = await ctx.escalationPort.findById(REQUEST.requestId);
    expect(escalation?.history.map((entry) => entry.to)).toContain('expert_replaced');
    // The replaced expert is RETAINED in the validation history.
    const validation = await ctx.store.get(REQUEST.requestId, REQUEST.tenantId);
    expect(
      validation?.entries
        .filter((entry) => entry.kind === 'replacement-requested')
        .map(
          (entry) =>
            (entry.payload['replacement'] as { replacedExpertRef: string }).replacedExpertRef,
        ),
    ).toEqual(['expert-submitter-1']);
  });

  it('denies a replacement from an incompatible state (typed guard)', async () => {
    const { service } = await wiredService();
    await expect(
      service.requestExpertReplacement({ ...REQUEST, trigger: 'validation-failure-beyond-revision' }),
    ).rejects.toThrow(/replacement denied/u);
  });

  it('denies an incompatible trigger for the current state', async () => {
    const { service } = await routed();
    await expect(
      service.requestExpertReplacement({ ...REQUEST, trigger: 'withdrawal' }),
    ).rejects.toThrow(/replacement denied/u);
  });

  it('routes back into MATCHING and records a typed no-match decision when routing finds no expert', async () => {
    const ctx = await rejectedService();
    const replacementService = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:50:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      routing: new ScriptedRoutingPort([{ outcome: 'no-match', reason: 'no-qualified-expert' }]),
    });
    const run = await replacementService.requestExpertReplacement({
      ...REQUEST,
      trigger: 'validation-failure-beyond-revision',
    });
    expect(run.escalation.state).toBe('matching');
    expect(run.routingDecision).toEqual({ outcome: 'no-match', reason: 'no-qualified-expert' });
  });
});

describe('read surfaces', () => {
  it('exposes the append-only validation record (tenant-scoped)', async () => {
    const { service } = await routed();
    const record = await service.getValidationRecord(REQUEST);
    expect(record?.plan?.planId).toMatch(/^vp_[0-9a-f]{32}$/u);
    expect(record?.entries.map((entry) => entry.kind)).toEqual(['plan-declared', 'handoff-routed']);
  });

  it('cross-tenant reads fail closed with the typed error', async () => {
    const { service } = await routed();
    await expect(
      service.getValidationRecord({ requestId: REQUEST.requestId, tenantId: 'tenant-beta' }),
    ).rejects.toThrow(/belongs to another tenant/u);
  });
});
