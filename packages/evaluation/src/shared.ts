/**
 * Shared evaluation-protocol view types, guards and tripwires (Work Order
 * A012; spec EV1.0; requirements R12, R23; architecture-lock rules 7, 12,
 * 18 — evaluation is JUDGMENT against explicit criteria, never an
 * evidence claim; the evidence-establishing responsibility is a separate
 * protocol's job).
 *
 * @arena/evaluation is a domain package whose RUNTIME imports are confined
 * to @arena/protocol-core (canonical JSON + sha256 digests, envelopes,
 * branded identifiers, SchemaRef, ProtocolError — reused throughout,
 * never reimplemented). The sibling objects this protocol judges against
 * — A005's CapabilityCase and A011's TrajectoryRecord — are bound
 * STRICTLY BY DIGEST REFS (sha256 hex content addresses), exactly like
 * @arena/trajectory binds A003's BodyVersion and A016's model substrate
 * by digest; their types are NOT redefined here (Work Order A012 gate 8
 * note: the boundary checker permits domain→domain type imports on this
 * base, but digest-addressing makes them unnecessary).
 *
 * expectFields: strict shape enforcement — every protocol object must
 * carry exactly its declared field set (missing fields AND unknown fields
 * are rejected), mirroring the additionalProperties: false semantics of
 * the generated contracts.
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import type { EvaluationErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol /
// @arena/trajectory / @arena/protocol-core constants they mirror
// (character-for-character). Kept in sync with the generated contracts
// (contracts/evaluation/*.v1.json) by contracts.parity.test.ts.
// ---------------------------------------------------------------------------

/** Content digests (sha256 hex) — identical constant in A002/A009/A010/A011/A015. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const EVALUATION_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral ids for references into sibling packages (case ids, evaluator authors). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/**
 * Canonical ms-precision UTC timestamps (mirrors A010's RunTimestamp /
 * A011's TrajectoryTimestamp) — evaluation ordering is total and
 * timezone-free.
 */
export const EVALUATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Deterministic seeds (neutral charset) — mirrors A010/A011's SEED_PATTERN. */
export const SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
/** Evaluator/criteria version strings — semver without build metadata (A009 charset). */
export const EVALUATION_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const EVALUATION_ID_PATTERN = new RegExp(EVALUATION_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const EVALUATION_TIMESTAMP_PATTERN = new RegExp(EVALUATION_TIMESTAMP_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(SEED_PATTERN_SOURCE);
const EVALUATION_VERSION_PATTERN = new RegExp(EVALUATION_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'EvaluationContentDigest'>;
export type EvaluationId = Brand<string, 'EvaluationIdBrand'>;
export type NeutralId = Brand<string, 'EvaluationNeutralId'>;
export type EvaluationTimestamp = Brand<string, 'EvaluationTimestamp'>;
export type EvaluationSeed = Brand<string, 'EvaluationSeed'>;
export type EvaluationVersion = Brand<string, 'EvaluationVersion'>;
export type NeutralText = Brand<string, 'EvaluationNeutralText'>;

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isEvaluationId(value: unknown): value is EvaluationId {
  return typeof value === 'string' && EVALUATION_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is NeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isEvaluationTimestamp(value: unknown): value is EvaluationTimestamp {
  if (typeof value !== 'string' || !EVALUATION_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isEvaluationSeed(value: unknown): value is EvaluationSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function isEvaluationVersion(value: unknown): value is EvaluationVersion {
  return typeof value === 'string' && EVALUATION_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is NeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEvaluationId(value: string, context: string): EvaluationId {
  if (!isEvaluationId(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid evaluation id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: EVALUATION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): NeutralId {
  if (!isNeutralId(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEvaluationTimestamp(
  value: string,
  field: string,
): EvaluationTimestamp {
  if (!isEvaluationTimestamp(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid evaluation timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: EVALUATION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEvaluationSeed(value: string): EvaluationSeed {
  if (!isEvaluationSeed(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_CRITERIA, {
      message: `invalid evaluation seed: ${JSON.stringify(value)} (neutral seed charset required)`,
      details: { pattern: SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toEvaluationVersion(value: string, field: string): EvaluationVersion {
  if (!isEvaluationVersion(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid evaluation version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: EVALUATION_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): NeutralText {
  if (!isNeutralText(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_VERDICT, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a sibling-package SchemaRef (output schema of an evaluator). */
export function toOutputSchemaRef(value: SchemaRef): SchemaRef {
  if (!isSchemaRef(value)) {
    throw new EvaluationError(EVALUATION_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: 'output schema must be a well-formed versioned SchemaRef (arena:schema/<ns>/<name>@<semver>)',
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
  code: EvaluationErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvaluationError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new EvaluationError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new EvaluationError(code, {
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
  code: EvaluationErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new EvaluationError(code, {
      message: `${context}: ${field} must be a positive integer, got: ${String(value)}`,
      details: { field, value: typeof value === 'number' ? value : String(value) },
    });
  }
  return value;
}

/** Validate a finite number field within an inclusive range. */
export function expectNumberInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  code: EvaluationErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new EvaluationError(code, {
      message: `${context}: ${field} must be a finite number in [${String(minimum)}, ${String(maximum)}], got: ${String(value)}`,
      details: { field, minimum, maximum },
    });
  }
  return value;
}

/** Validate a member of a closed enum (string union). */
export function expectEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
  field: string,
  code: EvaluationErrorCode,
  context: string,
): T {
  if (typeof value !== 'string' || !members.includes(value as T)) {
    throw new EvaluationError(code, {
      message: `${context}: ${field} must be one of [${members.join(', ')}], got: ${String(value)}`,
      details: { field, known: [...members] },
    });
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Deep freeze (Work Order A012 gate 10 — domain objects are immutable)
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
