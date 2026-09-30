/**
 * The EPI1.0 asynchronous job envelope (Work Order A026;
 * spec/epoch-integration.md "Asynchronous contract").
 *
 * Every job uses: job id, correlation id, causation id, idempotency key,
 * artifact digest(s), authorization metadata, explicit lifecycle/status.
 *
 *  - job id            → jobId (lowercase UUIDv4)
 *  - correlation id    → submission.correlationId (A015 CorrelationId,
 *                        reused via @arena/job-protocol's JobSubmissionIdentity)
 *  - causation id      → causationId (EPI1.0-mandated; branded here — the
 *                        only in-repo definition, per the spec)
 *  - idempotency key   → submission.idempotencyKey under the fixed
 *                        'epoch' idempotency scope (A015 discipline:
 *                        same key + same request digest = idempotent hit,
 *                        different digest = conflict, never a silent rebind)
 *  - artifact digests  → artifactDigests (sorted, deduped sha256 set)
 *  - authorization     → the request's frozen authorization metadata
 *  - lifecycle/status  → queued → running → succeeded|failed|cancelled,
 *                        with terminal finality (terminal jobs are final).
 */

import { toJobSubmissionIdentity, jobSubmissionKey } from '@arena/job-protocol';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import { isIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isReleaseChannel } from '@arena/body-registry';
import type { ReleaseChannel } from '@arena/body-registry';
import { isEpochOutputRef, epochOutputRefKey } from './refs.js';
import type { EpochOutputRef } from './refs.js';
import { isEpochAuthorizationMetadata } from './request.js';
import type { EpochAuthorizationMetadata } from './request.js';
import { EPOCH_ADAPTER_ERROR_CODES, EpochAdapterError } from './errors.js';

export const EPOCH_JOB_VERSION = 1 as const;

export const EPOCH_JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const);

export type EpochJobStatus = (typeof EPOCH_JOB_STATUSES)[number];

export const EPOCH_JOB_TERMINAL_STATUSES = Object.freeze(
  ['succeeded', 'failed', 'cancelled'] as const,
);

export type EpochTerminalJobStatus = (typeof EPOCH_JOB_TERMINAL_STATUSES)[number];

export function isEpochJobStatus(value: unknown): value is EpochJobStatus {
  return (
    typeof value === 'string' &&
    (EPOCH_JOB_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalEpochJobStatus(status: EpochJobStatus): boolean {
  return (EPOCH_JOB_TERMINAL_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Causation id — EPI1.0-mandated, defined only here (branded)
// ---------------------------------------------------------------------------

const EPOCH_CAUSATION_BRAND = '__epochCausationId';

/** The id of the exchange that CAUSED this job (EPI1.0 async contract). */
export type CausationId = string & { readonly [EPOCH_CAUSATION_BRAND]: 'CausationId' };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isCausationId(value: unknown): value is CausationId {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

export function toCausationId(value: string): CausationId {
  if (!isCausationId(value)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `invalid causation id: ${JSON.stringify(value)}`,
      details: { pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' },
    });
  }
  return value as CausationId;
}

// ---------------------------------------------------------------------------
// The job record
// ---------------------------------------------------------------------------

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface EpochJobFailure {
  readonly code: string;
  readonly message: string;
}

export interface EpochJobRecord {
  readonly jobVersion: typeof EPOCH_JOB_VERSION;
  readonly jobId: string;
  readonly submission: JobSubmissionIdentity;
  readonly causationId: CausationId;
  readonly requestDigest: string;
  readonly authorization: EpochAuthorizationMetadata;
  readonly targetReleaseChannel: ReleaseChannel;
  readonly status: EpochJobStatus;
  readonly submittedAt: string;
  readonly updatedAt: string;
  readonly artifactDigests: readonly string[];
  readonly outputs: readonly EpochOutputRef[];
  readonly caseRef: EpochOutputRef | null;
  readonly failure: EpochJobFailure | null;
}

export function isEpochJob(value: unknown): value is EpochJobRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['jobVersion'] === EPOCH_JOB_VERSION &&
    typeof candidate['jobId'] === 'string' &&
    JOB_ID_PATTERN.test(candidate['jobId']) &&
    typeof candidate['submission'] === 'object' &&
    candidate['submission'] !== null &&
    typeof (candidate['submission'] as Record<string, unknown>)['idempotencyKey'] ===
      'string' &&
    isIdempotencyKey(
      (candidate['submission'] as Record<string, unknown>)['idempotencyKey'],
    ) &&
    typeof candidate['causationId'] === 'string' &&
    isCausationId(candidate['causationId']) &&
    typeof candidate['requestDigest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['requestDigest']) &&
    isEpochAuthorizationMetadata(candidate['authorization']) &&
    typeof candidate['targetReleaseChannel'] === 'string' &&
    isReleaseChannel(candidate['targetReleaseChannel']) &&
    isEpochJobStatus(candidate['status']) &&
    typeof candidate['submittedAt'] === 'string' &&
    typeof candidate['updatedAt'] === 'string' &&
    Array.isArray(candidate['artifactDigests']) &&
    (candidate['artifactDigests'] as unknown[]).every(
      (digest) => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest),
    ) &&
    Array.isArray(candidate['outputs']) &&
    (candidate['outputs'] as unknown[]).every((ref) => isEpochOutputRef(ref)) &&
    (candidate['caseRef'] === null || isEpochOutputRef(candidate['caseRef'])) &&
    (candidate['failure'] === null ||
      (typeof candidate['failure'] === 'object' &&
        candidate['failure'] !== null &&
        typeof (candidate['failure'] as Record<string, unknown>)['code'] === 'string'))
  );
}

export interface MakeEpochJobInput {
  readonly jobId: string;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
  readonly causationId: CausationId;
  readonly requestDigest: string;
  readonly authorization: EpochAuthorizationMetadata;
  readonly targetReleaseChannel: ReleaseChannel;
  readonly caseRef: EpochOutputRef;
  readonly submittedAt: string;
}

const EPOCH_IDEMPOTENCY_SCOPE = 'epoch';

/** Construct (and validate) a queued job record; deep-frozen on return. */
export function makeEpochJob(input: MakeEpochJobInput): EpochJobRecord {
  if (typeof input.jobId !== 'string' || !JOB_ID_PATTERN.test(input.jobId)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'epoch job id must be a lowercase UUIDv4',
      details: { field: 'jobId' },
    });
  }
  const submission = toJobSubmissionIdentity({
    idempotencyScope: EPOCH_IDEMPOTENCY_SCOPE,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
  if (typeof input.requestDigest !== 'string' || !/^[0-9a-f]{64}$/.test(input.requestDigest)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'epoch job requestDigest must be a sha256 content digest',
      details: { field: 'requestDigest' },
    });
  }
  if (!isEpochAuthorizationMetadata(input.authorization)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_AUTHORIZATION, {
      message: 'epoch job requires valid authorization metadata',
      details: { field: 'authorization' },
    });
  }
  if (!isReleaseChannel(input.targetReleaseChannel)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'epoch job requires an A024 release channel',
      details: { field: 'targetReleaseChannel' },
    });
  }
  if (!isEpochOutputRef(input.caseRef)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REF, {
      message: 'epoch job requires a valid capability-case output ref',
      details: { field: 'caseRef' },
    });
  }
  const record: EpochJobRecord = {
    jobVersion: EPOCH_JOB_VERSION,
    jobId: input.jobId,
    submission,
    causationId: input.causationId,
    requestDigest: input.requestDigest,
    authorization: input.authorization,
    targetReleaseChannel: input.targetReleaseChannel,
    status: 'queued',
    submittedAt: input.submittedAt,
    updatedAt: input.submittedAt,
    artifactDigests: Object.freeze([input.caseRef.digest]),
    outputs: Object.freeze([input.caseRef]),
    caseRef: input.caseRef,
    failure: null,
  };
  return Object.freeze(record);
}

const LEGAL_TRANSITIONS: Readonly<Record<EpochJobStatus, readonly EpochJobStatus[]>> =
  Object.freeze({
    queued: Object.freeze(['running', 'cancelled'] as const),
    running: Object.freeze(['succeeded', 'failed', 'cancelled'] as const),
    succeeded: Object.freeze([] as const),
    failed: Object.freeze([] as const),
    cancelled: Object.freeze([] as const),
  });

/**
 * Return the job advanced to `next` (immutable copy). Terminal jobs are
 * FINAL: any further transition throws (append-only finality, mirroring
 * the A015 JobRecord discipline).
 */
export function transitionEpochJob(
  job: EpochJobRecord,
  next: EpochJobStatus,
  options: {
    readonly outputs?: readonly EpochOutputRef[];
    readonly artifactDigests?: readonly string[];
    readonly failure?: EpochJobFailure;
    readonly updatedAt: string;
  },
): EpochJobRecord {
  if (!isEpochJobStatus(next)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `unknown epoch job status: ${JSON.stringify(next)}`,
      details: { supported: EPOCH_JOB_STATUSES },
    });
  }
  if (isTerminalEpochJobStatus(job.status)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.JOB_TERMINAL, {
      message: `epoch job ${job.jobId} is terminal (${job.status}); terminal states are final`,
      details: { jobId: job.jobId, status: job.status },
    });
  }
  const legal = LEGAL_TRANSITIONS[job.status];
  if (!legal.includes(next)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_LIFECYCLE, {
      message: `epoch job ${job.jobId} cannot transition ${job.status} → ${next}`,
      details: { jobId: job.jobId, from: job.status, to: next, legal },
    });
  }
  const record: EpochJobRecord = {
    ...job,
    status: next,
    updatedAt: options.updatedAt,
    ...(options.outputs !== undefined ? { outputs: options.outputs } : {}),
    ...(options.artifactDigests !== undefined
      ? { artifactDigests: options.artifactDigests }
      : {}),
    ...(options.failure !== undefined ? { failure: options.failure } : {}),
  };
  return Object.freeze(record);
}

/** Stable identity key for a job's submission (A015 composite key). */
export function epochJobSubmissionKey(job: EpochJobRecord): string {
  return jobSubmissionKey(job.submission);
}

/** Dedupe + sort the artifact digest set of a job (deterministic). */
export function normalizeArtifactDigests(
  digests: readonly string[],
): readonly string[] {
  return Object.freeze([...new Set(digests)].sort());
}

/** True iff two output refs claim the same digest under different kinds. */
export function hasCrossKindDigestCollision(refs: readonly EpochOutputRef[]): boolean {
  const byDigest = new Map<string, string>();
  for (const ref of refs) {
    const existing = byDigest.get(ref.digest);
    if (existing !== undefined && existing !== ref.kind) return true;
    byDigest.set(ref.digest, ref.kind);
  }
  return false;
}

/** Distinct ref keys of a list (identity = kind + digest). */
export function epochOutputRefKeys(refs: readonly EpochOutputRef[]): readonly string[] {
  return Object.freeze(refs.map((ref) => epochOutputRefKey(ref)));
}
