/**
 * The certification boundary (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md AE1.0 "Certification boundary" +
 * docs/LLM-ARCHITECT-FINAL-HANDOFF.md §7 + architecture-lock rule 34).
 *
 * Competition results feed Evaluation / Verification / Certification as
 * CANDIDATE INPUTS through these public ports. They CANNOT redefine
 * certification scope and CANNOT bypass Verifier authority — enforced
 * STRUCTURALLY:
 *
 *   - every feed payload carries the literal `candidateOnly: true`
 *     field (the type is `true`, not boolean — a host cannot construct
 *     a feed that claims finality);
 *   - the feed boundary statement is a frozen literal on every payload;
 *   - no payload carries a scope/authority/level field — exact-field
 *     validation rejects smuggled authority shapes;
 *   - `consumeResultAsCertification` has NO happy path: it always
 *     throws CERTIFICATION_BOUNDARY_VIOLATION (lock rule 34 — the
 *     popularity-cannot-bypass-verification law).
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import type { CompetitionResult } from './adjudication.js';
import { deepFreeze, rejectUnknownFields, requireBoundedString } from './shared.js';

/** Wire version of the candidate-feed shapes. */
export const CERTIFICATION_BOUNDARY_VERSION = 1 as const;

/** The frozen boundary statement every candidate payload carries. */
export const CANDIDATE_FEED_BOUNDARY =
  'competition results are candidate inputs ONLY — they cannot redefine certification scope and cannot bypass Verifier authority (architecture-lock rule 34)' as const;

export const CANDIDATE_FEED_KINDS = Object.freeze([
  'evaluation-candidate',
  'verification-candidate',
  'certification-candidate',
] as const);
export type CandidateFeedKind = (typeof CANDIDATE_FEED_KINDS)[number];

export interface CandidateFeedPayload {
  readonly kind: CandidateFeedKind;
  readonly competitionId: string;
  readonly submissionId: string;
  /** Evidence refs backing the candidate (every claim links its evidence). */
  readonly evidenceRefs: readonly string[];
  readonly candidateOnly: true;
  readonly boundary: typeof CANDIDATE_FEED_BOUNDARY;
}

export const CANDIDATE_FEED_PAYLOAD_FIELDS = Object.freeze([
  'kind',
  'competitionId',
  'submissionId',
  'evidenceRefs',
  'candidateOnly',
  'boundary',
] as const);

export interface CompetitionCandidateFeed {
  readonly feedVersion: typeof CERTIFICATION_BOUNDARY_VERSION;
  readonly competitionId: string;
  readonly source: 'adversarial-evaluation';
  readonly payloads: readonly CandidateFeedPayload[];
}

/**
 * Project a competition result into the three public candidate feeds
 * (Evaluation / Verification / Certification). The winner and every
 * ranked solution become candidates — NEVER verdicts of those systems.
 */
export function toCandidateFeeds(
  result: CompetitionResult,
  evidenceRefsBySubmission: Readonly<Record<string, readonly string[]>>,
): CompetitionCandidateFeed {
  const payloads: CandidateFeedPayload[] = [];
  for (const ranked of result.rankedSolutions) {
    const evidenceRefs = evidenceRefsBySubmission[ranked.submissionId] ?? [];
    for (const kind of CANDIDATE_FEED_KINDS) {
      payloads.push(
        deepFreeze({
          kind,
          competitionId: result.competitionId,
          submissionId: ranked.submissionId,
          evidenceRefs: Object.freeze([...evidenceRefs]),
          candidateOnly: true as const,
          boundary: CANDIDATE_FEED_BOUNDARY,
        }),
      );
    }
  }
  return deepFreeze({
    feedVersion: CERTIFICATION_BOUNDARY_VERSION,
    competitionId: result.competitionId,
    source: 'adversarial-evaluation' as const,
    payloads: Object.freeze(payloads),
  });
}

/** Strict re-materialisation of a candidate payload (exact-field, fail-closed). */
export function createCandidateFeedPayload(input: {
  readonly kind: string;
  readonly competitionId: string;
  readonly submissionId: string;
  readonly evidenceRefs: readonly string[];
  readonly candidateOnly: boolean;
  readonly boundary: string;
}): CandidateFeedPayload {
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    CANDIDATE_FEED_PAYLOAD_FIELDS,
    'CandidateFeedPayload',
  );
  if (!(CANDIDATE_FEED_KINDS as readonly string[]).includes(input.kind)) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.CERTIFICATION_BOUNDARY_VIOLATION,
      { message: `unknown candidate feed kind: ${JSON.stringify(input.kind)}` },
    );
  }
  requireBoundedString(input.competitionId, 'competitionId');
  requireBoundedString(input.submissionId, 'submissionId');
  if (input.candidateOnly !== true) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.CERTIFICATION_BOUNDARY_VIOLATION,
      {
        message: 'a candidate feed payload must carry candidateOnly: true — competition results are never final verdicts',
      },
    );
  }
  if (input.boundary !== CANDIDATE_FEED_BOUNDARY) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.CERTIFICATION_BOUNDARY_VIOLATION,
      { message: 'the candidate feed boundary statement is frozen and mandatory' },
    );
  }
  if (!Array.isArray(input.evidenceRefs)) {
    throw new AdversarialEvaluationError(
      ADVERSARIAL_EVALUATION_ERROR_CODES.CERTIFICATION_BOUNDARY_VIOLATION,
      { message: 'evidenceRefs must be an array' },
    );
  }
  return deepFreeze({
    kind: input.kind as CandidateFeedKind,
    competitionId: input.competitionId,
    submissionId: input.submissionId,
    evidenceRefs: Object.freeze([...input.evidenceRefs]),
    candidateOnly: true as const,
    boundary: CANDIDATE_FEED_BOUNDARY,
  });
}

/**
 * THE LOCK RULE 34 GUARD — consuming a competition result AS a
 * certification has NO happy path: it ALWAYS throws. Raw popularity
 * (or any aggregate of it) can never bypass Verification authority.
 */
export function consumeResultAsCertification(result: CompetitionResult): never {
  throw new AdversarialEvaluationError(
    ADVERSARIAL_EVALUATION_ERROR_CODES.CERTIFICATION_BOUNDARY_VIOLATION,
    {
      message: `competition result ${result.resultId} cannot be consumed as a certification — competition results are candidate inputs only (architecture-lock rule 34)`,
      details: { competitionId: result.competitionId, outcome: result.outcome },
    },
  );
}

/** Structural guard for wire values claiming to be candidate feeds. */
export function isCompetitionCandidateFeed(value: unknown): value is CompetitionCandidateFeed {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['feedVersion'] === CERTIFICATION_BOUNDARY_VERSION &&
    candidate['source'] === 'adversarial-evaluation' &&
    Array.isArray(candidate['payloads'])
  );
}
