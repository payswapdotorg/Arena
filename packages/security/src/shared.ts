/**
 * Shared security-protocol view types, guards and tripwires (Work Order
 * A034; spec/security.md S1.0).
 *
 * @arena/security is a DOMAIN package whose ONLY workspace import is
 * @arena/protocol-core (protocol layer) — never a sibling domain
 * package, mirroring @arena/job-protocol. Structurally shared components
 * (tenant ids, principals, content digests, canonical timestamps) are
 * defined HERE as validated branded view types. They are STRUCTURALLY
 * COMPATIBLE with the corresponding sibling types (plain branded
 * strings accept sibling branded strings with the same underlying
 * charset — the A015 shared.ts convention).
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown
 * fields are rejected), mirroring the additionalProperties: false
 * semantics of the generated contracts.
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import type { SecurityErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the sibling package constants they mirror
// (character-for-character). The security package owns NO contracts/
// surface (see the contracts disclosure in envelopes.ts), so these
// constants are the authority, asserted by hygiene.test.ts against the
// sibling pattern sources where one exists.
// ---------------------------------------------------------------------------

/** Tenant ids (A003 namespace charset — identical across Arena packages). */
export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
/** Principal ids (job-protocol's principal charset, mirrored). */
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
/** Neutral lowercase identifiers minted inside this package. */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Content digests (sha256 hex) — identical constant across Arena packages. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors the sibling record
 * timestamp patterns) — security ordering is total and timezone-free.
 */
export const SECURITY_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Record/policy version strings — semver without build metadata. */
export const SECURITY_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const TENANT_ID_PATTERN = new RegExp(TENANT_ID_PATTERN_SOURCE);
const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const SECURITY_TIMESTAMP_PATTERN = new RegExp(SECURITY_TIMESTAMP_PATTERN_SOURCE);
const SECURITY_VERSION_PATTERN = new RegExp(SECURITY_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type TenantId = Brand<string, 'SecurityTenantId'>;
export type PrincipalId = Brand<string, 'SecurityPrincipalId'>;
export type NeutralId = Brand<string, 'SecurityNeutralId'>;
export type ContentDigest = Brand<string, 'SecurityContentDigest'>;
export type SecurityTimestamp = Brand<string, 'SecurityTimestamp'>;
export type SecurityVersion = Brand<string, 'SecurityVersion'>;
export type NeutralText = Brand<string, 'SecurityNeutralText'>;

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isPrincipalId(value: unknown): value is PrincipalId {
  return typeof value === 'string' && PRINCIPAL_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isSecurityTimestamp(value: unknown): value is SecurityTimestamp {
  if (typeof value !== 'string' || !SECURITY_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isSecurityVersion(value: unknown): value is SecurityVersion {
  return typeof value === 'string' && SECURITY_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toTenantId(value: string, field: string): TenantId {
  if (!isTenantId(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TENANT, {
      message: `${field}: invalid tenant id: ${JSON.stringify(value)} (tenant namespace charset required)`,
      details: { field, pattern: TENANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toPrincipalId(value: string, field: string): PrincipalId {
  if (!isPrincipalId(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid principal id: ${JSON.stringify(value)}`,
      details: { field, pattern: PRINCIPAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toContentDigest(value: string, field: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid content digest: ${JSON.stringify(value)} (lowercase sha256 hex required)`,
      details: { field, pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSecurityTimestamp(value: string, field: string): SecurityTimestamp {
  if (!isSecurityTimestamp(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid security timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: SECURITY_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSecurityVersion(value: string, field: string): SecurityVersion {
  if (!isSecurityVersion(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid security version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: SECURITY_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_DATA_RIGHTS, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict shape enforcement
// ---------------------------------------------------------------------------

/**
 * Every protocol object must carry exactly its declared field set:
 * missing REQUIRED fields and unknown fields are BOTH rejected
 * (additionalProperties: false semantics).
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: SecurityErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SecurityError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new SecurityError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new SecurityError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: SecurityErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new SecurityError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

/** Structural (non-throwing) closed-enum check. */
export function isEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return typeof value === 'string' && (members as readonly string[]).includes(value);
}

/** Validate a sibling-package SchemaRef. */
export function toSchemaRefValue(value: SchemaRef, field: string): SchemaRef {
  if (!isSchemaRef(value)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `${field}: security schemas must be well-formed versioned SchemaRefs (arena:schema/<ns>/<name>@<semver>)`,
      details: { received: JSON.stringify(value) },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deep freeze — security records are immutable
// ---------------------------------------------------------------------------

export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}
