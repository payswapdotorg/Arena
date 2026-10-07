/**
 * Evidence-weighted adjudication (Work Order C013; issue #119; spec/
 * adversarial-expert-evaluation.md AE1.0 "Evidence-weighted
 * adjudication" + "Certification boundary").
 *
 * THE INPUT LIST (AE1.0, all seven, all REQUIRED to be represented in
 * the derivation — never raw popularity as truth):
 *   - qualified expert votes;
 *   - challenge validity;
 *   - evidence quality;
 *   - verifier outcome (the A013 projection — final verification
 *     authority STAYS in Verification, never here);
 *   - task-specific evaluator (the A012 projection);
 *   - historical calibration (the C005 read surface projection);
 *   - agreement/disagreement patterns (the C005 read surface projection).
 *
 * AGGREGATION — deterministic, versioned, disclosed:
 *   1. every admitted vote is weighted by evidenceQuality x
 *      calibrationWeight x agreementWeight (never a raw count);
 *   2. pairwise contests are induced from SHARED voters (an expert who
 *      voted on both solutions prefers the one they upvoted);
 *   3. Bradley-Terry-style iterative strength fitting over the contest
 *      matrix (fixed 32 iterations, uniform 0.5 initialisation —
 *      deterministic given identical inputs);
 *   4. the final result derivation applies the verification boundary:
 *      a solution whose verifier outcome is FAIL is excluded from the
 *      verified result; UNKNOWN defers the whole competition to
 *      needs_more_evidence; ties and small samples surface EXPLICIT
 *      tie/unknown states (never a coin-flip winner).
 *
 * THE DISCOVERY-SIGNAL LAW (structural): AdjudicationInputs has NO
 * member carrying the raw upvote/downvote ratio or the community
 * signal — the engine cannot read it, so it cannot drive a verdict.
 * The hygiene suite enforces this textually as well.
 *
 * CERTIFICATION BOUNDARY (lock rule 34): the CompetitionResult is a
 * CANDIDATE input to Evaluation/Verification/Certification through the
 * public ports in certification.ts; it is never a certification and
 * carries no scope/authority field (exact-field validation).
 */

import { AdversarialEvaluationError, ADVERSARIAL_EVALUATION_ERROR_CODES } from './errors.js';
import { tieStatus } from './guardrails.js';
import type { GuardrailPolicy } from './guardrails.js';
import { deepFreeze, rejectUnknownFields, requireBoundedString, requireUnitInterval } from './shared.js';
import type { CompetitionResultId } from './shared.js';
import { isCompetitionResultId } from './shared.js';

/** The aggregation formula version — bump on ANY semantic change. */
export const ADJUDICATION_FORMULA_VERSION = 1 as const;

/** Wire version of the adjudication shapes. */
export const ADJUDICATION_WIRE_VERSION = 1 as const;

/** Bradley-Terry iteration budget (fixed => deterministic). */
export const BRADLEY_TERRY_ITERATIONS = 32 as const;

// ---------------------------------------------------------------------------
// Reason vocabulary (closed, machine-readable)
// ---------------------------------------------------------------------------

export const ADJUDICATION_REASON_CODES = Object.freeze([
  'qualified-votes-aggregated',
  'challenge-validity-applied',
  'evidence-quality-weighted',
  'verifier-outcome-pass',
  'verifier-outcome-fail',
  'verifier-outcome-unknown',
  'evaluator-meets-criteria',
  'evaluator-below-criteria',
  'evaluator-inconclusive',
  'calibration-weighted',
  'agreement-pattern-applied',
  'pairwise-bradley-terry-fitted',
  'tie-uncertainty',
  'small-sample',
  'insufficient-participation',
] as const);
export type AdjudicationReasonCode = (typeof ADJUDICATION_REASON_CODES)[number];

export interface AdjudicationReason {
  readonly code: AdjudicationReasonCode;
  readonly detail: string;
  readonly ref: string | null;
}

// ---------------------------------------------------------------------------
// The outcome vocabulary (closed)
// ---------------------------------------------------------------------------

export const COMPETITION_RESULT_OUTCOMES = Object.freeze([
  'verified_result',
  'needs_more_evidence',
  'tie_unknown',
  'insufficient_participation',
] as const);
export type CompetitionResultOutcome = (typeof COMPETITION_RESULT_OUTCOMES)[number];

export const SOLUTION_VERDICTS = Object.freeze([
  'winner',
  'ranked',
  'rejected',
  'needs_more_evidence',
] as const);
export type SolutionVerdict = (typeof SOLUTION_VERDICTS)[number];

// ---------------------------------------------------------------------------
// The AE1.0 input list (typed projections of the merged dep fabrics)
// ---------------------------------------------------------------------------

/** One admitted qualified vote, evidence- and calibration-weighted. */
export interface QualifiedVoteInput {
  readonly expertRef: string;
  readonly direction: 'up' | 'down';
  /** Evidence quality in [0,1] (A013-informed assessment of the proof). */
  readonly evidenceQuality: number;
  /** Historical calibration weight in [0,1] (C005 read surface). */
  readonly calibrationWeight: number;
}

/** One challenge with its (adjudicated) validity + evidence quality. */
export interface ChallengeValidityInput {
  readonly challengeId: string;
  readonly validity: 'accepted' | 'rejected' | 'undecided';
  readonly evidenceQuality: number;
}

/** The A013 verifier outcome projection (pass | fail | unknown — never a score here). */
export interface VerifierOutcomeInput {
  readonly outcome: 'pass' | 'fail' | 'unknown';
  readonly recordDigest: string | null;
}

/** The A012 task-specific evaluator projection. */
export interface EvaluatorOutcomeInput {
  readonly outcome: 'meets-criteria' | 'below-criteria' | 'inconclusive';
  readonly recordDigest: string | null;
}

/** The C005 agreement/disagreement pattern projection for one expert. */
export interface AgreementPatternInput {
  readonly expertRef: string;
  readonly agreements: number;
  readonly disagreements: number;
}

/** All adjudication inputs for ONE solution. */
export interface SolutionAdjudicationInput {
  readonly submissionId: string;
  readonly authorExpertRef: string;
  readonly votes: readonly QualifiedVoteInput[];
  readonly challenges: readonly ChallengeValidityInput[];
  readonly verifierOutcome: VerifierOutcomeInput;
  readonly evaluatorOutcome: EvaluatorOutcomeInput;
}

/**
 * The complete adjudication input set. NOTE (the structural law): there
 * is NO member for the raw community ratio / discovery signal — the
 * engine cannot consume it even if a host tries to pass it
 * (exact-field validation rejects unknown members; the hygiene suite
 * asserts the source never mentions a ratio member).
 */
export interface AdjudicationInputs {
  readonly competitionId: string;
  readonly tenantId: string;
  readonly solutions: readonly SolutionAdjudicationInput[];
  readonly agreementPatterns: readonly AgreementPatternInput[];
  readonly policy: GuardrailPolicy;
  readonly now: number;
  /** Optional caller-supplied result id (determinism/replay); generated when absent. */
  readonly resultId?: string;
}

export const ADJUDICATION_INPUT_FIELDS = Object.freeze([
  'competitionId',
  'tenantId',
  'solutions',
  'agreementPatterns',
  'policy',
  'now',
  'resultId',
] as const);

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export interface RankedSolution {
  readonly submissionId: string;
  readonly verdict: SolutionVerdict;
  /** Bradley-Terry strength (sum-normalised across ranked solutions). */
  readonly btStrength: number;
  /** The evidence-weighted vote score (disclosed for auditability). */
  readonly weightedScore: number;
  readonly acceptedChallenges: number;
  readonly rejectedChallenges: number;
  readonly qualifiedVoters: number;
}

export interface CompetitionResult {
  readonly resultVersion: typeof ADJUDICATION_WIRE_VERSION;
  readonly resultId: CompetitionResultId;
  readonly competitionId: string;
  readonly tenantId: string;
  readonly formulaVersion: typeof ADJUDICATION_FORMULA_VERSION;
  readonly outcome: CompetitionResultOutcome;
  readonly winnerSubmissionId: string | null;
  readonly rankedSolutions: readonly RankedSolution[];
  readonly reasons: readonly AdjudicationReason[];
  readonly computedAt: string;
  readonly limitations: readonly string[];
}

export const COMPETITION_RESULT_FIELDS = Object.freeze([
  'resultVersion',
  'resultId',
  'competitionId',
  'tenantId',
  'formulaVersion',
  'outcome',
  'winnerSubmissionId',
  'rankedSolutions',
  'reasons',
  'computedAt',
  'limitations',
] as const);

// ---------------------------------------------------------------------------
// Evidence-weighted aggregation internals (pure, deterministic)
// ---------------------------------------------------------------------------

function agreementWeightOf(patterns: readonly AgreementPatternInput[], expertRef: string): number {
  for (const pattern of patterns) {
    if (pattern.expertRef === expertRef) {
      const total = pattern.agreements + pattern.disagreements;
      return total === 0 ? 0.5 : pattern.agreements / total;
    }
  }
  return 0.5;
}

function weightedScoreOf(solution: SolutionAdjudicationInput, patterns: readonly AgreementPatternInput[]): number {
  let score = 0;
  for (const vote of solution.votes) {
    const directionSign = vote.direction === 'up' ? 1 : -1;
    score +=
      directionSign * vote.evidenceQuality * vote.calibrationWeight * agreementWeightOf(patterns, vote.expertRef);
  }
  // Accepted challenges against the solution reduce its standing by
  // their evidence quality (challenge validity is an AE1.0 input).
  for (const challenge of solution.challenges) {
    if (challenge.validity === 'accepted') {
      score -= challenge.evidenceQuality;
    } else if (challenge.validity === 'rejected') {
      score += challenge.evidenceQuality * 0.5;
    }
  }
  return score;
}

/**
 * Bradley-Terry-style iterative fitting over the pairwise contest
 * matrix induced from SHARED qualified voters. Deterministic: uniform
 * 0.5 initialisation, fixed iteration budget, epsilon-stable division.
 */
export function fitBradleyTerryStrengths(
  solutions: readonly SolutionAdjudicationInput[],
): readonly number[] {
  const n = solutions.length;
  if (n === 0) return [];
  // wins[i][j] = weighted wins of i over j (from shared voters).
  const wins: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const a = solutions[i];
      const b = solutions[j];
      if (a === undefined || b === undefined) continue;
      const votesOfAByExpert = new Map(a.votes.map((vote) => [vote.expertRef, vote]));
      for (const voteB of b.votes) {
        const voteA = votesOfAByExpert.get(voteB.expertRef);
        if (voteA === undefined) continue;
        if (voteA.direction === voteB.direction) continue;
        const weight =
          voteA.evidenceQuality * voteA.calibrationWeight * voteB.evidenceQuality * voteB.calibrationWeight;
        const winnerIndex = voteA.direction === 'up' ? i : j;
        const row = wins[winnerIndex];
        if (row === undefined) continue;
        const loserIndex = winnerIndex === i ? j : i;
        row[loserIndex] = (row[loserIndex] ?? 0) + weight;
      }
    }
  }
  let strengths = Array.from({ length: n }, () => 0.5);
  for (let iteration = 0; iteration < BRADLEY_TERRY_ITERATIONS; iteration += 1) {
    const next = Array.from({ length: n }, () => 0);
    for (let i = 0; i < n; i += 1) {
      let winsI = 0;
      let denom = 0;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const w = wins[i]?.[j] ?? 0;
        const l = wins[j]?.[i] ?? 0;
        winsI += w;
        const pi = strengths[i] ?? 0.5;
        const pj = strengths[j] ?? 0.5;
        denom += (w + l) / (pi + pj || 1e-9);
      }
      next[i] = denom === 0 ? piKeep(strengths[i]) : winsI / denom;
    }
    strengths = next;
  }
  // Normalise to sum 1 (disclosed as the strength scale).
  const total = strengths.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return strengths.map(() => 1 / n);
  return strengths.map((value) => value / total);
}

function piKeep(value: number | undefined): number {
  return value === undefined ? 0.5 : value;
}

function countChallenges(solution: SolutionAdjudicationInput, validity: 'accepted' | 'rejected'): number {
  let count = 0;
  for (const challenge of solution.challenges) {
    if (challenge.validity === validity) count += 1;
  }
  return count;
}

function countVoters(solution: SolutionAdjudicationInput): number {
  const voters = new Set<string>();
  for (const vote of solution.votes) voters.add(vote.expertRef);
  return voters.size;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Derive the competition result from the AE1.0 input list
 * (deterministic given identical inputs; versioned formula; disclosed
 * limitations). The verifier outcome boundary is applied AFTER
 * aggregation: verification FAIL excludes a solution from the verified
 * result; verification UNKNOWN defers the whole competition.
 */
export function deriveCompetitionResult(input: AdjudicationInputs): CompetitionResult {
  if (typeof input !== 'object' || input === null) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: 'adjudication input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    ADJUDICATION_INPUT_FIELDS,
    'AdjudicationInputs',
  );
  requireBoundedString(input.competitionId, 'competitionId');
  requireBoundedString(input.tenantId, 'tenantId');
  if (!Array.isArray(input.solutions) || input.solutions.length === 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: 'adjudication requires at least one solution input',
    });
  }
  for (const solution of input.solutions) {
    requireBoundedString(solution.submissionId, 'solutions.submissionId');
    requireBoundedString(solution.authorExpertRef, 'solutions.authorExpertRef');
    for (const vote of solution.votes) {
      requireBoundedString(vote.expertRef, 'votes.expertRef');
      requireUnitInterval(vote.evidenceQuality, 'votes.evidenceQuality');
      requireUnitInterval(vote.calibrationWeight, 'votes.calibrationWeight');
      if (vote.direction !== 'up' && vote.direction !== 'down') {
        throw new AdversarialEvaluationError(
          ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION,
          { message: `vote direction must be 'up' | 'down' (got ${JSON.stringify(vote.direction)})` },
        );
      }
    }
    for (const challenge of solution.challenges) {
      requireBoundedString(challenge.challengeId, 'challenges.challengeId');
      requireUnitInterval(challenge.evidenceQuality, 'challenges.evidenceQuality');
      if (!['accepted', 'rejected', 'undecided'].includes(challenge.validity)) {
        throw new AdversarialEvaluationError(
          ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION,
          {
            message: `challenge validity must be accepted | rejected | undecided (got ${JSON.stringify(challenge.validity)})`,
          },
        );
      }
    }
  }
  if (typeof input.now !== 'number' || !Number.isFinite(input.now) || input.now < 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: 'now must be injected epoch milliseconds (never a wall-clock read)',
    });
  }
  const resultId =
    input.resultId === undefined
      ? (`crs_${crypto.randomUUID().replaceAll('-', '')}` as CompetitionResultId)
      : (requireBoundedString(input.resultId, 'resultId') as CompetitionResultId);

  const reasons: AdjudicationReason[] = [];
  reasons.push({
    code: 'qualified-votes-aggregated',
    detail: `${input.solutions.reduce((sum, solution) => sum + solution.votes.length, 0)} qualified expert votes aggregated across ${input.solutions.length} solutions`,
    ref: null,
  });
  reasons.push({
    code: 'evidence-quality-weighted',
    detail: 'every vote weighted by evidenceQuality x calibrationWeight x agreementWeight — never a raw count',
    ref: null,
  });
  if (input.agreementPatterns.length > 0) {
    reasons.push({
      code: 'agreement-pattern-applied',
      detail: `${input.agreementPatterns.length} C005 agreement/disagreement pattern projections applied`,
      ref: null,
    });
  }
  reasons.push({
    code: 'calibration-weighted',
    detail: 'historical calibration weights (C005 read surface) applied per expert',
    ref: null,
  });
  const anyChallenge = input.solutions.some((solution) => solution.challenges.length > 0);
  if (anyChallenge) {
    reasons.push({
      code: 'challenge-validity-applied',
      detail: 'challenge validity applied: accepted challenges reduce the solution standing by their evidence quality',
      ref: null,
    });
  }
  const strengths = fitBradleyTerryStrengths(input.solutions);
  reasons.push({
    code: 'pairwise-bradley-terry-fitted',
    detail: `Bradley-Terry-style pairwise strengths fitted (deterministic: ${BRADLEY_TERRY_ITERATIONS} iterations, uniform initialisation)`,
    ref: null,
  });

  // The verification boundary (the A013 projection — final verification
  // authority stays in Verification; this engine only APPLIES the outcome).
  const unknownVerifiers = input.solutions.filter(
    (solution) => solution.verifierOutcome.outcome === 'unknown',
  );
  const failedSolutions = input.solutions.filter(
    (solution) => solution.verifierOutcome.outcome === 'fail',
  );
  for (const solution of failedSolutions) {
    reasons.push({
      code: 'verifier-outcome-fail',
      detail: `solution ${solution.submissionId} EXCLUDED from the verified result: the verifier outcome is fail`,
      ref: solution.verifierOutcome.recordDigest,
    });
  }
  for (const solution of unknownVerifiers) {
    reasons.push({
      code: 'verifier-outcome-unknown',
      detail: `solution ${solution.submissionId} could not be verified — the competition defers to needs_more_evidence`,
      ref: solution.verifierOutcome.recordDigest,
    });
  }
  for (const solution of input.solutions) {
    if (solution.verifierOutcome.outcome === 'pass') {
      reasons.push({
        code: 'verifier-outcome-pass',
        detail: `solution ${solution.submissionId} verifier outcome: pass`,
        ref: solution.verifierOutcome.recordDigest,
      });
    }
    switch (solution.evaluatorOutcome.outcome) {
      case 'meets-criteria':
        reasons.push({
          code: 'evaluator-meets-criteria',
          detail: `solution ${solution.submissionId} meets the task-specific evaluator criteria (A012 projection)`,
          ref: solution.evaluatorOutcome.recordDigest,
        });
        break;
      case 'below-criteria':
        reasons.push({
          code: 'evaluator-below-criteria',
          detail: `solution ${solution.submissionId} is below the task-specific evaluator criteria (A012 projection)`,
          ref: solution.evaluatorOutcome.recordDigest,
        });
        break;
      case 'inconclusive':
        reasons.push({
          code: 'evaluator-inconclusive',
          detail: `solution ${solution.submissionId} evaluator judgment is inconclusive (A012 projection)`,
          ref: solution.evaluatorOutcome.recordDigest,
        });
        break;
    }
  }

  // Distinct qualified voters across the whole competition (the
  // minimum-participation guardrail applies to the AGGREGATE).
  const distinctVoters = new Set<string>();
  for (const solution of input.solutions) {
    for (const vote of solution.votes) distinctVoters.add(vote.expertRef);
  }
  if (distinctVoters.size < input.policy.minQualifiedVoters) {
    reasons.push({
      code: 'small-sample',
      detail: `only ${distinctVoters.size} distinct qualified voters (min ${input.policy.minQualifiedVoters}) — the result is an explicit small-sample state, never a winner`,
      ref: null,
    });
  }

  // Outcome derivation (explicit tie/small-sample/unknown states).
  const verdictBySubmission = new Map<string, SolutionVerdict>();
  for (const solution of input.solutions) {
    verdictBySubmission.set(solution.submissionId, 'ranked');
  }
  let outcome: CompetitionResultOutcome;
  let winnerSubmissionId: string | null = null;
  if (unknownVerifiers.length > 0) {
    outcome = 'needs_more_evidence';
    for (const solution of unknownVerifiers) {
      verdictBySubmission.set(solution.submissionId, 'needs_more_evidence');
    }
  } else if (distinctVoters.size === 0) {
    outcome = 'insufficient_participation';
    reasons.push({
      code: 'insufficient-participation',
      detail: 'zero distinct qualified voters — the competition result is insufficient participation',
      ref: null,
    });
  } else if (distinctVoters.size < input.policy.minQualifiedVoters) {
    outcome = 'needs_more_evidence';
  } else {
    // Rank eligible (verifier-pass) solutions by BT strength, then
    // weighted score, then submission id (fully deterministic order).
    const eligible = input.solutions
      .map((solution, index) => ({ solution, index }))
      .filter(({ solution }) => solution.verifierOutcome.outcome === 'pass');
    const sorted = [...eligible].sort((left, right) => {
      const leftStrength = strengths[left.index] ?? 0;
      const rightStrength = strengths[right.index] ?? 0;
      if (rightStrength !== leftStrength) return rightStrength - leftStrength;
      const leftScore = weightedScoreOf(left.solution, input.agreementPatterns);
      const rightScore = weightedScoreOf(right.solution, input.agreementPatterns);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.solution.submissionId < right.solution.submissionId ? -1 : 1;
    });
    // Solutions below the task-specific evaluator criteria can never win.
    for (const { solution } of eligible) {
      if (solution.evaluatorOutcome.outcome === 'below-criteria') {
        verdictBySubmission.set(solution.submissionId, 'rejected');
      }
    }
    const top = sorted[0];
    const runnerUp = sorted[1];
    let tiedTop = false;
    if (top !== undefined && runnerUp !== undefined) {
      const tie = tieStatus(strengths[top.index] ?? 0, strengths[runnerUp.index] ?? 0);
      if (tie.status === 'tie') {
        tiedTop = true;
        reasons.push({
          code: 'tie-uncertainty',
          detail: `the top two eligible solutions tie on Bradley-Terry strength (margin ${tie.margin}) — the explicit tie state, never a coin-flip winner`,
          ref: null,
        });
      }
    }
    const topIsWinner =
      top !== undefined && top.solution.evaluatorOutcome.outcome === 'meets-criteria';
    if (top !== undefined && !topIsWinner && sorted.length > 0) {
      reasons.push({
        code: 'evaluator-below-criteria',
        detail: `the strongest eligible solution ${top.solution.submissionId} is not meets-criteria — no winner is derived`,
        ref: top.solution.evaluatorOutcome.recordDigest,
      });
    }
    if (tiedTop) {
      outcome = 'tie_unknown';
    } else if (topIsWinner) {
      outcome = 'verified_result';
      winnerSubmissionId = top !== undefined ? top.solution.submissionId : null;
      if (winnerSubmissionId !== null) {
        verdictBySubmission.set(winnerSubmissionId, 'winner');
      }
    } else {
      outcome = 'needs_more_evidence';
    }
  }
  for (const solution of failedSolutions) {
    verdictBySubmission.set(solution.submissionId, 'rejected');
  }

  const ranked: RankedSolution[] = input.solutions.map((solution, index) => ({
    submissionId: solution.submissionId,
    verdict: verdictBySubmission.get(solution.submissionId) ?? 'ranked',
    btStrength: strengths[index] ?? 0,
    weightedScore: weightedScoreOf(solution, input.agreementPatterns),
    acceptedChallenges: countChallenges(solution, 'accepted'),
    rejectedChallenges: countChallenges(solution, 'rejected'),
    qualifiedVoters: countVoters(solution),
  }));

  return deepFreeze({
    resultVersion: ADJUDICATION_WIRE_VERSION,
    resultId,
    competitionId: input.competitionId,
    tenantId: input.tenantId,
    formulaVersion: ADJUDICATION_FORMULA_VERSION,
    outcome,
    winnerSubmissionId,
    rankedSolutions: Object.freeze(ranked.map((entry) => deepFreeze(entry))),
    reasons: Object.freeze(reasons.map((reason) => deepFreeze(reason))),
    computedAt: new Date(input.now).toISOString(),
    limitations: Object.freeze([
      'Bradley-Terry fitting is iterative with a fixed budget — disclosed as approximate, deterministic given identical inputs',
      'evidence quality and calibration weights are host-supplied projections (A012/A013/C005 fabrics own their derivation)',
      'the raw community upvote/downvote ratio is EXCLUDED from these inputs by construction — it can never drive this result',
      'this result is a CANDIDATE input to Evaluation/Verification/Certification — never a certification (architecture-lock rule 34)',
    ]),
  });
}

/**
 * Re-materialise a competition result from wire input (strict,
 * fail-closed exact-field validation): a smuggled authority-shaped
 * field (certified/granted/authorized/scope) is REJECTED — the result
 * can never become a certification by payload surgery.
 */
export function createCompetitionResult(input: {
  readonly resultId: string;
  readonly competitionId: string;
  readonly tenantId: string;
  readonly outcome: string;
  readonly winnerSubmissionId: string | null;
  readonly rankedSolutions: readonly RankedSolution[];
  readonly reasons: readonly AdjudicationReason[];
  readonly computedAt: string;
}): CompetitionResult {
  if (typeof input !== 'object' || input === null) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: 'competition result input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'resultId',
      'competitionId',
      'tenantId',
      'outcome',
      'winnerSubmissionId',
      'rankedSolutions',
      'reasons',
      'computedAt',
    ],
    'CompetitionResult',
  );
  if (!isCompetitionResultId(input.resultId)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: `invalid competition result id: ${JSON.stringify(input.resultId)}`,
    });
  }
  if (!(COMPETITION_RESULT_OUTCOMES as readonly string[]).includes(input.outcome)) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: `outcome is not in the closed vocabulary: ${JSON.stringify(input.outcome)}`,
      details: { vocabulary: COMPETITION_RESULT_OUTCOMES },
    });
  }
  requireBoundedString(input.competitionId, 'competitionId');
  requireBoundedString(input.tenantId, 'tenantId');
  if (!Array.isArray(input.reasons) || input.reasons.length === 0) {
    throw new AdversarialEvaluationError(ADVERSARIAL_EVALUATION_ERROR_CODES.INVALID_ADJUDICATION, {
      message: 'a competition result REQUIRES machine-readable reasons (>= 1)',
    });
  }
  return deepFreeze({
    resultVersion: ADJUDICATION_WIRE_VERSION,
    resultId: input.resultId,
    competitionId: input.competitionId,
    tenantId: input.tenantId,
    formulaVersion: ADJUDICATION_FORMULA_VERSION,
    outcome: input.outcome as CompetitionResultOutcome,
    winnerSubmissionId: input.winnerSubmissionId,
    rankedSolutions: Object.freeze([...input.rankedSolutions]),
    reasons: Object.freeze([...input.reasons]),
    computedAt: requireBoundedString(input.computedAt, 'computedAt'),
    limitations: Object.freeze([
      're-materialised from wire input — same disclosed limitations as the derived form',
      'a competition result is a CANDIDATE input, never a certification (architecture-lock rule 34)',
    ]),
  });
}

/** Structural guard for wire values claiming to be competition results. */
export function isCompetitionResult(value: unknown): value is CompetitionResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['resultVersion'] === ADJUDICATION_WIRE_VERSION &&
    isCompetitionResultId(candidate['resultId']) &&
    (COMPETITION_RESULT_OUTCOMES as readonly string[]).includes(candidate['outcome'] as string) &&
    Array.isArray(candidate['reasons']) &&
    candidate['reasons'].length > 0
  );
}
