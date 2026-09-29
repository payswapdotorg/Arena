/**
 * Shared skill-extraction view types, guards and tripwires (Work Order
 * A019; requirement R17 — "Extract reusable Skills from validated
 * trajectories"; architecture-lock rules 5, 6, 18 — content-addressed,
 * append-only, provenance-addressed artifacts).
 *
 * @arena/skill-extraction is a domain package that COMPOSES the real
 * sibling domains it reads from — @arena/trajectory (A011), 
 * @arena/evaluation (A012), @arena/verification (A013) and
 * @arena/capability-graph (A004) — reusing THEIR structural guards and
 * constructors throughout, never reimplementing them. Runtime imports
 * beyond those are confined to @arena/protocol-core (canonical JSON +
 * sha256 digests, envelopes, branded identifiers, SchemaRef,
 * ProtocolError).
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown fields
 * are rejected), mirroring the additionalProperties: false semantics the
 * sibling packages assert through their generated contracts (A019 owns
 * NO contracts/ surface — its schemas live inside the package as
 * versioned SchemaRef-referenced data; see envelopes.ts).
 */

import type { Brand } from '@arena/protocol-core';
import { SKILL_EXTRACTION_ERROR_CODES, SkillExtractionError } from './errors.js';
import type { SkillExtractionErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the sibling-package constants they mirror
// (character-for-character copies; the sources are asserted against the
// real packages by the test suite).
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant in A002/A009..A013. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const SKILL_EXTRACTION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A011's
 * TrajectoryTimestamp / A012's / A013's run timestamps) — extraction
 * ordering is total and timezone-free.
 */
export const SKILL_EXTRACTION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Policy / extractor version strings — semver without build metadata. */
export const SKILL_EXTRACTION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const SKILL_EXTRACTION_ID_PATTERN = new RegExp(SKILL_EXTRACTION_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(SKILL_EXTRACTION_TIMESTAMP_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(SKILL_EXTRACTION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'SkillExtractionContentDigest'>;
export type SkillExtractionId = Brand<string, 'SkillExtractionIdBrand'>;
export type NeutralId = Brand<string, 'SkillExtractionNeutralId'>;
export type SkillExtractionTimestamp = Brand<string, 'SkillExtractionTimestamp'>;
export type SkillExtractionVersion = Brand<string, 'SkillExtractionVersion'>;
export type NeutralText = Brand<string, 'SkillExtractionNeutralText'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isSkillExtractionId(value: unknown): value is SkillExtractionId {
  return typeof value === 'string' && SKILL_EXTRACTION_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && SKILL_EXTRACTION_ID_PATTERN.test(value);
}

export function isSkillExtractionTimestamp(value: unknown): value is SkillExtractionTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isSkillExtractionVersion(value: unknown): value is SkillExtractionVersion {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSkillExtractionId(value: string, context: string): SkillExtractionId {
  if (!isSkillExtractionId(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid skill-extraction id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { pattern: SKILL_EXTRACTION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: SKILL_EXTRACTION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSkillExtractionTimestamp(
  value: string,
  field: string,
): SkillExtractionTimestamp {
  if (!isSkillExtractionTimestamp(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid skill-extraction timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: SKILL_EXTRACTION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toSkillExtractionVersion(value: string, field: string): SkillExtractionVersion {
  if (!isSkillExtractionVersion(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_POLICY, {
      message: `${field}: invalid version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { field, pattern: SKILL_EXTRACTION_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new SkillExtractionError(SKILL_EXTRACTION_ERROR_CODES.INVALID_RECORD, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
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
 * twin of the sibling packages' additionalProperties: false contracts.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: SkillExtractionErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SkillExtractionError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new SkillExtractionError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new SkillExtractionError(code, {
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
  code: SkillExtractionErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new SkillExtractionError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

/** Validate a non-negative integer field already read from a record. */
export function expectNonNegativeInteger(
  value: unknown,
  field: string,
  code: SkillExtractionErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new SkillExtractionError(code, {
      message: `${context}: ${field} must be a non-negative integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a finite number in [0, 1]. */
export function expectUnitInterval(
  value: unknown,
  field: string,
  code: SkillExtractionErrorCode,
  context: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new SkillExtractionError(code, {
      message: `${context}: ${field} must be a finite number in [0, 1], got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deep freeze (domain objects are immutable — lock rules 5, 6)
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
