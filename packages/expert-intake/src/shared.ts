/**
 * Shared primitives for @arena/expert-intake (Work Order C003).
 *
 * Branded ids, closed pattern sources and small validation helpers — the
 * A006/A007 view conventions (validated plain-string views, neutral
 * charsets that exclude email/phone shapes BY CONSTRUCTION, exact-field
 * validation rejecting unknown keys). Cross-package vocabularies
 * (proficiency levels, competency node kinds, evidence kinds, availability
 * windows, jurisdictions, tenant scopes) are CONSUMED from
 * @arena/expert-qualification — never redefined here.
 */

import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources (mirrored in tests; neutral charsets only)
// ---------------------------------------------------------------------------

export const INTAKE_SESSION_ID_PATTERN_SOURCE = '^intake-[a-z0-9][a-z0-9-]{0,62}$';
export const INTAKE_TIMESTAMP_PATTERN_SOURCE = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const INTAKE_NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,2048}$';
export const INTAKE_SELECTION_SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
export const INTAKE_CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const SESSION_ID_PATTERN = new RegExp(INTAKE_SESSION_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(INTAKE_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(INTAKE_NEUTRAL_TEXT_PATTERN_SOURCE);
const SELECTION_SEED_PATTERN = new RegExp(INTAKE_SELECTION_SEED_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(INTAKE_CONTENT_DIGEST_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalar types
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

export type IntakeSessionId = string & { readonly [brand]: 'IntakeSessionId' };
export type IntakeTimestamp = string & { readonly [brand]: 'IntakeTimestamp' };
export type IntakeNeutralText = string & { readonly [brand]: 'IntakeNeutralText' };
export type IntakeSelectionSeed = string & { readonly [brand]: 'IntakeSelectionSeed' };
export type IntakeContentDigest = string & { readonly [brand]: 'IntakeContentDigest' };

export function isIntakeSessionId(value: unknown): value is IntakeSessionId {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function isIntakeTimestamp(value: unknown): value is IntakeTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isIntakeNeutralText(value: unknown): value is IntakeNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isIntakeSelectionSeed(value: unknown): value is IntakeSelectionSeed {
  return typeof value === 'string' && SELECTION_SEED_PATTERN.test(value);
}

export function isIntakeContentDigest(value: unknown): value is IntakeContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function toIntakeSessionId(value: string, context: string): IntakeSessionId {
  if (!isIntakeSessionId(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SESSION, {
      message: `${context}: invalid intake session id: ${JSON.stringify(value)} (expected 'intake-<lowercase-kebab>')`,
      details: { field: context, pattern: INTAKE_SESSION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toIntakeTimestamp(value: string, field: string): IntakeTimestamp {
  if (!isIntakeTimestamp(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid intake timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: INTAKE_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toIntakeNeutralText(value: string, field: string): IntakeNeutralText {
  if (!isIntakeNeutralText(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ANSWER, {
      message: `${field}: text is not neutral-printable or exceeds 2048 characters: ${JSON.stringify(value.slice(0, 80))}…`,
      details: { field, pattern: INTAKE_NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toIntakeSelectionSeed(value: string, field: string): IntakeSelectionSeed {
  if (!isIntakeSelectionSeed(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_SEED, {
      message: `${field}: invalid selection seed: ${JSON.stringify(value)} (deterministic seed charset required)`,
      details: { field, pattern: INTAKE_SELECTION_SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toIntakeContentDigest(value: string, field: string): IntakeContentDigest {
  if (!isIntakeContentDigest(value)) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_REF, {
      message: `${field}: invalid content digest: ${JSON.stringify(value)}`,
      details: { field, pattern: INTAKE_CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Structural helpers (exact-field validation — no silent unknown keys)
// ---------------------------------------------------------------------------

/**
 * Validate that `value` is a plain object carrying exactly `required`
 * fields (plus any of `optional` when present). Returns the record.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: (typeof EXPERT_INTAKE_ERROR_CODES)[keyof typeof EXPERT_INTAKE_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExpertIntakeError(code, {
      message: `${context}: expected an object`,
    });
  }
  const record = value as Record<string, unknown>;
  const missing = required.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new ExpertIntakeError(code, {
      message: `${context}: missing required field(s): ${missing.join(', ')}`,
      details: { missing },
    });
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ExpertIntakeError(code, {
      message: `${context}: unknown field(s) rejected: ${unknown.join(', ')}`,
      details: { unknown },
    });
  }
  return record;
}

/** Deep-freeze (arrays and plain objects; brand-preserving on strings). */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * Deterministic FNV-1a 32-bit hash over a UTF-8 string — the ONLY
 * pseudo-randomness primitive in the package, used to derive reproducible
 * selection jitter from the injected seed. Pure: same string, same number.
 */
export function fnv1a32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Map an FNV-1a hash onto a deterministic real number in [0, range).
 * Pure and platform-stable (no floating-point reassociation).
 */
export function deterministicUnitInterval(seed: string): number {
  return fnv1a32(seed) / 0x1_0000_0000;
}
