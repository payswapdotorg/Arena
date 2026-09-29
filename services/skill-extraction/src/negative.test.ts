/**
 * Negative/adversarial tests for the fabric (Work Order A019): the R17
 * gate through the service, unknown policies, idempotency conflicts,
 * empty inputs and malformed run keys.
 */

import { describe, expect, it } from 'vitest';
import { createExtractionPolicy, toValidatedTrajectoryRef } from '@arena/skill-extraction';
import { SKILL_EXTRACTION_ERROR_CODES } from '@arena/skill-extraction';
import { ExtractionService } from './fabric.js';
import {
  CORR,
  makeEvaluation,
  makeRef,
  makeTargetNodeAndPolicyInput,
  makeTrajectory,
  makeVerification,
  registerDefaultPolicy,
  RUN_KEY,
  T5,
  T6,
} from './test-support.js';

describe('the R17 gate through the service', () => {
  it('REFUSES extraction when a ref carries no verification evidence (the guard never bypasses)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const trajectory = await makeTrajectory();
    const evaluation = await makeEvaluation(trajectory.chainHead as string);
    const unvalidated = {
      trajectory,
      evaluations: [evaluation],
      verifications: [],
    };
    await expect(
      service.extract(policy.digest, [unvalidated as never], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.UNVALIDATED_TRAJECTORY,
    });
    // Nothing was recorded.
    expect(service.listRuns()).toHaveLength(0);
  });

  it('REFUSES an open trajectory (no completion entry)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const trajectory = await makeTrajectory({ omitCompletion: true });
    const evaluation = await makeEvaluation(trajectory.chainHead as string);
    const verification = await makeVerification(trajectory.chainHead as string, 9001);
    await expect(
      service.extract(
        policy.digest,
        [
          {
            trajectory,
            evaluations: [evaluation],
            verifications: [verification],
          } as never,
        ],
        { runKey: RUN_KEY, correlationId: CORR, startedAt: T5, finishedAt: T6 },
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TRAJECTORY_NOT_COMPLETED,
    });
  });

  it('REFUSES a misbound evaluation record (judges another trajectory)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const trajectory = await makeTrajectory();
    const other = await makeTrajectory({ trajectoryId: 'trajectory-f9999', runId: 'tenant-a/run-f9999' });
    const foreignEvaluation = await makeEvaluation(other.chainHead as string);
    const verification = await makeVerification(trajectory.chainHead as string, 9002);
    await expect(
      service.extract(
        policy.digest,
        [
          {
            trajectory,
            evaluations: [foreignEvaluation],
            verifications: [verification],
          } as never,
        ],
        { runKey: RUN_KEY, correlationId: CORR, startedAt: T5, finishedAt: T6 },
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH,
    });
  });

  it('REFUSES a misbound verification record (evidence addresses another digest)', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const trajectory = await makeTrajectory();
    const evaluation = await makeEvaluation(trajectory.chainHead as string);
    const other = await makeTrajectory({ trajectoryId: 'trajectory-f9998', runId: 'tenant-a/run-f9998' });
    const foreignVerification = await makeVerification(other.chainHead as string, 9003);
    await expect(
      service.extract(
        policy.digest,
        [
          {
            trajectory,
            evaluations: [evaluation],
            verifications: [foreignVerification],
          } as never,
        ],
        { runKey: RUN_KEY, correlationId: CORR, startedAt: T5, finishedAt: T6 },
      ),
    ).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH,
    });
  });
});

describe('fabric-level negatives', () => {
  it('REFUSES an unknown policy digest (NOT_FOUND)', async () => {
    const service = new ExtractionService();
    const ref = await makeRef();
    await expect(
      service.extract('1111111111111111111111111111111111111111111111111111111111111111', [ref], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.NOT_FOUND });
  });

  it('REFUSES empty ref lists', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    await expect(
      service.extract(policy.digest, [], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_REF });
  });

  it('REFUSES malformed run keys', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    await expect(
      service.extract(policy.digest, [ref], {
        runKey: 'bad key with spaces!',
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD });
  });

  it('same run key + different policy is a conflict (not a rerun)', async () => {
    const service = new ExtractionService();
    const { input } = await makeTargetNodeAndPolicyInput();
    const policyA = await service.registerPolicy(await createExtractionPolicy(input));
    const policyB = await service.registerPolicy(
      await createExtractionPolicy({ ...input, policyId: 'policy-fabric-extraction-0002' }),
    );
    const ref = await makeRef();
    await service.extract(policyA.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    await expect(
      service.extract(policyB.digest, [ref], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });

  it('a tampered ref (rebuilt with an extra verification) is a DIFFERENT command under the same key', async () => {
    const service = new ExtractionService();
    const policy = await registerDefaultPolicy(service);
    const ref = await makeRef();
    await service.extract(policy.digest, [ref], {
      runKey: RUN_KEY,
      correlationId: CORR,
      startedAt: T5,
      finishedAt: T6,
    });
    const extended = await toValidatedTrajectoryRef({
      trajectory: ref.trajectory,
      evaluations: [...ref.evaluations],
      verifications: [...ref.verifications, await makeVerification(ref.trajectory.chainHead as string, 9004)],
    });
    expect(extended.digest).not.toBe(ref.digest);
    await expect(
      service.extract(policy.digest, [extended], {
        runKey: RUN_KEY,
        correlationId: CORR,
        startedAt: T5,
        finishedAt: T6,
      }),
    ).rejects.toMatchObject({ code: SKILL_EXTRACTION_ERROR_CODES.IDEMPOTENCY_CONFLICT });
  });
});
