/**
 * Escrow/hold ledger — the C010 commercial settlement core (Work Order
 * C010; issue #77; handoff §8 "Arena handles: offer/acceptance;
 * validation condition; expert payout; Arena platform fee;
 * revision/refund states; commercial audit").
 *
 * ONE ledger per escalation. The money story is append-only and
 * double-entry-shaped:
 *
 *   OPENED ─ hold ─▶ HELD ─ offer ─▶ OFFERED ─ acceptance ─▶ ACCEPTED
 *                                    ─ capture ─▶ CAPTURED
 *                                    ─ release ─▶ RELEASED (terminal: fee split + payout)
 *   HELD/OFFERED/ACCEPTED/CAPTURED ─ refund ─▶ (partial) | REFUNDED (terminal)
 *
 * House discipline (mirrors @arena/escalation lifecycle +
 * @arena/job-protocol AuditLog):
 *   - every operation is a PURE function returning a NEW deep-frozen
 *     ledger (history entries are NEVER rewritten or mutated in place);
 *   - entries are CONTIGUOUS 1..n and carry a sha256 DIGEST CHAIN (each
 *     digest includes the previous entry's digest — silent mutation of
 *     any money record breaks the chain and is detected);
 *   - every operation is correlation-addressable (operationKey) and
 *     IDEMPOTENT: a duplicate instruction REPLAYS the recorded outcome
 *     verbatim; the same key with a different body is a typed
 *     PAYMENTS_IDENTITY_CONFLICT (never a silent rebind);
 *   - every operation is guarded against the C001 escalation lifecycle
 *     state (closed allowlists — payout on an expired/revoked commercial
 *     state is a typed denial, not a best-effort);
 *   - denial verdicts are MACHINE-READABLE (closed reason vocabulary —
 *     never a bare boolean);
 *   - tenant isolation is enforced at the DOMAIN level (typed
 *     PAYMENTS_CROSS_TENANT_ACCESS);
 *   - all timestamps are INJECTED (architecture-lock rule 17);
 *   - the truth label (demo vs customer money) rides every record.
 *
 * The ledger NEVER judges validation outcomes and NEVER talks to a
 * payment provider — the service layer binds it to the C001 lifecycle
 * and drives the provider adapter (lock rule 16: one authority each).
 */

import { digestCanonical } from '@arena/protocol-core';
import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';
import { createCommercialAuditEvent } from './audit.js';
import { OPERATION_TO_AUDIT_KIND } from './audit.js';
import type { CommercialAuditEvent } from './audit.js';
import { assertFeeSplit } from './fees.js';
import type { FeeSchedule, FeeSplit } from './fees.js';
import type { Money, MinorUnits } from './money.js';
import { isMinorUnits, minorUnitsToBigInt, toMinorUnits, toMoney } from './money.js';
import type {
  BoundLifecycleState,
  MoneyTruth,
  PaymentsTimestamp,
  PlainJsonValue,
  TenantId,
} from './shared.js';
import {
  deepFreeze,
  isBoundLifecycleState,
  isMoneyTruth,
  isPaymentsTimestamp,
  newLedgerOperationId,
  toPaymentsTimestamp,
  toTenantId,
} from './shared.js';

/** Wire version of the ledger record shape. */
export const PAYMENT_LEDGER_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Accounts (closed vocabulary) + double-entry lines
// ---------------------------------------------------------------------------

export const PAYMENT_ACCOUNTS = Object.freeze([
  'customer-source',
  'escrow',
  'payable',
  'platform-fee',
  'expert-payout',
  'refunds',
] as const);
export type PaymentAccount = (typeof PAYMENT_ACCOUNTS)[number];

export function isPaymentAccount(value: unknown): value is PaymentAccount {
  return typeof value === 'string' && (PAYMENT_ACCOUNTS as readonly string[]).includes(value);
}

/** Source accounts debit-positive; holding accounts credit-positive. */
export const ACCOUNT_SIDE: Readonly<Record<PaymentAccount, 'source' | 'holding'>> = Object.freeze({
  'customer-source': 'source',
  escrow: 'holding',
  payable: 'holding',
  'platform-fee': 'holding',
  'expert-payout': 'holding',
  refunds: 'holding',
});

export interface LedgerLine {
  readonly account: PaymentAccount;
  readonly side: 'debit' | 'credit';
  readonly minorUnits: MinorUnits;
}

// ---------------------------------------------------------------------------
// Commercial state machine (closed vocabulary)
// ---------------------------------------------------------------------------

export const LEDGER_STATES = Object.freeze([
  'opened',
  'held',
  'offered',
  'accepted',
  'captured',
  'released',
  'refunded',
] as const);
export type LedgerState = (typeof LEDGER_STATES)[number];

/** Terminal commercial states — nothing may follow them. */
export const LEDGER_TERMINAL_STATES = Object.freeze(['released', 'refunded'] as const);
export type TerminalLedgerState = (typeof LEDGER_TERMINAL_STATES)[number];

export function isLedgerState(value: unknown): value is LedgerState {
  return typeof value === 'string' && (LEDGER_STATES as readonly string[]).includes(value);
}

export function isTerminalLedgerState(value: unknown): value is TerminalLedgerState {
  return typeof value === 'string' && (LEDGER_TERMINAL_STATES as readonly string[]).includes(value);
}

/** The ONLY legal ledger transitions out of each commercial state. */
export const LEDGER_TRANSITIONS: Readonly<Record<LedgerState, readonly LedgerState[]>> = Object.freeze({
  opened: Object.freeze(['held'] as readonly LedgerState[]),
  held: Object.freeze(['offered', 'refunded'] as readonly LedgerState[]),
  offered: Object.freeze(['accepted', 'refunded'] as readonly LedgerState[]),
  accepted: Object.freeze(['captured', 'refunded'] as readonly LedgerState[]),
  captured: Object.freeze(['released', 'refunded'] as readonly LedgerState[]),
  released: Object.freeze([] as readonly LedgerState[]),
  refunded: Object.freeze([] as readonly LedgerState[]),
});

// ---------------------------------------------------------------------------
// Lifecycle binding (closed allowlists — the expired/revoked guard)
// ---------------------------------------------------------------------------

/**
 * Which C001 escalation lifecycle states permit each money operation.
 * The ledger never imports the escalation package; the service supplies
 * the observed lifecycle state and the ledger denies typed mismatches.
 */
export const OPERATION_LIFECYCLE_ALLOWLISTS: Readonly<
  Record<LedgerOperationKind, readonly BoundLifecycleState[]>
> = Object.freeze({
  hold: Object.freeze(['created', 'triaged', 'matching', 'offered', 'expert_replaced'] as readonly BoundLifecycleState[]),
  offer: Object.freeze(['offered'] as readonly BoundLifecycleState[]),
  acceptance: Object.freeze(['accepted'] as readonly BoundLifecycleState[]),
  capture: Object.freeze(['accepted'] as readonly BoundLifecycleState[]),
  release: Object.freeze(['result_accepted'] as readonly BoundLifecycleState[]),
  refund: Object.freeze(['revision_required', 'result_rejected', 'cancelled', 'timed_out'] as readonly BoundLifecycleState[]),
});

// ---------------------------------------------------------------------------
// Operation kinds + payloads
// ---------------------------------------------------------------------------

export const LEDGER_OPERATION_KINDS = Object.freeze([
  'hold',
  'offer',
  'acceptance',
  'capture',
  'release',
  'refund',
] as const);
export type LedgerOperationKind = (typeof LEDGER_OPERATION_KINDS)[number];

export function isLedgerOperationKind(value: unknown): value is LedgerOperationKind {
  return typeof value === 'string' && (LEDGER_OPERATION_KINDS as readonly string[]).includes(value);
}

export const REFUND_REASONS = Object.freeze([
  'revision_required',
  'result_rejected',
  'cancelled',
  'timed_out',
  'dispute_resolved',
] as const);
export type RefundReason = (typeof REFUND_REASONS)[number];

export function isRefundReason(value: unknown): value is RefundReason {
  return typeof value === 'string' && (REFUND_REASONS as readonly string[]).includes(value);
}

export type LedgerOperationPayload =
  | { readonly kind: 'hold'; readonly amountMinorUnits: MinorUnits }
  | { readonly kind: 'offer'; readonly amountMinorUnits: MinorUnits }
  | { readonly kind: 'acceptance'; readonly acceptedOfferSequence: number }
  | { readonly kind: 'capture'; readonly amountMinorUnits: MinorUnits }
  | { readonly kind: 'release'; readonly split: FeeSplit; readonly schedule: FeeSchedule }
  | { readonly kind: 'refund'; readonly amountMinorUnits: MinorUnits; readonly reason: RefundReason };

// ---------------------------------------------------------------------------
// Machine-readable denial reasons (closed vocabulary — never a bare boolean)
// ---------------------------------------------------------------------------

export const LEDGER_DENIAL_REASONS = Object.freeze([
  'ledger_not_adjacent',
  'ledger_terminal_state',
  'lifecycle_state_not_allowed',
  'tenant_mismatch',
  'currency_mismatch',
  'amount_exceeds_held',
  'capture_must_be_full',
  'amount_exceeds_available',
  'amount_not_positive',
  'offer_sequence_unknown',
  'split_mismatch',
  'timestamp_not_monotonic',
  'operation_key_conflict',
  'invalid_payload',
] as const);
export type LedgerDenialReason = (typeof LEDGER_DENIAL_REASONS)[number];

export interface LedgerOperationCheck {
  readonly allowed: boolean;
  readonly reason: LedgerDenialReason | 'operation_ok';
  readonly kind: LedgerOperationKind;
  readonly from: LedgerState;
}

// ---------------------------------------------------------------------------
// Ledger record + entries + idempotency index
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  readonly entryVersion: typeof PAYMENT_LEDGER_VERSION;
  /** 1-based monotonic sequence within this ledger. */
  readonly sequence: number;
  readonly operationId: string;
  /** The caller's idempotency key for this operation (correlation-addressable). */
  readonly operationKey: string;
  readonly kind: LedgerOperationKind;
  readonly currency: string;
  /** Double-entry lines (marker kinds carry none). */
  readonly lines: readonly LedgerLine[];
  readonly payload: LedgerOperationPayload;
  readonly occurredAt: PaymentsTimestamp;
  readonly actor?: string;
  readonly correlationId: string;
  /** The observed C001 lifecycle state at operation time (binding evidence). */
  readonly lifecycleStateAtOperation: BoundLifecycleState;
  readonly truth: MoneyTruth;
  /** Provider execution evidence (transfer ids), when a provider executed. */
  readonly providerTransferIds?: readonly string[];
  /** sha256 chain: digest over the digest-free entry view + previous digest. */
  readonly prevDigest: string | null;
  readonly digest: string;
}

/** Idempotency index entry — one per RECORDED operation. */
export interface RecordedOperation {
  readonly operationKey: string;
  readonly operationId: string;
  readonly sequence: number;
  readonly kind: LedgerOperationKind;
  /** sha256 over the canonical operation payload view (conflict detection). */
  readonly payloadDigest: string;
}

export interface PaymentLedger {
  readonly ledgerVersion: typeof PAYMENT_LEDGER_VERSION;
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  /** Single declared currency — as declared, never converted. */
  readonly currency: string;
  readonly truth: MoneyTruth;
  readonly state: LedgerState;
  /** Append-only, deep-frozen, contiguous 1..n. */
  readonly entries: readonly LedgerEntry[];
  /** Idempotency index (operationKey → recorded operation). */
  readonly operations: readonly RecordedOperation[];
  /** Commercial audit stream — one event per APPLIED operation. */
  readonly auditEvents: readonly CommercialAuditEvent[];
  readonly createdAt: PaymentsTimestamp;
  readonly updatedAt: PaymentsTimestamp;
}

// ---------------------------------------------------------------------------
// Balances (double-entry fold)
// ---------------------------------------------------------------------------

export type LedgerBalances = Readonly<Record<PaymentAccount, MinorUnits>>;

function zeroBalances(): Record<PaymentAccount, bigint> {
  return {
    'customer-source': 0n,
    escrow: 0n,
    payable: 0n,
    'platform-fee': 0n,
    'expert-payout': 0n,
    refunds: 0n,
  };
}

/** Fold the entries into per-account funds balances (source: debits−credits; holding: credits−debits). */
export function ledgerBalances(ledger: PaymentLedger): LedgerBalances {
  const signed = zeroBalances();
  for (const entry of ledger.entries) {
    for (const line of entry.lines) {
      const value = minorUnitsToBigInt(line.minorUnits);
      signed[line.account] += line.side === 'debit' ? value : -value;
    }
  }
  const balances = {} as Record<PaymentAccount, MinorUnits>;
  for (const account of PAYMENT_ACCOUNTS) {
    const raw = ACCOUNT_SIDE[account] === 'source' ? signed[account] : -signed[account];
    balances[account] = toMinorUnits(raw.toString(10));
  }
  return Object.freeze(balances);
}

/** Funds still HELD in escrow (authorized but not captured). */
export function heldFunds(ledger: PaymentLedger): MinorUnits {
  return ledgerBalances(ledger).escrow;
}

/** Funds COMMITTED (captured, awaiting release/refund). */
export function committedFunds(ledger: PaymentLedger): MinorUnits {
  return ledgerBalances(ledger).payable;
}

/** Everything still refundable: held + committed. */
export function availableForRefund(ledger: PaymentLedger): MinorUnits {
  const balances = ledgerBalances(ledger);
  return toMinorUnits((minorUnitsToBigInt(balances.escrow) + minorUnitsToBigInt(balances.payable)).toString(10));
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

const REQUEST_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const REQUEST_ID_RE = new RegExp(REQUEST_ID_PATTERN);
const OPERATION_KEY_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const OPERATION_KEY_RE = new RegExp(OPERATION_KEY_PATTERN);
const CORRELATION_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const CORRELATION_ID_RE = new RegExp(CORRELATION_ID_PATTERN);

function assertRequestId(value: string, field: string): void {
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `${field} is invalid: ${JSON.stringify(value)} (expected ${REQUEST_ID_PATTERN})`,
    });
  }
}

function assertOperationKey(value: string): string {
  if (typeof value !== 'string' || !OPERATION_KEY_RE.test(value)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `operationKey is invalid: ${JSON.stringify(value)} (expected ${OPERATION_KEY_PATTERN})`,
    });
  }
  return value;
}

function assertCorrelationId(value: string): string {
  if (typeof value !== 'string' || !CORRELATION_ID_RE.test(value)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `correlationId is invalid: ${JSON.stringify(value)} (expected ${CORRELATION_ID_PATTERN})`,
    });
  }
  return value;
}

/** Open a new (empty, state `opened`) escrow ledger for one escalation. */
export function openPaymentLedger(input: {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly currency: string;
  readonly truth: MoneyTruth;
  readonly now: number | string | Date;
}): PaymentLedger {
  assertRequestId(input.requestId, 'requestId');
  if (!isMoneyTruth(input.truth)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `truth label must be 'demo' or 'customer': ${JSON.stringify(input.truth)}`,
    });
  }
  toMoney({ amount: '0', currency: input.currency }); // validates the currency shape
  const occurredAt = toPaymentsTimestamp(input.now);
  const ledger: PaymentLedger = Object.freeze({
    ledgerVersion: PAYMENT_LEDGER_VERSION,
    requestId: input.requestId,
    tenantId: toTenantId(input.tenantId),
    correlationId: assertCorrelationId(input.correlationId),
    currency: input.currency,
    truth: input.truth,
    state: 'opened',
    entries: Object.freeze([]),
    operations: Object.freeze([]),
    auditEvents: Object.freeze([]),
    createdAt: occurredAt,
    updatedAt: occurredAt,
  });
  return ledger;
}

// ---------------------------------------------------------------------------
// Operation application (guarded, idempotent, digest-chained)
// ---------------------------------------------------------------------------

/** The machine-readable verdict of a proposed operation. */
export function checkLedgerOperation(
  ledger: PaymentLedger,
  kind: LedgerOperationKind,
  payload: LedgerOperationPayload,
  context: {
    readonly lifecycleState: BoundLifecycleState;
    readonly tenantId?: string;
    readonly now: number | string | Date;
  },
): LedgerOperationCheck {
  const deny = (reason: LedgerDenialReason): LedgerOperationCheck => ({
    allowed: false,
    reason,
    kind,
    from: ledger.state,
  });

  if (context.tenantId !== undefined && ledger.tenantId !== context.tenantId) {
    return deny('tenant_mismatch');
  }
  if (isTerminalLedgerState(ledger.state)) {
    return deny('ledger_terminal_state');
  }
  if (!isBoundLifecycleState(context.lifecycleState)) {
    return deny('lifecycle_state_not_allowed');
  }
  if (!(OPERATION_LIFECYCLE_ALLOWLISTS[kind] as readonly string[]).includes(context.lifecycleState)) {
    return deny('lifecycle_state_not_allowed');
  }
  if (payload.kind !== kind) {
    return deny('invalid_payload');
  }
  // Ledger adjacency (per kind).
  switch (kind) {
    case 'hold':
      if (ledger.state !== 'opened') return deny('ledger_not_adjacent');
      break;
    case 'offer':
      if (ledger.state !== 'held') return deny('ledger_not_adjacent');
      break;
    case 'acceptance':
      if (ledger.state !== 'offered') return deny('ledger_not_adjacent');
      break;
    case 'capture':
      if (ledger.state !== 'accepted') return deny('ledger_not_adjacent');
      break;
    case 'release':
      if (ledger.state !== 'captured') return deny('ledger_not_adjacent');
      break;
    case 'refund':
      if (!(LEDGER_TRANSITIONS[ledger.state] as readonly string[]).includes('refunded')) {
        return deny('ledger_not_adjacent');
      }
      break;
  }
  // Amount guards (currency + bounds + sufficiency).
  const amount = payload.kind === 'hold' || payload.kind === 'offer' || payload.kind === 'capture' || payload.kind === 'refund'
    ? payload.amountMinorUnits
    : undefined;
  if (amount !== undefined) {
    if (!isMinorUnits(amount)) return deny('invalid_payload');
    if (minorUnitsToBigInt(amount) <= 0n) return deny('amount_not_positive');
  }
  if (payload.kind === 'offer' && minorUnitsToBigInt(payload.amountMinorUnits) > minorUnitsToBigInt(heldFunds(ledger))) {
    return deny('amount_exceeds_held');
  }
  if (payload.kind === 'capture') {
    if (payload.amountMinorUnits !== heldFunds(ledger)) return deny('capture_must_be_full');
  }
  if (payload.kind === 'refund' && minorUnitsToBigInt(payload.amountMinorUnits) > minorUnitsToBigInt(availableForRefund(ledger))) {
    return deny('amount_exceeds_available');
  }
  if (payload.kind === 'release') {
    const gross = payload.split.grossMinorUnits;
    if (gross !== committedFunds(ledger)) return deny('amount_exceeds_available');
  }
  return { allowed: true, reason: 'operation_ok', kind, from: ledger.state };
}

/** Lines for a payload (pure; balanced by construction). */
function linesForPayload(
  ledger: PaymentLedger,
  payload: LedgerOperationPayload,
): readonly LedgerLine[] {
  const lines: LedgerLine[] = [];
  const push = (account: PaymentAccount, side: 'debit' | 'credit', minorUnits: MinorUnits): void => {
    if (minorUnitsToBigInt(minorUnits) === 0n) return;
    lines.push(Object.freeze({ account, side, minorUnits }));
  };
  switch (payload.kind) {
    case 'hold':
      push('customer-source', 'debit', payload.amountMinorUnits);
      push('escrow', 'credit', payload.amountMinorUnits);
      break;
    case 'offer':
    case 'acceptance':
      break; // commercial markers — no money movement
    case 'capture':
      push('escrow', 'debit', payload.amountMinorUnits);
      push('payable', 'credit', payload.amountMinorUnits);
      break;
    case 'release': {
      push('payable', 'debit', payload.split.grossMinorUnits);
      push('platform-fee', 'credit', payload.split.platformFeeMinorUnits);
      push('expert-payout', 'credit', payload.split.expertPayoutMinorUnits);
      break;
    }
    case 'refund': {
      let remaining = minorUnitsToBigInt(payload.amountMinorUnits);
      const fromEscrow = minorUnitsToBigInt(heldFunds(ledger));
      const escrowPart = fromEscrow < remaining ? fromEscrow : remaining;
      remaining -= escrowPart;
      push('escrow', 'debit', toMinorUnits(escrowPart.toString(10)));
      push('payable', 'debit', toMinorUnits(remaining.toString(10)));
      push('refunds', 'credit', payload.amountMinorUnits);
      break;
    }
  }
  return Object.freeze(lines);
}

/** State after applying a payload. */
function stateAfterPayload(ledger: PaymentLedger, payload: LedgerOperationPayload): LedgerState {
  switch (payload.kind) {
    case 'hold':
      return 'held';
    case 'offer':
      return 'offered';
    case 'acceptance':
      return 'accepted';
    case 'capture':
      return 'captured';
    case 'release':
      return 'released';
    case 'refund':
      return minorUnitsToBigInt(availableForRefund(ledger)) - minorUnitsToBigInt(payload.amountMinorUnits) === 0n
        ? 'refunded'
        : ledger.state;
  }
}

function payloadDigestView(payload: LedgerOperationPayload): PlainJsonValue {
  return payload as unknown as PlainJsonValue;
}

function throwDenial(ledger: PaymentLedger, check: LedgerOperationCheck, operationKey: string): never {
  const details = {
    requestId: ledger.requestId,
    ledgerState: ledger.state,
    kind: check.kind,
    reason: check.reason,
    operationKey,
  };
  if (check.reason === 'tenant_mismatch') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.CROSS_TENANT_ACCESS, {
      message: `ledger ${ledger.requestId} belongs to tenant ${ledger.tenantId}; cross-tenant operation denied`,
      details,
    });
  }
  if (check.reason === 'ledger_terminal_state') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.TERMINAL_STATE, {
      message: `ledger ${ledger.requestId} is in terminal commercial state ${ledger.state}; no money operation may follow`,
      details,
    });
  }
  if (check.reason === 'lifecycle_state_not_allowed') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.LIFECYCLE_STATE_NOT_ALLOWED, {
      message: `money operation ${check.kind} is not allowed while the escalation is in lifecycle state ${ledger.state}; allowed: ${JSON.stringify(OPERATION_LIFECYCLE_ALLOWLISTS[check.kind])}`,
      details,
    });
  }
  if (check.reason === 'amount_exceeds_available' || check.reason === 'amount_exceeds_held' || check.reason === 'capture_must_be_full') {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INSUFFICIENT_FUNDS, {
      message: `money operation ${check.kind} denied (${check.reason}) on ledger ${ledger.requestId}`,
      details,
    });
  }
  throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_TRANSITION, {
    message: `money operation ${check.kind} denied (${check.reason}) on ledger ${ledger.requestId}`,
    details,
  });
}

/** The outcome of a ledger operation (machine-readable tri-state). */
export interface LedgerOperationResult {
  readonly outcome: 'applied' | 'duplicate';
  readonly ledger: PaymentLedger;
  /** The appended (or replayed) entry. */
  readonly entry: LedgerEntry;
  /** The appended (or replayed) commercial audit event. */
  readonly auditEvent: CommercialAuditEvent;
  readonly duplicate: boolean;
}

async function applyOperation(
  ledger: PaymentLedger,
  kind: LedgerOperationKind,
  payload: LedgerOperationPayload,
  context: {
    readonly operationKey: string;
    readonly lifecycleState: BoundLifecycleState;
    readonly now: number | string | Date;
    readonly tenantId?: string;
    readonly actor?: string;
    readonly providerTransferIds?: readonly string[];
    readonly operationId?: string;
  },
): Promise<LedgerOperationResult> {
  const operationKey = assertOperationKey(context.operationKey);

  // Idempotency: a duplicate instruction REPLAYS the recorded outcome.
  const recorded = ledger.operations.find((op) => op.operationKey === operationKey);
  if (recorded !== undefined) {
    const bodyDigest = await digestCanonical(payloadDigestView(payload));
    if (recorded.payloadDigest !== bodyDigest) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `operation key ${JSON.stringify(operationKey)} was already used for a different operation on ledger ${ledger.requestId} — idempotency conflict, never a silent rebind`,
        details: { requestId: ledger.requestId, operationKey, recordedKind: recorded.kind, attemptedKind: kind },
      });
    }
    const entry = ledger.entries[recorded.sequence - 1];
    const auditEvent = ledger.auditEvents[recorded.sequence - 1];
    if (entry === undefined || auditEvent === undefined) {
      throw new PaymentError(PAYMENTS_ERROR_CODES.TAMPERED, {
        message: `ledger ${ledger.requestId} idempotency index references missing entry/audit event — integrity failure`,
        details: { requestId: ledger.requestId, operationKey, sequence: recorded.sequence },
      });
    }
    return { outcome: 'duplicate', ledger, entry, auditEvent, duplicate: true };
  }

  const check = checkLedgerOperation(ledger, kind, payload, context);
  if (!check.allowed) {
    throwDenial(ledger, check, operationKey);
  }

  // Currency discipline.
  const amountsCurrency =
    payload.kind === 'release' ? payload.split.currency : ledger.currency;
  if (amountsCurrency !== ledger.currency) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH, {
      message: `money operation ${kind} declared ${amountsCurrency} on a ${ledger.currency} ledger — multi-currency is recorded as declared, never converted`,
      details: { requestId: ledger.requestId, ledgerCurrency: ledger.currency, declared: amountsCurrency },
    });
  }
  if (payload.kind === 'release') {
    // Domain-level fee-split tamper guard: the declared split must be the
    // deterministic computation of the declared schedule over the gross.
    const gross = toMoney({ amount: payload.split.grossMinorUnits, currency: ledger.currency });
    assertFeeSplit(payload.schedule, gross, payload.split);
  }

  const occurredAt = toPaymentsTimestamp(context.now);
  const lastEntry = ledger.entries[ledger.entries.length - 1];
  if (lastEntry !== undefined && Date.parse(occurredAt) < Date.parse(lastEntry.occurredAt)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_TRANSITION, {
      message: 'ledger entry timestamps must be monotonically non-decreasing (injected clock ran backwards)',
      details: { requestId: ledger.requestId, operationKey },
    });
  }

  const sequence = ledger.entries.length + 1;
  const operationId = context.operationId === undefined ? newLedgerOperationId() : context.operationId;
  const lines = linesForPayload(ledger, payload);
  const nextState = stateAfterPayload(ledger, payload);
  const balancesBefore = ledgerBalances(ledger);

  const digestFree: Record<string, unknown> = {
    entryVersion: PAYMENT_LEDGER_VERSION,
    sequence,
    operationId,
    operationKey,
    kind,
    currency: ledger.currency,
    lines,
    payload,
    occurredAt,
    correlationId: ledger.correlationId,
    lifecycleStateAtOperation: context.lifecycleState,
    truth: ledger.truth,
    ...(context.providerTransferIds !== undefined ? { providerTransferIds: context.providerTransferIds } : {}),
    ...(context.actor !== undefined ? { actor: context.actor } : {}),
    prevDigest: lastEntry === undefined ? null : lastEntry.digest,
  };
  const digest = await digestCanonical(digestFree as PlainJsonValue);

  const entry: LedgerEntry = Object.freeze({
    entryVersion: PAYMENT_LEDGER_VERSION,
    sequence,
    operationId,
    operationKey,
    kind,
    currency: ledger.currency,
    lines,
    payload,
    occurredAt,
    ...(context.actor !== undefined ? { actor: context.actor } : {}),
    correlationId: ledger.correlationId,
    lifecycleStateAtOperation: context.lifecycleState,
    truth: ledger.truth,
    ...(context.providerTransferIds !== undefined
      ? { providerTransferIds: Object.freeze([...context.providerTransferIds]) }
      : {}),
    prevDigest: lastEntry === undefined ? null : lastEntry.digest,
    digest,
  });

  // Account deltas for the audit summary (funds-direction per account).
  const accountDeltas: Record<PaymentAccount, string> = {
    'customer-source': '0',
    escrow: '0',
    payable: '0',
    'platform-fee': '0',
    'expert-payout': '0',
    refunds: '0',
  };
  const balancesAfter = ledgerBalances({ ...ledger, entries: [...ledger.entries, entry] } as PaymentLedger);
  for (const account of PAYMENT_ACCOUNTS) {
    const delta =
      minorUnitsToBigInt(balancesAfter[account]) - minorUnitsToBigInt(balancesBefore[account]);
    accountDeltas[account] = delta.toString(10);
  }
  const amounts: Record<string, string> =
    payload.kind === 'release'
      ? {
          grossMinorUnits: payload.split.grossMinorUnits,
          platformFeeMinorUnits: payload.split.platformFeeMinorUnits,
          expertPayoutMinorUnits: payload.split.expertPayoutMinorUnits,
          scheduleId: payload.split.scheduleId,
          scheduleVersion: String(payload.split.scheduleVersion),
        }
      : payload.kind === 'refund'
        ? { amountMinorUnits: payload.amountMinorUnits, reason: payload.reason }
        : payload.kind === 'acceptance'
          ? { acceptedOfferSequence: String(payload.acceptedOfferSequence) }
          : { amountMinorUnits: payload.amountMinorUnits };

  const auditEvent = createCommercialAuditEvent({
    kind: OPERATION_TO_AUDIT_KIND[kind],
    requestId: ledger.requestId,
    tenantId: ledger.tenantId,
    correlationId: ledger.correlationId,
    operationKey,
    sequence,
    occurredAt,
    ledgerStateAfter: nextState,
    truth: ledger.truth,
    accountDeltas,
    amounts,
  });

  const payloadDigest = await digestCanonical(payloadDigestView(payload));
  const next: PaymentLedger = Object.freeze({
    ...ledger,
    state: nextState,
    entries: Object.freeze([...ledger.entries, entry]),
    operations: Object.freeze([
      ...ledger.operations,
      Object.freeze({
        operationKey,
        operationId,
        sequence,
        kind,
        payloadDigest,
      }),
    ]),
    auditEvents: Object.freeze([...ledger.auditEvents, auditEvent]),
    updatedAt: occurredAt,
  });
  deepFreeze(next as unknown as PlainJsonValue);
  return { outcome: 'applied', ledger: next, entry, auditEvent, duplicate: false };
}

// ---------------------------------------------------------------------------
// Named operations (thin, guarded wrappers)
// ---------------------------------------------------------------------------

/** Money-bearing operations must match the ledger's declared currency. */
function assertOperationCurrency(ledger: PaymentLedger, amount: Money, kind: LedgerOperationKind): void {
  if (amount.currency !== ledger.currency) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.CURRENCY_MISMATCH, {
      message: `money operation ${kind} declared ${amount.currency} on a ${ledger.currency} ledger — multi-currency is recorded as declared, never converted`,
      details: { requestId: ledger.requestId, ledgerCurrency: ledger.currency, declared: amount.currency },
    });
  }
}

export interface LedgerOperationContext {
  readonly operationKey: string;
  readonly lifecycleState: BoundLifecycleState;
  readonly now: number | string | Date;
  readonly tenantId?: string;
  readonly actor?: string;
  readonly operationId?: string;
}

/** Budget HOLD at creation (idempotent; dr customer-source / cr escrow). */
export function applyHoldOperation(
  ledger: PaymentLedger,
  input: { readonly amount: Money } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  assertOperationCurrency(ledger, input.amount, 'hold');
  return applyOperation(
    ledger,
    'hold',
    { kind: 'hold', amountMinorUnits: input.amount.minorUnits },
    input,
  );
}

/** Record the commercial OFFER terms (marker; amount ≤ held budget). */
export function applyOfferOperation(
  ledger: PaymentLedger,
  input: { readonly amount: Money } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  assertOperationCurrency(ledger, input.amount, 'offer');
  return applyOperation(
    ledger,
    'offer',
    { kind: 'offer', amountMinorUnits: input.amount.minorUnits },
    input,
  );
}

/** Record ACCEPTANCE of the recorded offer (marker). */
export function applyAcceptanceOperation(
  ledger: PaymentLedger,
  input: { readonly acceptedOfferSequence?: number } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  const lastOffer = [...ledger.entries].reverse().find((entry) => entry.kind === 'offer');
  if (lastOffer === undefined && input.acceptedOfferSequence === undefined) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_TRANSITION, {
      message: `no recorded offer to accept on ledger ${ledger.requestId} — acceptance requires a prior offer entry`,
      details: { requestId: ledger.requestId, operationKey: input.operationKey },
    });
  }
  const acceptedOfferSequence =
    input.acceptedOfferSequence ?? (lastOffer !== undefined ? lastOffer.sequence : -1);
  if (input.acceptedOfferSequence !== undefined) {
    const referenced = ledger.entries[input.acceptedOfferSequence - 1];
    if (referenced === undefined || referenced.kind !== 'offer') {
      throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_TRANSITION, {
        message: `acceptedOfferSequence ${input.acceptedOfferSequence} does not reference an offer entry on ledger ${ledger.requestId}`,
        details: { requestId: ledger.requestId, acceptedOfferSequence: input.acceptedOfferSequence },
      });
    }
  }
  return applyOperation(
    ledger,
    'acceptance',
    { kind: 'acceptance', acceptedOfferSequence },
    input,
  );
}

/** CAPTURE at ACCEPTED — commits the FULL held budget to payable. */
export function applyCaptureOperation(
  ledger: PaymentLedger,
  input: { readonly amount: Money } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  assertOperationCurrency(ledger, input.amount, 'capture');
  return applyOperation(
    ledger,
    'capture',
    { kind: 'capture', amountMinorUnits: input.amount.minorUnits },
    input,
  );
}

/**
 * RELEASE on completion — the fee-split payout: the FULL committed funds
 * move out as platform fee + expert payout. Requires lifecycle
 * `result_accepted` (validation passed). Duplicate payouts are denied by
 * the terminal state; caller-supplied splits are tamper-checked against
 * the schedule.
 */
export function applyReleaseOperation(
  ledger: PaymentLedger,
  input: {
    readonly schedule: FeeSchedule;
    readonly split: FeeSplit;
    readonly providerTransferIds?: readonly string[];
  } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  return applyOperation(
    ledger,
    'release',
    { kind: 'release', split: input.split, schedule: input.schedule },
    input,
  );
}

/**
 * REFUND on REVISION_REQUIRED / REJECTED / cancellation / timeout (and
 * dispute resolution) — returns held and/or committed funds. Explicit
 * state, never a silent reversal.
 */
export function applyRefundOperation(
  ledger: PaymentLedger,
  input: { readonly amount: Money; readonly reason: RefundReason } & LedgerOperationContext,
): Promise<LedgerOperationResult> {
  return applyOperation(
    ledger,
    'refund',
    { kind: 'refund', amountMinorUnits: input.amount.minorUnits, reason: input.reason },
    input,
  );
}

// ---------------------------------------------------------------------------
// Integrity verification (tamper-evidence)
// ---------------------------------------------------------------------------

export interface LedgerIntegrityVerdict {
  readonly ok: boolean;
  readonly reason:
    | 'integrity_ok'
    | 'integrity_bad_sequence'
    | 'integrity_unbalanced_lines'
    | 'integrity_negative_balance'
    | 'integrity_digest_chain'
    | 'integrity_bad_shape';
  readonly sequence?: number;
}

/**
 * Recompute the full ledger invariants: contiguous sequences, balanced
 * lines (debits == credits per entry), non-negative funds balances, and
 * the sha256 digest chain. ANY silent mutation of a committed money
 * record breaks this and is reported machine-readably.
 */
export async function verifyLedgerIntegrity(ledger: PaymentLedger): Promise<LedgerIntegrityVerdict> {
  if (!isPaymentLedger(ledger)) {
    return { ok: false, reason: 'integrity_bad_shape' };
  }
  const balances = zeroBalances();
  let prevDigest: string | null = null;
  for (let index = 0; index < ledger.entries.length; index += 1) {
    const entry = ledger.entries[index];
    if (entry === undefined || entry.sequence !== index + 1) {
      return { ok: false, reason: 'integrity_bad_sequence', sequence: index + 1 };
    }
    let debits = 0n;
    let credits = 0n;
    for (const line of entry.lines) {
      const value = minorUnitsToBigInt(line.minorUnits);
      if (value < 0n) return { ok: false, reason: 'integrity_unbalanced_lines', sequence: entry.sequence };
      signedAdd(balances, line, value);
      if (line.side === 'debit') debits += value;
      else credits += value;
    }
    if (debits !== credits) {
      return { ok: false, reason: 'integrity_unbalanced_lines', sequence: entry.sequence };
    }
    if (entry.prevDigest !== prevDigest) {
      return { ok: false, reason: 'integrity_digest_chain', sequence: entry.sequence };
    }
    const digestFree: Record<string, unknown> = { ...entry };
    delete digestFree['digest'];
    const recomputed = await digestCanonical(digestFree as unknown as PlainJsonValue);
    if (recomputed !== entry.digest) {
      return { ok: false, reason: 'integrity_digest_chain', sequence: entry.sequence };
    }
    prevDigest = entry.digest;
  }
  for (const account of PAYMENT_ACCOUNTS) {
    const raw = ACCOUNT_SIDE[account] === 'source' ? balances[account] : -balances[account];
    if (raw < 0n) {
      return { ok: false, reason: 'integrity_negative_balance', sequence: ledger.entries.length };
    }
  }
  return { ok: true, reason: 'integrity_ok' };
}

function signedAdd(balances: Record<PaymentAccount, bigint>, line: LedgerLine, value: bigint): void {
  balances[line.account] += line.side === 'debit' ? value : -value;
}

// ---------------------------------------------------------------------------
// Structural guards
// ---------------------------------------------------------------------------

/** Structural guard for wire values claiming to be escrow ledgers. */
export function isPaymentLedger(value: unknown): value is PaymentLedger {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate['ledgerVersion'] !== PAYMENT_LEDGER_VERSION ||
    typeof candidate['requestId'] !== 'string' ||
    typeof candidate['currency'] !== 'string' ||
    !isLedgerState(candidate['state']) ||
    !isMoneyTruth(candidate['truth']) ||
    !isPaymentsTimestamp(candidate['createdAt']) ||
    !isPaymentsTimestamp(candidate['updatedAt'])
  ) {
    return false;
  }
  if (typeof candidate['tenantId'] !== 'string') return false;
  const entries = candidate['entries'];
  if (!Array.isArray(entries)) return false;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] as Record<string, unknown> | null;
    if (typeof entry !== 'object' || entry === null) return false;
    if (entry['sequence'] !== index + 1) return false;
    if (!isLedgerOperationKind(entry['kind'])) return false;
    if (!isPaymentsTimestamp(entry['occurredAt'])) return false;
    if (!Array.isArray(entry['lines'])) return false;
    for (const line of entry['lines'] as unknown[]) {
      if (
        typeof line !== 'object' ||
        line === null ||
        !isPaymentAccount((line as Record<string, unknown>)['account']) ||
        !['debit', 'credit'].includes(String((line as Record<string, unknown>)['side']))
      ) {
        return false;
      }
    }
  }
  return Array.isArray(candidate['operations']) && Array.isArray(candidate['auditEvents']);
}

/** Tenant extraction helper (the ledger's owning tenant). */
export function ledgerTenant(ledger: PaymentLedger): TenantId {
  return ledger.tenantId;
}
