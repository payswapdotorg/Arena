/**
 * JobDefinition — the versioned, content-addressed blueprint of a job kind
 * (Work Order A015 gate 2; requirements R26, R27).
 *
 * A definition binds:
 *   - a job KIND identity (namespace/name/version),
 *   - an input schema ref (versioned SchemaRef — the DEFINITION references
 *     the schema; schema VALIDATION authority stays with the domain that
 *     owns the schema — architecture-lock rule 16: one responsibility, one
 *     authority; this protocol layer never judges domain inputs),
 *   - a correlation address (the address space jobs of this kind live in —
 *     lock rule 17: jobs are correlation-addressable),
 *   - idempotency semantics (the scope within which an idempotency key is
 *     unique per correlation id),
 *   - a timeout policy (pure data: timeoutMs per attempt),
 *   - a retry policy (pure data: maxAttempts, backoff schedule, retryable
 *     error classes),
 *   - a priority class and resource hints.
 *
 * Content addressing: the definition's sha256 digest is computed over the
 * canonical JSON serialization of the digest-free view with
 * @arena/protocol-core's digestCanonical — NEVER reimplemented here.
 * Registry-style dedup: two structurally equal definitions have the SAME
 * digest (construction normalizes defaults first, so "priority omitted"
 * and "priority: 'normal'" are the same definition); any content change
 * yields a different digest. Rebinding an idempotency key that was already
 * bound to a DIFFERENT definition digest is rejected as a conflict
 * (JOB_IDENTITY_CONFLICT — see idempotency.ts).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { isSchemaRef, parseSchemaRef } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import type {
  CorrelationAddress,
  ContentDigest,
  JobKindIdentity,
  JobPriorityClass,
  NeutralId,
} from './shared.js';
import {
  isContentDigest,
  isCorrelationAddress,
  isJobKindIdentity,
  isJobPriorityClass,
  isNeutralId,
  toCorrelationAddress,
  toJobKindIdentity,
  toNeutralId,
} from './shared.js';

/** Wire version of the job definition shape. */
export const JOB_DEFINITION_VERSION = 1 as const;

/** Priority classes (claim arbitration data; classification only in v1). */
export const JOB_PRIORITY_ORDER = Object.freeze(['low', 'normal', 'high', 'critical'] as const);

// ---------------------------------------------------------------------------
// Policy shapes (pure data — no behavior, no wall clocks)
// ---------------------------------------------------------------------------

/** Idempotency semantics: the scope that qualifies an idempotency key. */
export interface IdempotencySemantics {
  /** Scope within which (idempotencyKey, correlationId) is unique. */
  readonly scope: NeutralId;
  /** How long dedup memory SHOULD be retained (pure data; 1..2^31-1 ms). */
  readonly retentionMs?: number;
}

/** Timeout policy: per-attempt wall-clock budget (pure data). */
export interface TimeoutPolicy {
  readonly timeoutMs: number;
}

/**
 * Retry policy (pure data): `maxAttempts` TOTAL attempts (>= 1);
 * `backoffScheduleMs[i]` is the delay after the (i+1)-th attempt fails
 * (the last entry repeats when the schedule is shorter than needed; an
 * empty schedule means immediate retry); `retryableErrorClasses` lists the
 * error classes that MAY be retried (everything else fails terminally).
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffScheduleMs: readonly number[];
  readonly retryableErrorClasses: readonly string[];
}

/** Resource hints (pure data; advisory, never enforced by this layer). */
export interface ResourceHints {
  readonly cpu?: number;
  readonly memoryMb?: number;
  readonly weight?: number;
}

// ---------------------------------------------------------------------------
// JobDefinition
// ---------------------------------------------------------------------------

export interface JobDefinition {
  readonly definitionVersion: typeof JOB_DEFINITION_VERSION;
  readonly kind: JobKindIdentity;
  /** Versioned ref of the schema that job inputs claim to satisfy. */
  readonly inputSchema: SchemaRef;
  readonly correlationAddress: CorrelationAddress;
  readonly idempotency: IdempotencySemantics;
  readonly timeout: TimeoutPolicy;
  readonly retry: RetryPolicy;
  readonly priority: JobPriorityClass;
  readonly resourceHints: ResourceHints;
  /** sha256 over the canonical serialization of the digest-free view. */
  readonly digest: ContentDigest;
}

export interface CreateJobDefinitionInput {
  readonly kind: {
    namespace: string;
    name: string;
    version: string;
  };
  readonly inputSchema: SchemaRef | string;
  readonly correlationAddress: string;
  readonly idempotency: {
    scope: string;
    retentionMs?: number;
  };
  readonly timeout: {
    timeoutMs: number;
  };
  readonly retry: {
    maxAttempts: number;
    backoffScheduleMs?: readonly number[];
    retryableErrorClasses?: readonly string[];
  };
  readonly priority?: JobPriorityClass;
  readonly resourceHints?: {
    cpu?: number;
    memoryMb?: number;
    weight?: number;
  };
}

function invalidDefinition(message: string, details?: Readonly<Record<string, unknown>>): never {
  throw new JobError(JOB_ERROR_CODES.INVALID_DEFINITION, {
    message,
    ...(details !== undefined ? { details } : {}),
  });
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateRetryPolicy(retry: CreateJobDefinitionInput['retry']): RetryPolicy {
  if (!isPositiveInteger(retry.maxAttempts)) {
    invalidDefinition(
      `retry.maxAttempts must be an integer >= 1 (total attempts allowed), got ${String(retry.maxAttempts)}`,
    );
  }
  const backoff = retry.backoffScheduleMs ?? [];
  if (!Array.isArray(backoff)) {
    invalidDefinition('retry.backoffScheduleMs must be an array of non-negative delays (ms)');
  }
  if (backoff.length > retry.maxAttempts - 1) {
    invalidDefinition(
      `retry.backoffScheduleMs has ${String(backoff.length)} entries but at most maxAttempts - 1 = ${String(retry.maxAttempts - 1)} retries can be scheduled`,
    );
  }
  const schedule: number[] = [];
  const seen = new Set<string>();
  for (const entry of backoff) {
    if (!isNonNegativeFinite(entry)) {
      invalidDefinition(
        `retry.backoffScheduleMs entries must be finite non-negative numbers (ms), got ${String(entry)}`,
      );
    }
    schedule.push(entry);
  }
  const classes: string[] = [];
  for (const entry of retry.retryableErrorClasses ?? []) {
    if (typeof entry !== 'string' || !isNeutralId(entry)) {
      invalidDefinition(
        `retry.retryableErrorClasses entries must be neutral identifiers, got ${JSON.stringify(entry)}`,
      );
    }
    if (seen.has(entry)) {
      invalidDefinition(`retry.retryableErrorClasses contains a duplicate: ${entry}`);
    }
    seen.add(entry);
    classes.push(entry);
  }
  return Object.freeze({
    maxAttempts: retry.maxAttempts,
    backoffScheduleMs: Object.freeze(schedule),
    retryableErrorClasses: Object.freeze(classes),
  });
}

function validateTimeoutPolicy(timeout: CreateJobDefinitionInput['timeout']): TimeoutPolicy {
  if (!isPositiveInteger(timeout.timeoutMs)) {
    invalidDefinition(
      `timeout.timeoutMs must be an integer >= 1 (per-attempt wall-clock budget in ms), got ${String(timeout.timeoutMs)}`,
    );
  }
  return Object.freeze({ timeoutMs: timeout.timeoutMs });
}

function validateIdempotency(
  idempotency: CreateJobDefinitionInput['idempotency'],
): IdempotencySemantics {
  if (typeof idempotency !== 'object' || idempotency === null) {
    invalidDefinition('idempotency semantics are required (lock rule 17: jobs are idempotent)');
  }
  const scope = toNeutralId(idempotency.scope);
  if (idempotency.retentionMs !== undefined && !isPositiveInteger(idempotency.retentionMs)) {
    invalidDefinition(
      `idempotency.retentionMs must be an integer >= 1 (ms), got ${String(idempotency.retentionMs)}`,
    );
  }
  return Object.freeze({
    scope,
    ...(idempotency.retentionMs !== undefined
      ? { retentionMs: idempotency.retentionMs }
      : {}),
  });
}

function validateResourceHints(hints: CreateJobDefinitionInput['resourceHints']): ResourceHints {
  if (hints === undefined) return Object.freeze({});
  if (typeof hints !== 'object' || hints === null) {
    invalidDefinition('resourceHints must be an object when present');
  }
  if (hints.cpu !== undefined && !(typeof hints.cpu === 'number' && hints.cpu > 0)) {
    invalidDefinition(`resourceHints.cpu must be a positive number, got ${String(hints.cpu)}`);
  }
  if (
    hints.memoryMb !== undefined &&
    !(typeof hints.memoryMb === 'number' && Number.isInteger(hints.memoryMb) && hints.memoryMb > 0)
  ) {
    invalidDefinition(
      `resourceHints.memoryMb must be a positive integer, got ${String(hints.memoryMb)}`,
    );
  }
  if (
    hints.weight !== undefined &&
    !(typeof hints.weight === 'number' && hints.weight >= 0 && hints.weight <= 1000)
  ) {
    invalidDefinition(
      `resourceHints.weight must be a number in [0, 1000], got ${String(hints.weight)}`,
    );
  }
  return Object.freeze({
    ...(hints.cpu !== undefined ? { cpu: hints.cpu } : {}),
    ...(hints.memoryMb !== undefined ? { memoryMb: hints.memoryMb } : {}),
    ...(hints.weight !== undefined ? { weight: hints.weight } : {}),
  });
}

/** The digest-free view of a definition — exactly what the digest covers. */
export interface JobDefinitionView {
  readonly definitionVersion: typeof JOB_DEFINITION_VERSION;
  readonly kind: JobKindIdentity;
  readonly inputSchema: SchemaRef;
  readonly correlationAddress: CorrelationAddress;
  readonly idempotency: IdempotencySemantics;
  readonly timeout: TimeoutPolicy;
  readonly retry: RetryPolicy;
  readonly priority: JobPriorityClass;
  readonly resourceHints: ResourceHints;
}

/** The digest-free view of a definition (what the digest commits to). */
export function jobDefinitionView(definition: JobDefinition): JobDefinitionView {
  return {
    definitionVersion: definition.definitionVersion,
    kind: definition.kind,
    inputSchema: definition.inputSchema,
    correlationAddress: definition.correlationAddress,
    idempotency: definition.idempotency,
    timeout: definition.timeout,
    retry: definition.retry,
    priority: definition.priority,
    resourceHints: definition.resourceHints,
  };
}

/**
 * Compute the sha256 digest over the canonical serialization of the
 * digest-free view (registry semantics: same view ⇒ same digest).
 */
export async function computeJobDefinitionDigest(
  view: JobDefinitionView,
): Promise<ContentDigest> {
  const digest = await digestCanonical({
    definitionVersion: view.definitionVersion,
    kind: view.kind,
    inputSchema: view.inputSchema,
    correlationAddress: view.correlationAddress,
    idempotency: view.idempotency,
    timeout: view.timeout,
    retry: {
      maxAttempts: view.retry.maxAttempts,
      backoffScheduleMs: [...view.retry.backoffScheduleMs],
      retryableErrorClasses: [...view.retry.retryableErrorClasses],
    },
    priority: view.priority,
    resourceHints: view.resourceHints,
  });
  return digest as ContentDigest;
}

/**
 * Create a job definition: validates every field, normalizes defaults
 * (priority 'normal', empty backoff schedule, empty retryable classes,
 * empty resource hints), computes the sha256 digest over the canonical
 * digest-free view, and deep-freezes the result. Deterministic: the same
 * input always yields the same digest.
 */
export async function createJobDefinition(
  input: CreateJobDefinitionInput,
): Promise<JobDefinition> {
  if (typeof input !== 'object' || input === null) {
    invalidDefinition('a job definition input is required');
  }
  const kind = toJobKindIdentity(input.kind);
  const inputSchema =
    typeof input.inputSchema === 'string' ? parseSchemaRef(input.inputSchema) : input.inputSchema;
  if (!isSchemaRef(inputSchema)) {
    invalidDefinition(
      `inputSchema must be a valid versioned SchemaRef, got ${JSON.stringify(input.inputSchema)}`,
    );
  }
  const correlationAddress = toCorrelationAddress(input.correlationAddress);
  const idempotency = validateIdempotency(input.idempotency);
  const timeout = validateTimeoutPolicy(input.timeout);
  const retry = validateRetryPolicy(input.retry);
  const priority = input.priority ?? 'normal';
  if (!isJobPriorityClass(priority)) {
    invalidDefinition(
      `priority must be one of ${JOB_PRIORITY_ORDER.join(', ')}, got ${JSON.stringify(input.priority)}`,
    );
  }
  const resourceHints = validateResourceHints(input.resourceHints);

  const view: JobDefinitionView = {
    definitionVersion: JOB_DEFINITION_VERSION,
    kind,
    inputSchema,
    correlationAddress,
    idempotency,
    timeout,
    retry,
    priority,
    resourceHints,
  };
  const digest = await computeJobDefinitionDigest(view);

  const definition: JobDefinition = {
    ...view,
    digest,
  };
  return deepFreezeDefinition(definition);
}

function deepFreezeDefinition(definition: JobDefinition): JobDefinition {
  const frozen: JobDefinition = Object.freeze({
    definitionVersion: definition.definitionVersion,
    kind: Object.freeze({ ...definition.kind }),
    inputSchema: Object.freeze({ ...definition.inputSchema }),
    correlationAddress: definition.correlationAddress,
    idempotency: definition.idempotency,
    timeout: definition.timeout,
    retry: Object.freeze({
      maxAttempts: definition.retry.maxAttempts,
      backoffScheduleMs: Object.freeze([...definition.retry.backoffScheduleMs]),
      retryableErrorClasses: Object.freeze([...definition.retry.retryableErrorClasses]),
    }),
    priority: definition.priority,
    resourceHints: definition.resourceHints,
    digest: definition.digest,
  });
  return frozen;
}

/** Structural (non-throwing) check for a job definition (digest included). */
export function isJobDefinition(value: unknown): value is JobDefinition {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['definitionVersion'] !== JOB_DEFINITION_VERSION) return false;
  if (!isJobKindIdentity(candidate['kind'])) return false;
  if (!isSchemaRef(candidate['inputSchema'])) return false;
  if (!isCorrelationAddress(candidate['correlationAddress'])) return false;
  const idempotency = candidate['idempotency'];
  if (
    typeof idempotency !== 'object' ||
    idempotency === null ||
    !isNeutralId((idempotency as Record<string, unknown>)['scope'])
  ) {
    return false;
  }
  const timeout = candidate['timeout'];
  if (
    typeof timeout !== 'object' ||
    timeout === null
  ) {
    return false;
  }
  const timeoutMs = (timeout as Record<string, unknown>)['timeoutMs'];
  if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    return false;
  }
  const retry = candidate['retry'];
  if (typeof retry !== 'object' || retry === null) return false;
  const retryRecord = retry as Record<string, unknown>;
  if (
    typeof retryRecord['maxAttempts'] !== 'number' ||
    !Number.isInteger(retryRecord['maxAttempts']) ||
    retryRecord['maxAttempts'] < 1 ||
    !Array.isArray(retryRecord['backoffScheduleMs']) ||
    !Array.isArray(retryRecord['retryableErrorClasses'])
  ) {
    return false;
  }
  if (!isJobPriorityClass(candidate['priority'])) return false;
  if (candidate['resourceHints'] === undefined) return false;
  return isContentDigest(candidate['digest']);
}

/**
 * Re-compute a definition's digest and compare it with the claimed digest.
 * FAILS CLOSED with JOB_TAMPERED on any mismatch — a mutation of any
 * definition field is always detected. Returns the verified digest.
 */
export async function verifyJobDefinition(
  definition: JobDefinition,
  expectedDigest?: ContentDigest,
): Promise<ContentDigest> {
  if (!isJobDefinition(definition)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_DEFINITION, {
      message: 'not a structurally valid job definition',
    });
  }
  const actual = await computeJobDefinitionDigest(jobDefinitionView(definition));
  const claimed = expectedDigest ?? definition.digest;
  if (actual !== claimed) {
    throw new JobError(JOB_ERROR_CODES.TAMPERED, {
      message: `job definition digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual },
    });
  }
  return actual;
}

/** Stable registry key: `<kind namespace>/<name>@<version>`. */
export function jobDefinitionKey(definition: JobDefinition): string {
  return `${definition.kind.namespace}/${definition.kind.name}@${definition.kind.version}`;
}

// ---------------------------------------------------------------------------
// Pure retry-policy decision helpers (shared by record transitions and the
// orchestrator; deterministic, clock-free)
// ---------------------------------------------------------------------------

/** Total attempts still available after `attempts` attempts started. */
export function retryAttemptsRemaining(retry: RetryPolicy, attempts: number): number {
  return Math.max(0, retry.maxAttempts - attempts);
}

/** True iff `errorClass` is declared retryable by the policy. */
export function isRetryableErrorClass(retry: RetryPolicy, errorClass: string): boolean {
  return (retry.retryableErrorClasses as readonly string[]).includes(errorClass);
}

/**
 * Backoff delay (ms) after the `failedAttempt`-th attempt fails: the
 * schedule's [failedAttempt - 1] entry, or the LAST entry when the schedule
 * is shorter, or 0 when the schedule is empty. Pure data — no wall clock.
 */
export function retryBackoffMs(retry: RetryPolicy, failedAttempt: number): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new JobError(JOB_ERROR_CODES.INVALID_POLICY, {
      message: `failedAttempt must be an integer >= 1, got ${String(failedAttempt)}`,
    });
  }
  if (retry.backoffScheduleMs.length === 0) return 0;
  const index = Math.min(failedAttempt - 1, retry.backoffScheduleMs.length - 1);
  const entry = retry.backoffScheduleMs[index];
  return entry ?? 0;
}

/** Timestamp validity re-export is intentionally NOT duplicated here. */
