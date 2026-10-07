/**
 * Adjudication tests (Work Order C013): the AE1.0 input list, weighting,
 * Bradley-Terry determinism, the verification boundary, tie/small-sample
 * states, and the DISCOVERY-SIGNAL LAW (the raw ratio can never drive a
 * verdict — structurally and textually enforced).
 */

import { describe, expect, it } from 'vitest';

import {
  ADJUDICATION_FORMULA_VERSION,
  ADJUDICATION_INPUT_FIELDS,
  createCompetitionResult,
  deriveCompetitionResult,
  fitBradleyTerryStrengths,
} from './adjudication.js';
import type { AdjudicationInputs, SolutionAdjudicationInput } from './adjudication.js';
import { consumeResultAsCertification, toCandidateFeeds } from './certification.js';
import { AdversarialEvaluationError } from './errors.js';
import { DEFAULT_GUARDRAIL_POLICY } from './guardrails.js';
import { newCompetitionResultId } from './shared.js';
import { T3 } from './test-support.js';

function solution(overrides: Partial<SolutionAdjudicationInput> & { submissionId: string }): SolutionAdjudicationInput {
  return {
    authorExpertRef: `author-${overrides.submissionId}`,
    votes: [],
    challenges: [],
    verifierOutcome: { outcome: 'pass', recordDigest: `digest-${overrides.submissionId}` },
    evaluatorOutcome: { outcome: 'meets-criteria', recordDigest: `eval-${overrides.submissionId}` },
    ...overrides,
  };
}

function baseInput(solutions: readonly SolutionAdjudicationInput[]): AdjudicationInputs {
  return {
    competitionId: 'cmp_00000000000000000000000000000000',
    tenantId: 'tenant-test',
    solutions,
    agreementPatterns: [],
    policy: DEFAULT_GUARDRAIL_POLICY,
    now: T3,
    resultId: 'crs_00000000000000000000000000000000',
  };
}

const VOTERS = ['expert-p', 'expert-q', 'expert-r', 'expert-s'];

describe('determinism + the versioned formula', () => {
  it('identical inputs derive IDENTICAL results (deterministic aggregation)', () => {
    const solutions: readonly SolutionAdjudicationInput[] = [
      solution({
        submissionId: 'sub_strong',
        votes: VOTERS.slice(0, 3).map((expertRef) => ({
          expertRef,
          direction: 'up' as const,
          evidenceQuality: 0.9,
          calibrationWeight: 0.8,
        })),
      }),
      solution({
        submissionId: 'sub_weak',
        votes: VOTERS.slice(0, 3).map((expertRef) => ({
          expertRef,
          direction: 'down' as const,
          evidenceQuality: 0.7,
          calibrationWeight: 0.6,
        })),
      }),
    ];
    const first = deriveCompetitionResult(baseInput(solutions));
    const second = deriveCompetitionResult(baseInput(solutions));
    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    expect(first.formulaVersion).toBe(ADJUDICATION_FORMULA_VERSION);
    expect(first.outcome).toBe('verified_result');
    expect(first.winnerSubmissionId).toBe('sub_strong');
  });

  it('Bradley-Terry fitting is deterministic and orders the stronger solution first', () => {
    const solutions: readonly SolutionAdjudicationInput[] = [
      solution({
        submissionId: 'sub_a',
        votes: VOTERS.map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })),
      }),
      solution({
        submissionId: 'sub_b',
        votes: VOTERS.map((expertRef) => ({ expertRef, direction: 'down' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })),
      }),
    ];
    const first = fitBradleyTerryStrengths(solutions);
    const second = fitBradleyTerryStrengths(solutions);
    expect(first).toEqual(second);
    expect(first[0]).toBeGreaterThan(first[1] ?? 0);
  });
});

describe('evidence weighting + challenge validity (AE1.0 inputs are applied)', () => {
  it('an accepted high-evidence challenge reduces the solution standing', () => {
    const clean = deriveCompetitionResult(
      baseInput([
        solution({ submissionId: 'sub_x', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })) }),
        solution({ submissionId: 'sub_y', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'down' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })) }),
      ]),
    );
    const challenged = deriveCompetitionResult(
      baseInput([
        solution({
          submissionId: 'sub_x',
          votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })),
          challenges: [{ challengeId: 'cha_1', validity: 'accepted', evidenceQuality: 0.9 }],
        }),
        solution({ submissionId: 'sub_y', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'down' as const, evidenceQuality: 0.9, calibrationWeight: 0.8 })) }),
      ]),
    );
    const cleanScore = clean.rankedSolutions.find((entry) => entry.submissionId === 'sub_x')?.weightedScore ?? 0;
    const challengedScore = challenged.rankedSolutions.find((entry) => entry.submissionId === 'sub_x')?.weightedScore ?? 0;
    expect(challengedScore).toBeLessThan(cleanScore);
    expect(
      challenged.reasons.some((reason) => reason.code === 'challenge-validity-applied'),
    ).toBe(true);
  });

  it('calibration and agreement weights modulate vote influence', () => {
    const withHighCalibration = deriveCompetitionResult(
      baseInput([
        solution({ submissionId: 'sub_x', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.9, calibrationWeight: 1 })) }),
        solution({ submissionId: 'sub_y', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'down' as const, evidenceQuality: 0.9, calibrationWeight: 1 })) }),
      ]),
    );
    expect(withHighCalibration.outcome).toBe('verified_result');
    expect(
      withHighCalibration.reasons.some((reason) => reason.code === 'calibration-weighted'),
    ).toBe(true);
    expect(
      withHighCalibration.reasons.some((reason) => reason.code === 'evidence-quality-weighted'),
    ).toBe(true);
  });
});

describe('the verification boundary (A013 outcome is applied, never overridden)', () => {
  it('a FAIL verifier outcome excludes the solution from the verified result', () => {
    const result = deriveCompetitionResult(
      baseInput([
        solution({
          submissionId: 'sub_fail',
          verifierOutcome: { outcome: 'fail', recordDigest: 'd-fail' },
          votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 1, calibrationWeight: 1 })),
        }),
        solution({ submissionId: 'sub_pass', votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.5, calibrationWeight: 0.5 })) }),
      ]),
    );
    expect(result.rankedSolutions.find((entry) => entry.submissionId === 'sub_fail')?.verdict).toBe('rejected');
    expect(result.winnerSubmissionId).not.toBe('sub_fail');
  });

  it('an UNKNOWN verifier outcome defers the whole competition to needs_more_evidence', () => {
    const result = deriveCompetitionResult(
      baseInput([
        solution({ submissionId: 'sub_u', verifierOutcome: { outcome: 'unknown', recordDigest: null } }),
        solution({ submissionId: 'sub_v' }),
      ]),
    );
    expect(result.outcome).toBe('needs_more_evidence');
    expect(result.winnerSubmissionId).toBeNull();
  });

  it('a below-criteria evaluator outcome prevents the strongest solution from winning', () => {
    const result = deriveCompetitionResult(
      baseInput([
        solution({
          submissionId: 'sub_top',
          evaluatorOutcome: { outcome: 'below-criteria', recordDigest: 'e-low' },
          votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 1, calibrationWeight: 1 })),
        }),
        solution({
          submissionId: 'sub_mid',
          votes: VOTERS.slice(0, 3).map((expertRef) => ({ expertRef, direction: 'down' as const, evidenceQuality: 1, calibrationWeight: 1 })),
        }),
      ]),
    );
    expect(result.outcome).toBe('needs_more_evidence');
    expect(result.winnerSubmissionId).toBeNull();
    expect(result.rankedSolutions.find((entry) => entry.submissionId === 'sub_top')?.verdict).toBe('rejected');
  });
});

describe('explicit tie and small-sample states', () => {
  it('a symmetric tie surfaces tie_unknown — never a coin-flip winner', () => {
    const result = deriveCompetitionResult(
      baseInput([
        solution({ submissionId: 'sub_1', votes: VOTERS.slice(0, 2).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.8, calibrationWeight: 0.8 })) }),
        solution({ submissionId: 'sub_2', votes: VOTERS.slice(2, 4).map((expertRef) => ({ expertRef, direction: 'up' as const, evidenceQuality: 0.8, calibrationWeight: 0.8 })) }),
      ]),
    );
    expect(result.outcome).toBe('tie_unknown');
    expect(result.winnerSubmissionId).toBeNull();
    expect(result.reasons.some((reason) => reason.code === 'tie-uncertainty')).toBe(true);
  });

  it('below the minimum qualified voters the result is small-sample needs_more_evidence', () => {
    const result = deriveCompetitionResult(
      baseInput([
        solution({ submissionId: 'sub_1', votes: [{ expertRef: 'expert-p', direction: 'up', evidenceQuality: 1, calibrationWeight: 1 }] }),
        solution({ submissionId: 'sub_2' }),
      ]),
    );
    expect(result.outcome).toBe('needs_more_evidence');
    expect(result.reasons.some((reason) => reason.code === 'small-sample')).toBe(true);
  });

  it('zero voters is explicit insufficient participation', () => {
    const result = deriveCompetitionResult(baseInput([solution({ submissionId: 'sub_1' }), solution({ submissionId: 'sub_2' })]));
    expect(result.outcome).toBe('insufficient_participation');
  });
});

describe('THE DISCOVERY-SIGNAL LAW (structural)', () => {
  it('AdjudicationInputs has NO ratio/signal/member for the community signal', () => {
    expect(ADJUDICATION_INPUT_FIELDS).toEqual([
      'competitionId',
      'tenantId',
      'solutions',
      'agreementPatterns',
      'policy',
      'now',
      'resultId',
    ]);
    // And a smuggled ratio member is REJECTED by exact-field validation.
    expect(() =>
      deriveCompetitionResult({
        ...(baseInput([solution({ submissionId: 'sub_1' })]) as unknown as Record<string, unknown>),
        communityRatio: 0.99,
      } as unknown as Parameters<typeof deriveCompetitionResult>[0]),
    ).toThrow(/rejects unknown field/);
  });

  it('an overwhelming raw upvote majority CANNOT win against evidence-weighted contests', () => {
    // sub_popular: raw ratio 3-up/1-down = 0.75 — the raw community
    // signal FAVOURS it. sub_evidenced: 2-up/2-down = 0.5. The pairwise
    // contests are evidence-weighted: the single high-evidence contest
    // (expert-s, quality 1.0 both sides) favours sub_evidenced, and the
    // low-evidence contests favouring sub_popular carry ~no weight.
    const result = deriveCompetitionResult(
      baseInput([
        solution({
          submissionId: 'sub_popular',
          votes: [
            { expertRef: 'expert-p', direction: 'up', evidenceQuality: 0.1, calibrationWeight: 0.5 },
            { expertRef: 'expert-q', direction: 'up', evidenceQuality: 0.1, calibrationWeight: 0.5 },
            { expertRef: 'expert-r', direction: 'up', evidenceQuality: 0.1, calibrationWeight: 0.5 },
            { expertRef: 'expert-s', direction: 'down', evidenceQuality: 1, calibrationWeight: 1 },
          ],
        }),
        solution({
          submissionId: 'sub_evidenced',
          votes: [
            { expertRef: 'expert-p', direction: 'down', evidenceQuality: 0.1, calibrationWeight: 0.5 },
            { expertRef: 'expert-q', direction: 'down', evidenceQuality: 0.1, calibrationWeight: 0.5 },
            { expertRef: 'expert-r', direction: 'up', evidenceQuality: 1, calibrationWeight: 1 },
            { expertRef: 'expert-s', direction: 'up', evidenceQuality: 1, calibrationWeight: 1 },
          ],
        }),
      ]),
    );
    const popular = result.rankedSolutions.find((entry) => entry.submissionId === 'sub_popular');
    const evidenced = result.rankedSolutions.find((entry) => entry.submissionId === 'sub_evidenced');
    expect((popular?.btStrength ?? 0)).toBeLessThan(evidenced?.btStrength ?? 1);
    expect(result.winnerSubmissionId).toBe('sub_evidenced');
    expect(result.outcome).toBe('verified_result');
  });
});

describe('the certification boundary (lock rule 34)', () => {
  it('consumeResultAsCertification has NO happy path', () => {
    const result = deriveCompetitionResult(baseInput([solution({ submissionId: 'sub_1' })]));
    expect(() => consumeResultAsCertification(result)).toThrow(AdversarialEvaluationError);
    try {
      consumeResultAsCertification(result);
    } catch (error) {
      expect((error as AdversarialEvaluationError).code).toBe('certification-boundary-violation');
    }
  });

  it('candidate feeds carry candidateOnly: true + the frozen boundary statement', () => {
    const result = deriveCompetitionResult(
      baseInput([solution({ submissionId: 'sub_1' }), solution({ submissionId: 'sub_2' })]),
    );
    const feed = toCandidateFeeds(result, { sub_1: ['evidence-1'] });
    expect(feed.payloads.length).toBe(6);
    for (const payload of feed.payloads) {
      expect(payload.candidateOnly).toBe(true);
      expect(payload.boundary).toContain('architecture-lock rule 34');
    }
  });

  it('createCompetitionResult rejects smuggled authority fields (payload surgery)', () => {
    expect(() =>
      createCompetitionResult({
        resultId: newCompetitionResultId(),
        competitionId: 'cmp_00000000000000000000000000000000',
        tenantId: 'tenant-test',
        outcome: 'verified_result',
        winnerSubmissionId: 'sub_1',
        rankedSolutions: [],
        reasons: [
          { code: 'qualified-votes-aggregated', detail: 'd', ref: null },
        ],
        computedAt: '2026-10-07T10:00:00.000Z',
        ...( { certified: true } as unknown as Record<string, unknown>),
      }),
    ).toThrow(/rejects unknown field/);
  });
});
