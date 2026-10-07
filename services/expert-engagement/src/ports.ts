/**
 * The injected PORTS of the expert-engagement reference service (Work
 * Order C011; spec/service-boundaries.md — mirrors services/payments'
 * ports.ts discipline).
 *
 * The service NEVER writes into another surface's state: every C001/C002/
 * C010 fact arrives by RESOLVING a dep record through the PUBLIC read
 * ports declared here. The ports are data-in seams — the real fabrics
 * implement them; tests inject fakes.
 *
 *   - EscalationLifecyclePort  — THE C001 SEAM. The escalation lifecycle
 *                 (states, urgency, deadline) is C001-owned semantics;
 *                 this service only consumes a READ snapshot and binds
 *                 engagement states to it through closed allowlists;
 *   - RoutingShortlistPort     — THE C002 SEAM. The routing verdict
 *                 (digest + shortlist) is C002-owned; an offer may only
 *                 be issued to an expert on a MATCHED verdict's
 *                 shortlist (never a silent off-shortlist offer);
 *   - CommercialOfferPort      — THE C010 SEAM. The commercial offer /
 *                 budget-hold records are C010-owned money truth; this
 *                 service resolves their opaque PUBLIC REFS only and
 *                 owns NO money truth (lock rule 33);
 *   - EngagementStore / AvailabilityDeclarationStore / SlaBreachStore —
 *                 persistence ports for THIS service's owned records;
 *   - SlaEvaluationJobPort     — THE A015 JOB-FABRIC SEAM. SLA clock
 *                 evaluation runs as a DURABLE IDEMPOTENT,
 *                 correlation-addressable job (lock rule 17) — the
 *                 reference fabric binds an in-memory idempotent job
 *                 registry; hosts wire the live job-orchestrator fabric.
 */

/** The C001 lifecycle READ snapshot the engagement operations bind to. */
export interface EscalationLifecycleSnapshot {
  readonly requestId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  /** The recorded C001 lifecycle state (facts, not judgements). */
  readonly state: string;
  /** The request's declared urgency (closed C001 vocabulary). */
  readonly urgency: string;
  /** The request's deadline (ms-precision UTC). */
  readonly deadline: string;
}

/** THE C001 SEAM — read-only escalation lifecycle access. */
export interface EscalationLifecyclePort {
  /** Tenant-scoped snapshot lookup (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationLifecycleSnapshot | undefined>;
}

/** The C002 routing-verdict READ view the offer path resolves. */
export interface RoutingVerdictSnapshot {
  /** The verdict's content digest (the offer's routing provenance ref). */
  readonly digest: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly outcome: string;
  /** The ranked shortlist expert ids (present on matched verdicts). */
  readonly shortlistExpertIds: readonly string[];
}

/** THE C002 SEAM — read-only routing verdict + shortlist access. */
export interface RoutingShortlistPort {
  /** Tenant-scoped verdict lookup (cross-tenant reads return undefined). */
  resolveVerdict(requestId: string, tenantId: string): Promise<RoutingVerdictSnapshot | undefined>;
}

/** The C010 commercial-binding READ view (opaque public refs ONLY). */
export interface CommercialBindingSnapshot {
  readonly requestId: string;
  readonly tenantId: string;
  /** The C010 commercial-offer record digest (this service owns NO money truth). */
  readonly commercialOfferRef: string;
  /** The C010 budget-hold record digest. */
  readonly budgetHoldRef: string;
}

/** THE C010 SEAM — read-only commercial offer/budget-hold ref resolution. */
export interface CommercialOfferPort {
  /** Tenant-scoped binding lookup (cross-tenant reads return undefined). */
  resolveCommercialBinding(
    requestId: string,
    tenantId: string,
  ): Promise<CommercialBindingSnapshot | undefined>;
}

/** Persistence port for engagement records (tenant-scoped lookups). */
export interface EngagementStore {
  /** Persist a NEW record; throws on duplicate engagement id. */
  insert(record: import('@arena/expert-engagement').EngagementRecord): Promise<void>;
  /** Replace the latest snapshot of an existing record (append-only at the transition level). */
  update(record: import('@arena/expert-engagement').EngagementRecord): Promise<void>;
  /** Tenant-scoped lookup (cross-tenant reads return undefined). */
  get(
    engagementId: string,
    tenantId: string,
  ): Promise<import('@arena/expert-engagement').EngagementRecord | undefined>;
  /**
   * INTERNAL unscoped lookup — used ONLY to produce the typed
   * cross-tenant failure on act paths. Never exposed on read surfaces.
   */
  findById(engagementId: string): Promise<import('@arena/expert-engagement').EngagementRecord | undefined>;
  /** All records of one (tenant, expert) — capacity recomputation scans. */
  listByExpert(tenantId: string, expertId: string): Promise<readonly import('@arena/expert-engagement').EngagementRecord[]>;
  /** Correlation-addressable path (lock rule 17). */
  findByCorrelationId(
    tenantId: string,
    correlationId: string,
  ): Promise<readonly import('@arena/expert-engagement').EngagementRecord[]>;
}

/** Persistence port for availability declarations. */
export interface AvailabilityDeclarationStore {
  /** Persist a NEW declaration; throws on duplicate declaration id. */
  insert(
    declaration: import('@arena/expert-engagement').AvailabilityDeclaration,
  ): Promise<void>;
  /** All declarations of one (tenant, expert) — current-version resolution. */
  listByExpert(
    tenantId: string,
    expertId: string,
  ): Promise<readonly import('@arena/expert-engagement').AvailabilityDeclaration[]>;
}

/** Persistence port for SLA breach records (append-only events). */
export interface SlaBreachStore {
  /** Append one breach record (idempotent by breachId + digest). */
  insert(record: import('@arena/expert-engagement').SlaBreachRecord): Promise<void>;
  /** Tenant-scoped breach lookup by engagement (cross-tenant reads return undefined). */
  listByEngagement(
    tenantId: string,
    engagementId: string,
  ): Promise<readonly import('@arena/expert-engagement').SlaBreachRecord[]>;
}

/** One durable SLA-evaluation job on the A015 fabric (idempotent). */
export interface SlaEvaluationJobRecord {
  readonly jobId: string;
  readonly engagementId: string;
  readonly tenantId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  /** 'enqueued' | 'completed' (the fabric's closed job lifecycle view). */
  readonly status: string;
  readonly enqueuedAt: string;
}

/**
 * THE A015 JOB-FABRIC SEAM — SLA clock evaluation as a durable idempotent
 * job: the same (idempotency key + body) REPLAYS the recorded job; a
 * different body under the same key is a typed conflict.
 */
export interface SlaEvaluationJobPort {
  /** Idempotent enqueue: returns the job (replayed=true when it already existed). */
  enqueue(
    job: Omit<SlaEvaluationJobRecord, 'status'>,
  ): Promise<{ readonly job: SlaEvaluationJobRecord; readonly replayed: boolean }>;
  /** Mark the job completed (no-op when already completed). */
  complete(jobId: string): Promise<void>;
  /** Job lookup by id. */
  get(jobId: string): Promise<SlaEvaluationJobRecord | undefined>;
}

/** The full injected port set of the reference service. */
export interface ExpertEngagementPorts {
  readonly escalation: EscalationLifecyclePort;
  readonly routing: RoutingShortlistPort;
  readonly commercial: CommercialOfferPort;
  readonly engagements: EngagementStore;
  readonly availability: AvailabilityDeclarationStore;
  readonly breaches: SlaBreachStore;
  readonly slaJobs: SlaEvaluationJobPort;
}
