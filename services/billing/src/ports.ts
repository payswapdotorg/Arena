/**
 * Billing service ports — the injected-dependency seams of the reference
 * billing fabric (Work Order A033; architecture-lock rules 16, 17, 19).
 *
 * The billing service never touches a clock, a grant store, a price book,
 * a ledger or a statement store directly: every collaborator is a port
 * injected through `BillingServiceDeps`, exactly like the A015
 * job-orchestrator's Clock/JobStore/EventSink seams. In-memory reference
 * implementations live in in-memory.ts (tests and demos wire those; a
 * production deployment wires durable ones without touching the service).
 */

import type { EntitlementGrant } from '@arena/entitlements';
import type { MeterWindow } from '@arena/entitlements';
import type { UsageRecord, UsageStatement } from './shared.js';

/** Injected time source (deterministic in tests via ManualClock). */
export interface Clock {
  now(): number;
}

/** Tenant-scoped entitlement grant source (adapter over the entitlement store). */
export interface GrantSource {
  listGrantsForTenant(tenantId: string): readonly EntitlementGrant[];
}

/** Price book: integer micros per unit for a feature key (fail closed on unknown). */
export interface PriceBook {
  unitPriceMicros(featureKey: string): number;
}

/** The append-only usage ledger (one authority: the billing service). */
export interface UsageLedger {
  /** Validate + append; returns the frozen record (idempotent replays handled by the service). */
  append(record: UsageRecord): UsageRecord;
  findByIdempotencyKey(key: string): UsageRecord | undefined;
  listForTenantFeature(tenantId: string, featureKey: string): readonly UsageRecord[];
  nextSequence(tenantId: string, featureKey: string): number;
  isWindowLocked(tenantId: string, featureKey: string, window: MeterWindow, windowStart: string): boolean;
}

/** The immutable statement store (draft → issued; windows lock on draft). */
export interface StatementStore {
  /** Put a statement; replacing an ISSUED statement is rejected (final). */
  put(statement: UsageStatement): void;
  get(statementId: string): UsageStatement | undefined;
  /** Lock a (tenant, feature, window) bucket — no further usage may append into it. */
  lockWindow(tenantId: string, featureKey: string, window: MeterWindow, windowStart: string): void;
}

/**
 * Job-event usage attribution: the mapping from a job id (A015 stream) to
 * the tenant and feature key its execution meters against. The billing
 * service NEVER guesses attribution — an unattributed job fails closed.
 */
export interface JobUsageAttribution {
  readonly tenantId: string;
  readonly featureKey: string;
}

/** Attribution port over the job registry (adapter over job records). */
export interface JobUsageIndex {
  attribute(jobId: string): JobUsageAttribution | undefined;
}

/** Everything the billing service needs, injected. */
export interface BillingServiceDeps {
  readonly clock: Clock;
  readonly grants: GrantSource;
  readonly priceBook: PriceBook;
  readonly ledger: UsageLedger;
  readonly statements: StatementStore;
  readonly jobIndex: JobUsageIndex;
  /** Deterministic id factories (tests inject fixed sequences). */
  readonly newUsageId?: () => string;
  readonly newStatementId?: () => string;
}
