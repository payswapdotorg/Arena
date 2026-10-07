/**
 * Durable routing jobs over the A015 fabric semantics (Work Order C002)
 * — the house pattern of services/escalation-api: a job store keyed by
 * the @arena/job-protocol submission identity (scope
 * `escalation-routing-<tenant>` ⇒ tenant-isolated key spaces), an
 * explicit closed status vocabulary, bounded attempts, and a
 * deterministic drain. In-memory reference implementations live in
 * fabric.ts; hosts swap them for real persistence (adapters/*, never
 * here).
 */

import { jobSubmissionKey, toJobSubmissionIdentity } from '@arena/job-protocol';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import type { EscalationRecord } from '@arena/escalation';
import type { RoutingDecision } from './ports.js';

/** Wire version of the routing-job record shape. */
export const ROUTING_JOB_VERSION = 1 as const;

export const ROUTING_JOB_STATUSES = Object.freeze([
  'queued',
  'completed',
  'failed',
] as const);
export type RoutingJobStatus = (typeof ROUTING_JOB_STATUSES)[number];

/** The idempotency scope prefix (A015 lock-rule-17 key space per tenant). */
export const ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX = 'escalation-routing';

/** Bounded attempts before a job is parked as failed (fail-closed). */
export const ROUTING_JOB_MAX_ATTEMPTS = 3;

/** One durable routing job. */
export interface RoutingJobRecord {
  readonly jobVersion: typeof ROUTING_JOB_VERSION;
  /** The dedup key (jobSubmissionKey of the A015 identity). */
  readonly submissionKey: string;
  readonly identity: JobSubmissionIdentity;
  readonly requestId: string;
  readonly tenantId: string;
  /** The escalation snapshot to route (frozen data — routed on drain). */
  readonly request: EscalationRecord;
  readonly status: RoutingJobStatus;
  readonly enqueuedAt: number;
  readonly attempts: number;
  /** Present iff completed — the port-compatible routing decision. */
  readonly decision?: RoutingDecision;
  /** Present iff failed — the typed failure code. */
  readonly lastError?: string;
}

/** The outcome of submitting a routing job (machine-readable). */
export type RoutingJobSubmissionOutcome =
  | { readonly outcome: 'queued'; readonly job: RoutingJobRecord }
  | { readonly outcome: 'replay'; readonly job: RoutingJobRecord };

/** The outcome of draining queued routing jobs. */
export interface RoutingJobDrainResult {
  readonly completed: number;
  readonly failed: number;
}

/** Build the A015 submission identity for one routing job. */
export function routingJobIdentity(input: {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): JobSubmissionIdentity {
  return toJobSubmissionIdentity({
    idempotencyScope: `${ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX}-${input.tenantId}`,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
}

/** The durable job store port (in-memory reference impl in fabric.ts). */
export interface RoutingJobStore {
  /** Insert a queued job; throws on duplicate submission key. */
  insert(job: RoutingJobRecord): Promise<void>;
  /** Resolve an idempotent submission (A015 dedup path). */
  findBySubmissionKey(submissionKey: string): Promise<RoutingJobRecord | undefined>;
  /** All jobs in insertion order (drain + audit). */
  list(): Promise<readonly RoutingJobRecord[]>;
  /** Replace the latest snapshot of a job (append-only at the drain level). */
  update(job: RoutingJobRecord): Promise<void>;
}

/** Enqueue helper shared by the service and the fabric. */
export function buildRoutingJob(
  identity: JobSubmissionIdentity,
  request: EscalationRecord,
  enqueuedAt: number,
): RoutingJobRecord {
  return Object.freeze({
    jobVersion: ROUTING_JOB_VERSION,
    submissionKey: jobSubmissionKey(identity),
    identity,
    requestId: request.request.requestId,
    tenantId: request.request.tenantId,
    request,
    status: 'queued',
    enqueuedAt,
    attempts: 0,
  });
}
