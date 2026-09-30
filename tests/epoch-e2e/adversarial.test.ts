/**
 * The A027 E2E battery — ADVERSARIAL cases: gap input validation
 * failures, fabric ref mismatches, attribution confounds (the A020
 * discipline), and certification/release-gate rejections.
 */

import { describe, expect, it } from 'vitest';
import { runEpochCapabilityGapLoop, SCENARIO } from '@arena/example-epoch-e2e';
import {
  toCapabilityDevelopmentRequest,
  toEpochOutputRef,
} from '@arena/epoch-adapter';
import { createEvaluationRecord, createEvaluationCriteria } from '@arena/evaluation';
import { EvaluationFabric } from '@arena/evaluation-fabric';
import { toValidatedTrajectoryRef } from '@arena/skill-extraction';
import { ExperimentEngine } from '@arena/learning-fabric';
import { createCertificationFabric } from '@arena/certification-fabric';
import { makeGapEvaluator } from '@arena/example-epoch-e2e';

describe('A027 adversarial: gap input validation failures (fail-closed)', () => {
  it('rejects unknown top-level fields on the EPI1.0 request', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const tampered = {
      ...(receipt.epochRequest as Record<string, unknown>),
      surpriseField: 'not-in-the-contract',
    };
    expect(() => toCapabilityDevelopmentRequest(tampered)).toThrow('INVALID_REQUEST');
  });

  it('rejects non-hex digests in the case seed evidence', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const seed = raw.caseSeed as Record<string, unknown>;
    const tampered = {
      ...raw,
      caseSeed: {
        ...seed,
        evidence: [
          { digest: 'not-a-sha256-digest', description: 'forged evidence' },
        ],
      },
    };
    expect(() => toCapabilityDevelopmentRequest(tampered)).toThrow('INVALID_REQUEST');
  });

  it('rejects missing idempotency keys', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const { idempotencyKey: _removed, ...rest } = receipt.epochRequest as Record<string, unknown>;
    expect(() => toCapabilityDevelopmentRequest(rest)).toThrow();
  });

  it('rejects cross-tenant authorization metadata (adapter gate)', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const authorization = raw.authorization as Record<string, unknown>;
    const tampered = {
      ...raw,
      authorization: { ...authorization, tenant: 'some-other-tenant' },
    };
    await expect(
      receipt.adapter.submitCapabilityDevelopmentRequest(tampered),
    ).rejects.toThrow('CROSS_TENANT');
  });
});

describe('A027 adversarial: idempotency and job-envelope discipline', () => {
  it('rejects rebinding an idempotency key to different content', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const seed = raw.caseSeed as Record<string, unknown>;
    const different = {
      ...raw,
      caseSeed: { ...seed, problemStatement: 'a different problem entirely' },
    };
    await expect(
      receipt.adapter.submitCapabilityDevelopmentRequest(different),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
  });

  it('rejects completion refs that duplicate the job case ref', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const fresh = await receipt.adapter.submitCapabilityDevelopmentRequest({
      ...raw,
      idempotencyKey: 'epoch-gap-key-0002',
    });
    const job = receipt.adapter.startJob(fresh.job.jobId);
    expect(() =>
      receipt.adapter.completeJob(job.jobId, { refs: [job.caseRef!] }),
    ).toThrow('INVALID_REF');
  });

  it('rejects cross-kind digest collisions in the response refs', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const fresh = await receipt.adapter.submitCapabilityDevelopmentRequest({
      ...raw,
      idempotencyKey: 'epoch-gap-key-0003',
    });
    const job = receipt.adapter.startJob(fresh.job.jobId);
    const digest = receipt.taskSpec.digest;
    const colliding = [
      toEpochOutputRef({
        refVersion: 1,
        kind: 'task-spec',
        digest,
        address: `arena:task-spec/x@1.0.0#${digest}`,
      }),
      toEpochOutputRef({
        refVersion: 1,
        kind: 'environment',
        digest,
        address: `arena:environment/x/y@1.0.0#${digest}`,
      }),
    ];
    expect(() =>
      receipt.adapter.completeJob(job.jobId, { refs: colliding }),
    ).toThrow('INVALID_REF');
  });

  it('rejects terminal jobs from being completed again', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    expect(() =>
      receipt.adapter.completeJob(receipt.completedJob.jobId, { refs: receipt.outputRefs }),
    ).toThrow('JOB_TERMINAL');
  });
});

describe('A027 adversarial: fabric ref mismatches (the mid-loop gates)', () => {
  it('rejects an evaluator run against a trajectory the descriptor does not bind', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const fabric = new EvaluationFabric();
    fabric.registry.registerCriteria(receipt.criteria);
    fabric.registry.registerEvaluator(receipt.evaluator, makeGapEvaluator());
    // The descriptor binds the INTERVENTION trajectory; the baseline
    // trajectory is a different chain head → the input contract fires.
    await expect(
      fabric.evaluate(
        receipt.evaluator.digest,
        receipt.caseRecord,
        receipt.baselineTrajectory,
        { seed: SCENARIO.seed },
      ),
    ).rejects.toThrow();
  });

  it('rejects skill extraction when the verification does not cite the trajectory', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    // The baseline trajectory verification cites the BASELINE chain
    // head — it does not verify the intervention trajectory.
    await expect(
      toValidatedTrajectoryRef({
        trajectory: receipt.trajectory,
        evaluations: [receipt.evaluationRecord],
        verifications: [receipt.baselineTrajectoryVerification],
      }),
    ).rejects.toThrow();
  });
});

describe('A027 adversarial: attribution confounds (A020 discipline)', () => {
  it('an evaluator-version change between arms forces inconclusive-unless-controlled', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    // A DIFFERENT evaluator version judged the baseline arm: forge the
    // baseline evaluation with a second evaluator digest.
    const confoundedCriteria = await createEvaluationCriteria({
      criteriaId: `${SCENARIO.criteriaId}-confound`,
      version: '1.0.0',
      entries: [
        { criterionId: 'criterion-tests-green', weight: 3, description: 'green', targetRef: receipt.caseRecord.digest },
        { criterionId: 'criterion-reproduction-shown', weight: 1, description: 'repro', targetRef: receipt.baselineTrajectory.chainHead },
        { criterionId: 'criterion-no-prohibited-shortcuts', weight: 2, description: 'no shortcuts', targetRef: receipt.baselineTrajectory.chainHead },
      ],
      aggregation: 'weighted-sum',
      thresholds: { passAt: 0.75 },
    });
    const confoundedBaseline = await createEvaluationRecord(
      {
        evaluatorRef: receipt.trajectoryVerifier.digest, // a DIFFERENT evaluator version
        caseRef: receipt.caseRecord.digest,
        trajectoryRef: receipt.baselineTrajectory.chainHead,
        criteriaRef: confoundedCriteria.digest,
        seed: SCENARIO.seed,
        verdicts: [
          { criterionId: 'criterion-tests-green', score: 0, judgment: 'not green', notes: null },
          { criterionId: 'criterion-reproduction-shown', score: 1, judgment: 'repro', notes: null },
          { criterionId: 'criterion-no-prohibited-shortcuts', score: 0, judgment: 'failed', notes: null },
        ],
        confidence: 0.9,
        limitations: null,
        startedAt: SCENARIO.t1,
        finishedAt: SCENARIO.t1,
        provenance: { executedBy: 'other-evaluator', recordedAt: SCENARIO.t1, notes: null },
      },
      confoundedCriteria,
    );
    const engine = new ExperimentEngine();
    await engine.registerExperiment(receipt.experiment);
    const run = await engine.run(
      receipt.experiment.digest,
      {
        baseline: {
          trajectories: [receipt.baselineTrajectory],
          evaluations: [confoundedBaseline],
          verifications: [receipt.baselineTrajectoryVerification],
          metrics: [{ metricId: 'gap-resolution-score', value: 0.17, variance: 0.01 }],
          protectedMetrics: [
            { capabilityRef: receipt.experiment.protectedCapabilities[0]!.ref.digest, value: 0.9 },
          ],
        },
        intervention: {
          trajectories: [receipt.trajectory],
          evaluations: [receipt.evaluationRecord],
          verifications: [receipt.trajectoryVerification],
          metrics: [{ metricId: 'gap-resolution-score', value: 1, variance: 0.01 }],
          protectedMetrics: [
            { capabilityRef: receipt.experiment.protectedCapabilities[0]!.ref.digest, value: 0.95 },
          ],
        },
      },
      {
        experimentKey: 'exp-key-gap-confound-0001',
        correlationId: 'corr-gap-confound',
        recordedAt: SCENARIO.t10,
      },
    );
    expect(run.attribution.confounds).toContain('evaluator-version-confound');
    expect(run.verdict.verdict).toBe('inconclusive-unless-controlled');
    expect(run.verdict.conditions.evaluatorVersionChangesAccounted).toBe(false);
  });
});

describe('A027 adversarial: certification and release-admission gates', () => {
  it('the candidate channel rejects a response without a certification ref', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const raw = receipt.epochRequest as Record<string, unknown>;
    const fresh = await receipt.adapter.submitCapabilityDevelopmentRequest({
      ...raw,
      idempotencyKey: 'epoch-gap-key-0004',
    });
    const job = receipt.adapter.startJob(fresh.job.jobId);
    const digest = receipt.taskSpec.digest;
    expect(() =>
      receipt.adapter.completeJob(job.jobId, {
        refs: [
          toEpochOutputRef({
            refVersion: 1,
            kind: 'task-spec',
            digest,
            address: `arena:task-spec/x@1.0.0#${digest}`,
          }),
        ],
      }),
    ).toThrow('UNRESOLVED_ARTIFACT');
  });

  it('certification fails closed on gap evidence (not-satisfied, no grant)', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const fabric = createCertificationFabric();
    fabric.registry.registerSuite(receipt.suite);
    // The BASELINE (gap) evidence: a failing verification and a
    // below-criteria evaluation.
    fabric.putVerificationRecord(receipt.baselineVerification);
    fabric.putEvaluationRecord(receipt.baselineEvaluation);
    fabric.putCompatibilityRecord(receipt.compatibilityRecord);
    const record = await fabric.certify(
      receipt.suite.digest,
      receipt.subject,
      [
        receipt.baselineVerification.digest,
        receipt.baselineEvaluation.digest,
        receipt.compatibilityRecord.recordDigest,
      ],
      {
        correlationId: 'corr-gap-cert-reject',
        idempotencyKey: 'idem-gap-cert-reject',
        startedAt: SCENARIO.t10,
        finishedAt: SCENARIO.t11,
        provenanceNotes: 'A027 adversarial: the gap evidence must not certify',
      },
    );
    expect(record.verdict).toBe('not-satisfied');
  });
});
