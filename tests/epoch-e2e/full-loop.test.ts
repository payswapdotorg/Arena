/**
 * The A027 E2E battery — POSITIVE full-loop runs: assert the typed
 * artifacts at every stage of the capability-gap learning loop, driven
 * through the example walkthrough (the real reference fabrics).
 */

import { describe, expect, it } from 'vitest';
import {
  runEpochCapabilityGapLoop,
  receiptDigests,
  SCENARIO,
} from '@arena/example-epoch-e2e';
import { EPOCH_OUTPUT_REF_KINDS } from '@arena/epoch-adapter';

describe('A027 epoch E2E battery: the positive full loop', () => {
  it('produces a typed artifact at every stage of the loop', async () => {
    const receipt = await runEpochCapabilityGapLoop();

    // Gap input → typed translation → job envelope.
    expect(receipt.command.kind).toBe('command');
    expect(receipt.command.schema).toContain('run-capability-development-command');
    expect((receipt.command.payload as { requestId?: string }).requestId)
      .toBe(SCENARIO.requestId);
    expect(receipt.job.status).toBe('running');
    expect(receipt.job.targetReleaseChannel).toBe('candidate');

    // CapabilityCase: provisioned from the seed, submitted and triaged.
    expect(receipt.caseRecord.status).toBe('triaged');
    expect(receipt.caseRecord.source.type).toBe('service');
    expect(receipt.caseRecord.lifecycle.length).toBeGreaterThanOrEqual(3);

    // TaskSpec: compiled from the triaged case via the real policy.
    expect(receipt.taskSpec.identity.taskId.startsWith(SCENARIO.taskIdPrefix)).toBe(true);
    expect(receipt.taskSpec.derivedFrom.caseRef.digest).toBe(receipt.caseRecord.digest);

    // Environment + run: admitted, completed, content-addressed.
    expect(receipt.runResult.finalState).toBe('completed');
    expect(receipt.runResult.runAddress.taskVersion.taskId)
      .toBe(receipt.taskSpec.identity.taskId);

    // Trajectories: the baseline gap and the intervention repair.
    expect(receipt.baselineTrajectory.chainHead).not.toBe(receipt.trajectory.chainHead);

    // Evaluation: meets (intervention) vs below (baseline gap), same
    // evaluator version on both arms (the no-confound discipline).
    expect(receipt.evaluationRecord.aggregate.outcome).toBe('meets-criteria');
    expect(receipt.baselineEvaluation.aggregate.outcome).toBe('below-criteria');
    expect(receipt.baselineEvaluation.evaluatorRef).toBe(receipt.evaluationRecord.evaluatorRef);

    // Verification: pass (repair) vs fail (gap), both arms verified.
    expect(receipt.verificationRecord.outcome).toBe('pass');
    expect(receipt.baselineVerification.outcome).toBe('fail');

    // Skill extraction: a REAL A004 skill draft from the repair.
    expect(receipt.skillDraft.skillNode.kind).toBe('skill');
    expect(receipt.extractionRun.drafts).toContain(receipt.skillDraft.digest);

    // Learning attribution: the capability lift is demonstrated, with
    // zero confounds and all five Q1.0 conditions satisfied.
    expect(receipt.learningRun.verdict.verdict).toBe('lift-demonstrated');
    expect(receipt.learningRun.attribution.confounds).toHaveLength(0);
    expect(Object.values(receipt.learningRun.verdict.conditions).every(Boolean)).toBe(true);

    // Certification: satisfied, CANDIDATE grant, cited in the response.
    expect(receipt.certificationRecord.verdict).toBe('satisfied');
    expect(receipt.certificationRecord.grantedLevel).toBe('CANDIDATE');

    // The typed EPOCH response: case + 9 output refs, all in the
    // EPI1.0 closed vocabulary, terminal job, sorted-unique digests.
    expect(receipt.completedJob.status).toBe('succeeded');
    expect(receipt.completedJob.outputs.length).toBe(10);
    for (const ref of receipt.completedJob.outputs) {
      expect((EPOCH_OUTPUT_REF_KINDS as readonly string[]).includes(ref.kind)).toBe(true);
    }
    expect([...receipt.completedJob.artifactDigests].sort())
      .toEqual(receipt.completedJob.artifactDigests);
    expect(new Set(receipt.completedJob.artifactDigests).size)
      .toBe(receipt.completedJob.artifactDigests.length);

    // The A025 read surface resolved the certification output ref.
    expect(receipt.resolvedCertification).not.toBeNull();
    const resolved = receipt.resolvedCertification as { digest?: string };
    expect(resolved.digest).toBe(receipt.certificationRecord.digest);
  });

  it('emits the job-completed event only after the terminal state', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const event = receipt.adapter.jobCompletedEvent(receipt.completedJob.jobId);
    expect(event.kind).toBe('event');
    expect(event.schema).toContain('job-completed');
  });
});

describe('A027 epoch E2E battery: the regression pin', () => {
  it('pins the loop: two runs produce byte-identical typed outputs', async () => {
    const first = receiptDigests(await runEpochCapabilityGapLoop());
    const second = receiptDigests(await runEpochCapabilityGapLoop());
    expect(second).toEqual(first);
  });

  it('pins the response shape: the exact EPI1.0 kind multiset', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const kinds = receipt.completedJob.outputs.map((ref) => ref.kind).sort();
    expect(kinds).toEqual([
      'agent-body-version',
      'capability-case',
      'certification',
      'compatibility-report',
      'environment',
      'evaluator',
      'skill-artifact',
      'task-spec',
      'trajectory-set',
      'verifier',
    ]);
  });
});
