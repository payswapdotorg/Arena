/**
 * SkillCandidate + mining-core tests (Work Order A019; requirement
 * R17): positive mining from validated trajectories, deterministic
 * candidate packaging, the recorded accept/reject decisions with closed
 * reason codes, and the negative/adversarial proofs (unvalidated
 * evidence refused at the gate, thresholds, outcome gates, determinism).
 */

import { describe, expect, it } from 'vitest';
import { SKILL_EXTRACTION_ERROR_CODES } from './errors.js';
import {
  candidateIdFromSignature,
  createSkillCandidate,
  EXTRACTION_IMPLEMENTATION_VERSION,
  isSkillCandidate,
  mineSkillCandidates,
  signatureKey,
} from './candidate.js';
import type { MiningContext, SkillPatternSignature } from './candidate.js';
import { createExtractionPolicy } from './policy.js';
import {
  CORR_ID,
  DIGEST_A,
  makePolicyInput,
  makeValidatedRef,
  TestLcg,
  T7,
} from './test-support.js';
import type { CorrelationId } from '@arena/protocol-core';

const CONTEXT: MiningContext = {
  correlationId: CORR_ID as CorrelationId,
  extractedAt: T7,
};

describe('mining core — positive', () => {
  it('mines a candidate from one validated trajectory with the default policy', async () => {
    const ref = await makeValidatedRef();
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
    expect(isSkillCandidate(candidate)).toBe(true);
    expect(candidate.signature.outcome).toBe('completed');
    expect(candidate.signature.actionIds).toHaveLength(3);
    expect(candidate.evidence.trajectories).toContain(ref.trajectory.chainHead as string);
    expect(candidate.evidence.evaluations).toHaveLength(1);
    expect(candidate.evidence.verifications).toHaveLength(1);
    expect(candidate.provenance.extractorVersion).toBe(EXTRACTION_IMPLEMENTATION_VERSION);
    expect(candidate.provenance.policyDigest).toBe(policy.digest);
    expect(candidate.taxonomy.targetNode.digest).toBe(policy.taxonomy.targetNode.digest);
    expect(candidate.proposedSkill.id).toBe(candidate.candidateId);
    expect(candidate.inputs.map((port) => port.name)).toEqual([
      'fetch-ledger',
      'reconcile-entries',
      'emit-report',
    ]);
    expect(candidate.outputs.map((port) => port.name)).toEqual(['completion-outcome']);
    expect(candidate.prerequisites).toEqual([]);
    expect(candidate.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('groups a shared signature across trajectories and unions the evidence sets', async () => {
    const actionIds = ['plan-review', 'apply-fix', 'run-tests'];
    const refA = await makeValidatedRef({
      trajectoryId: 'trajectory-0101',
      runId: 'tenant-a/run-0101',
      actionIds,
    });
    const refB = await makeValidatedRef({
      trajectoryId: 'trajectory-0102',
      runId: 'tenant-a/run-0102',
      actionIds,
    });
    const policy = await createExtractionPolicy(makePolicyInput({ minTrajectories: 2 }));
    const result = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
    expect(candidate.evidence.trajectories).toHaveLength(2);
    expect(candidate.evidence.evaluations).toHaveLength(2);
    expect(candidate.evidence.verifications).toHaveLength(2);
    const decisions = result.patternDecisions.filter((d) => d.accepted);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.distinctTrajectories).toBe(2);
    expect(decisions[0]?.occurrences).toBe(2);
  });

  it('mines DIFFERENT signatures as DIFFERENT candidates with different ids', async () => {
    const refA = await makeValidatedRef({
      trajectoryId: 'trajectory-0201',
      runId: 'tenant-a/run-0201',
      actionIds: ['alpha', 'beta'],
    });
    const refB = await makeValidatedRef({
      trajectoryId: 'trajectory-0202',
      runId: 'tenant-a/run-0202',
      actionIds: ['gamma', 'delta'],
    });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    expect(result.candidates).toHaveLength(2);
    const [first, second] = result.candidates as readonly [NonNullable<typeof result.candidates[0]>, NonNullable<typeof result.candidates[0]>];
    expect(first.candidateId).not.toBe(second.candidateId);
    expect(first.digest).not.toBe(second.digest);
    // Candidates are returned in deterministic (id-sorted) order.
    expect((first.candidateId as string) < (second.candidateId as string)).toBe(true);
  });

  it('records an accepted decision for every mined trajectory', async () => {
    const ref = await makeValidatedRef();
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.trajectoryDecisions).toHaveLength(1);
    expect(result.trajectoryDecisions[0]?.accepted).toBe(true);
    expect(result.trajectoryDecisions[0]?.reason).toBe('accepted');
    expect(result.trajectoryDecisions[0]?.signature).toBe(
      signatureKey((result.candidates[0] as NonNullable<typeof result.candidates[0]>).signature),
    );
  });
});

describe('mining core — validation-gate negatives (recorded reasons)', () => {
  it('records verification-outcome-not-met when no verification has the required outcome', async () => {
    const ref = await makeValidatedRef({
      verificationOverrides: { mode: 'fail' },
    });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.trajectoryDecisions[0]?.reason).toBe('verification-outcome-not-met');
    expect(result.trajectoryDecisions[0]?.accepted).toBe(false);
  });

  it('records insufficient-verification-evidence below the policy minimum', async () => {
    const trajectory = (await makeValidatedRef()).trajectory;
    const ref = await makeValidatedRef({
      trajectoryId: trajectory.header.trajectoryId,
      runId: 'tenant-a/run-0301',
    });
    const policy = await createExtractionPolicy(makePolicyInput({ minVerificationRecords: 2 }));
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.trajectoryDecisions[0]?.reason).toBe('insufficient-verification-evidence');
  });

  it('records missing-evaluation-evidence when the policy requires evaluations', async () => {
    const ref = await makeValidatedRef();
    const policy = await createExtractionPolicy(makePolicyInput());
    const stripped = { ...ref, evaluations: Object.freeze([]) } as typeof ref;
    const result = await mineSkillCandidates([stripped], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.trajectoryDecisions[0]?.reason).toBe('missing-evaluation-evidence');
  });

  it('records evaluation-outcome-not-met when the judgment gate fails', async () => {
    const ref = await makeValidatedRef({ evaluationOverrides: { meetsCriteria: false } });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.trajectoryDecisions[0]?.reason).toBe('evaluation-outcome-not-met');
  });

  it('records outcome-not-completed for failed / timed-out completions under the default policy', async () => {
    for (const outcome of ['failed', 'timed-out'] as const) {
      const ref = await makeValidatedRef({ outcome });
      const policy = await createExtractionPolicy(makePolicyInput());
      const result = await mineSkillCandidates([ref], policy, CONTEXT);
      expect(result.candidates).toHaveLength(0);
      expect(result.trajectoryDecisions[0]?.reason).toBe('outcome-not-completed');
    }
  });

  it('mines failed trajectories when the policy explicitly accepts that outcome', async () => {
    const ref = await makeValidatedRef({ outcome: 'failed' });
    const policy = await createExtractionPolicy(
      makePolicyInput({ requireCompletedOutcome: 'failed' }),
    );
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(1);
  });

  it('records no-eligible-entries when the trajectory has no actions in the eligible kinds', async () => {
    const ref = await makeValidatedRef({ actionIds: [], withObservation: true });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.trajectoryDecisions[0]?.reason).toBe('no-eligible-entries');
  });

  it('observations are NOT eligible under the default policy (only actions + completions are read)', async () => {
    const ref = await makeValidatedRef({ withObservation: true });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
    // The observation ids never leak into the mined signature.
    expect(candidate.signature.actionIds.every((id) => !String(id).startsWith('obs-'))).toBe(true);
  });

  it('records pattern-below-threshold when a signature does not span enough trajectories', async () => {
    const actionIds = ['shared-a', 'shared-b'];
    const refA = await makeValidatedRef({
      trajectoryId: 'trajectory-0401',
      runId: 'tenant-a/run-0401',
      actionIds,
    });
    const refB = await makeValidatedRef({
      trajectoryId: 'trajectory-0402',
      runId: 'tenant-a/run-0402',
      actionIds: ['other-a', 'other-b'],
    });
    const policy = await createExtractionPolicy(makePolicyInput({ minTrajectories: 2 }));
    const result = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    expect(result.candidates).toHaveLength(0);
    expect(result.patternDecisions).toHaveLength(2);
    expect(result.patternDecisions.every((d) => d.reason === 'pattern-below-threshold')).toBe(true);
  });
});

describe('mining core — determinism (the A019 contract)', () => {
  it('same refs + same policy + same context ⇒ byte-identical candidates and decisions', async () => {
    const refA = await makeValidatedRef({
      trajectoryId: 'trajectory-0501',
      runId: 'tenant-a/run-0501',
      actionIds: ['x-a', 'x-b'],
    });
    const refB = await makeValidatedRef({
      trajectoryId: 'trajectory-0502',
      runId: 'tenant-a/run-0502',
      actionIds: ['x-a', 'x-b'],
    });
    const policy = await createExtractionPolicy(makePolicyInput({ minTrajectories: 2 }));
    const first = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    const second = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('input ORDER does not change the candidate set (order-independent grouping)', async () => {
    const refA = await makeValidatedRef({
      trajectoryId: 'trajectory-0501',
      runId: 'tenant-a/run-0501',
      actionIds: ['x-a', 'x-b'],
    });
    const refB = await makeValidatedRef({
      trajectoryId: 'trajectory-0502',
      runId: 'tenant-a/run-0502',
      actionIds: ['x-a', 'x-b'],
    });
    const policy = await createExtractionPolicy(makePolicyInput({ minTrajectories: 2 }));
    const forward = await mineSkillCandidates([refA, refB], policy, CONTEXT);
    const reverse = await mineSkillCandidates([refB, refA], policy, CONTEXT);
    expect(forward.candidates.map((c) => c.digest)).toEqual(
      reverse.candidates.map((c) => c.digest),
    );
  });

  it('a different policy produces different candidate digests (policy enters the content)', async () => {
    const ref = await makeValidatedRef();
    const policyA = await createExtractionPolicy(makePolicyInput());
    const policyB = await createExtractionPolicy(makePolicyInput({ policyId: 'policy-extraction-0002' }));
    const a = await mineSkillCandidates([ref], policyA, CONTEXT);
    const b = await mineSkillCandidates([ref], policyB, CONTEXT);
    expect(a.candidates[0]?.digest).not.toBe(b.candidates[0]?.digest);
  });
});

describe('SkillCandidate — packaging', () => {
  it('candidate ids derive deterministically from the signature digest', async () => {
    const signature: SkillPatternSignature = {
      actionIds: ['fetch-ledger', 'reconcile-entries', 'emit-report'] as never,
      outcome: 'completed',
    };
    const id = await candidateIdFromSignature(signature);
    expect(id).toMatch(/^skill-[0-9a-f]{16}$/);
    const again = await candidateIdFromSignature(signature);
    expect(again).toBe(id);
    const other = await candidateIdFromSignature({ ...signature, outcome: 'failed' });
    expect(other).not.toBe(id);
  });

  it('createSkillCandidate rejects structurally invalid views', async () => {
    const ref = await makeValidatedRef();
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
    const broken = { ...candidate, candidateId: 'Not_Valid' } as never;
    await expect(createSkillCandidate(broken)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE,
    });
    const brokenPort = {
      ...candidate,
      inputs: [{ name: 'Bad Name', description: 'x' }],
    } as never;
    await expect(createSkillCandidate(brokenPort)).rejects.toMatchObject({
      code: SKILL_EXTRACTION_ERROR_CODES.INVALID_CANDIDATE,
    });
  });
});

describe('mining core — property (seeded LCG scenarios)', () => {
  it('random validated corpora always yield deterministic, content-addressed results', async () => {
    const lcg = new TestLcg(0x51ce);
    for (let scenario = 0; scenario < 6; scenario += 1) {
      const actionPool = ['act-a', 'act-b', 'act-c', 'act-d'];
      const refCount = 1 + lcg.int(3);
      const refs = [];
      for (let index = 0; index < refCount; index += 1) {
        const actionIds = Array.from(
          { length: 1 + lcg.int(3) },
          () => actionPool[lcg.int(actionPool.length)] as string,
        );
        refs.push(
          await makeValidatedRef({
            trajectoryId: `trajectory-p${String(scenario)}-${String(index)}`,
            runId: `tenant-a/run-p${String(scenario)}-${String(index)}`,
            actionIds,
          }),
        );
      }
      const policy = await createExtractionPolicy(
        makePolicyInput({ minTrajectories: 1 + lcg.int(2) }),
      );
      const first = await mineSkillCandidates(refs, policy, CONTEXT);
      const second = await mineSkillCandidates(refs, policy, CONTEXT);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      // Every accepted candidate carries only real input digests.
      const chainHeads = new Set(refs.map((ref) => ref.trajectory.chainHead as string));
      for (const candidate of first.candidates) {
        for (const digest of candidate.evidence.trajectories) {
          expect(chainHeads.has(digest as string)).toBe(true);
        }
        expect(candidate.evidence.trajectories.length).toBe(
          new Set(candidate.evidence.trajectories).size,
        );
      }
    }
  });

  it('duplicate action ids in one trajectory collapse to distinct input ports', async () => {
    const ref = await makeValidatedRef({
      trajectoryId: 'trajectory-0601',
      runId: 'tenant-a/run-0601',
      actionIds: ['repeat', 'repeat', 'repeat'],
    });
    const policy = await createExtractionPolicy(makePolicyInput());
    const result = await mineSkillCandidates([ref], policy, CONTEXT);
    const candidate = result.candidates[0] as NonNullable<typeof result.candidates[0]>;
    expect(candidate.signature.actionIds).toHaveLength(3);
    expect(candidate.inputs).toHaveLength(1);
    expect(candidate.inputs[0]?.name).toBe('repeat');
    expect(DIGEST_A).toMatch(/^[0-9a-f]{64}$/);
  });
});
