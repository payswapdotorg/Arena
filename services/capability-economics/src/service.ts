/**
 * CapabilityEconomicsService — the reference service wiring the C016
 * capability-economics domain core to the injected source ports (Work
 * Order C016; issue #122).
 *
 * Mirrors the sibling service discipline (services/capability-routing):
 * injected dependencies only, fail-closed error normalization (an
 * internal failure NEVER invents an economics figure — it degrades to
 * a typed denial), no wall-clock reads (rule 17), tenant isolation
 * double-guarded at the service level, and durable idempotent
 * recomputation jobs over the A015 job-protocol submission identity.
 *
 * THE SEAM (the C021/observability + developer-platform consumers):
 *   - `computeInterventionEconomics` — compile + append one record
 *     (REQUIRES the C010 ledger; a missing ledger is the typed
 *     LEDGER_BACKING_MISSING denial — the no-money-truth law);
 *   - `readAggregate` / `readDimension` — the dimensional read models
 *     (truth-scoped: demo and customer economics NEVER mix);
 *   - `recordHistory` — the append-only per-escalation history;
 *   - `submitRecomputeJob` / `drainRecomputeJobs` — durable
 *     recomputation on the A015 fabric semantics.
 */

import {
  aggregateUnitEconomics,
  appendUnitEconomics,
  compileUnitEconomics,
  dimensionValuesOf,
  isUnitEconomicsRecord,
} from '@arena/capability-economics';
import type {
  EconomicsAggregate,
  EconomicsDimension,
  EconomicsMetric,
  EconomicsTruth,
  UnitEconomicsRecord,
} from '@arena/capability-economics';
import { CapabilityEconomicsError } from '@arena/capability-economics';
import { CAPABILITY_ECONOMICS_ERROR_CODES } from '@arena/capability-economics';
import type { PaymentLedger } from '@arena/payments';
import type {
  CapabilityLiftValueSource,
  Clock,
  EconomicsPolicyStore,
  EconomicsRecordStore,
  EffortSignalSource,
  PaymentLedgerSource,
  RoutingDecisionSource,
  ValidationOutcomeSource,
} from './ports.js';
import type {
  CapabilityEconomicsJobStore,
  CapabilityEconomicsJobSubmissionOutcome,
} from './jobs.js';
import {
  CAPABILITY_ECONOMICS_JOB_MAX_ATTEMPTS,
  buildCapabilityEconomicsJob,
  capabilityEconomicsJobIdentity,
} from './jobs.js';
import {
  FixedClock,
  InMemoryCapabilityEconomicsJobStore,
  InMemoryCapabilityLiftValueSource,
  InMemoryEconomicsPolicyStore,
  InMemoryEconomicsRecordStore,
  InMemoryEffortSignalSource,
  InMemoryPaymentLedgerSource,
  InMemoryRoutingDecisionSource,
  InMemoryValidationOutcomeSource,
} from './fabric.js';

/** The typed outcome of one recomputation. */
export interface EconomicsRecomputeResult {
  readonly record: UnitEconomicsRecord;
  readonly outcome: 'appended' | 'replay';
}

/** The truth-scoped aggregate query (demo and customer never mix). */
export interface AggregateQuery {
  readonly dimension: EconomicsDimension;
  readonly metric: EconomicsMetric;
  /** The truth lens: demo economics or customer economics — never both. */
  readonly truth: EconomicsTruth;
  /** Restrict to one dimension value (all values when omitted). */
  readonly dimensionValue?: string;
}

export interface CapabilityEconomicsServiceConfig {
  readonly clock?: Clock;
  readonly ledgerSource?: PaymentLedgerSource;
  readonly validationSource?: ValidationOutcomeSource;
  readonly routingSource?: RoutingDecisionSource;
  readonly effortSource?: EffortSignalSource;
  readonly valueSource?: CapabilityLiftValueSource;
  readonly recordStore?: EconomicsRecordStore;
  readonly policyStore?: EconomicsPolicyStore;
  readonly jobStore?: CapabilityEconomicsJobStore;
}

export class CapabilityEconomicsService {
  readonly clock: Clock;
  readonly ledgerSource: PaymentLedgerSource;
  readonly validationSource: ValidationOutcomeSource;
  readonly routingSource: RoutingDecisionSource;
  readonly effortSource: EffortSignalSource;
  readonly valueSource: CapabilityLiftValueSource;
  readonly recordStore: EconomicsRecordStore;
  readonly policyStore: EconomicsPolicyStore;
  readonly jobStore: CapabilityEconomicsJobStore;

  constructor(config: CapabilityEconomicsServiceConfig = {}) {
    this.clock = config.clock ?? new FixedClock(0);
    this.ledgerSource = config.ledgerSource ?? new InMemoryPaymentLedgerSource();
    this.validationSource = config.validationSource ?? new InMemoryValidationOutcomeSource();
    this.routingSource = config.routingSource ?? new InMemoryRoutingDecisionSource();
    this.effortSource = config.effortSource ?? new InMemoryEffortSignalSource();
    this.valueSource = config.valueSource ?? new InMemoryCapabilityLiftValueSource();
    this.recordStore = config.recordStore ?? new InMemoryEconomicsRecordStore();
    this.policyStore = config.policyStore ?? new InMemoryEconomicsPolicyStore();
    this.jobStore = config.jobStore ?? new InMemoryCapabilityEconomicsJobStore();
  }

  // -------------------------------------------------------------------------
  // THE COMPUTE SEAM
  // -------------------------------------------------------------------------

  /**
   * Compute (compile + append) the unit economics of ONE intervention.
   *
   * THE NO-MONEY-TRUTH LAW: the C010 ledger is REQUIRED — when the
   * ledger source cannot produce it (missing, or a foreign-tenant
   * misconfiguration), the computation fails closed with the typed
   * LEDGER_BACKING_MISSING denial. A cost record fabricated without
   * C010 backing is unrepresentable.
   */
  async computeInterventionEconomics(
    requestId: string,
    tenantId: string,
    options: {
      /** The C015 demand id to join the routing decision of. */
      readonly demandId?: string;
      readonly correlationId?: string;
      /** Dimension context (capability id / domain lens). */
      readonly context?: { readonly capabilityId?: string; readonly domain?: string };
    } = {},
  ): Promise<EconomicsRecomputeResult> {
    let ledger: PaymentLedger | null;
    try {
      ledger = await this.ledgerSource.loadLedger(requestId, tenantId);
    } catch {
      // Fail-closed normalization: a broken C010 surface is the typed
      // LEDGER_BACKING_MISSING denial — never a silent skip into figures.
      ledger = null;
    }
    if (ledger === null) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.LEDGER_BACKING_MISSING, {
        message: `no C010 ledger backing for ${requestId} of tenant ${tenantId} — unit economics cannot be computed without commercial truth (fail-closed, never fabricated)`,
        details: { requestId, tenantId },
      });
    }
    // Defense in depth: a misconfigured host surface must never leak a
    // foreign tenant's commercial truth into this tenant's economics.
    if (ledger.tenantId !== tenantId) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `ledger ${requestId} belongs to tenant ${ledger.tenantId}, not ${tenantId} — cross-tenant economics computation denied`,
        details: { requestId, ledgerTenant: ledger.tenantId, requestedTenant: tenantId },
      });
    }

    // Optional inputs: absent sources are RECORDED as missing (closed
    // reasons on the record), never silently defaulted into figures.
    let validation;
    try {
      validation = await this.validationSource.loadValidationOutcome(requestId, tenantId);
    } catch {
      validation = null;
    }
    let routing;
    try {
      routing =
        options.demandId !== undefined
          ? await this.routingSource.loadRoutingDecision(options.demandId, tenantId)
          : null;
    } catch {
      routing = null;
    }
    let effort;
    try {
      effort = await this.effortSource.loadEffortSignals(requestId, tenantId);
    } catch {
      effort = null;
    }
    let value;
    try {
      value = await this.valueSource.loadValueRecord(requestId, tenantId);
    } catch {
      value = null;
    }

    const policy = await this.policyStore.current();
    const priorHistory = await this.recordStore.listByRequest(requestId, tenantId);
    const record = await compileUnitEconomics({
      ledger,
      correlationId: options.correlationId ?? `economics:${requestId}`,
      ...(validation !== null ? { validation } : {}),
      ...(routing !== null ? { routing } : {}),
      ...(effort !== null ? { effort } : {}),
      ...(value !== null && value !== undefined ? { value } : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
      policy,
      recordedAt: this.clock.now(),
    });
    const appended = await appendUnitEconomics(priorHistory, record);
    if (appended.outcome === 'appended') {
      await this.recordStore.append(record);
    }
    return { record: appended.record, outcome: appended.outcome };
  }

  // -------------------------------------------------------------------------
  // THE READ-MODEL SEAM
  // -------------------------------------------------------------------------

  /**
   * Read the dimensional aggregates of one tenant under one truth lens.
   * Demo and customer economics NEVER mix (the truth lens is required);
   * cross-tenant records in a misconfigured store are typed denials.
   */
  async readAggregate(query: AggregateQuery, tenantId: string): Promise<readonly EconomicsAggregate[]> {
    const records = await this.tenantRecordsForTruth(tenantId, query.truth);
    const { values } = dimensionValuesOf(records, query.dimension);
    const dimensionValues =
      query.dimensionValue !== undefined
        ? values.filter((value) => value === query.dimensionValue)
        : values;
    const aggregates: EconomicsAggregate[] = [];
    for (const dimensionValue of dimensionValues) {
      aggregates.push(
        await aggregateUnitEconomics(
          records,
          {
            dimension: query.dimension,
            metric: query.metric,
            policy: await this.policyStore.current(),
            generatedAt: this.clock.now(),
          },
          dimensionValue,
        ),
      );
    }
    return Object.freeze(aggregates);
  }

  /** The aggregate over ONE dimension value (null when the value is unseen). */
  async readAggregateValue(
    query: AggregateQuery,
    tenantId: string,
    dimensionValue: string,
  ): Promise<EconomicsAggregate | null> {
    const aggregates = await this.readAggregate({ ...query, dimensionValue }, tenantId);
    return aggregates[0] ?? null;
  }

  /** The append-only record history of one escalation (tenant-scoped). */
  async recordHistory(
    requestId: string,
    tenantId: string,
  ): Promise<readonly UnitEconomicsRecord[]> {
    const history = await this.recordStore.listByRequest(requestId, tenantId);
    for (const record of history) {
      if (!isUnitEconomicsRecord(record)) {
        throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.TAMPERED, {
          message: `record history of ${requestId} contains a structurally invalid record`,
        });
      }
      if (record.tenantId !== tenantId) {
        throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.CROSS_TENANT_ACCESS, {
          message: `record history of ${requestId} leaked a tenant-${record.tenantId} record into a tenant-${tenantId} read — cross-tenant economics read denied`,
        });
      }
    }
    return history;
  }

  // -------------------------------------------------------------------------
  // Durable recomputation jobs (A015 fabric semantics)
  // -------------------------------------------------------------------------

  /** Submit a durable recompute job (idempotent on the A015 submission identity). */
  async submitRecomputeJob(
    requestId: string,
    tenantId: string,
    options: {
      readonly idempotencyKey: string;
      readonly correlationId: string;
      readonly demandId?: string;
    },
  ): Promise<CapabilityEconomicsJobSubmissionOutcome> {
    const identity = capabilityEconomicsJobIdentity({
      tenantId,
      idempotencyKey: options.idempotencyKey,
      correlationId: options.correlationId,
    });
    const job = buildCapabilityEconomicsJob(
      identity,
      {
        requestId,
        tenantId,
        ...(options.demandId !== undefined ? { demandId: options.demandId } : {}),
      },
      this.clock.now(),
    );
    const existing = await this.jobStore.findBySubmissionKey(job.submissionKey);
    if (existing !== undefined) {
      return { outcome: 'replay', job: existing };
    }
    await this.jobStore.insert(job);
    return { outcome: 'queued', job };
  }

  /** Drain queued recompute jobs (deterministic; safe to re-run). */
  async drainRecomputeJobs(): Promise<{ completed: number; failed: number }> {
    let completed = 0;
    let failed = 0;
    for (const job of await this.jobStore.list()) {
      if (job.status !== 'queued') continue;
      const attempts = job.attempts + 1;
      try {
        const result = await this.computeInterventionEconomics(job.requestId, job.tenantId, {
          ...(job.demandId !== undefined ? { demandId: job.demandId } : {}),
        });
        await this.jobStore.update(
          Object.freeze({
            ...job,
            status: 'completed',
            attempts,
            economicsId: result.record.economicsId,
            outcome: result.outcome,
          }),
        );
        completed += 1;
      } catch (error) {
        const message =
          error instanceof CapabilityEconomicsError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        if (attempts >= CAPABILITY_ECONOMICS_JOB_MAX_ATTEMPTS) {
          await this.jobStore.update(
            Object.freeze({ ...job, status: 'failed', attempts, lastError: message }),
          );
          failed += 1;
        } else {
          await this.jobStore.update(Object.freeze({ ...job, attempts, lastError: message }));
        }
      }
    }
    return { completed, failed };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async tenantRecordsForTruth(
    tenantId: string,
    truth: EconomicsTruth,
  ): Promise<readonly UnitEconomicsRecord[]> {
    const all = await this.recordStore.listByTenant(tenantId);
    const scoped: UnitEconomicsRecord[] = [];
    for (const record of all) {
      if (!isUnitEconomicsRecord(record)) {
        throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.TAMPERED, {
          message: 'record store returned a structurally invalid unit-economics record',
        });
      }
      if (record.tenantId !== tenantId) {
        throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.CROSS_TENANT_ACCESS, {
          message: `record store leaked a tenant-${record.tenantId} record into a tenant-${tenantId} read — cross-tenant economics read denied`,
        });
      }
      // The truth lens: demo economics and customer economics are read
      // through SEPARATE lenses — demo money is never customer money.
      if (record.truth === truth) scoped.push(record);
    }
    return scoped;
  }
}
