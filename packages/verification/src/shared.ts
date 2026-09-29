/**
 * Shared verification-protocol view types, guards and tripwires (Work Order
 * A013; spec EV1.0 "Verification"; requirements R13, R14, R27, R28;
 * architecture-lock rules 6, 7, 16, 17, 18 — verification establishes
 * whether required evidence exists and supports required claims; it NEVER
 * emits numerical or graded quality assessments, which belong to the
 * separate quality-assessment protocol of lock rule 7).
 *
 * @arena/verification is a domain package whose RUNTIME imports are confined
 * to @arena/protocol-core (canonical JSON + sha256 digests, envelopes,
 * branded identifiers, correlation ids / idempotency keys, SchemaRef,
 * ProtocolError) and @arena/artifact-protocol (the A002 artifact
 * protocol: MaterialArtifact, ArtifactRef, digest verification and
 * provenance-chain validation — the evidence-addressing primitives this
 * protocol CONSUMES, never reimplements). The criteria-assessment protocol
 * (lock rule 7's other half) is deliberately NOT imported: evidence
 * establishment and quality assessment are distinct responsibilities.
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown fields
 * are rejected), mirroring the additionalProperties: false semantics of
 * the generated contracts. This is also the construction-level half of
 * the no-numerical-outcome guarantee: a hook verdict or record input
 * carrying an extra quantitative field is rejected as an unknown field.
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { VERIFICATION_ERROR_CODES, VerificationError } from './errors.js';
import type { VerificationErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol /
// @arena/trajectory / @arena/protocol-core constants they mirror
// (character-for-character). Kept in sync with the generated contracts
// (contracts/verification/*.v1.json) by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant in A002/A009/A010/A011/A012. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const VERIFICATION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral ids for references into sibling packages (verifier authors, producers). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A010's RunTimestamp /
 * A011's TrajectoryTimestamp / A012's record timestamps) — verification
 * ordering is total and timezone-free.
 */
export const VERIFICATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Deterministic seeds (neutral charset) — mirrors A010/A011/A012's SEED_PATTERN. */
export const SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
/** Verifier/record version strings — semver without build metadata (A009 charset). */
export const VERIFICATION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const VERIFICATION_ID_PATTERN = new RegExp(VERIFICATION_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const VERIFICATION_TIMESTAMP_PATTERN = new RegExp(VERIFICATION_TIMESTAMP_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(SEED_PATTERN_SOURCE);
const VERIFICATION_VERSION_PATTERN = new RegExp(VERIFICATION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'VerificationContentDigest'>;
export type VerificationId = Brand<string, 'VerificationIdBrand'>;
export type NeutralId = Brand<string, 'VerificationNeutralId'>;
export type VerificationTimestamp = Brand<string, 'VerificationTimestamp'>;
export type VerificationSeed = Brand<string, 'VerificationSeed'>;
export type VerificationVersion = Brand<string, 'VerificationVersion'>;
export type NeutralText = Brand<string, 'VerificationNeutralText'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isVerificationId(value: unknown): value is VerificationId {
  return typeof value === 'string' && VERIFICATION_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isVerificationTimestamp(value: unknown): value is VerificationTimestamp {
  if (typeof value !== 'string' || !VERIFICATION_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isVerificationSeed(value: unknown): value is VerificationSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function isVerificationVersion(value: unknown): value is VerificationVersion {
  return typeof value === 'string' && VERIFICATION_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toVerificationId(value: string, context: string): VerificationId {
  if (!isVerificationId(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid verification id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: VERIFICATION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toVerificationTimestamp(
  value: string,
  field: string,
): VerificationTimestamp {
  if (!isVerificationTimestamp(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid verification timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: VERIFICATION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toVerificationSeed(value: string): VerificationSeed {
  if (!isVerificationSeed(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_REPRODUCIBILITY, {
      message: `invalid verification seed: ${JSON.stringify(value)} (neutral seed charset required)`,
      details: { pattern: SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toVerificationVersion(value: string, field: string): VerificationVersion {
  if (!isVerificationVersion(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid verification version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: VERIFICATION_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_OUTCOME, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a sibling-package SchemaRef (input/output schema of a verifier). */
export function toSchemaRefValue(value: SchemaRef): SchemaRef {
  if (!isSchemaRef(value)) {
    throw new VerificationError(VERIFICATION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: 'verifier schemas must be well-formed versioned SchemaRefs (arena:schema/<ns>/<name>@<semver>)',
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
  code: VerificationErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new VerificationError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new VerificationError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new VerificationError(code, {
        message: `${context}: unknown field '${key}' (strict shape; additionalProperties are rejected)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

/** Validate a required positive integer field already read from a record. */
export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: VerificationErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new VerificationError(code, {
      message: `${context}: ${field} must be a positive integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: VerificationErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new VerificationError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A013 — domain objects are immutable)
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
