/**
 * Negative/adversarial suite — the engine's arm-contract enforcement:
 * REAL malformed evidence is refused (uncompleted trajectories,
 * misbound evaluations, unaddressed verifications, population and
 * environment mismatches, baseline pin violations, undeclared
 * metrics).
 */

import { describe, expect, it } from 'vitest';
import { ExperimentEngine } from './engine.js';
import { LEARNING_ERROR_CODES } from '@arena/learning';
import {
  CORR_ID,
  T7,
  makeArms,
  makeDescriptor,
  makeEvaluationRecord,
  makeTrajectoryRecord,
  makeVerificationRecord,
} from './test-support.js';

async function freshEngine() {
  const engine = new ExperimentEngine();
  const descriptor = await makeDescriptor();
  await engine.registerExperiment(descriptor);
  return { engine, descriptor };
}

describe('engine arm contracts — REAL guard enforcement', () => {
  it('REFUSES an unregistered descriptor (NOT_FOUND)', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    await expect(
      engine.run('0'.repeat(64), arms, {
        experimentKey: 'run-neg-0001',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.NOT_FOUND });
    expect(descriptor).toBeDefined();
  });

  it('REFUSES an invalid experiment key', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'bad key!',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REFUSES an arm with no trajectories', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const emptyArm = { ...arms.baseline, trajectories: [] };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, baseline: emptyArm }, {
        experimentKey: 'run-neg-0002',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REFUSES an uncompleted (still-open) trajectory in an arm', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({ omitCompletion: true });
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'run-neg-0003',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REFUSES structurally invalid arm records (REAL guards)', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const badArm = {
      ...arms.baseline,
      evaluations: [{} as never],
    };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, baseline: badArm }, {
        experimentKey: 'run-neg-0004',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REFUSES an evaluation judging a DIFFERENT trajectory', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const foreignTrajectory = await makeTrajectoryRecord({
      trajectoryId: 'trajectory-foreign-0001',
      runId: 'tenant-a/run-foreign-0001',
    });
    const foreignEvaluation = await makeEvaluationRecord(
      foreignTrajectory.chainHead as string,
    );
    const misboundArm = {
      ...arms.baseline,
      evaluations: [...arms.baseline.evaluations, foreignEvaluation],
    };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, baseline: misboundArm }, {
        experimentKey: 'run-neg-0005',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REFUSES a verification that does not address any arm trajectory', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const foreignVerification = await makeVerificationRecord('fa'.repeat(32));
    const misboundArm = {
      ...arms.baseline,
      verifications: [...arms.baseline.verifications, foreignVerification],
    };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, baseline: misboundArm }, {
        experimentKey: 'run-neg-0006',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });
});

describe('engine pinning enforcement (Q1.0 condition 1)', () => {
  it('REFUSES trajectories outside the PINNED task population', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({ taskId: 'task-not-pinned' });
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'run-neg-0007',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.PINNED_POPULATION_MISMATCH });
  });

  it('REFUSES trajectories outside the pinned environment versions', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({ environmentDigest: 'ea'.repeat(32) });
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'run-neg-0008',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.ENVIRONMENT_MISMATCH });
  });

  it('REFUSES a baseline arm that violates the declared baseline body pin', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({ bodyRef: 'ba'.repeat(32) });
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'run-neg-0009',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.BASELINE_MISMATCH });
  });

  it('REFUSES a baseline arm that violates the declared baseline substrate pin', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({ substrateRef: '5a'.repeat(32) });
    await expect(
      engine.run(descriptor.digest as string, arms, {
        experimentKey: 'run-neg-0010',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.BASELINE_MISMATCH });
  });

  it('ALLOWS the intervention arm to change body/substrate (that is what interventions do)', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms({}, { bodyRef: '6a'.repeat(32), substrateRef: '6b'.repeat(32) });
    const record = await engine.run(descriptor.digest as string, arms, {
      experimentKey: 'run-neg-0011',
      correlationId: CORR_ID,
      recordedAt: T7,
    });
    expect(record.attribution.findings.find((f) => f.source === 'body')?.status).toBe(
      'declared-intervention',
    );
  });
});

describe('engine measurement enforcement', () => {
  it('REFUSES undeclared outcome metrics in an arm', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const rogueArm = {
      ...arms.intervention,
      metrics: [
        ...arms.intervention.metrics,
        { metricId: 'rogue-metric', value: 1, variance: null },
      ],
    };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, intervention: rogueArm }, {
        experimentKey: 'run-neg-0012',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.METRIC_MISMATCH });
  });

  it('REFUSES a missing declared outcome metric in an arm', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const emptyArm = { ...arms.intervention, metrics: [] };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, intervention: emptyArm }, {
        experimentKey: 'run-neg-0013',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.METRIC_MISMATCH });
  });

  it('REFUSES protected measurements for UNDECLARED capability refs', async () => {
    const { engine, descriptor } = await freshEngine();
    const arms = await makeArms();
    const rogueArm = {
      ...arms.intervention,
      protectedMetrics: [{ capabilityRef: '9'.repeat(64), value: 1 }],
    };
    await expect(
      engine.run(descriptor.digest as string, { ...arms, intervention: rogueArm }, {
        experimentKey: 'run-neg-0014',
        correlationId: CORR_ID,
        recordedAt: T7,
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.PROTECTED_CAPABILITY_MISMATCH });
  });
});
