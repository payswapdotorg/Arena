/**
 * Fakes for the injected ports (Work Order C011 test support — the
 * services/expert-performance test-support convention).
 *
 * Each fake owns an in-memory store and answers a lookup ONLY when the
 * record exists AND belongs to the requested tenant — mirroring the
 * tenant isolation the real C001/C002/C010 read surfaces enforce.
 */

import type {
  AvailabilityDeclaration,
  EngagementRecord,
  SlaBreachRecord,
} from '@arena/expert-engagement';
import type {
  AvailabilityDeclarationStore,
  CommercialOfferPort,
  EngagementStore,
  EscalationLifecyclePort,
  ExpertEngagementPorts,
  RoutingShortlistPort,
  SlaBreachStore,
  SlaEvaluationJobPort,
  SlaEvaluationJobRecord,
} from './ports.js';
import type {
  CommercialBindingSnapshot,
  EscalationLifecycleSnapshot,
  RoutingVerdictSnapshot,
} from './ports.js';

/** The C001 fake: escalation lifecycle snapshots keyed by request id. */
export class InMemoryEscalationLifecycle implements EscalationLifecyclePort {
  private readonly store = new Map<string, EscalationLifecycleSnapshot>();

  add(snapshot: EscalationLifecycleSnapshot): this {
    this.store.set(`${snapshot.tenantId}/${snapshot.requestId}`, snapshot);
    return this;
  }

  setState(tenantId: string, requestId: string, state: string): this {
    const key = `${tenantId}/${requestId}`;
    const existing = this.store.get(key);
    if (existing === undefined) throw new Error(`no escalation ${key}`);
    this.store.set(key, { ...existing, state });
    return this;
  }

  async get(
    requestId: string,
    tenantId: string,
  ): Promise<EscalationLifecycleSnapshot | undefined> {
    return this.store.get(`${tenantId}/${requestId}`);
  }
}

/** The C002 fake: routing verdicts keyed by request id. */
export class InMemoryRoutingShortlist implements RoutingShortlistPort {
  private readonly store = new Map<string, RoutingVerdictSnapshot>();

  add(verdict: RoutingVerdictSnapshot): this {
    this.store.set(`${verdict.tenantId}/${verdict.requestId}`, verdict);
    return this;
  }

  async resolveVerdict(
    requestId: string,
    tenantId: string,
  ): Promise<RoutingVerdictSnapshot | undefined> {
    return this.store.get(`${tenantId}/${requestId}`);
  }
}

/** The C010 fake: commercial bindings keyed by request id. */
export class InMemoryCommercialOffers implements CommercialOfferPort {
  private readonly store = new Map<string, CommercialBindingSnapshot>();

  add(binding: CommercialBindingSnapshot): this {
    this.store.set(`${binding.tenantId}/${binding.requestId}`, binding);
    return this;
  }

  async resolveCommercialBinding(
    requestId: string,
    tenantId: string,
  ): Promise<CommercialBindingSnapshot | undefined> {
    return this.store.get(`${tenantId}/${requestId}`);
  }
}

/** The engagement-store fake (tenant-scoped lookups). */
export class InMemoryEngagementStore implements EngagementStore {
  private readonly store = new Map<string, EngagementRecord>();

  async insert(record: EngagementRecord): Promise<void> {
    if (this.store.has(record.engagementId)) {
      throw new Error(`duplicate engagement id ${record.engagementId}`);
    }
    this.store.set(record.engagementId, record);
  }

  async update(record: EngagementRecord): Promise<void> {
    if (!this.store.has(record.engagementId)) {
      throw new Error(`unknown engagement id ${record.engagementId}`);
    }
    this.store.set(record.engagementId, record);
  }

  async get(
    engagementId: string,
    tenantId: string,
  ): Promise<EngagementRecord | undefined> {
    const record = this.store.get(engagementId);
    if (record === undefined || record.tenant !== tenantId) return undefined;
    return record;
  }

  async findById(engagementId: string): Promise<EngagementRecord | undefined> {
    return this.store.get(engagementId);
  }

  async listByExpert(
    tenantId: string,
    expertId: string,
  ): Promise<readonly EngagementRecord[]> {
    return [...this.store.values()].filter(
      (record) => record.tenant === tenantId && record.expertId === expertId,
    );
  }

  async findByCorrelationId(
    tenantId: string,
    correlationId: string,
  ): Promise<readonly EngagementRecord[]> {
    return [...this.store.values()].filter(
      (record) => record.tenant === tenantId && record.correlationId === correlationId,
    );
  }
}

/** The availability-declaration-store fake. */
export class InMemoryAvailabilityDeclarationStore implements AvailabilityDeclarationStore {
  private readonly store = new Map<string, AvailabilityDeclaration>();

  async insert(declaration: AvailabilityDeclaration): Promise<void> {
    if (this.store.has(declaration.declarationId)) {
      throw new Error(`duplicate declaration id ${declaration.declarationId}`);
    }
    this.store.set(declaration.declarationId, declaration);
  }

  async listByExpert(
    tenantId: string,
    expertId: string,
  ): Promise<readonly AvailabilityDeclaration[]> {
    return [...this.store.values()].filter(
      (declaration) => declaration.tenant === tenantId && declaration.expertId === expertId,
    );
  }
}

/** The breach-store fake (append-only; idempotent by breachId + digest). */
export class InMemorySlaBreachStore implements SlaBreachStore {
  private readonly store = new Map<string, SlaBreachRecord>();

  async insert(record: SlaBreachRecord): Promise<void> {
    const existing = this.store.get(record.breachId);
    if (existing !== undefined) {
      if (existing.digest !== record.digest) {
        throw new Error(`breach id ${record.breachId} already bound to a different record`);
      }
      return;
    }
    this.store.set(record.breachId, record);
  }

  async listByEngagement(
    tenantId: string,
    engagementId: string,
  ): Promise<readonly SlaBreachRecord[]> {
    return [...this.store.values()].filter(
      (record) => record.tenant === tenantId && record.engagementId === engagementId,
    );
  }
}

/** The A015 job-fabric fake: idempotent SLA-evaluation jobs. */
export class InMemorySlaEvaluationJobs implements SlaEvaluationJobPort {
  private readonly store = new Map<string, SlaEvaluationJobRecord>();
  private readonly bindings = new Map<string, string>();

  async enqueue(
    job: Omit<SlaEvaluationJobRecord, 'status'>,
  ): Promise<{ readonly job: SlaEvaluationJobRecord; readonly replayed: boolean }> {
    const existing = this.store.get(job.jobId);
    if (existing !== undefined) {
      if (existing.idempotencyKey !== job.idempotencyKey) {
        throw new Error(`job id ${job.jobId} already bound to a different idempotency key`);
      }
      return { job: existing, replayed: true };
    }
    const bound = this.bindings.get(job.idempotencyKey);
    if (bound !== undefined) {
      const prior = this.store.get(bound);
      if (prior !== undefined) {
        return { job: prior, replayed: true };
      }
    }
    const record: SlaEvaluationJobRecord = { ...job, status: 'enqueued' };
    this.store.set(job.jobId, record);
    this.bindings.set(job.idempotencyKey, job.jobId);
    return { job: record, replayed: false };
  }

  async complete(jobId: string): Promise<void> {
    const job = this.store.get(jobId);
    if (job === undefined) throw new Error(`unknown job id ${jobId}`);
    if (job.status !== 'completed') {
      this.store.set(jobId, { ...job, status: 'completed' });
    }
  }

  async get(jobId: string): Promise<SlaEvaluationJobRecord | undefined> {
    return this.store.get(jobId);
  }
}

/** Assemble the full in-memory reference port set. */
export function createInMemoryPorts(): ExpertEngagementPorts {
  return {
    escalation: new InMemoryEscalationLifecycle(),
    routing: new InMemoryRoutingShortlist(),
    commercial: new InMemoryCommercialOffers(),
    engagements: new InMemoryEngagementStore(),
    availability: new InMemoryAvailabilityDeclarationStore(),
    breaches: new InMemorySlaBreachStore(),
    slaJobs: new InMemorySlaEvaluationJobs(),
  };
}

/** A deterministic sha256-shaped hex digest for fixtures. */
export function fakeDigest(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  let hex = '';
  while (hex.length < 64) {
    hash = (hash * 16777619) >>> 0;
    hex += hash.toString(16).padStart(8, '0');
  }
  return hex.slice(0, 64);
}
