/**
 * Closed-shape validation of the Epoch escalation trigger (Work Order
 * C019): positive parse + fail-closed rejections for unknown fields,
 * wrong types, out-of-vocabulary values and malformed identities.
 */

import { describe, expect, it } from 'vitest';
import { EPOCH_ESCALATION_ERROR_CODES, EpochEscalationError } from './errors.js';
import { parseEpochIntegrationPosture } from './posture.js';
import { isEpochEscalationTrigger, parseEpochEscalationTrigger } from './trigger.js';
import { REFERENCE_POSTURE, validTrigger } from './test-support.js';

describe('parseEpochEscalationTrigger — closed shape', () => {
  it('parses the reference trigger and freezes it', () => {
    const trigger = parseEpochEscalationTrigger(validTrigger());
    expect(trigger.triggerType).toBe('uncertainty-boundary');
    expect(trigger.epochJobId).toBe('epoch-job-2026-10-07-001');
    expect(trigger.correlationId).toBe('epoch-corr-0001');
    expect(trigger.causationId).toBe('epoch-cause-0009');
    expect(trigger.idempotencyKey).toBe('epoch-idem-0001');
    expect(trigger.capabilityNeed).toBe('boq-estimation.quantity-takeoff');
    expect(trigger.escalationModes).toEqual(['solve', 'unblock']);
    expect(trigger.artifactDigests).toHaveLength(2);
    expect(Object.isFrozen(trigger)).toBe(true);
    expect(Object.isFrozen(trigger.artifactDigests)).toBe(true);
  });

  it('isEpochEscalationTrigger guards wire values', () => {
    expect(isEpochEscalationTrigger(validTrigger())).toBe(true);
    expect(isEpochEscalationTrigger({ ...validTrigger(), triggerVersion: 2 })).toBe(false);
    expect(isEpochEscalationTrigger(null)).toBe(false);
    expect(isEpochEscalationTrigger('trigger')).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(() => parseEpochEscalationTrigger(null)).toThrowError(EpochEscalationError);
    expect(() => parseEpochEscalationTrigger([])).toThrowError(EpochEscalationError);
    expect(() => parseEpochEscalationTrigger('x')).toThrowError(EpochEscalationError);
  });

  it('fails closed on UNKNOWN top-level fields', () => {
    const error = capture(() =>
      parseEpochEscalationTrigger({ ...validTrigger(), worldModelMutation: { x: 1 } }),
    );
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD);
  });

  it('fails closed on unknown source fields', () => {
    const error = capture(() =>
      parseEpochEscalationTrigger({
        ...validTrigger(),
        source: { workflowRef: 'boq-accra-house-draft', runRef: 'run-2026-10-07-042', extra: 'boom' },
      }),
    );
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD);
  });

  it('fails closed on wrong triggerVersion', () => {
    const error = capture(() => parseEpochEscalationTrigger({ ...validTrigger(), triggerVersion: 2 }));
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on out-of-vocabulary triggerType / urgency / modes', () => {
    expect(
      capture(() => parseEpochEscalationTrigger({ ...validTrigger(), triggerType: 'vibes' }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    expect(
      capture(() => parseEpochEscalationTrigger({ ...validTrigger(), urgency: 'asap' }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    expect(
      capture(() =>
        parseEpochEscalationTrigger({ ...validTrigger(), escalationModes: ['solve', 'solve'] }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    expect(
      capture(() => parseEpochEscalationTrigger({ ...validTrigger(), escalationModes: [] }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on malformed EPI1.0 async ids', () => {
    for (const field of ['epochJobId', 'correlationId', 'causationId', 'idempotencyKey'] as const) {
      const error = capture(() =>
        parseEpochEscalationTrigger({ ...validTrigger(), [field]: 'BAD ID!' }),
      );
      expect(error?.code, field).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    }
  });

  it('fails closed on malformed authorization metadata', () => {
    const error = capture(() =>
      parseEpochEscalationTrigger({
        ...validTrigger(),
        authorization: { clientAppId: 'Wrong-App', tenantId: 'tenant-alpha' },
      }),
    );
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on deadline not after occurredAt', () => {
    const error = capture(() =>
      parseEpochEscalationTrigger({
        ...validTrigger(),
        deadlineAt: '2026-10-07T09:00:00.000Z',
      }),
    );
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on malformed budget', () => {
    expect(
      capture(() =>
        parseEpochEscalationTrigger({ ...validTrigger(), budget: { amountMinorUnits: -1, currency: 'USD' } }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    expect(
      capture(() =>
        parseEpochEscalationTrigger({ ...validTrigger(), budget: { amountMinorUnits: 100, currency: 'usd' } }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on malformed artifact digests', () => {
    expect(
      capture(() =>
        parseEpochEscalationTrigger({
          ...validTrigger(),
          artifactDigests: [{ kind: 'trajectory', digest: 'not-hex', ref: 'epoch-traj-042' }],
        }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
    expect(
      capture(() => parseEpochEscalationTrigger({ ...validTrigger(), artifactDigests: [] }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });

  it('fails closed on non-plain-JSON desired output schema', () => {
    const bad: Record<string, unknown> = { ...validTrigger() };
    bad['desiredOutputSchema'] = { type: 'object', fn: () => 1 };
    const error = capture(() => parseEpochEscalationTrigger(bad));
    expect(error?.code).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER);
  });
});

describe('parseEpochIntegrationPosture — closed shape', () => {
  it('parses the reference posture', () => {
    const posture = parseEpochIntegrationPosture(REFERENCE_POSTURE);
    expect(posture.clientAppId).toBe('epoch-app');
    expect(posture.tenantId).toBe('tenant-alpha');
    expect(posture.environmentSessionPolicy.sessionMode).toBe('bounded-replica');
    expect(Object.isFrozen(posture)).toBe(true);
  });

  it('fails closed on unknown fields and bad vocabulary', () => {
    expect(
      capture(() => parseEpochIntegrationPosture({ ...REFERENCE_POSTURE, secretKey: 'x' }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.UNKNOWN_FIELD);
    expect(
      capture(() =>
        parseEpochIntegrationPosture({
          ...REFERENCE_POSTURE,
          environmentSessionPolicy: { sessionMode: 'live-world', sanitization: 'strict' },
        }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE);
    expect(
      capture(() =>
        parseEpochIntegrationPosture({
          ...REFERENCE_POSTURE,
          privacyPolicy: { dataClassification: 'top-secret', pii: 'redact' },
        }),
      )?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE);
    expect(
      capture(() => parseEpochIntegrationPosture({ ...REFERENCE_POSTURE, permittedActions: ['escalate-roles'] }))?.code,
    ).toBe(EPOCH_ESCALATION_ERROR_CODES.INVALID_POSTURE);
  });
});

function capture(fn: () => unknown): EpochEscalationError | undefined {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (error instanceof EpochEscalationError) return error;
    throw error;
  }
}
