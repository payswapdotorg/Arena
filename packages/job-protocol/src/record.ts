/**
 * JobRecord — the append-only lifecycle state of one job
 * (Work Order A015 gate 3/4/6; architecture-lock rules 17 and 16).
 *
 * Lifecycle is STRICTLY append-only and terminal-final:
 *   queued → running → succeeded | failed | cancelled
 *   (a failed attempt whose retry policy has budget left RE-QUEUES the job
 *   with a backoff-gated `nextRetryAt`; retries never skip the queue).
 *
 *   - every transition is a PURE function returning a NEW frozen record
 *     (the input record is never modified) and appends exactly one
 *     JobEvent to the embedded history (never rewritten, queryable,
 *     deep-frozen);
 *   - terminal states are FINAL: every lifecycle operation on a terminal
 *     record throws JOB_TERMINAL_STATE, and because records are
 *     deep-frozen, in-place mutation throws as well;
 *   - the retry/timeout policies are pure data snapshots taken from the
 *     JobDefinition at submit time — the record is self-describing and the
 *     transitions never read a wall clock (all timestamps are injected).
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import type { RetryPolicy } from './definition.js';
import { isRetryableErrorClass, retryAttemptsRemaining, retryBackoffMs } from './definition.js';
import type { JobEvent } from './events.js';
import { appendJobEvent } from './events.js';
import type {
  ContentDigest,
  JobAttempt,
  JobErrorClass,
  JobId,
  JobKindIdentity,
  JobState,
  JobTimestamp,
  NeutralId,
} from './shared.js';
import {
  TIMEOUT_ERROR_CLASS,
  closeJobAttempt,
  deepFreeze,
  isContentDigest,
  isJobAttempt,
  isJobId,
  isJobKindIdentity,
  isJobState,
  isJobTimestamp,
  isPlainJsonValue,
  isTerminalJobState,
  newJobId,
  toContentDigest,
  toJobErrorClass,
  toJobId,
  toJobKindIdentity,
  toJobTimestamp,
  toNeutralId,
} from './shared.js';

// ---------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------

/** Wire version of the job record shape. */
export const JOB_RECORD_VERSION = 1 as const;

/** Snapshot of the policies a record needs for its own transitions. */
export interface JobPolicySnapshot {
  readonly timeoutMs: number;
  readonly retry: RetryPolicy;
}

/** Why a terminal job failed (kind 'timeout' = the timeout policy fired). */
export interface JobFailure {
  readonly kind: 'error' | 'timeout';
  readonly errorClass: JobErrorClass;
  readonly message: string;
}

/** Terminal cancellation detail. */
export interface JobCancellation {
  readonly reason: string;
  readonly cancelledAt: JobTimestamp;
}

/** Last reported progress (observability, R33; never a state machine input). */
export interface JobProgress {
  readonly attempt: number;
  readonly percent?: number;
  readonly note?: string;
  readonly at: JobTimestamp;
}

export interface JobRecord {
  readonly recordVersion: typeof JOB_RECORD_VERSION;
  readonly jobId: JobId;
  /** Content digest of the JobDefinition this job executes. */
  readonly definitionDigest: ContentDigest;
  /** Kind identity snapshot (self-describing; see definitionDigest). */
  readonly kind: JobKindIdentity;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  /** Idempotency scope snapshot from the definition at submit time. */
  readonly idempotencyScope: NeutralId;
  readonly input: unknown;
  readonly policy: JobPolicySnapshot;
  readonly status: JobState;
  /** Number of attempts STARTED (1-based attempt numbers). */
  readonly attempts: number;
  readonly attemptHistory: readonly JobAttempt[];
  /** Append-only event history (deep-frozen; one event per transition). */
  readonly events: readonly JobEvent[];
  readonly submittedAt: JobTimestamp;
  readonly updatedAt: JobTimestamp;
  /** Deadline of the CURRENT attempt (set while running). */
  readonly timeoutAt?: JobTimestamp;
  /** Backoff gate for the next claim (set while queued after a retry). */
  readonly nextRetryAt?: JobTimestamp;
  readonly progress?: JobProgress;
  readonly failure?: JobFailure;
  readonly result?: unknown;
  readonly cancellation?: JobCancellation;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateJobRecordInput {
  readonly definitionDigest: string;
  readonly kind: {
    namespace: string;
    name: string;
    version: string;
  };
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly idempotencyScope: string;
  readonly input: unknown;
  readonly policy: {
    timeoutMs: number;
    retry: RetryPolicy;
  };
  readonly jobId?: string;
  readonly submittedAt?: string;
}

function invalidRecord(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function assertValidPolicy(policy: CreateJobRecordInput['policy']): JobPolicySnapshot {
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !isPositiveInteger(policy.timeoutMs)
  ) {
    invalidRecord('policy.timeoutMs must be an integer >= 1');
  }
  if (
    typeof policy.retry !== 'object' ||
    policy.retry === null ||
    !isPositiveInteger(policy.retry.maxAttempts) ||
    !Array.isArray(policy.retry.backoffScheduleMs) ||
    !policy.retry.backoffScheduleMs.every((entry) => typeof entry === 'number' && entry >= 0) ||
    !Array.isArray(policy.retry.retryableErrorClasses) ||
    !policy.retry.retryableErrorClasses.every((entry) => typeof entry === 'string')
  ) {
    invalidRecord(
      'policy.retry must be a valid retry policy {maxAttempts, backoffScheduleMs, retryableErrorClasses}',
    );
  }
  return Object.freeze({
    timeoutMs: policy.timeoutMs,
    retry: Object.freeze({
      maxAttempts: policy.retry.maxAttempts,
      backoffScheduleMs: Object.freeze([...policy.retry.backoffScheduleMs]),
      retryableErrorClasses: Object.freeze([...policy.retry.retryableErrorClasses]),
    }),
  });
}

/**
 * Create a queued job record: validates the submission, seeds the embedded
 * history with the `job-submitted` event, and deep-freezes the result.
 */
export function createJobRecord(input: CreateJobRecordInput): JobRecord {
  if (typeof input !== 'object' || input === null) {
    invalidRecord('a job record input is required');
  }
  const jobId = toJobId(input.jobId ?? newJobId());
  const definitionDigest = toContentDigest(input.definitionDigest);
  const kind = toJobKindIdentity(input.kind);
  if (!isCorrelationId(input.correlationId)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
      message: `invalid correlation id on job submission: ${JSON.stringify(input.correlationId)}`,
    });
  }
  if (!isIdempotencyKey(input.idempotencyKey)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
      message: `invalid idempotency key on job submission: ${JSON.stringify(input.idempotencyKey)}`,
    });
  }
  if (!isPlainJsonValue(input.input)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_INPUT, {
      message: 'job input must be plain JSON (canonically serializable)',
    });
  }
  const submittedAt = toJobTimestamp(input.submittedAt ?? new Date().toISOString());
  const policy = assertValidPolicy(input.policy);

  const submitted: JobEvent = {
    eventVersion: 1,
    kind: 'job-submitted',
    sequence: 1,
    occurredAt: submittedAt,
    jobId,
    definitionDigest,
    input: input.input,
  };
  const record: JobRecord = {
    recordVersion: JOB_RECORD_VERSION,
    jobId,
    definitionDigest,
    kind,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    idempotencyScope: toNeutralId(input.idempotencyScope),
    input: input.input,
    policy,
    status: 'queued',
    attempts: 0,
    attemptHistory: Object.freeze([]),
    events: appendJobEvent([], submitted),
    submittedAt,
    updatedAt: submittedAt,
  };
  return deepFreeze(record);
}

// ---------------------------------------------------------------------------
// Terminal guard + transition core
// ---------------------------------------------------------------------------

/** True iff the record has reached a terminal state. */
export function isTerminalJobRecord(record: JobRecord): boolean {
  return isTerminalJobState(record.status);
}

function assertNotTerminal(record: JobRecord): void {
  if (isTerminalJobRecord(record)) {
    throw new JobError(JOB_ERROR_CODES.TERMINAL_STATE, {
      message: `job ${record.jobId} is ${record.status} and cannot be mutated: terminal states are final (append-only history preserves the full lifecycle)`,
      details: {
        jobId: record.jobId,
        status: record.status,
        events: record.events.length,
      },
    });
  }
}

function requireStatus(record: JobRecord, expected: JobState): void {
  assertNotTerminal(record);
  if (record.status !== expected) {
    throw new JobError(JOB_ERROR_CODES.INVALID_TRANSITION, {
      message: `job ${record.jobId} cannot transition from ${record.status} (expected source state ${expected})`,
      details: { from: record.status, expected },
    });
  }
}

function requireOpenAttempt(record: JobRecord): JobAttempt {
  const last =
    record.attemptHistory.length > 0
      ? record.attemptHistory[record.attemptHistory.length - 1]
      : undefined;
  if (last === undefined || last.outcome !== 'pending') {
    throw new JobError(JOB_ERROR_CODES.INVALID_TRANSITION, {
      message: `job ${record.jobId} has no open attempt to conclude (a running job must have exactly one pending attempt)`,
      details: { attempts: record.attempts },
    });
  }
  return last;
}

function closeLastAttempt(
  record: JobRecord,
  outcome: Exclude<JobAttempt['outcome'], 'pending'>,
  at: JobTimestamp,
  errorClass?: string,
): readonly JobAttempt[] {
  const open = requireOpenAttempt(record);
  const closed = closeJobAttempt(open, outcome, at, errorClass);
  return Object.freeze([...record.attemptHistory.slice(0, -1), closed]);
}

function addMs(at: JobTimestamp, ms: number): JobTimestamp {
  const sum = new Date(at).getTime() + ms;
  return new Date(sum).toISOString() as JobTimestamp;
}

/** Strip optional keys from a record copy (exactOptionalPropertyTypes-safe). */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) {
    delete copy[key as string];
  }
  return copy as Omit<T, K>;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions (pure; terminal states are final)
// ---------------------------------------------------------------------------

/** Claim (start the next attempt of) a queued job: queued → running. */
export function claimJob(record: JobRecord, input: { at: string }): JobRecord {
  requireStatus(record, 'queued');
  const at = toJobTimestamp(input.at);
  if (record.nextRetryAt !== undefined && record.nextRetryAt > at) {
    throw new JobError(JOB_ERROR_CODES.INVALID_TRANSITION, {
      message: `job ${record.jobId} is inside its retry backoff window (nextRetryAt ${record.nextRetryAt} > ${at}); claim it after the backoff elapses`,
      details: { nextRetryAt: record.nextRetryAt, at },
    });
  }
  const attempt = record.attempts + 1;
  const timeoutAt = addMs(at, record.policy.timeoutMs);
  const started: JobEvent = {
    eventVersion: 1,
    kind: 'job-started',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    attempt,
    timeoutAt,
  };
  const next = omit(
    {
      ...record,
      status: 'running' as const,
      attempts: attempt,
      attemptHistory: Object.freeze([
        ...record.attemptHistory,
        Object.freeze({ attempt, startedAt: at, outcome: 'pending' } satisfies JobAttempt),
      ]),
      events: appendJobEvent(record.events, started),
      updatedAt: at,
      timeoutAt,
    },
    'nextRetryAt',
  );
  return deepFreeze(next);
}

/** Report progress on a running job (observability; status unchanged). */
export function progressJob(
  record: JobRecord,
  input: { at: string; percent?: number; note?: string },
): JobRecord {
  requireStatus(record, 'running');
  const at = toJobTimestamp(input.at);
  if (
    input.percent !== undefined &&
    !(typeof input.percent === 'number' && input.percent >= 0 && input.percent <= 100)
  ) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: `progress percent must be a number in [0, 100], got ${String(input.percent)}`,
    });
  }
  if (input.note !== undefined && !(typeof input.note === 'string' && input.note.length > 0)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'progress note must be a non-empty string when present',
    });
  }
  const progressed: JobEvent = {
    eventVersion: 1,
    kind: 'job-progressed',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    attempt: record.attempts,
    ...(input.percent !== undefined ? { percent: input.percent } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
  const next: JobRecord = {
    ...record,
    events: appendJobEvent(record.events, progressed),
    updatedAt: at,
    progress: Object.freeze({
      attempt: record.attempts,
      at,
      ...(input.percent !== undefined ? { percent: input.percent } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    }),
  };
  return deepFreeze(next);
}

/** Complete a running job (terminal, final). */
export function completeJob(
  record: JobRecord,
  input: { at: string; result: unknown },
): JobRecord {
  requireStatus(record, 'running');
  const at = toJobTimestamp(input.at);
  if (!isPlainJsonValue(input.result)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_INPUT, {
      message: 'job result must be plain JSON (canonically serializable)',
    });
  }
  const completed: JobEvent = {
    eventVersion: 1,
    kind: 'job-completed',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    attempt: record.attempts,
    result: input.result,
  };
  const next = omit(
    {
      ...record,
      status: 'succeeded' as const,
      attemptHistory: closeLastAttempt(record, 'succeeded', at),
      events: appendJobEvent(record.events, completed),
      updatedAt: at,
      result: input.result,
    },
    'timeoutAt',
  );
  return deepFreeze(next);
}

/**
 * Fail the current attempt of a running job. When the retry policy has
 * budget left AND the error class is retryable, the job RE-QUEUES with a
 * backoff-gated `nextRetryAt` (and a `job-retried` event); otherwise it
 * fails terminally with its full attempt history (a `job-failed` event).
 */
export function failJob(
  record: JobRecord,
  input: { at: string; errorClass: string; message: string },
): JobRecord {
  requireStatus(record, 'running');
  const at = toJobTimestamp(input.at);
  const errorClass = toJobErrorClass(input.errorClass);
  if (typeof input.message !== 'string' || input.message.length === 0) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'failure message must be a non-empty string',
    });
  }
  const failedAttempt = record.attempts;
  const attemptHistory = closeLastAttempt(record, 'failed', at, errorClass);

  if (
    retryAttemptsRemaining(record.policy.retry, record.attempts) > 0 &&
    isRetryableErrorClass(record.policy.retry, errorClass)
  ) {
    const backoffMs = retryBackoffMs(record.policy.retry, failedAttempt);
    const nextRetryAt = addMs(at, backoffMs);
    const retried: JobEvent = {
      eventVersion: 1,
      kind: 'job-retried',
      sequence: record.events.length + 1,
      occurredAt: at,
      jobId: record.jobId,
      failedAttempt,
      errorClass,
      message: input.message,
      nextAttempt: failedAttempt + 1,
      backoffMs,
      nextRetryAt,
    };
    const next = omit(
      {
        ...record,
        status: 'queued' as const,
        attemptHistory,
        events: appendJobEvent(record.events, retried),
        updatedAt: at,
        nextRetryAt,
      },
      'timeoutAt',
    );
    return deepFreeze(next);
  }

  const failed: JobEvent = {
    eventVersion: 1,
    kind: 'job-failed',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    attempts: record.attempts,
    failureKind: 'error',
    errorClass,
    message: input.message,
    attemptHistory,
  };
  const next = omit(
    {
      ...record,
      status: 'failed' as const,
      attemptHistory,
      events: appendJobEvent(record.events, failed),
      updatedAt: at,
      failure: Object.freeze({ kind: 'error' as const, errorClass, message: input.message }),
    },
    'timeoutAt',
  );
  return deepFreeze(next);
}

/**
 * Apply the timeout policy to a running job whose attempt deadline has
 * passed: marks the attempt TIMED-OUT. When 'timeout' is retryable and
 * budget remains, the job re-queues with backoff; otherwise it fails
 * terminally with failure kind 'timeout'.
 */
export function timeoutJob(record: JobRecord, input: { at: string }): JobRecord {
  requireStatus(record, 'running');
  const at = toJobTimestamp(input.at);
  if (record.timeoutAt === undefined || at < record.timeoutAt) {
    throw new JobError(JOB_ERROR_CODES.INVALID_TRANSITION, {
      message: `job ${record.jobId} has not exceeded its timeout policy (timeoutAt ${record.timeoutAt ?? 'unset'} > ${at}); only past-deadline attempts can be marked timed-out`,
      details: { timeoutAt: record.timeoutAt, at },
    });
  }
  const failedAttempt = record.attempts;
  const attemptHistory = closeLastAttempt(record, 'timed-out', at, TIMEOUT_ERROR_CLASS);
  const message = `attempt ${String(failedAttempt)} exceeded the timeout policy (${String(record.policy.timeoutMs)} ms)`;

  if (
    retryAttemptsRemaining(record.policy.retry, record.attempts) > 0 &&
    isRetryableErrorClass(record.policy.retry, TIMEOUT_ERROR_CLASS)
  ) {
    const backoffMs = retryBackoffMs(record.policy.retry, failedAttempt);
    const nextRetryAt = addMs(at, backoffMs);
    const retried: JobEvent = {
      eventVersion: 1,
      kind: 'job-retried',
      sequence: record.events.length + 1,
      occurredAt: at,
      jobId: record.jobId,
      failedAttempt,
      errorClass: TIMEOUT_ERROR_CLASS,
      message,
      nextAttempt: failedAttempt + 1,
      backoffMs,
      nextRetryAt,
    };
    const next = omit(
      {
        ...record,
        status: 'queued' as const,
        attemptHistory,
        events: appendJobEvent(record.events, retried),
        updatedAt: at,
        nextRetryAt,
      },
      'timeoutAt',
    );
    return deepFreeze(next);
  }

  const failed: JobEvent = {
    eventVersion: 1,
    kind: 'job-failed',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    attempts: record.attempts,
    failureKind: 'timeout',
    errorClass: TIMEOUT_ERROR_CLASS,
    message,
    attemptHistory,
  };
  const next = omit(
    {
      ...record,
      status: 'failed' as const,
      attemptHistory,
      events: appendJobEvent(record.events, failed),
      updatedAt: at,
      failure: Object.freeze({
        kind: 'timeout' as const,
        errorClass: TIMEOUT_ERROR_CLASS,
        message,
      }),
    },
    'timeoutAt',
  );
  return deepFreeze(next);
}

/** Cancel a queued or running job (terminal, final). */
export function cancelJob(
  record: JobRecord,
  input: { at: string; reason: string },
): JobRecord {
  assertNotTerminal(record);
  if (record.status !== 'queued' && record.status !== 'running') {
    throw new JobError(JOB_ERROR_CODES.INVALID_TRANSITION, {
      message: `job ${record.jobId} cannot be cancelled from ${record.status}`,
      details: { from: record.status },
    });
  }
  const at = toJobTimestamp(input.at);
  if (typeof input.reason !== 'string' || input.reason.length === 0) {
    throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
      message: 'cancellation reason must be a non-empty string',
    });
  }
  const attemptHistory =
    record.status === 'running'
      ? closeLastAttempt(record, 'cancelled', at)
      : record.attemptHistory;
  const cancelled: JobEvent = {
    eventVersion: 1,
    kind: 'job-cancelled',
    sequence: record.events.length + 1,
    occurredAt: at,
    jobId: record.jobId,
    reason: input.reason,
  };
  const next = omit(
    {
      ...record,
      status: 'cancelled' as const,
      attemptHistory,
      events: appendJobEvent(record.events, cancelled),
      updatedAt: at,
      cancellation: Object.freeze({ reason: input.reason, cancelledAt: at }),
    },
    'timeoutAt',
    'nextRetryAt',
  );
  return deepFreeze(next);
}

// ---------------------------------------------------------------------------
// Structural check + strict wire parsing
// ---------------------------------------------------------------------------

/** Structural (non-throwing) check. */
export function isJobRecord(value: unknown): value is JobRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === JOB_RECORD_VERSION &&
    isJobId(candidate['jobId']) &&
    isContentDigest(candidate['definitionDigest']) &&
    isJobKindIdentity(candidate['kind']) &&
    typeof candidate['correlationId'] === 'string' &&
    typeof candidate['idempotencyKey'] === 'string' &&
    isJobState(candidate['status']) &&
    typeof candidate['attempts'] === 'number' &&
    Number.isInteger(candidate['attempts']) &&
    candidate['attempts'] >= 0 &&
    Array.isArray(candidate['attemptHistory']) &&
    candidate['attemptHistory'].every((entry) => isJobAttempt(entry)) &&
    Array.isArray(candidate['events']) &&
    isJobTimestamp(candidate['submittedAt']) &&
    isJobTimestamp(candidate['updatedAt'])
  );
}

function isTerminalEventKind(kind: JobEvent['kind']): boolean {
  return kind === 'job-completed' || kind === 'job-failed' || kind === 'job-cancelled';
}

function nextKindsAllow(previous: JobEvent['kind'], current: JobEvent['kind']): boolean {
  switch (previous) {
    case 'job-submitted':
      return current === 'job-started' || current === 'job-cancelled';
    case 'job-started':
    case 'job-progressed':
      return (
        current === 'job-progressed' ||
        current === 'job-retried' ||
        current === 'job-completed' ||
        current === 'job-failed' ||
        current === 'job-cancelled'
      );
    case 'job-retried':
      return current === 'job-started' || current === 'job-cancelled';
    default:
      return false;
  }
}

/**
 * Strictly parse a JobRecord from its wire (JSON) form. Enforces every
 * append-only invariant on the embedded history:
 *   - event sequences are exactly 1..n in order;
 *   - the first event is `job-submitted` and matches the submission fields;
 *   - kinds follow the closed lifecycle order (no out-of-order appends);
 *   - timestamps are monotonic non-decreasing;
 *   - the LAST event agrees with `status` (terminal kinds are final and
 *     terminal-only; a terminal status carries its terminal detail);
 *   - attempt history is contiguous 1..attempts with exactly one open
 *     (pending) attempt iff status is 'running';
 *   - timeoutAt only while running; nextRetryAt only while queued;
 *   - failure/result/cancellation only on the matching terminal status;
 *   - updatedAt >= submittedAt; input is plain JSON.
 * Throws JOB_INVALID_RECORD / JOB_INVALID_EVENT. Returns a deep-frozen,
 * re-validated record.
 */
export function parseJobRecord(value: unknown): JobRecord {
  if (!isJobRecord(value)) {
    invalidRecord('not a structurally valid job record');
  }
  const record = value as JobRecord;
  if (record.submittedAt > record.updatedAt) {
    invalidRecord('updatedAt cannot precede submittedAt');
  }
  if (!isPlainJsonValue(record.input)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_INPUT, {
      message: 'job input must be plain JSON (canonically serializable)',
    });
  }

  // Embedded event stream invariants.
  record.events.forEach((event, index) => {
    if (event.sequence !== index + 1) {
      throw new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_GAP, {
        message: `event sequence must be contiguous from 1 (position ${String(index + 1)} carries sequence ${String(event.sequence)})`,
      });
    }
    if (event.jobId !== record.jobId) {
      throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
        message: `event at sequence ${String(event.sequence)} belongs to job ${event.jobId}, not ${record.jobId}`,
      });
    }
  });
  const first = record.events[0];
  if (first === undefined || first.kind !== 'job-submitted') {
    throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: 'the embedded event stream must start with job-submitted',
    });
  }
  if (first.definitionDigest !== record.definitionDigest) {
    throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
      message: 'the job-submitted event definition digest does not match the record',
    });
  }
  for (let i = 1; i < record.events.length; i += 1) {
    const previous = record.events[i - 1];
    const current = record.events[i];
    if (previous === undefined || current === undefined) continue;
    if (!nextKindsAllow(previous.kind, current.kind)) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event kind ${current.kind} cannot follow ${previous.kind} in the embedded history`,
      });
    }
    if (previous.occurredAt > current.occurredAt) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event timestamps must be monotonically non-decreasing at sequence ${String(current.sequence)}`,
      });
    }
  }

  // Last event agrees with status.
  const last = record.events[record.events.length - 1];
  if (last === undefined) {
    invalidRecord('the embedded event stream cannot be empty');
  }
  switch (record.status) {
    case 'succeeded':
      if (last.kind !== 'job-completed' || record.result === undefined) {
        invalidRecord('a succeeded job must end with job-completed and carry a result');
      }
      break;
    case 'failed':
      if (last.kind !== 'job-failed' || record.failure === undefined) {
        invalidRecord('a failed job must end with job-failed and carry a failure');
      }
      break;
    case 'cancelled':
      if (last.kind !== 'job-cancelled' || record.cancellation === undefined) {
        invalidRecord('a cancelled job must end with job-cancelled and carry a cancellation');
      }
      break;
    case 'running':
      if (isTerminalEventKind(last.kind)) {
        invalidRecord('a running job cannot have a terminal event in its history');
      }
      break;
    case 'queued':
      if (last.kind !== 'job-submitted' && last.kind !== 'job-retried') {
        invalidRecord('a queued job must end with job-submitted or job-retried');
      }
      break;
    default:
      invalidRecord(`unknown status ${String(record.status)}`);
  }
  if (isTerminalJobState(record.status)) {
    for (const event of record.events) {
      if (isTerminalEventKind(event.kind) && event !== last) {
        throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
          message:
            'terminal events are final: only the last event of a terminal job may be terminal',
        });
      }
    }
  }

  // Attempt history invariants.
  record.attemptHistory.forEach((attempt, index) => {
    if (attempt.attempt !== index + 1) {
      throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
        message: `attempt numbers must be contiguous from 1 (position ${String(index + 1)} carries attempt ${String(attempt.attempt)})`,
      });
    }
  });
  if (record.attemptHistory.length !== record.attempts) {
    invalidRecord(
      `attemptHistory has ${String(record.attemptHistory.length)} entries but attempts is ${String(record.attempts)}`,
    );
  }
  const openCount = record.attemptHistory.filter(
    (attempt) => attempt.outcome === 'pending',
  ).length;
  if (record.status === 'running' && openCount !== 1) {
    invalidRecord('a running job must have exactly one open (pending) attempt');
  }
  if (record.status !== 'running' && openCount !== 0) {
    invalidRecord('only a running job may have an open (pending) attempt');
  }

  // Field/state coherence.
  if (record.timeoutAt !== undefined && record.status !== 'running') {
    invalidRecord('timeoutAt may only be set while the job is running');
  }
  if (record.nextRetryAt !== undefined && record.status !== 'queued') {
    invalidRecord('nextRetryAt may only be set while the job is queued for a retry');
  }
  if (record.failure !== undefined && record.status !== 'failed') {
    invalidRecord('failure detail is only valid on a failed job');
  }
  if (record.result !== undefined && record.status !== 'succeeded') {
    invalidRecord('result is only valid on a succeeded job');
  }
  if (record.cancellation !== undefined && record.status !== 'cancelled') {
    invalidRecord('cancellation detail is only valid on a cancelled job');
  }

  return deepFreeze({
    ...record,
    kind: Object.freeze({ ...record.kind }),
    attemptHistory: Object.freeze([...record.attemptHistory]),
    events: Object.freeze([...record.events]),
    policy: deepFreeze({
      timeoutMs: record.policy.timeoutMs,
      retry: Object.freeze({
        maxAttempts: record.policy.retry.maxAttempts,
        backoffScheduleMs: Object.freeze([...record.policy.retry.backoffScheduleMs]),
        retryableErrorClasses: Object.freeze([...record.policy.retry.retryableErrorClasses]),
      }),
    }),
    ...(record.progress !== undefined
      ? { progress: Object.freeze({ ...record.progress }) }
      : {}),
    ...(record.failure !== undefined ? { failure: Object.freeze({ ...record.failure }) } : {}),
    ...(record.cancellation !== undefined
      ? { cancellation: Object.freeze({ ...record.cancellation }) }
      : {}),
  });
}
