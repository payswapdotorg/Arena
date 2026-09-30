/**
 * The A027 walkthrough tests: assert the typed artifacts at EVERY
 * stage of the capability-gap learning loop.
 */

import { describe, expect, it } from 'vitest';
import { runEpochCapabilityGapLoop, receiptDigests } from './walkthrough.js';
import { SCENARIO } from './fixtures.js';
import { EPOCH_OUTPUT_REF_KINDS } from '@arena/epoch-adapter';

describe('the epoch capability-gap walkthrough', () => {
  it('walks the full loop and produces the typed receipt', async () => {
    const receipt = await runEpochCapabilityGapLoop();

    // Stage 2: the A026 adapter translated the gap request.
    expect(receipt.command.kind).toBe('command');
    expect(receipt.command.schema).toContain('run-capability-development-command');
    expect(receipt.job.status).toBe('running');
    expect(receipt.job.targetReleaseChannel).toBe('candidate');
    expect(receipt.job.submission.idempotencyKey).toBe('epoch-gap-key-0001');
    expect(receipt.job.causationId).toBe('cause-gap-epoch-0001');

    // Stage 3: the case is provisioned and triaged (compilable).
    expect(receipt.caseRecord.status).toBe('triaged');
    expect(receipt.caseRecord.identity.caseId).toBe(SCENARIO.requestId);
    expect(receipt.caseRecord.targetCapability.id).toBe('test-repair');

    // Stage 4: the TaskSpec compiled from the case.
    expect(receipt.taskSpec.derivedFrom.caseRef.caseId).toBe(SCENARIO.requestId);
    expect(receipt.compilationRecord.emittedSpecs.length).toBeGreaterThan(0);

    // Stage 5: the environment run completed.
    expect(receipt.runResult.finalState).toBe('completed');
    expect(receipt.runState.status).toBe('completed');

    // Stage 6: both trajectories are content-addressed and distinct.
    expect(receipt.trajectory.chainHead).not.toBe(receipt.baselineTrajectory.chainHead);
    expect(receipt.trajectory.entries.length).toBe(6);
    expect(receipt.baselineTrajectory.entries.length).toBe(3);

    // Stage 7: evaluation — the gap is below, the repair meets.
    expect(receipt.evaluationRecord.aggregate.outcome).toBe('meets-criteria');
    expect(receipt.baselineEvaluation.aggregate.outcome).toBe('below-criteria');
    // The SAME evaluator version judged both arms (no confound).
    expect(receipt.baselineEvaluation.evaluatorRef).toBe(receipt.evaluationRecord.evaluatorRef);

    // Stage 8: verification — the gap fails closed, the repair passes.
    expect(receipt.verificationRecord.outcome).toBe('pass');
    expect(receipt.baselineVerification.outcome).toBe('fail');
    expect(receipt.trajectoryVerification.outcome).toBe('pass');
    expect(receipt.baselineTrajectoryVerification.outcome).toBe('fail');

    // Stage 9: skill extraction emitted a REAL A004 draft.
    expect(receipt.extractionRun.drafts.length).toBeGreaterThan(0);
    expect(receipt.skillDraft.skillNode.kind).toBe('skill');
    expect(receipt.skillDraft.skillNode.id.startsWith('skill-')).toBe(true);

    // Stage 10: learning attribution — the lift is demonstrated.
    expect(receipt.learningRun.verdict.verdict).toBe('lift-demonstrated');
    expect(receipt.learningRun.verdict.conditions.evaluatorVersionChangesAccounted).toBe(true);
    expect(receipt.learningRun.attribution.confounds).toHaveLength(0);

    // Stage 11: certification — the candidate-channel grant.
    expect(receipt.certificationRecord.verdict).toBe('satisfied');
    expect(receipt.compatibilityRecord.verdict).toBe('compatible');

    // Stage 12: the typed EPOCH response.
    expect(receipt.completedJob.status).toBe('succeeded');
    expect(receipt.completedJob.outputs[0]!.kind).toBe('capability-case');
    const kinds = new Set(receipt.completedJob.outputs.map((ref) => ref.kind));
    for (const kind of ['task-spec', 'environment', 'trajectory-set', 'evaluator', 'verifier',
      'skill-artifact', 'agent-body-version', 'compatibility-report', 'certification']) {
      expect(kinds.has(kind as (typeof EPOCH_OUTPUT_REF_KINDS)[number])).toBe(true);
    }
    // Artifact digests: sorted, unique, cover every output.
    expect(new Set(receipt.completedJob.artifactDigests).size)
      .toBe(receipt.completedJob.artifactDigests.length);
    // The A025 read-back resolved the certification.
    expect(receipt.resolvedCertification).not.toBeNull();
  });

  it('is byte-deterministic: two runs produce identical digests', async () => {
    const first = receiptDigests(await runEpochCapabilityGapLoop());
    const second = receiptDigests(await runEpochCapabilityGapLoop());
    expect(second).toEqual(first);
  });

  it('replays an idempotent submission without re-execution', async () => {
    const receipt = await runEpochCapabilityGapLoop();
    const replay = await receipt.adapter.submitCapabilityDevelopmentRequest(receipt.epochRequest);
    expect(replay.replayed).toBe(true);
    expect(replay.command).toBeNull();
    expect(replay.caseRecord.digest).toBe(receipt.provisionedCase.digest);
    expect(replay.job.jobId).toBe(receipt.job.jobId);
  });
});
