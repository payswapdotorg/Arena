/**
 * Durable capability-economics recomputation jobs over the A015 fabric
 * semantics (Work Order C016) — the house pattern of
 * services/capability-routing / services/escalation-routing: a job
 * store keyed by the @arena/job-protocol submission identity (scope
 * `capability-economics-<tenant>` ⇒ tenant-isolated key spaces), an
 * explicit closed status vocabulary, bounded attempts, and a
 * deterministic drain. In-memory reference implementations live in
 * fabric.ts; hosts swap them for real persistence (adapters/*, never
 * here).
 */

import { jobSubmissionKey, toJobSubmissionIdentity } from '@arena/job-protocol';
import type { JobSubmissionIdentity } from '@arena/job-protocol';

/** Wire version of the capability-economics job record shape. */
export const CAPABILITY_ECONOMICS_JOB_VERSION = 1 as const;

export const CAPABILITY_ECONOMICS_JOB_STATUSES = Object.freeze([
  'queued',
  'completed',
  'failed',
] as const);
export type CapabilityEconomicsJobStatus = (typeof CAPABILITY_ECONOMICS_JOB_STATUSES)[number];

/** The idempotency scope prefix (A015 lock-rule-17 key space per tenant). */
export const CAPABILITY_ECONOMICS_JOB_IDEMPOTENCY_SCOPE_PREFIX = 'capability-economics';

/** Bounded attempts before a job is parked as failed (fail-closed). */
export const CAPABILITY_ECONOMICS_JOB_MAX_ATTEMPTS = 3;

/** One durable unit-economics recomputation job. */
export interface CapabilityEconomicsJobRecord {
  readonly jobVersion: typeof CAPABILITY_ECONOMICS_JOB_VERSION;
  /** The dedup key (jobSubmissionKey of the A015 identity). */
  readonly submissionKey: string;
  readonly identity: JobSubmissionIdentity;
  readonly requestId: string;
  readonly tenantId: string;
  /** The C015 demand id to join the routing decision of, when known. */
  readonly demandId?: string;
  readonly status: CapabilityEconomicsJobStatus;
  readonly enqueuedAt: number;
  readonly attempts: number;
  /** Present iff completed — the economics record id of the outcome. */
  readonly economicsId?: string;
  /** Present iff completed — appended vs idempotent replay. */
  readonly outcome?: 'appended' | 'replay';
  /** Present iff failed — the typed failure description. */
  readonly lastError?: string;
}

/** The outcome of submitting a recompute job (machine-readable). */
export type CapabilityEconomicsJobSubmissionOutcome =
  | { readonly outcome: 'queued'; readonly job: CapabilityEconomicsJobRecord }
  | { readonly outcome: 'replay'; readonly job: CapabilityEconomicsJobRecord };

/** The outcome of draining queued recompute jobs. */
export interface CapabilityEconomicsJobDrainResult {
  readonly completed: number;
  readonly failed: number;
}

/** Build the A015 submission identity for one recompute job. */
export function capabilityEconomicsJobIdentity(input: {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}): JobSubmissionIdentity {
  return toJobSubmissionIdentity({
    idempotencyScope: `${CAPABILITY_ECONOMICS_JOB_IDEMPOTENCY_SCOPE_PREFIX}-${input.tenantId}`,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
}

/** The durable job store port (in-memory reference impl in fabric.ts). */
export interface CapabilityEconomicsJobStore {
  /** Insert a queued job; throws on duplicate submission key. */
  insert(job: CapabilityEconomicsJobRecord): Promise<void>;
  /** Resolve an idempotent submission (A015 dedup path). */
  findBySubmissionKey(submissionKey: string): Promise<CapabilityEconomicsJobRecord | undefined>;
  /** All jobs in insertion order (drain + audit). */
  list(): Promise<readonly CapabilityEconomicsJobRecord[]>;
  /** Replace the latest snapshot of a job (append-only at the drain level). */
  update(job: CapabilityEconomicsJobRecord): Promise<void>;
}

/** Enqueue helper shared by the service and the fabric. */
export function buildCapabilityEconomicsJob(
  identity: JobSubmissionIdentity,
  input: {
    readonly requestId: string;
    readonly tenantId: string;
    readonly demandId?: string;
  },
  enqueuedAt: number,
): CapabilityEconomicsJobRecord {
  return Object.freeze({
    jobVersion: CAPABILITY_ECONOMICS_JOB_VERSION,
    submissionKey: jobSubmissionKey(identity),
    identity,
    requestId: input.requestId,
    tenantId: input.tenantId,
    ...(input.demandId !== undefined ? { demandId: input.demandId } : {}),
    status: 'queued',
    enqueuedAt,
    attempts: 0,
  });
}
