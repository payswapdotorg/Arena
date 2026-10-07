/**
 * Integration test (Work Order C013): a FULL competition over the
 * injected C009/A012/A013 ports on the reference fabric — open → solicit
 * → submit → challenge → respond → vote → adjudicate → verified result,
 * with the labelled community discovery signals, the certification
 * candidate feeds and the A030 byproduct candidates delivered.
 */

import { describe, expect, it } from 'vitest';

import { isCommunitySignal } from '@arena/adversarial-evaluation';

import { createTestHarness, nextCommandId, TASK } from './test-support.js';
import { newCompetitionSubmissionId, newJudgementId } from './test-support.js';

describe('a full competition over the injected C009/A012/A013 ports', () => {
  it('runs the AE1.0 chain end to end and derives a verified result', async () => {
    const harness = createTestHarness();
    const competitionId = harness.competitionId;
    // 1. OPEN + SOLICITING.
    await harness.service.openCompetition({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    await harness.service.advanceState({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: 'solicitation opened',
    });
    // 2. Independent qualified solutions.
    const subAlpha = newCompetitionSubmissionId();
    const subBeta = newCompetitionSubmissionId();
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      submissionId: subAlpha,
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      submissionId: subBeta,
      authorExpertRef: 'expert-beta',
      evidenceRefs: ['takeoff-beta-v1'],
    });
    // 3. Challenge (evidence-carrying, concrete claim). The service
    //    mints the challenge's cha_ id; verdict judgments cite it.
    await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId: subBeta,
      expertRef: 'expert-gamma',
      type: 'challenge',
      claim: 'the connection detail count omits the moment splices',
      evidence: [
        { kind: 'citation', evidenceRef: 'drawings/S-304', supportsClaim: 'moment splices appear on 6 bays' },
      ],
    });
    const challengeId =
      (await harness.service.getCompetition(competitionId, 'tenant-test')).judgments.find(
        (judgment) => judgment.type === 'challenge',
      )?.challengeId ?? '';
    // 4. Challenge verdicts (accept/reject with evidence).
    await harness.service.castJudgment({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      judgmentId: newJudgementId(),
      submissionId: subBeta,
      challengeId,
      expertRef: 'expert-delta',
      type: 'reject_challenge',
      claim: 'the splices are addressed in the addendum',
      evidence: [
        { kind: 'inspection', evidenceRef: 'drawings/S-304-addendum', supportsClaim: 'addendum covers the 6 bays' },
      ],
    });
    // 5. Solution votes from three distinct qualified non-authors
    //    (beta may vote on alpha's solution; gamma/delta vote on both —
    //    shared voters induce the pairwise contests).
    for (const [expertRef, submissionId, direction] of [
      ['expert-gamma', subAlpha, 'upvote_with_proof'],
      ['expert-gamma', subBeta, 'downvote_with_proof'],
      ['expert-delta', subAlpha, 'upvote_with_proof'],
      ['expert-delta', subBeta, 'downvote_with_proof'],
      ['expert-beta', subAlpha, 'downvote_with_proof'],
    ] as const) {
      await harness.service.castJudgment({
        commandId: nextCommandId(),
        competitionId,
        tenantId: 'tenant-test',
        judgmentId: newJudgementId(),
        submissionId,
        expertRef,
        type: direction,
        claim: 'vote on the solution evidence',
        evidence: [
          { kind: 'test-log', evidenceRef: `runs/${expertRef}`, supportsClaim: 'reproduction within tolerance' },
        ],
      });
    }
    // 6. Adjudication over the injected seams.
    const receipt = await harness.service.runAdjudication({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
    });
    expect(receipt.status).toBe('recorded');
    expect(receipt.result?.outcome).toBe('verified_result');
    expect(receipt.result?.winnerSubmissionId).toBe(subAlpha);
    const aggregate = await harness.service.getCompetition(competitionId, 'tenant-test');
    expect(aggregate.competition.state).toBe('verified_result');
    expect(aggregate.competition.stateHistory.map((entry) => entry.state)).toContain('adjudication');
    // 7. The labelled community discovery signals (verdict-free).
    expect(aggregate.signals).toHaveLength(2);
    for (const signal of aggregate.signals) {
      expect(isCommunitySignal(signal)).toBe(true);
      expect(signal.label).toBe('discovery-signal');
      expect(signal.limitations[0]).toContain('discovery signal only');
    }
    const alphaSignal = aggregate.signals.find((signal) => signal.submissionId === subAlpha);
    // Admitted votes on subAlpha: gamma (up), delta (up), beta (down) —
    // the challenge/verdict judgments never enter the signal count.
    expect(alphaSignal?.upvotes).toBe(2);
    expect(alphaSignal?.downvotes).toBe(1);
    const betaSignal = aggregate.signals.find((signal) => signal.submissionId === subBeta);
    expect(betaSignal?.upvotes).toBe(0);
    expect(betaSignal?.downvotes).toBe(2);
    expect(betaSignal?.ratio).toBe(0);
    // 8. A030 byproduct candidates delivered with rights/provenance.
    // (Wired through the fabric's CollectingResearchSink — asserted in
    // the adversarial suite where the fabric is captured directly.)
  });

  it('replaying runAdjudication with the same command id returns the same result (idempotent)', async () => {
    const harness = createTestHarness();
    const competitionId = harness.competitionId;
    await harness.service.openCompetition({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      task: TASK,
    });
    await harness.service.advanceState({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      target: 'soliciting',
      reason: null,
    });
    const submissionId = newCompetitionSubmissionId();
    await harness.service.submitSolution({
      commandId: nextCommandId(),
      competitionId,
      tenantId: 'tenant-test',
      submissionId,
      authorExpertRef: 'expert-alpha',
      evidenceRefs: ['takeoff-alpha-v1'],
    });
    const commandId = nextCommandId();
    const first = await harness.service.runAdjudication({ commandId, competitionId, tenantId: 'tenant-test' });
    const replay = await harness.service.runAdjudication({ commandId, competitionId, tenantId: 'tenant-test' });
    expect(JSON.stringify(replay.result)).toEqual(JSON.stringify(first.result));
  });
});
