/**
 * The structural service surfaces the host composes (Work Order P002;
 * issue #154; ADR-P001-07 — the host is the single composition root).
 *
 * `EscalationLifecycleSurface` mirrors the C001 escalation API service's
 * public surface (services/escalation-api/src/service.ts) and
 * `JobRunnerSurface` mirrors the A015 job orchestrator's public surface
 * (services/job-orchestrator/src/orchestrator.ts) — as STRUCTURAL
 * interfaces, because a domain package may never import a service
 * (boundary law B4: dependencies flow downward only). The REAL classes
 * satisfy these interfaces structurally at the composition site
 * (deploy/runtime wiring); the parity is pinned by tests/runtime-host
 * against the real classes.
 *
 * This is the frozen seam P003 binds transport onto: the host exposes
 * these surfaces (tenant-gated) and P003's HTTP/MCP/webhook listeners
 * call through them.
 */

import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import type {
  JobDefinition,
  JobRecord,
  PrincipalRef,
} from '@arena/job-protocol';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationResponse,
  EscalationState,
  TransitionContext,
} from '@arena/escalation';
import type { TruthLens } from './lens.js';

// ---------------------------------------------------------------------------
// Escalation lifecycle surface (C001 mirror)
// ---------------------------------------------------------------------------

/** The outcome of POST /v1/escalations (machine-readable tri-state). */
export interface EscalationCreateOutcome {
  readonly outcome: 'created' | 'replay';
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly record: EscalationRecord;
  /** The events appended to the durable outbox by this call. */
  readonly emittedEvents: readonly unknown[];
  /** The serialized escalation-response envelope (the wire form). */
  readonly serializedResponse: string;
  readonly response: Envelope<EscalationResponse>;
}

/** A recorded expert action verdict (machine-readable, never a bare boolean). */
export interface ExpertActionRecordJson {
  readonly requestId: string;
  readonly action: string;
  readonly allowed: true;
  readonly recordedAt: number;
}

/** One entry in the append-only expert action log (attempts included). */
export interface ExpertActionLogEntryJson {
  readonly requestId: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly recordedAt: number;
}

/**
 * The C001 escalation API service's public surface, structurally
 * mirrored. The host mounts exactly this surface (tenant-gated) for
 * P003's transports.
 */
export interface EscalationLifecycleSurface {
  /** Create an escalation (idempotent on the submission identity). */
  createEscalation(input: CreateEscalationRequestInput): Promise<EscalationCreateOutcome>;
  /** Idempotent, tenant-scoped status polling. */
  getEscalationStatus(params: {
    requestId: string;
    tenantId: string;
  }): Promise<{ record: EscalationRecord; response: Envelope<EscalationResponse>; serializedResponse: string }>;
  /** Correlation-addressable listing (lock rule 17). */
  listByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]>;
  /** Apply one guarded lifecycle transition by request id (tenant-scoped). */
  advanceLifecycle(
    requestId: string,
    tenantId: string,
    to: EscalationState,
    context?: Omit<TransitionContext, 'now' | 'tenantId'>,
  ): Promise<EscalationRecord>;
  /** Timeout sweep (deterministic from the injected clock; safe to re-run). */
  sweepTimeouts(): Promise<readonly EscalationRecord[]>;
  /** Record an expert action against the closed permitted-actions vocabulary. */
  recordExpertAction(
    requestId: string,
    tenantId: string,
    action: string,
  ): Promise<ExpertActionRecordJson>;
  /** The recorded action log for one escalation (audit surface). */
  actionLog(requestId: string): readonly ExpertActionLogEntryJson[];
}

// ---------------------------------------------------------------------------
// Shared durable job runner surface (A015 orchestrator mirror)
// ---------------------------------------------------------------------------

/** Submit-input shape (mirrors the orchestrator's SubmitJobInput). */
export interface SubmitJobInputJson {
  readonly definition: JobDefinition;
  readonly input: unknown;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly jobId?: string;
  readonly actor: PrincipalRef | { type: string; tenant: string; principalId: string };
}

/** Mutation-input shape (mirrors the orchestrator's JobMutationInput). */
export interface JobMutationInputJson {
  readonly jobId: string;
  readonly actor: PrincipalRef | { type: string; tenant: string; principalId: string };
}

/**
 * The A015 job orchestrator's public surface, structurally mirrored.
 * This is the ONE shared durable job runner the host composes
 * (ADR-P001-01): every registered job kind executes through it.
 */
export interface JobRunnerSurface {
  /** Addressability path 1: look a job up by job id. */
  get(jobId: string): Promise<JobRecord | undefined>;
  /** Addressability path 2: look jobs up by correlation id. */
  findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]>;
  /** Jobs whose retry backoff has elapsed (pure query). */
  retryDue(): Promise<readonly JobRecord[]>;
  /** Submit a job (idempotent on the submission identity). */
  submit(input: SubmitJobInputJson): Promise<JobRecord>;
  /** Claim (start the next attempt of) a queued job: queued → running. */
  claim(input: JobMutationInputJson): Promise<JobRecord>;
  /** Report progress on a running job. */
  progress(input: JobMutationInputJson & {
    readonly percent?: number;
    readonly note?: string;
  }): Promise<JobRecord>;
  /** Complete a running job (the result is recorded VERBATIM). */
  complete(input: JobMutationInputJson & { readonly result: unknown }): Promise<JobRecord>;
  /** Fail the current attempt; the retry policy decides requeue vs terminal. */
  fail(input: JobMutationInputJson & {
    readonly errorClass: string;
    readonly message: string;
  }): Promise<JobRecord>;
  /** Cancel a queued or running job (terminal, final). */
  cancel(input: JobMutationInputJson & { readonly reason: string }): Promise<JobRecord>;
  /** Timeout sweep (marks overdue running jobs; requeue vs terminal by policy). */
  timeoutDue(): Promise<readonly JobRecord[]>;
}

// ---------------------------------------------------------------------------
// The mounted host surface (what P003 binds transport onto)
// ---------------------------------------------------------------------------

/** The lens-stamped read view the host serves for status polling. */
export interface LensStampedStatus {
  readonly record: EscalationRecord;
  readonly response: Envelope<EscalationResponse>;
  readonly serializedResponse: string;
  /** The truth lens the record was persisted under (ADR-P001-02). */
  readonly lens: TruthLens;
}

/**
 * The tenant-gated escalation surface the host serves. Every operation
 * carries the caller's tenant id; the host resolves the truth lens from
 * the tenant and fails closed on cross-lens reads. This is the surface
 * P003's HTTP/MCP/webhook transports bind onto (ADR-P001-07 §4).
 */
export interface HostEscalationsSurface {
  /** POST /v1/escalations (tenant-gated). */
  create(tenantId: string, input: CreateEscalationRequestInput): Promise<EscalationCreateOutcome>;
  /** GET /v1/escalations/{request_id} (tenant-gated, lens-stamped). */
  status(tenantId: string, requestId: string): Promise<LensStampedStatus>;
  /** Correlation-addressable listing (tenant-gated). */
  listByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]>;
  /** Guarded lifecycle transition (tenant-gated). */
  advance(
    tenantId: string,
    requestId: string,
    to: EscalationState,
    context?: Omit<TransitionContext, 'now' | 'tenantId'>,
  ): Promise<EscalationRecord>;
}
