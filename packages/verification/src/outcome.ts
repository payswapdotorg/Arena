/**
 * Verification outcome semantics (Work Order A013; spec EV1.0
 * "Verification"; architecture-lock rule 7 — verification establishes
 * whether required evidence exists and supports required claims, and
 * NEVER emits numerical or graded quality assessments).
 *
 * The outcome vocabulary is CLOSED and totals exactly three members:
 *
 *   pass    — all required evidence is present AND supports the claims;
 *   fail    — required evidence is present but contradicts / does not
 *             support the claims;
 *   unknown — insufficient evidence (or insufficient trust in the
 *             evidence, or an inconclusive method) to decide.
 *
 * There is deliberately NO fourth outcome, NO numeric member and NO
 * graded member: a quantitative quality label is impossible by
 * construction (the outcome is DERIVED from the evidence-support summary
 * by deriveVerificationOutcome — a pure total function — and never
 * accepted from callers).
 *
 * OutcomeSemantics (EV1.0: "A verifier declares required evidence,
 * method, pass/fail/unknown semantics and reproducibility policy"):
 * every VerifierDescriptor must declare, in its own words, what pass,
 * fail and unknown MEAN for that particular verifier — all three
 * declarations are mandatory, non-empty neutral text.
 *
 * Unknown reasons (EV1.0-adjacent taxonomy fixed by this Work Order):
 * an `unknown` outcome MUST record WHY —
 *
 *   missing-evidence         — at least one required evidence item was
 *                              absent (or its reference unresolvable);
 *   unverifiable-provenance  — at least one present evidence item failed
 *                              digest or provenance-chain validation;
 *   method-limitation        — the method could not decide even with
 *                              verified evidence present.
 *
 * Precedence when several causes coexist: missing-evidence >
 * unverifiable-provenance > method-limitation (deterministic, so the
 * derived reason is a pure function of the support summary).
 */

import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import {
  deepFreeze,
  expectEnumMember,
  expectFields,
  isNeutralText,
  toNeutralText,
} from './shared.js';
import type { NeutralText } from './shared.js';
import type { EvidenceSupportSummary } from './evidence.js';
import { isEvidenceSupportSummary } from './evidence.js';

/** The CLOSED outcome vocabulary — totals exactly pass | fail | unknown. */
export const VERIFICATION_OUTCOMES = Object.freeze(['pass', 'fail', 'unknown'] as const);

export type VerificationOutcome = (typeof VERIFICATION_OUTCOMES)[number];

/** Structural (non-throwing) check for the closed outcome enum. */
export function isVerificationOutcome(value: unknown): value is VerificationOutcome {
  return (
    typeof value === 'string' &&
    (VERIFICATION_OUTCOMES as readonly string[]).includes(value)
  );
}

/** Validate a verification outcome against the closed enum. */
export function toVerificationOutcome(value: string, context: string): VerificationOutcome {
  return expectEnumMember(
    value,
    VERIFICATION_OUTCOMES,
    'outcome',
    VERIFICATION_ERROR_CODES.INVALID_OUTCOME,
    context,
  );
}

// ---------------------------------------------------------------------------
// Declared per-verifier outcome semantics (EV1.0)
// ---------------------------------------------------------------------------

/**
 * The declared meaning of each outcome for THIS verifier (EV1.0: a
 * verifier declares pass/fail/unknown semantics). All three are
 * mandatory non-empty neutral text — a descriptor that leaves any
 * outcome's meaning undeclared is rejected at construction.
 */
export interface OutcomeSemantics {
  /** What `pass` establishes for this verifier. */
  readonly pass: NeutralText;
  /** What `fail` establishes for this verifier. */
  readonly fail: NeutralText;
  /** What `unknown` establishes for this verifier. */
  readonly unknown: NeutralText;
}

/** Stable field list for outcome semantics (tests + contracts mirror it). */
export const OUTCOME_SEMANTICS_FIELDS = Object.freeze([
  'pass',
  'fail',
  'unknown',
] as const) as readonly string[];

export interface OutcomeSemanticsInput {
  readonly pass: string;
  readonly fail: string;
  readonly unknown: string;
}

/** Structural (non-throwing) check for declared outcome semantics. */
export function isOutcomeSemantics(value: unknown): value is OutcomeSemantics {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isNeutralText(candidate['pass']) &&
    isNeutralText(candidate['fail']) &&
    isNeutralText(candidate['unknown'])
  );
}

/** Validate and freeze declared outcome semantics. */
export function toOutcomeSemantics(value: unknown): OutcomeSemantics {
  const record = expectFields(
    value,
    ['pass', 'fail', 'unknown'],
    [],
    VERIFICATION_ERROR_CODES.INVALID_OUTCOME,
    'verifier outcome semantics',
  );
  return deepFreeze({
    pass: toNeutralText(
      typeof record['pass'] === 'string' ? record['pass'] : '',
      'outcome semantics pass',
    ),
    fail: toNeutralText(
      typeof record['fail'] === 'string' ? record['fail'] : '',
      'outcome semantics fail',
    ),
    unknown: toNeutralText(
      typeof record['unknown'] === 'string' ? record['unknown'] : '',
      'outcome semantics unknown',
    ),
  });
}

// ---------------------------------------------------------------------------
// Unknown reasons (closed taxonomy)
// ---------------------------------------------------------------------------

/** The CLOSED reason taxonomy for `unknown` outcomes. */
export const UNKNOWN_REASONS = Object.freeze([
  'missing-evidence',
  'unverifiable-provenance',
  'method-limitation',
] as const);

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

/** Stable field list for a derived unknown cause. */
export const UNKNOWN_CAUSE_FIELDS = Object.freeze(['reason', 'detail'] as const) as readonly string[];

/** The structured WHY of an `unknown` outcome (mandatory on unknown records). */
export interface UnknownCause {
  /** The closed reason taxonomy member. */
  readonly reason: UnknownReason;
  /** Deterministic detail: the requirement ids driving this cause, in summary order. */
  readonly detail: NeutralText;
}

/** Structural (non-throwing) check for the closed unknown-reason enum. */
export function isUnknownReason(value: unknown): value is UnknownReason {
  return (
    typeof value === 'string' &&
    (UNKNOWN_REASONS as readonly string[]).includes(value)
  );
}

/** Structural (non-throwing) check for a structured unknown cause. */
export function isUnknownCause(value: unknown): value is UnknownCause {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isUnknownReason(candidate['reason']) && isNeutralText(candidate['detail']);
}

// ---------------------------------------------------------------------------
// The pure outcome derivation (total by construction)
// ---------------------------------------------------------------------------

/** Which status drives which unknown reason (the closed mapping). */
const STATUS_CAUSE: Readonly<Record<'missing' | 'present-unverified' | 'present-indeterminate', UnknownReason>> = {
  missing: 'missing-evidence',
  'present-unverified': 'unverifiable-provenance',
  'present-indeterminate': 'method-limitation',
};

/**
 * Derive the outcome AND its structured unknown cause PURELY from the
 * evidence-support summary — the total heart of the protocol:
 *
 *   any requirement missing             → unknown / missing-evidence
 *   else any present-unverified         → unknown / unverifiable-provenance
 *   else any present-indeterminate      → unknown / method-limitation
 *   else any present-unsupported        → fail
 *   else (all present-supported)        → pass
 *
 * Every possible summary maps to EXACTLY one outcome (totality property
 * test), and the outcome is one of the three closed members — there is
 * no input for which this function produces, or could produce, a
 * numerical or graded value (lock rule 7 regression guarantee). The
 * unknown cause's detail lists the requirement ids driving the selected
 * reason, in summary order (deterministic).
 */
export function deriveVerificationOutcome(
  summary: EvidenceSupportSummary,
): { readonly outcome: VerificationOutcome; readonly unknownCause: UnknownCause | null } {
  if (!isEvidenceSupportSummary(summary)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'outcome derivation requires a structurally valid evidence-support summary',
    });
  }
  if (summary.length === 0) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_EVIDENCE, {
      message: 'outcome derivation requires a non-empty evidence-support summary (a verifier with no requirements can never establish evidence)',
    });
  }
  for (const status of ['missing', 'present-unverified', 'present-indeterminate'] as const) {
    const drivers = summary.filter((entry) => entry.status === status);
    if (drivers.length > 0) {
      const reason = STATUS_CAUSE[status];
      return {
        outcome: 'unknown',
        unknownCause: deepFreeze({
          reason,
          detail: `${reason}: ${drivers.map((entry) => entry.requirementId).join(', ')}` as NeutralText,
        }),
      };
    }
  }
  if (summary.some((entry) => entry.status === 'present-unsupported')) {
    return { outcome: 'fail', unknownCause: null };
  }
  return { outcome: 'pass', unknownCause: null };
}
