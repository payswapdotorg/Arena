/**
 * Shared primitives for @arena/expert-calibration (Work Order C004).
 *
 * Branded ids, closed pattern sources and small validation helpers — the
 * house conventions (validated plain-string views, neutral charsets,
 * exact-field validation rejecting unknown keys, deep-freeze). Cross-
 * package vocabularies (capability node refs, proficiency levels,
 * qualification evidence kinds, tenant scopes) are CONSUMED from
 * @arena/expert-qualification and the C003 intake gap vocabulary from
 * @arena/expert-intake — never redefined here.
 */

import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources (mirrored in tests; neutral charsets only)
// ---------------------------------------------------------------------------

export const CALIBRATION_ID_PATTERN_SOURCE = '^cal-[a-z0-9][a-z0-9-]{0,62}$';
export const CALIBRATION_PROGRAM_ID_PATTERN_SOURCE = '^calprog-[a-z0-9][a-z0-9-]{0,62}$';
export const CALIBRATION_TRACK_ID_PATTERN_SOURCE = '^pretrain-[a-z0-9][a-z0-9-]{0,62}$';
export const CALIBRATION_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const CALIBRATION_NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,2048}$';
export const CALIBRATION_SEED_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
export const CALIBRATION_CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const CALIBRATION_LOCATOR_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';

const ID_PATTERN = new RegExp(CALIBRATION_ID_PATTERN_SOURCE);
const PROGRAM_ID_PATTERN = new RegExp(CALIBRATION_PROGRAM_ID_PATTERN_SOURCE);
const TRACK_ID_PATTERN = new RegExp(CALIBRATION_TRACK_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(CALIBRATION_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(CALIBRATION_NEUTRAL_TEXT_PATTERN_SOURCE);
const SEED_PATTERN = new RegExp(CALIBRATION_SEED_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(CALIBRATION_CONTENT_DIGEST_PATTERN_SOURCE);
const LOCATOR_PATTERN = new RegExp(CALIBRATION_LOCATOR_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalar types
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

export type CalibrationId = string & { readonly [brand]: 'CalibrationId' };
export type CalibrationProgramId = string & { readonly [brand]: 'CalibrationProgramId' };
export type PreTrainingTrackId = string & { readonly [brand]: 'PreTrainingTrackId' };
export type CalibrationTimestamp = string & { readonly [brand]: 'CalibrationTimestamp' };
export type CalibrationNeutralText = string & { readonly [brand]: 'CalibrationNeutralText' };
export type CalibrationSeed = string & { readonly [brand]: 'CalibrationSeed' };
export type CalibrationContentDigest = string & { readonly [brand]: 'CalibrationContentDigest' };
export type CalibrationLocator = string & { readonly [brand]: 'CalibrationLocator' };

export function isCalibrationId(value: unknown): value is CalibrationId {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function isCalibrationProgramId(value: unknown): value is CalibrationProgramId {
  return typeof value === 'string' && PROGRAM_ID_PATTERN.test(value);
}

export function isPreTrainingTrackId(value: unknown): value is PreTrainingTrackId {
  return typeof value === 'string' && TRACK_ID_PATTERN.test(value);
}

export function isCalibrationTimestamp(value: unknown): value is CalibrationTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isCalibrationNeutralText(value: unknown): value is CalibrationNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isCalibrationSeed(value: unknown): value is CalibrationSeed {
  return typeof value === 'string' && SEED_PATTERN.test(value);
}

export function isCalibrationContentDigest(value: unknown): value is CalibrationContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isCalibrationLocator(value: unknown): value is CalibrationLocator {
  return typeof value === 'string' && LOCATOR_PATTERN.test(value);
}

export function toCalibrationId(value: string, context: string): CalibrationId {
  if (!isCalibrationId(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_IDENTITY, {
      message: `${context}: invalid calibration id: ${JSON.stringify(value)} (expected 'cal-<lowercase-kebab>')`,
      details: { field: context, pattern: CALIBRATION_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationProgramId(value: string, context: string): CalibrationProgramId {
  if (!isCalibrationProgramId(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_PROGRAM, {
      message: `${context}: invalid calibration program id: ${JSON.stringify(value)} (expected 'calprog-<lowercase-kebab>')`,
      details: { field: context, pattern: CALIBRATION_PROGRAM_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toPreTrainingTrackId(value: string, context: string): PreTrainingTrackId {
  if (!isPreTrainingTrackId(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TRACK, {
      message: `${context}: invalid pre-training track id: ${JSON.stringify(value)} (expected 'pretrain-<lowercase-kebab>')`,
      details: { field: context, pattern: CALIBRATION_TRACK_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationTimestamp(value: string, field: string): CalibrationTimestamp {
  if (!isCalibrationTimestamp(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${field}: invalid calibration timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      details: { field, pattern: CALIBRATION_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationNeutralText(value: string, field: string): CalibrationNeutralText {
  if (!isCalibrationNeutralText(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_RECORD, {
      message: `${field}: text is not neutral-printable or exceeds 2048 characters: ${JSON.stringify(value.slice(0, 80))}…`,
      details: { field, pattern: CALIBRATION_NEUTRAL_TEXT_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationSeed(value: string, field: string): CalibrationSeed {
  if (!isCalibrationSeed(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_SEED, {
      message: `${field}: invalid seed: ${JSON.stringify(value)} (deterministic seed charset required)`,
      details: { field, pattern: CALIBRATION_SEED_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationContentDigest(value: string, field: string): CalibrationContentDigest {
  if (!isCalibrationContentDigest(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_REF, {
      message: `${field}: invalid content digest: ${JSON.stringify(value)}`,
      details: { field, pattern: CALIBRATION_CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

export function toCalibrationLocator(value: string, field: string): CalibrationLocator {
  if (!isCalibrationLocator(value)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_REF, {
      message: `${field}: invalid locator: ${JSON.stringify(value)}`,
      details: { field, pattern: CALIBRATION_LOCATOR_PATTERN_SOURCE },
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
  code: (typeof EXPERT_CALIBRATION_ERROR_CODES)[keyof typeof EXPERT_CALIBRATION_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ExpertCalibrationError(code, {
      message: `${context}: expected an object`,
    });
  }
  const record = value as Record<string, unknown>;
  const missing = required.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new ExpertCalibrationError(code, {
      message: `${context}: missing required field(s): ${missing.join(', ')}`,
      details: { missing },
    });
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ExpertCalibrationError(code, {
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

/** Validate a finite number with a typed error (inclusive bounds). */
export function expectFiniteNumber(
  value: unknown,
  field: string,
  code: (typeof EXPERT_CALIBRATION_ERROR_CODES)[keyof typeof EXPERT_CALIBRATION_ERROR_CODES],
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ExpertCalibrationError(code, {
      message: `${context}: ${field} must be a finite number, got: ${String(value)}`,
    });
  }
  return value;
}

/** Validate a number within [min, max] with a typed error (inclusive bounds). */
export function expectNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: (typeof EXPERT_CALIBRATION_ERROR_CODES)[keyof typeof EXPERT_CALIBRATION_ERROR_CODES],
  context: string,
): number {
  const finite = expectFiniteNumber(value, field, code, context);
  if (finite < min || finite > max) {
    throw new ExpertCalibrationError(code, {
      message: `${context}: ${field} must be within [${String(min)}, ${String(max)}], got: ${String(finite)}`,
      details: { field, min, max, actual: finite },
    });
  }
  return finite;
}

/** Validate a non-empty neutral identifier string with a typed error. */
export function expectNonEmptyString(
  value: unknown,
  field: string,
  code: (typeof EXPERT_CALIBRATION_ERROR_CODES)[keyof typeof EXPERT_CALIBRATION_ERROR_CODES],
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExpertCalibrationError(code, {
      message: `${context}: ${field} must be a non-empty string`,
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Authority / PII field-name screen (lock rule 9 — masquerade defense)
// ---------------------------------------------------------------------------

const AUTHORITY_KEY_STEMS = [
  'authorit',
  'authoriz',
  'admin',
  'permission',
  'privileg',
  'entitle',
  'grant',
  'superuser',
  'impersonat',
  'accesslevel',
  'systemrole',
  'systemright',
  'mandate',
  'clearance',
] as const;

const PII_KEY_STEMS = ['email', 'phone', 'legalname', 'dateofbirth', 'address', 'ssn', 'passport'] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reject authority-shaped / PII-shaped FIELD NAMES at any depth of a
 * calibration value. Calibration output is measurement DATA only; a
 * permission-shaped record smuggled into calibration data is rejected at
 * the earliest boundary (the data itself) — calibration-masquerading-as-
 * authorization fails closed (lock rule 9).
 */
export function screenFieldNames(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => screenFieldNames(entry, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    for (const stem of AUTHORITY_KEY_STEMS) {
      if (normalized.includes(stem)) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.MASQUERADE_REJECTED, {
          message: `calibration field '${path}.${key}' is authority-shaped — calibration output carries measurement DATA only, never an access grant (lock rule 9)`,
          details: { path: `${path}.${key}`, stem },
        });
      }
    }
    for (const stem of PII_KEY_STEMS) {
      if (normalized.includes(stem)) {
        throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.PRIVACY_VIOLATION, {
          message: `calibration field '${path}.${key}' is PII-shaped — minimal-PII capture rejects it by construction`,
          details: { path: `${path}.${key}`, stem },
        });
      }
    }
    screenFieldNames((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
