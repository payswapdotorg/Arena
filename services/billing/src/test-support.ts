/**
 * Shared test fixtures for @arena/billing-service (NOT part of the public
 * surface — hygiene.test.ts asserts it is not re-exported from index).
 *
 * Deterministic constants and builders only: fixed tenants, feature keys,
 * jobs and timestamps; no randomness.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  createFeatureFlagGrant,
  createQuotaGrant,
  createRateLimitGrant,
  makeRecordUsageCommand,
} from '@arena/entitlements';
import { makeJobEventEnvelope, toJobEvent } from '@arena/job-protocol';
import type { JobEvent, JobEventKind } from '@arena/job-protocol';
import { BillingService } from './service.js';
import {
  InMemoryGrantStore,
  InMemoryJobUsageIndex,
  InMemoryStatementStore,
  InMemoryUsageLedger,
  ManualClock,
  StaticPriceBook,
} from './in-memory.js';

export const TENANT_ACME = 'acme' as const;
export const TENANT_GLOBEX = 'globex' as const;
export const FEATURE_COMPUTE = 'job.compute' as const;
export const FEATURE_EVALUATE = 'evaluation.run' as const;
export const JOB_ALPHA = 'job-alpha-001' as const;
export const JOB_BETA = 'job-beta-001' as const;

/** Fixed canonical timestamps (ms-UTC, strictly increasing). */
export const T0 = '2026-02-01T00:00:00.000Z' as const;
export const T1 = '2026-02-01T06:00:00.000Z' as const;
export const T2 = '2026-02-01T12:00:00.000Z' as const;
export const T3 = '2026-02-01T18:00:00.000Z' as const;
export const T4 = '2026-02-02T00:00:00.000Z' as const;
export const T5 = '2026-03-01T00:00:00.000Z' as const;

/** 2026-02-01 is a UTC day window; 2026-02 is a UTC month window. */
export const DAY_WINDOW_START = T0;
export const NEXT_DAY_WINDOW_START = T4;
export const MONTH_WINDOW_START = T0;
export const NEXT_MONTH_WINDOW_START = T5;

/** Integer micros per metered unit (the reference price book). */
export const COMPUTE_UNIT_PRICE_MICROS = 2_500_000;
export const EVALUATE_UNIT_PRICE_MICROS = 1_000_000;

const CORR = toCorrelationId('corr-billing');
const IDEM = toIdempotencyKey('idem-billing');

/**
 * Derive a deterministic lowercase UUIDv4 from a friendly seed (envelope
 * ids must be UUIDv4 on the wire; fixtures stay readable and reproducible).
 */
function deterministicEnvelopeId(seed: string): string {
  let hash = 0x811c9dc5;
  for (const ch of seed) {
    hash ^= ch.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, '0');
  const tail = ((hash ^ 0x9e3779b9) >>> 0).toString(16).padStart(8, '0');
  const body = `${hex}${tail}${hex}${tail}`.padEnd(32, '0').slice(0, 32);
  const id = `${body.slice(0, 8)}-${body.slice(8, 12)}-4${body.slice(13, 16)}-8${body.slice(17, 20)}-${body.slice(20, 32)}`;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error(`deterministic envelope id derivation produced a malformed UUIDv4: ${id}`);
  }
  return id;
}

/** A fully wired, deterministic billing fabric harness. */
export interface BillingHarness {
  readonly service: BillingService;
  readonly clock: ManualClock;
  readonly grants: InMemoryGrantStore;
  readonly priceBook: StaticPriceBook;
  readonly ledger: InMemoryUsageLedger;
  readonly statements: InMemoryStatementStore;
  readonly jobIndex: InMemoryJobUsageIndex;
}

export function createBillingHarness(): BillingHarness {
  const clock = new ManualClock(Date.parse(T0));
  const grants = new InMemoryGrantStore();
  const priceBook = new StaticPriceBook({
    [FEATURE_COMPUTE]: COMPUTE_UNIT_PRICE_MICROS,
    [FEATURE_EVALUATE]: EVALUATE_UNIT_PRICE_MICROS,
  });
  const ledger = new InMemoryUsageLedger();
  const statements = new InMemoryStatementStore(ledger);
  const jobIndex = new InMemoryJobUsageIndex();
  let usageCounter = 0;
  let statementCounter = 0;
  const service = new BillingService({
    clock,
    grants,
    priceBook,
    ledger,
    statements,
    jobIndex,
    newUsageId: () => {
      usageCounter += 1;
      return `usage-${String(usageCounter).padStart(6, '0')}`;
    },
    newStatementId: () => {
      statementCounter += 1;
      return `statement-${String(statementCounter).padStart(6, '0')}`;
    },
  });
  return { service, clock, grants, priceBook, ledger, statements, jobIndex };
}

// ---------------------------------------------------------------------------
// Grant seeding (via @arena/entitlements constructors — never hand-rolled)
// ---------------------------------------------------------------------------

export interface QuotaSeed {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly limit?: number;
  readonly window?: 'day' | 'month';
  readonly validFrom?: string;
  readonly expiresAt?: string;
}

export function seedQuotaGrant(harness: BillingHarness, seed: QuotaSeed = {}): void {
  harness.grants.put(
    createQuotaGrant({
      grantId: seed.grantId ?? 'grant-quota-001',
      tenantId: seed.tenantId ?? TENANT_ACME,
      featureKey: seed.featureKey ?? FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: seed.validFrom ?? T0,
      limit: seed.limit ?? 10,
      window: seed.window ?? 'day',
      note: 'metered quota for billing tests',
      ...(seed.expiresAt !== undefined ? { expiresAt: seed.expiresAt } : {}),
    }),
  );
}

export interface FlagSeed {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly enabled?: boolean;
  readonly validFrom?: string;
}

export function seedFlagGrant(
  harness: BillingHarness,
  seed: FlagSeed = {},
): void {
  harness.grants.put(
    createFeatureFlagGrant({
      grantId: seed.grantId ?? 'grant-flag-001',
      tenantId: seed.tenantId ?? TENANT_ACME,
      featureKey: seed.featureKey ?? FEATURE_EVALUATE,
      issuedAt: T0,
      validFrom: seed.validFrom ?? T0,
      enabled: seed.enabled ?? true,
      note: 'feature flag for billing tests',
    }),
  );
}

export interface RateLimitSeed {
  readonly grantId?: string;
  readonly tenantId?: string;
  readonly featureKey?: string;
  readonly limit?: number;
  readonly durationSeconds?: number;
  readonly validFrom?: string;
}

export function seedRateLimitGrant(
  harness: BillingHarness,
  seed: RateLimitSeed = {},
): void {
  harness.grants.put(
    createRateLimitGrant({
      grantId: seed.grantId ?? 'grant-rate-001',
      tenantId: seed.tenantId ?? TENANT_ACME,
      featureKey: seed.featureKey ?? FEATURE_COMPUTE,
      issuedAt: T0,
      validFrom: seed.validFrom ?? T0,
      limit: seed.limit ?? 3,
      durationSeconds: seed.durationSeconds ?? 3600,
      note: 'rate limit for billing tests',
    }),
  );
}

// ---------------------------------------------------------------------------
// Job-event envelope fabrication (A015 discipline)
// ---------------------------------------------------------------------------

/**
 * Serialize a valid job-event envelope for ingestion tests. Lifecycle
 * milestones carry deterministic filler fields; every payload is validated
 * by toJobEvent before being wrapped.
 */
export function makeJobEventEnvelopeRaw(options: {
  readonly kind: JobEventKind;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly jobId: string;
  readonly envelopeId?: string;
}): string {
  const base = {
    eventVersion: 1,
    sequence: options.sequence,
    occurredAt: options.occurredAt,
    jobId: options.jobId,
  };
  let event: JobEvent;
  switch (options.kind) {
    case 'job-submitted':
      event = toJobEvent({
        ...base,
        kind: 'job-submitted',
        definitionDigest: 'ab'.repeat(32),
        input: null,
      });
      break;
    case 'job-started':
      event = toJobEvent({
        ...base,
        kind: 'job-started',
        attempt: 1,
        timeoutAt: '2026-02-01T00:01:00.000Z',
      });
      break;
    case 'job-progressed':
      event = toJobEvent({
        ...base,
        kind: 'job-progressed',
        attempt: 1,
        percent: 50,
      });
      break;
    case 'job-completed':
      event = toJobEvent({
        ...base,
        kind: 'job-completed',
        attempt: 1,
        result: null,
      });
      break;
    case 'job-cancelled':
      event = toJobEvent({
        ...base,
        kind: 'job-cancelled',
        reason: 'cancelled by operator',
      });
      break;
    default:
      throw new Error(`makeJobEventEnvelopeRaw does not fabricate ${String(options.kind)} events`);
  }
  return JSON.stringify(
    makeJobEventEnvelope(event, {
      correlationId: CORR,
      ...(options.envelopeId !== undefined
        ? { id: deterministicEnvelopeId(options.envelopeId) }
        : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// Record-usage command fabrication (entitlements discipline)
// ---------------------------------------------------------------------------

/** Serialize a valid record-usage command envelope (idempotency required). */
export function makeRecordUsageCommandRaw(options: {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly units: number;
  readonly jobId?: string;
  readonly idempotencyKey?: string;
}): string {
  return JSON.stringify(
    makeRecordUsageCommand(
      {
        tenantId: options.tenantId,
        featureKey: options.featureKey,
        units: options.units,
        ...(options.jobId !== undefined ? { jobId: options.jobId } : {}),
      },
      {
        correlationId: CORR,
        idempotencyKey:
          options.idempotencyKey !== undefined
            ? toIdempotencyKey(options.idempotencyKey)
            : IDEM,
      },
    ),
  );
}
