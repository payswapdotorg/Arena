/**
 * Shared primitives for @arena/expert-performance (Work Order C005).
 *
 * Branded ids, closed pattern sources and small validation helpers — the
 * house conventions (validated plain-string views, neutral charsets,
 * exact-field validation rejecting unknown keys, deep-freeze). The
 * capability-node ref vocabulary is CONSUMED from
 * @arena/expert-qualification — never redefined here.
 */

import { EXPERT_PERFORMANCE_ERROR_CODES, ExpertPerformanceError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources (mirrored in tests; neutral charsets only)
// ---------------------------------------------------------------------------

export const PERFORMANCE_RECORD_ID_PATTERN_SOURCE = '^perf-[a-z0-9][a-z0-9-]{0,62}$';
export const PERFORMANCE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const PERFORMANCE_NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,2048}$';
export const PERFORMANCE_CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const PERFORMANCE_LOCATOR_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';
export const PERFORMANCE_TASK_FAMILY_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const PERFORMANCE_TENANT_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';

const RECORD_ID_PATTERN = new RegExp(PERFORMANCE_RECORD_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(PERFORMANCE_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(PERFORMANCE_NEUTRAL_TEXT_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(PERFORMANCE_CONTENT_DIGEST_PATTERN_SOURCE);
const LOCATOR_PATTERN = new RegExp(PERFORMANCE_LOCATOR_PATTERN_SOURCE);
const TASK_FAMILY_PATTERN = new RegExp(PERFORMANCE_TASK_FAMILY_PATTERN_SOURCE);
const TENANT_PATTERN = new RegExp(PERFORMANCE_TENANT_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalar types
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

export type PerformanceRecordId = string & { readonly [brand]: 'PerformanceRecordId' };
export type PerformanceTimestamp = string & { readonly [brand]: 'PerformanceTimestamp' };
export type PerformanceNeutralText = string & { readonly [brand]: 'PerformanceNeutralText' };
export type PerformanceContentDigest = string & { readonly [brand]: 'PerformanceContentDigest' };
export type PerformanceLocator = string & { readonly [brand]: 'PerformanceLocator' };
export type PerformanceTaskFamily = string & { readonly [brand]: 'PerformanceTaskFamily' };
export type PerformanceTenant = string & { readonly [brand]: 'PerformanceTenant' };

export function isPerformanceRecordId(value: unknown): value is PerformanceRecordId {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

export function isPerformanceTimestamp(value: unknown): value is PerformanceTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isPerformanceNeutralText(value: unknown): value is PerformanceNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isPerformanceContentDigest(value: unknown): value is PerformanceContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isPerformanceLocator(value: unknown): value is PerformanceLocator {
  return typeof value === 'string' && LOCATOR_PATTERN.test(value);
}

export function isPerformanceTaskFamily(value: unknown): value is PerformanceTaskFamily {
  return typeof value === 'string' && TASK_FAMILY_PATTERN.test(value);
}

export function isPerformanceTenant(value: unknown): value is PerformanceTenant {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

function invalid(
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  message: string,
  details?: Record<string, unknown>,
): ExpertPerformanceError {
  return new ExpertPerformanceError(code, details === undefined ? { message } : { message, details });
}

export function toPerformanceRecordId(value: string, context: string): PerformanceRecordId {
  if (!isPerformanceRecordId(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY,
      `${context}: invalid performance record id: ${JSON.stringify(value)} (expected 'perf-<lowercase-kebab>')`,
      { field: context, pattern: PERFORMANCE_RECORD_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceTimestamp(value: string, field: string): PerformanceTimestamp {
  if (!isPerformanceTimestamp(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_TIMESTAMP,
      `${field}: invalid performance timestamp: ${JSON.stringify(value)} (ms-precision UTC RFC 3339 required)`,
      { field, pattern: PERFORMANCE_TIMESTAMP_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceNeutralText(value: string, field: string): PerformanceNeutralText {
  if (!isPerformanceNeutralText(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      `${field}: text is not neutral-printable or exceeds 2048 characters: ${JSON.stringify(value.slice(0, 80))}…`,
      { field, pattern: PERFORMANCE_NEUTRAL_TEXT_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceContentDigest(
  value: string,
  field: string,
): PerformanceContentDigest {
  if (!isPerformanceContentDigest(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF,
      `${field}: invalid content digest: ${JSON.stringify(value)}`,
      { field, pattern: PERFORMANCE_CONTENT_DIGEST_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceLocator(value: string, field: string): PerformanceLocator {
  if (!isPerformanceLocator(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_REF,
      `${field}: invalid locator: ${JSON.stringify(value)}`,
      { field, pattern: PERFORMANCE_LOCATOR_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceTaskFamily(value: string, field: string): PerformanceTaskFamily {
  if (!isPerformanceTaskFamily(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      `${field}: invalid task family: ${JSON.stringify(value)} (lowercase-kebab required)`,
      { field, pattern: PERFORMANCE_TASK_FAMILY_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toPerformanceTenant(value: string, field: string): PerformanceTenant {
  if (!isPerformanceTenant(value)) {
    throw invalid(
      EXPERT_PERFORMANCE_ERROR_CODES.INVALID_IDENTITY,
      `${field}: invalid tenant: ${JSON.stringify(value)} (lowercase-kebab required)`,
      { field, pattern: PERFORMANCE_TENANT_PATTERN_SOURCE },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Structural helpers (exact-field validation — no silent unknown keys)
// ---------------------------------------------------------------------------

/**
 * Validate that `value` is a plain object carrying exactly `required`
 * fields (plus any of `optional` when present). Returns the record.
 *
 * The no-single-global-score law is enforced STRUCTURALLY at this
 * boundary: a smuggled extra field (e.g. `globalScore`, `overallScore`,
 * `rating`) is an unknown key and fails closed here — no view assembled by
 * this package can carry a cross-dimension score.
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(code, `${context}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  const missing = required.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw invalid(code, `${context}: missing required field(s): ${missing.join(', ')}`, { missing });
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalid(code, `${context}: unknown field(s) rejected: ${unknown.join(', ')}`, { unknown });
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

/** Validate a number within [min, max] with a typed error (inclusive bounds). */
export function expectNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalid(code, `${context}: ${field} must be a finite number, got: ${String(value)}`);
  }
  if (value < min || value > max) {
    throw invalid(
      code,
      `${context}: ${field} must be within [${String(min)}, ${String(max)}], got: ${String(value)}`,
      { field, min, max, actual: value },
    );
  }
  return value;
}

/** Validate a non-negative integer with a typed error. */
export function expectNonNegativeInteger(
  value: unknown,
  field: string,
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid(
      code,
      `${context}: ${field} must be a non-negative integer, got: ${String(value)}`,
      { field },
    );
  }
  return value;
}

/** Validate a positive integer with a typed error. */
export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  context: string,
): number {
  const nonNegative = expectNonNegativeInteger(value, field, code, context);
  if (nonNegative === 0) {
    throw invalid(code, `${context}: ${field} must be a positive integer (>= 1)`, { field });
  }
  return nonNegative;
}

/** Validate a non-empty neutral identifier string with a typed error. */
export function expectNonEmptyString(
  value: unknown,
  field: string,
  code: (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES],
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(code, `${context}: ${field} must be a non-empty string`);
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

const PII_KEY_STEMS = [
  'email',
  'phone',
  'legalname',
  'dateofbirth',
  'address',
  'ssn',
  'passport',
] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Reject authority-shaped / PII-shaped FIELD NAMES at any depth of a
 * performance value. Performance evidence is measurement DATA only; a
 * permission-shaped record smuggled into performance data is rejected at
 * the earliest boundary (the data itself) — performance-masquerading-as-
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
        throw invalid(
          EXPERT_PERFORMANCE_ERROR_CODES.MASQUERADE_REJECTED,
          `performance field '${path}.${key}' is authority-shaped — performance evidence carries measurement DATA only, never an access grant (lock rule 9)`,
          { path: `${path}.${key}`, stem },
        );
      }
    }
    for (const stem of PII_KEY_STEMS) {
      if (normalized.includes(stem)) {
        throw invalid(
          EXPERT_PERFORMANCE_ERROR_CODES.PRIVACY_VIOLATION,
          `performance field '${path}.${key}' is PII-shaped — minimal-PII capture rejects it by construction`,
          { path: `${path}.${key}`, stem },
        );
      }
    }
    screenFieldNames((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
