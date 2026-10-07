/**
 * Judgment-type tests (Work Order C013): the closed six-member AE1.0
 * vocabulary, the structural evidence requirement, the concrete-claim
 * requirement, challenge typing, strict validation.
 */

import { describe, expect, it } from 'vitest';

import { createJudgment, JUDGMENT_TYPES, isJudgmentRecord } from './judgments.js';
import { newChallengeId, newCompetitionId, newCompetitionSubmissionId, newJudgmentId } from './shared.js';
import { fixtureJudgment, T2 } from './test-support.js';

const COMPETITION = newCompetitionId();
const SUBMISSION = newCompetitionSubmissionId();
const CHALLENGE = newChallengeId();

describe('the six AE1.0 judgment types', () => {
  it('is the closed six-member vocabulary, exactly', () => {
    expect([...JUDGMENT_TYPES]).toEqual([
      'upvote_with_proof',
      'downvote_with_proof',
      'challenge',
      'accept_challenge',
      'reject_challenge',
      'needs_more_evidence',
    ]);
  });

  it('creates every type with evidence + a concrete claim, frozen', () => {
    for (const type of JUDGMENT_TYPES) {
      const judgment = fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        expertRef: 'expert-b',
        type,
        challengeId: type === 'accept_challenge' || type === 'reject_challenge' ? CHALLENGE : null,
      });
      expect(judgment.type).toBe(type);
      expect(judgment.evidence.length).toBeGreaterThanOrEqual(1);
      expect(judgment.claim.length).toBeGreaterThan(0);
      expect(Object.isFrozen(judgment)).toBe(true);
      expect(isJudgmentRecord(judgment)).toBe(true);
    }
  });

  it('REJECTS a judgment with zero evidence (the structural evidence law)', () => {
    expect(() =>
      createJudgment({
        judgmentId: newJudgmentId(),
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        challengeId: null,
        expertRef: 'expert-b',
        type: 'upvote_with_proof',
        claim: 'the takeoff method is reproducible',
        evidence: [],
        recordedAt: T2,
        provenance: 'test',
      }),
    ).toThrow(/at least one evidence item/);
  });

  it('REJECTS an unknown judgment type (closed vocabulary)', () => {
    expect(() =>
      createJudgment({
        judgmentId: newJudgmentId(),
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        challengeId: null,
        expertRef: 'expert-b',
        type: 'meh',
        claim: 'claim',
        evidence: [{ kind: 'citation', evidenceRef: 'r', supportsClaim: 'c', note: null }],
        recordedAt: T2,
        provenance: 'test',
      }),
    ).toThrow(/closed six-member AE1.0 vocabulary/);
  });

  it('challenge verdicts REQUIRE a challengeId; solution votes must NOT carry one', () => {
    expect(() =>
      fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        expertRef: 'expert-b',
        type: 'accept_challenge',
        challengeId: null,
      }),
    ).toThrow(/REQUIRES/);
    expect(() =>
      fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        expertRef: 'expert-b',
        type: 'upvote_with_proof',
        challengeId: CHALLENGE,
      }),
    ).toThrow(/must NOT carry/);
  });

  it('REJECTS unknown evidence kinds and unknown fields (fail closed)', () => {
    expect(() =>
      createJudgment({
        judgmentId: newJudgmentId(),
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        challengeId: null,
        expertRef: 'expert-b',
        type: 'challenge',
        claim: 'claim',
        evidence: [{ kind: 'vibes', evidenceRef: 'r', supportsClaim: 'c', note: null }],
        recordedAt: T2,
        provenance: 'test',
      }),
    ).toThrow(/closed vocabulary/);
    expect(() =>
      createJudgment({
        judgmentId: newJudgmentId(),
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        challengeId: null,
        expertRef: 'expert-b',
        type: 'challenge',
        claim: 'claim',
        evidence: [{ kind: 'citation', evidenceRef: 'r', supportsClaim: 'c', note: null }],
        recordedAt: T2,
        provenance: 'test',
        ...( { authorized: true } as unknown as Record<string, unknown>),
      }),
    ).toThrow(/rejects unknown field/);
  });

  it('a CHALLENGE must identify a concrete claim (empty claim rejected)', () => {
    expect(() =>
      fixtureJudgment({
        competitionId: COMPETITION,
        submissionId: SUBMISSION,
        expertRef: 'expert-b',
        type: 'challenge',
        claim: '',
      }),
    ).toThrow(/non-empty string/);
  });
});
