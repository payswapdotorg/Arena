/**
 * The six AE1.0 judgment types (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md "Supported judgments").
 *
 * Every judgment is TYPED, EVIDENCE-CARRYING and APPEND-ONLY:
 *
 *   UPVOTE_WITH_PROOF     — support a solution, with proof evidence;
 *   DOWNVOTE_WITH_PROOF   — oppose a solution, with proof evidence;
 *   CHALLENGE             — challenge another expert's solution: MUST
 *                           identify a concrete claim, step, artifact or
 *                           outcome, WITH evidence;
 *   ACCEPT_CHALLENGE      — vote a challenge valid, with evidence;
 *   REJECT_CHALLENGE      — vote a challenge invalid, with evidence;
 *   NEEDS_MORE_EVIDENCE   — the evidence so far cannot support a
 *                           judgment either way (the honest unknown).
 *
 * A judgment with ZERO evidence items is REJECTED at construction —
 * "challengers provide evidence for the challenge" is structural, not a
 * convention comment. Judgment records are frozen on creation; there is
 * no mutation API (append-only house law).
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import {
  deepFreeze,
  isChallengeId,
  isCompetitionId,
  isCompetitionSubmissionId,
  isJudgmentId,
  rejectUnknownFields,
  requireBoundedString,
  toEscalationTimestamp,
} from './shared.js';
import type { ChallengeId, CompetitionId, CompetitionSubmissionId, JudgmentId } from './shared.js';

/** Wire version of the judgment shapes. */
export const JUDGMENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed judgment vocabulary (the six AE1.0 types)
// ---------------------------------------------------------------------------

export const JUDGMENT_TYPES = Object.freeze([
  'upvote_with_proof',
  'downvote_with_proof',
  'challenge',
  'accept_challenge',
  'reject_challenge',
  'needs_more_evidence',
] as const);
export type JudgmentType = (typeof JUDGMENT_TYPES)[number];

export function isJudgmentType(value: unknown): value is JudgmentType {
  return typeof value === 'string' && (JUDGMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The vote-shaped judgments (up/down on a SOLUTION). ACCEPT/REJECT
 * challenge vote on a CHALLENGE; CHALLENGE opens one;
 * NEEDS_MORE_EVIDENCE abstains.
 */
export const VOTE_JUDGMENT_TYPES: readonly JudgmentType[] = Object.freeze([
  'upvote_with_proof',
  'downvote_with_proof',
]);

export function isVoteJudgment(type: JudgmentType): boolean {
  return VOTE_JUDGMENT_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** The closed evidence-kind vocabulary (A013-aligned). */
export const JUDGMENT_EVIDENCE_KINDS = Object.freeze([
  'artifact',
  'measurement',
  'test-log',
  'reproduction',
  'inspection',
  'citation',
] as const);
export type JudgmentEvidenceKind = (typeof JUDGMENT_EVIDENCE_KINDS)[number];

export function isJudgmentEvidenceKind(value: unknown): value is JudgmentEvidenceKind {
  return (
    typeof value === 'string' && (JUDGMENT_EVIDENCE_KINDS as readonly string[]).includes(value)
  );
}

/** One evidence item backing a judgment (digest/ref-addressed). */
export interface JudgmentEvidenceItem {
  readonly kind: JudgmentEvidenceKind;
  /** Content address / ref of the evidence (digest, URL, citation id). */
  readonly evidenceRef: string;
  /** The concrete claim/step/artifact/outcome this evidence supports. */
  readonly supportsClaim: string;
  readonly note: string | null;
}

// ---------------------------------------------------------------------------
// The judgment record
// ---------------------------------------------------------------------------

export interface JudgmentRecord {
  readonly judgmentVersion: typeof JUDGMENT_VERSION;
  readonly judgmentId: JudgmentId;
  readonly competitionId: CompetitionId;
  readonly submissionId: CompetitionSubmissionId;
  /** Present on challenge-verdict judgments (accept/reject) and responses; null otherwise. */
  readonly challengeId: ChallengeId | null;
  readonly expertRef: string;
  readonly type: JudgmentType;
  /**
   * The CONCRETE claim, step, artifact or outcome the judgment targets
   * (AE1.0 step 4 — a bare "I disagree" is rejected at construction).
   */
  readonly claim: string;
  /** >= 1 evidence item, ALWAYS (the structural evidence requirement). */
  readonly evidence: readonly JudgmentEvidenceItem[];
  readonly note: string | null;
  readonly recordedAt: string;
  readonly provenance: string;
}

export const JUDGMENT_RECORD_FIELDS = Object.freeze([
  'judgmentVersion',
  'judgmentId',
  'competitionId',
  'submissionId',
  'challengeId',
  'expertRef',
  'type',
  'claim',
  'evidence',
  'note',
  'recordedAt',
  'provenance',
] as const);

export interface CreateJudgmentInput {
  readonly judgmentId: string;
  readonly competitionId: string;
  readonly submissionId: string;
  readonly challengeId?: string | null;
  readonly expertRef: string;
  readonly type: string;
  readonly claim: string;
  readonly evidence: readonly {
    readonly kind: string;
    readonly evidenceRef: string;
    readonly supportsClaim: string;
    readonly note?: string | null;
  }[];
  readonly note?: string | null;
  readonly recordedAt: number;
  readonly provenance: string;
}

/**
 * Create and freeze one judgment (strict, fail-closed): the type must be
 * in the closed six-member vocabulary, the claim must identify a
 * CONCRETE claim/step/artifact/outcome, and the evidence list must carry
 * >= 1 item — a judgment without evidence cannot exist (AE1.0 steps 4-5).
 */
export function createJudgment(input: CreateJudgmentInput): JudgmentRecord {
  if (typeof input !== 'object' || input === null) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: 'judgment input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'judgmentId',
      'competitionId',
      'submissionId',
      'challengeId',
      'expertRef',
      'type',
      'claim',
      'evidence',
      'note',
      'recordedAt',
      'provenance',
    ],
    'CreateJudgmentInput',
  );
  if (!isJudgmentId(input.judgmentId)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `invalid judgment id: ${JSON.stringify(input.judgmentId)}`,
    });
  }
  if (!isCompetitionId(input.competitionId)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `invalid competition id: ${JSON.stringify(input.competitionId)}`,
    });
  }
  if (!isCompetitionSubmissionId(input.submissionId)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `invalid submission id: ${JSON.stringify(input.submissionId)}`,
    });
  }
  if (input.challengeId !== undefined && input.challengeId !== null && !isChallengeId(input.challengeId)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `invalid challenge id: ${JSON.stringify(input.challengeId)}`,
    });
  }
  requireBoundedString(input.expertRef, 'expertRef');
  if (!isJudgmentType(input.type)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `judgment type is not in the closed six-member AE1.0 vocabulary: ${JSON.stringify(input.type)}`,
      details: { vocabulary: JUDGMENT_TYPES },
    });
  }
  requireBoundedString(input.claim, 'claim');
  // CHALLENGE and the challenge verdicts MUST name their challenge; a
  // bare solution vote must NOT carry one (typed shape, not convention).
  const needsChallenge = input.type === 'accept_challenge' || input.type === 'reject_challenge';
  const hasChallenge = input.challengeId !== undefined && input.challengeId !== null;
  if (needsChallenge !== hasChallenge) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: `judgment type ${input.type} ${
        needsChallenge ? 'REQUIRES' : 'must NOT carry'
      } a challengeId`,
      details: { type: input.type, hasChallenge },
    });
  }
  if (!Array.isArray(input.evidence) || input.evidence.length === 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: 'a judgment REQUIRES at least one evidence item (AE1.0 steps 4-5: challenges and votes carry evidence)',
    });
  }
  const evidence = input.evidence.map((item) => {
    if (!isJudgmentEvidenceKind(item.kind)) {
      throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
        message: `evidence kind is not in the closed vocabulary: ${JSON.stringify(item.kind)}`,
        details: { vocabulary: JUDGMENT_EVIDENCE_KINDS },
      });
    }
    return deepFreeze({
      kind: item.kind,
      evidenceRef: requireBoundedString(item.evidenceRef, 'evidence.evidenceRef'),
      supportsClaim: requireBoundedString(item.supportsClaim, 'evidence.supportsClaim'),
      note: item.note === undefined || item.note === null ? null : item.note,
    });
  });
  if (typeof input.recordedAt !== 'number' || !Number.isFinite(input.recordedAt) || input.recordedAt < 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_JUDGMENT, {
      message: 'recordedAt must be injected epoch milliseconds (never a wall-clock read)',
    });
  }
  return deepFreeze({
    judgmentVersion: JUDGMENT_VERSION,
    judgmentId: input.judgmentId,
    competitionId: input.competitionId,
    submissionId: input.submissionId,
    challengeId: hasChallenge ? (input.challengeId as ChallengeId) : null,
    expertRef: input.expertRef,
    type: input.type,
    claim: input.claim,
    evidence: Object.freeze(evidence),
    note: input.note === undefined || input.note === null ? null : input.note,
    recordedAt: toEscalationTimestamp(input.recordedAt),
    provenance: requireBoundedString(input.provenance, 'provenance'),
  });
}

/** Structural guard for wire values claiming to be judgment records. */
export function isJudgmentRecord(value: unknown): value is JudgmentRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['judgmentVersion'] === JUDGMENT_VERSION &&
    isJudgmentId(candidate['judgmentId']) &&
    isJudgmentType(candidate['type']) &&
    typeof candidate['expertRef'] === 'string' &&
    typeof candidate['claim'] === 'string' &&
    Array.isArray(candidate['evidence']) &&
    candidate['evidence'].length > 0
  );
}
