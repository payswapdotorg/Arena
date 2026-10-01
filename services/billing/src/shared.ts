/**
 * Shared billing value types and meter-window math (Work Order A033;
 * requirements R34, R48; architecture-lock rules 16, 18).
 *
 * Metered aggregation windows reuse the closed @arena/entitlements
 * vocabulary (day / month) and are computed as UTC buckets: a record at
 * time `t` belongs to exactly one day window and one month window, derived
 * deterministically from `t` — never stored, so bucketing can never drift
 * from the occurredAt truth. Job-event unit costs are a closed table over
 * the A015 job-event taxonomy (the metering policy of this reference
 * fabric). Money is integer micros; floats never appear in records.
 */

import type { JobEventKind } from '@arena/job-protocol';
import { deepFreeze, toMeterTimestamp, toMeterWindow } from '@arena/entitlements';
import type { MeterWindow } from '@arena/entitlements';
import { BILLING_ERROR_CODES, BillingError } from './errors.js';

/** Wire version of every billing record. */
export const BILLING_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** Usage statement lifecycle: draft → issued (terminal). */
export const STATEMENT_STATUSES = Object.freeze(['draft', 'issued'] as const);
export type StatementStatus = (typeof STATEMENT_STATUSES)[number];

/** Append-only statement lineage vocabulary. */
export const STATEMENT_LINEAGE_KINDS = Object.freeze(['drafted', 'issued'] as const);
export type StatementLineageKind = (typeof STATEMENT_LINEAGE_KINDS)[number];

/** Where a usage record came from (closed set). */
export const USAGE_SOURCES = Object.freeze(['job-event', 'direct-command'] as const);
export type UsageSource = (typeof USAGE_SOURCES)[number];

/**
 * The closed job-event metering table (units per A015 event kind).
 * Lifecycle milestones meter one unit each; informational events
 * (progress, audit) and submissions meter zero.
 */
export const JOB_EVENT_UNIT_COSTS: Readonly<Record<JobEventKind, number>> = Object.freeze({
  'job-submitted': 0,
  'job-started': 1,
  'job-progressed': 0,
  'job-retried': 1,
  'job-completed': 1,
  'job-failed': 1,
  'job-cancelled': 0,
  'mutation-audited': 0,
});

/** Maximum unit price (integer micros) — guards safe-integer amounts. */
export const MAX_UNIT_PRICE_MICROS = 1_000_000_000;

// ---------------------------------------------------------------------------
// Meter-window math (pure, UTC buckets)
// ---------------------------------------------------------------------------

/** The UTC day-window start containing `at`. */
export function dayWindowStartFor(at: string): string {
  const when = new Date(toMeterTimestamp(at));
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()))
    .toISOString();
}

/** The UTC month-window start containing `at`. */
export function monthWindowStartFor(at: string): string {
  const when = new Date(toMeterTimestamp(at));
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), 1)).toISOString();
}

/** The UTC window start of kind `window` containing `at`. */
export function windowStartFor(window: MeterWindow, at: string): string {
  const kind = toMeterWindow(window);
  return kind === 'day' ? dayWindowStartFor(at) : monthWindowStartFor(at);
}

/** The exclusive end (next window start) of the window starting at `windowStart`. */
export function windowEndFor(window: MeterWindow, windowStart: string): string {
  const kind = toMeterWindow(window);
  const start = new Date(toMeterTimestamp(windowStart));
  if (kind === 'day') {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1))
      .toISOString();
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
}

/** True iff `at` lies within [windowStart, windowEnd). */
export function isWithinWindow(at: string, windowStart: string, windowEnd: string): boolean {
  const when = toMeterTimestamp(at);
  const start = toMeterTimestamp(windowStart);
  const end = toMeterTimestamp(windowEnd);
  return when >= start && when < end;
}

// ---------------------------------------------------------------------------
// Usage records (append-only ledger entries)
// ---------------------------------------------------------------------------

/** One metered usage entry in a tenant's append-only usage ledger. */
export interface UsageRecord {
  readonly recordVersion: typeof BILLING_RECORD_VERSION;
  readonly usageId: string;
  /** 1-based contiguous sequence within the (tenantId, featureKey) stream. */
  readonly sequence: number;
  readonly tenantId: string;
  readonly featureKey: string;
  readonly units: number;
  /** When the usage occurred (event time; drives window bucketing). */
  readonly occurredAt: string;
  /** When the billing service recorded it (processing time). */
  readonly recordedAt: string;
  readonly source: UsageSource;
  readonly jobId?: string;
  /** Dedupe key: command idempotency key, or the job-event envelope id. */
  readonly idempotencyKey: string;
}

export function isUsageRecord(value: unknown): value is UsageRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === BILLING_RECORD_VERSION &&
    typeof candidate['usageId'] === 'string' &&
    typeof candidate['sequence'] === 'number' &&
    Number.isInteger(candidate['sequence']) &&
    (candidate['sequence'] as number) >= 1 &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['featureKey'] === 'string' &&
    typeof candidate['units'] === 'number' &&
    Number.isInteger(candidate['units']) &&
    (candidate['units'] as number) >= 1 &&
    typeof candidate['occurredAt'] === 'string' &&
    typeof candidate['recordedAt'] === 'string' &&
    (candidate['source'] === 'job-event' || candidate['source'] === 'direct-command') &&
    (candidate['jobId'] === undefined || typeof candidate['jobId'] === 'string') &&
    typeof candidate['idempotencyKey'] === 'string'
  );
}

// ---------------------------------------------------------------------------
// Usage statements (immutable, append-only lineage, digest-sealed)
// ---------------------------------------------------------------------------

/** One statement line item (this reference fabric: one per statement). */
export interface StatementLineItem {
  readonly featureKey: string;
  readonly units: number;
  readonly unitPriceMicros: number;
  readonly amountMicros: number;
}

/** One append-only lineage entry in a statement's lifecycle. */
export interface StatementLineageEvent {
  readonly sequence: number;
  readonly kind: StatementLineageKind;
  readonly occurredAt: string;
  readonly note: string;
}

/**
 * A usage statement (the invoice record of this reference fabric): an
 * immutable snapshot of one (tenant, feature, window) aggregate, sealed
 * with a canonical sha256 digest over its digest-free projection. Draft →
 * issued is the only transition; issued statements are FINAL.
 */
export interface UsageStatement {
  readonly recordVersion: typeof BILLING_RECORD_VERSION;
  readonly statementId: string;
  readonly tenantId: string;
  readonly featureKey: string;
  readonly window: MeterWindow;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly status: StatementStatus;
  readonly recordCount: number;
  readonly unitsTotal: number;
  readonly lineItems: readonly StatementLineItem[];
  readonly amountMicros: number;
  readonly lineage: readonly StatementLineageEvent[];
  readonly draftedAt: string;
  readonly issuedAt?: string;
  readonly statementDigest: string;
}

export function isUsageStatement(value: unknown): value is UsageStatement {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === BILLING_RECORD_VERSION &&
    typeof candidate['statementId'] === 'string' &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['featureKey'] === 'string' &&
    (candidate['window'] === 'day' || candidate['window'] === 'month') &&
    typeof candidate['windowStart'] === 'string' &&
    typeof candidate['windowEnd'] === 'string' &&
    (candidate['status'] === 'draft' || candidate['status'] === 'issued') &&
    typeof candidate['recordCount'] === 'number' &&
    typeof candidate['unitsTotal'] === 'number' &&
    Array.isArray(candidate['lineItems']) &&
    typeof candidate['amountMicros'] === 'number' &&
    Array.isArray(candidate['lineage']) &&
    typeof candidate['draftedAt'] === 'string' &&
    (candidate['issuedAt'] === undefined || typeof candidate['issuedAt'] === 'string') &&
    typeof candidate['statementDigest'] === 'string'
  );
}

/** Aggregate of a usage window (a read projection, not a record). */
export interface UsageWindowSummary {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly window: MeterWindow;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly recordCount: number;
  readonly unitsTotal: number;
}

/** The outcome of ingesting one job event for metering. */
export interface UsageIngestionOutcome {
  readonly metered: boolean;
  readonly reason: 'metered' | 'not-metered' | 'idempotent-replay';
  readonly record?: UsageRecord;
}

/** Guard: money arithmetic must stay in the safe integer range. */
export function assertSafeAmountMicros(units: number, unitPriceMicros: number): number {
  if (
    !Number.isInteger(units) ||
    !Number.isInteger(unitPriceMicros) ||
    unitPriceMicros < 0 ||
    unitPriceMicros > MAX_UNIT_PRICE_MICROS
  ) {
    throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
      message: `invalid statement money inputs (units ${String(units)}, unitPriceMicros ${String(unitPriceMicros)}; prices are integer micros <= ${String(MAX_UNIT_PRICE_MICROS)})`,
    });
  }
  const amount = units * unitPriceMicros;
  if (!Number.isSafeInteger(amount)) {
    throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
      message: `statement amount overflows the safe integer range (units ${String(units)} x unitPriceMicros ${String(unitPriceMicros)})`,
    });
  }
  return amount;
}

/** deepFreeze is reused from the entitlements domain package (one authority). */
export { deepFreeze };
