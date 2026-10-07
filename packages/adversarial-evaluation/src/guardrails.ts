/**
 * The structurally enforced guardrail battery (Work Order C013; issue
 * #119; spec/adversarial-expert-evaluation.md AE1.0 "Raw community
 * signal" guardrail list + docs/LLM-ARCHITECT-FINAL-HANDOFF.md §7/§18).
 *
 * AE1.0 guardrails, EACH a pure TESTED filter (never a convention
 * comment):
 *
 *   1. no self-voting                       — assertNoSelfVoting
 *   2. conflict-of-interest exclusion        — assertNoConflictOfInterest
 *   3. duplicate-account protection          — assertNoDuplicateAccount
 *   4. rate limiting (brigading)             — assertRateLimit
 *   5. qualification-aware visibility        — qualificationAwareVisibility
 *   6. qualification-aware aggregation       — qualifiedVotersOnly projections
 *   7. minimum vote threshold                — minimumVoteThreshold
 *   8. minimum evidence threshold            — minimumEvidenceThreshold
 *   9. small-sample status                   — smallSampleStatus
 *  10. tie/uncertainty handling              — tieStatus
 *
 * evaluateJudgmentGuardrails composes 1-6 into the single fail-closed
 * admission decision every cast vote must pass. Any violation DENIES —
 * there is no override, and the violations carry the closed
 * machine-readable code vocabulary.
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import type { JudgmentRecord, JudgmentType } from './judgments.js';
import { isVoteJudgment } from './judgments.js';
import { deepFreeze, requirePositiveInt } from './shared.js';

/** Wire version of the guardrail shapes. */
export const GUARDRAIL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The closed guardrail violation vocabulary
// ---------------------------------------------------------------------------

export const GUARDRAIL_VIOLATION_CODES = Object.freeze([
  'self-voting-detected',
  'conflict-of-interest',
  'duplicate-account',
  'rate-limit-exceeded',
  'insufficient-qualification',
  'below-minimum-votes',
  'below-minimum-evidence',
  'small-sample',
  'tie-uncertainty',
] as const);
export type GuardrailViolationCode = (typeof GUARDRAIL_VIOLATION_CODES)[number];

export function isGuardrailViolationCode(value: unknown): value is GuardrailViolationCode {
  return (
    typeof value === 'string' &&
    (GUARDRAIL_VIOLATION_CODES as readonly string[]).includes(value)
  );
}

export interface GuardrailViolation {
  readonly code: GuardrailViolationCode;
  readonly detail: string;
}

export interface GuardrailDecision {
  readonly guardrailVersion: typeof GUARDRAIL_VERSION;
  readonly allowed: boolean;
  readonly violations: readonly GuardrailViolation[];
}

// ---------------------------------------------------------------------------
// The competition participant (qualification + identity cluster + COI)
// ---------------------------------------------------------------------------

export interface CompetitionParticipant {
  readonly expertRef: string;
  readonly tenant: string;
  /**
   * The identity-cluster ref the duplicate-account guardrail dedupes on
   * (one human controlling multiple expert accounts — the structural
   * answer to vote inflation / brigading by puppet accounts).
   */
  readonly principalClusterRef: string;
  /** Qualified in the task's required skills (C004/C005-informed). */
  readonly qualified: boolean;
  /** Submission ids / expert refs this participant declared a conflict with. */
  readonly declaredConflicts: readonly string[];
  readonly joinedAt: string;
}

export interface CompetitionSubmission {
  readonly submissionId: string;
  readonly competitionId: string;
  readonly authorExpertRef: string;
  readonly submittedAt: string;
}

// ---------------------------------------------------------------------------
// The guardrail policy (versioned, explicit — never ambient defaults)
// ---------------------------------------------------------------------------

export interface GuardrailPolicy {
  readonly policyVersion: 1;
  /** Minimum distinct qualified voters before any aggregation is trusted. */
  readonly minQualifiedVoters: number;
  /** Minimum evidence items per judgment. */
  readonly minEvidenceItems: number;
  /** Rate limit: max judgments per expert per window. */
  readonly maxJudgmentsPerExpertPerWindow: number;
  /** Rate-limit window in epoch ms. */
  readonly rateLimitWindowMs: number;
}

export const DEFAULT_GUARDRAIL_POLICY: GuardrailPolicy = Object.freeze({
  policyVersion: 1,
  minQualifiedVoters: 3,
  minEvidenceItems: 1,
  maxJudgmentsPerExpertPerWindow: 10,
  rateLimitWindowMs: 60 * 60 * 1000,
});

export function validateGuardrailPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  requirePositiveInt(policy.minQualifiedVoters, 'minQualifiedVoters', 1000);
  requirePositiveInt(policy.minEvidenceItems, 'minEvidenceItems', 100);
  requirePositiveInt(
    policy.maxJudgmentsPerExpertPerWindow,
    'maxJudgmentsPerExpertPerWindow',
    10000,
  );
  if (typeof policy.rateLimitWindowMs !== 'number' || !Number.isFinite(policy.rateLimitWindowMs) || policy.rateLimitWindowMs <= 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.GUARDRAIL_VIOLATION, {
      message: 'rateLimitWindowMs must be a positive finite number of epoch milliseconds',
    });
  }
  return Object.freeze({ ...policy });
}

// ---------------------------------------------------------------------------
// Guardrails 1-6: the fail-closed judgment admission battery
// ---------------------------------------------------------------------------

const AUTHOR_OF = 'author-of-submission';

function authorOfSubmission(
  submissionId: string,
  submissions: readonly CompetitionSubmission[],
): string | null {
  for (const submission of submissions) {
    if (submission.submissionId === submissionId) return submission.authorExpertRef;
  }
  return null;
}

/**
 * Guardrail 1 — NO SELF-VOTING (and no self-challenging): a participant
 * may not cast a vote-shaped judgment on their own submission, nor
 * challenge their own solution. The filter is against the AUTHOR of the
 * targeted submission, not a name similarity.
 */
export function assertNoSelfVoting(
  judgment: JudgmentRecord,
  submissions: readonly CompetitionSubmission[],
): GuardrailDecision {
  const author = authorOfSubmission(judgment.submissionId, submissions);
  const violations: GuardrailViolation[] = [];
  if (author !== null && author === judgment.expertRef) {
    violations.push({
      code: 'self-voting-detected',
      detail: `expert ${judgment.expertRef} attempted to judge submission ${judgment.submissionId} authored by themselves (${AUTHOR_OF})`,
    });
  }
  return decisionOf(violations);
}

/**
 * Guardrail 2 — CONFLICT-OF-INTEREST EXCLUSION: a participant who
 * declared a conflict (with the submission id or its author) is excluded
 * from judging that submission. Undeclared-but-detected conflicts are the
 * C020 network-quality system's domain; this filter enforces the DECLARED
 * exclusion deterministically.
 */
export function assertNoConflictOfInterest(
  judgment: JudgmentRecord,
  participant: CompetitionParticipant | undefined,
  submissions: readonly CompetitionSubmission[],
): GuardrailDecision {
  const violations: GuardrailViolation[] = [];
  if (participant === undefined) {
    violations.push({
      code: 'conflict-of-interest',
      detail: `expert ${judgment.expertRef} is not a recorded participant of this competition`,
    });
    return decisionOf(violations);
  }
  const author = authorOfSubmission(judgment.submissionId, submissions);
  const targets: readonly string[] = [judgment.submissionId, ...(author === null ? [] : [author])];
  for (const declared of participant.declaredConflicts) {
    if (targets.includes(declared)) {
      violations.push({
        code: 'conflict-of-interest',
        detail: `expert ${judgment.expertRef} declared a conflict with ${declared} and is excluded from judging submission ${judgment.submissionId}`,
      });
    }
  }
  return decisionOf(violations);
}

/**
 * Guardrail 3 — DUPLICATE-ACCOUNT PROTECTION: one principal cluster may
 * cast AT MOST ONE vote-shaped judgment per submission. A second expert
 * account from the same cluster voting the same submission is vote
 * inflation — denied and machine-readable.
 */
export function assertNoDuplicateAccount(
  judgment: JudgmentRecord,
  participants: readonly CompetitionParticipant[],
  priorJudgments: readonly JudgmentRecord[],
): GuardrailDecision {
  const violations: GuardrailViolation[] = [];
  const clusterOf = (expertRef: string): string | null => {
    for (const participant of participants) {
      if (participant.expertRef === expertRef) return participant.principalClusterRef;
    }
    return null;
  };
  const ownCluster = clusterOf(judgment.expertRef);
  if (ownCluster !== null && isVoteJudgment(judgment.type)) {
    for (const prior of priorJudgments) {
      if (prior.submissionId !== judgment.submissionId || !isVoteJudgment(prior.type)) continue;
      if (prior.expertRef === judgment.expertRef) continue; // same account = rate-limit domain
      const priorCluster = clusterOf(prior.expertRef);
      if (priorCluster !== null && priorCluster === ownCluster) {
        violations.push({
          code: 'duplicate-account',
          detail: `principal cluster ${ownCluster} already voted on submission ${judgment.submissionId} via expert ${prior.expertRef} — duplicate-account vote inflation denied`,
        });
        break;
      }
    }
  }
  return decisionOf(violations);
}

/**
 * Guardrail 4 — RATE LIMITING (brigading): an expert may cast at most
 * `maxJudgmentsPerExpertPerWindow` judgments inside the trailing window.
 * Rapid-fire judgment bursts are denied regardless of content.
 */
export function assertRateLimit(
  judgment: JudgmentRecord,
  priorJudgments: readonly JudgmentRecord[],
  policy: GuardrailPolicy,
): GuardrailDecision {
  const violations: GuardrailViolation[] = [];
  const recordedAtMs = Date.parse(judgment.recordedAt);
  let inWindow = 0;
  for (const prior of priorJudgments) {
    if (prior.expertRef !== judgment.expertRef) continue;
    const priorMs = Date.parse(prior.recordedAt);
    if (priorMs > recordedAtMs - policy.rateLimitWindowMs && priorMs <= recordedAtMs) {
      inWindow += 1;
    }
  }
  if (inWindow >= policy.maxJudgmentsPerExpertPerWindow) {
    violations.push({
      code: 'rate-limit-exceeded',
      detail: `expert ${judgment.expertRef} already cast ${inWindow} judgments within the ${policy.rateLimitWindowMs}ms window (max ${policy.maxJudgmentsPerExpertPerWindow}) — brigading denied`,
    });
  }
  return decisionOf(violations);
}

/**
 * Guardrail 5 — QUALIFICATION-AWARE VISIBILITY: only participants
 * qualified in the task's required skills may see (and therefore judge)
 * the competition's submissions. Unqualified participants get a typed
 * denied projection — never a silent partial view.
 */
export function qualificationAwareVisibility(
  participant: CompetitionParticipant,
): {
  readonly visible: boolean;
  readonly reason: string;
} {
  if (!participant.qualified) {
    return {
      visible: false,
      reason: `expert ${participant.expertRef} is not qualified for this competition's required skills — submissions and judgments are hidden (qualification-aware visibility)`,
    };
  }
  return {
    visible: true,
    reason: `expert ${participant.expertRef} is qualified — full competition visibility`,
  };
}

/**
 * Guardrail 6 — QUALIFICATION-AWARE AGGREGATION: the projection of
 * judgments that may enter ANY aggregate (signals, adjudication):
 * qualified participants only, no self-votes, no duplicate-cluster
 * votes. Every excluded judgment is returned with its typed reason so
 * the aggregate is auditable.
 */
export function qualifiedVotersOnly(
  judgments: readonly JudgmentRecord[],
  participants: readonly CompetitionParticipant[],
  submissions: readonly CompetitionSubmission[],
): {
  readonly admitted: readonly JudgmentRecord[];
  readonly excluded: readonly { readonly judgmentId: string; readonly reason: string }[];
} {
  const admitted: JudgmentRecord[] = [];
  const excluded: { judgmentId: string; reason: string }[] = [];
  const byExpert = new Map<string, CompetitionParticipant>();
  for (const participant of participants) byExpert.set(participant.expertRef, participant);
  const seenVotePerSubmissionPerCluster = new Set<string>();
  for (const judgment of judgments) {
    const participant = byExpert.get(judgment.expertRef);
    if (participant === undefined) {
      excluded.push({
        judgmentId: judgment.judgmentId,
        reason: 'not-a-recorded-participant',
      });
      continue;
    }
    if (!participant.qualified) {
      excluded.push({
        judgmentId: judgment.judgmentId,
        reason: 'insufficient-qualification',
      });
      continue;
    }
    const author = authorOfSubmission(judgment.submissionId, submissions);
    if (author !== null && author === judgment.expertRef) {
      excluded.push({ judgmentId: judgment.judgmentId, reason: 'self-voting-detected' });
      continue;
    }
    if (isVoteJudgment(judgment.type)) {
      const key = `${participant.principalClusterRef}:${judgment.submissionId}`;
      if (seenVotePerSubmissionPerCluster.has(key)) {
        excluded.push({
          judgmentId: judgment.judgmentId,
          reason: 'duplicate-account',
        });
        continue;
      }
      seenVotePerSubmissionPerCluster.add(key);
    }
    admitted.push(judgment);
  }
  return deepFreeze({ admitted: Object.freeze(admitted), excluded: Object.freeze(excluded) });
}

// ---------------------------------------------------------------------------
// Guardrails 7-10: threshold / small-sample / tie statuses
// ---------------------------------------------------------------------------

/** Guardrail 7 — minimum vote threshold. */
export function minimumVoteThreshold(
  distinctQualifiedVoters: number,
  policy: GuardrailPolicy,
): { readonly met: boolean; readonly required: number; readonly actual: number } {
  return deepFreeze({
    met: distinctQualifiedVoters >= policy.minQualifiedVoters,
    required: policy.minQualifiedVoters,
    actual: distinctQualifiedVoters,
  });
}

/** Guardrail 8 — minimum evidence threshold. */
export function minimumEvidenceThreshold(
  evidenceCount: number,
  policy: GuardrailPolicy,
): { readonly met: boolean; readonly required: number; readonly actual: number } {
  return deepFreeze({
    met: evidenceCount >= policy.minEvidenceItems,
    required: policy.minEvidenceItems,
    actual: evidenceCount,
  });
}

/** Guardrail 9 — small-sample status (the honest label, never a hidden decay). */
export function smallSampleStatus(
  distinctQualifiedVoters: number,
  policy: GuardrailPolicy,
): { readonly status: 'small-sample' | 'adequate'; readonly threshold: number } {
  return deepFreeze({
    status:
      distinctQualifiedVoters > 0 && distinctQualifiedVoters < policy.minQualifiedVoters
        ? 'small-sample'
        : 'adequate',
    threshold: policy.minQualifiedVoters,
  });
}

/** Guardrail 10 — tie/uncertainty handling (explicit, never silent). */
export function tieStatus(
  topStrength: number,
  runnerUpStrength: number,
  epsilon: number = 1e-9,
): { readonly status: 'tie' | 'decided'; readonly margin: number } {
  const margin = topStrength - runnerUpStrength;
  return deepFreeze({
    status: Math.abs(margin) <= epsilon ? 'tie' : 'decided',
    margin,
  });
}

// ---------------------------------------------------------------------------
// The composed fail-closed admission decision
// ---------------------------------------------------------------------------

export interface EvaluateJudgmentGuardrailsInput {
  readonly judgment: JudgmentRecord;
  readonly participants: readonly CompetitionParticipant[];
  readonly submissions: readonly CompetitionSubmission[];
  readonly priorJudgments: readonly JudgmentRecord[];
  readonly policy: GuardrailPolicy;
}

/**
 * The SINGLE admission decision every cast judgment must pass (AE1.0
 * guardrails 1-6 composed): self-voting, conflict-of-interest,
 * duplicate-account, rate limiting, qualification-aware visibility.
 * FAIL-CLOSED — any violation denies; there is no override path.
 */
export function evaluateJudgmentGuardrails(
  input: EvaluateJudgmentGuardrailsInput,
): GuardrailDecision {
  const policy = validateGuardrailPolicy(input.policy);
  const participant = input.participants.find(
    (candidate) => candidate.expertRef === input.judgment.expertRef,
  );
  const violations: GuardrailViolation[] = [];
  if (participant === undefined) {
    violations.push({
      code: 'conflict-of-interest',
      detail: `expert ${input.judgment.expertRef} is not a recorded participant — judgment denied (fail closed)`,
    });
  } else {
    const visibility = qualificationAwareVisibility(participant);
    if (!visibility.visible) {
      violations.push({
        code: 'insufficient-qualification',
        detail: visibility.reason,
      });
    }
  }
  violations.push(...assertNoSelfVoting(input.judgment, input.submissions).violations);
  violations.push(
    ...assertNoConflictOfInterest(input.judgment, participant, input.submissions).violations,
  );
  violations.push(
    ...assertNoDuplicateAccount(input.judgment, input.participants, input.priorJudgments)
      .violations,
  );
  violations.push(...assertRateLimit(input.judgment, input.priorJudgments, policy).violations);
  if (input.judgment.evidence.length < policy.minEvidenceItems) {
    violations.push({
      code: 'below-minimum-evidence',
      detail: `judgment carries ${input.judgment.evidence.length} evidence items (min ${policy.minEvidenceItems})`,
    });
  }
  return deepFreeze({
    guardrailVersion: GUARDRAIL_VERSION,
    allowed: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

function decisionOf(violations: readonly GuardrailViolation[]): GuardrailDecision {
  return deepFreeze({
    guardrailVersion: GUARDRAIL_VERSION,
    allowed: violations.length === 0,
    violations: Object.freeze([...violations]),
  });
}

/** The vote direction of a vote-shaped judgment (null otherwise). */
export function voteDirectionOf(type: JudgmentType): 'up' | 'down' | null {
  if (type === 'upvote_with_proof') return 'up';
  if (type === 'downvote_with_proof') return 'down';
  return null;
}
