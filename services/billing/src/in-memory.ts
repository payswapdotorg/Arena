/**
 * In-memory reference implementations of the billing ports (Work Order
 * A033). Deterministic, append-only, tenant-scoped — the seams tests and
 * demos wire into the BillingService. No I/O, no network, no globals.
 */

import { toEntitlementGrant } from '@arena/entitlements';
import type { EntitlementGrant, MeterWindow } from '@arena/entitlements';
import { BILLING_ERROR_CODES, BillingError } from './errors.js';
import type {
  Clock,
  GrantSource,
  JobUsageAttribution,
  JobUsageIndex,
  PriceBook,
  StatementStore,
  UsageLedger,
} from './ports.js';
import {
  BILLING_RECORD_VERSION,
  isUsageRecord,
  isUsageStatement,
  windowStartFor,
} from './shared.js';
import type { UsageRecord, UsageStatement } from './shared.js';

// ---------------------------------------------------------------------------
// Clocks
// ---------------------------------------------------------------------------

/** Deterministic manual clock (tests advance it explicitly). */
export class ManualClock implements Clock {
  private ms: number;
  constructor(startMs: number = Date.parse('2026-02-01T00:00:00.000Z')) {
    this.ms = startMs;
  }
  now(): number {
    return this.ms;
  }
  advance(ms: number): void {
    this.ms += ms;
  }
  setTo(iso: string): void {
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `manual clock setTo requires a parseable timestamp, got ${JSON.stringify(iso)}`,
      });
    }
    this.ms = parsed;
  }
}

/** Real-time clock (demos only). */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

// ---------------------------------------------------------------------------
// Grant source
// ---------------------------------------------------------------------------

/** In-memory grant store: validates + freezes on put; lists per tenant. */
export class InMemoryGrantStore implements GrantSource {
  private readonly byTenant = new Map<string, EntitlementGrant[]>();

  put(grant: unknown): EntitlementGrant {
    const validated = toEntitlementGrant(grant);
    const bucket = this.byTenant.get(validated.tenantId) ?? [];
    bucket.push(validated);
    this.byTenant.set(validated.tenantId, bucket);
    return validated;
  }

  listGrantsForTenant(tenantId: string): readonly EntitlementGrant[] {
    return this.byTenant.get(tenantId) ?? [];
  }
}

// ---------------------------------------------------------------------------
// Price book
// ---------------------------------------------------------------------------

/** Static price book: integer micros per unit; unknown features fail closed. */
export class StaticPriceBook implements PriceBook {
  private readonly prices: Readonly<Record<string, number>>;
  constructor(prices: Readonly<Record<string, number>> = {}) {
    this.prices = prices;
  }
  unitPriceMicros(featureKey: string): number {
    const price = this.prices[featureKey];
    if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `no unit price registered for feature ${JSON.stringify(featureKey)} (price book fails closed on unknown features)`,
        details: { featureKey },
      });
    }
    return price;
  }
}

// ---------------------------------------------------------------------------
// Usage ledger (append-only)
// ---------------------------------------------------------------------------

/**
 * In-memory append-only usage ledger. Enforces per-(tenant, feature)
 * contiguous sequences, occurredAt monotonicity (meter-window discipline),
 * unique usage ids and idempotency keys, and window locks.
 */
export class InMemoryUsageLedger implements UsageLedger {
  private readonly records: UsageRecord[] = [];
  private readonly byIdempotency = new Map<string, UsageRecord>();

  append(record: UsageRecord): UsageRecord {
    if (!isUsageRecord(record) || record.recordVersion !== BILLING_RECORD_VERSION) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_RECORD, {
        message: `invalid usage record: ${JSON.stringify(record)}`,
      });
    }
    if (this.records.some((existing) => existing.usageId === record.usageId)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_RECORD, {
        message: `usage id ${record.usageId} already exists (append-only ledgers never rewrite history)`,
        details: { usageId: record.usageId },
      });
    }
    const existing = this.byIdempotency.get(record.idempotencyKey);
    if (existing !== undefined) {
      throw new BillingError(BILLING_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${record.idempotencyKey} is already bound to usage ${existing.usageId}`,
        details: { idempotencyKey: record.idempotencyKey, existingUsageId: existing.usageId },
      });
    }
    const stream = this.records.filter(
      (entry) => entry.tenantId === record.tenantId && entry.featureKey === record.featureKey,
    );
    const expected = stream.length + 1;
    if (record.sequence < expected) {
      throw new BillingError(BILLING_ERROR_CODES.SEQUENCE_DUPLICATE, {
        message: `usage sequence ${String(record.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)}`,
        details: { expected, actual: record.sequence },
      });
    }
    if (record.sequence > expected) {
      throw new BillingError(BILLING_ERROR_CODES.SEQUENCE_GAP, {
        message: `usage sequence ${String(record.sequence)} leaves a gap before the expected next sequence ${String(expected)}`,
        details: { expected, actual: record.sequence },
      });
    }
    const last = stream.length > 0 ? stream[stream.length - 1] : undefined;
    if (last !== undefined && record.occurredAt < last.occurredAt) {
      throw new BillingError(BILLING_ERROR_CODES.WINDOW_VIOLATION, {
        message: `usage occurredAt regressed (last: ${last.occurredAt}, attempted: ${record.occurredAt}) — per-(tenant, feature) usage streams are monotonic in event time`,
        details: { last: last.occurredAt, attempted: record.occurredAt },
      });
    }
    for (const window of ['day', 'month'] as const) {
      if (this.lockedWindows.has(this.lockKey(record.tenantId, record.featureKey, window, windowStartFor(window, record.occurredAt)))) {
        throw new BillingError(BILLING_ERROR_CODES.WINDOW_LOCKED, {
          message: `usage at ${record.occurredAt} falls into a ${window} window that is already stated (locked windows never accept late usage)`,
          details: {
            tenantId: record.tenantId,
            featureKey: record.featureKey,
            window,
            windowStart: windowStartFor(window, record.occurredAt),
          },
        });
      }
    }
    const frozen = Object.freeze({ ...record });
    this.records.push(frozen);
    this.byIdempotency.set(frozen.idempotencyKey, frozen);
    return frozen;
  }

  findByIdempotencyKey(key: string): UsageRecord | undefined {
    return this.byIdempotency.get(key);
  }

  listForTenantFeature(tenantId: string, featureKey: string): readonly UsageRecord[] {
    return this.records.filter(
      (entry) => entry.tenantId === tenantId && entry.featureKey === featureKey,
    );
  }

  nextSequence(tenantId: string, featureKey: string): number {
    return (
      this.records.filter(
        (entry) => entry.tenantId === tenantId && entry.featureKey === featureKey,
      ).length + 1
    );
  }

  isWindowLocked(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): boolean {
    return this.lockedWindows.has(this.lockKey(tenantId, featureKey, window, windowStart));
  }

  /** Shared lock registry with the statement store (one authority per lock). */
  private readonly lockedWindows = new Set<string>();

  lockWindow(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): void {
    this.lockedWindows.add(this.lockKey(tenantId, featureKey, window, windowStart));
  }

  private lockKey(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): string {
    return `${tenantId}:${featureKey}:${window}:${windowStart}`;
  }
}

// ---------------------------------------------------------------------------
// Job usage attribution index
// ---------------------------------------------------------------------------

/**
 * In-memory job usage attribution index: maps job ids to the tenant and
 * feature key their execution meters against. Unregistered jobs attribute
 * to nothing — ingestion of their events fails closed in the service.
 */
export class InMemoryJobUsageIndex implements JobUsageIndex {
  private readonly byJob = new Map<string, JobUsageAttribution>();

  register(jobId: string, attribution: JobUsageAttribution): void {
    if (typeof jobId !== 'string' || jobId.length === 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `job usage attribution requires a non-empty job id, got ${JSON.stringify(jobId)}`,
      });
    }
    if (
      typeof attribution !== 'object' ||
      attribution === null ||
      typeof attribution.tenantId !== 'string' ||
      typeof attribution.featureKey !== 'string'
    ) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `job usage attribution for ${jobId} requires tenantId and featureKey strings`,
      });
    }
    this.byJob.set(jobId, Object.freeze({ ...attribution }));
  }

  attribute(jobId: string): JobUsageAttribution | undefined {
    return this.byJob.get(jobId);
  }
}

// ---------------------------------------------------------------------------
// Statement store
// ---------------------------------------------------------------------------

/**
 * In-memory statement store: draft → issued; an ISSUED statement can never
 * be replaced; drafting locks its window in the shared ledger lock registry.
 */
export class InMemoryStatementStore implements StatementStore {
  private readonly byId = new Map<string, UsageStatement>();

  constructor(private readonly ledger?: InMemoryUsageLedger) {}

  put(statement: UsageStatement): void {
    if (!isUsageStatement(statement)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
        message: `invalid usage statement: ${JSON.stringify(statement)}`,
      });
    }
    const existing = this.byId.get(statement.statementId);
    if (existing !== undefined && existing.status === 'issued') {
      throw new BillingError(BILLING_ERROR_CODES.STATEMENT_FINAL, {
        message: `statement ${statement.statementId} is issued and final; issued statements are immutable`,
        details: { statementId: statement.statementId },
      });
    }
    if (existing !== undefined && existing.status === 'draft' && statement.status === 'draft') {
      throw new BillingError(BILLING_ERROR_CODES.STATEMENT_FINAL, {
        message: `statement ${statement.statementId} is already drafted; drafts are never re-drafted (amend by voiding policy, not by rewrite)`,
        details: { statementId: statement.statementId },
      });
    }
    this.byId.set(statement.statementId, Object.freeze({ ...statement }));
  }

  get(statementId: string): UsageStatement | undefined {
    return this.byId.get(statementId);
  }

  lockWindow(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): void {
    this.ledger?.lockWindow(tenantId, featureKey, window, windowStart);
  }
}
