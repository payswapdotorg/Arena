/**
 * The reference billing fabric (Work Order A033; requirements R31, R34, R48;
 * architecture-lock rules 11, 16, 17, 18, 19).
 *
 * `BillingService` is the epoch-consumption accounting authority: it ingests
 * usage from A015 job-event envelopes (closed unit-cost metering table) and
 * from entitlements record-usage commands, enforces every active entitlement
 * grant FAIL-CLOSED before a single unit is metered (no active grant, an
 * expired/revoked grant, a disabled flag, a quota or a rate limit can never
 * be bypassed), aggregates usage into UTC meter windows, and seals immutable
 * usage statements (draft → issued, append-only lineage, canonical sha256
 * digests, locked windows — usage can never be appended into an
 * already-stated window).
 *
 * Envelope discipline: every wire input is a versioned `Envelope<T>` parsed
 * by the owning package's parser (@arena/job-protocol for job events,
 * @arena/entitlements for record-usage commands) — malformed envelopes,
 * unknown versions and commands without idempotency keys are rejected by
 * the core parser before any billing state is touched. Core-level
 * protocol failures propagate as the original `ProtocolError`; billing
 * domain failures carry `BILLING_*` codes.
 */

import { digestCanonical } from '@arena/protocol-core';
import { parseJobEnvelope, toJobEvent } from '@arena/job-protocol';
import type { JobEvent } from '@arena/job-protocol';
import {
  evaluateFeatureFlag,
  isFeatureKey,
  isMeterTimestamp,
  isMeterWindow,
  isPositiveInteger,
  isRecordUsageCommandPayload,
  isTenantId,
  isUsageId,
  parseEntitlementEnvelope,
  resolveEntitlements,
  toMeterWindow,
} from '@arena/entitlements';
import type {
  MeterWindow,
  QuotaGrant,
  RateLimitGrant,
  RecordUsageCommandPayload,
} from '@arena/entitlements';
import { BILLING_ERROR_CODES, BillingError } from './errors.js';
import type {
  BillingServiceDeps,
  Clock,
  GrantSource,
  JobUsageIndex,
  PriceBook,
  StatementStore,
  UsageLedger,
} from './ports.js';
import {
  BILLING_RECORD_VERSION,
  JOB_EVENT_UNIT_COSTS,
  assertSafeAmountMicros,
  deepFreeze,
  isUsageStatement,
  isWithinWindow,
  windowEndFor,
  windowStartFor,
} from './shared.js';
import type {
  UsageIngestionOutcome,
  UsageRecord,
  UsageStatement,
  UsageWindowSummary,
} from './shared.js';

/** A statement with its digest stripped — the projection the digest seals. */
export type StatementDigestProjection = Omit<UsageStatement, 'statementDigest'>;

/** Input of `BillingService.draftStatement`. */
export interface DraftStatementInput {
  readonly tenantId: string;
  readonly featureKey: string;
  readonly window: MeterWindow;
  /** Canonical UTC bucket start of the window (recomputed and verified). */
  readonly windowStart: string;
  readonly note?: string;
}

/** Strip the digest from a statement — the canonical digest input shape. */
function digestProjection({ statementDigest: _statementDigest, ...projection }: UsageStatement): StatementDigestProjection {
  void _statementDigest;
  return projection;
}

/** Seal a digest-free statement projection with its canonical sha256 digest. */
async function sealStatement(projection: StatementDigestProjection): Promise<UsageStatement> {
  const statementDigest = await digestCanonical(projection);
  return deepFreeze({ ...projection, statementDigest });
}

/** The reference billing service (pure fabric, injected dependencies). */
export class BillingService {
  private readonly clock: Clock;
  private readonly grants: GrantSource;
  private readonly priceBook: PriceBook;
  private readonly ledger: UsageLedger;
  private readonly statements: StatementStore;
  private readonly jobIndex: JobUsageIndex;
  private readonly newUsageId: () => string;
  private readonly newStatementId: () => string;

  constructor(deps: BillingServiceDeps) {
    this.clock = deps.clock;
    this.grants = deps.grants;
    this.priceBook = deps.priceBook;
    this.ledger = deps.ledger;
    this.statements = deps.statements;
    this.jobIndex = deps.jobIndex;
    let usageCounter = 0;
    let statementCounter = 0;
    this.newUsageId =
      deps.newUsageId ??
      (() => {
        usageCounter += 1;
        return `usage-${String(usageCounter).padStart(6, '0')}`;
      });
    this.newStatementId =
      deps.newStatementId ??
      (() => {
        statementCounter += 1;
        return `statement-${String(statementCounter).padStart(6, '0')}`;
      });
  }

  // -------------------------------------------------------------------------
  // Usage ingestion (envelope-wired)
  // -------------------------------------------------------------------------

  /**
   * Ingest one A015 job-event envelope and meter its closed unit cost
   * against the attributed tenant + feature. Informational events (unit
   * cost 0) are acknowledged but never metered; replays of an already-known
   * envelope id are idempotent; unattributed jobs fail closed.
   */
  ingestJobEventEnvelope(raw: string): UsageIngestionOutcome {
    const envelope = parseJobEnvelope<JobEvent>(raw);
    const event = toJobEvent(envelope.payload);
    const units = JOB_EVENT_UNIT_COSTS[event.kind];
    if (units === 0) {
      return { metered: false, reason: 'not-metered' };
    }
    const attribution = this.jobIndex.attribute(event.jobId);
    if (attribution === undefined) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_EVENT, {
        message: `job ${event.jobId} has no usage attribution — unattributed jobs are never metered (attribution fails closed)`,
        details: { jobId: event.jobId, eventKind: event.kind },
      });
    }
    return this.meterUsage({
      tenantId: attribution.tenantId,
      featureKey: attribution.featureKey,
      units,
      occurredAt: event.occurredAt,
      source: 'job-event',
      jobId: event.jobId,
      idempotencyKey: `job-event:${envelope.id}`,
    });
  }

  /**
   * Ingest one entitlements record-usage command envelope (direct-command
   * usage, e.g. API-metered features). The command's idempotency key is
   * REQUIRED (enforced by the core parser for command envelopes); usage
   * occurs at the injected clock's now.
   */
  ingestRecordUsageCommand(raw: string): UsageIngestionOutcome {
    const envelope = parseEntitlementEnvelope<RecordUsageCommandPayload>(
      raw,
      'entitlements/record-usage-command',
    );
    if (envelope.idempotencyKey === null || envelope.idempotencyKey === undefined) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_COMMAND, {
        message: 'record-usage commands require an idempotency key (architecture-lock rule 17)',
        details: { envelopeId: envelope.id },
      });
    }
    if (!isRecordUsageCommandPayload(envelope.payload)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_COMMAND, {
        message: `record-usage command payload failed structural validation (schema ${envelope.schema})`,
        details: { schema: envelope.schema },
      });
    }
    const payload = envelope.payload;
    const now = this.nowIso();
    return this.meterUsage({
      tenantId: payload.tenantId,
      featureKey: payload.featureKey,
      units: payload.units,
      occurredAt: now,
      source: 'direct-command',
      ...(payload.jobId !== undefined ? { jobId: payload.jobId } : {}),
      idempotencyKey: `command:${envelope.idempotencyKey}`,
    });
  }

  // -------------------------------------------------------------------------
  // Read projections (tenant-scoped, fail closed)
  // -------------------------------------------------------------------------

  /** Aggregate the usage of one (tenant, feature, window) bucket. */
  summarizeWindow(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): UsageWindowSummary {
    const tenant = this.requireTenantId(tenantId, 'summarizeWindow');
    const feature = this.requireFeatureKey(featureKey, 'summarizeWindow');
    const kind = this.requireWindow(window, 'summarizeWindow');
    const start = this.requireCanonicalWindowStart(kind, windowStart);

    const records = this.recordsInWindow(tenant, feature, kind, start);
    return {
      tenantId: tenant,
      featureKey: feature,
      window: kind,
      windowStart: start,
      windowEnd: windowEndFor(kind, start),
      recordCount: records.length,
      unitsTotal: records.reduce((sum, record) => sum + record.units, 0),
    };
  }

  /**
   * Read one statement for a tenant. Cross-tenant reads fail closed
   * (BILLING_TENANT_MISMATCH); unknown statement ids fail closed too.
   */
  getStatementForTenant(tenantId: string, statementId: string): UsageStatement {
    const tenant = this.requireTenantId(tenantId, 'getStatementForTenant');
    if (typeof statementId !== 'string' || statementId.length === 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: 'statement id must be a non-empty string',
      });
    }
    const statement = this.statements.get(statementId);
    if (statement === undefined) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
        message: `unknown statement id ${statementId}`,
        details: { statementId },
      });
    }
    if (statement.tenantId !== tenant) {
      throw new BillingError(BILLING_ERROR_CODES.TENANT_MISMATCH, {
        message: `statement ${statementId} belongs to tenant ${statement.tenantId}, not ${tenant} — cross-tenant statement reads fail closed`,
        details: { accessorTenant: tenant, ownerTenant: statement.tenantId },
      });
    }
    return statement;
  }

  /** The usage records of one (tenant, feature) stream, in ledger order. */
  listUsageRecords(tenantId: string, featureKey: string): readonly UsageRecord[] {
    const tenant = this.requireTenantId(tenantId, 'listUsageRecords');
    const feature = this.requireFeatureKey(featureKey, 'listUsageRecords');
    return this.ledger.listForTenantFeature(tenant, feature);
  }

  /**
   * Verify a statement's digest seal: true iff the statement is structurally
   * valid and its canonical digest matches the sealed one. Tampered
   * statements verify false — this is the immutability tripwire.
   */
  async verifyStatement(statement: UsageStatement): Promise<boolean> {
    if (!isUsageStatement(statement)) return false;
    const expected = await digestCanonical(digestProjection(statement));
    return expected === statement.statementDigest;
  }

  // -------------------------------------------------------------------------
  // Statements (draft → issued; locked windows)
  // -------------------------------------------------------------------------

  /**
   * Draft a usage statement over one (tenant, feature, window) bucket:
   * prices the aggregated units through the injected price book (unknown
   * features fail closed), seals the draft with its canonical digest, locks
   * the window (no further usage may be appended into it) and stores it.
   * Empty windows are never drafted.
   */
  async draftStatement(input: DraftStatementInput): Promise<UsageStatement> {
    if (typeof input !== 'object' || input === null) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: 'draftStatement requires a statement input object',
      });
    }
    const tenant = this.requireTenantId(input.tenantId, 'draftStatement');
    const feature = this.requireFeatureKey(input.featureKey, 'draftStatement');
    const kind = this.requireWindow(input.window, 'draftStatement');
    const start = this.requireCanonicalWindowStart(kind, input.windowStart);

    if (this.ledger.isWindowLocked(tenant, feature, kind, start)) {
      throw new BillingError(BILLING_ERROR_CODES.WINDOW_LOCKED, {
        message: `the ${kind} window starting ${start} for feature ${feature} on tenant ${tenant} is already stated — windows are stated at most once`,
        details: { tenantId: tenant, featureKey: feature, window: kind, windowStart: start },
      });
    }
    const summary = this.summarizeWindow(tenant, feature, kind, start);
    if (summary.recordCount === 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
        message: `refusing to draft a statement over an empty usage window (feature ${feature}, ${kind} window starting ${start})`,
        details: { tenantId: tenant, featureKey: feature, window: kind, windowStart: start },
      });
    }
    const unitPriceMicros = this.priceBook.unitPriceMicros(feature);
    const amountMicros = assertSafeAmountMicros(summary.unitsTotal, unitPriceMicros);
    const now = this.nowIso();
    const draft: StatementDigestProjection = {
      recordVersion: BILLING_RECORD_VERSION,
      statementId: this.newStatementId(),
      tenantId: tenant,
      featureKey: feature,
      window: kind,
      windowStart: start,
      windowEnd: summary.windowEnd,
      status: 'draft',
      recordCount: summary.recordCount,
      unitsTotal: summary.unitsTotal,
      lineItems: Object.freeze([
        Object.freeze({
          featureKey: feature,
          units: summary.unitsTotal,
          unitPriceMicros,
          amountMicros,
        }),
      ]),
      amountMicros,
      lineage: Object.freeze([
        Object.freeze({
          sequence: 1,
          kind: 'drafted',
          occurredAt: now,
          note:
            input.note !== undefined && input.note.length > 0
              ? input.note
              : `drafted over ${String(summary.recordCount)} usage records`,
        }),
      ]),
      draftedAt: now,
    };
    const statement = await sealStatement(draft);
    this.statements.lockWindow(tenant, feature, kind, start);
    this.statements.put(statement);
    return statement;
  }

  /**
   * Issue a drafted statement: appends the terminal `issued` lineage entry,
   * reseals the digest and stores it. Issued statements are FINAL —
   * re-issuing fails closed with BILLING_STATEMENT_FINAL.
   */
  async issueStatement(statementId: string): Promise<UsageStatement> {
    if (typeof statementId !== 'string' || statementId.length === 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: 'statement id must be a non-empty string',
      });
    }
    const existing = this.statements.get(statementId);
    if (existing === undefined) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_STATEMENT, {
        message: `unknown statement id ${statementId}`,
        details: { statementId },
      });
    }
    if (existing.status === 'issued') {
      throw new BillingError(BILLING_ERROR_CODES.STATEMENT_FINAL, {
        message: `statement ${statementId} is issued and final; issued statements are immutable`,
        details: { statementId },
      });
    }
    const now = this.nowIso();
    const issued: StatementDigestProjection = {
      ...digestProjection(existing),
      status: 'issued',
      issuedAt: now,
      lineage: Object.freeze([
        ...existing.lineage,
        Object.freeze({
          sequence: existing.lineage.length + 1,
          kind: 'issued',
          occurredAt: now,
          note: `issued at ${now}`,
        }),
      ]),
    };
    const statement = await sealStatement(issued);
    this.statements.put(statement);
    return statement;
  }

  // -------------------------------------------------------------------------
  // Metering core (private)
  // -------------------------------------------------------------------------

  /** Validate, authorize and append one usage record. */
  private meterUsage(input: {
    readonly tenantId: string;
    readonly featureKey: string;
    readonly units: number;
    readonly occurredAt: string;
    readonly source: 'job-event' | 'direct-command';
    readonly jobId?: string;
    readonly idempotencyKey: string;
  }): UsageIngestionOutcome {
    const tenant = this.requireTenantId(input.tenantId, 'meterUsage');
    const feature = this.requireFeatureKey(input.featureKey, 'meterUsage');
    if (!isPositiveInteger(input.units)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `metered units must be a positive integer, got ${JSON.stringify(input.units)}`,
      });
    }
    if (!isMeterTimestamp(input.occurredAt)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `usage occurredAt must be a canonical ms-UTC timestamp, got ${JSON.stringify(input.occurredAt)}`,
      });
    }
    if (input.jobId !== undefined && !isUsageId(input.jobId)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `usage jobId must match the identifier charset when present, got ${JSON.stringify(input.jobId)}`,
      });
    }
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length === 0) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: 'usage ingestion requires a non-empty idempotency key',
      });
    }

    // Idempotent replay: a known key returns the original record; the SAME
    // key bound to a DIFFERENT usage shape is a conflict, never a silent
    // double-meter (fail closed).
    const existing = this.ledger.findByIdempotencyKey(input.idempotencyKey);
    if (existing !== undefined) {
      const sameShape =
        existing.tenantId === tenant &&
        existing.featureKey === feature &&
        existing.units === input.units;
      if (!sameShape) {
        throw new BillingError(BILLING_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
          message: `idempotency key ${input.idempotencyKey} is already bound to a different usage shape (tenant ${existing.tenantId}, feature ${existing.featureKey}, ${String(existing.units)} units)`,
          details: {
            idempotencyKey: input.idempotencyKey,
            existingUsageId: existing.usageId,
          },
        });
      }
      return { metered: true, reason: 'idempotent-replay', record: existing };
    }

    // Fail-closed entitlement enforcement BEFORE any ledger append.
    this.authorizeUsage(tenant, feature, input.units, input.occurredAt);

    const record: UsageRecord = {
      recordVersion: BILLING_RECORD_VERSION,
      usageId: this.newUsageId(),
      sequence: this.ledger.nextSequence(tenant, feature),
      tenantId: tenant,
      featureKey: feature,
      units: input.units,
      occurredAt: input.occurredAt,
      recordedAt: this.nowIso(),
      source: input.source,
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      idempotencyKey: input.idempotencyKey,
    };
    const stored = this.ledger.append(record);
    return { metered: true, reason: 'metered', record: stored };
  }

  /**
   * Enforce every active entitlement grant for (tenant, feature) at `at`:
   * resolution (active grant required), feature flags (deny overrides),
   * rate limits (trailing event-count windows), quotas (metered window
   * aggregates). Every check fails closed.
   */
  private authorizeUsage(tenantId: string, featureKey: string, units: number, at: string): void {
    const grants = this.grants.listGrantsForTenant(tenantId);
    const resolution = resolveEntitlements(grants, tenantId, featureKey, at);
    if (!resolution.allowed) {
      throw new BillingError(BILLING_ERROR_CODES.ENTITLEMENT_DENIED, {
        message: `usage of feature ${featureKey} for tenant ${tenantId} at ${at} is not entitled (resolution reason: ${resolution.reason})`,
        details: { tenantId, featureKey, reason: resolution.reason, at },
      });
    }
    const flag = evaluateFeatureFlag(grants, tenantId, featureKey, at);
    if (flag.reason === 'flag-disabled') {
      throw new BillingError(BILLING_ERROR_CODES.FEATURE_DISABLED, {
        message: `feature ${featureKey} is disabled for tenant ${tenantId} — disabled flags deny usage (deny overrides)`,
        details: { tenantId, featureKey },
      });
    }
    for (const grant of resolution.grants) {
      if (grant.kind === 'rate-limit') {
        this.enforceRateLimit(grant, tenantId, featureKey, at);
      }
    }
    for (const grant of resolution.grants) {
      if (grant.kind === 'quota') {
        this.enforceQuota(grant, tenantId, featureKey, units, at);
      }
    }
  }

  /** Rate-limit enforcement over the trailing duration window. */
  private enforceRateLimit(
    grant: RateLimitGrant,
    tenantId: string,
    featureKey: string,
    at: string,
  ): void {
    const windowStart = new Date(Date.parse(at) - grant.durationSeconds * 1000).toISOString();
    const records = this.ledger.listForTenantFeature(tenantId, featureKey);
    const counted = records.filter(
      (record) => record.occurredAt > windowStart && record.occurredAt <= at,
    ).length;
    if (counted + 1 > grant.limit) {
      throw new BillingError(BILLING_ERROR_CODES.RATE_LIMIT_EXCEEDED, {
        message: `rate limit of ${String(grant.limit)} metered usage events per ${String(grant.durationSeconds)}s exceeded for feature ${featureKey} on tenant ${tenantId} (${String(counted)} already inside the trailing window)`,
        details: {
          tenantId,
          featureKey,
          limit: grant.limit,
          durationSeconds: grant.durationSeconds,
          windowStart,
          counted,
        },
      });
    }
  }

  /** Quota enforcement over the grant's metered aggregation window. */
  private enforceQuota(
    grant: QuotaGrant,
    tenantId: string,
    featureKey: string,
    units: number,
    at: string,
  ): void {
    const windowStart = windowStartFor(grant.window, at);
    const windowEnd = windowEndFor(grant.window, windowStart);
    const used = this.unitsInWindow(tenantId, featureKey, windowStart, windowEnd);
    if (used + units > grant.limit) {
      throw new BillingError(BILLING_ERROR_CODES.QUOTA_EXCEEDED, {
        message: `${grant.window} quota of ${String(grant.limit)} units for feature ${featureKey} on tenant ${tenantId} would be exceeded (${String(used)} already used, ${String(units)} attempted)`,
        details: {
          tenantId,
          featureKey,
          limit: grant.limit,
          window: grant.window,
          windowStart,
          usedUnits: used,
          attemptedUnits: units,
        },
      });
    }
  }

  private unitsInWindow(
    tenantId: string,
    featureKey: string,
    windowStart: string,
    windowEnd: string,
  ): number {
    return this.ledger
      .listForTenantFeature(tenantId, featureKey)
      .filter((record) => isWithinWindow(record.occurredAt, windowStart, windowEnd))
      .reduce((sum, record) => sum + record.units, 0);
  }

  private recordsInWindow(
    tenantId: string,
    featureKey: string,
    window: MeterWindow,
    windowStart: string,
  ): readonly UsageRecord[] {
    const windowEnd = windowEndFor(window, windowStart);
    return this.ledger
      .listForTenantFeature(tenantId, featureKey)
      .filter((record) => isWithinWindow(record.occurredAt, windowStart, windowEnd));
  }

  // -------------------------------------------------------------------------
  // Input validation (fail closed)
  // -------------------------------------------------------------------------

  private requireTenantId(value: string, operation: string): string {
    if (!isTenantId(value)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `${operation} requires a valid tenant id, got ${JSON.stringify(value)}`,
      });
    }
    return value;
  }

  private requireFeatureKey(value: string, operation: string): string {
    if (!isFeatureKey(value)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `${operation} requires a valid feature key, got ${JSON.stringify(value)}`,
      });
    }
    return value;
  }

  private requireWindow(value: MeterWindow, operation: string): MeterWindow {
    if (!isMeterWindow(value)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `${operation} requires a meter window of 'day' or 'month', got ${JSON.stringify(value)}`,
      });
    }
    return toMeterWindow(value);
  }

  private requireCanonicalWindowStart(window: MeterWindow, windowStart: string): string {
    if (!isMeterTimestamp(windowStart)) {
      throw new BillingError(BILLING_ERROR_CODES.INVALID_INPUT, {
        message: `window start must be a canonical ms-UTC timestamp, got ${JSON.stringify(windowStart)}`,
      });
    }
    const canonical = windowStartFor(window, windowStart);
    if (canonical !== windowStart) {
      throw new BillingError(BILLING_ERROR_CODES.WINDOW_VIOLATION, {
        message: `window start ${windowStart} is not the canonical UTC bucket start of its ${window} window (expected ${canonical}) — window bounds are derived, never chosen`,
        details: { expected: canonical, received: windowStart, window },
      });
    }
    return windowStart;
  }

  private nowIso(): string {
    return new Date(this.clock.now()).toISOString();
  }
}
