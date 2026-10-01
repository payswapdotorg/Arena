/**
 * Shared structural helpers for @arena/marketplace-artifacts-fabric
 * (Work Order A032). Mirrors the house `shared.ts` convention of the
 * A009-A014 domain packages: small closed-pattern guards, deep freezing
 * and strict shape validation — nothing else. Vocabulary constants live
 * with their owning module (offers / gate / grants / reviews / queries).
 */

import { digestCanonical, sha256Hex } from '@arena/protocol-core';
import { isContentDigest } from '@arena/artifact-protocol';
import type { MarketplaceErrorCode } from './errors.js';
import { MarketplaceError } from './errors.js';

// ---------------------------------------------------------------------------
// Patterns (mirrored from the owning packages; documented, not redefined
// semantically — each is the pattern of the upstream guard it accompanies)
// ---------------------------------------------------------------------------

export const MARKETPLACE_TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const MARKETPLACE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,63}$';
export const MARKETPLACE_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,512}$';
export const MARKETPLACE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const CORRELATION_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const TENANT_PATTERN = new RegExp(MARKETPLACE_TENANT_PATTERN_SOURCE);
const MARKETPLACE_ID_PATTERN = new RegExp(MARKETPLACE_ID_PATTERN_SOURCE);
const TEXT_PATTERN = new RegExp(MARKETPLACE_TEXT_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(MARKETPLACE_TIMESTAMP_PATTERN_SOURCE);
const CORRELATION_ID_PATTERN = new RegExp(CORRELATION_ID_PATTERN_SOURCE);

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

/** Structural marketplace id guard (offer / grant / review ids). */
export function isMarketplaceId(value: unknown): value is string {
  return typeof value === 'string' && MARKETPLACE_ID_PATTERN.test(value);
}

/** Structural neutral-text guard (title / summary / grounds / notes). */
export function isMarketplaceText(value: unknown): value is string {
  return typeof value === 'string' && TEXT_PATTERN.test(value);
}

/** Structural ms-precision UTC timestamp guard. */
export function isMarketplaceTimestamp(value: unknown): value is string {
  return typeof value === 'string' && TIMESTAMP_PATTERN.test(value);
}

/** Structural correlation-id guard. */
export function isMarketplaceCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && CORRELATION_ID_PATTERN.test(value);
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
  code: MarketplaceErrorCode,
  context: string,
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new MarketplaceError(code, { message: `${context} must be a plain object` });
  }
  for (const field of required) {
    if (!(field in value)) {
      throw new MarketplaceError(code, {
        message: `${context} is missing required field ${JSON.stringify(field)}`,
        details: { field },
      });
    }
  }
  const allowed = new Set<string>([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new MarketplaceError(code, {
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
  code: MarketplaceErrorCode,
  context: string,
): T {
  if (!isEnumMember(value, vocabulary)) {
    throw new MarketplaceError(code, {
      message: `${context} must be one of the closed vocabulary ${JSON.stringify(vocabulary)}`,
      details: { known: [...vocabulary] },
    });
  }
  return value;
}

/** Digest field validation (64 lowercase hex, A002 ContentDigest discipline). */
export function expectDigest(value: unknown, code: MarketplaceErrorCode, context: string): string {
  if (!isContentDigest(value)) {
    throw new MarketplaceError(code, {
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

