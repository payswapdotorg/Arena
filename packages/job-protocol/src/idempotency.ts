/**
 * Idempotency + correlation addressability (Work Order A015 gate 4;
 * architecture-lock rule 17: "Long-running jobs are idempotent and
 * correlation-addressable"; requirement R27).
 *
 * The submission identity of a job is the triple
 *
 *     (idempotency scope, idempotency key, correlation id)
 *
 * where the scope comes from the JobDefinition's idempotency semantics
 * (the scope qualifies the key: two definitions with DIFFERENT scopes use
 * independent key spaces). Submitting the same identity twice:
 *   - with the SAME definition digest ⇒ returns the SAME job record
 *     (idempotent hit — no duplicate execution);
 *   - with a DIFFERENT definition digest ⇒ JOB_IDENTITY_CONFLICT
 *     (an idempotency key is never silently rebound to new content).
 *
 * Jobs are addressable BOTH by job id and by correlation id.
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import { JOB_ERROR_CODES, JobError } from './errors.js';
import type { JobRecord } from './record.js';
import type { NeutralId } from './shared.js';
import { toNeutralId } from './shared.js';

// ---------------------------------------------------------------------------
// Submission identity
// ---------------------------------------------------------------------------

/** The addressability triple that makes submissions idempotent. */
export interface JobSubmissionIdentity {
  readonly idempotencyScope: NeutralId;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
}

export function isJobSubmissionIdentity(value: unknown): value is JobSubmissionIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['idempotencyScope'] === 'string' &&
    /^[a-z][a-z0-9-]{0,63}$/.test(candidate['idempotencyScope']) &&
    isIdempotencyKey(candidate['idempotencyKey']) &&
    isCorrelationId(candidate['correlationId'])
  );
}

/** Validate and freeze a submission identity. */
export function toJobSubmissionIdentity(input: {
  idempotencyScope: string;
  idempotencyKey: string;
  correlationId: string;
}): JobSubmissionIdentity {
  if (!isJobSubmissionIdentity(input)) {
    throw new JobError(JOB_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid job submission identity: ${JSON.stringify(input)} (scope: neutral id; idempotencyKey / correlationId: identifier charset)`,
      details: {
        scope: '^[a-z][a-z0-9-]{0,63}$',
        identifier: '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$',
      },
    });
  }
  return Object.freeze({
    idempotencyScope: toNeutralId(input.idempotencyScope),
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId,
  });
}

/**
 * Stable composite key for a submission identity. The identifier charset
 * contains no ':', so the composite is unambiguous.
 */
export function jobSubmissionKey(identity: JobSubmissionIdentity): string {
  return `${identity.idempotencyScope}:${identity.idempotencyKey}:${identity.correlationId}`;
}

/** The submission identity of a job record. */
export function jobSubmissionIdentityOf(record: JobRecord): JobSubmissionIdentity {
  return Object.freeze({
    idempotencyScope: record.idempotencyScope,
    idempotencyKey: record.idempotencyKey,
    correlationId: record.correlationId,
  });
}

/** True iff two submission identities are the same (scope, key, correlation). */
export function isSameJobSubmission(a: JobSubmissionIdentity, b: JobSubmissionIdentity): boolean {
  return jobSubmissionKey(a) === jobSubmissionKey(b);
}

// ---------------------------------------------------------------------------
// Idempotent re-submission resolution (fail-closed on conflicts)
// ---------------------------------------------------------------------------

/** Outcome of resolving an idempotent re-submission. */
export type ResubmissionResolution =
  | { readonly outcome: 'idempotent-hit'; readonly record: JobRecord }
  | { readonly outcome: 'fresh-submission' };

/**
 * Resolve a re-submission against an existing record bound to the same
 * submission identity:
 *   - same definition digest ⇒ { outcome: 'idempotent-hit', record } — the
 *     caller MUST return the existing record and MUST NOT execute again;
 *   - different definition digest ⇒ throws JOB_IDENTITY_CONFLICT (an
 *     idempotency key is never silently rebound to different content);
 *   - no existing record ⇒ { outcome: 'fresh-submission' }.
 */
export function resolveIdempotentSubmission(
  existing: JobRecord | undefined,
  attemptedDefinitionDigest: string,
): ResubmissionResolution {
  if (existing === undefined) {
    return { outcome: 'fresh-submission' };
  }
  if (existing.definitionDigest === attemptedDefinitionDigest) {
    return { outcome: 'idempotent-hit', record: existing };
  }
  throw new JobError(JOB_ERROR_CODES.IDENTITY_CONFLICT, {
    message: `idempotency key ${existing.idempotencyKey} (scope ${existing.idempotencyScope}, correlation ${existing.correlationId}) is already bound to definition digest ${existing.definitionDigest}; reusing it for a DIFFERENT definition (${attemptedDefinitionDigest}) is forbidden`,
    details: {
      idempotencyKey: existing.idempotencyKey,
      idempotencyScope: existing.idempotencyScope,
      correlationId: existing.correlationId,
      bound: existing.definitionDigest,
      attempted: attemptedDefinitionDigest,
    },
  });
}

/**
 * Guard form of the same rule: returns silently on an idempotent hit,
 * throws JOB_IDENTITY_CONFLICT on a conflicting re-submission.
 */
export function assertIdempotentResubmission(
  existing: JobRecord,
  attemptedDefinitionDigest: string,
): void {
  resolveIdempotentSubmission(existing, attemptedDefinitionDigest);
}
