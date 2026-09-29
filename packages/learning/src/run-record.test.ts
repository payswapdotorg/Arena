/**
 * ExperimentRunRecord tests - construction, content addressing,
 * immutability, internal consistency (incl. the confound ⇒
 * inconclusive-unless-controlled construction invariant).
 */

import { describe, expect, it } from 'vitest';
import {
  createExperimentRunRecord,
  experimentRunRecordView,
  isExperimentRunRecord,
  recomputeExperimentRunRecordDigest,
} from './run-record.js';
import { createExperimentDescriptor } from './descriptor.js';
import { attributeExperiment } from './attribution.js';
import {
  checkProtectedCapabilities,
  compareOutcomeMetrics,
  computeUncertaintyReport,
} from './comparison.js';
import { decideCapabilityLift } from './verdict.js';
import { LEARNING_ERROR_CODES } from './errors.js';
import {
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
  T7,
} from './test-support.js';

async function makeRunFixture(options: {
  evaluatorRefs?: [string, string];
  confoundVerdictOverride?: 'not-demonstrated';
} = {}) {
  const descriptor = await createExperimentDescriptor(makeExperimentInput());
  const baselineTrajectory = await makeTrajectoryRecord();
  const interventionTrajectory = await makeTrajectoryRecord({
    trajectoryId: 'trajectory-learning-0002',
    runId: 'tenant-a/run-learning-0002',
  });
  const [baselineEvaluatorRef, interventionEvaluatorRef] = options.evaluatorRefs ?? [
    '1111111111111111111111111111111111111111111111111111111111111111',
    '1111111111111111111111111111111111111111111111111111111111111111',
  ];
  const baselineEvaluation = await makeEvaluationRecord(baselineTrajectory.chainHead as string, {
    evaluatorRef: baselineEvaluatorRef,
  });
  const interventionEvaluation = await makeEvaluationRecord(
    interventionTrajectory.chainHead as string,
    { evaluatorRef: interventionEvaluatorRef },
  );
  const baselineVerification = await makeVerificationRecord(baselineTrajectory.chainHead as string);
  const interventionVerification = await makeVerificationRecord(
    interventionTrajectory.chainHead as string,
  );
  const arms = {
    baseline: {
      trajectories: [baselineTrajectory],
      evaluations: [baselineEvaluation],
      verifications: [baselineVerification],
    },
    intervention: {
      trajectories: [interventionTrajectory],
      evaluations: [interventionEvaluation],
      verifications: [interventionVerification],
    },
  };
  const baselineMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 }];
  const interventionMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.01 }];
  const comparison = compareOutcomeMetrics(
    descriptor.outcomeMetrics,
    baselineMetrics,
    interventionMetrics,
  );
  const uncertainty = computeUncertaintyReport(
    descriptor.uncertainty,
    baselineMetrics,
    interventionMetrics,
  );
  const attribution = attributeExperiment(
    descriptor,
    arms.baseline,
    arms.intervention,
    uncertainty,
  );
  const protectedChecks = checkProtectedCapabilities(
    descriptor.protectedCapabilities,
    [{ capabilityRef: descriptor.protectedCapabilities[0]?.ref.digest ?? '', value: 0.9 }],
    [{ capabilityRef: descriptor.protectedCapabilities[0]?.ref.digest ?? '', value: 0.95 }],
  );
  const verdict = decideCapabilityLift(
    descriptor,
    comparison,
    uncertainty,
    attribution,
    protectedChecks,
    arms.intervention.verifications,
  );
  return {
    descriptor,
    arms,
    baselineMetrics,
    interventionMetrics,
    comparison,
    uncertainty,
    attribution,
    protectedChecks,
    verdict,
    input: {
      experimentKey: 'run-experiment-0001',
      correlationId: 'corr-learning-0001',
      descriptorRef: descriptor.digest as string,
      baseline: {
        trajectories: [baselineTrajectory.chainHead as string],
        evaluations: [baselineEvaluation.digest as string],
        verifications: [baselineVerification.digest as string],
      },
      intervention: {
        trajectories: [interventionTrajectory.chainHead as string],
        evaluations: [interventionEvaluation.digest as string],
        verifications: [interventionVerification.digest as string],
      },
      baselineMetrics,
      interventionMetrics,
      comparison: [...comparison],
      uncertainty,
      protectedCapabilityChecks: [...protectedChecks],
      attribution,
      verdict,
      provenance: {
        executedBy: 'arena-learning-fabric',
        recordedAt: T7,
        notes: null,
      },
    },
  };
}

describe('experiment run record - positive', () => {
  it('creates a content-addressed, deep-frozen append-only record', async () => {
    const fixture = await makeRunFixture();
    const record = await createExperimentRunRecord(fixture.input);
    expect(record.recordVersion).toBe(1);
    expect(record.experimentKey).toBe('run-experiment-0001');
    expect(record.descriptorRef).toBe(fixture.descriptor.digest);
    expect(record.baseline.trajectories).toHaveLength(1);
    expect(record.comparison).toHaveLength(1);
    expect(record.verdict.verdict).toBe('lift-demonstrated');
    expect(record.attribution.findings).toHaveLength(6);
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.baseline)).toBe(true);
    expect(isExperimentRunRecord(record)).toBe(true);
  });

  it('is deterministic: same inputs ⇒ same record digest', async () => {
    const fixture = await makeRunFixture();
    const a = await createExperimentRunRecord(fixture.input);
    const b = await createExperimentRunRecord(fixture.input);
    expect(a.digest).toBe(b.digest);
  });

  it('digest recomputation matches (tamper tripwire)', async () => {
    const fixture = await makeRunFixture();
    const record = await createExperimentRunRecord(fixture.input);
    await expect(recomputeExperimentRunRecordDigest(record)).resolves.toBe(record.digest);
    const tampered = { ...record, experimentKey: 'run-other' } as typeof record;
    await expect(recomputeExperimentRunRecordDigest(tampered)).rejects.toMatchObject({
      code: LEARNING_ERROR_CODES.TAMPERED,
    });
  });

  it('the digest-free view omits the digest', async () => {
    const fixture = await makeRunFixture();
    const record = await createExperimentRunRecord(fixture.input);
    const view = experimentRunRecordView(record);
    expect('digest' in view).toBe(false);
    expect(view.experimentKey).toBe(record.experimentKey);
  });
});

describe('experiment run record - negative/adversarial', () => {
  it('REJECTS an invalid experiment key (lock rule 17)', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({ ...fixture.input, experimentKey: '' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REJECTS an invalid correlation id', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({ ...fixture.input, correlationId: 'not valid!' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RUN });
  });

  it('REJECTS a confounded attribution paired with a non-inconclusive verdict (construction invariant)', async () => {
    const fixture = await makeRunFixture({
      evaluatorRefs: [
        '1111111111111111111111111111111111111111111111111111111111111111',
        '2222222222222222222222222222222222222222222222222222222222222222',
      ],
    });
    // The real verdict from this fixture IS inconclusive-unless-controlled;
    // adversarially swap in a claim of lift and prove the constructor refuses.
    await expect(
      createExperimentRunRecord({
        ...fixture.input,
        verdict: {
          recordVersion: 1,
          verdict: 'lift-demonstrated',
          conditions: {
            pinnedPopulationImprovement: true,
            survivesVerificationAudit: true,
            evaluatorVersionChangesAccounted: true,
            protectedCapabilityRegressionMeasured: true,
            uncertaintyReported: true,
          },
          basis: 'adversarial claim of lift under confound',
        },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
  });

  it('REJECTS a verdict with fewer than five conditions', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({
        ...fixture.input,
        verdict: {
          recordVersion: 1,
          verdict: 'not-demonstrated',
          conditions: { pinnedPopulationImprovement: false } as never,
          basis: 'missing conditions',
        },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
  });

  it('REJECTS metric-id set mismatches between comparison/measurements/uncertainty', async () => {
    const fixture = await makeRunFixture();
    // drop the uncertainty entry
    await expect(
      createExperimentRunRecord({
        ...fixture.input,
        uncertainty: { method: 'analytic-variance', entries: [] },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
    // drop the baseline measurement
    await expect(
      createExperimentRunRecord({ ...fixture.input, baselineMetrics: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
  });

  it('REJECTS an empty comparison', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({ ...fixture.input, comparison: [] }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
  });

  it('REJECTS malformed digest refs and provenance', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({ ...fixture.input, descriptorRef: 'nope' }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_DIGEST });
    await expect(
      createExperimentRunRecord({
        ...fixture.input,
        provenance: { executedBy: 'ok', recordedAt: 'soon', notes: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_TIMESTAMP });
  });

  it('REJECTS unknown fields (strict shape)', async () => {
    const fixture = await makeRunFixture();
    await expect(
      createExperimentRunRecord({ ...fixture.input, extra: true } as never),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_RECORD });
  });
});
