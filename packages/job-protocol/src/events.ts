/**
 * Job event taxonomy + per-job append-only ordering (Work Order A015;
 * architecture-lock rule 17; requirements R26, R27, R33).
 *
 * A `JobEvent` is one append-only event in a job's history — the payload
 * half of the wire form; every event ALSO travels inside a versioned
 * `Envelope<T>` (see envelopes.ts / makeJobEventEnvelope) carrying the
 * correlation id and idempotency key of the job it belongs to.
 *
 * Taxonomy (closed set, v1):
 *   job-submitted, job-started, job-progressed, job-retried,
 *   job-completed, job-failed, job-cancelled  (job lifecycle)
 *   mutation-audited                            (generic consequential-
 *                                                mutation audit event, R28)
 *
 * Ordering invariants enforced EVERYWHERE events are appended (embedded
 * record history, envelope-side JobEventLog, strict wire parsing):
 *   - sequences are exactly 1..n, contiguous, per job;
 *   - the first event of a job is always `job-submitted`;
 *   - event kinds follow the closed lifecycle order (an out-of-order append
 *     such as job-completed directly after job-submitted is REJECTED);
 *   - timestamps are monotonically non-decreasing;
 *   - terminal kinds (job-completed / job-failed / job-cancelled) are FINAL
 *     for the stream — nothing may be appended after them.
 */

import { JOB_ERROR_CODES, JobError } from './errors.js';
import type { JobAttempt, PrincipalRef } from './shared.js';
import {
  ENVELOPE_ID_PATTERN_SOURCE,
  isContentDigest,
  isJobAttempt,
  isJobErrorClass,
  isJobId,
  isJobTimestamp,
  isMutationName,
  isPlainJsonValue,
  isPrincipalRef,
  toJobId,
  toJobTimestamp,
  toMutationName,
  toPrincipalRef,
} from './shared.js';

/** Wire version of every job event payload. */
export const JOB_EVENT_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Closed taxonomy
// ---------------------------------------------------------------------------

export const JOB_EVENT_KINDS = Object.freeze([
  'job-submitted',
  'job-started',
  'job-progressed',
  'job-retried',
  'job-completed',
  'job-failed',
  'job-cancelled',
  'mutation-audited',
] as const);
export type JobEventKind = (typeof JOB_EVENT_KINDS)[number];

/** Terminal event kinds — nothing may follow them in a job's stream. */
export const JOB_EVENT_TERMINAL_KINDS = Object.freeze(['job-completed', 'job-failed', 'job-cancelled'] as const);
export type TerminalJobEventKind = (typeof JOB_EVENT_TERMINAL_KINDS)[number];

export function isJobEventKind(value: unknown): value is JobEventKind {
  return (
    typeof value === 'string' && (JOB_EVENT_KINDS as readonly string[]).includes(value)
  );
}

export function isTerminalJobEventKind(value: unknown): value is TerminalJobEventKind {
  return (
    typeof value === 'string' &&
    (JOB_EVENT_TERMINAL_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Event payloads (discriminated union)
// ---------------------------------------------------------------------------

interface JobEventCommon {
  readonly eventVersion: typeof JOB_EVENT_VERSION;
  /** 1-based monotonic sequence within the stream this event belongs to. */
  readonly sequence: number;
  /** Canonical ms-UTC timestamp (when the event occurred). */
  readonly occurredAt: string;
  /** The job this event belongs to (present on every kind, including audit). */
  readonly jobId: string;
}

export interface JobSubmittedEvent extends JobEventCommon {
  readonly kind: 'job-submitted';
  readonly definitionDigest: string;
  readonly input: unknown;
}

export interface JobStartedEvent extends JobEventCommon {
  readonly kind: 'job-started';
  readonly attempt: number;
  readonly timeoutAt: string;
}

export interface JobProgressedEvent extends JobEventCommon {
  readonly kind: 'job-progressed';
  readonly attempt: number;
  readonly percent?: number;
  readonly note?: string;
}

export interface JobRetriedEvent extends JobEventCommon {
  readonly kind: 'job-retried';
  readonly failedAttempt: number;
  readonly errorClass: string;
  readonly message: string;
  readonly nextAttempt: number;
  readonly backoffMs: number;
  readonly nextRetryAt: string;
}

export interface JobCompletedEvent extends JobEventCommon {
  readonly kind: 'job-completed';
  readonly attempt: number;
  readonly result: unknown;
}

export interface JobFailedEvent extends JobEventCommon {
  readonly kind: 'job-failed';
  readonly attempts: number;
  readonly failureKind: 'error' | 'timeout';
  readonly errorClass: string;
  readonly message: string;
  readonly attemptHistory: readonly JobAttempt[];
}

export interface JobCancelledEvent extends JobEventCommon {
  readonly kind: 'job-cancelled';
  readonly reason: string;
}

/**
 * The generic consequential-mutation audit event (R28): every state
 * mutation emits one, naming the actor (principal ref), the mutation, the
 * job id, the correlation id, and the envelope id of the domain event it
 * audits. Audit events form their own sha256-chained stream (see audit.ts).
 */
export interface MutationAuditedEvent extends JobEventCommon {
  readonly kind: 'mutation-audited';
  readonly mutation: string;
  readonly actor: PrincipalRef;
  readonly correlationId: string;
  readonly envelopeId: string;
}

export type JobEvent =
  | JobSubmittedEvent
  | JobStartedEvent
  | JobProgressedEvent
  | JobRetriedEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobCancelledEvent
  | MutationAuditedEvent;

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function invalidEvent(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ENVELOPE_ID_PATTERN = new RegExp(ENVELOPE_ID_PATTERN_SOURCE);

/** Structural (non-throwing) check for any event in the taxonomy. */
export function isJobEvent(value: unknown): value is JobEvent {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['eventVersion'] !== JOB_EVENT_VERSION) return false;
  if (!isJobEventKind(candidate['kind'])) return false;
  if (!isPositiveInteger(candidate['sequence'])) return false;
  if (!isJobTimestamp(candidate['occurredAt'])) return false;
  if (!isJobId(candidate['jobId'])) return false;

  switch (candidate['kind']) {
    case 'job-submitted':
      return isContentDigest(candidate['definitionDigest']) && 'input' in candidate;
    case 'job-started':
      return isPositiveInteger(candidate['attempt']) && isJobTimestamp(candidate['timeoutAt']);
    case 'job-progressed': {
      if (!isPositiveInteger(candidate['attempt'])) return false;
      const percent = candidate['percent'];
      if (
        percent !== undefined &&
        !(typeof percent === 'number' && percent >= 0 && percent <= 100)
      ) {
        return false;
      }
      const note = candidate['note'];
      return note === undefined || (typeof note === 'string' && note.length > 0);
    }
    case 'job-retried':
      return (
        isPositiveInteger(candidate['failedAttempt']) &&
        isJobErrorClass(candidate['errorClass']) &&
        typeof candidate['message'] === 'string' &&
        candidate['message'].length > 0 &&
        isPositiveInteger(candidate['nextAttempt']) &&
        typeof candidate['backoffMs'] === 'number' &&
        candidate['backoffMs'] >= 0 &&
        isJobTimestamp(candidate['nextRetryAt'])
      );
    case 'job-completed':
      return isPositiveInteger(candidate['attempt']) && 'result' in candidate;
    case 'job-failed':
      return (
        isPositiveInteger(candidate['attempts']) &&
        (candidate['failureKind'] === 'error' || candidate['failureKind'] === 'timeout') &&
        isJobErrorClass(candidate['errorClass']) &&
        typeof candidate['message'] === 'string' &&
        candidate['message'].length > 0 &&
        Array.isArray(candidate['attemptHistory']) &&
        candidate['attemptHistory'].every((entry) => isJobAttempt(entry))
      );
    case 'job-cancelled':
      return typeof candidate['reason'] === 'string' && candidate['reason'].length > 0;
    case 'mutation-audited':
      return (
        isMutationName(candidate['mutation']) &&
        isPrincipalRef(candidate['actor']) &&
        typeof candidate['correlationId'] === 'string' &&
        CORRELATION_ID_PATTERN.test(candidate['correlationId']) &&
        typeof candidate['envelopeId'] === 'string' &&
        ENVELOPE_ID_PATTERN.test(candidate['envelopeId'])
      );
    default:
      return false;
  }
}

/**
 * Validate a job event, returning the frozen payload. Throws
 * JOB_INVALID_EVENT on any malformed shape. `expectedSequence` (when
 * provided) pins the sequence (used by append paths).
 */
export function toJobEvent(value: unknown, expectedSequence?: number): JobEvent {
  if (!isJobEvent(value)) {
    invalidEvent(
      `not a structurally valid job event: ${JSON.stringify(value)?.slice(0, 200) ?? String(value)}`,
    );
  }
  const event = value;
  if (expectedSequence !== undefined && event.sequence !== expectedSequence) {
    invalidEvent(
      `event sequence ${String(event.sequence)} does not match the expected sequence ${String(expectedSequence)}`,
      { expected: expectedSequence, actual: event.sequence },
    );
  }
  switch (event.kind) {
    case 'job-submitted':
      if (!isPlainJsonValue(event.input)) {
        invalidEvent('job-submitted input must be plain JSON');
      }
      return Object.freeze({ ...event });
    case 'job-completed':
      if (!isPlainJsonValue(event.result)) {
        invalidEvent('job-completed result must be plain JSON');
      }
      return Object.freeze({ ...event });
    case 'job-failed':
      return Object.freeze({
        ...event,
        attemptHistory: Object.freeze([...event.attemptHistory]),
      });
    default:
      return Object.freeze({ ...event });
  }
}

/** Human-readable summary (kind + sequence + job). */
export function jobEventKey(event: JobEvent): string {
  return `${event.kind}#${String(event.sequence)}@${event.jobId}`;
}

// ---------------------------------------------------------------------------
// Lifecycle kind ordering (closed state machine over kinds)
// ---------------------------------------------------------------------------

/**
 * Kinds that may follow `lastKind` in a job's event stream. `undefined`
 * means "the stream is empty" — only `job-submitted` may open a stream.
 * Terminal kinds are followed by NOTHING (terminal-final).
 */
export function nextJobEventKinds(lastKind: JobEventKind | undefined): readonly JobEventKind[] {
  switch (lastKind) {
    case undefined:
      return ['job-submitted'];
    case 'job-submitted':
      return ['job-started', 'job-cancelled'];
    case 'job-started':
    case 'job-progressed':
      return ['job-progressed', 'job-retried', 'job-completed', 'job-failed', 'job-cancelled'];
    case 'job-retried':
      return ['job-started', 'job-cancelled'];
    case 'job-completed':
    case 'job-failed':
    case 'job-cancelled':
      return [];
    default:
      return [];
  }
}

/**
 * Validate that `event` may be appended after `events` (the embedded,
 * append-only history of one job). Enforces contiguity (gap/duplicate
 * rejection), kind ordering (out-of-order rejection) and timestamp
 * monotonicity. Throws JOB_EVENT_SEQUENCE_GAP /
 * JOB_EVENT_SEQUENCE_DUPLICATE / JOB_EVENT_OUT_OF_ORDER.
 */
export function validateJobEventAppend(events: readonly JobEvent[], event: JobEvent): void {
  const expected = events.length + 1;
  if (event.sequence < expected) {
    throw new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE, {
      message: `event sequence ${String(event.sequence)} duplicates or regresses behind the expected next sequence ${String(expected)} (append-only streams never rewrite history)`,
      details: { expected, actual: event.sequence, kind: event.kind },
    });
  }
  if (event.sequence > expected) {
    throw new JobError(JOB_ERROR_CODES.EVENT_SEQUENCE_GAP, {
      message: `event sequence ${String(event.sequence)} leaves a gap before the expected next sequence ${String(expected)} (per-job sequences must be contiguous and monotonically increasing)`,
      details: { expected, actual: event.sequence, kind: event.kind },
    });
  }
  const last = events.length > 0 ? events[events.length - 1] : undefined;
  if (last !== undefined) {
    if (!nextJobEventKinds(last.kind).includes(event.kind)) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event kind ${event.kind} cannot follow ${last.kind} (out-of-order append rejected; allowed next: ${nextJobEventKinds(last.kind).join(', ') || 'nothing (terminal)'})`,
        details: {
          lastKind: last.kind,
          attemptedKind: event.kind,
          allowed: [...nextJobEventKinds(last.kind)],
        },
      });
    }
    if (last.occurredAt > event.occurredAt) {
      throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
        message: `event timestamps must be monotonically non-decreasing (last: ${last.occurredAt}, attempted: ${event.occurredAt})`,
        details: { last: last.occurredAt, attempted: event.occurredAt },
      });
    }
  } else if (event.kind !== 'job-submitted') {
    throw new JobError(JOB_ERROR_CODES.EVENT_OUT_OF_ORDER, {
      message: `a job event stream must start with job-submitted, got ${event.kind}`,
      details: { attemptedKind: event.kind },
    });
  }
}

/** Append with validation: returns a NEW frozen array; input never modified. */
export function appendJobEvent(events: readonly JobEvent[], event: JobEvent): readonly JobEvent[] {
  validateJobEventAppend(events, event);
  return Object.freeze([...events, event]);
}

// ---------------------------------------------------------------------------
// Mutation-audited construction helper
// ---------------------------------------------------------------------------

export interface MakeMutationAuditedInput {
  readonly sequence: number;
  readonly occurredAt: string;
  readonly jobId: string;
  readonly mutation: string;
  readonly actor: PrincipalRef | { type: string; tenant: string; principalId: string };
  readonly correlationId: string;
  readonly envelopeId: string;
}

/**
 * Construct the generic consequential-mutation audit event (validated and
 * frozen). This is the payload half; audit.ts chains it, envelopes.ts wraps
 * it for the wire.
 */
export function makeMutationAuditedEvent(input: MakeMutationAuditedInput): MutationAuditedEvent {
  const actor = toPrincipalRef(input.actor);
  const event: MutationAuditedEvent = {
    eventVersion: JOB_EVENT_VERSION,
    kind: 'mutation-audited',
    sequence: toPositiveSequence(input.sequence),
    occurredAt: toJobTimestamp(input.occurredAt),
    jobId: toJobId(input.jobId),
    mutation: toMutationName(input.mutation),
    actor,
    correlationId: input.correlationId,
    envelopeId: input.envelopeId,
  };
  if (!isJobEvent(event)) {
    invalidEvent(
      `mutation-audited event is not structurally valid (correlationId / envelopeId shapes: ${CORRELATION_ID_PATTERN.source} / ${ENVELOPE_ID_PATTERN_SOURCE})`,
    );
  }
  return Object.freeze(event);
}

function toPositiveSequence(value: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalidEvent(`event sequence must be a positive integer, got ${String(value)}`);
  }
  return value;
}
