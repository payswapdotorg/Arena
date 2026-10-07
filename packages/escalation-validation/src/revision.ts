/**
 * The bounded revision loop (Work Order C009; issue #116;
 * spec/escalation-reference-flow.md step 12 — "requests revision … if
 * validation fails"; spec/expert-escalation-api.md ES1.0
 * REVISION_REQUIRED lifecycle state).
 *
 * A REVISION_REQUIRED verdict becomes a TYPED revision request:
 *   - what must change (machine-readable change codes + details,
 *     derived from the adjudication reasons);
 *   - the resubmission deadline (the earlier of the request's own
 *     deadline and now + the plan's revision window);
 *   - the attempt number (1-based, monotonic per escalation).
 *
 * The loop is BOUNDED by the versioned max-revision policy: once
 * attempts are exhausted the only reachable verdict is REJECTED with
 * reasons — there is no code path that grants an (N+1)-th revision.
 * Every round is APPEND-ONLY (the validation history records each
 * revision request; supersession, never rewriting — lock rule 6).
 */

import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import type { AdjudicationOutcome, AdjudicationReason } from './adjudication.js';
import type { RevisionPolicy } from './plan.js';
import { deepFreeze, rejectUnknownFields } from './shared.js';
import type { RevisionRequestId } from './shared.js';
import { isRevisionRequestId, requireBoundedString } from './shared.js';

/** Wire version of the revision shapes. */
export const REVISION_REQUEST_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Revision state (the bounded loop's accounting)
// ---------------------------------------------------------------------------

/** The revision loop's accounting state (pure, per escalation). */
export interface RevisionState {
  /** Adjudication rounds consumed so far (>= 1 when adjudicated once). */
  readonly attemptNumber: number;
  /** The plan's max attempts (>= 1; the bound). */
  readonly maxRevisionAttempts: number;
}

export const REVISION_STATE_FIELDS = Object.freeze(['attemptNumber', 'maxRevisionAttempts'] as const);

/** The initial revision state of a freshly-routed escalation. */
export function initialRevisionState(policy: RevisionPolicy): RevisionState {
  return deepFreeze({
    attemptNumber: 1,
    maxRevisionAttempts: policy.maxRevisionAttempts,
  });
}

/** Advance the accounting after one adjudication round (append-only semantics). */
export function nextRevisionState(state: RevisionState): RevisionState {
  return deepFreeze({
    attemptNumber: state.attemptNumber + 1,
    maxRevisionAttempts: state.maxRevisionAttempts,
  });
}

/**
 * Typed check: may another revision round begin? NEVER a bare boolean —
 * the exhaustion verdict carries the machine-readable reason.
 */
export function checkRevisionBudget(
  state: RevisionState,
): { readonly allowed: true } | { readonly allowed: false; readonly reason: 'revision-budget-exhausted' } {
  if (state.attemptNumber > state.maxRevisionAttempts) {
    return deepFreeze({ allowed: false, reason: 'revision-budget-exhausted' });
  }
  return deepFreeze({ allowed: true });
}

// ---------------------------------------------------------------------------
// Revision change codes (what must change — closed vocabulary)
// ---------------------------------------------------------------------------

export const REVISION_CHANGE_CODES = Object.freeze([
  'criteria-not-met',
  'evidence-missing',
  'evidence-unsupported',
  'evidence-indeterminate',
  'output-schema-mismatch',
] as const);
export type RevisionChangeCode = (typeof REVISION_CHANGE_CODES)[number];

export function isRevisionChangeCode(value: unknown): value is RevisionChangeCode {
  return (
    typeof value === 'string' && (REVISION_CHANGE_CODES as readonly string[]).includes(value)
  );
}

/**
 * Derive the machine-readable required changes from an adjudication
 * outcome's reasons (deterministic mapping, closed vocabulary).
 */
export function requiredChangesOf(
  outcome: AdjudicationOutcome,
): readonly { readonly code: RevisionChangeCode; readonly detail: string; readonly ref: string | null }[] {
  const changes: {
    code: RevisionChangeCode;
    detail: string;
    ref: string | null;
  }[] = [];
  const push = (code: RevisionChangeCode, reason: AdjudicationReason): void => {
    changes.push({ code, detail: reason.detail, ref: reason.ref });
  };
  for (const reason of outcome.reasons) {
    switch (reason.code) {
      case 'evaluation-below-criteria':
        push('criteria-not-met', reason);
        break;
      case 'verification-unknown':
        push('evidence-missing', reason);
        break;
      case 'verification-fail':
        push('evidence-unsupported', reason);
        break;
      case 'evaluation-inconclusive':
        push('evidence-indeterminate', reason);
        break;
      default:
        break;
    }
  }
  if (changes.length === 0) {
    // Fail-closed: a revision request with nothing to change is a
    // contradiction — the verdict disagreed with its reasons.
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: 'no derivable required changes from the adjudication reasons',
      details: { verdictId: outcome.verdictId },
    });
  }
  return Object.freeze(changes);
}

// ---------------------------------------------------------------------------
// The typed revision request
// ---------------------------------------------------------------------------

export interface RevisionRequest {
  readonly revisionVersion: typeof REVISION_REQUEST_VERSION;
  readonly revisionId: RevisionRequestId;
  readonly requestId: string;
  readonly tenantId: string;
  /** 1-based revision attempt this request opens. */
  readonly attemptNumber: number;
  readonly requiredChanges: readonly {
    readonly code: RevisionChangeCode;
    readonly detail: string;
    readonly ref: string | null;
  }[];
  /** The resubmission deadline (canonical ms-UTC). */
  readonly resubmissionDeadline: string;
  readonly requestedAt: string;
}

export const REVISION_REQUEST_FIELDS = Object.freeze([
  'revisionVersion',
  'revisionId',
  'requestId',
  'tenantId',
  'attemptNumber',
  'requiredChanges',
  'resubmissionDeadline',
  'requestedAt',
] as const);

export interface CreateRevisionRequestInput {
  readonly revisionId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly attemptNumber: number;
  readonly requiredChanges: readonly {
    readonly code: string;
    readonly detail: string;
    readonly ref?: string | null;
  }[];
  readonly resubmissionDeadline: string;
  readonly requestedAt: string;
}

/**
 * Create and freeze one typed revision request (strict, fail-closed:
 * unknown fields are rejected; the attempt number must be inside the
 * policy bound — the revision-limit bypass is IMPOSSIBLE by
 * construction).
 */
export function createRevisionRequest(
  input: CreateRevisionRequestInput,
  policy: RevisionPolicy,
): RevisionRequest {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: 'revision request input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'revisionId',
      'requestId',
      'tenantId',
      'attemptNumber',
      'requiredChanges',
      'resubmissionDeadline',
      'requestedAt',
    ],
    'RevisionRequest',
  );
  if (!isRevisionRequestId(input.revisionId)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: `revision request id is invalid: ${JSON.stringify(input.revisionId)}`,
    });
  }
  requireBoundedString(input.requestId, 'requestId');
  requireBoundedString(input.tenantId, 'tenantId');
  if (
    typeof input.attemptNumber !== 'number' ||
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber < 1
  ) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: 'attemptNumber must be an integer >= 1',
    });
  }
  // THE BOUND: an attempt beyond the policy can NEVER be constructed.
  if (input.attemptNumber > policy.maxRevisionAttempts) {
    throw new EscalationValidationError(
      ESCALATION_VALIDATION_ERROR_CODES.REVISION_BUDGET_EXHAUSTED,
      {
        message: `revision attempt ${input.attemptNumber} exceeds the policy bound ${policy.maxRevisionAttempts} (revision-limit bypass denied)`,
        details: {
          attemptNumber: input.attemptNumber,
          maxRevisionAttempts: policy.maxRevisionAttempts,
        },
      },
    );
  }
  if (!Array.isArray(input.requiredChanges) || input.requiredChanges.length === 0) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: 'a revision request REQUIRES machine-readable required changes (>= 1)',
    });
  }
  const requiredChanges = input.requiredChanges.map((change) => {
    if (!isRevisionChangeCode(change.code)) {
      throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
        message: `revision change code is not in the closed vocabulary: ${JSON.stringify(change.code)}`,
        details: { vocabulary: REVISION_CHANGE_CODES },
      });
    }
    return deepFreeze({
      code: change.code,
      detail: requireBoundedString(change.detail, 'change.detail'),
      ref: change.ref === undefined || change.ref === null ? null : change.ref,
    });
  });
  requireBoundedString(input.resubmissionDeadline, 'resubmissionDeadline');
  requireBoundedString(input.requestedAt, 'requestedAt');
  if (Date.parse(input.resubmissionDeadline) <= Date.parse(input.requestedAt)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REVISION, {
      message: 'resubmissionDeadline must be after requestedAt',
    });
  }

  return deepFreeze({
    revisionVersion: REVISION_REQUEST_VERSION,
    revisionId: input.revisionId,
    requestId: input.requestId,
    tenantId: input.tenantId,
    attemptNumber: input.attemptNumber,
    requiredChanges: Object.freeze(requiredChanges),
    resubmissionDeadline: input.resubmissionDeadline,
    requestedAt: input.requestedAt,
  });
}

/**
 * Derive the resubmission deadline: the EARLIER of the escalation
 * request's own deadline and now + the plan's revision window (the
 * escalation deadline always dominates — it is the C001 law).
 */
export function revisionResubmissionDeadline(
  requestDeadline: string,
  policy: RevisionPolicy,
  now: number | string | Date,
): string {
  const nowMs =
    now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  const byWindow = new Date(nowMs + policy.revisionWindowMs).toISOString();
  const deadline = Date.parse(requestDeadline) <= Date.parse(byWindow) ? requestDeadline : byWindow;
  return deadline;
}

/** Structural guard for wire values claiming to be revision requests. */
export function isRevisionRequest(value: unknown): value is RevisionRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['revisionVersion'] === REVISION_REQUEST_VERSION &&
    isRevisionRequestId(candidate['revisionId']) &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['attemptNumber'] === 'number' &&
    Array.isArray(candidate['requiredChanges']) &&
    candidate['requiredChanges'].length > 0 &&
    typeof candidate['resubmissionDeadline'] === 'string'
  );
}
