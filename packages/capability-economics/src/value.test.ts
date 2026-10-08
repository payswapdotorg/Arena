/**
 * Q1.0 value-side tests (Work Order C016): the capability-lift gate —
 * lift points ONLY when all five conditions hold; LE1.0 attribution
 * separation — a changed evaluator score is never an economics gain.
 */

import { describe, expect, it } from 'vitest';
import { createCapabilityLiftValueRecord, verifiedLiftPointsOf } from './value.js';

const SAME_EVALUATOR = 'c'.repeat(64);
const OTHER_EVALUATOR = 'd'.repeat(64);

type LiftInput = Parameters<typeof createCapabilityLiftValueRecord>[0];

function gatedInput(overrides: Record<string, unknown> = {}): LiftInput {
  return {
    requestId: 'req-econ-0001',
    tenantId: 'tenant-econ',
    capabilityId: 'cap.nlp.translation',
    pinnedEvaluationPopulationRef: 'evalpop:fixed-2026q4',
    verificationAuditRef: 'audit:0007',
    evaluatorVersionBefore: SAME_EVALUATOR,
    evaluatorVersionAfter: SAME_EVALUATOR,
    protectedCapabilityRegression: { capabilityId: 'cap.nlp.summarize', measuredDelta: -0.01 },
    uncertainty: { reported: true, variance: '0.021', material: true },
    claimedLiftPoints: 12,
    effortMinutes: 90,
    recordedAt: '2026-10-08T12:00:00.000Z',
    ...overrides,
  } as unknown as LiftInput;
}

describe('createCapabilityLiftValueRecord (the Q1.0 gate)', () => {
  it('records verified lift points when all five conditions are met', async () => {
    const record = await createCapabilityLiftValueRecord(gatedInput());
    expect(record.liftPoints).toBe(12);
    expect(verifiedLiftPointsOf(record)).toBe(12);
    expect(record.attribution).toBe('expert-effort');
    expect(Object.values(record.liftConditionsMet)).toEqual([true, true, true, true, true]);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gates the value figure when a condition is unmet (no lift points, disclosed)', async () => {
    const record = await createCapabilityLiftValueRecord(
      gatedInput({ claimedLiftPoints: undefined, verificationAuditRef: null }),
    );
    expect(record.liftPoints).toBeNull();
    expect(verifiedLiftPointsOf(record)).toBeNull();
    expect(record.liftConditionsMet['verification-audit']).toBe(false);
  });

  it('REFUSES claimed points when a condition is unmet (typed LIFT_GATED)', async () => {
    await expect(
      createCapabilityLiftValueRecord(gatedInput({ verificationAuditRef: null })),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LIFT_GATED',
    });
    await expect(
      createCapabilityLiftValueRecord(gatedInput({ pinnedEvaluationPopulationRef: null })),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LIFT_GATED',
    });
  });

  it('REFUSES points when material variance is unreported', async () => {
    await expect(
      createCapabilityLiftValueRecord(
        gatedInput({ uncertainty: { reported: false, variance: null, material: true } }),
      ),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_LIFT_GATED',
    });
  });

  it('LE1.0 attribution separation: a changed evaluator may NEVER claim points', async () => {
    await expect(
      createCapabilityLiftValueRecord(gatedInput({ evaluatorVersionAfter: OTHER_EVALUATOR })),
    ).rejects.toMatchObject({
      name: 'CapabilityEconomicsError',
      code: 'CAPABILITY_ECONOMICS_ATTRIBUTION_VIOLATION',
    });
  });

  it('records the evaluator-change measurement WITHOUT points (auditable, not a gain)', async () => {
    const record = await createCapabilityLiftValueRecord(
      gatedInput({ evaluatorVersionAfter: OTHER_EVALUATOR, claimedLiftPoints: undefined }),
    );
    expect(record.attribution).toBe('evaluator-change');
    expect(record.liftPoints).toBeNull();
    expect(record.evaluatorVersionBefore).not.toBe(record.evaluatorVersionAfter);
  });

  it('is deterministic: identical inputs → identical digest', async () => {
    const a = await createCapabilityLiftValueRecord(gatedInput());
    const b = await createCapabilityLiftValueRecord(gatedInput());
    expect(a.digest).toBe(b.digest);
  });

  it('rejects non-hex evaluator digests (fail-closed shape)', async () => {
    await expect(
      createCapabilityLiftValueRecord(gatedInput({ evaluatorVersionBefore: 'not-hex' })),
    ).rejects.toMatchObject({ name: 'CapabilityEconomicsError' });
  });
});
