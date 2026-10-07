/**
 * The engagement lifecycle (Work Order C011; issue #117; spec/
 * expert-escalation-api.md ES1.0 OFFERED → ACCEPTED block + ERF1.0 steps
 * 3-4/12 — the house engagement pattern from services/marketplace-experts).
 *
 * One EngagementRecord binds ONE escalation (C001, referenced through its
 * request id — never mutated here) to ONE expert with:
 *
 *   OFFERED → ACCEPTED | DECLINED | EXPIRED
 *           → ACTIVE (session handoff) → COMPLETED | WITHDRAWN | REPLACED
 *
 * House discipline:
 *   - every transition is a PURE function returning a NEW deep-frozen
 *     record (append-only history; the prior record stays as-is);
 *   - terminal states are FINAL (declined | expired | completed |
 *     withdrawn | replaced — every further op fails closed);
 *   - the OFFER EXPIRY is a first-class guard: acceptance at or after
 *     offerExpiresAt fails closed with OFFER_EXPIRED (ERF1.0 offer/
 *     acceptance — never a best-effort);
 *   - transition verdicts are MACHINE-READABLE (closed reason
 *     vocabulary — never a bare boolean);
 *   - the record is CORRELATION-ADDRESSABLE and carries the idempotency
 *     key of the offer command (lock rule 17);
 *   - the record references the C010 commercial offer/budget-hold
 *     through OPAQUE PUBLIC REFS ONLY (digests/locators — this package
 *     owns NO money truth; settlement is C010's, keyed off this
 *     offer/acceptance handshake);
 *   - tenant isolation is enforced at the DOMAIN level (typed
 *     CROSS_TENANT_ACCESS — lock rule 11);
 *   - all timestamps are INJECTED (no wall-clock reads — lock rule 17);
 *   - the record is content-addressed (sha256 over canonical JSON);
 *     silent mutation of a committed record is detected by
 *     verifyEngagementDigest (TAMPERED).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';
import {
  deepFreeze,
  isEngagementContentDigest,
  isEngagementExpertId,
  isEngagementId,
  isEngagementTenant,
  isEngagementTimestamp,
  toEngagementContentDigest,
  toEngagementExpertId,
  toEngagementId,
  toEngagementLocator,
  toEngagementTenant,
  toEngagementTimestamp,
  toSlaUrgencyClass,
} from './shared.js';
import type {
  EngagementContentDigest,
  EngagementExpertId,
  EngagementId,
  EngagementLocator,
  EngagementNeutralText,
  EngagementTenant,
  EngagementTimestamp,
} from './shared.js';

/** Wire version of the engagement record shape. */
export const ENGAGEMENT_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed state vocabulary (the OFFERED → … → REPLACED lifecycle)
// ---------------------------------------------------------------------------

export const ENGAGEMENT_STATUSES = Object.freeze([
  'offered',
  'accepted',
  'declined',
  'expired',
  'active',
  'completed',
  'withdrawn',
  'replaced',
] as const);
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

/** Terminal states — nothing may follow them (final by construction). */
export const ENGAGEMENT_TERMINAL_STATUSES = Object.freeze([
  'declined',
  'expired',
  'completed',
  'withdrawn',
  'replaced',
] as const);
export type TerminalEngagementStatus = (typeof ENGAGEMENT_TERMINAL_STATUSES)[number];

export function isEngagementStatus(value: unknown): value is EngagementStatus {
  return (
    typeof value === 'string' &&
    (ENGAGEMENT_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalEngagementStatus(
  value: unknown,
): value is TerminalEngagementStatus {
  return (
    typeof value === 'string' &&
    (ENGAGEMENT_TERMINAL_STATUSES as readonly string[]).includes(value)
  );
}

/** The closed engagement-transition vocabulary. */
export const ENGAGEMENT_TRANSITIONS = Object.freeze([
  'accept',
  'decline',
  'expire',
  'activate',
  'complete',
  'withdraw',
  'replace',
] as const);
export type EngagementTransition = (typeof ENGAGEMENT_TRANSITIONS)[number];

export function isEngagementTransition(value: unknown): value is EngagementTransition {
  return (
    typeof value === 'string' &&
    (ENGAGEMENT_TRANSITIONS as readonly string[]).includes(value)
  );
}

/** The closed transition table (from-statuses → to-status). */
export const ENGAGEMENT_TRANSITION_TABLE = {
  accept: { from: Object.freeze(['offered'] as const), to: 'accepted' },
  decline: { from: Object.freeze(['offered'] as const), to: 'declined' },
  expire: { from: Object.freeze(['offered'] as const), to: 'expired' },
  activate: { from: Object.freeze(['accepted'] as const), to: 'active' },
  complete: { from: Object.freeze(['active'] as const), to: 'completed' },
  withdraw: {
    from: Object.freeze(['offered', 'accepted', 'active'] as const),
    to: 'withdrawn',
  },
  replace: {
    from: Object.freeze(['offered', 'accepted', 'active'] as const),
    to: 'replaced',
  },
} as const satisfies Record<
  EngagementTransition,
  { readonly from: readonly EngagementStatus[]; readonly to: EngagementStatus }
>;

// ---------------------------------------------------------------------------
// Machine-readable transition reasons (closed vocabulary)
// ---------------------------------------------------------------------------

export const ENGAGEMENT_TRANSITION_REASONS = Object.freeze([
  'transition_ok',
  'transition_not_allowed_from_status',
  'transition_terminal_source',
  'transition_offer_expired',
  'transition_deadline_passed',
  'transition_requires_successor',
  'transition_tenant_mismatch',
] as const);
export type EngagementTransitionReason =
  (typeof ENGAGEMENT_TRANSITION_REASONS)[number];

export function isEngagementTransitionReason(
  value: unknown,
): value is EngagementTransitionReason {
  return (
    typeof value === 'string' &&
    (ENGAGEMENT_TRANSITION_REASONS as readonly string[]).includes(value)
  );
}

/** The typed verdict of a proposed transition (house verdict style). */
export interface EngagementTransitionCheck {
  readonly allowed: boolean;
  readonly reason: EngagementTransitionReason;
  readonly from: EngagementStatus;
  readonly to: EngagementStatus;
  readonly transition: EngagementTransition;
}

// ---------------------------------------------------------------------------
// The C001 escalation-state binding (closed allowlists — facts, not
// judgements: the escalation lifecycle is C001-owned semantics; this
// package only BINDS engagement states to recorded escalation states)
// ---------------------------------------------------------------------------

/**
 * The escalation (C001) states each engagement status may bind to. The
 * service layer resolves the live escalation snapshot through its
 * injected port and enforces this table; a mismatch fails closed with
 * ESCALATION_STATE_MISMATCH (never a silent rebind).
 */
export const ENGAGEMENT_ESCALATION_STATE_BINDING: Readonly<
  Record<EngagementStatus, readonly string[]>
> = Object.freeze({
  offered: Object.freeze(['offered'] as const),
  accepted: Object.freeze(['accepted'] as const),
  active: Object.freeze(['session_ready', 'in_progress'] as const),
  completed: Object.freeze([
    'submitted',
    'validating',
    'result_accepted',
    'revision_required',
    'result_rejected',
    'paid',
    'learning_captured',
    'closed',
  ] as const),
  declined: Object.freeze(['offered', 'matching', 'expert_replaced'] as const),
  expired: Object.freeze(['offered', 'matching', 'expert_replaced', 'timed_out'] as const),
  withdrawn: Object.freeze([
    'offered',
    'accepted',
    'session_ready',
    'in_progress',
    'cancelled',
  ] as const),
  replaced: Object.freeze(['expert_replaced', 'matching', 'cancelled'] as const),
} as const);

/** Does this engagement status bind to the recorded escalation state? */
export function bindsToEscalationState(
  status: EngagementStatus,
  escalationState: string,
): boolean {
  return (
    ENGAGEMENT_ESCALATION_STATE_BINDING[status] as readonly string[]
  ).includes(escalationState);
}

// ---------------------------------------------------------------------------
// The engagement record
// ---------------------------------------------------------------------------

/** Digest-free view of an engagement — exactly what the digest covers. */
export interface EngagementRecordView {
  readonly recordVersion: typeof ENGAGEMENT_RECORD_VERSION;
  readonly engagementId: EngagementId;
  /** Scope lock (lock rule 11) — must equal the escalation's tenant. */
  readonly tenant: EngagementTenant;
  /** The bound C001 escalation request id (opaque locator — never mutated). */
  readonly escalationRef: EngagementLocator;
  readonly expertId: EngagementExpertId;
  /**
   * The C010 commercial-offer record this engagement binds to (opaque
   * public ref — digest-shaped). This package owns NO money truth.
   */
  readonly commercialOfferRef: EngagementContentDigest;
  /** The C010 budget-hold record backing the offer (opaque public ref). */
  readonly budgetHoldRef: EngagementContentDigest;
  /** The C002 routing-verdict digest the offer was issued against. */
  readonly routingVerdictRef: EngagementContentDigest;
  /** The availability-declaration version digest in force at offer time. */
  readonly availabilityRef: EngagementContentDigest;
  /** The urgency class the SLA clocks key on (mirrors C001 vocabulary). */
  readonly urgency: string;
  /** The escalation request's deadline (drives submit-by and expiry caps). */
  readonly requestDeadline: EngagementTimestamp;
  /** When this offer expires (acceptance at/after this fails closed). */
  readonly offerExpiresAt: EngagementTimestamp;
  readonly status: EngagementStatus;
  readonly offeredAt: EngagementTimestamp;
  readonly acceptedAt?: EngagementTimestamp;
  readonly activatedAt?: EngagementTimestamp;
  readonly completedAt?: EngagementTimestamp;
  readonly withdrawnAt?: EngagementTimestamp;
  readonly replacedAt?: EngagementTimestamp;
  /** The successor engagement issued on replace (supersession pattern). */
  readonly successorEngagementId?: EngagementId;
  /** The idempotency key of the offer command (lock rule 17). */
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** A frozen, content-addressed engagement record: view + sha256 digest. */
export interface EngagementRecord extends EngagementRecordView {
  readonly digest: EngagementContentDigest;
}

export interface CreateEngagementOfferInput {
  readonly engagementId: string;
  readonly tenant: string;
  readonly escalationRef: string;
  readonly expertId: string;
  readonly commercialOfferRef: string;
  readonly budgetHoldRef: string;
  readonly routingVerdictRef: string;
  readonly availabilityRef: string;
  readonly urgency: string;
  readonly requestDeadline: string;
  readonly offerExpiresAt: string;
  readonly offeredAt: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/** The engagement identity key — (tenant, engagementId). */
export function engagementIdentityKey(
  source: Pick<EngagementRecordView, 'tenant' | 'engagementId'>,
): string {
  return `${source.tenant}/${source.engagementId}`;
}

export function isEngagement(value: unknown): value is EngagementRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== ENGAGEMENT_RECORD_VERSION) return false;
  if (!isEngagementId(candidate['engagementId'])) return false;
  if (!isEngagementTenant(candidate['tenant'])) return false;
  if (typeof candidate['escalationRef'] !== 'string') return false;
  if (!isEngagementExpertId(candidate['expertId'])) return false;
  if (!isEngagementContentDigest(candidate['commercialOfferRef'])) return false;
  if (!isEngagementContentDigest(candidate['budgetHoldRef'])) return false;
  if (!isEngagementContentDigest(candidate['routingVerdictRef'])) return false;
  if (!isEngagementContentDigest(candidate['availabilityRef'])) return false;
  if (typeof candidate['urgency'] !== 'string') return false;
  if (!isEngagementTimestamp(candidate['requestDeadline'])) return false;
  if (!isEngagementTimestamp(candidate['offerExpiresAt'])) return false;
  if (!isEngagementStatus(candidate['status'])) return false;
  if (!isEngagementTimestamp(candidate['offeredAt'])) return false;
  if (!isEngagementContentDigest(candidate['digest'])) return false;
  return true;
}

/** Construct + validate + digest + freeze one offered engagement. */
export async function createEngagementOffer(
  input: CreateEngagementOfferInput,
): Promise<EngagementRecord> {
  const engagementId = toEngagementId(input.engagementId, 'engagementId');
  const tenant = toEngagementTenant(input.tenant, 'tenant');
  const escalationRef = toEngagementLocator(input.escalationRef, 'escalationRef');
  const expertId = toEngagementExpertId(input.expertId, 'expertId');
  const commercialOfferRef = toEngagementContentDigest(
    input.commercialOfferRef,
    'commercialOfferRef',
  );
  const budgetHoldRef = toEngagementContentDigest(input.budgetHoldRef, 'budgetHoldRef');
  const routingVerdictRef = toEngagementContentDigest(
    input.routingVerdictRef,
    'routingVerdictRef',
  );
  const availabilityRef = toEngagementContentDigest(input.availabilityRef, 'availabilityRef');
  const urgency = toSlaUrgencyClass(input.urgency, 'urgency');
  const requestDeadline = toEngagementTimestamp(input.requestDeadline, 'requestDeadline');
  const offerExpiresAt = toEngagementTimestamp(input.offerExpiresAt, 'offerExpiresAt');
  const offeredAt = toEngagementTimestamp(input.offeredAt, 'offeredAt');
  if (Date.parse(offerExpiresAt) <= Date.parse(offeredAt)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'offerExpiresAt must be after offeredAt (an offer that is born expired has no acceptance window)',
      details: { offerExpiresAt, offeredAt },
    });
  }
  if (Date.parse(offerExpiresAt) > Date.parse(requestDeadline)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'offerExpiresAt cannot exceed the escalation request deadline (deadline-aware scheduling)',
      details: { offerExpiresAt, requestDeadline },
    });
  }
  if (Date.parse(requestDeadline) <= Date.parse(offeredAt)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.DEADLINE_PASSED, {
      message: 'requestDeadline must be after offeredAt',
      details: { requestDeadline, offeredAt },
    });
  }
  if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'idempotencyKey requires a non-empty string (lock rule 17)',
      details: { field: 'idempotencyKey' },
    });
  }
  if (typeof input.correlationId !== 'string' || input.correlationId.length === 0) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD, {
      message: 'correlationId requires a non-empty string (lock rule 17)',
      details: { field: 'correlationId' },
    });
  }
  const view: EngagementRecordView = {
    recordVersion: ENGAGEMENT_RECORD_VERSION,
    engagementId,
    tenant,
    escalationRef,
    expertId,
    commercialOfferRef,
    budgetHoldRef,
    routingVerdictRef,
    availabilityRef,
    urgency,
    requestDeadline,
    offerExpiresAt,
    status: 'offered',
    offeredAt,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  };
  const digest = (await digestCanonical(view)) as EngagementContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// Guarded transitions (pure; every verdict machine-readable)
// ---------------------------------------------------------------------------

export interface TransitionGuardInput {
  /** Caller-injected operation time (ms-precision UTC — no hidden clock). */
  readonly at: string;
  /** The tenant the caller acts from (typed mismatch guard — rule 11). */
  readonly tenant: string;
  /** Required for 'replace': the successor engagement id. */
  readonly successorEngagementId?: string;
}

/**
 * The pure transition guard: is `transition` legal on `record` at `at`?
 * Deterministic — given the same record and inputs the verdict is always
 * the same (the offer-expiry and deadline checks are time-arithmetic,
 * never clock reads).
 */
export function checkEngagementTransition(
  record: EngagementRecord,
  transition: EngagementTransition,
  guard: TransitionGuardInput,
): EngagementTransitionCheck {
  const entry = ENGAGEMENT_TRANSITION_TABLE[transition];
  const to = entry.to;
  const base = {
    from: record.status,
    to,
    transition,
  };
  if (record.tenant !== guard.tenant) {
    return { allowed: false, reason: 'transition_tenant_mismatch', ...base };
  }
  if (isTerminalEngagementStatus(record.status)) {
    return { allowed: false, reason: 'transition_terminal_source', ...base };
  }
  if (!(entry.from as readonly EngagementStatus[]).includes(record.status)) {
    return { allowed: false, reason: 'transition_not_allowed_from_status', ...base };
  }
  // Offer-expiry determinism: an offer can only be accepted strictly
  // before its expiry; 'expire' is only legal at/after the expiry.
  const atMs = Date.parse(toEngagementTimestamp(guard.at, 'at'));
  if (transition === 'accept' && atMs >= Date.parse(record.offerExpiresAt)) {
    return { allowed: false, reason: 'transition_offer_expired', ...base };
  }
  if (transition === 'expire' && atMs < Date.parse(record.offerExpiresAt)) {
    return { allowed: false, reason: 'transition_not_allowed_from_status', ...base };
  }
  // Deadline-aware completion: an engagement cannot complete after the
  // request deadline (the SLA breach path records the breach instead).
  if (transition === 'complete' && atMs > Date.parse(record.requestDeadline)) {
    return { allowed: false, reason: 'transition_deadline_passed', ...base };
  }
  if (transition === 'replace') {
    if (
      guard.successorEngagementId === undefined ||
      !isEngagementId(guard.successorEngagementId) ||
      guard.successorEngagementId === record.engagementId
    ) {
      return { allowed: false, reason: 'transition_requires_successor', ...base };
    }
  }
  return { allowed: true, reason: 'transition_ok', ...base };
}

/** Resolve the reason when a guard verdict denies — the typed failure. */
export function transitionDenialError(check: EngagementTransitionCheck): ExpertEngagementError {
  const codeByReason: Readonly<Record<EngagementTransitionReason, string>> = Object.freeze({
    transition_ok: EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION,
    transition_not_allowed_from_status: EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION,
    transition_terminal_source: EXPERT_ENGAGEMENT_ERROR_CODES.TERMINAL_STATE,
    transition_offer_expired: EXPERT_ENGAGEMENT_ERROR_CODES.OFFER_EXPIRED,
    transition_deadline_passed: EXPERT_ENGAGEMENT_ERROR_CODES.DEADLINE_PASSED,
    transition_requires_successor: EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION,
    transition_tenant_mismatch: EXPERT_ENGAGEMENT_ERROR_CODES.CROSS_TENANT_ACCESS,
  });
  const code = (codeByReason[check.reason] ?? EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION) as
    | (typeof EXPERT_ENGAGEMENT_ERROR_CODES)[keyof typeof EXPERT_ENGAGEMENT_ERROR_CODES]
    | undefined;
  return new ExpertEngagementError(
    code ?? EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION,
    {
      message: `engagement transition '${check.transition}' denied: ${check.reason} (${check.from} → ${check.to})`,
      details: { reason: check.reason, from: check.from, to: check.to },
    },
  );
}

export interface ApplyTransitionInput extends TransitionGuardInput {
  readonly transition: EngagementTransition;
}

/**
 * Apply one guarded transition: validates, digests and returns a NEW
 * deep-frozen record. The source record is never mutated (append-only —
 * the store keeps every version; supersession by append, the house
 * pattern).
 */
export async function applyEngagementTransition(
  record: EngagementRecord,
  input: ApplyTransitionInput,
): Promise<EngagementRecord> {
  if (!isEngagementTransition(input.transition)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TRANSITION, {
      message: `transition must be one of ${ENGAGEMENT_TRANSITIONS.join('|')}, got: ${JSON.stringify(input.transition)}`,
    });
  }
  const at = toEngagementTimestamp(input.at, 'at');
  const check = checkEngagementTransition(record, input.transition, {
    at: input.at,
    tenant: input.tenant,
    ...(input.successorEngagementId !== undefined
      ? { successorEngagementId: input.successorEngagementId }
      : {}),
  });
  if (!check.allowed) {
    throw transitionDenialError(check);
  }
  // The digest covers the VIEW ONLY — strip the prior digest before
  // deriving the new one (the house digest discipline).
  const { digest: _priorDigest, ...priorView } = record;
  const view: EngagementRecordView = {
    ...priorView,
    status: check.to,
    ...(input.transition === 'accept' ? { acceptedAt: at } : {}),
    ...(input.transition === 'activate' ? { activatedAt: at } : {}),
    ...(input.transition === 'complete' ? { completedAt: at } : {}),
    ...(input.transition === 'withdraw' ? { withdrawnAt: at } : {}),
    ...(input.transition === 'expire'
      ? { status: 'expired' as EngagementStatus }
      : {}),
    ...(input.transition === 'replace'
      ? {
          replacedAt: at,
          successorEngagementId: toEngagementId(
            input.successorEngagementId as string,
            'successorEngagementId',
          ),
        }
      : {}),
  };
  const digest = (await digestCanonical(view)) as EngagementContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// Integrity (tamper detection)
// ---------------------------------------------------------------------------

/**
 * Re-derive the record digest — a tampered store entry fails closed with
 * TAMPERED (the C010 ledger / C005 record discipline).
 */
export async function verifyEngagementDigest(
  record: EngagementRecord,
): Promise<EngagementContentDigest> {
  const { digest: _digest, ...view } = record;
  const recomputed = (await digestCanonical(view)) as EngagementContentDigest;
  if (recomputed !== record.digest) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.TAMPERED, {
      message: 'engagement record digest mismatch — the committed record was mutated',
      details: { engagementId: record.engagementId, expected: recomputed, actual: record.digest },
    });
  }
  return recomputed;
}

// ---------------------------------------------------------------------------
// Append-only engagement history (supersession house pattern)
// ---------------------------------------------------------------------------

/** One appended engagement-history entry (the transition journal). */
export interface EngagementHistoryEntry {
  readonly sequence: number;
  readonly engagementId: EngagementId;
  readonly tenant: EngagementTenant;
  readonly transition: EngagementTransition;
  readonly from: EngagementStatus;
  readonly to: EngagementStatus;
  readonly at: EngagementTimestamp;
  readonly note?: EngagementNeutralText;
  readonly successorEngagementId?: EngagementId;
  /** The digest of the record AFTER the transition (history is addressable). */
  readonly recordDigest: EngagementContentDigest;
}

/** The append-only history of one engagement (frozen journal). */
export interface EngagementHistory {
  readonly engagementId: EngagementId;
  readonly tenant: EngagementTenant;
  readonly entries: readonly EngagementHistoryEntry[];
}

/** Append one entry to a journal (contiguous 1..n, gapless). */
export function appendEngagementHistoryEntry(
  history: EngagementHistory,
  entry: Omit<EngagementHistoryEntry, 'sequence'>,
): EngagementHistory {
  const sequence = history.entries.length + 1;
  const last = history.entries[history.entries.length - 1];
  if (last !== undefined && Date.parse(entry.at) < Date.parse(last.at)) {
    throw new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'engagement history is append-only and monotonic — a backdated entry is rejected',
      details: { entryAt: entry.at, lastAt: last.at },
    });
  }
  return deepFreeze({
    engagementId: history.engagementId,
    tenant: history.tenant,
    entries: Object.freeze([...history.entries, { ...entry, sequence }]),
  });
}

/** Start a journal for a freshly offered engagement. */
export function startEngagementHistory(
  record: EngagementRecord,
): EngagementHistory {
  return deepFreeze({
    engagementId: record.engagementId,
    tenant: record.tenant,
    entries: Object.freeze([] as readonly EngagementHistoryEntry[]),
  });
}
