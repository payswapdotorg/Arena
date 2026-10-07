/**
 * Shared primitives for @arena/network-quality (Work Order C020).
 *
 * Branded ids, closed pattern sources and small validation helpers — the
 * house conventions (validated plain-string views, neutral charsets,
 * exact-field validation rejecting unknown keys, deep-freeze, authority/PII
 * field screening). Vocabularies of other surfaces are CONSUMED — never
 * redefined here.
 */

import {
  NETWORK_QUALITY_ERROR_CODES,
  NetworkQualityError,
} from './errors.js';
import type { NetworkQualityErrorCode } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources (mirrored in tests; neutral charsets only)
// ---------------------------------------------------------------------------

export const NETWORK_QUALITY_RECORD_ID_PATTERN_SOURCE = '^nq-[a-z0-9][a-z0-9-]{0,62}$';
export const NETWORK_QUALITY_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const NETWORK_QUALITY_NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,2048}$';
export const NETWORK_QUALITY_CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const NETWORK_QUALITY_LOCATOR_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';
export const NETWORK_QUALITY_TENANT_PATTERN_SOURCE = '^[a-z0-9][a-z0-9-]{0,63}$';
export const NETWORK_QUALITY_PARTY_PATTERN_SOURCE = '^[a-z0-9][a-z0-9._:-]{0,127}$';

const RECORD_ID_PATTERN = new RegExp(NETWORK_QUALITY_RECORD_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(NETWORK_QUALITY_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(NETWORK_QUALITY_NEUTRAL_TEXT_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(NETWORK_QUALITY_CONTENT_DIGEST_PATTERN_SOURCE);
const LOCATOR_PATTERN = new RegExp(NETWORK_QUALITY_LOCATOR_PATTERN_SOURCE);
const TENANT_PATTERN = new RegExp(NETWORK_QUALITY_TENANT_PATTERN_SOURCE);
const PARTY_PATTERN = new RegExp(NETWORK_QUALITY_PARTY_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalar types
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

export type NetworkQualityRecordId = string & { readonly [brand]: 'NetworkQualityRecordId' };
export type NetworkQualityTimestamp = string & { readonly [brand]: 'NetworkQualityTimestamp' };
export type NetworkQualityNeutralText = string & { readonly [brand]: 'NetworkQualityNeutralText' };
export type NetworkQualityContentDigest = string & { readonly [brand]: 'NetworkQualityContentDigest' };
export type NetworkQualityLocator = string & { readonly [brand]: 'NetworkQualityLocator' };
export type NetworkQualityTenant = string & { readonly [brand]: 'NetworkQualityTenant' };
export type NetworkQualityParty = string & { readonly [brand]: 'NetworkQualityParty' };

export function isNetworkQualityRecordId(value: unknown): value is NetworkQualityRecordId {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

export function isNetworkQualityTimestamp(value: unknown): value is NetworkQualityTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isNetworkQualityNeutralText(value: unknown): value is NetworkQualityNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isNetworkQualityContentDigest(
  value: unknown,
): value is NetworkQualityContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isNetworkQualityLocator(value: unknown): value is NetworkQualityLocator {
  return typeof value === 'string' && LOCATOR_PATTERN.test(value);
}

export function isNetworkQualityTenant(value: unknown): value is NetworkQualityTenant {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function isNetworkQualityParty(value: unknown): value is NetworkQualityParty {
  return typeof value === 'string' && PARTY_PATTERN.test(value);
}

function invalid(
  code: NetworkQualityErrorCode,
  message: string,
  details?: Record<string, unknown> | undefined,
): never {
  if (details === undefined) {
    throw new NetworkQualityError(code, { message });
  }
  throw new NetworkQualityError(code, { message, details });
}

export function toNetworkQualityRecordId(value: string, context: string): NetworkQualityRecordId {
  if (!isNetworkQualityRecordId(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY,
      `${context}: recordId must match ${NETWORK_QUALITY_RECORD_ID_PATTERN_SOURCE}`,
      { value },
    );
  }
  return value;
}

export function toNetworkQualityTimestamp(value: string, field: string): NetworkQualityTimestamp {
  if (!isNetworkQualityTimestamp(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_TIMESTAMP,
      `${field} must be an ms-precision UTC timestamp matching ${NETWORK_QUALITY_TIMESTAMP_PATTERN_SOURCE}`,
      { value },
    );
  }
  return value;
}

export function toNetworkQualityNeutralText(value: string, field: string): NetworkQualityNeutralText {
  if (!isNetworkQualityNeutralText(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
      `${field} must be neutral text (printable ASCII, newline, tab; 1..2048 chars)`,
      { value: value.slice(0, 64) },
    );
  }
  return value;
}

export function toNetworkQualityContentDigest(
  value: string,
  field: string,
): NetworkQualityContentDigest {
  if (!isNetworkQualityContentDigest(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_REF,
      `${field} must be a sha256 content digest (64 lowercase hex chars)`,
      { value },
    );
  }
  return value;
}

export function toNetworkQualityLocator(value: string, field: string): NetworkQualityLocator {
  if (!isNetworkQualityLocator(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_REF,
      `${field} must be a locator matching ${NETWORK_QUALITY_LOCATOR_PATTERN_SOURCE}`,
      { value },
    );
  }
  return value;
}

export function toNetworkQualityTenant(value: string, field: string): NetworkQualityTenant {
  if (!isNetworkQualityTenant(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY,
      `${field} must be a tenant id matching ${NETWORK_QUALITY_TENANT_PATTERN_SOURCE}`,
      { value },
    );
  }
  return value;
}

export function toNetworkQualityParty(value: string, field: string): NetworkQualityParty {
  if (!isNetworkQualityParty(value)) {
    invalid(
      NETWORK_QUALITY_ERROR_CODES.INVALID_IDENTITY,
      `${field} must be a party ref matching ${NETWORK_QUALITY_PARTY_PATTERN_SOURCE}`,
      { value },
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Exact-field validation + freeze
// ---------------------------------------------------------------------------

export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  code: NetworkQualityErrorCode,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(code, `${context}: expected an object`);
  }
  const record = value as Record<string, unknown>;
  const missing = required.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    invalid(code, `${context}: missing required field(s): ${missing.join(', ')}`, { missing });
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    invalid(code, `${context}: unknown field(s) rejected: ${unknown.join(', ')}`, { unknown });
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

export function expectNumberInRange(
  value: unknown,
  field: string,
  min: number,
  max: number,
  code: NetworkQualityErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    invalid(code, `${context}: ${field} must be a finite number, got: ${String(value)}`);
  }
  if (value < min || value > max) {
    invalid(code, `${context}: ${field} must be within [${min}, ${max}], got: ${String(value)}`);
  }
  return value;
}

export function expectPositiveInteger(
  value: unknown,
  field: string,
  code: NetworkQualityErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    invalid(code, `${context}: ${field} must be a positive integer (>= 1)`);
  }
  return value;
}

export function expectNonNegativeInteger(
  value: unknown,
  field: string,
  code: NetworkQualityErrorCode,
  context: string,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    invalid(code, `${context}: ${field} must be a non-negative integer (>= 0)`);
  }
  return value;
}

export function expectNonEmptyString(
  value: unknown,
  field: string,
  code: NetworkQualityErrorCode,
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid(code, `${context}: ${field} must be a non-empty string`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Authority/PII field screening (lock rules 9/35 — reputation evidence is
// DATA, never an authorization grant; minimal-PII capture)
// ---------------------------------------------------------------------------

const AUTHORITY_KEY_STEMS = [
  'permission',
  'authoriz',
  'grant',
  'role',
  'access',
  'credential',
  'token',
  'secret',
  'admin',
];

const PII_KEY_STEMS = ['email', 'phone', 'address', 'passport', 'nationalid', 'ssn', 'dob', 'ipaddr'];

/**
 * Score-shaped key stems: a free-form payload (finding proposals) carrying
 * a global/overall/expert/reputation SCORE key is a silent-adjustment
 * smuggling attempt — rejected by construction (findings PROPOSE typed
 * actions; they never carry scores to apply).
 */
const SCORE_KEY_STEMS = ['globalscore', 'overallscore', 'expertscore', 'reputationscore', 'qualityscore'];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Recursively reject authority-shaped and PII-shaped field names: a
 * reputation/finding/COI record carrying such a key is a masquerade or a
 * privacy violation BY CONSTRUCTION, not by review.
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
        invalid(
          NETWORK_QUALITY_ERROR_CODES.MASQUERADE_REJECTED,
          `network-quality field '${path}.${key}' is authority-shaped -- network-quality evidence carries integrity DATA only, never an access grant (lock rule 9)`,
          { path: `${path}.${key}`, stem },
        );
      }
    }
    for (const stem of PII_KEY_STEMS) {
      if (normalized.includes(stem)) {
        invalid(
          NETWORK_QUALITY_ERROR_CODES.PRIVACY_VIOLATION,
          `network-quality field '${path}.${key}' is PII-shaped -- minimal-PII capture rejects it by construction`,
          { path: `${path}.${key}`, stem },
        );
      }
    }
    for (const stem of SCORE_KEY_STEMS) {
      if (normalized.includes(stem)) {
        invalid(
          NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
          `network-quality field '${path}.${key}' is score-shaped -- findings propose typed actions and never carry scores to apply (findings propose, never silently adjust)`,
          { path: `${path}.${key}`, stem },
        );
      }
    }
    screenFieldNames((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}
