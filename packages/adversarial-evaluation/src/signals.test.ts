/**
 * Community discovery-signal tests (Work Order C013): the ratio is a
 * labelled discovery signal ONLY — guardrail-admitted votes counted,
 * small-sample flagged, zero-vote unknowns explicit, and the type can
 * never masquerade as a verdict.
 */

import { describe, expect, it } from 'vitest';

import { computeCommunitySignal, COMMUNITY_SIGNAL_LABEL, isCommunitySignal } from './signals.js';
import { DEFAULT_GUARDRAIL_POLICY } from './guardrails.js';
import { newCompetitionId } from './shared.js';
import { fixtureJudgment, fixtureParticipant, fixtureSubmission, T2, T3 } from './test-support.js';

const COMPETITION = newCompetitionId();

function scenario() {
  const submission = fixtureSubmission(COMPETITION, 'expert-author');
  const participants = [
    fixtureParticipant({ expertRef: 'expert-author', principalClusterRef: 'cluster-author' }),
    fixtureParticipant({ expertRef: 'expert-a', principalClusterRef: 'cluster-a' }),
    fixtureParticipant({ expertRef: 'expert-a2', principalClusterRef: 'cluster-a' }),
    fixtureParticipant({ expertRef: 'expert-b', principalClusterRef: 'cluster-b' }),
  ];
  const judgments = [
    // Self-vote: EXCLUDED from the signal count.
    fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-author', type: 'upvote_with_proof' }),
    // Duplicate cluster: expert-a2 rides expert-a's cluster: EXCLUDED.
    fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-a', type: 'upvote_with_proof' }),
    fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-a2', type: 'upvote_with_proof', recordedAt: T3 }),
    fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-b', type: 'downvote_with_proof', recordedAt: T3 }),
  ];
  return { submission, participants, judgments };
}

describe('the discovery signal', () => {
  it('counts ONLY guardrail-admitted votes (no self-vote, no duplicate cluster)', () => {
    const { submission, participants, judgments } = scenario();
    const signal = computeCommunitySignal({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      judgments,
      participants,
      submissions: [submission],
      policy: DEFAULT_GUARDRAIL_POLICY,
      now: T3,
    });
    expect(signal.upvotes).toBe(1);
    expect(signal.downvotes).toBe(1);
    expect(signal.totalVotes).toBe(2);
    expect(signal.ratio).toBe(0.5);
    expect(signal.distinctQualifiedVoters).toBe(2);
    expect(signal.smallSample).toBe(true);
    expect(signal.label).toBe(COMMUNITY_SIGNAL_LABEL);
    expect(isCommunitySignal(signal)).toBe(true);
  });

  it('a zero-vote submission surfaces ratio null — the honest unknown, never 0/0', () => {
    const { submission, participants } = scenario();
    const signal = computeCommunitySignal({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      judgments: [],
      participants,
      submissions: [submission],
      policy: DEFAULT_GUARDRAIL_POLICY,
      now: T3,
    });
    expect(signal.ratio).toBeNull();
    expect(signal.totalVotes).toBe(0);
  });

  it('the signal type carries NO verdict field — it cannot masquerade as an adjudication', () => {
    const { submission, participants, judgments } = scenario();
    const signal = computeCommunitySignal({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      judgments,
      participants,
      submissions: [submission],
      policy: DEFAULT_GUARDRAIL_POLICY,
      now: T3,
    });
    const keys = Object.keys(signal);
    expect(keys).not.toContain('verdict');
    expect(keys).not.toContain('outcome');
    expect(keys).not.toContain('winner');
    expect(signal.limitations[0]).toContain('discovery signal only');
  });

  it('deterministic given identical inputs', () => {
    const { submission, participants, judgments } = scenario();
    const input = {
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      judgments,
      participants,
      submissions: [submission] as Parameters<typeof computeCommunitySignal>[0]['submissions'],
      policy: DEFAULT_GUARDRAIL_POLICY,
      now: T2,
    };
    expect(JSON.stringify(computeCommunitySignal(input))).toEqual(
      JSON.stringify(computeCommunitySignal(input)),
    );
  });
});
