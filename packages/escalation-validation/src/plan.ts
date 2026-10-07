/**
 * Validation-plan derivation (Work Order C009; issue #116;
 * spec/evaluation.md EV1.0 + spec/expert-escalation-api.md ES1.0 —
 * "Payment is released only after the agreed validation condition is
 * satisfied", so the condition must become a TYPED, VERSIONED,
 * DETERMINISTIC plan).
 *
 * The EscalationRequest's DECLARED validation condition (the closed
 * C009 condition vocabulary below — ES1.0 carries the response-side
 * `validation status`; the declared condition is bound to the request
 * at the C009 seam because C001's request shape is frozen) is compiled
 * into a ValidationPlan that selects:
 *
 *   - the EVALUATION stage — judgment against explicit criteria
 *     (EV1.0 evaluator kind, criteria refs, threshold, output schema,
 *     minimum evidence, limitations), and
 *   - the VERIFICATION stage — evidence supporting the result
 *     (EV1.0 verifier method, required evidence with claims, declared
 *     pass/fail/unknown semantics),
 *
 * plus the versioned revision policy and the validator competency
 * profile. Derivation is a PURE DETERMINISTIC function of (request,
 * declared condition): identical inputs yield a byte-identical plan
 * (content-addressed by sha256 via @arena/protocol-core's
 * digestCanonical — never reimplemented here). The outcome is a TYPED
 * CLOSED union — plan-derivable | under-specified-with-reasons — never
 * a bare boolean.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { EscalationRequest } from '@arena/escalation';
import { isEscalationTimestamp, isPlainJsonValue } from '@arena/escalation';
import { EVALUATOR_KINDS } from '@arena/evaluation';
import type { EvaluatorKind } from '@arena/evaluation';
import { VERIFIER_METHODS } from '@arena/verification';
import type { VerifierMethod } from '@arena/verification';
import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import type { ValidationPlanId } from './shared.js';
import {
  deepFreeze,
  isValidationPlanId,
  rejectUnknownFields,
  requireBoundedString,
  requirePositiveInt,
  requireStringArray,
  requireUnitInterval,
  toValidationPlanId,
} from './shared.js';

/** Wire version of the validation-plan shape. */
export const VALIDATION_PLAN_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The DECLARED validation condition (closed vocabulary)
// ---------------------------------------------------------------------------

/**
 * The closed condition-kind vocabulary. Each kind fixes the EV1.0
 * evaluator kind + verifier method pair the plan selects:
 *
 *   criteria-threshold      -> expert | rubric evaluator (judgment
 *                              against declared criteria) + evidence
 *                              provenance validation (evidence supports
 *                              claims);
 *   evidence-attestation    -> deterministic-test evaluator (schema/
 *                              shape conformance only — no judgment
 *                              beyond declared criteria) + evidence
 *                              provenance validation;
 *   expert-review-approval  -> expert evaluator + expert review
 *                              verification;
 *   deterministic-check     -> deterministic-test evaluator +
 *                              deterministic formal check verification.
 */
export const VALIDATION_CONDITION_KINDS = Object.freeze([
  'criteria-threshold',
  'evidence-attestation',
  'expert-review-approval',
  'deterministic-check',
] as const);
export type ValidationConditionKind = (typeof VALIDATION_CONDITION_KINDS)[number];

export function isValidationConditionKind(
  value: unknown,
): value is ValidationConditionKind {
  return (
    typeof value === 'string' &&
    (VALIDATION_CONDITION_KINDS as readonly string[]).includes(value)
  );
}

/** The closed under-specification reason vocabulary (typed outcomes). */
export const PLAN_UNDER_SPECIFIED_REASONS = Object.freeze([
  'unknown-condition-kind',
  'missing-criteria-refs',
  'missing-required-evidence',
  'missing-revision-policy',
  'invalid-criteria-threshold',
  'condition-not-declared',
] as const);
export type PlanUnderSpecifiedReason = (typeof PLAN_UNDER_SPECIFIED_REASONS)[number];

export interface DeclaredValidationCondition {
  readonly conditionVersion: 1;
  readonly kind: ValidationConditionKind;
  /** Criteria the evaluation stage judges against (>= 1 ref; judgment kinds). */
  readonly criteriaRefs?: readonly string[];
  /** Minimum aggregate criteria score in [0, 1] (judgment kinds). */
  readonly criteriaThreshold?: number;
  /** Evidence kinds the verification stage requires (>= 1). */
  readonly requiredEvidenceKinds: readonly string[];
  /** Required-evidence claims (>= 1, parallel to the kinds where applicable). */
  readonly requiredEvidenceClaims: readonly string[];
  /** Maximum revision attempts allowed before REJECTED (1..99). */
  readonly maxRevisionAttempts: number;
  /** Revision resubmission window in ms (>= 1). */
  readonly revisionWindowMs: number;
}

export const DECLARED_VALIDATION_CONDITION_FIELDS = Object.freeze([
  'conditionVersion',
  'kind',
  'criteriaRefs',
  'criteriaThreshold',
  'requiredEvidenceKinds',
  'requiredEvidenceClaims',
  'maxRevisionAttempts',
  'revisionWindowMs',
] as const);

export interface CreateDeclaredValidationConditionInput {
  readonly kind: string;
  readonly criteriaRefs?: readonly string[];
  readonly criteriaThreshold?: number;
  readonly requiredEvidenceKinds: readonly string[];
  readonly requiredEvidenceClaims: readonly string[];
  readonly maxRevisionAttempts: number;
  readonly revisionWindowMs: number;
}

/**
 * Validate and freeze a DECLARED validation condition (strict,
 * fail-closed: unknown fields are rejected so an authority-shaped
 * smuggled field can never ride inside the condition).
 */
export function createDeclaredValidationCondition(
  input: CreateDeclaredValidationConditionInput,
): DeclaredValidationCondition {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_CONDITION, {
      message: 'declared validation condition input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'kind',
      'criteriaRefs',
      'criteriaThreshold',
      'requiredEvidenceKinds',
      'requiredEvidenceClaims',
      'maxRevisionAttempts',
      'revisionWindowMs',
    ],
    'DeclaredValidationCondition',
  );
  if (!isValidationConditionKind(input.kind)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_CONDITION, {
      message: `validation condition kind is not in the closed vocabulary: ${JSON.stringify(input.kind)}`,
      details: { vocabulary: VALIDATION_CONDITION_KINDS },
    });
  }

  const judgmentKind =
    input.kind === 'criteria-threshold' || input.kind === 'expert-review-approval';

  let criteriaRefs: readonly string[] | undefined;
  let criteriaThreshold: number | undefined;
  if (judgmentKind) {
    criteriaRefs = requireStringArray(input.criteriaRefs, 'criteriaRefs');
    criteriaThreshold = requireUnitInterval(input.criteriaThreshold, 'criteriaThreshold');
  } else if (input.criteriaRefs !== undefined || input.criteriaThreshold !== undefined) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_CONDITION, {
      message: `condition kind ${JSON.stringify(input.kind)} carries no judgment criteria (criteriaRefs/criteriaThreshold are not applicable)`,
    });
  }

  const requiredEvidenceKinds = requireStringArray(
    input.requiredEvidenceKinds,
    'requiredEvidenceKinds',
  );
  const requiredEvidenceClaims = requireStringArray(
    input.requiredEvidenceClaims,
    'requiredEvidenceClaims',
  );
  if (requiredEvidenceClaims.length !== requiredEvidenceKinds.length) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_CONDITION, {
      message: 'requiredEvidenceClaims must be parallel to requiredEvidenceKinds (same length)',
    });
  }
  const maxRevisionAttempts = requirePositiveInt(
    input.maxRevisionAttempts,
    'maxRevisionAttempts',
    99,
  );
  const revisionWindowMs = requirePositiveInt(input.revisionWindowMs, 'revisionWindowMs', Number.MAX_SAFE_INTEGER);

  const condition: DeclaredValidationCondition = deepFreeze({
    conditionVersion: 1 as const,
    kind: input.kind,
    ...(criteriaRefs !== undefined ? { criteriaRefs } : {}),
    ...(criteriaThreshold !== undefined ? { criteriaThreshold } : {}),
    requiredEvidenceKinds,
    requiredEvidenceClaims,
    maxRevisionAttempts,
    revisionWindowMs,
  });
  return condition;
}

/** Structural guard for wire values claiming to be declared conditions. */
export function isDeclaredValidationCondition(
  value: unknown,
): value is DeclaredValidationCondition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['conditionVersion'] !== 1) return false;
  if (!isValidationConditionKind(candidate['kind'])) return false;
  if (!Array.isArray(candidate['requiredEvidenceKinds'])) return false;
  if (!Array.isArray(candidate['requiredEvidenceClaims'])) return false;
  if (typeof candidate['maxRevisionAttempts'] !== 'number') return false;
  if (typeof candidate['revisionWindowMs'] !== 'number') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The typed, versioned ValidationPlan
// ---------------------------------------------------------------------------

/** The EV1.0 evaluation-stage specification the plan pins. */
export interface EvaluationStageSpec {
  readonly stage: 'evaluation';
  /** EV1.0 evaluator kind (closed enum — judgment against criteria). */
  readonly evaluatorKind: EvaluatorKind;
  /** Criteria refs the judgment runs against (>= 1 for judgment kinds). */
  readonly criteriaRefs: readonly string[];
  /** Minimum aggregate criteria score in [0, 1] (judgment kinds). */
  readonly criteriaThreshold: number | null;
  /** Output schema reference (the request's declared desired output shape). */
  readonly outputSchemaRef: string;
  /** Minimum evidence items the evaluated submission must carry (>= 1). */
  readonly minimumEvidenceCount: number;
  /** Declared limitations of the evaluation stage (EV1.0 discipline). */
  readonly limitations: readonly string[];
}

/** The EV1.0 verification-stage specification the plan pins. */
export interface VerificationStageSpec {
  readonly stage: 'verification';
  /** EV1.0 verifier method (closed enum — evidence supporting claims). */
  readonly verifierMethod: VerifierMethod;
  /** Required evidence: one (kind, claim) pair per requirement. */
  readonly requiredEvidence: readonly {
    readonly kind: string;
    readonly claim: string;
  }[];
  /** Declared pass semantics (mandatory — EV1.0). */
  readonly passSemantics: string;
  /** Declared fail semantics (mandatory — EV1.0). */
  readonly failSemantics: string;
  /** Declared unknown semantics (mandatory — EV1.0). */
  readonly unknownSemantics: string;
}

/** The versioned revision policy the plan pins. */
export interface RevisionPolicy {
  readonly policyVersion: 1;
  readonly maxRevisionAttempts: number;
  readonly revisionWindowMs: number;
}

export interface ValidationPlan {
  readonly planVersion: typeof VALIDATION_PLAN_VERSION;
  /** Content-derived plan id (vp_ + first 32 hex of the plan digest). */
  readonly planId: ValidationPlanId;
  readonly requestId: string;
  readonly tenantId: string;
  /** The condition kind the plan was derived from. */
  readonly conditionKind: ValidationConditionKind;
  readonly derivation: {
    readonly source: 'declared-validation-condition';
    /** sha256 over the canonical condition (content address). */
    readonly conditionDigest: string;
  };
  readonly evaluationStage: EvaluationStageSpec;
  readonly verificationStage: VerificationStageSpec;
  readonly revisionPolicy: RevisionPolicy;
  /** Validator competency profile (from the request's expert requirements). */
  readonly validatorProfile: {
    readonly requiredSkills: readonly string[];
  };
  /** Injected derivation time (canonical ms-UTC). */
  readonly derivedAt: string;
  /** sha256 over the canonical serialization of the digest-free view. */
  readonly digest: string;
}

export const VALIDATION_PLAN_FIELDS = Object.freeze([
  'planVersion',
  'planId',
  'requestId',
  'tenantId',
  'conditionKind',
  'derivation',
  'evaluationStage',
  'verificationStage',
  'revisionPolicy',
  'validatorProfile',
  'derivedAt',
  'digest',
] as const);

// ---------------------------------------------------------------------------
// Plan derivation — typed closed outcome, deterministic
// ---------------------------------------------------------------------------

/** The typed derivation outcome: NEVER a bare boolean. */
export type PlanDerivationResult =
  | { readonly outcome: 'plan-derivable'; readonly plan: ValidationPlan }
  | {
      readonly outcome: 'under-specified';
      readonly reasons: readonly PlanUnderSpecifiedReason[];
    };

const JUDGMENT_EVALUATOR_KINDS: Readonly<
  Record<ValidationConditionKind, EvaluatorKind>
> = Object.freeze({
  'criteria-threshold': 'rubric',
  'evidence-attestation': 'deterministic-test',
  'expert-review-approval': 'expert',
  'deterministic-check': 'deterministic-test',
});

const VERIFIER_METHOD_BY_KIND: Readonly<
  Record<ValidationConditionKind, VerifierMethod>
> = Object.freeze({
  'criteria-threshold': 'evidence_provenance_validation',
  'evidence-attestation': 'evidence_provenance_validation',
  'expert-review-approval': 'expert_review',
  'deterministic-check': 'deterministic_formal_check',
});

/** sha256 over the canonical serialization of the digest-free plan view. */
function planDigestInput(
  request: EscalationRequest,
  condition: DeclaredValidationCondition,
  derivedAt: string,
): Record<string, unknown> {
  return {
    planVersion: VALIDATION_PLAN_VERSION,
    requestId: request.requestId,
    tenantId: request.tenantId,
    conditionKind: condition.kind,
    condition,
    revisionPolicy: {
      policyVersion: 1,
      maxRevisionAttempts: condition.maxRevisionAttempts,
      revisionWindowMs: condition.revisionWindowMs,
    },
    validatorProfile: {
      requiredSkills: [...request.expertRequirements.requiredCapabilities],
    },
    derivedAt,
  };
}

/**
 * Derive the typed, versioned ValidationPlan from an EscalationRequest's
 * DECLARED validation condition. DETERMINISTIC: identical (request,
 * condition, derivedAt) inputs produce a byte-identical plan (the plan id
 * is the content digest). The outcome is the TYPED CLOSED union —
 * plan-derivable | under-specified-with-reasons — never a bare boolean.
 *
 * An omitted condition (`undefined`) is under-specified with the
 * `condition-not-declared` reason: the engine NEVER invents a default
 * condition (fail-closed — an undeclared condition can never silently
 * become a rubber stamp).
 */
export async function deriveValidationPlan(
  request: EscalationRequest,
  condition: DeclaredValidationCondition | undefined,
  derivedAt: number | string | Date,
): Promise<PlanDerivationResult> {
  if (condition === undefined) {
    return deepFreeze({
      outcome: 'under-specified',
      reasons: Object.freeze(['condition-not-declared'] as const),
    });
  }

  const reasons: PlanUnderSpecifiedReason[] = [];
  if (!isValidationConditionKind(condition.kind)) {
    reasons.push('unknown-condition-kind');
  }
  const judgmentKind =
    condition.kind === 'criteria-threshold' || condition.kind === 'expert-review-approval';
  if (judgmentKind) {
    if (
      !Array.isArray(condition.criteriaRefs) ||
      condition.criteriaRefs.length === 0
    ) {
      reasons.push('missing-criteria-refs');
    }
    if (
      typeof condition.criteriaThreshold !== 'number' ||
      condition.criteriaThreshold < 0 ||
      condition.criteriaThreshold > 1
    ) {
      reasons.push('invalid-criteria-threshold');
    }
  }
  if (
    !Array.isArray(condition.requiredEvidenceKinds) ||
    condition.requiredEvidenceKinds.length === 0 ||
    !Array.isArray(condition.requiredEvidenceClaims) ||
    condition.requiredEvidenceClaims.length === 0
  ) {
    reasons.push('missing-required-evidence');
  }
  if (
    typeof condition.maxRevisionAttempts !== 'number' ||
    !Number.isInteger(condition.maxRevisionAttempts) ||
    condition.maxRevisionAttempts < 1 ||
    typeof condition.revisionWindowMs !== 'number' ||
    !Number.isInteger(condition.revisionWindowMs) ||
    condition.revisionWindowMs < 1
  ) {
    reasons.push('missing-revision-policy');
  }
  if (reasons.length > 0) {
    return deepFreeze({ outcome: 'under-specified', reasons: Object.freeze([...reasons]) });
  }

  const conditionCanonical = {
    conditionVersion: condition.conditionVersion,
    kind: condition.kind,
    ...(condition.criteriaRefs !== undefined ? { criteriaRefs: [...condition.criteriaRefs] } : {}),
    ...(condition.criteriaThreshold !== undefined
      ? { criteriaThreshold: condition.criteriaThreshold }
      : {}),
    requiredEvidenceKinds: [...condition.requiredEvidenceKinds],
    requiredEvidenceClaims: [...condition.requiredEvidenceClaims],
    maxRevisionAttempts: condition.maxRevisionAttempts,
    revisionWindowMs: condition.revisionWindowMs,
  };
  const conditionDigest = await digestCanonical(conditionCanonical);

  const derivedAtMs =
    derivedAt instanceof Date
      ? derivedAt.getTime()
      : typeof derivedAt === 'number'
        ? derivedAt
        : Date.parse(derivedAt);
  if (!Number.isFinite(derivedAtMs)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: `invalid derivation timestamp: ${JSON.stringify(derivedAt)}`,
    });
  }
  const derivedAtIso = new Date(derivedAtMs).toISOString();
  if (!isEscalationTimestamp(derivedAtIso)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_INPUT, {
      message: `invalid derivation timestamp: ${JSON.stringify(derivedAt)}`,
    });
  }

  const evaluatorKind: EvaluatorKind = JUDGMENT_EVALUATOR_KINDS[condition.kind];
  const verifierMethod: VerifierMethod = VERIFIER_METHOD_BY_KIND[condition.kind];
  const outputSchemaRef = `arena:schema/escalation-validation/output@${VALIDATION_PLAN_VERSION}.0.0`;

  const evaluationStage: EvaluationStageSpec = deepFreeze({
    stage: 'evaluation',
    evaluatorKind,
    criteriaRefs:
      condition.criteriaRefs !== undefined ? [...condition.criteriaRefs] : [],
    criteriaThreshold: condition.criteriaThreshold ?? null,
    outputSchemaRef,
    minimumEvidenceCount: Math.max(1, condition.requiredEvidenceKinds.length),
    limitations: Object.freeze([
      `evaluation-stage-judgment-only (kind: ${evaluatorKind})`,
      'evaluation-never-establishes-evidence (architecture-lock rule 7)',
    ]),
  });
  const verificationStage: VerificationStageSpec = deepFreeze({
    stage: 'verification',
    verifierMethod,
    requiredEvidence: Object.freeze(
      condition.requiredEvidenceKinds.map((kind, index) => ({
        kind,
        claim: condition.requiredEvidenceClaims[index] as string,
      })),
    ),
    passSemantics: 'every required-evidence claim is present and supported',
    failSemantics: 'a required-evidence claim is present but unsupported',
    unknownSemantics: 'a required-evidence claim is missing or indeterminate',
  });
  const revisionPolicy: RevisionPolicy = deepFreeze({
    policyVersion: 1 as const,
    maxRevisionAttempts: condition.maxRevisionAttempts,
    revisionWindowMs: condition.revisionWindowMs,
  });

  const digest = await digestCanonical(
    planDigestInput(request, condition, derivedAtIso),
  );
  const planId = toValidationPlanId(`vp_${digest.slice(0, 32)}`);

  const plan: ValidationPlan = deepFreeze({
    planVersion: VALIDATION_PLAN_VERSION,
    planId,
    requestId: request.requestId,
    tenantId: request.tenantId,
    conditionKind: condition.kind,
    derivation: deepFreeze({
      source: 'declared-validation-condition',
      conditionDigest,
    }),
    evaluationStage,
    verificationStage,
    revisionPolicy,
    validatorProfile: deepFreeze({
      requiredSkills: [...request.expertRequirements.requiredCapabilities],
    }),
    derivedAt: derivedAtIso,
    digest,
  });
  return deepFreeze({ outcome: 'plan-derivable', plan });
}

/** The validation fabric a plan's primary stage routes onto (C007 seam). */
export function primaryFabricOf(plan: ValidationPlan): 'evaluation-fabric' | 'verification-fabric' {
  return plan.evaluationStage.evaluatorKind === 'deterministic-test'
    ? 'verification-fabric'
    : 'evaluation-fabric';
}

/** Structural guard for wire values claiming to be validation plans. */
export function isValidationPlan(value: unknown): value is ValidationPlan {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['planVersion'] !== VALIDATION_PLAN_VERSION) return false;
  if (!isValidationPlanId(candidate['planId'])) return false;
  if (typeof candidate['digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(candidate['digest'])) {
    return false;
  }
  if (!isValidationConditionKind(candidate['conditionKind'])) return false;
  const derivation = candidate['derivation'];
  if (
    typeof derivation !== 'object' ||
    derivation === null ||
    (derivation as Record<string, unknown>)['source'] !== 'declared-validation-condition'
  ) {
    return false;
  }
  const evaluationStage = candidate['evaluationStage'];
  if (
    typeof evaluationStage !== 'object' ||
    evaluationStage === null ||
    !EVALUATOR_KINDS.includes((evaluationStage as Record<string, unknown>)['evaluatorKind'] as EvaluatorKind)
  ) {
    return false;
  }
  const verificationStage = candidate['verificationStage'];
  if (
    typeof verificationStage !== 'object' ||
    verificationStage === null ||
    !VERIFIER_METHODS.includes((verificationStage as Record<string, unknown>)['verifierMethod'] as VerifierMethod)
  ) {
    return false;
  }
  return typeof candidate['derivedAt'] === 'string' && isPlainJsonValue(candidate['digest']);
}

/** Re-validate a plan's declared-condition invariants (guards reuse). */
export function assertPlanCondition(plan: ValidationPlan): void {
  requireBoundedString(plan.requestId, 'plan.requestId');
  requireBoundedString(plan.tenantId, 'plan.tenantId');
}
