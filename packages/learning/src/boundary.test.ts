/**
 * LearningBoundary tests - the lock rule 6 enforcement: learning is
 * read-only over historical evidence, proposals are NEW content
 * addressed objects, and rewrite attempts are rejected. The proposal
 * fixture is a REAL A019 SkillDraft built through
 * @arena/skill-extraction's own constructors (compatibility by
 * construction, not by resemblance).
 */

import { describe, expect, it } from 'vitest';
import {
  checkLearningBoundary,
  createLearningProposal,
  freezeHistoricalInputs,
  historicalDigestsOfRun,
  isLearningProposal,
  proposeLearningArtifact,
} from './boundary.js';
import {
  buildSkillDraft,
  createExtractionPolicy,
  mineSkillCandidates,
  toValidatedTrajectoryRef,
} from '@arena/skill-extraction';
import type { CorrelationId } from '@arena/protocol-core';
import { LEARNING_ERROR_CODES } from './errors.js';
import {
  CORR_ID,
  T1,
  T7,
  makeEvaluationRecord,
  makeTrajectoryRecord,
  makeVerificationRecord,
} from './test-support.js';

async function makeHistorical() {
  const trajectory = await makeTrajectoryRecord();
  const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
  const verification = await makeVerificationRecord(trajectory.chainHead as string);
  return { trajectory, evaluation, verification };
}

async function makeRealSkillDraft() {
  const trajectory = await makeTrajectoryRecord({
    trajectoryId: 'trajectory-draft-0001',
    runId: 'tenant-a/run-draft-0001',
  });
  const evaluation = await makeEvaluationRecord(trajectory.chainHead as string);
  const verification = await makeVerificationRecord(trajectory.chainHead as string);
  const ref = await toValidatedTrajectoryRef({
    trajectory,
    evaluations: [evaluation],
    verifications: [verification],
  });
  const policy = await createExtractionPolicy({
    policyId: 'policy-learning-boundary',
    version: '1.0.0',
    validation: {
      requiredVerificationOutcome: 'pass',
      minVerificationRecords: 1,
      requireEvaluations: true,
      requiredEvaluationOutcome: 'meets-criteria',
    },
    eligibility: { entryKinds: ['action', 'completion'], requireCompletedOutcome: 'completed' },
    thresholds: { minTrajectories: 1, minOccurrences: 1 },
    taxonomy: {
      targetNode: {
        kind: 'capability',
        id: 'capability-reconciliation',
        version: '1.2.0',
        digest: '6666666666666666666666666666666666666666666666666666666666666666',
      },
    },
  });
  const mining = await mineSkillCandidates([ref], policy, {
    correlationId: CORR_ID as CorrelationId,
    extractedAt: T1,
  });
  const candidate = mining.candidates[0];
  if (candidate === undefined) {
    throw new Error('fixture failed: expected at least one mined candidate');
  }
  return buildSkillDraft(candidate, policy, [ref]);
}

describe('learning boundary - layer 1 (read-only inputs)', () => {
  it('freezes historical inputs and leaves them bit-identical', async () => {
    const { trajectory, evaluation, verification } = await makeHistorical();
    const view = freezeHistoricalInputs({
      trajectories: [trajectory],
      evaluations: [evaluation],
      verifications: [verification],
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(Object.isFrozen(view.trajectories)).toBe(true);
    // The sources are untouched (same object identity, still frozen by their own constructors).
    expect(view.trajectories[0]).toBe(trajectory);
    expect(view.trajectories[0]?.chainHead).toBe(trajectory.chainHead);
    expect(view.evaluations[0]?.digest).toBe(evaluation.digest);
    expect(view.verifications[0]?.digest).toBe(verification.digest);
    // Mutation attempts on the frozen view fail silently (strict-mode freeze).
    expect(() => {
      (view.trajectories as unknown[]).push({});
    }).toThrow();
  });

  it('REJECTS malformed historical input shapes', () => {
    expect(() =>
      freezeHistoricalInputs({
        trajectories: [],
        evaluations: [],
        verifications: [],
      }),
    ).not.toThrow();
    expect(() =>
      freezeHistoricalInputs({ trajectories: null, evaluations: [], verifications: [] } as never),
    ).toThrow(/trajectories must be an array/);
  });
});

describe('learning boundary - layer 2 (proposals are new objects)', () => {
  it('creates a content-addressed proposal with an EXPLICIT surface', async () => {
    const proposal = await createLearningProposal({
      proposalId: 'proposal-skill-0001',
      version: '1.0.0',
      proposedArtifactRef: 'a'.repeat(64),
      changedSurface: 'skills',
      basisExperimentRef: 'b'.repeat(64),
      supersedes: null,
      provenance: { proposedBy: 'arena-learning-test', proposedAt: T7, notes: null },
    });
    expect(proposal.recordVersion).toBe(1);
    expect(proposal.changedSurface).toBe('skills');
    expect(proposal.supersedes).toBeNull();
    expect(proposal.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(isLearningProposal(proposal)).toBe(true);
  });

  it('accepts a REAL A019 SkillDraft as the proposed artifact (bound by digest)', async () => {
    const draft = await makeRealSkillDraft();
    const proposal = await createLearningProposal({
      proposalId: 'proposal-skill-0002',
      version: '1.0.0',
      proposedArtifactRef: draft.digest as string,
      changedSurface: 'skills',
      basisExperimentRef: 'b'.repeat(64),
      supersedes: null,
      provenance: { proposedBy: 'arena-learning-test', proposedAt: T7, notes: null },
    });
    expect(proposal.proposedArtifactRef).toBe(draft.digest);
  });

  it('REJECTS ambiguous/undeclared proposal surfaces', async () => {
    await expect(
      createLearningProposal({
        proposalId: 'proposal-x',
        version: '1.0.0',
        proposedArtifactRef: 'a'.repeat(64),
        changedSurface: 'maybe-skills',
        basisExperimentRef: 'b'.repeat(64),
        supersedes: null,
        provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_PROPOSAL });
  });

  it('REJECTS self-supersession', async () => {
    await expect(
      createLearningProposal({
        proposalId: 'proposal-x',
        version: '1.0.0',
        proposedArtifactRef: 'a'.repeat(64),
        changedSurface: 'skills',
        basisExperimentRef: 'b'.repeat(64),
        supersedes: 'a'.repeat(64),
        provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
      }),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.INVALID_PROPOSAL });
  });

  it('append-only supersession: supersedes names a DIFFERENT prior artifact', async () => {
    const proposal = await createLearningProposal({
      proposalId: 'proposal-skill-0003',
      version: '1.1.0',
      proposedArtifactRef: 'c'.repeat(64),
      changedSurface: 'skills',
      basisExperimentRef: 'b'.repeat(64),
      supersedes: 'd'.repeat(64),
      provenance: { proposedBy: 'arena-learning-test', proposedAt: T7, notes: null },
    });
    expect(proposal.supersedes).toBe('d'.repeat(64));
  });
});

describe('learning boundary - layer 3 (rewrite detection)', () => {
  it('historicalDigestsOfRun covers descriptor + both arms\' records', async () => {
    const descriptorDigest = '1'.repeat(64);
    const baseline = await makeHistorical();
    const intervention = await makeHistorical();
    const historical = historicalDigestsOfRun({
      descriptorRef: descriptorDigest,
      baseline: {
        trajectories: [baseline.trajectory],
        evaluations: [baseline.evaluation],
        verifications: [baseline.verification],
      },
      intervention: {
        trajectories: [intervention.trajectory],
        evaluations: [intervention.evaluation],
        verifications: [intervention.verification],
      },
    });
    expect(historical).toContain(descriptorDigest);
    expect(historical).toContain(baseline.trajectory.chainHead as string);
    expect(historical).toContain(baseline.evaluation.digest as string);
    expect(historical).toContain(baseline.verification.digest as string);
    expect(historical).toContain(intervention.verification.digest as string);
    expect(new Set(historical).size).toBe(historical.length);
  });

  it('REJECTS a proposal whose artifact digest IS a historical digest (rewrite attempt)', async () => {
    const historical = ['1'.repeat(64), '2'.repeat(64)];
    const proposal = await createLearningProposal({
      proposalId: 'proposal-rewrite',
      version: '1.0.0',
      proposedArtifactRef: '1'.repeat(64),
      changedSurface: 'skills',
      basisExperimentRef: '3'.repeat(64),
      supersedes: null,
      provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
    });
    expect(() => checkLearningBoundary(historical, proposal)).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.REWRITE_ATTEMPT }),
    );
  });

  it('REJECTS a proposal that would supersede the experiment record motivating it', async () => {
    const basisExperimentRef = '3'.repeat(64);
    const historical = ['3'.repeat(64)];
    const proposal = await createLearningProposal({
      proposalId: 'proposal-supersede-run',
      version: '1.0.0',
      proposedArtifactRef: 'a'.repeat(64),
      changedSurface: 'skills',
      basisExperimentRef,
      supersedes: basisExperimentRef,
      provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
    });
    expect(() => checkLearningBoundary(historical, proposal)).toThrowError(
      expect.objectContaining({ code: LEARNING_ERROR_CODES.REWRITE_ATTEMPT }),
    );
  });

  it('ACCEPTS a new artifact that collides with nothing historical', async () => {
    const historical = ['1'.repeat(64)];
    const proposal = await proposeLearningArtifact(
      {
        proposalId: 'proposal-ok',
        version: '1.0.0',
        proposedArtifactRef: 'a'.repeat(64),
        changedSurface: 'skills',
        basisExperimentRef: 'b'.repeat(64),
        supersedes: null,
        provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
      },
      historical,
    );
    expect(isLearningProposal(proposal)).toBe(true);
  });

  it('proposeLearningArtifact never yields an object on a rewrite attempt', async () => {
    const historical = ['1'.repeat(64)];
    await expect(
      proposeLearningArtifact(
        {
          proposalId: 'proposal-rewrite-2',
          version: '1.0.0',
          proposedArtifactRef: '1'.repeat(64),
          changedSurface: 'substrate',
          basisExperimentRef: 'b'.repeat(64),
          supersedes: null,
          provenance: { proposedBy: 'x', proposedAt: T7, notes: null },
        },
        historical,
      ),
    ).rejects.toMatchObject({ code: LEARNING_ERROR_CODES.REWRITE_ATTEMPT });
  });
});
