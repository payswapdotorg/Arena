/**
 * Shared learning-protocol view types, guards and tripwires (Work Order
 * A020; spec LE1.0 "Learning and Experiment"; requirements R15, R16,
 * R14; architecture-lock rules 5, 6, 16, 18, 23).
 *
 * @arena/learning is a domain package that COMPOSES the real sibling
 * domains it reads from - @arena/trajectory (A011), @arena/evaluation
 * (A012), @arena/verification (A013) and @arena/capability-graph (A004
 * node-ref guards) - reusing THEIR structural guards throughout, never
 * reimplementing them. Runtime imports beyond those are confined to
 * @arena/protocol-core (canonical JSON + sha256 digests, envelopes,
 * branded identifiers, SchemaRef, ProtocolError).
 *
 * expectFields: strict shape enforcement - every protocol object must
 * carry exactly its declared field set (missing fields AND unknown
 * fields are rejected), mirroring the additionalProperties: false
 * semantics of the generated contracts in contracts/learning/.
 */

import type { Brand } from '@arena/protocol-core';
import { LEARNING_ERROR_CODES, LearningError } from './errors.js';
import type { LearningErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources - MUST equal the sibling-package constants they mirror
// (character-for-character copies; the sources are asserted against the
// real packages by the test suite). Kept in sync with the generated
// contracts (contracts/learning/*.v1.json) by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) - identical constant in A002/A009..A013/A019. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const LEARNING_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A011's / A012's /
 * A013's run timestamps) - learning ordering is total and timezone-free.
 */
export const LEARNING_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Descriptor / experiment version strings - semver without build metadata. */
export const LEARNING_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';
/** Artifact-reference namespace charset (A002 shape). */
export const ARTIFACT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
/** Artifact-reference name charset (A002 shape). */
export const ARTIFACT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const LEARNING_ID_PATTERN = new RegExp(LEARNING_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(LEARNING_TIMESTAMP_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(LEARNING_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'LearningContentDigest'>;
export type LearningId = Brand<string, 'LearningIdBrand'>;
export type NeutralId = Brand<string, 'LearningNeutralId'>;
export type LearningTimestamp = Brand<string, 'LearningTimestamp'>;
export type LearningVersion = Brand<string, 'LearningVersion'>;
export type NeutralText = Brand<string, 'LearningNeutralText'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isLearningId(value: unknown): value is LearningId {
  return typeof value === 'string' && LEARNING_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && LEARNING_ID_PATTERN.test(value);
}

export function isLearningTimestamp(value: unknown): value is LearningTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isLearningVersion(value: unknown): value is LearningVersion {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toLearningId(value: string, context: string): LearningId {
  if (!isLearningId(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid learning id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: LEARNING_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: LEARNING_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toLearningTimestamp(value: string, field: string): LearningTimestamp {
  if (!isLearningTimestamp(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid learning timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: LEARNING_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toLearningVersion(value: string, field: string): LearningVersion {
  if (!isLearningVersion(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_DESCRIPTOR, {
      message: `${field}: invalid version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { field, pattern: LEARNING_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new LearningError(LEARNING_ERROR_CODES.INVALID_RECORD, {
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
 * unknown fields are both rejected with the given error code - the
 * runtime twin of the generated contracts' additionalProperties: false.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: LearningErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LearningError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new LearningError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new LearningError(code, {
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
  code: LearningErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new LearningError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

/** Validate a finite number field within an inclusive range. */
export function expectNumberInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  code: LearningErrorCode,
  context: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new LearningError(code, {
      message: `${context}: ${field} must be a finite number in [${String(minimum)}, ${String(maximum)}], got: ${String(value)}`,
      details: { field, minimum, maximum },
    });
  }
  return value;
}

/** Validate any finite number (unbounded range). */
export function expectFiniteNumber(
  value: unknown,
  field: string,
  code: LearningErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new LearningError(code, {
      message: `${context}: ${field} must be a finite number, got: ${String(value)}`,
      details: { field },
    });
  }
  return value;
}

/** Validate a non-negative finite number (variance domain). */
export function expectNonNegativeNumber(
  value: unknown,
  field: string,
  code: LearningErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new LearningError(code, {
      message: `${context}: ${field} must be a finite non-negative number, got: ${String(value)}`,
      details: { field },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deep freeze (domain objects are immutable - lock rules 5, 6)
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
