/**
 * Shared research-protocol view types, guards and shape enforcement
 * (Work Order A030) -- the same discipline as @arena/evaluation's
 * shared.ts: strict field sets (missing AND unknown fields rejected),
 * branded scalars, deep-freeze on every constructed object, and
 * content addressing ONLY through @arena/protocol-core's
 * digestCanonical.
 *
 * Pattern sources are character-for-character mirrors of the sibling
 * protocols (A002 content digests, A012 neutral ids/timestamps/versions)
 * and are parity-tested against @arena/evaluation's constants.
 */

import type { Brand, SchemaRef } from '@arena/protocol-core';
import { isSchemaRef } from '@arena/protocol-core';
import { RESEARCH_ERROR_CODES, ResearchError } from './errors.js';
import type { ResearchErrorCode } from './errors.js';

/** Content digests (sha256 hex) -- identical constant across Arena protocols. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
/** Identifier charset for ids minted inside this package (closed, neutral). */
export const RESEARCH_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Neutral ids for references into sibling packages (authors, runners). */
export const NEUTRAL_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,63}$';
/** Canonical ms-precision UTC timestamps (mirrors A011/A012). */
export const RESEARCH_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
/** Deterministic seeds (neutral charset) -- mirrors A010/A011/A012. */
export const SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
/** Semver without build metadata (mirrors A009/A012). */
export const RESEARCH_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
/** Free-form neutral text (printable ASCII, no control characters). */
export const NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,4096}$';

const CONTENT_DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const RESEARCH_ID_PATTERN = new RegExp(RESEARCH_ID_PATTERN_SOURCE);
const NEUTRAL_ID_PATTERN = new RegExp(NEUTRAL_ID_PATTERN_SOURCE);
const RESEARCH_TIMESTAMP_PATTERN = new RegExp(RESEARCH_TIMESTAMP_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(SEED_PATTERN_SOURCE);
const RESEARCH_VERSION_PATTERN = new RegExp(RESEARCH_VERSION_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NEUTRAL_TEXT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalars
// ---------------------------------------------------------------------------

export type ResearchContentDigest = Brand<string, 'ResearchContentDigest'>;
export type ResearchId = Brand<string, 'ResearchId'>;
export type ResearchNeutralId = Brand<string, 'ResearchNeutralId'>;
export type ResearchTimestamp = Brand<string, 'ResearchTimestamp'>;
export type ResearchSeed = Brand<string, 'ResearchSeed'>;
export type ResearchVersion = Brand<string, 'ResearchVersion'>;
export type ResearchNeutralText = Brand<string, 'ResearchNeutralText'>;

export function isContentDigest(value: unknown): value is ResearchContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isResearchId(value: unknown): value is ResearchId {
  return typeof value === 'string' && RESEARCH_ID_PATTERN.test(value);
}

export function isNeutralId(value: unknown): value is ResearchNeutralId {
  return typeof value === 'string' && NEUTRAL_ID_PATTERN.test(value);
}

export function isResearchTimestamp(value: unknown): value is ResearchTimestamp {
  if (typeof value !== 'string' || !RESEARCH_TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isResearchSeed(value: unknown): value is ResearchSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function isResearchVersion(value: unknown): value is ResearchVersion {
  return typeof value === 'string' && RESEARCH_VERSION_PATTERN.test(value);
}

export function isNeutralText(value: unknown): value is ResearchNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function toContentDigest(value: string, context: string): ResearchContentDigest {
  if (!isContentDigest(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_DIGEST, {
      message: `${context}: invalid content digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toResearchId(value: string, context: string): ResearchId {
  if (!isResearchId(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid research id: ${JSON.stringify(value)} (lowercase neutral identifier required)`,
      details: { field: context, pattern: RESEARCH_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralId(value: string, field: string): ResearchNeutralId {
  if (!isNeutralId(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid neutral identifier: ${JSON.stringify(value)}`,
      details: { field, pattern: NEUTRAL_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toResearchTimestamp(value: string, field: string): ResearchTimestamp {
  if (!isResearchTimestamp(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid research timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: RESEARCH_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toResearchSeed(value: string): ResearchSeed {
  if (!isResearchSeed(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_RESULT, {
      message: `invalid benchmark run seed: ${JSON.stringify(value)} (neutral seed charset required)`,
      details: { pattern: SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toResearchVersion(value: string, field: string): ResearchVersion {
  if (!isResearchVersion(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_IDENTITY, {
      message: `${field}: invalid research version: ${JSON.stringify(value)} (semver without build metadata required)`,
      details: { field, pattern: RESEARCH_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toNeutralText(value: string, field: string): ResearchNeutralText {
  if (!isNeutralText(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_TEXT, {
      message: `${field}: invalid neutral text: must be 1-4096 printable ASCII characters`,
      details: { field, pattern: NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate a sibling-package SchemaRef (research schemas). */
export function toResearchSchemaRef(value: SchemaRef): SchemaRef {
  if (!isSchemaRef(value)) {
    throw new ResearchError(RESEARCH_ERROR_CODES.INVALID_SCHEMA_REF, {
      message:
        'research schema ref must be a well-formed versioned SchemaRef (arena:schema/<ns>/<name>@<semver>)',
      details: { received: JSON.stringify(value) },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Strict shape enforcement (additionalProperties: false semantics)
// ---------------------------------------------------------------------------

/**
 * Assert that `value` is a plain object carrying every REQUIRED field
 * and no field outside required ∪ optional -- the runtime twin of the
 * in-package schema registry's closed shapes.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: ResearchErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ResearchError(code, {
      message: `${context}: expected a plain object`,
      details: { receivedType: typeof value },
    });
  }
  const record = value as Record<string, unknown>;
  const allowed = [...required, ...optional];
  for (const key of required) {
    if (!(key in record)) {
      throw new ResearchError(code, {
        message: `${context}: missing required field '${key}'`,
        details: { field: key, required: [...required] },
      });
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new ResearchError(code, {
        message: `${context}: unknown field '${key}' (closed shape)`,
        details: { field: key, allowed },
      });
    }
  }
  return record;
}

// ---------------------------------------------------------------------------
// Numeric guards
// ---------------------------------------------------------------------------

export function expectNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: ResearchErrorCode,
  context: string,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw new ResearchError(code, {
      message: `${context}: ${field} must be a finite number in [${min}, ${max}]`,
      details: { field, received: JSON.stringify(value) },
    });
  }
  return value;
}

export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: ResearchErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ResearchError(code, {
      message: `${context}: ${field} must be a positive integer`,
      details: { field, received: JSON.stringify(value) },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Deep freeze (mirrors the sibling protocols)
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
