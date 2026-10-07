/**
 * Shared primitives for the Arena escalation-validation domain core
 * (Work Order C009; issue #116; spec/expert-escalation-api.md ES1.0
 * "Lifecycle" VALIDATING block + spec/evaluation.md EV1.0).
 *
 * House conventions (mirroring @arena/escalation's shared.ts, consumed —
 * never reimplemented — from there):
 *   - branded identifier types validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     all timestamps are injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline;
 *   - deep-freeze helpers so domain objects are immutable in place;
 *   - typed machine-readable verdicts — never a bare boolean.
 */

import type { PlainJsonValue } from '@arena/escalation';
import { isEscalationTimestamp, toEscalationTimestamp } from '@arena/escalation';

export { isEscalationTimestamp, toEscalationTimestamp };
export type { PlainJsonValue };

/**
 * Deep-freeze a (possibly nested) value IN PLACE and return it typed as
 * itself (the @arena/escalation helper is PlainJsonValue-scoped; this
 * generic form freezes domain objects without widening their types).
 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const entry of value) deepFreeze(entry);
      return Object.freeze(value);
    }
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    return Object.freeze(value);
  }
  return value;
}

/** Wire version of every escalation-validation payload shape. */
export const ESCALATION_VALIDATION_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type ValidationPlanId = string & { readonly __brand: 'ValidationPlanId' };
export type ValidationEntryId = string & { readonly __brand: 'ValidationEntryId' };
export type AdjudicationVerdictId = string & { readonly __brand: 'AdjudicationVerdictId' };
export type RevisionRequestId = string & { readonly __brand: 'RevisionRequestId' };

export const VALIDATION_PLAN_ID_PATTERN_SOURCE = '^vp_[0-9a-f]{32}$';
export const VALIDATION_ENTRY_ID_PATTERN_SOURCE = '^ve_[0-9a-f]{32}$';
export const ADJUDICATION_VERDICT_ID_PATTERN_SOURCE = '^av_[0-9a-f]{32}$';
export const REVISION_REQUEST_ID_PATTERN_SOURCE = '^rev_[0-9a-f]{32}$';

const VALIDATION_PLAN_ID_RE = new RegExp(VALIDATION_PLAN_ID_PATTERN_SOURCE);
const VALIDATION_ENTRY_ID_RE = new RegExp(VALIDATION_ENTRY_ID_PATTERN_SOURCE);
const ADJUDICATION_VERDICT_ID_RE = new RegExp(ADJUDICATION_VERDICT_ID_PATTERN_SOURCE);
const REVISION_REQUEST_ID_RE = new RegExp(REVISION_REQUEST_ID_PATTERN_SOURCE);

export function isValidationPlanId(value: unknown): value is ValidationPlanId {
  return typeof value === 'string' && VALIDATION_PLAN_ID_RE.test(value);
}

export function isValidationEntryId(value: unknown): value is ValidationEntryId {
  return typeof value === 'string' && VALIDATION_ENTRY_ID_RE.test(value);
}

export function isAdjudicationVerdictId(value: unknown): value is AdjudicationVerdictId {
  return typeof value === 'string' && ADJUDICATION_VERDICT_ID_RE.test(value);
}

export function isRevisionRequestId(value: unknown): value is RevisionRequestId {
  return typeof value === 'string' && REVISION_REQUEST_ID_RE.test(value);
}

function brand<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand a validation-plan id (vp_ + 32 lowercase hex). */
export function toValidationPlanId(value: string): ValidationPlanId {
  if (!isValidationPlanId(value)) {
    throw new TypeError(
      `invalid validation plan id: ${JSON.stringify(value)} (expected ${VALIDATION_PLAN_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<ValidationPlanId>(value);
}

/** Validate and brand a validation-history entry id (ve_ + 32 lowercase hex). */
export function toValidationEntryId(value: string): ValidationEntryId {
  if (!isValidationEntryId(value)) {
    throw new TypeError(
      `invalid validation entry id: ${JSON.stringify(value)} (expected ${VALIDATION_ENTRY_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<ValidationEntryId>(value);
}

/** Validate and brand an adjudication verdict id (av_ + 32 lowercase hex). */
export function toAdjudicationVerdictId(value: string): AdjudicationVerdictId {
  if (!isAdjudicationVerdictId(value)) {
    throw new TypeError(
      `invalid adjudication verdict id: ${JSON.stringify(value)} (expected ${ADJUDICATION_VERDICT_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<AdjudicationVerdictId>(value);
}

/** Validate and brand a revision request id (rev_ + 32 lowercase hex). */
export function toRevisionRequestId(value: string): RevisionRequestId {
  if (!isRevisionRequestId(value)) {
    throw new TypeError(
      `invalid revision request id: ${JSON.stringify(value)} (expected ${REVISION_REQUEST_ID_PATTERN_SOURCE})`,
    );
  }
  return brand<RevisionRequestId>(value);
}

/** Generate a fresh validation-history entry id (ve_ + 32 lowercase hex). */
export function newValidationEntryId(): ValidationEntryId {
  return toValidationEntryId(`ve_${crypto.randomUUID().replaceAll('-', '')}`);
}

/** Generate a fresh adjudication verdict id (av_ + 32 lowercase hex). */
export function newAdjudicationVerdictId(): AdjudicationVerdictId {
  return toAdjudicationVerdictId(`av_${crypto.randomUUID().replaceAll('-', '')}`);
}

/** Generate a fresh revision request id (rev_ + 32 lowercase hex). */
export function newRevisionRequestId(): RevisionRequestId {
  return toRevisionRequestId(`rev_${crypto.randomUUID().replaceAll('-', '')}`);
}

// ---------------------------------------------------------------------------
// Shared value helpers (strict, fail-closed)
// ---------------------------------------------------------------------------

/** A non-empty bounded string (1..4096 chars). */
export function requireBoundedString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw new TypeError(`${field} must be a non-empty string (<= 4096 chars)`);
  }
  return value;
}

/** A frozen non-empty string array. */
export function requireStringArray(values: unknown, field: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${field} must be a non-empty string array`);
  }
  for (const value of values) requireBoundedString(value, `${field} entry`);
  return Object.freeze([...values]);
}

/** A finite number in [0, 1] (normalized thresholds/scores). */
export function requireUnitInterval(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number in [0, 1]`);
  }
  return value;
}

/** A positive integer with an exclusive-or-inclusive upper bound. */
export function requirePositiveInt(value: unknown, field: string, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new TypeError(`${field} must be an integer in [1, ${max}]`);
  }
  return value;
}

/**
 * Strict-shape rejection helper: throws when `value` carries a field
 * outside the CLOSED field list (unknown fields are rejected, mirroring
 * @arena/verification's discipline — a smuggled authority-shaped field
 * can never ride inside a validation payload).
 */
export function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  typeName: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${typeName} rejects unknown field: ${JSON.stringify(key)}`);
    }
  }
}
