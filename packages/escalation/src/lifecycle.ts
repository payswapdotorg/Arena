/**
 * Escalation lifecycle — the durable state machine (Work Order C001;
 * spec/expert-escalation-api.md ES1.0 "Lifecycle").
 *
 *   CREATED → TRIAGED → MATCHING → OFFERED → ACCEPTED → SESSION_READY →
 *   IN_PROGRESS → SUBMITTED → VALIDATING →
 *   ACCEPTED | REVISION_REQUIRED | REJECTED → PAID → LEARNING_CAPTURED →
 *   CLOSED
 *
 * with EXPLICIT timeout (TIMED_OUT), cancellation (CANCELLED) and
 * expert-replacement (EXPERT_REPLACED → MATCHING) states. Timeout,
 * cancellation and expert replacement are never implicit side effects —
 * they are first-class states with their own guarded transitions.
 *
 * House discipline (mirroring @arena/job-protocol's JobRecord):
 *   - every transition is a PURE function returning a NEW deep-frozen
 *     record (append-only: history entries are never rewritten);
 *   - terminal states are FINAL (every op on a terminal record fails
 *     closed with ESCALATION_TERMINAL_STATE);
 *   - transition verdicts are MACHINE-READABLE (closed reason
 *     vocabulary — never a bare boolean);
 *   - all timestamps are injected (no wall-clock reads — lock rule 17);
 *   - tenant isolation is enforced at the DOMAIN level: every
 *     transition context may carry an expected tenant, and a mismatch is
 *     a typed CROSS_TENANT_ACCESS failure.
 */

import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import type { EscalationRequest } from './request.js';
import type { EscalationResult } from './results.js';
import type { ExpertRef, EscalationTimestamp, SessionRef, TenantId } from './shared.js';
import {
  deepFreeze,
  isEscalationTimestamp,
  isExpertRef,
  isSessionRef,
  toEscalationTimestamp,
  toExpertRef,
  toSessionRef,
} from './shared.js';

/** Wire version of the escalation record shape. */
export const ESCALATION_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed state vocabulary (ES1.0 + explicit timeout/cancel/replacement)
// ---------------------------------------------------------------------------

export const ESCALATION_STATES = Object.freeze([
  'created',
  'triaged',
  'matching',
  'offered',
  'accepted',
  'session_ready',
  'in_progress',
  'submitted',
  'validating',
  'result_accepted',
  'revision_required',
  'result_rejected',
  'paid',
  'learning_captured',
  'expert_replaced',
  'closed',
  'cancelled',
  'timed_out',
] as const);
export type EscalationState = (typeof ESCALATION_STATES)[number];

/** Terminal states — nothing may follow them (final by construction). */
export const ESCALATION_TERMINAL_STATES = Object.freeze([
  'closed',
  'cancelled',
  'timed_out',
] as const);
export type TerminalEscalationState = (typeof ESCALATION_TERMINAL_STATES)[number];

export function isEscalationState(value: unknown): value is EscalationState {
  return typeof value === 'string' && (ESCALATION_STATES as readonly string[]).includes(value);
}

export function isTerminalEscalationState(value: unknown): value is TerminalEscalationState {
  return (
    typeof value === 'string' &&
    (ESCALATION_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

/** Closed adjacency: the ONLY legal transitions out of each state. */
export const ESCALATION_TRANSITIONS: Readonly<Record<EscalationState, readonly EscalationState[]>> = Object.freeze({
  created: Object.freeze(['triaged', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  triaged: Object.freeze(['matching', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  matching: Object.freeze(['offered', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  offered: Object.freeze(['accepted', 'expert_replaced', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  accepted: Object.freeze(['session_ready', 'expert_replaced', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  session_ready: Object.freeze(['in_progress', 'expert_replaced', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  in_progress: Object.freeze(['submitted', 'expert_replaced', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  submitted: Object.freeze(['validating', 'timed_out'] as readonly EscalationState[]),
  validating: Object.freeze(['result_accepted', 'revision_required', 'result_rejected', 'timed_out'] as readonly EscalationState[]),
  result_accepted: Object.freeze(['paid'] as readonly EscalationState[]),
  revision_required: Object.freeze(['in_progress', 'timed_out'] as readonly EscalationState[]),
  result_rejected: Object.freeze(['expert_replaced', 'closed'] as readonly EscalationState[]),
  paid: Object.freeze(['learning_captured', 'closed'] as readonly EscalationState[]),
  learning_captured: Object.freeze(['closed'] as readonly EscalationState[]),
  expert_replaced: Object.freeze(['matching', 'cancelled', 'timed_out'] as readonly EscalationState[]),
  closed: Object.freeze([] as readonly EscalationState[]),
  cancelled: Object.freeze([] as readonly EscalationState[]),
  timed_out: Object.freeze([] as readonly EscalationState[]),
});

// ---------------------------------------------------------------------------
// Machine-readable transition reasons (closed vocabulary — never a bare boolean)
// ---------------------------------------------------------------------------

export const ESCALATION_TRANSITION_REASONS = Object.freeze([
  'transition_ok',
  'transition_not_adjacent',
  'transition_terminal_source',
  'transition_deadline_passed',
  'transition_requires_result',
  'transition_requires_validation',
  'transition_requires_cost',
  'transition_tenant_mismatch',
] as const);
export type EscalationTransitionReason =
  (typeof ESCALATION_TRANSITION_REASONS)[number];

export function isEscalationTransitionReason(value: unknown): value is EscalationTransitionReason {
  return (
    typeof value === 'string' &&
    (ESCALATION_TRANSITION_REASONS as readonly string[]).includes(value)
  );
}

/** The typed verdict of a proposed transition (house verdict style). */
export interface EscalationTransitionCheck {
  readonly allowed: boolean;
  readonly reason: EscalationTransitionReason;
  readonly from: EscalationState;
  readonly to: EscalationState;
}

// ---------------------------------------------------------------------------
// Record + append-only history
// ---------------------------------------------------------------------------

export interface EscalationStateHistoryEntry {
  /** 1-based monotonic sequence within this escalation's history. */
  readonly sequence: number;
  /** Source state (null for the creation entry). */
  readonly from: EscalationState | null;
  readonly to: EscalationState;
  readonly occurredAt: EscalationTimestamp;
  readonly reason: EscalationTransitionReason | 'creation';
  /** Acting principal (e.g. client app, expert, system); optional. */
  readonly actor?: string;
}

export type EscalationValidationStatus = 'pending' | 'passed' | 'failed';

export interface EscalationCostFields {
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly arenaFeeMinorUnits: number;
  readonly expertPayoutStatus: 'pending' | 'paid';
}

export interface EscalationRecord {
  readonly recordVersion: typeof ESCALATION_RECORD_VERSION;
  readonly request: EscalationRequest;
  readonly state: EscalationState;
  /** Append-only, deep-frozen, contiguous 1..n. */
  readonly history: readonly EscalationStateHistoryEntry[];
  readonly expertRef?: ExpertRef;
  readonly sessionRef?: SessionRef;
  readonly result?: EscalationResult;
  readonly validationStatus?: EscalationValidationStatus;
  readonly cost?: EscalationCostFields;
  readonly updatedAt: EscalationTimestamp;
}

export interface TransitionContext {
  /** Injected transition time (epoch ms / ISO string / Date). */
  readonly now: number | string | Date;
  /** Expected tenant — a mismatch is a typed cross-tenant failure. */
  readonly tenantId?: string;
  /** Result required when entering `submitted`. */
  readonly result?: EscalationResult;
  /** Validation status required when leaving `validating`. */
  readonly validationStatus?: EscalationValidationStatus;
  /** Cost fields required when entering `paid`. */
  readonly cost?: EscalationCostFields;
  /** Expert reference (assigned at offer / replacement). */
  readonly expertRef?: string;
  /** Session reference (assigned entering `session_ready`). */
  readonly sessionRef?: string;
  readonly actor?: string;
}

/** Domain-level tenant check (fail-closed, typed). */
export function assertEscalationTenant(record: EscalationRecord, tenantId: string): void {
  if (record.request.tenantId !== tenantId) {
    throw new EscalationError(ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `escalation ${record.request.requestId} belongs to tenant ${record.request.tenantId}; tenant ${tenantId} may not touch it`,
      details: { requestId: record.request.requestId, recordTenant: record.request.tenantId },
    });
  }
}

/**
 * The machine-readable verdict for a proposed transition. NEVER a bare
 * boolean: every denial carries a closed-vocabulary reason.
 */
export function checkEscalationTransition(
  record: EscalationRecord,
  to: EscalationState,
  context: TransitionContext,
): EscalationTransitionCheck {
  if (!isEscalationState(to)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_STATE, {
      message: `unknown escalation state: ${JSON.stringify(to)}`,
    });
  }
  const from = record.state;
  const deny = (reason: EscalationTransitionReason): EscalationTransitionCheck => ({
    allowed: false,
    reason,
    from,
    to,
  });

  if (context.tenantId !== undefined && record.request.tenantId !== context.tenantId) {
    return deny('transition_tenant_mismatch');
  }
  if (isTerminalEscalationState(from)) {
    return deny('transition_terminal_source');
  }
  const occurredAt = toEscalationTimestamp(context.now);
  if (
    to !== 'timed_out' &&
    Date.parse(occurredAt) > Date.parse(record.request.deadline)
  ) {
    // After the deadline only the EXPLICIT timeout state is reachable.
    return deny('transition_deadline_passed');
  }
  if (!(ESCALATION_TRANSITIONS[from] as readonly string[]).includes(to)) {
    return deny('transition_not_adjacent');
  }
  if (to === 'submitted' && context.result === undefined) {
    return deny('transition_requires_result');
  }
  if (
    (to === 'result_accepted' || to === 'revision_required' || to === 'result_rejected') &&
    context.validationStatus === undefined
  ) {
    return deny('transition_requires_validation');
  }
  if (to === 'paid' && context.cost === undefined) {
    return deny('transition_requires_cost');
  }
  return { allowed: true, reason: 'transition_ok', from, to };
}

/**
 * Apply a guarded transition: returns a NEW frozen record with one
 * appended history entry. Throws typed EscalationError when the verdict
 * is not transition_ok (use checkEscalationTransition for the
 * non-throwing machine-readable form).
 */
export function applyEscalationTransition(
  record: EscalationRecord,
  to: EscalationState,
  context: TransitionContext,
): EscalationRecord {
  const verdict = checkEscalationTransition(record, to, context);
  if (!verdict.allowed) {
    if (verdict.reason === 'transition_tenant_mismatch') {
      throw new EscalationError(ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `cross-tenant transition denied on escalation ${record.request.requestId}`,
        details: { requestId: record.request.requestId, reason: verdict.reason },
      });
    }
    if (verdict.reason === 'transition_terminal_source') {
      throw new EscalationError(ESCALATION_ERROR_CODES.TERMINAL_STATE, {
        message: `escalation ${record.request.requestId} is in terminal state ${record.state}; no transition may follow`,
        details: { requestId: record.request.requestId, state: record.state },
      });
    }
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_TRANSITION, {
      message: `transition ${record.state} -> ${to} denied (${verdict.reason}) on escalation ${record.request.requestId}`,
      details: { requestId: record.request.requestId, reason: verdict.reason },
    });
  }

  const occurredAt = toEscalationTimestamp(context.now);
  const sequence = record.history.length + 1;
  const lastEntry = record.history[record.history.length - 1];
  if (lastEntry !== undefined && Date.parse(occurredAt) < Date.parse(lastEntry.occurredAt)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_TRANSITION, {
      message: 'history timestamps must be monotonically non-decreasing (injected clock ran backwards)',
    });
  }
  const entry: EscalationStateHistoryEntry = Object.freeze({
    sequence,
    from: record.state,
    to,
    occurredAt,
    reason: 'transition_ok',
    ...(context.actor !== undefined ? { actor: context.actor } : {}),
  });

  const next: EscalationRecord = Object.freeze({
    ...record,
    state: to,
    history: Object.freeze([...record.history, entry]),
    updatedAt: occurredAt,
    ...(context.result !== undefined ? { result: context.result } : {}),
    ...(context.validationStatus !== undefined ? { validationStatus: context.validationStatus } : {}),
    ...(context.cost !== undefined ? { cost: context.cost } : {}),
    ...(context.expertRef !== undefined ? { expertRef: toExpertRef(context.expertRef) } : {}),
    ...(context.sessionRef !== undefined ? { sessionRef: toSessionRef(context.sessionRef) } : {}),
  });
  return next;
}

/** Create the initial record for a validated request (state `created`). */
export function createEscalationRecord(
  request: EscalationRequest,
  now: number | string | Date,
): EscalationRecord {
  const occurredAt = toEscalationTimestamp(now);
  const entry: EscalationStateHistoryEntry = Object.freeze({
    sequence: 1,
    from: null,
    to: 'created',
    occurredAt,
    reason: 'creation',
  });
  const record: EscalationRecord = Object.freeze({
    recordVersion: ESCALATION_RECORD_VERSION,
    request,
    state: 'created',
    history: Object.freeze([entry]),
    updatedAt: occurredAt,
  });
  deepFreeze(record as unknown as Parameters<typeof deepFreeze>[0]);
  return record;
}

// ---------------------------------------------------------------------------
// Named lifecycle operations (thin, guarded wrappers)
// ---------------------------------------------------------------------------

/** Cancel an escalation (explicit state; allowed from any non-terminal pre-submission state). */
export function cancelEscalation(
  record: EscalationRecord,
  context: { now: number | string | Date; tenantId?: string; actor?: string },
): EscalationRecord {
  return applyEscalationTransition(record, 'cancelled', context);
}

/** Mark an escalation TIMED_OUT (explicit state; the only post-deadline transition). */
export function markEscalationTimedOut(
  record: EscalationRecord,
  context: { now: number | string | Date; tenantId?: string; actor?: string },
): EscalationRecord {
  return applyEscalationTransition(record, 'timed_out', context);
}

/**
 * Replace the assigned expert (explicit state): offered/accepted/
 * session_ready/in_progress (and result_rejected) funnel through
 * EXPERT_REPLACED back into MATCHING.
 */
export function replaceExpert(
  record: EscalationRecord,
  context: { now: number | string | Date; tenantId?: string; actor?: string },
): EscalationRecord {
  return applyEscalationTransition(record, 'expert_replaced', context);
}

/** Submit the expert result (in_progress → submitted; result is REQUIRED). */
export function submitEscalationResult(
  record: EscalationRecord,
  result: EscalationResult,
  context: { now: number | string | Date; tenantId?: string; actor?: string },
): EscalationRecord {
  return applyEscalationTransition(record, 'submitted', { ...context, result });
}

/** Structural guard for wire values claiming to be escalation records. */
export function isEscalationRecord(value: unknown): value is EscalationRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['recordVersion'] !== ESCALATION_RECORD_VERSION ||
    !isEscalationState(candidate['state']) ||
    !isEscalationTimestamp(candidate['updatedAt'])
  ) {
    return false;
  }
  if (candidate['expertRef'] !== undefined && !isExpertRef(candidate['expertRef'])) return false;
  if (candidate['sessionRef'] !== undefined && !isSessionRef(candidate['sessionRef'])) return false;
  const history = candidate['history'];
  if (!Array.isArray(history) || history.length === 0) return false;
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index] as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null) return false;
    if (entry['sequence'] !== index + 1) return false;
    if (!isEscalationTimestamp(entry['occurredAt'])) return false;
  }
  return true;
}

/** Tenant extraction helper (the record's owning tenant). */
export function escalationTenant(record: EscalationRecord): TenantId {
  return record.request.tenantId;
}
