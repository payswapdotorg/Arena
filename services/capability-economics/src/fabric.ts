/**
 * The reference fabric (Work Order C016) — deterministic in-memory
 * implementations of the capability-economics service ports, mirroring
 * services/capability-routing's fabric.ts. HOSTS NEVER SHIP THIS FILE
 * INTO PRODUCTION: they wire the real read surfaces (C010 ledger store,
 * C009 validation records, C015 routing decisions, C005/expert-session
 * effort signals) behind the ports; adapters live in adapters/*.
 */

import type { PaymentLedger } from '@arena/payments';
import {
  ARENA_REFERENCE_ECONOMICS_POLICY,
  isEconomicsPolicy,
  supersedeEconomicsPolicy,
} from '@arena/capability-economics';
import type {
  CapabilityLiftValueRecord,
  EconomicsPolicy,
  UnitEconomicsRecord,
} from '@arena/capability-economics';
import type {
  CapabilityLiftValueSource,
  Clock,
  EconomicsPolicyStore,
  EconomicsRecordStore,
  EffortSignalSource,
  EffortSignalView,
  PaymentLedgerSource,
  RoutingDecisionSource,
  RoutingDecisionView,
  ValidationOutcomeSource,
  ValidationOutcomeView,
} from './ports.js';
import type {
  CapabilityEconomicsJobRecord,
  CapabilityEconomicsJobStore,
} from './jobs.js';

/** A fixed clock (deterministic tests + demo replay). */
export class FixedClock implements Clock {
  private current: number;
  constructor(startAtMs: number) {
    this.current = startAtMs;
  }
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
}

/** In-memory C010 ledger source (tenant-scoped by construction). */
export class InMemoryPaymentLedgerSource implements PaymentLedgerSource {
  private readonly byRequest = new Map<string, PaymentLedger>();

  constructor(ledgers: readonly PaymentLedger[] = []) {
    for (const ledger of ledgers) this.byRequest.set(ledger.requestId, ledger);
  }

  async loadLedger(requestId: string, tenantId: string): Promise<PaymentLedger | null> {
    const ledger = this.byRequest.get(requestId);
    if (ledger === undefined) return null;
    // Defense in depth: a misconfigured host surface never leaks a foreign
    // tenant's commercial truth into an economics read.
    if (ledger.tenantId !== tenantId) return null;
    return ledger;
  }
}

/** In-memory C009 validation-outcome source. */
export class InMemoryValidationOutcomeSource implements ValidationOutcomeSource {
  private readonly byRequest = new Map<
    string,
    ValidationOutcomeView & { readonly tenantId: string; readonly requestId: string }
  >();

  constructor(
    entries: readonly (ValidationOutcomeView & {
      readonly tenantId: string;
      readonly requestId: string;
    })[] = [],
  ) {
    for (const entry of entries) {
      this.byRequest.set(`${entry.tenantId}:${entry.requestId}`, entry);
    }
  }

  async loadValidationOutcome(
    requestId: string,
    tenantId: string,
  ): Promise<ValidationOutcomeView | null> {
    const entry = this.byRequest.get(`${tenantId}:${requestId}`);
    return entry === undefined ? null : entry;
  }
}

/** In-memory C015 routing-decision source. */
export class InMemoryRoutingDecisionSource implements RoutingDecisionSource {
  private readonly byDemand = new Map<string, RoutingDecisionView & { readonly tenantId: string }>();

  constructor(entries: readonly (RoutingDecisionView & { readonly tenantId: string; readonly demandId: string })[] = []) {
    for (const entry of entries) this.byDemand.set(`${entry.tenantId}:${entry.demandId}`, entry);
  }

  async loadRoutingDecision(
    demandId: string,
    tenantId: string,
  ): Promise<RoutingDecisionView | null> {
    const entry = this.byDemand.get(`${tenantId}:${demandId}`);
    return entry === undefined ? null : entry;
  }
}

/** In-memory effort-signal source. */
export class InMemoryEffortSignalSource implements EffortSignalSource {
  private readonly byRequest = new Map<string, EffortSignalView>();

  constructor(entries: readonly (EffortSignalView & { readonly tenantId: string; readonly requestId: string })[] = []) {
    for (const entry of entries) this.byRequest.set(`${entry.tenantId}:${entry.requestId}`, entry);
  }

  async loadEffortSignals(
    requestId: string,
    tenantId: string,
  ): Promise<EffortSignalView | null> {
    const entry = this.byRequest.get(`${tenantId}:${requestId}`);
    return entry === undefined ? null : entry;
  }
}

/** In-memory Q1.0 value-record source. */
export class InMemoryCapabilityLiftValueSource implements CapabilityLiftValueSource {
  private readonly byRequest = new Map<string, CapabilityLiftValueRecord>();

  constructor(records: readonly CapabilityLiftValueRecord[] = []) {
    for (const record of records) this.byRequest.set(`${record.tenantId}:${record.requestId}`, record);
  }

  async loadValueRecord(
    requestId: string,
    tenantId: string,
  ): Promise<CapabilityLiftValueRecord | null> {
    const record = this.byRequest.get(`${tenantId}:${requestId}`);
    return record === undefined ? null : record;
  }
}

/** In-memory append-only unit-economics record store. */
export class InMemoryEconomicsRecordStore implements EconomicsRecordStore {
  private readonly records: UnitEconomicsRecord[] = [];

  async append(record: UnitEconomicsRecord): Promise<void> {
    this.records.push(record);
  }

  async listByRequest(requestId: string, tenantId: string): Promise<readonly UnitEconomicsRecord[]> {
    return this.records.filter(
      (record) => record.requestId === requestId && record.tenantId === tenantId,
    );
  }

  async listByTenant(tenantId: string): Promise<readonly UnitEconomicsRecord[]> {
    return this.records.filter((record) => record.tenantId === tenantId);
  }
}

/** In-memory versioned economics policy store (supersessions only). */
export class InMemoryEconomicsPolicyStore implements EconomicsPolicyStore {
  private currentPolicy: EconomicsPolicy = ARENA_REFERENCE_ECONOMICS_POLICY;

  constructor(initial?: EconomicsPolicy) {
    if (initial !== undefined) {
      if (!isEconomicsPolicy(initial)) {
        throw new TypeError('initial economics policy is not structurally valid');
      }
      this.currentPolicy = initial;
    }
  }

  async current(): Promise<EconomicsPolicy> {
    return this.currentPolicy;
  }

  async supersede(next: EconomicsPolicy): Promise<EconomicsPolicy> {
    this.currentPolicy = supersedeEconomicsPolicy(this.currentPolicy, next);
    return this.currentPolicy;
  }
}

/** In-memory durable recompute job store. */
export class InMemoryCapabilityEconomicsJobStore implements CapabilityEconomicsJobStore {
  private readonly jobs = new Map<string, CapabilityEconomicsJobRecord>();

  async insert(job: CapabilityEconomicsJobRecord): Promise<void> {
    if (this.jobs.has(job.submissionKey)) {
      throw new Error(`duplicate recompute job submission key: ${job.submissionKey}`);
    }
    this.jobs.set(job.submissionKey, job);
  }

  async findBySubmissionKey(
    submissionKey: string,
  ): Promise<CapabilityEconomicsJobRecord | undefined> {
    return this.jobs.get(submissionKey);
  }

  async list(): Promise<readonly CapabilityEconomicsJobRecord[]> {
    return [...this.jobs.values()];
  }

  async update(job: CapabilityEconomicsJobRecord): Promise<void> {
    this.jobs.set(job.submissionKey, job);
  }
}
