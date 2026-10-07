/**
 * CalibrationRecord tests (Work Order C004): LE1.0 predicted-vs-observed
 * shape, applicability context preservation, append-only supersession,
 * content addressing, backdated/tampered injection defenses.
 */

import { describe, expect, it } from 'vitest';
import {
  isCalibrationRecord,
  OBSERVED_OUTCOMES,
  recomputeCalibrationRecordDigest,
} from './record.js';
import { calibrationRecordView } from './record.js';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  buildCalibrationRecord,
  CAPABILITY_REF,
  ENVIRONMENT_VERSIONS,
  EXPERT_1,
  T1,
  T2,
  TENANT_A,
} from './test-support.js';

describe('createCalibrationRecord', () => {
  it('builds a frozen, content-addressed record preserving applicability context', async () => {
    const record = await buildCalibrationRecord();
    expect(record.recordVersion).toBe(1);
    expect(record.tenant).toBe(TENANT_A);
    expect(record.expertId).toBe(EXPERT_1);
    expect(record.predicted.confidence).toBe(0.8);
    expect(record.observed.outcome).toBe('correct');
    expect(record.applicability.capability.id).toBe(CAPABILITY_REF.id);
    expect(record.applicability.environment).toHaveLength(1);
    expect(Object.isFrozen(record)).toBe(true);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(isCalibrationRecord(record)).toBe(true);
  });

  it('is content-addressed: the same view yields the same digest (reproducible)', async () => {
    const first = await buildCalibrationRecord();
    const second = await buildCalibrationRecord();
    expect(first.digest).toBe(second.digest);
    const mutatedOrder = await buildCalibrationRecord({
      applicability: {
        capability: { ...CAPABILITY_REF },
        environment: ENVIRONMENT_VERSIONS.map((entry) => ({ ...entry })),
      },
    });
    expect(mutatedOrder.digest).toBe(first.digest);
  });

  it('rejects out-of-range predicted confidence and unknown observed outcomes', async () => {
    await expect(
      buildCalibrationRecord({ predicted: { confidence: 1.5, score: null } }),
    ).rejects.toThrow(ExpertCalibrationError);
    await expect(
      buildCalibrationRecord({ observed: { outcome: 'sorta-correct', score: null } }),
    ).rejects.toThrow(ExpertCalibrationError);
    expect([...OBSERVED_OUTCOMES]).toEqual(['correct', 'incorrect', 'inconclusive']);
  });

  it('REJECTS backdated outcome injection (observed strictly before predicted — BACKDATED_OUTCOME)', async () => {
    const error = await buildCalibrationRecord({
      predictedAt: T2,
      observedAt: T1,
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExpertCalibrationError);
    expect((error as ExpertCalibrationError).code).toBe(
      EXPERT_CALIBRATION_ERROR_CODES.BACKDATED_OUTCOME,
    );
  });

  it('rejects an empty applicability environment (context is preserved, not implied)', async () => {
    await expect(
      buildCalibrationRecord({
        applicability: {
          capability: { ...CAPABILITY_REF },
          environment: [],
        },
      }),
    ).rejects.toThrow(ExpertCalibrationError);
  });

  it('appends via supersedes — the prior record keeps its own digest forever (append-only)', async () => {
    const prior = await buildCalibrationRecord({ calibrationId: 'cal-record-prior' });
    const successor = await buildCalibrationRecord({
      calibrationId: 'cal-record-successor',
      observed: { outcome: 'incorrect', score: null },
      supersedes: prior.digest,
    });
    expect(successor.supersedes).toBe(prior.digest);
    expect(prior.digest).not.toBe(successor.digest);
    // The prior record is unchanged — history is never rewritten.
    expect(prior.observed.outcome).toBe('correct');
  });
});

describe('recomputeCalibrationRecordDigest', () => {
  it('verifies an intact record and fails closed with TAMPERED on mutation', async () => {
    const record = await buildCalibrationRecord();
    await expect(recomputeCalibrationRecordDigest(record)).resolves.toBe(record.digest);
    const tampered = {
      ...calibrationRecordView(record),
      digest: record.digest,
      observed: { outcome: 'correct' as const, score: 1 },
    };
    await expect(recomputeCalibrationRecordDigest(tampered)).rejects.toThrow(ExpertCalibrationError);
  });
});
