/**
 * Shared certification-protocol view types, guards and tripwires (Work
 * Order A023; requirements R21, R22, R43, R45, R46; architecture-lock
 * rules 4, 12, 16, 17, 18, 23; spec/quality-model.md "Certification
 * levels" / "Professional limitations").
 *
 * Certification issues COMPOSITION-SCOPED statements (lock rule 4: the
 * claim applies to the tested Body×Substrate×Environment×RuntimeProfile×Suite
 * composition, NEVER to the substrate alone — R46). Runtime imports are
 * confined to the sibling domain packages whose records certification
 * CONSUMES (@arena/verification, @arena/evaluation, @arena/compatibility,
 * @arena/datasets, @arena/agent-body) plus @arena/protocol-core
 * (canonical JSON + sha256 digests, envelopes, branded identifiers,
 * correlation ids / idempotency keys, SchemaRef) — consumed, never
 * reimplemented.
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown
 * fields are rejected), mirroring the additionalProperties: false
 * semantics of the generated contracts.
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the sibling package constants they mirror
// (character-for-character). Kept in sync with the generated contracts
// (contracts/certification/*.v1.json) by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant across Arena packages. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const CERTIFICATION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral ids for references into sibling packages (principals, tenants). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Workspace ids (may carry an internal dot separator). */
export const WORKSPACE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9.-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors the sibling record
 * timestamp patterns) — certification ordering is total and timezone-free.
 */
export const CERTIFICATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Suite/record version strings — semver without build metadata. */
export const CERTIFICATION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
/** Tenant ids (A003 namespace charset). */
export const TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const CERTIFICATION_ID_PATTERN = new RegExp(CERTIFICATION_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const WORKSPACE_ID_PATTERN = new RegExp(WORKSPACE_ID_PATTERN_SOURCE);
const CERTIFICATION_TIMESTAMP_PATTERN = new RegExp(CERTIFICATION_TIMESTAMP_PATTERN_SOURCE);
const CERTIFICATION_VERSION_PATTERN = new RegExp(CERTIFICATION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);
const TENANT_ID_PATTERN = new RegExp(TENANT_ID_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'CertificationContentDigest'>;
export type CertificationId = Brand<string, 'CertificationIdBrand'>;
export type NeutralId = Brand<string, 'CertificationNeutralId'>;
export type TenantId = Brand<string, 'CertificationTenantId'>;
export type WorkspaceId = Brand<string, 'CertificationWorkspaceId'>;
export type CertificationTimestamp = Brand<string, 'CertificationTimestamp'>;
export type CertificationVersion = Brand<string, 'CertificationVersion'>;
export type NeutralText = Brand<string, 'CertificationNeutralText'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isCertificationId(value: unknown): value is CertificationId {
  return typeof value === 'string' && CERTIFICATION_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && TENANT_ID_PATTERN.test(value);
}

export function isWorkspaceId(value: unknown): value is WorkspaceId {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

export function isCertificationTimestamp(value: unknown): value is CertificationTimestamp {
  if (typeof value !== 'string' || !CERTIFICATION_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isCertificationVersion(value: unknown): value is CertificationVersion {
  return typeof value === 'string' && CERTIFICATION_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCertificationId(value: string, context: string): CertificationId {
  if (!isCertificationId(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid certification id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: CERTIFICATION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toTenantId(value: string, field: string): TenantId {
  if (!isTenantId(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid tenant id: ${JSON.stringify(value)} (tenant namespace charset required)`,
      details: { field, pattern: TENANT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toWorkspaceId(value: string, field: string): WorkspaceId {
  if (!isWorkspaceId(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid workspace id: ${JSON.stringify(value)}`,
      details: { field, pattern: WORKSPACE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCertificationTimestamp(
  value: string,
  field: string,
): CertificationTimestamp {
  if (!isCertificationTimestamp(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid certification timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: CERTIFICATION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCertificationVersion(value: string, field: string): CertificationVersion {
  if (!isCertificationVersion(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid certification version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: CERTIFICATION_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_LIMITATIONS, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a sibling-package SchemaRef. */
export function toSchemaRefValue(value: SchemaRef): SchemaRef {
  if (!isSchemaRef(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: 'certification schemas must be well-formed versioned SchemaRefs (arena:schema/<ns>/<name>@<semver>)',
      details: { received: JSON.stringify(value) },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field and
 * no field outside required ∪ optional. Missing required fields and
 * unknown fields are both rejected with the given error code — the runtime
 * twin of the generated contracts' additionalProperties: false.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: CertificationErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CertificationError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new CertificationError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new CertificationError(code, {
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
  code: CertificationErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new CertificationError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Optional-field helpers (null / absent / string, nothing else)
// ---------------------------------------------------------------------------

/** A required-or-null digest field: null/absent pass through; non-strings reject. */
export function toOptionalContentDigest(value: unknown, context: string): ContentDigest | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: expected a digest string or null`,
      details: { receivedType: typeof value },
    });
  }
  return toContentDigest(value, context);
}

/** A required-or-null tenant field. */
export function toOptionalTenantId(value: unknown, field: string): TenantId | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: expected a tenant id string or null`,
    });
  }
  return toTenantId(value, field);
}

/** A required-or-null workspace field. */
export function toOptionalWorkspaceId(value: unknown, field: string): WorkspaceId | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: expected a workspace id string or null`,
    });
  }
  return toWorkspaceId(value, field);
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A023 — domain objects are immutable)
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
