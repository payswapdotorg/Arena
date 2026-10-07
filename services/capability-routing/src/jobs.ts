/**
 * Durable capability-routing jobs over the A015 fabric semantics
 * (Work Order C015) — the house pattern of services/escalation-routing
 * / services/escalation-api: a job store keyed by the
 * @arena/job-protocol submission identity (scope
 * `capability-routing-<tenant>` ⇒ tenant-isolated key spaces), an
 * explicit closed status vocabulary, bounded attempts, and a
 * deterministic drain. In-memory reference implementations live in
 * fabric.ts; hosts swap them for real persistence (adapters/*, never
 * here).
 */

import { jobSubmissionKey, toJobSubmissionIdentity } from '@arena/job-protocol';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import type { CrossResourceDemandInput } from '@arena/capability-routing';
import type { CapabilityRoutingDecision } from './ports.js';

/** Wire version of the capability-routing job record shape. */
export const CAPABILITY_ROUTING_JOB_VERSION = 1 as const;

export const CAPABILITY_ROUTING_JOB_STATUSES = Object.freeze([
  'queued',
  'completed',
  'failed',
] as const);
export type CapabilityRoutingJobStatus = (typeof CAPABILITY_ROUTING_JOB_STATUSES)[number];

/** The idempotency scope prefix (A015 lock-rule-17 key space per tenant). */
export const CAPABILITY_ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX = 'capability-routing';

/** Bounded attempts before a job is parked as failed (fail-closed). */
export const CAPABILITY_ROUTING_JOB_MAX_ATTEMPTS = 3;

/** One durable cross-resource routing job. */
export interface CapabilityRoutingJobRecord {
  readonly jobVersion: typeof CAPABILITY_ROUTING_JOB_VERSION;
  /** The dedup key (jobSubmissionKey of the A015 identity). */
  readonly submissionKey: string;
  readonly identity: JobSubmissionIdentity;
  readonly demandId: string;
  readonly tenantId: string;
  /** The demand snapshot to route (frozen data — routed on drain). */
  readonly demand: CrossResourceDemandInput;
  readonly status: CapabilityRoutingJobStatus;
  readonly enqueuedAt: number;
  readonly attempts: number;
  /** Present iff completed — the seam-compatible routing decision. */
  readonly decision?: CapabilityRoutingDecision;
  /** Present iff failed — the typed failure description. */
  readonly lastError?: string;
}

/** The outcome of submitting a routing job (machine-readable). */
export type CapabilityRoutingJobSubmissionOutcome =
  | { readonly outcome: 'queued'; readonly job: CapabilityRoutingJobRecord }
  | { readonly outcome: 'replay'; readonly job: CapabilityRoutingJobRecord };

/** The outcome of draining queued routing jobs. */
export interface CapabilityRoutingJobDrainResult {
  readonly completed: number;
  readonly failed: number;
}

/** Build the A015 submission identity for one routing job. */
export function capabilityRoutingJobIdentity(input: {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): JobSubmissionIdentity {
  return toJobSubmissionIdentity({
    idempotencyScope: `${CAPABILITY_ROUTING_JOB_IDEMPOTENCY_SCOPE_PREFIX}-${input.tenantId}`,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
}

/** The durable job store port (in-memory reference impl in fabric.ts). */
export interface CapabilityRoutingJobStore {
  /** Insert a queued job; throws on duplicate submission key. */
  insert(job: CapabilityRoutingJobRecord): Promise<void>;
  /** Resolve an idempotent submission (A015 dedup path). */
  findBySubmissionKey(submissionKey: string): Promise<CapabilityRoutingJobRecord | undefined>;
  /** All jobs in insertion order (drain + audit). */
  list(): Promise<readonly CapabilityRoutingJobRecord[]>;
  /** Replace the latest snapshot of a job (append-only at the drain level). */
  update(job: CapabilityRoutingJobRecord): Promise<void>;
}

/** Enqueue helper shared by the service and the fabric. */
export function buildCapabilityRoutingJob(
  identity: JobSubmissionIdentity,
  input: {
    readonly demandId: string;
    readonly tenantId: string;
    readonly demand: CrossResourceDemandInput;
  },
  enqueuedAt: number,
): CapabilityRoutingJobRecord {
  return Object.freeze({
    jobVersion: CAPABILITY_ROUTING_JOB_VERSION,
    submissionKey: jobSubmissionKey(identity),
    identity,
    demandId: input.demandId,
    tenantId: input.tenantId,
    demand: Object.freeze({ ...input.demand }) as CrossResourceDemandInput,
    status: 'queued',
    enqueuedAt,
    attempts: 0,
  });
}
