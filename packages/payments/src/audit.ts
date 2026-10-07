/**
 * Commercial audit events (Work Order C010; issue #77; handoff §8
 * "commercial audit" — every money movement is auditable).
 *
 * Every APPLIED ledger operation appends exactly one CommercialAuditEvent
 * to the ledger's append-only audit stream (duplicates append NOTHING —
 * they replay the recorded event verbatim). Events are plain JSON,
 * deep-frozen, carry the operation's correlation id and the truth label,
 * and summarize the machine-readable account deltas — an auditor can
 * reconstruct the whole money story from the audit stream alone.
 */

import type { LedgerOperationKind, LedgerState, PaymentAccount } from './ledger.js';
import type { AuditEventId, MoneyTruth, PaymentsTimestamp, PlainJsonValue, TenantId } from './shared.js';
import { deepFreeze, isAuditEventId, isMoneyTruth, isPlainJsonValue, newAuditEventId, toAuditEventId } from './shared.js';
import { PAYMENTS_ERROR_CODES, PaymentError } from './errors.js';

/** Wire version of the commercial audit event payload. */
export const COMMERCIAL_AUDIT_EVENT_VERSION = 1 as const;

export const COMMERCIAL_AUDIT_EVENT_KINDS = Object.freeze([
  'payment.hold.recorded',
  'payment.offer.recorded',
  'payment.acceptance.recorded',
  'payment.capture.recorded',
  'payment.release.recorded',
  'payment.refund.recorded',
] as const);
export type CommercialAuditEventKind = (typeof COMMERCIAL_AUDIT_EVENT_KINDS)[number];

export function isCommercialAuditEventKind(value: unknown): value is CommercialAuditEventKind {
  return (
    typeof value === 'string' &&
    (COMMERCIAL_AUDIT_EVENT_KINDS as readonly string[]).includes(value)
  );
}

/** Audit kind for a ledger operation kind (1:1 projection). */
export const OPERATION_TO_AUDIT_KIND: Readonly<Record<LedgerOperationKind, CommercialAuditEventKind>> = Object.freeze({
  hold: 'payment.hold.recorded',
  offer: 'payment.offer.recorded',
  acceptance: 'payment.acceptance.recorded',
  capture: 'payment.capture.recorded',
  release: 'payment.release.recorded',
  refund: 'payment.refund.recorded',
});

export interface CommercialAuditEvent {
  readonly eventVersion: typeof COMMERCIAL_AUDIT_EVENT_VERSION;
  /** Globally unique audit event id (cevt_ + 32 hex). */
  readonly eventId: AuditEventId;
  readonly kind: CommercialAuditEventKind;
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  /** The ledger operation key (idempotent correlation address). */
  readonly operationKey: string;
  /** The ledger entry sequence this event audits (1..n). */
  readonly sequence: number;
  readonly occurredAt: PaymentsTimestamp;
  readonly ledgerStateAfter: LedgerState;
  readonly truth: MoneyTruth;
  /** Machine-readable summary: account deltas + amounts (plain JSON). */
  readonly summary: PlainJsonValue;
}

export function isCommercialAuditEvent(value: unknown): value is CommercialAuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['eventVersion'] === COMMERCIAL_AUDIT_EVENT_VERSION &&
    isAuditEventId(candidate['eventId']) &&
    isCommercialAuditEventKind(candidate['kind']) &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['correlationId'] === 'string' &&
    typeof candidate['operationKey'] === 'string' &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    candidate['sequence'] >= 1 &&
    isPlainJsonValue(candidate['summary']) &&
    isMoneyTruth(candidate['truth'])
  );
}

/** Build and freeze one commercial audit event (strict, fail-closed). */
export function createCommercialAuditEvent(input: {
  readonly kind: CommercialAuditEventKind;
  readonly requestId: string;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly operationKey: string;
  readonly sequence: number;
  readonly occurredAt: PaymentsTimestamp;
  readonly ledgerStateAfter: LedgerState;
  readonly truth: MoneyTruth;
  readonly accountDeltas: Readonly<Record<PaymentAccount, string>>;
  readonly amounts: Readonly<Record<string, string>>;
  readonly eventId?: string;
}): CommercialAuditEvent {
  if (!isCommercialAuditEventKind(input.kind)) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown commercial audit event kind: ${JSON.stringify(input.kind)}`,
    });
  }
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new PaymentError(PAYMENTS_ERROR_CODES.INVALID_REQUEST, {
      message: `commercial audit event sequence must be a positive integer: ${JSON.stringify(input.sequence)}`,
    });
  }
  const summary: PlainJsonValue = deepFreeze({
    accountDeltas: { ...input.accountDeltas },
    amounts: { ...input.amounts },
  });
  const event: CommercialAuditEvent = Object.freeze({
    eventVersion: COMMERCIAL_AUDIT_EVENT_VERSION,
    eventId: input.eventId === undefined ? newAuditEventId() : toAuditEventId(input.eventId),
    kind: input.kind,
    requestId: input.requestId,
    tenantId: input.tenantId,
    correlationId: input.correlationId,
    operationKey: input.operationKey,
    sequence: input.sequence,
    occurredAt: input.occurredAt,
    ledgerStateAfter: input.ledgerStateAfter,
    truth: input.truth,
    summary,
  });
  return event;
}

/** The audit stream of a ledger in append order (the commercial audit surface). */
export function auditKindForOperation(kind: LedgerOperationKind): CommercialAuditEventKind {
  return OPERATION_TO_AUDIT_KIND[kind];
}
