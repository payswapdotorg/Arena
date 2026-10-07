/**
 * Idempotency + correlation semantics for escalations (Work Order C001;
 * spec/expert-escalation-api.md ES1.0; architecture-lock rule 17).
 *
 * The submission identity of an escalation is the triple
 *
 *     (tenant id, idempotency key, correlation id)
 *
 * Submitting the same identity twice:
 *   - with the SAME request digest ⇒ REPLAY — the original request id
 *     (and its record) is returned; nothing new is created;
 *   - with a DIFFERENT request digest ⇒ typed rejection
 *     (ESCALATION_IDENTITY_CONFLICT — an idempotency key is never
 *     silently rebound to new content).
 *
 * The resolution is a MACHINE-READABLE tri-state verdict (house verdict
 * style — never a bare boolean): 'created' | 'replay' | 'conflict'.
 */

import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import { createEscalationRecord } from './lifecycle.js';
import type { EscalationRecord } from './lifecycle.js';
import type { EscalationRequest } from './request.js';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { isCorrelationId, isIdempotencyKey } from '@arena/protocol-core';
import type { TenantId } from './shared.js';
import { isTenantId } from './shared.js';

/** The addressability triple that makes escalation submissions idempotent. */
export interface EscalationSubmissionIdentity {
  readonly tenantId: TenantId;
  readonly idempotencyKey: IdempotencyKey;
  readonly correlationId: CorrelationId;
}

export function isEscalationSubmissionIdentity(value: unknown): value is EscalationSubmissionIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantId(candidate['tenantId']) &&
    isIdempotencyKey(candidate['idempotencyKey']) &&
    isCorrelationId(candidate['correlationId'])
  );
}

/** The submission identity of an escalation request. */
export function escalationSubmissionIdentity(request: EscalationRequest): EscalationSubmissionIdentity {
  return Object.freeze({
    tenantId: request.tenantId,
    idempotencyKey: request.idempotencyKey,
    correlationId: request.correlationId,
  });
}

/** Stable composite key (identifier charset contains no ':'). */
export function escalationSubmissionKey(identity: EscalationSubmissionIdentity): string {
  return `${identity.tenantId}:${identity.idempotencyKey}:${identity.correlationId}`;
}

/** The composite submission key of a request (convenience). */
export function requestSubmissionKey(request: EscalationRequest): string {
  return escalationSubmissionKey(escalationSubmissionIdentity(request));
}

// ---------------------------------------------------------------------------
// Machine-readable resolution
// ---------------------------------------------------------------------------

export const ESCALATION_IDEMPOTENCY_OUTCOMES = Object.freeze([
  'created',
  'replay',
  'conflict',
] as const);
export type EscalationIdempotencyOutcome =
  (typeof ESCALATION_IDEMPOTENCY_OUTCOMES)[number];

export type EscalationIdempotencyResolution =
  | { readonly outcome: 'created'; readonly record: EscalationRecord }
  | { readonly outcome: 'replay'; readonly record: EscalationRecord; readonly originalRequestId: string }
  | {
      readonly outcome: 'conflict';
      readonly existingRequestId: string;
      readonly existingDigest: string;
      readonly submittedDigest: string;
    };

/**
 * Resolve a submission against the idempotency index. PURE: the caller
 * supplies the existing record for the identity (if any) plus the
 * freshly-parsed request being submitted.
 */
export function resolveEscalationIdempotency(
  submitted: EscalationRequest,
  existing: EscalationRecord | undefined,
): EscalationIdempotencyResolution {
  if (existing === undefined) {
    return { outcome: 'created', record: createStagedRecord(submitted) };
  }
  if (existing.request.digest === submitted.digest) {
    return {
      outcome: 'replay',
      record: existing,
      originalRequestId: existing.request.requestId,
    };
  }
  return {
    outcome: 'conflict',
    existingRequestId: existing.request.requestId,
    existingDigest: existing.request.digest,
    submittedDigest: submitted.digest,
  };
}

/** Typed rejection for a conflicting re-submission (fail-closed). */
export function escalationConflictError(resolution: Extract<EscalationIdempotencyResolution, { readonly outcome: 'conflict' }>): EscalationError {
  return new EscalationError(ESCALATION_ERROR_CODES.IDENTITY_CONFLICT, {
    message: `idempotency key already bound to a different request digest (existing request ${resolution.existingRequestId})`,
    details: {
      existingRequestId: resolution.existingRequestId,
      existingDigest: resolution.existingDigest,
      submittedDigest: resolution.submittedDigest,
    },
  });
}

function createStagedRecord(request: EscalationRequest): EscalationRecord {
  return createEscalationRecord(request, request.createdAt);
}
