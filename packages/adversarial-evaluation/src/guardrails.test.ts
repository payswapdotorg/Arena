/**
 * Guardrail tests (Work Order C013): EVERY AE1.0 guardrail as a tested
 * filter — self-voting, conflict-of-interest, duplicate-account,
 * rate-limiting/brigading, qualification-aware visibility and
 * aggregation, thresholds, small-sample, tie status, and the composed
 * fail-closed admission decision.
 */

import { describe, expect, it } from 'vitest';

import {
  assertNoConflictOfInterest,
  assertNoDuplicateAccount,
  assertNoSelfVoting,
  assertRateLimit,
  evaluateJudgmentGuardrails,
  minimumEvidenceThreshold,
  minimumVoteThreshold,
  qualificationAwareVisibility,
  qualifiedVotersOnly,
  smallSampleStatus,
  tieStatus,
  DEFAULT_GUARDRAIL_POLICY,
} from './guardrails.js';
import type { CompetitionParticipant, CompetitionSubmission, GuardrailPolicy } from './guardrails.js';
import { newCompetitionId } from './shared.js';
import { fixtureJudgment, fixtureParticipant, fixtureSubmission, T0, T1, T2 } from './test-support.js';

const COMPETITION = newCompetitionId();
const POLICY: GuardrailPolicy = { ...DEFAULT_GUARDRAIL_POLICY, maxJudgmentsPerExpertPerWindow: 3, rateLimitWindowMs: 60_000 };

describe('guardrail 1 — no self-voting (and no self-challenging)', () => {
  it('denies a vote-shaped judgment on the voter\'s own submission', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-a',
      type: 'upvote_with_proof',
    });
    const decision = assertNoSelfVoting(judgment, [submission]);
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]?.code).toBe('self-voting-detected');
  });

  it('denies a CHALLENGE on the challenger\'s own submission', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-a',
      type: 'challenge',
    });
    expect(assertNoSelfVoting(judgment, [submission]).allowed).toBe(false);
  });

  it('allows voting on another expert\'s submission', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'downvote_with_proof',
    });
    expect(assertNoSelfVoting(judgment, [submission]).allowed).toBe(true);
  });
});

describe('guardrail 2 — conflict-of-interest exclusion', () => {
  it('excludes a participant who declared a conflict with the submission or its author', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const participant: CompetitionParticipant = fixtureParticipant({
      expertRef: 'expert-c',
      declaredConflicts: ['expert-a'],
    });
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-c',
      type: 'upvote_with_proof',
    });
    const decision = assertNoConflictOfInterest(judgment, participant, [submission]);
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]?.code).toBe('conflict-of-interest');
  });

  it('a non-participant is denied outright (fail closed)', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'ghost',
      type: 'upvote_with_proof',
    });
    expect(assertNoConflictOfInterest(judgment, undefined, [submission]).allowed).toBe(false);
  });
});

describe('guardrail 3 — duplicate-account protection', () => {
  it('denies the SECOND expert account of the same principal cluster voting the same submission', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const participants: readonly CompetitionParticipant[] = [
      fixtureParticipant({ expertRef: 'expert-b', principalClusterRef: 'cluster-b' }),
      fixtureParticipant({ expertRef: 'expert-b2', principalClusterRef: 'cluster-b' }),
    ];
    const first = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'upvote_with_proof',
    });
    const second = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b2',
      type: 'upvote_with_proof',
      recordedAt: T2,
    });
    expect(assertNoDuplicateAccount(second, participants, [first]).allowed).toBe(false);
    expect(
      assertNoDuplicateAccount(second, participants, [first]).violations[0]?.code,
    ).toBe('duplicate-account');
  });

  it('different clusters voting the same submission are both admitted', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const participants: readonly CompetitionParticipant[] = [
      fixtureParticipant({ expertRef: 'expert-b', principalClusterRef: 'cluster-b' }),
      fixtureParticipant({ expertRef: 'expert-c', principalClusterRef: 'cluster-c' }),
    ];
    const first = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'upvote_with_proof',
    });
    const second = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-c',
      type: 'upvote_with_proof',
      recordedAt: T2,
    });
    expect(assertNoDuplicateAccount(second, participants, [first]).allowed).toBe(true);
  });
});

describe('guardrail 4 — rate limiting (brigading)', () => {
  it('denies a rapid-fire judgment burst beyond the window budget', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const prior = [0, 1, 2].map((offset) =>
      fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: submission.submissionId,
        expertRef: 'expert-b',
        type: 'upvote_with_proof',
        recordedAt: T1 + offset * 1000,
      }),
    );
    const burst = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'upvote_with_proof',
      recordedAt: T1 + 3000,
    });
    const decision = assertRateLimit(burst, prior, POLICY);
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]?.code).toBe('rate-limit-exceeded');
  });

  it('judgments outside the window do not count', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const prior = [0, 1, 2].map((offset) =>
      fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: submission.submissionId,
        expertRef: 'expert-b',
        type: 'upvote_with_proof',
        recordedAt: T0 + offset * 1000,
      }),
    );
    const later = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'upvote_with_proof',
      recordedAt: T1 + 60_000,
    });
    expect(assertRateLimit(later, prior, POLICY).allowed).toBe(true);
  });
});

describe('guardrails 5-6 — qualification-aware visibility and aggregation', () => {
  it('unqualified participants cannot see the competition surface', () => {
    const visibility = qualificationAwareVisibility(
      fixtureParticipant({ expertRef: 'expert-x', qualified: false }),
    );
    expect(visibility.visible).toBe(false);
    expect(visibility.reason).toContain('not qualified');
  });

  it('the aggregation projection excludes self-votes, duplicate clusters and unqualified voters', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const participants: readonly CompetitionParticipant[] = [
      fixtureParticipant({ expertRef: 'expert-a', principalClusterRef: 'cluster-a' }),
      fixtureParticipant({ expertRef: 'expert-b', principalClusterRef: 'cluster-b' }),
      fixtureParticipant({ expertRef: 'expert-b2', principalClusterRef: 'cluster-b' }),
      fixtureParticipant({ expertRef: 'expert-un', principalClusterRef: 'cluster-un', qualified: false }),
    ];
    const judgments = [
      fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-a', type: 'upvote_with_proof' }),
      fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-b', type: 'upvote_with_proof' }),
      fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-b2', type: 'upvote_with_proof', recordedAt: T2 }),
      fixtureJudgment({ competitionId: COMPETITION, submissionId: submission.submissionId, expertRef: 'expert-un', type: 'upvote_with_proof' }),
    ];
    const { admitted, excluded } = qualifiedVotersOnly(judgments, participants, [submission]);
    expect(admitted).toHaveLength(1);
    expect(excluded.map((entry) => entry.reason)).toEqual([
      'self-voting-detected',
      'duplicate-account',
      'insufficient-qualification',
    ]);
  });
});

describe('guardrails 7-10 — thresholds, small-sample, tie', () => {
  it('minimum vote threshold and small-sample status', () => {
    expect(minimumVoteThreshold(2, DEFAULT_GUARDRAIL_POLICY).met).toBe(false);
    expect(minimumVoteThreshold(3, DEFAULT_GUARDRAIL_POLICY).met).toBe(true);
    expect(smallSampleStatus(2, DEFAULT_GUARDRAIL_POLICY).status).toBe('small-sample');
    expect(smallSampleStatus(3, DEFAULT_GUARDRAIL_POLICY).status).toBe('adequate');
    expect(smallSampleStatus(0, DEFAULT_GUARDRAIL_POLICY).status).toBe('adequate');
  });

  it('minimum evidence threshold', () => {
    expect(minimumEvidenceThreshold(0, DEFAULT_GUARDRAIL_POLICY).met).toBe(false);
    expect(minimumEvidenceThreshold(1, DEFAULT_GUARDRAIL_POLICY).met).toBe(true);
  });

  it('tie status is explicit (never a silent coin flip)', () => {
    expect(tieStatus(0.5, 0.5).status).toBe('tie');
    expect(tieStatus(0.5, 0.499999999999).status).toBe('tie');
    expect(tieStatus(0.6, 0.4).status).toBe('decided');
  });
});

describe('the composed fail-closed admission decision', () => {
  it('admits an honest qualified non-conflicted vote', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-b',
      type: 'upvote_with_proof',
    });
    const decision = evaluateJudgmentGuardrails({
      judgment,
      participants: [fixtureParticipant({ expertRef: 'expert-b' })],
      submissions: [submission],
      priorJudgments: [],
      policy: DEFAULT_GUARDRAIL_POLICY,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.violations).toHaveLength(0);
  });

  it('denies with EVERY violated guardrail code listed (machine-readable)', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-a',
      type: 'upvote_with_proof',
    });
    const decision = evaluateJudgmentGuardrails({
      judgment,
      participants: [fixtureParticipant({ expertRef: 'expert-a', declaredConflicts: [submission.submissionId] })],
      submissions: [submission],
      priorJudgments: [],
      policy: DEFAULT_GUARDRAIL_POLICY,
    });
    expect(decision.allowed).toBe(false);
    const codes = decision.violations.map((violation) => violation.code);
    expect(codes).toContain('self-voting-detected');
    expect(codes).toContain('conflict-of-interest');
  });

  it('denies unqualified participants (qualification-aware admission)', () => {
    const submission: CompetitionSubmission = fixtureSubmission(COMPETITION, 'expert-a');
    const judgment = fixtureJudgment({
      competitionId: COMPETITION,
      submissionId: submission.submissionId,
      expertRef: 'expert-un',
      type: 'upvote_with_proof',
    });
    const decision = evaluateJudgmentGuardrails({
      judgment,
      participants: [fixtureParticipant({ expertRef: 'expert-un', qualified: false })],
      submissions: [submission],
      priorJudgments: [],
      policy: DEFAULT_GUARDRAIL_POLICY,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.violations[0]?.code).toBe('insufficient-qualification');
  });
});
