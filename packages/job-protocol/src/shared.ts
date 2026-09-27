/**
 * Shared job-protocol value types (Work Order A015).
 *
 * @arena/job-protocol is a DOMAIN package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer) — never a sibling domain package.
 * Structurally shared components (tenant-scoped principals, content digests,
 * canonical timestamps) are defined HERE as validated plain-string view
 * types, exactly like @arena/agent-body's shared.ts. They are STRUCTURALLY
 * COMPATIBLE with the corresponding @arena/artifact-protocol /
 * @arena/agent-body types (plain strings accept branded strings); the
 * generated contracts (contracts/events/*.v1.json) and
 * contracts.parity.test.ts keep the pattern sources from drifting.
 */

import type { Brand } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST match the generated contracts (parity asserted by
// src/contracts.parity.test.ts).
// ---------------------------------------------------------------------------

export const JOB_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const JOB_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const JOB_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const JOB_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Job ids: UUIDv4 or human-readable identifier (identifier charset). */
export const JOB_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
/** Correlation address: 1..8 lowercase slash-separated segments. */
export const CORRELATION_ADDRESS_PATTERN_SOURCE =
  '^[a-z][a-z0-9-]{0,63}(?:/[a-z][a-z0-9-]{0,63}){0,7}$';
/** Neutral lowercase identifier (idempotency scopes, error classes). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Dotted mutation name for audit events (e.g. job.submit). */
export const MUTATION_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]*(?:\\.[a-z][a-z0-9-]*){0,3}$';
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
/** Envelope instance ids (UUIDv4), mirrored from protocol-core's envelope. */
export const ENVELOPE_ID_PATTERN_SOURCE =
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const NAMESPACE_PATTERN = new RegExp(JOB_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(JOB_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(JOB_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(JOB_TIMESTAMP_PATTERN_SOURCE);
const JOB_ID_PATTERN = new RegExp(JOB_ID_PATTERN_SOURCE);
const CORRELATION_ADDRESS_PATTERN = new RegExp(CORRELATION_ADDRESS_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const MUTATION_NAME_PATTERN = new RegExp(MUTATION_NAME_PATTERN_SOURCE);
const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type JobNamespace = Brand<string, 'JobNamespace'>;
export type JobName = Brand<string, 'JobName'>;
export type JobSemver = Brand<string, 'JobSemver'>;
export type ContentDigest = Brand<string, 'JobContentDigest'>;
export type JobTimestamp = Brand<string, 'JobTimestamp'>;
export type JobId = Brand<string, 'JobId'>;
export type CorrelationAddress = Brand<string, 'CorrelationAddress'>;
export type NeutralId = Brand<string, 'JobNeutralId'>;
export type JobErrorClass = Brand<string, 'JobErrorClass'>;
export type MutationName = Brand<string, 'JobMutationName'>;

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

export const JOB_STATES = Object.freeze(['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const);
export type JobState = (typeof JOB_STATES)[number];

/** Terminal states are FINAL — every lifecycle operation on them throws. */
export const JOB_TERMINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled'] as const);
export type TerminalJobState = (typeof JOB_TERMINAL_STATES)[number];

export const JOB_PRIORITY_CLASSES = Object.freeze(['low', 'normal', 'high', 'critical'] as const);
export type JobPriorityClass = (typeof JOB_PRIORITY_CLASSES)[number];

export const JOB_ATTEMPT_OUTCOMES = Object.freeze([
  'pending',
  'succeeded',
  'failed',
  'timed-out',
  'cancelled',
] as const);
export type JobAttemptOutcome = (typeof JOB_ATTEMPT_OUTCOMES)[number];

/** Why a job failed: a domain error, or the timeout policy. */
export const JOB_FAILURE_KINDS = Object.freeze(['error', 'timeout'] as const);
export type JobFailureKind = (typeof JOB_FAILURE_KINDS)[number];

// ---------------------------------------------------------------------------
// Job attempt (one execution attempt of a job; append-only history entry)
// ---------------------------------------------------------------------------

/**
 * One execution attempt. `outcome` is 'pending' exactly while the attempt
 * is running; every other outcome is closed and carries `endedAt`
 * (and `errorClass` for failure outcomes).
 */
export interface JobAttempt {
  readonly attempt: number;
  readonly startedAt: string;
  readonly outcome: JobAttemptOutcome;
  readonly endedAt?: string;
  readonly errorClass?: string;
}

export function isJobAttempt(value: unknown): value is JobAttempt {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['attempt'] !== 'number' ||
    !Number.isInteger(candidate['attempt']) ||
    candidate['attempt'] < 1
  ) {
    return false;
  }
  if (!isJobTimestamp(candidate['startedAt'])) return false;
  if (!isJobAttemptOutcome(candidate['outcome'])) return false;
  const endedAt = candidate['endedAt'];
  if (candidate['outcome'] === 'pending') {
    return endedAt === undefined && candidate['errorClass'] === undefined;
  }
  if (endedAt === undefined || !isJobTimestamp(endedAt)) return false;
  if (endedAt < candidate['startedAt']) return false;
  const errorClass = candidate['errorClass'];
  if (candidate['outcome'] === 'failed' || candidate['outcome'] === 'timed-out') {
    return errorClass !== undefined && isJobErrorClass(errorClass);
  }
  return errorClass === undefined;
}

/** Validate and freeze a closed-or-open attempt. */
export function toJobAttempt(value: {
  attempt: number;
  startedAt: string;
  outcome: string;
  endedAt?: string;
  errorClass?: string;
}): JobAttempt {
  if (!isJobAttempt(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
      message: `invalid job attempt: ${JSON.stringify(value)} (attempt >= 1; outcome in ${JOB_ATTEMPT_OUTCOMES.join(', ')}; pending attempts are open, every other outcome is closed with endedAt >= startedAt and errorClass on failed/timed-out)`,
      details: { outcomes: [...JOB_ATTEMPT_OUTCOMES] },
    });
  }
  return Object.freeze({
    attempt: value.attempt,
    startedAt: value.startedAt,
    outcome: value.outcome as JobAttemptOutcome,
    ...(value.endedAt !== undefined ? { endedAt: value.endedAt } : {}),
    ...(value.errorClass !== undefined ? { errorClass: value.errorClass } : {}),
  });
}

/** Close an attempt outcome (pure): returns a NEW frozen attempt. */
export function closeJobAttempt(
  attempt: JobAttempt,
  outcome: Exclude<JobAttemptOutcome, 'pending'>,
  endedAt: string,
  errorClass?: string,
): JobAttempt {
  if (attempt.outcome !== 'pending') {
    throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
      message: `attempt ${String(attempt.attempt)} is already closed (${attempt.outcome}); closed attempts are never rewritten`,
      details: { attempt: attempt.attempt, outcome: attempt.outcome },
    });
  }
  const closedAt = toJobTimestamp(endedAt);
  if (closedAt < attempt.startedAt) {
    throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
      message: `attempt ${String(attempt.attempt)} cannot end before it started (startedAt: ${attempt.startedAt}, endedAt: ${closedAt})`,
      details: { startedAt: attempt.startedAt, endedAt: closedAt },
    });
  }
  const requiresErrorClass = outcome === 'failed' || outcome === 'timed-out';
  if (requiresErrorClass && errorClass === undefined) {
    throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
      message: `attempt outcome ${outcome} requires an errorClass`,
    });
  }
  if (!requiresErrorClass && errorClass !== undefined) {
    throw new JobError(JOB_ERROR_CODES.INVALID_ATTEMPT, {
      message: `attempt outcome ${outcome} must not carry an errorClass`,
    });
  }
  return Object.freeze({
    attempt: attempt.attempt,
    startedAt: attempt.startedAt,
    outcome,
    endedAt: closedAt,
    ...(errorClass !== undefined ? { errorClass: toJobErrorClass(errorClass) } : {}),
  });

}

/** Closed principal types that may audit a consequential mutation. */
export const PRINCIPAL_TYPES = Object.freeze(['agent-body', 'expert', 'user', 'service', 'system'] as const);
export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

// ---------------------------------------------------------------------------
// Predicates / validators
// ---------------------------------------------------------------------------

export function isJobNamespace(value: unknown): value is JobNamespace {
  return typeof value === 'string' && NAMESPACE_PATTERN.test(value);
}

export function isJobName(value: unknown): value is JobName {
  return typeof value === 'string' && NAME_PATTERN.test(value);
}

export function isJobSemver(value: unknown): value is JobSemver {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function isJobId(value: unknown): value is JobId {
  return typeof value === 'string' && JOB_ID_PATTERN.test(value);
}

export function isCorrelationAddress(value: unknown): value is CorrelationAddress {
  return typeof value === 'string' && CORRELATION_ADDRESS_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isJobErrorClass(value: unknown): value is JobErrorClass {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isMutationName(value: unknown): value is MutationName {
  return typeof value === 'string' && MUTATION_NAME_PATTERN.test(value);
}

export function isJobState(value: unknown): value is JobState {
  return typeof value === 'string' && (JOB_STATES as readonly string[]).includes(value);
}

export function isTerminalJobState(value: unknown): value is TerminalJobState {
  return (
    typeof value === 'string' && (JOB_TERMINAL_STATES as readonly string[]).includes(value)
  );
}

export function isJobPriorityClass(value: unknown): value is JobPriorityClass {
  return (
    typeof value === 'string' && (JOB_PRIORITY_CLASSES as readonly string[]).includes(value)
  );
}

export function isJobAttemptOutcome(value: unknown): value is JobAttemptOutcome {
  return (
    typeof value === 'string' && (JOB_ATTEMPT_OUTCOMES as readonly string[]).includes(value)
  );
}

export function isJobFailureKind(value: unknown): value is JobFailureKind {
  return typeof value === 'string' && (JOB_FAILURE_KINDS as readonly string[]).includes(value);
}

/** Timestamps are canonical ms-precision UTC ISO-8601 strings. */
export function isJobTimestamp(value: unknown): value is JobTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

export function toJobNamespace(value: string): JobNamespace {
  if (!isJobNamespace(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job kind namespace: ${JSON.stringify(value)}`,
      details: { pattern: JOB_NAMESPACE_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toJobName(value: string): JobName {
  if (!isJobName(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job kind name: ${JSON.stringify(value)}`,
      details: { pattern: JOB_NAME_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toJobSemver(value: string): JobSemver {
  if (!isJobSemver(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job kind version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: JOB_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toJobId(value: string): JobId {
  if (!isJobId(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job id: ${JSON.stringify(value)}`,
      details: { pattern: JOB_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCorrelationAddress(value: string): CorrelationAddress {
  if (!isCorrelationAddress(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid correlation address: ${JSON.stringify(value)} (1..8 lowercase slash-separated segments)`,
      details: { pattern: CORRELATION_ADDRESS_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toJobErrorClass(value: string): JobErrorClass {
  if (!isJobErrorClass(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job error class: ${JSON.stringify(value)} (lowercase neutral identifier required; 'timeout' is reserved for timeout-policy failures)`,
      details: { pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toMutationName(value: string): MutationName {
  if (!isMutationName(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid mutation name: ${JSON.stringify(value)} (dotted lowercase identifier like job.submit)`,
      details: { pattern: MUTATION_NAME_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toJobTimestamp(value: string): JobTimestamp {
  if (!isJobTimestamp(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid job timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision, e.g. 2026-01-15T09:30:00.000Z)`,
      details: { pattern: JOB_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical job timestamp (Date#toISOString is always ms UTC). */
export function nowJobTimestamp(): JobTimestamp {
  return new Date().toISOString() as JobTimestamp;
}

/** Generate a fresh random job id (UUIDv4-based). */
export function newJobId(): JobId {
  return globalThis.crypto.randomUUID() as JobId;
}

/** Well-known error class for timeout-policy failures (reserved, branded). */
export const TIMEOUT_ERROR_CLASS = 'timeout' as JobErrorClass;

// ---------------------------------------------------------------------------
// Job kind identity
// ---------------------------------------------------------------------------

/** Identity of a job KIND (the definition's addressable name). */
export interface JobKindIdentity {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
}

export function isJobKindIdentity(value: unknown): value is JobKindIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isJobNamespace(candidate['namespace']) &&
    isJobName(candidate['name']) &&
    isJobSemver(candidate['version'])
  );
}

/** Validate and freeze a job kind identity. */
export function toJobKindIdentity(value: {
  namespace: string;
  name: string;
  version: string;
}): JobKindIdentity {
  if (!isJobKindIdentity(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job kind identity: ${JSON.stringify(value)}`,
      details: {
        namespace: JOB_NAMESPACE_PATTERN_SOURCE,
        name: JOB_NAME_PATTERN_SOURCE,
        version: JOB_VERSION_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

/** Stable key for a job kind: `<namespace>/<name>@<version>`. */
export function jobKindKey(kind: JobKindIdentity): string {
  return `${kind.namespace}/${kind.name}@${kind.version}`;
}

// ---------------------------------------------------------------------------
// Principal view (structurally PrincipalRef; never a raw provider identity)
// ---------------------------------------------------------------------------

/** Tenant-scoped principal that performs a consequential mutation. */
export interface PrincipalRef {
  readonly type: PrincipalType;
  readonly tenant: string;
  readonly principalId: string;
}

export function isPrincipalRef(value: unknown): value is PrincipalRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['type'] === 'string' &&
    (PRINCIPAL_TYPES as readonly string[]).includes(candidate['type']) &&
    typeof candidate['tenant'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['tenant']) &&
    typeof candidate['principalId'] === 'string' &&
    PRINCIPAL_ID_PATTERN.test(candidate['principalId'])
  );
}

/** Validate and freeze a principal ref; throws JOB_INVALID_PRINCIPAL otherwise. */
export function toPrincipalRef(value: {
  type: string;
  tenant: string;
  principalId: string;
}): PrincipalRef {
  if (!isPrincipalRef(value)) {
    if (
      typeof value?.type === 'string' &&
      !(PRINCIPAL_TYPES as readonly string[]).includes(value.type)
    ) {
      throw new JobError(JOB_ERROR_CODES.INVALID_PRINCIPAL, {
        message: `unknown principal type: ${JSON.stringify(value.type)} (known: ${PRINCIPAL_TYPES.join(', ')})`,
        details: { known: [...PRINCIPAL_TYPES] },
      });
    }
    throw new JobError(JOB_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `invalid principal ref: ${JSON.stringify(value)}`,
      details: {
        tenant: JOB_NAMESPACE_PATTERN_SOURCE,
        principalId: PRINCIPAL_ID_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Plain-JSON screening (canonical serializability of payloads)
// ---------------------------------------------------------------------------

/** True iff the value is plain JSON (canonically serializable, no undefined). */
export function isPlainJsonValue(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (Array.isArray(value)) return value.every((item) => isPlainJsonValue(item));
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      return Object.values(value).every((item) => isPlainJsonValue(item));
    }
    default:
      return false;
  }
}

/** Fail closed with JOB_INVALID_INPUT when a payload is not plain JSON. */
export function assertPlainJson(value: unknown, field: string): void {
  if (!isPlainJsonValue(value)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_INPUT, {
      message: `${field} must be plain JSON (canonically serializable: no undefined, non-finite numbers, bigints, dates or class instances)`,
      details: { field },
    });
  }
}

// ---------------------------------------------------------------------------
// Deep freeze
// ---------------------------------------------------------------------------

/** Recursively freeze a plain-JSON domain object; frozen inputs stay frozen. */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
