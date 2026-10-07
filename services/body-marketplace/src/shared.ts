/**
 * Shared structural helpers for @arena/body-marketplace-service (Work
 * Order C014). Mirrors the house `shared.ts` convention of the sibling
 * service fabrics (A031/A032 capability-improvement discipline): small
 * closed-pattern guards, deep freezing and strict shape validation —
 * nothing else. Vocabulary constants live with their owning module
 * (pretraining / listings / fabric).
 */

import { digestCanonical, sha256Hex } from '@arena/protocol-core';
import { isContentDigest } from '@arena/agent-body';
import type { BodyMarketplaceErrorCode } from './errors.js';
import { BodyMarketplaceError } from './errors.js';

// ---------------------------------------------------------------------------
// Patterns (the house vocabulary shapes — documented, not redefined)
// ---------------------------------------------------------------------------

export const BODY_MARKETPLACE_TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const BODY_MARKETPLACE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,63}$';
export const BODY_MARKETPLACE_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,512}$';
export const BODY_MARKETPLACE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const CORRELATION_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const IDEMPOTENCY_KEY_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const TENANT_PATTERN = new RegExp(BODY_MARKETPLACE_TENANT_PATTERN_SOURCE);
const ID_PATTERN = new RegExp(BODY_MARKETPLACE_ID_PATTERN_SOURCE);
const TEXT_PATTERN = new RegExp(BODY_MARKETPLACE_TEXT_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(BODY_MARKETPLACE_TIMESTAMP_PATTERN_SOURCE);
const CORRELATION_ID_PATTERN = new RegExp(CORRELATION_ID_PATTERN_SOURCE);
const IDEMPOTENCY_KEY_PATTERN = new RegExp(IDEMPOTENCY_KEY_PATTERN_SOURCE);

/** The reserved public tenant namespace (visibility boundary, R24/S1.0). */
export const PUBLIC_TENANT = 'public';

/** Structural tenant guard. */
export function isTenant(value: unknown): value is string {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

/** Tenant-scoped visibility: a reader sees its own tenant or the public tenant. */
export function isTenantVisible(recordTenant: string, readerTenant: string): boolean {
  return recordTenant === readerTenant || recordTenant === PUBLIC_TENANT;
}

/** Structural marketplace id guard (listing / run / grant ids). */
export function isBodyMarketplaceId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Structural neutral-text guard (summaries / grounds / notes). */
export function isBodyMarketplaceText(value: unknown): value is string {
  return typeof value === 'string' && TEXT_PATTERN.test(value);
}

/** Structural ms-precision UTC timestamp guard. */
export function isBodyMarketplaceTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value);
}

/** Structural correlation-id guard. */
export function isBodyMarketplaceCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
}

/** Structural idempotency-key guard (lock rule 17). */
export function isBodyMarketplaceIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Deep freezing (house discipline: every record is deeply immutable)
// ---------------------------------------------------------------------------

/** Recursively freeze a plain record/array value (house deepFreeze). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict shape validation (house expectFields / expectEnumMember)
// ---------------------------------------------------------------------------

/** Plain-object structural check. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Closed-enum membership check. */
export function isEnumMember<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
): value is T {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value);
}

/** Strict closed-shape validation: exactly `required` + `optional` fields. */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: BodyMarketplaceErrorCode,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new BodyMarketplaceError(code, { message: `${context} must be a plain object` });
  }
  for (const field of required) {
    if (!(field in value)) {
      throw new BodyMarketplaceError(code, {
        message: `${context} is missing required field ${JSON.stringify(field)}`,
        details: { field },
      });
    }
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new BodyMarketplaceError(code, {
        message: `${context} carries unknown field ${JSON.stringify(key)}`,
        details: { field: key },
      });
    }
  }
  return value;
}

/** Closed-enum field extraction (fail-closed on unknown vocabulary). */
export function expectEnumMember<T extends string>(
  value: unknown,
  vocabulary: readonly T[],
  code: BodyMarketplaceErrorCode,
  context: string,
): T {
  if (!isEnumMember(value, vocabulary)) {
    throw new BodyMarketplaceError(code, {
      message: `${context} must be one of the closed vocabulary ${JSON.stringify(vocabulary)}`,
      details: { known: [...vocabulary] },
    });
  }
  return value;
}

/** Digest field validation (64 lowercase hex, A002 ContentDigest discipline). */
export function expectDigest(
  value: unknown,
  code: BodyMarketplaceErrorCode,
  context: string,
): string {
  if (!isContentDigest(value)) {
    throw new BodyMarketplaceError(code, {
      message: `${context} must be a lowercase sha256 hex digest`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Content addressing (sha256 over canonical JSON — always the house
// digestCanonical primitive, never reimplemented)
// ---------------------------------------------------------------------------

/** Digest over the canonical JSON of a view (content addressing). */
export function viewDigest(view: unknown): Promise<string> {
  return digestCanonical(view);
}

/** Convenience digest over a canonical string (used for idempotency keys). */
export function canonicalDigestOf(text: string): Promise<string> {
  return sha256Hex(text);
}
