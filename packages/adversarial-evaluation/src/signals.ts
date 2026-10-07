/**
 * The raw community signal — DISCOVERY-ONLY (Work Order C013; issue
 * #119; spec/adversarial-expert-evaluation.md AE1.0 "Raw community
 * signal" + the C013 rule in spec/human-escalation-work-items.md).
 *
 * THE LAW (structural, not conventional):
 *   - the upvote/downvote ratio is retained as a DISCOVERY signal;
 *   - it MUST NOT by itself be the final correctness authority;
 *   - CommunitySignal's type carries NO verdict field, and the
 *     adjudication engine's inputs EXCLUDE the signal by construction
 *     (see adjudication.ts — its input type has no signal/ratio member
 *     at all; the hygiene suite enforces this textually).
 *
 * The projection counts ONLY guardrail-admitted votes (qualified
 * participants, no self-votes, one vote per principal cluster per
 * submission), small samples are flagged, and zero-vote submissions
 * surface an explicit unknown instead of a 0/0 artefact.
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import type { JudgmentRecord } from './judgments.js';
import { isVoteJudgment } from './judgments.js';
import type {
  CompetitionParticipant,
  CompetitionSubmission,
  GuardrailPolicy,
} from './guardrails.js';
import { qualifiedVotersOnly, smallSampleStatus } from './guardrails.js';
import { deepFreeze } from './shared.js';

/** Wire version of the community-signal shapes. */
export const COMMUNITY_SIGNAL_VERSION = 1 as const;

/** The signal's label — the shared state vocabulary: discovery, NOT verified. */
export const COMMUNITY_SIGNAL_LABEL = 'discovery-signal' as const;

export interface CommunitySignal {
  readonly signalVersion: typeof COMMUNITY_SIGNAL_VERSION;
  readonly competitionId: string;
  readonly submissionId: string;
  readonly label: typeof COMMUNITY_SIGNAL_LABEL;
  readonly upvotes: number;
  readonly downvotes: number;
  /** up / (up + down); NULL when totalVotes is 0 (the honest unknown). */
  readonly ratio: number | null;
  readonly totalVotes: number;
  readonly distinctQualifiedVoters: number;
  readonly smallSample: boolean;
  readonly computedAt: string;
  readonly limitations: readonly string[];
}

export const COMMUNITY_SIGNAL_FIELDS = Object.freeze([
  'signalVersion',
  'competitionId',
  'submissionId',
  'label',
  'upvotes',
  'downvotes',
  'ratio',
  'totalVotes',
  'distinctQualifiedVoters',
  'smallSample',
  'computedAt',
  'limitations',
] as const);

/**
 * Compute the community discovery signal for one submission (pure,
 * deterministic). Deliberately does NOT accept and does NOT return any
 * verdict-bearing field: this type can never masquerade as an
 * adjudication outcome (lock rule 34 / the shared state vocabulary).
 */
export function computeCommunitySignal(input: {
  readonly competitionId: string;
  readonly submissionId: string;
  readonly judgments: readonly JudgmentRecord[];
  readonly participants: readonly CompetitionParticipant[];
  readonly submissions: readonly CompetitionSubmission[];
  readonly policy: GuardrailPolicy;
  readonly now: number;
}): CommunitySignal {
  if (typeof input.competitionId !== 'string' || input.competitionId.length === 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_SIGNAL, {
      message: 'competitionId must be a non-empty string',
    });
  }
  if (typeof input.submissionId !== 'string' || input.submissionId.length === 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_SIGNAL, {
      message: 'submissionId must be a non-empty string',
    });
  }
  const admitted = qualifiedVotersOnly(
    input.judgments,
    input.participants,
    input.submissions,
  ).admitted.filter(
    (judgment) =>
      judgment.submissionId === input.submissionId && isVoteJudgment(judgment.type),
  );
  let upvotes = 0;
  let downvotes = 0;
  const voters = new Set<string>();
  for (const judgment of admitted) {
    if (judgment.type === 'upvote_with_proof') upvotes += 1;
    else if (judgment.type === 'downvote_with_proof') downvotes += 1;
    voters.add(judgment.expertRef);
  }
  const totalVotes = upvotes + downvotes;
  const small = smallSampleStatus(voters.size, input.policy);
  return deepFreeze({
    signalVersion: COMMUNITY_SIGNAL_VERSION,
    competitionId: input.competitionId,
    submissionId: input.submissionId,
    label: COMMUNITY_SIGNAL_LABEL,
    upvotes,
    downvotes,
    ratio: totalVotes === 0 ? null : upvotes / totalVotes,
    totalVotes,
    distinctQualifiedVoters: voters.size,
    smallSample: small.status === 'small-sample',
    computedAt: new Date(input.now).toISOString(),
    limitations: Object.freeze([
      'raw upvote/downvote ratio is a discovery signal only — it can never establish correctness or certification (AE1.0)',
      'counts only guardrail-admitted votes: qualified participants, no self-votes, one vote per principal cluster',
      `small-sample status applies below ${input.policy.minQualifiedVoters} distinct qualified voters`,
    ]),
  });
}

/** Structural guard: a value claiming to be a signal must carry the label. */
export function isCommunitySignal(value: unknown): value is CommunitySignal {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['signalVersion'] === COMMUNITY_SIGNAL_VERSION &&
    candidate['label'] === COMMUNITY_SIGNAL_LABEL &&
    typeof candidate['upvotes'] === 'number' &&
    typeof candidate['downvotes'] === 'number' &&
    (candidate['ratio'] === null || typeof candidate['ratio'] === 'number')
  );
}
