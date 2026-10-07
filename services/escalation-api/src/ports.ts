/**
 * Escalation API service ports (Work Order C001) — the ONLY things
 * services/escalation-api depends on besides the domain packages
 * (@arena/escalation, @arena/job-protocol, @arena/protocol-core).
 *
 * Mirroring services/job-orchestrator's ports.ts discipline:
 *   - Clock     — time is INJECTED (the service never reads a wall
 *                 clock; architecture-lock rule 17);
 *   - EscalationStore — persistence port for escalation records. The
 *                 idempotency dedup index rides the A015 job-protocol
 *                 submission identity (scope-qualified key spaces give
 *                 tenant isolation for free);
 *   - WebhookOutbox — the durable at-least-once delivery substrate the
 *                 adapters/escalation delivery adapter drains;
 *   - RoutingPort — THE C002 SEAM. C002 implements the capability-demand
 *                 compiler and expert routing; this service ships a
 *                 deterministic reference stub (round-robin over the
 *                 A007 qualified-expert read surface) that is clearly
 *                 labelled as a stub — the seam, not the semantics.
 *
 * Authority boundary (lock rule 16): the service OWNS lifecycle
 * orchestration and event emission; it NEVER judges domain outcomes
 * (validation verdicts arrive as recorded facts from callers).
 */

import type { Envelope } from '@arena/protocol-core';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import type { EscalationRecord } from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** Persistence port for escalation records (tenant-scoped lookups). */
export interface EscalationStore {
  /** Persist a NEW record; throws on duplicate request id or duplicate submission key. */
  insert(record: EscalationRecord): Promise<void>;
  /** Replace the latest snapshot of an existing record (append-only at the event level). */
  update(record: EscalationRecord): Promise<void>;
  /** Tenant-scoped lookup by escalation request id (cross-tenant reads return undefined). */
  get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined>;
  /**
   * INTERNAL unscoped lookup by request id — used ONLY to produce the
   * typed cross-tenant failure on lifecycle/act paths (the domain layer
   * enforces the tenant guard). Never exposed on read surfaces.
   */
  findById(requestId: string): Promise<EscalationRecord | undefined>;
  /** Resolve an idempotent submission (A015 lock-rule-17 dedup path). */
  findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<EscalationRecord | undefined>;
  /** Correlation-addressable path (lock rule 17). */
  findByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]>;
  /** All records (timeout sweeps / scans). */
  list(): Promise<readonly EscalationRecord[]>;
}

/** One durable webhook delivery attempt in the at-least-once outbox. */
export interface WebhookDeliveryRecord {
  /** eventId — the idempotent consumer key for dedupe on the consumer side. */
  readonly eventId: string;
  readonly requestId: string;
  readonly tenantId: string;
  readonly sequence: number;
  /** The serialized event envelope (canonical JSON wire form). */
  readonly payload: string;
  readonly createdAt: number;
  readonly deliveredAt: number | null;
}

/** Durable, at-least-once webhook outbox (drained by adapters/escalation). */
export interface WebhookOutbox {
  /** Append one event envelope; throws on duplicate eventId (dedupe). */
  append(event: EscalationWebhookEvent, envelope: Envelope<EscalationWebhookEvent>): Promise<void>;
  /** Pending (undelivered) deliveries in append order. */
  listPending(): Promise<readonly WebhookDeliveryRecord[]>;
  /** All deliveries (audit / tests). */
  listAll(): Promise<readonly WebhookDeliveryRecord[]>;
  /** Mark a delivery as delivered (idempotent). */
  markDelivered(eventId: string, at: number): Promise<void>;
}

/**
 * THE ROUTING SEAM (C002). The capability-demand compiler and expert
 * routing are C002's owned semantics; this service only consumes the
 * port. Reference stub: RoundRobinRoutingStub (clearly labelled).
 */
export interface RoutingPort {
  /**
   * Route one escalation request to a qualified expert. The verdict is
   * machine-readable (never a bare boolean): matched carries the expert
   * ref; no-match carries a closed-vocabulary reason.
   */
  route(request: EscalationRecord): Promise<RoutingDecision>;
}

export const ROUTING_NO_MATCH_REASONS = Object.freeze([
  'no-qualified-expert',
  'budget-below-floor',
  'locale-uncovered',
  'routing-unavailable',
] as const);
export type RoutingNoMatchReason = (typeof ROUTING_NO_MATCH_REASONS)[number];

export type RoutingDecision =
  | { readonly outcome: 'matched'; readonly expertRef: string }
  | { readonly outcome: 'no-match'; readonly reason: RoutingNoMatchReason };

/** Read-side view of a qualified expert (A007 qualification read surface). */
export interface QualifiedExpertView {
  readonly expertRef: string;
  /** Capability needs this expert is qualified for (A007 qualification records). */
  readonly qualifiedCapabilities: readonly string[];
  readonly locale: string;
}

/**
 * The A007 qualified-expert READ surface this service consumes (the
 * matching fabric itself lives in services/expert-matching, which a
 * service may never import — boundary rule B2; hosts wire it).
 */
export interface QualifiedExpertDirectory {
  listQualifiedExperts(tenantId: string): Promise<readonly QualifiedExpertView[]>;
}

/** Signing material port for webhook delivery (drained by the adapter). */
export interface WebhookEndpoint {
  readonly url: string;
  /** Per-endpoint signing material identifier (value supplied by the host). */
  readonly signingKeyId: string;
}
