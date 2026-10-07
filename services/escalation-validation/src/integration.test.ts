/**
 * Integration tests (Work Order C009): one FULL adjudication run over
 * the injected C007/A012/A013/C005 ports, driven through the C001
 * lifecycle on the reference fabric — declaration, routing, a failed
 * round, the revision loop, a passing round, and expert replacement
 * back through the C002 routing seam.
 */

import { describe, expect, it } from 'vitest';
import { createValidatorCandidate } from '@arena/escalation-validation';
import { FixedClock, ReferenceEvaluationStage, ReferenceVerificationStage, ScriptedRoutingPort } from './fabric.js';
import { EscalationValidationService } from './service.js';
import {
  handoffCommand,
  validConditionInput,
  validatorCandidate,
  wiredService,
} from './test-support.js';
import { applyEscalationTransition, createEscalationResult } from '@arena/escalation';

const REQUEST = { requestId: 'esc_00000000000000000000000000000000', tenantId: 'tenant-alpha' };
const CRITERION = 'boq-estimation.quantity-takeoff.completeness';

describe('a full adjudication run over the injected C007/A012/A013/C005 ports', () => {
  it('declaration → routing → failed round → revision → passing round → replacement funnel', async () => {
    // The C005 seam: the submitting expert IS in the pool (COI) plus a
    // stronger independent validator and a cross-tenant candidate.
    const ctx = await wiredService({
      evaluation: { scores: { [CRITERION]: 0.5 } }, // round 1 fails the criteria
      candidates: [
        createValidatorCandidate({
          expertRef: 'expert-submitter-1',
          tenant: 'tenant-alpha',
          competency: [
            {
              skill: 'boq-estimation.quantity-takeoff',
              evidenceRecords: 99,
              totalSampleSize: 990,
              latestOutcome: 'demonstrated',
              stale: false,
            },
          ],
        }),
        validatorCandidate('expert-validator-1', 12),
        createValidatorCandidate({
          expertRef: 'expert-other-tenant-1',
          tenant: 'tenant-beta',
          competency: [
            {
              skill: 'boq-estimation.quantity-takeoff',
              evidenceRecords: 50,
              totalSampleSize: 500,
              latestOutcome: 'demonstrated',
              stale: false,
            },
          ],
        }),
      ],
    });

    // 1. Declaration: the DECLARED condition derives the typed plan.
    const declaration = await ctx.service.declareValidationCondition({
      ...REQUEST,
      condition: validConditionInput(),
    });
    expect(declaration.plan.conditionKind).toBe('criteria-threshold');

    // 2. Routing: the C007 seam binds SUBMITTED → VALIDATING.
    const receipt = await ctx.service.route(handoffCommand());
    expect(receipt.stub).toBe(false);
    const validationAfterRoute = await ctx.service.getValidationRecord(REQUEST);
    // COI closure at the service level: the selected validator is NOT
    // the submitting expert and not the cross-tenant candidate.
    expect(validationAfterRoute?.validator?.outcome).toBe('selected');
    if (validationAfterRoute?.validator?.outcome === 'selected') {
      expect(validationAfterRoute.validator.validator.expertRef).toBe('expert-validator-1');
      expect(validationAfterRoute.validator.exclusions).toContainEqual({
        expertRef: 'expert-submitter-1',
        reason: 'conflict-of-interest',
      });
      expect(validationAfterRoute.validator.exclusions).toContainEqual({
        expertRef: 'expert-other-tenant-1',
        reason: 'cross-tenant',
      });
    }

    // 3. Round 1: REVISION_REQUIRED (evaluation below criteria).
    const first = await ctx.service.adjudicate(REQUEST);
    expect(first.outcome.verdict).toBe('revision_required');
    expect(first.escalation?.state).toBe('revision_required');
    expect(first.revisionRequest?.requiredChanges[0]?.code).toBe('criteria-not-met');

    // 4. The expert revises (C001: revision_required → in_progress → submitted).
    if (first.escalation === undefined) throw new Error('unreachable');
    const revised = applyEscalationTransition(first.escalation, 'in_progress', {
      now: '2026-10-07T10:40:00.000Z',
    });
    const revisedResult = createEscalationResult({
      kind: 'solution',
      producedAt: '2026-10-07T10:42:00.000Z',
      summary: 'Revised quantity takeoff.',
      payload: { total: 1260 },
      steps: ['remeasure walls'],
    });
    await ctx.escalationPort.update(
      applyEscalationTransition(revised, 'submitted', {
        now: '2026-10-07T10:43:00.000Z',
        result: revisedResult,
      }),
    );

    // 5. Round 2: the evaluation stage now passes (A012 seam rewired);
    //    the loop closes on ACCEPTED.
    const round2 = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:45:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      eventSink: ctx.eventSink,
      evaluationStage: new ReferenceEvaluationStage(), // every criterion met
      verificationStage: new ReferenceVerificationStage(), // every claim supported
    });
    await round2.route(handoffCommand());
    const second = await round2.adjudicate({ ...REQUEST, now: '2026-10-07T10:46:00.000Z' });
    expect(second.outcome.verdict).toBe('accepted');
    expect(second.escalation?.state).toBe('result_accepted');
    expect(second.escalation?.validationStatus).toBe('passed');

    // 6. The webhook stream projected the validation lifecycle (the
    //    route event carries the plan; the round events carry verdicts).
    const events = ctx.eventSink.ofType('escalation.validation.updated');
    expect(
      events
        .map((event) => (event.data as Record<string, unknown>)['verdict'])
        .filter((verdict) => verdict !== undefined),
    ).toEqual(['revision_required', 'accepted']);
    expect(events.every((event) => event.state !== null)).toBe(true);

    // 7. The append-only history keeps every round (supersession).
    expect(
      second.validation.entries
        .filter((entry) => entry.kind === 'adjudication-recorded')
        .map((entry) => entry.sequence),
    ).toHaveLength(2);
    expect(second.validation.entries.map((entry) => entry.sequence)).toEqual(
      second.validation.entries.map((entry, index) => index + 1),
    );
  });

  it('a rejected escalation replaces the expert and routes back through the C002 seam to a new OFFER', async () => {
    const ctx = await wiredService({ evaluation: { scores: { [CRITERION]: 0.5 } } });
    await ctx.service.declareValidationCondition({
      ...REQUEST,
      condition: validConditionInput({ maxRevisionAttempts: 1 }),
    });
    await ctx.service.route(handoffCommand());
    const rejected = await ctx.service.adjudicate(REQUEST);
    expect(rejected.outcome.verdict).toBe('rejected');

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
    // The full C001 funnel is explicit: result_rejected → expert_replaced → matching → offered.
    expect(run.escalation.history.slice(-3).map((entry) => entry.to)).toEqual([
      'expert_replaced',
      'matching',
      'offered',
    ]);
    expect(run.escalation.expertRef).toBe('expert-replacement-2');
    // The replaced expert's record is retained in the append-only history.
    expect(run.validation.entries.some((entry) => entry.kind === 'replacement-requested')).toBe(true);
    // Events: replacement progress + matched.
    expect(ctx.eventSink.ofType('escalation.progressed').length).toBeGreaterThanOrEqual(2);
    expect(ctx.eventSink.ofType('escalation.matched')).toHaveLength(1);
  });
});
