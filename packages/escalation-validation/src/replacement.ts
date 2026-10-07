/**
 * Expert replacement (Work Order C009; issue #116;
 * spec/expert-escalation-api.md ES1.0 — "Timeout, cancellation and
 * expert replacement are explicit states";
 * spec/escalation-reference-flow.md step 12 — "…replaces the expert if
 * validation fails").
 *
 * Replacement is a TYPED trigger -> the C001 EXPLICIT replacement state
 * transition (offered/accepted/session_ready/in_progress/
 * result_rejected → EXPERT_REPLACED) → back into MATCHING through the
 * C002 routing seam. There is NO silent state mutation: every
 * replacement request is a first-class record in the append-only
 * validation history, and the replaced expert's evidence and history
 * are RETAINED (lock rule 6 — historical evidence is append-only and
 * never rewritten).
 */

import type { EscalationState } from '@arena/escalation';
import { ESCALATION_VALIDATION_ERROR_CODES, EscalationValidationError } from './errors.js';
import { deepFreeze, rejectUnknownFields } from './shared.js';
import { requireBoundedString } from './shared.js';

/** Wire version of the replacement shapes. */
export const REPLACEMENT_REQUEST_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Typed replacement triggers (closed vocabulary)
// ---------------------------------------------------------------------------

export const REPLACEMENT_TRIGGERS = Object.freeze([
  /** Validation failed BEYOND the revision budget (REJECTED). */
  'validation-failure-beyond-revision',
  /** Validation failed while the escalation was still in flight (host policy). */
  'validation-failure',
  /** The escalation stalled past a replacement window (pre-deadline). */
  'timeout',
  /** The expert withdrew (host-recorded). */
  'withdrawal',
] as const);
export type ReplacementTrigger = (typeof REPLACEMENT_TRIGGERS)[number];

export function isReplacementTrigger(value: unknown): value is ReplacementTrigger {
  return (
    typeof value === 'string' && (REPLACEMENT_TRIGGERS as readonly string[]).includes(value)
  );
}

/** The C001 states a replacement may depart from (the explicit funnel). */
export const REPLACEMENT_SOURCE_STATES = Object.freeze([
  'offered',
  'accepted',
  'session_ready',
  'in_progress',
  'result_rejected',
] as const);
export type ReplacementSourceState = (typeof REPLACEMENT_SOURCE_STATES)[number];

/** The closed replacement verdict reason vocabulary. */
export const REPLACEMENT_CHECK_REASONS = Object.freeze([
  'replacement-ok',
  'replacement-trigger-unknown',
  'replacement-not-allowed-from-state',
  'replacement-trigger-incompatible-with-state',
] as const);
export type ReplacementCheckReason = (typeof REPLACEMENT_CHECK_REASONS)[number];

/** The trigger classes each source state admits. */
const TRIGGERS_BY_STATE: Readonly<
  Record<ReplacementSourceState, readonly ReplacementTrigger[]>
> = Object.freeze({
  // A REJECTED escalation replaces ONLY on the beyond-revision trigger.
  result_rejected: Object.freeze(['validation-failure-beyond-revision'] as readonly ReplacementTrigger[]),
  // In-flight states admit timeout/withdrawal/failure triggers.
  offered: Object.freeze(['timeout', 'withdrawal'] as readonly ReplacementTrigger[]),
  accepted: Object.freeze(['timeout', 'withdrawal'] as readonly ReplacementTrigger[]),
  session_ready: Object.freeze(['timeout', 'withdrawal'] as readonly ReplacementTrigger[]),
  in_progress: Object.freeze([
    'timeout',
    'withdrawal',
    'validation-failure',
  ] as readonly ReplacementTrigger[]),
});

/**
 * Typed trigger/state compatibility check — NEVER a bare boolean. The
 * verdict is the machine-readable guard the service applies before the
 * C001 `replaceExpert` transition (defense in depth: C001's own
 * adjacency table is the second, independent guard).
 */
export function checkReplacementTrigger(
  state: EscalationState,
  trigger: ReplacementTrigger,
): {
  readonly allowed: boolean;
  readonly reason: ReplacementCheckReason;
  readonly from: EscalationState;
} {
  const source = state as ReplacementSourceState;
  if (!(REPLACEMENT_SOURCE_STATES as readonly string[]).includes(source)) {
    return deepFreeze({
      allowed: false,
      reason: 'replacement-not-allowed-from-state',
      from: state,
    });
  }
  if (!(TRIGGERS_BY_STATE[source] as readonly string[]).includes(trigger)) {
    return deepFreeze({
      allowed: false,
      reason: 'replacement-trigger-incompatible-with-state',
      from: state,
    });
  }
  return deepFreeze({ allowed: true, reason: 'replacement-ok', from: state });
}

// ---------------------------------------------------------------------------
// The typed replacement request
// ---------------------------------------------------------------------------

export interface ReplacementRequest {
  readonly replacementVersion: typeof REPLACEMENT_REQUEST_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  readonly trigger: ReplacementTrigger;
  /** The expert being replaced (their evidence/history is RETAINED). */
  readonly replacedExpertRef: string | null;
  readonly reasonDetail: string;
  /** Where the escalation returns to (the C001 funnel law). */
  readonly routedBackTo: 'matching';
  readonly occurredAt: string;
}

export const REPLACEMENT_REQUEST_FIELDS = Object.freeze([
  'replacementVersion',
  'requestId',
  'tenantId',
  'trigger',
  'replacedExpertRef',
  'reasonDetail',
  'routedBackTo',
  'occurredAt',
] as const);

export interface CreateReplacementRequestInput {
  readonly requestId: string;
  readonly tenantId: string;
  readonly trigger: string;
  readonly replacedExpertRef?: string | null;
  readonly reasonDetail: string;
  readonly occurredAt: string;
}

/** Create and freeze one typed replacement request (strict, fail-closed). */
export function createReplacementRequest(
  input: CreateReplacementRequestInput,
): ReplacementRequest {
  if (typeof input !== 'object' || input === null) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REPLACEMENT, {
      message: 'replacement request input must be an object',
    });
  }
  rejectUnknownFields(
    input as unknown as Readonly<Record<string, unknown>>,
    [
      'requestId',
      'tenantId',
      'trigger',
      'replacedExpertRef',
      'reasonDetail',
      'occurredAt',
    ],
    'ReplacementRequest',
  );
  if (!isReplacementTrigger(input.trigger)) {
    throw new EscalationValidationError(ESCALATION_VALIDATION_ERROR_CODES.INVALID_REPLACEMENT, {
      message: `replacement trigger is not in the closed vocabulary: ${JSON.stringify(input.trigger)}`,
      details: { vocabulary: REPLACEMENT_TRIGGERS },
    });
  }
  requireBoundedString(input.requestId, 'requestId');
  requireBoundedString(input.tenantId, 'tenantId');
  requireBoundedString(input.reasonDetail, 'reasonDetail');
  requireBoundedString(input.occurredAt, 'occurredAt');
  return deepFreeze({
    replacementVersion: REPLACEMENT_REQUEST_VERSION,
    requestId: input.requestId,
    tenantId: input.tenantId,
    trigger: input.trigger,
    replacedExpertRef:
      input.replacedExpertRef === undefined || input.replacedExpertRef === null
        ? null
        : requireBoundedString(input.replacedExpertRef, 'replacedExpertRef'),
    reasonDetail: input.reasonDetail,
    routedBackTo: 'matching',
    occurredAt: input.occurredAt,
  });
}

/** Structural guard for wire values claiming to be replacement requests. */
export function isReplacementRequest(value: unknown): value is ReplacementRequest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['replacementVersion'] === REPLACEMENT_REQUEST_VERSION &&
    isReplacementTrigger(candidate['trigger']) &&
    typeof candidate['requestId'] === 'string' &&
    candidate['routedBackTo'] === 'matching' &&
    typeof candidate['reasonDetail'] === 'string'
  );
}
