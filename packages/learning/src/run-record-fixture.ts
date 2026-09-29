/**
 * Run-record fixture helper shared by envelope tests (NOT exported from
 * the package surface - test-support for a full, valid
 * ExperimentRunRecord).
 */

import { createExperimentRunRecord } from './run-record.js';
import type { ExperimentRunRecord } from './run-record.js';
import { createExperimentDescriptor } from './descriptor.js';
import { attributeExperiment } from './attribution.js';
import {
  checkProtectedCapabilities,
  compareOutcomeMetrics,
  computeUncertaintyReport,
} from './comparison.js';
import { decideCapabilityLift } from './verdict.js';
import {
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
  T7,
} from './test-support.js';

export async function makeRunRecordFixture(): Promise<ExperimentRunRecord> {
  const descriptor = await createExperimentDescriptor(makeExperimentInput());
  const baselineTrajectory = await makeTrajectoryRecord();
  const interventionTrajectory = await makeTrajectoryRecord({
    trajectoryId: 'trajectory-learning-0002',
    runId: 'tenant-a/run-learning-0002',
  });
  const baselineEvaluation = await makeEvaluationRecord(baselineTrajectory.chainHead as string);
  const interventionEvaluation = await makeEvaluationRecord(
    interventionTrajectory.chainHead as string,
  );
  const baselineVerification = await makeVerificationRecord(baselineTrajectory.chainHead as string);
  const interventionVerification = await makeVerificationRecord(
    interventionTrajectory.chainHead as string,
  );
  const baseline = {
    trajectories: [baselineTrajectory],
    evaluations: [baselineEvaluation],
    verifications: [baselineVerification],
  };
  const intervention = {
    trajectories: [interventionTrajectory],
    evaluations: [interventionEvaluation],
    verifications: [interventionVerification],
  };
  const baselineMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.8, variance: 0.01 }];
  const interventionMetrics = [{ metricId: 'reconciliation-accuracy', value: 0.9, variance: 0.01 }];
  const comparison = compareOutcomeMetrics(descriptor.outcomeMetrics, baselineMetrics, interventionMetrics);
  const uncertainty = computeUncertaintyReport(descriptor.uncertainty, baselineMetrics, interventionMetrics);
  const attribution = attributeExperiment(descriptor, baseline, intervention, uncertainty);
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
    intervention.verifications,
  );
  return createExperimentRunRecord({
    experimentKey: 'run-envelope-0001',
    correlationId: 'corr-learning-envelope',
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
    provenance: { executedBy: 'arena-learning-fabric', recordedAt: T7, notes: null },
  });
}
