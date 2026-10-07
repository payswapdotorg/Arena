/**
 * Adjudication engine (Work Order C009; issue #116; spec/evaluation.md
 * EV1.0 + architecture-lock rule 7: "Evaluation and verification are
 * distinct responsibilities").
 *
 * A C007 SUBMITTED payload (result + evidence + annotations +
 * corrections + consent/rights statement — carried by the intervention
 * result contract) is adjudicated through EXPLICITLY DISTINCT stages:
 *
 *   STAGE 1 — EVALUATION (the A012 seam): judgment against the plan's
 *   explicit criteria. Outcome: meets-criteria | below-criteria |
 *   inconclusive. This stage NEVER establishes evidence.
 *
 *   STAGE 2 — VERIFICATION (the A013 seam): whether the required
 *   evidence exists and supports the required claims. Outcome
 *   (derived, closed): pass | fail | unknown. This stage NEVER scores.
 *
 * The two stages are combined EXPLICITLY by combineStages — never
 * collapsed into one check — into the adjudication verdict:
 *
 *   ACCEPTED              — evaluation meets criteria AND verification
 *                           pass;
 *   REVISION_REQUIRED     — a stage failed while revision attempts
 *                           remain (a typed revision request follows);
 *   REJECTED              — a stage failed with the revision budget
 *                           exhausted;
 *   NEEDS_MORE_EVIDENCE   — a stage was inconclusive/unknown: the
 *                           verdict cannot be established yet (the
 *                           escalation stays VALIDATING with a typed
 *                           evidence request).
 *
 * Every verdict carries MACHINE-READABLE reasons (closed code
 * vocabulary), evidence refs and evaluator/verifier outcome refs.
 */

import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import type { RevisionState } from './revision.js';
import { deepFreeze, rejectUnknownFields } from './shared.js';
import type { AdjudicationVerdictId } from './shared.js';
import { isAdjudicationVerdictId, requireBoundedString } from './shared.js';

/** Wire version of the adjudication shapes. */
export const ADJUDICATION_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Stage outcome views (projections of the A012/A013 record fabrics)
// ---------------------------------------------------------------------------

export const EVALUATION_STAGE_OUTCOMES = Object.freeze([
  'meets-criteria',
  'below-criteria',
  'inconclusive',
] as const);
export type EvaluationStageOutcome = (typeof EVALUATION_STAGE_OUTCOMES)[number];

/** One criterion judgment inside the evaluation stage. */
export interface CriterionJudgment {
  readonly criteriaRef: string;
  readonly verdict: 'met' | 'not-met' | 'inconclusive';
  readonly score: number | null;
  readonly note: string | null;
}

/** STAGE 1 — the evaluation stage outcome (an A012 record projection). */
export interface EvaluationStageResult {
  readonly stage: 'evaluation';
  readonly outcome: EvaluationStageOutcome;
  /** Content digest of the A012 EvaluationRecord the stage produced. */
  readonly recordDigest: string;
  /** The evaluator descriptor digest (A012 EvaluatorDescriptor). */
  readonly evaluatorRef: string;
  /** The selected validator expert (C005-informed selection; null = non-expert evaluator). */
  readonly validatorExpertRef: string | null;
  readonly criteriaJudgments: readonly CriterionJudgment[];
  readonly executedAt: string;
  readonly provenance: string;
}

export const VERIFICATION_STAGE_OUTCOMES = Object.freeze(['pass', 'fail', 'unknown'] as const);
export type VerificationStageOutcome = (typeof VERIFICATION_STAGE_OUTCOMES)[number];

export const EVIDENCE_SUPPORT_STATUSES = Object.freeze([
  'present-supported',
  'present-unsupported',
  'present-unverified',
  'present-indeterminate',
  'missing',
] as const);
export type EvidenceSupportStatus = (typeof EVIDENCE_SUPPORT_STATUSES)[number];

/** STAGE 2 — the verification stage outcome (an A013 record projection). */
export interface VerificationStageResult {
  readonly stage: 'verification';
  readonly outcome: VerificationStageOutcome;
  /** Content digest of the A013 VerificationRecord the stage produced. */
  readonly recordDigest: string;
  /** The verifier descriptor digest (A013 VerifierDescriptor). */
  readonly verifierRef: string;
  /** Per required-evidence claim support (mirrors A013's summary). */
  readonly evidenceSupport: readonly {
    readonly claim: string;
    readonly status: EvidenceSupportStatus;
  }[];
  /** Evidence refs the verification examined (>= 0). */
  readonly evidenceRefs: readonly string[];
  readonly executedAt: string;
  readonly provenance: string;
}

// ---------------------------------------------------------------------------
// Machine-readable reasons (closed vocabulary)
// ---------------------------------------------------------------------------

export const ADJUDICATION_REASON_CODES = Object.freeze([
  // evaluation-stage reasons
  'evaluation-meets-criteria',
  'evaluation-below-criteria',
  'evaluation-inconclusive',
  // verification-stage reasons
  'verification-pass',
  'verification-fail',
  'verification-unknown',
  // revision-loop reasons
  'revision-attempts-remain',
  'revision-budget-exhausted',
  // evidence-request reasons
  'insufficient-evidence-for-verdict',
] as const);
export type AdjudicationReasonCode = (typeof ADJUDICATION_REASON_CODES)[number];

export function isAdjudicationReasonCode(value: unknown): value is AdjudicationReasonCode {
  return (
    typeof value === 'string' &&
    (ADJUDICATION_REASON_CODES as readonly string[]).includes(value)
  );
}

/** One machine-readable adjudication reason with its outcome refs. */
export interface AdjudicationReason {
  readonly code: AdjudicationReasonCode;
  readonly detail: string;
  /** The stage record digest the reason cites (evaluation/verifier ref). */
  readonly ref: string | null;
}

// ---------------------------------------------------------------------------
// The verdict (typed union + machine-readable)
// ---------------------------------------------------------------------------

export const ADJUDICATION_VERDICTS = Object.freeze([
  'accepted',
  'revision_required',
  'rejected',
  'needs_more_evidence',
] as const);
export type AdjudicationVerdict = (typeof ADJUDICATION_VERDICTS)[number];

export function isAdjudicationVerdict(value: unknown): value is AdjudicationVerdict {
  return (
    typeof value === 'string' && (ADJUDICATION_VERDICTS as readonly string[]).includes(value)
  );
}

/** The escalation's C001 validation status a verdict maps onto. */
export type EscalationValidationStatusOfVerdict = 'passed' | 'failed' | 'pending';

export interface AdjudicationOutcome {
  readonly adjudicationVersion: typeof ADJUDICATION_VERSION;
  readonly verdictId: AdjudicationVerdictId;
  readonly requestId: string;
  readonly tenantId: string;
  /** 1-based adjudication round (revision attempts consumed + 1). */
  readonly attemptNumber: number;
  readonly verdict: AdjudicationVerdict;
  readonly reasons: readonly AdjudicationReason[];
  readonly evaluationStage: EvaluationStageResult;
  readonly verificationStage: VerificationStageResult;
  /** The C001 validationStatus this verdict binds to the lifecycle. */
  readonly validationStatus: EscalationValidationStatusOfVerdict;
  readonly adjudicatedAt: string;
}

export const ADJUDICATION_OUTCOME_FIELDS = Object.freeze([
  'adjudicationVersion',
  'verdictId',
  'requestId',
  'tenantId',
  'attemptNumber',
  'verdict',
  'reasons',
  'evaluationStage',
  'verificationStage',
  'validationStatus',
  'adjudicatedAt',
] as const);

// ---------------------------------------------------------------------------
// The explicit stage combination (lock rule 7 — never collapsed)
// ---------------------------------------------------------------------------

/**
 * Combine the two DISTINCT stage outcomes into the verdict — the
 * EXPLICIT composition point (architecture-lock rule 7). Both stages
 * always appear in the outcome and in the reasons; neither may be
 * skipped, short-circuited or collapsed into the other.
 */
export function combineStages(
  evaluation: EvaluationStageResult,
  verification: VerificationStageResult,
  revisionState: RevisionState,
): {
  readonly verdict: AdjudicationVerdict;
  readonly reasons: readonly AdjudicationReason[];
  readonly validationStatus: EscalationValidationStatusOfVerdict;
} {
  const reasons: AdjudicationReason[] = [];

  // STAGE 1 — evaluation (judgment against criteria).
  switch (evaluation.outcome) {
    case 'meets-criteria':
      reasons.push({
        code: 'evaluation-meets-criteria',
        detail: `evaluation stage judged the submission as meeting the declared criteria (${evaluation.criteriaJudgments.length} criterion judgments)`,
        ref: evaluation.recordDigest,
      });
      break;
    case 'below-criteria':
      reasons.push({
        code: 'evaluation-below-criteria',
        detail: 'evaluation stage judged the submission as below the declared criteria',
        ref: evaluation.recordDigest,
      });
      break;
    case 'inconclusive':
      reasons.push({
        code: 'evaluation-inconclusive',
        detail: 'evaluation stage could not establish a criteria judgment',
        ref: evaluation.recordDigest,
      });
      break;
  }

  // STAGE 2 — verification (evidence supports claims).
  switch (verification.outcome) {
    case 'pass':
      reasons.push({
        code: 'verification-pass',
        detail: `verification stage established that the required evidence supports the required claims (${verification.evidenceSupport.length} claims)`,
        ref: verification.recordDigest,
      });
      break;
    case 'fail':
      reasons.push({
        code: 'verification-fail',
        detail: 'verification stage established that required evidence is present but does NOT support a required claim',
        ref: verification.recordDigest,
      });
      break;
    case 'unknown':
      reasons.push({
        code: 'verification-unknown',
        detail: 'verification stage could not establish evidence support for a required claim (missing or indeterminate)',
        ref: verification.recordDigest,
      });
      break;
  }

  // EXPLICIT combination.
  const evaluationFailed = evaluation.outcome === 'below-criteria';
  const verificationFailed = verification.outcome === 'fail';
  const indeterminate =
    evaluation.outcome === 'inconclusive' || verification.outcome === 'unknown';

  if (indeterminate) {
    reasons.push({
      code: 'insufficient-evidence-for-verdict',
      detail: 'a stage was inconclusive/unknown — the verdict cannot be established yet; a typed evidence request follows and the escalation stays VALIDATING',
      ref: null,
    });
    return deepFreeze({
      verdict: 'needs_more_evidence',
      reasons: Object.freeze(reasons),
      validationStatus: 'pending',
    });
  }

  const failed = evaluationFailed || verificationFailed;
  if (!failed) {
    return deepFreeze({
      verdict: 'accepted',
      reasons: Object.freeze(reasons),
      validationStatus: 'passed',
    });
  }

  if (revisionState.attemptNumber < revisionState.maxRevisionAttempts) {
    reasons.push({
      code: 'revision-attempts-remain',
      detail: `validation failed while revision attempts remain (attempt ${revisionState.attemptNumber} of ${revisionState.maxRevisionAttempts}) — a typed revision request follows`,
      ref: null,
    });
    return deepFreeze({
      verdict: 'revision_required',
      reasons: Object.freeze(reasons),
      validationStatus: 'failed',
    });
  }

  reasons.push({
    code: 'revision-budget-exhausted',
    detail: `validation failed with the revision budget exhausted (attempt ${revisionState.attemptNumber} of ${revisionState.maxRevisionAttempts}) — the escalation is REJECTED with reasons`,
    ref: null,
  });
  return deepFreeze({
    verdict: 'rejected',
    reasons: Object.freeze(reasons),
    validationStatus: 'failed',
  });
}

// ---------------------------------------------------------------------------
// Outcome construction (strict, fail-closed, exact-field)
// ---------------------------------------------------------------------------

export interface CreateAdjudicationOutcomeInput {
  readonly verdictId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly attemptNumber: number;
  readonly verdict: string;
  readonly reasons: readonly {
    readonly code: string;
    readonly detail: string;
    readonly ref?: string | null;
  }[];
  readonly evaluationStage: EvaluationStageResult;
  readonly verificationStage: VerificationStageResult;
  readonly adjudicatedAt: string;
}

/**
 * Create and freeze one adjudication outcome (strict, fail-closed):
 * unknown fields are REJECTED, so an authority-shaped smuggled field
 * (`authorization`, `certified`, `granted`, ...) can never ride inside
 * a verdict — a validation verdict is NEVER an authorization or a
 * certification (lock rules 9/35; EV1.0 "Neither is professional
 * licensure").
 */
export function createAdjudicationOutcome(
  input: CreateAdjudicationOutcomeInput,
): AdjudicationOutcome {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'adjudication outcome input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'verdictId',
      'requestId',
      'tenantId',
      'attemptNumber',
      'verdict',
      'reasons',
      'evaluationStage',
      'verificationStage',
      'adjudicatedAt',
    ],
    'AdjudicationOutcome',
  );
  if (!isAdjudicationVerdictId(input.verdictId)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: `adjudication verdict id is invalid: ${JSON.stringify(input.verdictId)}`,
    });
  }
  if (!isAdjudicationVerdict(input.verdict)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: `adjudication verdict is not in the closed vocabulary: ${JSON.stringify(input.verdict)}`,
      details: { vocabulary: ADJUDICATION_VERDICTS },
    });
  }
  requireBoundedString(input.requestId, 'requestId');
  requireBoundedString(input.tenantId, 'tenantId');
  if (
    typeof input.attemptNumber !== 'number' ||
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1
  ) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'attemptNumber must be an integer >= 1',
    });
  }
  if (!Array.isArray(input.reasons) || input.reasons.length === 0) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'an adjudication verdict REQUIRES machine-readable reasons (>= 1)',
    });
  }
  const reasons = input.reasons.map((reason) => {
    if (!isAdjudicationReasonCode(reason.code)) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
        message: `adjudication reason code is not in the closed vocabulary: ${JSON.stringify(reason.code)}`,
        details: { vocabulary: ADJUDICATION_REASON_CODES },
      });
    }
    return deepFreeze({
      code: reason.code,
      detail: requireBoundedString(reason.detail, 'reason.detail'),
      ref: reason.ref === undefined || reason.ref === null ? null : reason.ref,
    });
  });

  const combined = combineStages(
    input.evaluationStage,
    input.verificationStage,
    {
      attemptNumber: input.attemptNumber,
      maxRevisionAttempts: Number.MAX_SAFE_INTEGER,
    },
  );
  if (combined.verdict !== input.verdict) {
    // Fail-closed: the recorded verdict must match the EXPLICIT stage
    // combination — a verdict may never disagree with its own stages.
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_VERDICT, {
      message: `recorded verdict ${JSON.stringify(input.verdict)} disagrees with the explicit stage combination (${combined.verdict})`,
      details: { recorded: input.verdict, combined: combined.verdict },
    });
  }

  const outcome: AdjudicationOutcome = deepFreeze({
    adjudicationVersion: ADJUDICATION_VERSION,
    verdictId: input.verdictId,
    requestId: input.requestId,
    tenantId: input.tenantId,
    attemptNumber: input.attemptNumber,
    verdict: input.verdict,
    reasons: Object.freeze(reasons),
    evaluationStage: deepFreeze(input.evaluationStage),
    verificationStage: deepFreeze(input.verificationStage),
    validationStatus: combined.validationStatus,
    adjudicatedAt: requireBoundedString(input.adjudicatedAt, 'adjudicatedAt'),
  });
  return outcome;
}

/** Structural guard for wire values claiming to be adjudication outcomes. */
export function isAdjudicationOutcome(value: unknown): value is AdjudicationOutcome {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['adjudicationVersion'] === ADJUDICATION_VERSION &&
    isAdjudicationVerdictId(candidate['verdictId']) &&
    isAdjudicationVerdict(candidate['verdict']) &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['attemptNumber'] === 'number' &&
    Array.isArray(candidate['reasons']) &&
    candidate['reasons'].length > 0 &&
    typeof candidate['validationStatus'] === 'string'
  );
}
