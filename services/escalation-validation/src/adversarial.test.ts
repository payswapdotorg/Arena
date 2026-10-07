/**
 * Adversarial minimum (Work Order C009): a validation verdict consumed
 * as authorization/certification (must fail closed), a validator
 * adjudicating their own submission (COI exclusion), verdict
 * replay/tampering, revision-limit bypass, and cross-tenant
 * validation-record access.
 */

import { describe, expect, it } from 'vitest';
import { EscalationValidationError } from '@arena/escalation-validation';
import {
  consumeSelectionAsAuthorization,
  createAdjudicationOutcome,
  createRevisionRequest,
  newAdjudicationVerdictId,
  newRevisionRequestId,
  selectValidator,
} from '@arena/escalation-validation';
import { EscalationValidationService } from './service.js';
import { handoffCommand, validConditionInput, validatorCandidate, wiredService } from './test-support.js';
import { ReferenceEvaluationStage } from './fabric.js';
import { FixedClock } from './fabric.js';

const REQUEST = { requestId: 'esc_00000000000000000000000000000000', tenantId: 'tenant-alpha' };
const CRITERION = 'boq-estimation.quantity-takeoff.completeness';

async function accepted() {
  const ctx = await wiredService();
  await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
  const receipt = await ctx.service.route(handoffCommand());
  const run = await ctx.service.adjudicate(REQUEST);
  return { ...ctx, run, receipt };
}

describe('a validation verdict consumed as authorization/certification (fail closed)', () => {
  it('the service exposes NO authorization/grant/certify surface (by construction)', async () => {
    const { service } = await accepted();
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(service));
    const authorityShaped = methodNames.filter((name) =>
      /authoriz|grant|certif|approve-access|entitle/u.test(name),
    );
    expect(authorityShaped).toEqual([]);
  });

  it('an ACCEPTED verdict carries NO authority-shaped fields', async () => {
    const { run } = await accepted();
    const keys = Object.keys(run.outcome as unknown as Record<string, unknown>);
    expect(keys.some((key) => /authoriz|grant|certif|license/u.test(key))).toBe(false);
  });

  it('a verdict object smuggling an authorization field is REJECTED at construction', () => {
    const evaluation = {
      stage: 'evaluation',
      outcome: 'meets-criteria',
      recordDigest: 'a'.repeat(64),
      evaluatorRef: 'b'.repeat(64),
      validatorExpertRef: null,
      criteriaJudgments: [],
      executedAt: '2026-10-07T12:00:00.000Z',
      provenance: 'reference-evaluation-fabric',
    } as const;
    const verification = {
      stage: 'verification',
      outcome: 'pass',
      recordDigest: 'c'.repeat(64),
      verifierRef: 'd'.repeat(64),
      evidenceSupport: [],
      evidenceRefs: [],
      executedAt: '2026-10-07T12:01:00.000Z',
      provenance: 'reference-verification-fabric',
    } as const;
    expect(() =>
      createAdjudicationOutcome({
        verdictId: newAdjudicationVerdictId(),
        requestId: REQUEST.requestId,
        tenantId: REQUEST.tenantId,
        attemptNumber: 1,
        verdict: 'accepted',
        certification: 'professionally-licensed',
        reasons: [{ code: 'evaluation-meets-criteria', detail: 'ok', ref: null }],
        evaluationStage: evaluation,
        verificationStage: verification,
        adjudicatedAt: '2026-10-07T12:02:00.000Z',
      } as unknown as Parameters<typeof createAdjudicationOutcome>[0]),
    ).toThrow(/unknown field/u);
  });

  it('consuming a validator selection as an access grant has NO happy path', () => {
    const selection = selectValidator([validatorCandidate('expert-validator-1')], {
      requestId: REQUEST.requestId,
      tenantId: REQUEST.tenantId,
      submittingExpertRef: 'expert-submitter-1',
      coiExpertRefs: [],
      requiredSkills: ['boq-estimation.quantity-takeoff'],
    });
    expect(consumeSelectionAsAuthorization(selection).granted).toBe(false);
  });
});

describe('a validator adjudicating their own submission (COI exclusion)', () => {
  it('the submitting expert is never selected even when the only candidate — routing fails closed', async () => {
    const { service } = await wiredService({
      candidates: [validatorCandidate('expert-submitter-1')],
    });
    await service.declareValidationCondition({
      ...REQUEST,
      condition: validConditionInput({ kind: 'expert-review-approval' }),
    });
    await expect(service.route(handoffCommand())).rejects.toThrow(EscalationValidationError);
  });

  it('the selected validator is always disjoint from the submitting expert', async () => {
    const ctx = await wiredService({
      candidates: [validatorCandidate('expert-submitter-1'), validatorCandidate('expert-validator-1')],
    });
    await ctx.service.declareValidationCondition({ ...REQUEST, condition: validConditionInput() });
    await ctx.service.route(handoffCommand());
    const validation = await ctx.service.getValidationRecord(REQUEST);
    expect(validation?.validator?.outcome).toBe('selected');
    if (validation?.validator?.outcome === 'selected') {
      expect(validation.validator.validator.expertRef).not.toBe('expert-submitter-1');
    }
  });
});

describe('verdict replay and tampering', () => {
  it('re-adjudicating a decided escalation fails closed (no silent re-verdict)', async () => {
    const { service } = await accepted();
    await expect(service.adjudicate(REQUEST)).rejects.toThrow(
      /requires escalation state 'validating'/u,
    );
  });

  it('recorded outcomes and history entries are deep-frozen — tampering throws', async () => {
    const { run, service } = await accepted();
    expect(() => {
      (run.outcome as unknown as Record<string, unknown>)['verdict'] = 'rejected';
    }).toThrow();
    const validation = await service.getValidationRecord(REQUEST);
    const entry = validation?.entries[0];
    if (entry === undefined) throw new Error('unreachable');
    expect(() => {
      (entry as unknown as Record<string, unknown>)['kind'] = 'adjudication-recorded';
    }).toThrow();
  });

  it('a handoff replayed AFTER the verdict fails closed (no silent re-validation)', async () => {
    const { service, escalationPort, receipt } = await accepted();
    const before = await escalationPort.findById(REQUEST.requestId);
    expect(receipt.status).toBe('routed');
    await expect(service.route(handoffCommand())).rejects.toThrow(
      /requires escalation state 'submitted'/u,
    );
    const after = await escalationPort.findById(REQUEST.requestId);
    expect(after?.history.length).toBe(before?.history.length);
  });
});

describe('revision-limit bypass', () => {
  it('a revision request beyond the policy bound cannot be constructed', () => {
    expect(() =>
      createRevisionRequest(
        {
          revisionId: newRevisionRequestId(),
          requestId: REQUEST.requestId,
          tenantId: REQUEST.tenantId,
          attemptNumber: 3,
          requiredChanges: [{ code: 'criteria-not-met', detail: 'fix', ref: null }],
          resubmissionDeadline: '2026-10-07T13:00:00.000Z',
          requestedAt: '2026-10-07T12:00:00.000Z',
        },
        { policyVersion: 1, maxRevisionAttempts: 2, revisionWindowMs: 3_600_000 },
      ),
    ).toThrow(/revision-limit bypass denied/u);
  });

  it('an exhausted (REJECTED) escalation cannot re-enter the revision loop', async () => {
    const ctx = await wiredService({ evaluation: { scores: { [CRITERION]: 0.5 } } });
    await ctx.service.declareValidationCondition({
      ...REQUEST,
      condition: validConditionInput({ maxRevisionAttempts: 1 }),
    });
    await ctx.service.route(handoffCommand());
    const run = await ctx.service.adjudicate(REQUEST);
    expect(run.outcome.verdict).toBe('rejected');
    expect(run.revisionRequest).toBeUndefined(); // exhausted: NO revision request is issued
    // Adjudication is closed: the state guard fails closed.
    await expect(ctx.service.adjudicate(REQUEST)).rejects.toThrow(
      /requires escalation state 'validating'/u,
    );
    // Rewiring the clock cannot smuggle a new round past the state guard.
    const smuggler = new EscalationValidationService({
      clock: new FixedClock(Date.parse('2026-10-07T10:50:00.000Z')),
      escalationPort: ctx.escalationPort,
      store: ctx.store,
      evaluationStage: new ReferenceEvaluationStage(),
    });
    await expect(smuggler.adjudicate(REQUEST)).rejects.toThrow(
      /requires escalation state 'validating'/u,
    );
  });
});

describe('cross-tenant validation-record access', () => {
  it('declare/route/adjudicate/read all fail closed on tenant mismatch', async () => {
    const { service } = await accepted();
    const wrongTenant = { requestId: REQUEST.requestId, tenantId: 'tenant-beta' };
    await expect(
      service.declareValidationCondition({ ...wrongTenant, condition: validConditionInput() }),
    ).rejects.toThrow(/belongs to another tenant/u);
    await expect(
      service.route({ ...handoffCommand(), tenantId: 'tenant-beta' }),
    ).rejects.toThrow(/belongs to another tenant/u);
    await expect(service.adjudicate(wrongTenant)).rejects.toThrow(/belongs to another tenant/u);
    await expect(service.getValidationRecord(wrongTenant)).rejects.toThrow(
      /belongs to another tenant/u,
    );
    await expect(
      service.requestExpertReplacement({ ...wrongTenant, trigger: 'withdrawal' }),
    ).rejects.toThrow(/belongs to another tenant/u);
  });

  it('an unknown escalation for the tenant fails closed with the typed unknown-escalation error', async () => {
    const { service } = await accepted();
    await expect(
      service.getValidationRecord({ requestId: 'esc_ffffffffffffffffffffffffffffffff', tenantId: 'tenant-alpha' }),
    ).resolves.toBeUndefined();
    await expect(
      service.adjudicate({ requestId: 'esc_ffffffffffffffffffffffffffffffff', tenantId: 'tenant-alpha' }),
    ).rejects.toThrow(/unknown escalation/u);
  });
});
