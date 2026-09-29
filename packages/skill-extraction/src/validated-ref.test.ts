/**
 * ValidatedTrajectoryRef tests (Work Order A019; requirement R17 — the
 * 'validated' gate): positive bindings of REAL A011/A012/A013 records,
 * and the negative/adversarial proofs that unvalidated, misbound or
 * still-open trajectories are REFUSED as extraction inputs.
 */

import { describe, expect, it } from 'vitest';
import { isTrajectoryCompleted } from '@arena/trajectory';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import {
  isValidatedTrajectoryRef,
  isValidatedTrajectoryRefView,
  toValidatedTrajectoryRef,
  validatedTrajectoryRefKey,
  validatedTrajectoryRefView,
  verificationReferencesTrajectory,
} from './validated-ref.js';
import {
  DIGEST_A,
  makeEvaluationRecord,
  makeTrajectoryRecord,
  makeValidatedRef,
  makeVerificationRecord,
} from './test-support.js';

describe('ValidatedTrajectoryRef — positive bindings', () => {
  it('binds a REAL completed trajectory with its REAL evaluation and verification records', async () => {
    const ref = await makeValidatedRef();
    expect(isValidatedTrajectoryRefView(ref)).toBe(true);
    expect(isValidatedTrajectoryRef(ref)).toBe(true);
    expect(isTrajectoryCompleted(ref.trajectory)).toBe(true);
    expect(ref.evaluations).toHaveLength(1);
    expect(ref.verifications.length).toBeGreaterThanOrEqual(1);
    expect(ref.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the ref digest is content-addressed: same bundle ⇒ same digest; different evidence ⇒ different digest', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const verificationA = await makeVerificationRecord(trajectory.chainHead as string);
    const verificationB = await makeVerificationRecord(trajectory.chainHead as string);
    const refA = await toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [verificationA],
    });
    const refB = await toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [verificationA],
    });
    const refC = await toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [verificationA, verificationB],
    });
    expect(refA.digest).toBe(refB.digest);
    expect(refC.digest).not.toBe(refA.digest);
  });

  it('exposes a stable key (the trajectory chain head) and a digest-free view', async () => {
    const ref = await makeValidatedRef();
    expect(validatedTrajectoryRefKey(ref)).toBe(ref.trajectory.chainHead as string);
    const view = validatedTrajectoryRefView(ref);
    expect(view.recordVersion).toBe(1);
    expect(view.trajectory.chainHead).toBe(ref.trajectory.chainHead);
  });

  it('verificationReferencesTrajectory matches the evidence-bundle binding', async () => {
    const trajectory = await makeTrajectoryRecord();
    const referencing = await makeVerificationRecord(trajectory.chainHead as string);
    const other = await makeVerificationRecord(trajectory.chainHead as string, {
      evidenceDigest: DIGEST_A,
    });
    expect((other.evidence[0]?.artifact.digest as string) === (trajectory.chainHead as string)).toBe(false);
    expect(verificationReferencesTrajectory(referencing, trajectory.chainHead as string)).toBe(true);
    expect(verificationReferencesTrajectory(other, trajectory.chainHead as string)).toBe(false);
  });
});

describe('ValidatedTrajectoryRef — the R17 validated gate (negatives)', () => {
  it('REFUSES a trajectory without verification evidence (UNVALIDATED_TRAJECTORY)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.UNVALIDATED_TRAJECTORY,
    });
  });

  it('REFUSES a still-open trajectory (no completion entry — TRAJECTORY_NOT_COMPLETED)', async () => {
    const trajectory = await makeTrajectoryRecord({ omitCompletion: true });
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const verification = await makeVerificationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [verification],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.TRAJECTORY_NOT_COMPLETED,
    });
  });

  it('REFUSES an evaluation record judging a DIFFERENT trajectory (EVIDENCE_MISMATCH)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const foreign = await makeTrajectoryRecord({ trajectoryId: 'trajectory-0002', runId: 'tenant-a/run-0002' });
    const foreignEvaluation = await makeEvaluationRecord(foreign.chainHead as string);
    const verification = await makeVerificationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [foreignEvaluation],
      verifications: [verification],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH,
    });
  });

  it('REFUSES a verification record that does not reference the trajectory (EVIDENCE_MISMATCH)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const foreignVerification = await makeVerificationRecord(trajectory.chainHead as string, {
      evidenceDigest: DIGEST_A,
    });
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [foreignVerification],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.EVIDENCE_MISMATCH,
    });
  });

  it('REFUSES a structurally invalid trajectory (REAL A011 guard — INVALID_REF)', async () => {
    const evaluation = await makeEvaluationRecord(DIGEST_A);
    const verification = await makeVerificationRecord(DIGEST_A);
    const attempt = toValidatedTrajectoryRef({
      trajectory: { header: 'not-a-header' } as never,
      evaluations: [evaluation],
      verifications: [verification],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_REF,
    });
  });

  it('REFUSES a structurally invalid evaluation record (REAL A012 guard — INVALID_REF)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const verification = await makeVerificationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [{ not: 'an-evaluation-record' } as never],
      verifications: [verification],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_REF,
    });
  });

  it('REFUSES a structurally invalid verification record (REAL A013 guard — INVALID_REF)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [{ not: 'a-verification-record' } as never],
    });
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_REF,
    });
  });

  it('REFUSES unknown bundle fields (strict shape)', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    const verification = await makeVerificationRecord(trajectory.chainHead as string);
    const attempt = toValidatedTrajectoryRef({
      trajectory,
      evaluations: [evaluation],
      verifications: [verification],
      rogue: 'field',
    } as never);
    await expect(attempt).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_REF,
    });
  });

  it('every failure is a typed SkillExtractionError with a closed code', async () => {
    const trajectory = await makeTrajectoryRecord();
    const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
    try {
      await toValidatedTrajectoryRef({ trajectory, evaluations: [evaluation], verifications: [] });
      expect.unreachable('must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(SkillExtractionError);
      const typed = error as SkillExtractionError;
      expect(typed.category).toBe('validation');
      expect(typed.message).toContain('R17');
    }
  });
});
