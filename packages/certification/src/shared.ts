/**
 * Shared certification-protocol view types, guards and tripwires (Work Order
 * A023; spec AB1.0 design law — "Arena certifies statements of the form:
 * Agent Body B, version V, possessed by Cognitive Substrate M, under
 * Environment E and Runtime Profile R, satisfied Certification Suite S at
 * revision X. Arena does NOT certify that M alone an unscoped professional scope claim.";
 * architecture-lock rules 4, 6, 16, 17, 18).
 *
 * @arena/certification is a domain package whose RUNTIME imports are
 * confined to @arena/protocol-core (canonical JSON + sha256 digests,
 * envelopes, branded identifiers, correlation ids / idempotency keys,
 * SchemaRef, ProtocolError) and @arena/agent-body (the A003 possession +
 * body-version + cognitive-substrate + runtime-profile + environment-profile
 * primitives — consumed, never reimplemented). The sibling protocols this
 * package composes (A012 evaluation, A013 verification, A022 compatibility)
 * are addressed STRICTLY BY DIGEST REFS (sha256 content addresses), never
 * redefined here, exactly like @arena/evaluation binds A005/A011 by digest.
 *
 * expectFields: strict shape enforcement — every protocol object must carry
 * exactly its declared field set (missing fields AND unknown fields are
 * rejected), mirroring the additionalProperties: false semantics of the
 * generated contracts. This is also the construction-level half of the
 * design-law separation: a record input carrying an extra
 * "unscoped-professional-claim" claim field is rejected as an unknown field (the
 * canonical record view never carries an unscoped professional claim).
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { CERTIFICATION_ERROR_CODES, CertificationError } from './errors.js';
import type { CertificationErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/agent-body / @arena/protocol-core
// constants they mirror (character-for-character). Kept in sync with the
// generated contracts (contracts/certification/*.v1.json) by
// contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant in A002/A003/A011/A012/A013. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const CERTIFICATION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral ids for references into sibling packages (suite authors, component kinds). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A011/A012/A013) —
 * certification ordering is total and timezone-free.
 */
export const CERTIFICATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Suite/record version strings — semver without build metadata (A003/A009 charset). */
export const CERTIFICATION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
/** Suite revision strings (digest-addressed; mirrors the canonical sha256 hex). */
export const SUITE_REVISION_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const CERTIFICATION_ID_PATTERN = new RegExp(CERTIFICATION_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const CERTIFICATION_TIMESTAMP_PATTERN = new RegExp(CERTIFICATION_TIMESTAMP_PATTERN_SOURCE);
const CERTIFICATION_VERSION_PATTERN = new RegExp(CERTIFICATION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'CertificationContentDigest'>;
export type CertificationId = Brand<string, 'CertificationIdBrand'>;
export type NeutralId = Brand<string, 'CertificationNeutralId'>;
export type CertificationTimestamp = Brand<string, 'CertificationTimestamp'>;
export type CertificationVersion = Brand<string, 'CertificationVersion'>;
export type NeutralText = Brand<string, 'CertificationNeutralText'>;
export type SuiteRevision = Brand<string, 'CertificationSuiteRevision'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isCertificationId(value: unknown): value is CertificationId {
  return typeof value === 'string' && CERTIFICATION_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
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

export function isSuiteRevision(value: unknown): value is SuiteRevision {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
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
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_TEXT, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSuiteRevision(value: string, field: string): SuiteRevision {
  if (!isSuiteRevision(value)) {
    throw new CertificationError(CERTIFICATION_ERROR_CODES.INVALID_REVISION, {
      message: `${field}: invalid suite revision: ${JSON.stringify(value)} (lowercase sha256 hex required — the suite's content-addressed revision IS the descriptor digest)`,
      details: { field, pattern: SUITE_REVISION_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a sibling-package SchemaRef (input/output schema of a suite). */
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
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected — the certification surface never accepts an unscoped professional claim)`,
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
