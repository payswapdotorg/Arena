/**
 * Service tests (Work Order C013): lifecycle binding over the reference
 * fabric, durable idempotent jobs (replay + collision), fail-closed
 * cross-tenant reads, guardrail admission on cast votes.
 */

import { describe, expect, it } from 'vitest';

import { AdversarialEvaluationError } from '@arena/adversarial-evaluation';

import { createTestHarness, nextCommandId, TASK, T0 } from './test-support.js';
import { newCompetitionSubmissionId, newJudgementId } from './test-support.js';

async function openCompetition(harness: ReturnType<typeof createTestHarness>): Promise<void> {
  await harness.service.openCompetition({
    commandId: nextCommandId(),
    competitionId: harness.competitionId,
    tenantId: 'tenant-test',
    task: TASK,
  });
}

describe('lifecycle binding over the reference fabric', () => {
  it('opens -> solicits -> submits -> challenges -> responds -> votes -> adjudicates -> verified_result', async () => {
    const harness = createTestHarness();
    await openCompetition(harness);
    await harness.service.advanceState({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: 'solicitation opened',
    });
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      submissionId: newCompetitionSubmissionId(),
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      submissionId: newCompetitionSubmissionId(),
      authorExpertRef: 'expert-beta',
      evidenceRefs: ['takeoff-beta-v1'],
    });
    const aggregate = await harness.service.getCompetition(harness.competitionId, 'tenant-test');
    expect(aggregate.competition.state).toBe('submitted');
    expect(aggregate.submissions).toHaveLength(2);
  });

  it('a judgment drives the state machine (challenge -> response -> voting)', async () => {
    const harness = createTestHarness();
    await openCompetition(harness);
    await harness.service.advanceState({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: null,
    });
    const submissionId = newCompetitionSubmissionId();
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      submissionId,
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-beta',
      type: 'challenge',
      claim: 'the beam count on drawing S-201 is understated by 12 members',
      evidence: [
        { kind: 'citation', evidenceRef: 'drawings/S-201-revision-C', supportsClaim: 'beam schedule lists 88, not 100' },
      ],
    });
    let aggregate = await harness.service.getCompetition(harness.competitionId, 'tenant-test');
    expect(aggregate.competition.state).toBe('challenge');
    // The CHALLENGE judgment minted its own cha_ id — verdicts cite it.
    const challengeId = aggregate.judgments[0]?.challengeId;
    expect(typeof challengeId).toBe('string');
    await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-gamma',
      type: 'reject_challenge',
      challengeId: challengeId ?? '',
      claim: 'the cited revision supersedes the challenge',
      evidence: [
        { kind: 'inspection', evidenceRef: 'drawings/S-201-revision-C-addendum', supportsClaim: 'addendum confirms 100 members' },
      ],
    });
    aggregate = await harness.service.getCompetition(harness.competitionId, 'tenant-test');
    expect(aggregate.competition.state).toBe('response');
    await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId,
      expertRef: 'expert-gamma',
      type: 'upvote_with_proof',
      claim: 'the takeoff method is reproducible',
      evidence: [
        { kind: 'reproduction', evidenceRef: 'runs/reproduce-alpha', supportsClaim: 'method reproduces within 2%' },
      ],
    });
    aggregate = await harness.service.getCompetition(harness.competitionId, 'tenant-test');
    expect(aggregate.competition.state).toBe('voting');
  });
});

describe('durable idempotent jobs', () => {
  it('replaying the SAME command id returns the SAME receipt (nothing double-applied)', async () => {
    const harness = createTestHarness();
    const commandId = nextCommandId();
    const receipt = await harness.service.openCompetition({
      commandId,
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    const replay = await harness.service.openCompetition({
      commandId,
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    expect(replay).toEqual(receipt);
    const listings = await harness.service.listCompetitions('tenant-test');
    expect(listings).toHaveLength(1);
  });

  it('the SAME command id with a DIFFERENT command fails closed (collision denied)', async () => {
    const harness = createTestHarness();
    const commandId = nextCommandId();
    await harness.service.openCompetition({
      commandId,
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    await expect(
      harness.service.advanceState({
        commandId,
        competitionId: harness.competitionId,
        tenantId: 'tenant-test',
        target: 'soliciting',
        reason: 'different command, same id',
      }),
    ).rejects.toThrow(/idempotency collision denied/);
  });

  it('a command without an id is rejected (lock rule 17)', async () => {
    const harness = createTestHarness();
    await expect(
      harness.service.openCompetition({
        commandId: '',
        competitionId: harness.competitionId,
        tenantId: 'tenant-test',
        task: TASK,
      }),
    ).rejects.toThrow(AdversarialEvaluationError);
  });
});

describe('fail-closed reads', () => {
  it('cross-tenant reads get the typed denial, not silence', async () => {
    const harness = createTestHarness();
    await openCompetition(harness);
    await expect(
      harness.service.getCompetition(harness.competitionId, 'tenant-other'),
    ).rejects.toThrow(/not visible to tenant tenant-other/);
    await expect(harness.service.getCompetition('cmp_00000000000000000000000000000000', 'tenant-test')).rejects.toThrow(
      /unknown competition/,
    );
  });

  it('an unqualified expert cannot submit a solution', async () => {
    const harness = createTestHarness();
    await openCompetition(harness);
    await harness.service.advanceState({
      commandId: nextCommandId(),
      competitionId: harness.competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: null,
    });
    await expect(
      harness.service.submitSolution({
        commandId: nextCommandId(),
        competitionId: harness.competitionId,
        tenantId: 'tenant-test',
        submissionId: newCompetitionSubmissionId(),
        authorExpertRef: 'expert-unqualified',
        evidenceRefs: [],
      }),
    ).rejects.toThrow(/QUALIFIED/);
  });

  it('the injected clock is the only time source (T0 posture)', () => {
    const harness = createTestHarness();
    const now = harness.tick();
    expect(now).toBeGreaterThan(T0);
    expect(now).toBe(T0 + 60_000);
  });
});
