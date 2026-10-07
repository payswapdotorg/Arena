/**
 * Escalation observability projection tests (Work Order C017):
 * projection correctness over REAL C001 records (built through the
 * escalation domain's public factories), cost/fee projection through
 * the C010 reference fee schedule, SLA-breach computation and summary
 * aggregates. Projections are derived read models — never domain truth.
 */

import { describe, expect, it } from 'vitest';

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
} from '@arena/escalation';
import type { EscalationRecord } from '@arena/escalation';

import {
  buildClientEscalationProjection,
  summarizeClientEscalationProjections,
} from './projections.js';
import { SANDBOX_TRUTH_LABEL } from './sandbox.js';

const NOW = Date.parse('2026-10-07T10:00:00.000Z');

function baseCreateInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    clientAppId: 'epoch-app',
    tenantId: 'tenant-alpha',
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    now: NOW,
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocores: undefined,
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: { type: 'object', required: ['total'], properties: { total: { type: 'number' } } },
    contextReferences: [{ kind: 'task-ref', ref: 'task-7' }],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
    ...overrides,
  };
}

async function recordAt(state: 'matching' | 'paid'): Promise<EscalationRecord> {
  const request = await createEscalationRequest(baseCreateInput() as never);
  let record = createEscalationRecord(request, NOW);
  record = applyEscalationTransition(record, 'triaged', { now: NOW });
  record = applyEscalationTransition(record, 'matching', { now: NOW });
  if (state === 'paid') {
    record = applyEscalationTransition(record, 'offered', { now: NOW, expertRef: 'expert-ama' });
    record = applyEscalationTransition(record, 'accepted', { now: NOW });
    record = applyEscalationTransition(record, 'session_ready', { now: NOW, sessionRef: 'session-1' });
    record = applyEscalationTransition(record, 'in_progress', { now: NOW });
    record = applyEscalationTransition(record, 'submitted', {
      now: NOW,
      result: {
        resultVersion: 1,
        kind: 'answer',
        summary: 'verified takeoff',
        payload: { total: 25_000 },
      } as never,
    });
    record = applyEscalationTransition(record, 'validating', { now: NOW });
    record = applyEscalationTransition(record, 'result_accepted', { now: NOW, validationStatus: 'passed' });
    record = applyEscalationTransition(record, 'paid', {
      now: NOW,
      cost: {
        amountMinorUnits: 25_000,
        currency: 'USD',
        arenaFeeMinorUnits: 2_500,
        expertPayoutStatus: 'paid',
      },
    });
  }
  return record;
}

describe('client escalation projection (built from C001 canonical records)', () => {
  it('projects lifecycle state + request identity (positive)', async () => {
    const record = await recordAt('matching');
    const projection = buildClientEscalationProjection(record, {
      environment: 'live',
      now: NOW + 60_000,
    });
    expect(projection.state).toBe('matching');
    expect(projection.requestId).toBe(record.request.requestId);
    expect(projection.clientAppId).toBe('epoch-app');
    expect(projection.tenantId).toBe('tenant-alpha');
    expect(projection.environment).toBe('live');
    expect(projection.truthLabel).toBe('live');
    expect(projection.historyEntryCount).toBe(record.history.length);
    expect(projection.slaBreached).toBe(false);
  });

  it('projects validation status, expert/session refs and cost/fee fields (ES1.0 response)', async () => {
    const record = await recordAt('paid');
    const projection = buildClientEscalationProjection(record, {
      environment: 'live',
      now: NOW + 120_000,
    });
    expect(projection.state).toBe('paid');
    expect(projection.validationStatus).toBe('passed');
    expect(projection.expertRef).toBe('expert-ama');
    expect(projection.sessionRef).toBe('session-1');
    expect(projection.cost).toEqual({
      amountMinorUnits: 25_000,
      currency: 'USD',
      arenaFeeMinorUnits: 2_500,
      expertPayoutStatus: 'paid',
    });
    // The C010 reference schedule is 1000 bps → platform fee = 2500 minor units.
    expect(projection.feeSplit).toMatchObject({
      scheduleId: 'arena-reference',
      currency: 'USD',
      platformFeeMinorUnits: '2500',
      expertPayoutMinorUnits: '22500',
      truthLabel: 'live',
    });
  });

  it('marks SLA breach only for non-terminal records past the deadline', async () => {
    const record = await recordAt('matching');
    const breached = buildClientEscalationProjection(record, {
      environment: 'live',
      now: NOW + 3_600_001,
    });
    expect(breached.slaBreached).toBe(true);
    const paid = await recordAt('paid');
    const notBreached = buildClientEscalationProjection(paid, {
      environment: 'live',
      now: NOW + 3_600_001,
    });
    expect(notBreached.slaBreached).toBe(false);
  });

  it('labels sandbox-projected records with the sandbox truth label (truth-label law)', async () => {
    const record = await recordAt('matching');
    const projection = buildClientEscalationProjection(record, {
      environment: 'sandbox',
      now: NOW,
    });
    expect(projection.truthLabel).toBe(SANDBOX_TRUTH_LABEL);
    expect(projection.environment).toBe('sandbox');
    // A paid sandbox record's fee split is still DEMO money (labelled).
    const paid = await recordAt('paid');
    const paidProjection = buildClientEscalationProjection(paid, {
      environment: 'sandbox',
      now: NOW,
    });
    expect(paidProjection.feeSplit?.truthLabel).toBe('sandbox');
  });

  it('never mutates the canonical record (projection is read-only)', async () => {
    const record = await recordAt('matching');
    const before = JSON.stringify(record);
    buildClientEscalationProjection(record, { environment: 'live', now: NOW });
    expect(JSON.stringify(record)).toBe(before);
  });
});

describe('summary aggregate', () => {
  it('rolls up states, validation, SLA breaches and cost totals', async () => {
    const matching = await recordAt('matching');
    const paid = await recordAt('paid');
    const projections = [
      buildClientEscalationProjection(matching, { environment: 'live', now: NOW }),
      buildClientEscalationProjection(paid, { environment: 'live', now: NOW }),
    ];
    const summary = summarizeClientEscalationProjections(projections);
    expect(summary.total).toBe(2);
    expect(summary.byState['matching']).toBe(1);
    expect(summary.byState['paid']).toBe(1);
    expect(summary.validationPassed).toBe(1);
    expect(summary.validationPending).toBe(1);
    expect(summary.slaBreachedCount).toBe(0);
    expect(summary.costTotals['USD']).toEqual({
      amountMinorUnits: 25_000,
      arenaFeeMinorUnits: 2_500,
    });
    expect(summary.truthLabel).toBe('live');
  });

  it('an empty projection list summarizes to zero (honest empty state)', () => {
    const summary = summarizeClientEscalationProjections([]);
    expect(summary.total).toBe(0);
    expect(summary.byState).toEqual({});
    expect(summary.costTotals).toEqual({});
  });
});
