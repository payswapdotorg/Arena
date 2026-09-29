/**
 * Calibration tests - predicted confidence vs observed outcomes with
 * preserved applicability context, and the pure summary statistics.
 */

import { describe, expect, it } from 'vitest';
import {
  createCalibrationRecord,
  isCalibrationRecord,
  summarizeCalibration,
} from './calibration.js';
import { LEARNING_ERROR_CODES } from './errors.js';
import {
  ENVIRONMENT_VERSION,
  PROTECTED_CAPABILITY,
  TASK_POPULATION,
  T8,
} from './test-support.js';

const BASE_INPUT = {
  calibrationId: 'calibration-0001',
  experimentRef: 'e'.repeat(64),
  metricId: 'reconciliation-accuracy',
  predicted: { confidence: 0.8, delta: 0.1 },
  observed: { outcome: 'improved', delta: 0.12 },
  applicability: {
    targetCapability: { ...PROTECTED_CAPABILITY },
    taskPopulation: TASK_POPULATION.map((entry) => ({ ...entry })),
    environmentVersions: [{ ...ENVIRONMENT_VERSION }],
  },
  observedAt: T8,
  provenance: { recordedBy: 'arena-learning-test', recordedAt: T8, notes: null },
};

describe('calibration record - positive', () => {
  it('creates a content-addressed, deep-frozen calibration record preserving applicability context', async () => {
    const record = await createCalibrationRecord(BASE_INPUT);
    expect(record.recordVersion).toBe(1);
    expect(record.predicted.confidence).toBe(0.8);
    expect(record.observed.outcome).toBe('improved');
    expect(record.applicability.taskPopulation).toHaveLength(1);
    expect(record.applicability.environmentVersions[0]?.digest).toBe(ENVIRONMENT_VERSION.digest);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.applicability)).toBe(true);
    expect(isCalibrationRecord(record)).toBe(true);
  });

  it('is deterministic: same input ⇒ same digest', async () => {
    const a = await createCalibrationRecord(BASE_INPUT);
    const b = await createCalibrationRecord(BASE_INPUT);
    expect(a.digest).toBe(b.digest);
  });

  it('nulls are legal for un-carried deltas', async () => {
    const record = await createCalibrationRecord({
      ...BASE_INPUT,
      predicted: { confidence: 0.6, delta: null },
      observed: { outcome: 'inconclusive', delta: null },
    });
    expect(record.predicted.delta).toBeNull();
    expect(record.observed.delta).toBeNull();
  });
});

describe('calibration record - negative', () => {
  it('REJECTS out-of-range confidence', async () => {
    await expect(
      createCalibrationRecord({
        ...BASE_INPUT,
        predicted: { confidence: 1.5, delta: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_CALIBRATION });
  });

  it('REJECTS unknown observed outcomes (closed vocabulary)', async () => {
    await expect(
      createCalibrationRecord({
        ...BASE_INPUT,
        observed: { outcome: 'sort-of-better', delta: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_CALIBRATION });
  });

  it('REJECTS empty applicability context (context is preserved, not implied)', async () => {
    await expect(
      createCalibrationRecord({
        ...BASE_INPUT,
        applicability: {
          ...BASE_INPUT.applicability,
          taskPopulation: [],
        },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_CALIBRATION });
    await expect(
      createCalibrationRecord({
        ...BASE_INPUT,
        applicability: {
          ...BASE_INPUT.applicability,
          environmentVersions: [],
        },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_CALIBRATION });
  });

  it('REJECTS malformed refs and timestamps', async () => {
    await expect(
      createCalibrationRecord({ ...BASE_INPUT, experimentRef: 'nope' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DIGEST });
    await expect(
      createCalibrationRecord({ ...BASE_INPUT, observedAt: 'later' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_TIMESTAMP });
  });
});

describe('summarizeCalibration - pure statistics', () => {
  it('computes counts, mean confidences and the Brier score over decided records', async () => {
    const records = [
      await createCalibrationRecord(BASE_INPUT), // improved, confidence 0.8
      await createCalibrationRecord({
        ...BASE_INPUT,
        calibrationId: 'calibration-0002',
        observed: { outcome: 'not-improved', delta: -0.05 },
        predicted: { confidence: 0.3, delta: 0.1 },
      }),
      await createCalibrationRecord({
        ...BASE_INPUT,
        calibrationId: 'calibration-0003',
        observed: { outcome: 'inconclusive', delta: null },
        predicted: { confidence: 0.5, delta: null },
      }),
    ];
    const summary = summarizeCalibration(records);
    expect(summary.recordCount).toBe(3);
    expect(summary.improvedCount).toBe(1);
    expect(summary.notImprovedCount).toBe(1);
    expect(summary.inconclusiveCount).toBe(1);
    expect(summary.meanPredictedConfidenceWhenImproved).toBeCloseTo(0.8);
    expect(summary.meanPredictedConfidenceWhenNotImproved).toBeCloseTo(0.3);
    // Brier over the two decided records: ((0.8-1)^2 + (0.3-0)^2) / 2 = (0.04 + 0.09) / 2
    expect(summary.brierScore).toBeCloseTo(0.065);
  });

  it('empty input ⇒ null means and null Brier', () => {
    const summary = summarizeCalibration([]);
    expect(summary.recordCount).toBe(0);
    expect(summary.brierScore).toBeNull();
    expect(summary.meanPredictedConfidenceWhenImproved).toBeNull();
  });

  it('REJECTS structurally invalid records', () => {
    expect(() => summarizeCalibration([{} as never])).toThrow(
      /structurally valid calibration records/,
    );
  });

  it('is deterministic (property)', async () => {
    const records = [await createCalibrationRecord(BASE_INPUT)];
    expect(summarizeCalibration(records)).toEqual(summarizeCalibration(records));
  });
});
