/**
 * Service suite (Work Order C007) — a FULL intervention run over
 * injected C006/C001/A011 ports on the reference fabric: begin (mode
 * authorization; escalation session_ready → in_progress; session open
 * → active) → observable steps (mirrored into the C006 session stream
 * + the intervention record; escalation.progressed events) → mode
 * switch (the escalation-modes law) → submit (per-mode contract, A011
 * trajectory binding, C006 completion, C001 in_progress → submitted,
 * validation-seam routing). Idempotency of begin is asserted against
 * REAL C001 lifecycle records (never mocked semantics).
 */

import { describe, expect, it } from 'vitest';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { InterventionService } from './service.js';
import {
  InMemoryEscalationEventSink,
  InMemoryEscalationPort,
  InMemoryInterventionStore,
  InMemorySessionPort,
  InMemoryTrajectoryPort,
  StubValidationHandoff,
} from './fabric.js';
import {
  PAST_DEADLINE,
  T1,
  T2,
  T3,
  TENANT_A,
  expertSessionRecord,
  sessionReadyEscalation,
  teachResultInput,
  trajectoryBinding,
} from './test-support.js';

async function setup(overrides: Parameters<typeof sessionReadyEscalation>[0] = {}) {
  const escalationPort = new InMemoryEscalationPort();
  const sessionPort = new InMemorySessionPort();
  const trajectoryPort = new InMemoryTrajectoryPort();
  const store = new InMemoryInterventionStore();
  const eventSink = new InMemoryEscalationEventSink();
  const service = new InterventionService({
    escalationPort,
    sessionPort,
    trajectoryPort,
    store,
    eventSink,
    validationHandoff: new StubValidationHandoff(),
  });
  const escalation = await sessionReadyEscalation(overrides);
  await escalationPort.seed(escalation);
  const session = await expertSessionRecord(escalation);
  await sessionPort.seed(session);
  return { service, escalationPort, sessionPort, trajectoryPort, store, eventSink, escalation, session };
}

describe('beginIntervention — escalation session_ready → in_progress', () => {
  it('authorizes the mode, drives the lifecycle and binds the session', async () => {
    const { service, escalationPort, sessionPort, eventSink, escalation } = await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-0001',
      mode: 'teach',
      trajectoryBinding: trajectoryBinding(),
      now: T1,
      actor: 'expert-alice',
    });
    expect(record.state).toBe('active');
    expect(record.mode).toBe('teach');
    expect(record.allowedModes).toEqual(['teach', 'correct', 'unblock']);
    expect(record.modeHistory).toHaveLength(1);
    const escalationAfter = await escalationPort.get(escalation.request.requestId, TENANT_A);
    expect(escalationAfter?.state).toBe('in_progress');
    const sessionAfter = await sessionPort.get('session-boq-teach-1', TENANT_A);
    expect(sessionAfter?.state).toBe('active');
    expect(eventSink.ofType('escalation.started')).toHaveLength(1);
  });

  it('defaults to the request\'s first live intervention mode', async () => {
    const { service } = await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-default',
      now: T1,
    });
    expect(record.mode).toBe('teach');
  });

  it('is IDEMPOTENT: a duplicate begin returns the same record without re-transitioning', async () => {
    const { service, escalationPort, escalation } = await setup();
    const first = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-dup',
      mode: 'teach',
      now: T1,
    });
    const second = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-dup',
      mode: 'teach',
      now: T2,
    });
    expect(second.interventionId).toBe(first.interventionId);
    const escalationAfter = await escalationPort.get(escalation.request.requestId, TENANT_A);
    // in_progress entered exactly ONCE (history: created..session_ready + 1).
    expect(escalationAfter?.history).toHaveLength(7);
  });

  it('fails closed when the escalation is in no intervention-capable state', async () => {
    const { service } = await setup();
    await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-1',
      now: T1,
    });
    // A second, DIFFERENT begin against the now in_progress escalation is fine;
    // but an expired capsule fails closed.
    await expect(
      service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_A,
        expertRef: 'expert-bob',
        idempotencyKey: 'idem-ivn-2',
        now: PAST_DEADLINE,
      }),
    ).rejects.toThrowError(/expired/);
  });
});

describe('recordInterventionStep — observable work, dual-recorded', () => {
  it('mirrors the step into the C006 session stream and the intervention record', async () => {
    const { service, sessionPort, eventSink } = await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-steps',
      mode: 'teach',
      now: T1,
    });
    const next = await service.recordInterventionStep({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      kind: 'human-action',
      stepId: 'step-annotate-plan',
      payload: { annotation: 'measurement points marked', subjectRef: 'artifact/plan-1' },
      now: T2,
      actor: 'expert-alice',
    });
    expect(next.steps).toHaveLength(1);
    const session = await sessionPort.get('session-boq-teach-1', TENANT_A);
    expect(session?.events).toHaveLength(1);
    expect(session?.events[0]?.kind).toBe('human-action');
    // Progress events feed escalation.progressed.
    const progressed = eventSink.ofType('escalation.progressed');
    expect(progressed).toHaveLength(1);
    expect(progressed[0]?.data).toMatchObject({ stepKind: 'human-action' });
  });

  it('records every observable step kind', async () => {
    const { service } = await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-kinds',
      mode: 'teach',
      now: T1,
    });
    let current = record;
    const steps = [
      { kind: 'tool-invocation', stepId: 'step-invoke-tool', payload: { toolName: 'compute-reconciliation', input: { lines: 38 } } },
      { kind: 'tool-result', stepId: 'step-tool-result', payload: { toolName: 'compute-reconciliation', total: 173_400 } },
      { kind: 'artifact-change', stepId: 'step-artifact', payload: { artifactRef: 'artifact/takeoff-sheet-1', change: 'created' } },
      { kind: 'annotation', stepId: 'step-annotation', payload: { note: 'wastage applied', subjectRef: 'artifact/boq-draft-7' } },
      { kind: 'checkpoint', stepId: 'step-checkpoint', payload: { snapshotDigest: 'a'.repeat(64) } },
      { kind: 'tool-gap-signal', stepId: 'step-tool-gap', payload: { toolName: 'gh-local-rate-db', rationale: 'missing local rates' } },
    ];
    let at = Date.parse(T2);
    for (const step of steps) {
      current = await service.recordInterventionStep({
        interventionId: current.interventionId,
        tenantId: TENANT_A,
        now: at,
        ...step,
      });
      at += 60_000;
    }
    expect(current.steps).toHaveLength(6);
  });
});

describe('switchInterventionMode — the escalation-modes law', () => {
  it('switches between two authorized modes while in_progress', async () => {
    const { service, eventSink } = await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-switch',
      mode: 'correct',
      now: T1,
    });
    const next = await service.switchInterventionMode({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      toMode: 'unblock',
      now: T2,
    });
    expect(next.mode).toBe('unblock');
    expect(next.modeHistory).toHaveLength(2);
    expect(next.modeHistory[1]).toMatchObject({ from: 'correct', to: 'unblock' });
    expect(eventSink.ofType('escalation.progressed').length).toBeGreaterThanOrEqual(1);
  });
});

describe('submitIntervention — the full handoff', () => {
  it('completes the intervention, session and escalation; routes validation', async () => {
    const { service, escalationPort, sessionPort, trajectoryPort, store, eventSink, escalation } =
      await setup();
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-submit',
      mode: 'teach',
      trajectoryBinding: trajectoryBinding(),
      now: T1,
    });
    await service.recordInterventionStep({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      kind: 'human-action',
      stepId: 'step-annotate-plan',
      payload: { annotation: 'measurement points marked', subjectRef: 'artifact/plan-1' },
      now: T2,
    });
    const completed = await service.submitIntervention({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      result: teachResultInput(),
      consentRightsStatement: { granted: false, statement: 'no reusable learning authorized' },
      now: T3,
      actor: 'expert-alice',
    });
    expect(completed.state).toBe('completed');
    expect(completed.contract?.kind).toBe('teach-demonstration');
    expect(completed.trajectoryRef?.trajectoryId).toBe('ivn-traj-teach-1');

    // The A011 trajectory was emitted, persisted and verifiable.
    const trajectory = await trajectoryPort.get('ivn-traj-teach-1');
    expect(trajectory).toBeDefined();
    await expect(verifyTrajectoryRecord(trajectory!)).resolves.toBe(trajectory!.chainHead);

    // C001: in_progress → submitted with the mapped result.
    const escalationAfter = await escalationPort.get(escalation.request.requestId, TENANT_A);
    expect(escalationAfter?.state).toBe('submitted');
    expect(escalationAfter?.result?.kind).toBe('evidence-bundle');

    // C006: session completed with the EES1.0 completion contract.
    const session = await sessionPort.get('session-boq-teach-1', TENANT_A);
    expect(session?.state).toBe('completed');
    expect(session?.submission?.evidence.length).toBeGreaterThanOrEqual(1);

    // The C009 seam routed the SUBMITTED payload (stub-labelled).
    expect(completed.validationHandoff?.stub).toBe(true);
    expect(completed.validationHandoff?.routedTo).toBe('verification-fabric');
    expect(completed.validationHandoff?.validationCondition.source).toBe('c009-stub-mode-policy');

    // Webhook projection: started + progressed + submitted.
    expect(eventSink.ofType('escalation.started')).toHaveLength(1);
    expect(eventSink.ofType('escalation.progressed')).toHaveLength(1);
    expect(eventSink.ofType('escalation.submitted')).toHaveLength(1);

    // Durable: the completed record is retrievable tenant-scoped.
    const stored = await store.get(completed.interventionId, TENANT_A);
    expect(stored?.state).toBe('completed');
  });

  it('routes REVIEW submissions onto the A012 evaluation fabric (stub policy)', async () => {
    const { service } = await setup({
      escalationModes: ['review'],
      idempotencyKey: 'idem-review-1',
    });
    const record = await service.beginIntervention({
      sessionId: 'session-boq-teach-1',
      tenantId: TENANT_A,
      expertRef: 'expert-alice',
      idempotencyKey: 'idem-ivn-review',
      mode: 'review',
      now: T1,
    });
    const completed = await service.submitIntervention({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      result: {
        summary: 'the generated BOQ is acceptable against the declared criteria',
        verdict: 'approved',
        declaredCriteria: [
          { criteriaRef: 'criteria/quantity-accuracy', description: 'quantities within ±5%' },
        ],
        criteriaEvaluations: [
          { criteriaRef: 'criteria/quantity-accuracy', verdict: 'met', note: 'deviation 2.1%' },
        ],
        findings: ['wastage factor correctly applied'],
      },
      consentRightsStatement: { granted: false, statement: 'no reusable learning authorized' },
      now: T3,
    });
    expect(completed.contract?.kind).toBe('review');
    expect(completed.validationHandoff?.routedTo).toBe('evaluation-fabric');
  });
});
