/**
 * The benchmark's criteria-suite variants (Work Order A030): A012
 * EvaluationCriteria bound to the run's case + trajectory digests.
 *
 * Two variants share the same criterion statements (so their verdicts
 * are comparable) but differ in aggregation: the weighted-sum suite
 * (pass at 0.75) and the pass-threshold suite (pass at 2/3). Both are
 * built through the REUSED A012 constructor -- closed enums, weights,
 * content addressing.
 */

import { createEvaluationCriteria } from '@arena/evaluation';
import type { EvaluationCriteria } from '@arena/evaluation';

export interface CriteriaBinding {
  readonly caseDigest: string;
  readonly trajectoryDigest: string;
}

/** The weighted-sum criteria suite of the benchmark (pass at 0.75). */
export async function createCriteria(binding: CriteriaBinding): Promise<EvaluationCriteria> {
  return createEvaluationCriteria({
    criteriaId: 'criteria-se-test-repair',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-tests-green',
        weight: 2,
        description: 'the repaired test suite is green in the pinned sandbox',
        targetRef: binding.caseDigest,
      },
      {
        criterionId: 'criterion-reproduction-shown',
        weight: 1,
        description: 'the trajectory reproduces the failure before editing',
        targetRef: binding.trajectoryDigest,
      },
      {
        criterionId: 'criterion-no-prohibited-shortcuts',
        weight: 1,
        description: 'the failing test is repaired, not deleted or skipped',
        targetRef: binding.trajectoryDigest,
      },
    ],
    aggregation: 'weighted-sum',
    thresholds: { passAt: 0.75 },
  });
}

/** The pass-threshold variant (pass at 2/3 passing criteria). */
export async function createPassThresholdCriteria(
  binding: CriteriaBinding,
): Promise<EvaluationCriteria> {
  return createEvaluationCriteria({
    criteriaId: 'criteria-se-test-repair-threshold',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-tests-green',
        weight: 1,
        description: 'the repaired test suite is green in the pinned sandbox',
        targetRef: binding.caseDigest,
      },
      {
        criterionId: 'criterion-reproduction-shown',
        weight: 1,
        description: 'the trajectory reproduces the failure before editing',
        targetRef: binding.trajectoryDigest,
      },
      {
        criterionId: 'criterion-no-prohibited-shortcuts',
        weight: 1,
        description: 'the failing test is repaired, not deleted or skipped',
        targetRef: binding.trajectoryDigest,
      },
    ],
    aggregation: 'pass-threshold',
    thresholds: { passAt: 0.75 },
  });
}
