/**
 * Adversarial suite (Work Order C007) — the minimum adversarial cases:
 *   1. unpermitted mode escalation (begin in a mode the request does not list);
 *   2. expert action OUTSIDE the session action allowlist (a mode-policy
 *      violation) and a LIVE-WORLD MUTATION attempt (both fail closed);
 *   3. mode transition WITHOUT authorization (and in the wrong lifecycle state);
 *   4. TEACH trajectory leaking hidden reasoning (private chain-of-thought);
 *   5. TEACH submission without the mandatory trajectory binding;
 *   6. cross-tenant access attempts.
 */

import { describe, expect, it } from 'vitest';
import { ExpertSessionError } from '@arena/expert-session';
import { InterventionError, INTERVENTION_ERROR_CODES } from '@arena/intervention';
import { InterventionService } from './service.js';
import {
  InMemoryEscalationPort,
  InMemoryInterventionStore,
  InMemorySessionPort,
  InMemoryTrajectoryPort,
} from './fabric.js';
import {
  T1,
  T2,
  T3,
  TENANT_A,
  TENANT_B,
  expertSessionRecord,
  interventionCapableRequestInput,
  sessionReadyEscalation,
  teachResultInput,
  trajectoryBinding,
} from './test-support.js';
import { createEscalationRequest, createEscalationRecord } from '@arena/escalation';

async function setup(overrides: Parameters<typeof sessionReadyEscalation>[0] = {}) {
  const escalationPort = new InMemoryEscalationPort();
  const sessionPort = new InMemorySessionPort();
  const service = new InterventionService({
    escalationPort,
    sessionPort,
    trajectoryPort: new InMemoryTrajectoryPort(),
    store: new InMemoryInterventionStore(),
  });
  const escalation = await sessionReadyEscalation(overrides);
  await escalationPort.seed(escalation);
  const session = await expertSessionRecord(escalation);
  await sessionPort.seed(session);
  return { service, escalationPort, sessionPort, escalation, session };
}

async function begun(
  overrides: Parameters<typeof sessionReadyEscalation>[0] = {},
  mode = 'teach',
  withTrajectory = true,
) {
  const ctx = await setup(overrides);
  const record = await ctx.service.beginIntervention({
    sessionId: 'session-boq-teach-1',
    tenantId: TENANT_A,
    expertRef: 'expert-alice',
    idempotencyKey: 'idem-ivn-neg',
    mode,
    ...(withTrajectory ? { trajectoryBinding: trajectoryBinding() } : {}),
    now: T1,
  });
  return { ...ctx, record };
}

describe('unpermitted mode escalation — fail closed, never coerced', () => {
  it('rejects beginning a mode the request does NOT authorize', async () => {
    const { service } = await setup();
    await expect(
      service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_A,
        expertRef: 'expert-alice',
        idempotencyKey: 'idem-ivn-bad-mode',
        mode: 'solve',
        now: T1,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_A,
        expertRef: 'expert-alice',
        idempotencyKey: 'idem-ivn-bad-mode-2',
        mode: 'solve',
        now: T1,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('rejects an unknown mode outright', async () => {
    const { service } = await setup();
    await expect(
      service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_A,
        expertRef: 'expert-alice',
        idempotencyKey: 'idem-ivn-unknown',
        mode: 'supervise',
        now: T1,
      }),
    ).rejects.toThrowError(InterventionError);
  });

  it('rejects a live mode when the request authorizes no bounded session', async () => {
    const escalationPort = new InMemoryEscalationPort();
    const sessionPort = new InMemorySessionPort();
    const service = new InterventionService({ escalationPort, sessionPort });
    const request = await createEscalationRequest(
      interventionCapableRequestInput({
        environmentSessionPolicy: { sessionMode: 'none', sanitization: 'standard' },
        idempotencyKey: 'idem-no-session',
      }),
    );
    const escalation = createEscalationRecord(request, T1);
    await escalationPort.seed(escalation);
    const session = await expertSessionRecord(escalation);
    await sessionPort.seed(session);
    await expect(
      service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_A,
        expertRef: 'expert-alice',
        idempotencyKey: 'idem-ivn-no-session',
        mode: 'teach',
        now: T1,
      }),
    ).rejects.toThrowError(InterventionError);
  });
});

describe('expert action outside the session action allowlist / live-world mutation', () => {
  it('fails closed when the capsule mode forbids the action', async () => {
    // A REVIEW-mode session: the expert may critique but not edit artifacts.
    const { service, record } = await begun({ escalationModes: ['review'] }, 'review');
    await expect(
      service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'artifact-change',
        stepId: 'step-forbidden-edit',
        payload: { artifactRef: 'artifact/boq-draft-7', change: 'mutated-anyway' },
        now: T2,
      }),
    ).rejects.toThrowError(ExpertSessionError);
  });

  it('fails closed on a live-world mutation attempt (typed LIVE_WORLD_MUTATION)', async () => {
    const { service, record } = await begun();
    await expect(
      service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'artifact-change',
        stepId: 'step-live-write',
        payload: { artifactRef: 'live:prod-boq/current', change: 'mutate' },
        now: T2,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'artifact-change',
        stepId: 'step-live-write-2',
        payload: { artifactRef: 'prod:api/boq', change: 'mutate' },
        now: T2,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.LIVE_WORLD_MUTATION);
    }
  });

  it('rejects an out-of-vocabulary step kind', async () => {
    const { service, record } = await begun();
    await expect(
      service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'secret-thought-dump',
        stepId: 'step-bad',
        payload: { note: 'x' },
        now: T2,
      }),
    ).rejects.toThrowError(InterventionError);
  });
});

describe('mode transition without authorization — fail closed', () => {
  it('rejects switching to a mode the request does not authorize', async () => {
    const { service, record } = await begun();
    await expect(
      service.switchInterventionMode({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        toMode: 'solve',
        now: T2,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.switchInterventionMode({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        toMode: 'solve',
        now: T2,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.UNPERMITTED_MODE);
    }
  });

  it('rejects switching in a lifecycle state that permits no mode transition', async () => {
    const { service, record } = await begun();
    await service.submitIntervention({
      interventionId: record.interventionId,
      tenantId: TENANT_A,
      result: teachResultInput(),
      consentRightsStatement: { granted: false, statement: 'no reusable learning authorized' },
      now: T3,
    });
    // The escalation is now `submitted` — the escalation-modes law denies.
    await expect(
      service.switchInterventionMode({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        toMode: 'correct',
        now: T3,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.switchInterventionMode({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        toMode: 'correct',
        now: T3,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.INVALID_TRANSITION);
    }
  });

  it('rejects switching to the SAME mode (not a transition)', async () => {
    const { service, record } = await begun();
    await expect(
      service.switchInterventionMode({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        toMode: 'teach',
        now: T2,
      }),
    ).rejects.toThrowError(InterventionError);
  });
});

describe('TEACH trajectory leaking hidden reasoning — fail closed', () => {
  it('rejects a step payload carrying private chain-of-thought', async () => {
    const { service, record } = await begun();
    await expect(
      service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'human-action',
        stepId: 'step-teach-leak',
        payload: {
          humanAction: 'measured the plan',
          chainOfThought: 'first I would reason about the wastage factor…',
        },
        now: T2,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.recordInterventionStep({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        kind: 'human-action',
        stepId: 'step-teach-leak-2',
        payload: { nested: { scratchPad: 'hidden reasoning' } },
        now: T2,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.PRIVATE_REASONING);
    }
  });

  it('rejects a TEACH submission without the mandatory trajectory binding', async () => {
    const { service, record } = await begun({}, 'teach', false);
    await expect(
      service.submitIntervention({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        result: teachResultInput(),
        consentRightsStatement: { granted: false, statement: 'no reusable learning authorized' },
        now: T3,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.submitIntervention({
        interventionId: record.interventionId,
        tenantId: TENANT_A,
        result: teachResultInput(),
        consentRightsStatement: { granted: false, statement: 'no reusable learning authorized' },
        now: T3,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.TRAJECTORY_MISSING);
    }
  });
});

describe('tenant isolation — fail closed', () => {
  it('a foreign tenant cannot begin an intervention on another tenant\'s session', async () => {
    const { service } = await setup();
    await expect(
      service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_B,
        expertRef: 'expert-mallory',
        idempotencyKey: 'idem-ivn-cross',
        mode: 'teach',
        now: T1,
      }),
    ).rejects.toThrowError(InterventionError);
    try {
      await service.beginIntervention({
        sessionId: 'session-boq-teach-1',
        tenantId: TENANT_B,
        expertRef: 'expert-mallory',
        idempotencyKey: 'idem-ivn-cross-2',
        mode: 'teach',
        now: T1,
      });
    } catch (error) {
      expect((error as InterventionError).code).toBe(INTERVENTION_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('a foreign tenant cannot read another tenant\'s intervention', async () => {
    const { service, record } = await begun();
    const leaked = await service.getIntervention({
      interventionId: record.interventionId,
      tenantId: TENANT_B,
    });
    expect(leaked).toBeUndefined();
  });
});
