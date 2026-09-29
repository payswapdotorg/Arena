/**
 * Attribution tests - the LE1.0 six-source classification and THE KEY
 * RULE: evaluator/verifier version differences between arms MUST flag
 * evaluator-version-confound / verifier-version-confound (surfaced,
 * never absorbed).
 */

import { describe, expect, it } from 'vitest';
import { attributeExperiment } from './attribution.js';
import { ATTRIBUTION_SOURCES } from './attribution-source.js';
import { createExperimentDescriptor } from './descriptor.js';
import type { UncertaintyReport } from './comparison.js';
import {
  makeEvaluationRecord,
  makeExperimentInput,
  makeTrajectoryRecord,
  makeVerificationRecord,
  TestLcg,
  DIGEST_A,
  DIGEST_B,
} from './test-support.js';

async function makeArms(options: {
  baselineEvaluatorRef?: string | undefined;
  interventionEvaluatorRef?: string | undefined;
  baselineVerifierId?: string | undefined;
  interventionVerifierId?: string | undefined;
  baselineBodyRef?: string | undefined;
  interventionBodyRef?: string | undefined;
  baselineSubstrateRef?: string | undefined;
  interventionSubstrateRef?: string | undefined;
  baselineEnvironmentDigest?: string | undefined;
  interventionEnvironmentDigest?: string | undefined;
} = {}) {
  const baselineTrajectory = await makeTrajectoryRecord({
    bodyRef: options.baselineBodyRef,
    substrateRef: options.baselineSubstrateRef,
    environmentDigest: options.baselineEnvironmentDigest,
  });
  const interventionTrajectory = await makeTrajectoryRecord({
    trajectoryId: 'trajectory-learning-0002',
    runId: 'tenant-a/run-learning-0002',
    bodyRef: options.interventionBodyRef,
    substrateRef: options.interventionSubstrateRef,
    environmentDigest: options.interventionEnvironmentDigest,
  });
  const baselineEvaluation = await makeEvaluationRecord(
    baselineTrajectory.chainHead as string,
    { evaluatorRef: options.baselineEvaluatorRef },
  );
  const interventionEvaluation = await makeEvaluationRecord(
    interventionTrajectory.chainHead as string,
    { evaluatorRef: options.interventionEvaluatorRef },
  );
  const baselineVerification = await makeVerificationRecord(
    baselineTrajectory.chainHead as string,
    { verifierId: options.baselineVerifierId },
  );
  const interventionVerification = await makeVerificationRecord(
    interventionTrajectory.chainHead as string,
    { verifierId: options.interventionVerifierId },
  );
  return {
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
}

describe('attribution - the six sources, canonical order', () => {
  it('emits exactly one finding per LE1.0 source, in canonical order', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.findings.map((entry) => entry.source)).toEqual([...ATTRIBUTION_SOURCES]);
    expect(result.recordVersion).toBe(1);
    expect(result.confounds).toEqual([]);
  });

  it('classifies the DECLARED intervention surface under its mapped source', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    // Default fixture declares the 'skills' surface → body.
    const body = result.findings.find((entry) => entry.source === 'body');
    const substrate = result.findings.find((entry) => entry.source === 'substrate');
    expect(body?.status).toBe('declared-intervention');
    expect(substrate?.status).toBe('not-indicated');
  });

  it('classifies substrate/model-specific-adaptation surfaces under substrate', async () => {
    for (const surface of ['substrate', 'model-specific-adaptation'] as const) {
      const descriptor = await createExperimentDescriptor(
        makeExperimentInput({ changedSurface: surface }),
      );
      const arms = await makeArms();
      const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
      const substrate = result.findings.find((entry) => entry.source === 'substrate');
      expect(substrate?.status).toBe('declared-intervention');
    }
  });

  it('classifies tool-configuration under environment', async () => {
    const descriptor = await createExperimentDescriptor(
      makeExperimentInput({ changedSurface: 'tool-configuration' }),
    );
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.findings.find((entry) => entry.source === 'environment')?.status).toBe(
      'declared-intervention',
    );
  });

  it('declared evaluator-verifier surface with IDENTICAL instruments stays confound-free (controlled measurement)', async () => {
    const descriptor = await createExperimentDescriptor(
      makeExperimentInput({ changedSurface: 'evaluator-verifier' }),
    );
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toEqual([]);
    const evaluator = result.findings.find((entry) => entry.source === 'evaluator-change');
    expect(evaluator?.status).toBe('declared-intervention');
    expect(evaluator?.basis).toContain('controlled measurement');
  });

  it('DETECTS undeclared version differences (body/substrate/environment) from the arm evidence', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms({
      interventionBodyRef: 'a'.repeat(64),
      interventionSubstrateRef: 'b'.repeat(64),
      interventionEnvironmentDigest: 'c'.repeat(64),
    });
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.findings.find((entry) => entry.source === 'substrate')?.status).toBe(
      'detected-version-difference',
    );
    // body is declared (skills surface) - declared dominates, basis mentions both.
    const body = result.findings.find((entry) => entry.source === 'body');
    expect(body?.status).toBe('declared-intervention');
    expect(body?.basis).toContain('body digests also differ');
    expect(result.findings.find((entry) => entry.source === 'environment')?.status).toBe(
      'detected-version-difference',
    );
  });
});

describe('attribution - THE KEY RULE (confounds, never absorbed)', () => {
  it('evaluator digests differing between arms flags evaluator-version-confound', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms({
      baselineEvaluatorRef: DIGEST_A,
      interventionEvaluatorRef: DIGEST_B,
    });
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toEqual(['evaluator-version-confound']);
    expect(result.evaluatorDigestsBaseline).toEqual([DIGEST_A]);
    expect(result.evaluatorDigestsIntervention).toEqual([DIGEST_B]);
    const evaluator = result.findings.find((entry) => entry.source === 'evaluator-change');
    expect(evaluator?.status).toBe('detected-version-difference');
    expect(evaluator?.basis).toContain('NOT automatically a capability improvement');
  });

  it('verifier digests differing between arms flags verifier-version-confound', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms({
      baselineVerifierId: 'verifier-learning-0001',
      interventionVerifierId: 'verifier-learning-0002',
    });
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toEqual(['verifier-version-confound']);
    expect(
      result.findings.find((entry) => entry.source === 'verifier-change')?.basis,
    ).toContain('inconclusive unless controlled');
  });

  it('BOTH confounds surface together when both instruments changed', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms({
      baselineEvaluatorRef: DIGEST_A,
      interventionEvaluatorRef: DIGEST_B,
      baselineVerifierId: 'verifier-learning-0001',
      interventionVerifierId: 'verifier-learning-0002',
    });
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toEqual(['evaluator-version-confound', 'verifier-version-confound']);
  });

  it('an evaluator change ALONE (everything else identical) still confounds - a changed evaluator score is not automatically a capability improvement', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms({
      baselineEvaluatorRef: DIGEST_A,
      interventionEvaluatorRef: DIGEST_B,
    });
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toContain('evaluator-version-confound');
    expect(result.basis).toContain('confounds: evaluator-version-confound');
  });

  it('same evaluator and verifier digests across arms ⇒ no confounds', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(result.confounds).toEqual([]);
    expect(result.basis).toContain('no evaluator/verifier version confounds');
  });
});

describe('attribution - sampling/measurement variance', () => {
  it('within-measurement-variance status when variance is reported', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const uncertainty = {
      method: 'analytic-variance',
      entries: [
        { metricId: 'reconciliation-accuracy', baselineVariance: 0.01, interventionVariance: 0.01 },
      ],
    } as unknown as UncertaintyReport;
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention, uncertainty);
    expect(
      result.findings.find((entry) => entry.source === 'sampling-measurement-variance')?.status,
    ).toBe('within-measurement-variance');
  });

  it('not-indicated when no uncertainty is supplied', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(
      result.findings.find((entry) => entry.source === 'sampling-measurement-variance')?.status,
    ).toBe('not-indicated');
  });
});

describe('attribution - property (determinism + closed outputs)', () => {
  it('same inputs ⇒ same attribution result (content equality)', async () => {
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const arms = await makeArms();
    const a = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    const b = attributeExperiment(descriptor, arms.baseline, arms.intervention);
    expect(a).toEqual(b);
  });

  it('random arm variations always produce exactly six findings and closed statuses', async () => {
    const lcg = new TestLcg(0xA020);
    const descriptor = await createExperimentDescriptor(makeExperimentInput());
    const allowedStatuses = [
      'declared-intervention',
      'detected-version-difference',
      'within-measurement-variance',
      'not-indicated',
    ] as const;
    for (let index = 0; index < 12; index += 1) {
      const arms = await makeArms({
        interventionEvaluatorRef: lcg.bool() ? DIGEST_B : DIGEST_A,
        interventionBodyRef: lcg.bool() ? 'd'.repeat(64) : undefined,
      });
      const result = attributeExperiment(descriptor, arms.baseline, arms.intervention);
      expect(result.findings).toHaveLength(6);
      for (const finding of result.findings) {
        expect(allowedStatuses).toContain(finding.status);
        expect(finding.basis.length).toBeGreaterThan(0);
      }
    }
  });
});
