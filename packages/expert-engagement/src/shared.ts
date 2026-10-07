/**
 * Shared primitives for @arena/expert-engagement (Work Order C011).
 *
 * Branded ids, closed pattern sources and small validation helpers — the
 * house conventions (validated plain-string views, neutral charsets,
 * deep-freeze, fail-closed parsers). The urgency vocabulary MIRRORS the
 * merged C001 closed vocabulary (ESCALATION_URGENCIES in
 * @arena/escalation — routine | priority | urgent | critical) so real
 * escalation requests pass through unchanged; this package stays pure and
 * imports only @arena/protocol-core (the C005 package-dependency
 * discipline).
 */

import { EXPERT_ENGAGEMENT_ERROR_CODES, ExpertEngagementError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources (neutral charsets only; mirrored in tests)
// ---------------------------------------------------------------------------

export const ENGAGEMENT_ID_PATTERN_SOURCE = '^eng-[a-z0-9][a-z0-9-]{0,62}$';
export const AVAILABILITY_ID_PATTERN_SOURCE = '^avail-[a-z0-9][a-z0-9-]{0,62}$';
export const SLA_ID_PATTERN_SOURCE = '^sla-[a-z0-9][a-z0-9-]{0,62}$';
export const ENGAGEMENT_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const ENGAGEMENT_NEUTRAL_TEXT_PATTERN_SOURCE = '^[\\x20-\\x7E\\n\\t]{1,2048}$';
export const ENGAGEMENT_CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const ENGAGEMENT_TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ENGAGEMENT_EXPERT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,63}$';
export const ENGAGEMENT_LOCATOR_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';

const ENGAGEMENT_ID_PATTERN = new RegExp(ENGAGEMENT_ID_PATTERN_SOURCE);
const AVAILABILITY_ID_PATTERN = new RegExp(AVAILABILITY_ID_PATTERN_SOURCE);
const SLA_ID_PATTERN = new RegExp(SLA_ID_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(ENGAGEMENT_TIMESTAMP_PATTERN_SOURCE);
const NEUTRAL_TEXT_PATTERN = new RegExp(ENGAGEMENT_NEUTRAL_TEXT_PATTERN_SOURCE);
const CONTENT_DIGEST_PATTERN = new RegExp(ENGAGEMENT_CONTENT_DIGEST_PATTERN_SOURCE);
const TENANT_PATTERN = new RegExp(ENGAGEMENT_TENANT_PATTERN_SOURCE);
const EXPERT_ID_PATTERN = new RegExp(ENGAGEMENT_EXPERT_ID_PATTERN_SOURCE);
const LOCATOR_PATTERN = new RegExp(ENGAGEMENT_LOCATOR_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Branded scalar types
// ---------------------------------------------------------------------------

declare const brand: unique symbol;

export type EngagementId = string & { readonly [brand]: 'EngagementId' };
export type AvailabilityDeclarationId = string & {
  readonly [brand]: 'AvailabilityDeclarationId';
};
export type SlaRecordId = string & { readonly [brand]: 'SlaRecordId' };
export type EngagementTimestamp = string & { readonly [brand]: 'EngagementTimestamp' };
export type EngagementNeutralText = string & { readonly [brand]: 'EngagementNeutralText' };
export type EngagementContentDigest = string & { readonly [brand]: 'EngagementContentDigest' };
export type EngagementTenant = string & { readonly [brand]: 'EngagementTenant' };
export type EngagementExpertId = string & { readonly [brand]: 'EngagementExpertId' };
export type EngagementLocator = string & { readonly [brand]: 'EngagementLocator' };

export function isEngagementId(value: unknown): value is EngagementId {
  return typeof value === 'string' && ENGAGEMENT_ID_PATTERN.test(value);
}

export function isAvailabilityDeclarationId(
  value: unknown,
): value is AvailabilityDeclarationId {
  return typeof value === 'string' && AVAILABILITY_ID_PATTERN.test(value);
}

export function isSlaRecordId(value: unknown): value is SlaRecordId {
  return typeof value === 'string' && SLA_ID_PATTERN.test(value);
}

export function isEngagementTimestamp(value: unknown): value is EngagementTimestamp {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function isEngagementNeutralText(value: unknown): value is EngagementNeutralText {
  return typeof value === 'string' && NEUTRAL_TEXT_PATTERN.test(value);
}

export function isEngagementContentDigest(
  value: unknown,
): value is EngagementContentDigest {
  return typeof value === 'string' && CONTENT_DIGEST_PATTERN.test(value);
}

export function isEngagementTenant(value: unknown): value is EngagementTenant {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

export function isEngagementExpertId(value: unknown): value is EngagementExpertId {
  return typeof value === 'string' && EXPERT_ID_PATTERN.test(value);
}

export function isEngagementLocator(value: unknown): value is EngagementLocator {
  return typeof value === 'string' && LOCATOR_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// Strict parsers (throwing) — the house discipline of typed construction
// ---------------------------------------------------------------------------

function invalid(
  code: (typeof EXPERT_ENGAGEMENT_ERROR_CODES)[keyof typeof EXPERT_ENGAGEMENT_ERROR_CODES],
  message: string,
  details?: Record<string, unknown>,
): ExpertEngagementError {
  return new ExpertEngagementError(
    code,
    details === undefined ? { message } : { message, details },
  );
}

export function toEngagementId(value: string, field: string): EngagementId {
  if (!isEngagementId(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY,
      `${field} must match ${ENGAGEMENT_ID_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toAvailabilityDeclarationId(
  value: string,
  field: string,
): AvailabilityDeclarationId {
  if (!isAvailabilityDeclarationId(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY,
      `${field} must match ${AVAILABILITY_ID_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
      { field, pattern: AVAILABILITY_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toSlaRecordId(value: string, field: string): SlaRecordId {
  if (!isSlaRecordId(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY,
      `${field} must match ${SLA_ID_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
      { field, pattern: SLA_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementTimestamp(
  value: string,
  field: string,
): EngagementTimestamp {
  if (!isEngagementTimestamp(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TIMESTAMP,
      `${field} requires an ms-precision UTC timestamp (YYYY-MM-DDTHH:MM:SS.sssZ): ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_TIMESTAMP_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementNeutralText(
  value: string,
  field: string,
): EngagementNeutralText {
  if (!isEngagementNeutralText(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_TEXT,
      `${field}: text is not neutral-printable or exceeds 2048 characters: ${JSON.stringify(value.slice(0, 80))}…`,
      { field, pattern: ENGAGEMENT_NEUTRAL_TEXT_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementContentDigest(
  value: string,
  field: string,
): EngagementContentDigest {
  if (!isEngagementContentDigest(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_REF,
      `${field}: invalid content digest: ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_CONTENT_DIGEST_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementTenant(value: string, field: string): EngagementTenant {
  if (!isEngagementTenant(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY,
      `${field} requires a tenant scope matching ${ENGAGEMENT_TENANT_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_TENANT_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementExpertId(value: string, field: string): EngagementExpertId {
  if (!isEngagementExpertId(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_IDENTITY,
      `${field} requires a neutral expert id matching ${ENGAGEMENT_EXPERT_ID_PATTERN_SOURCE}: ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_EXPERT_ID_PATTERN_SOURCE },
    );
  }
  return value;
}

export function toEngagementLocator(value: string, field: string): EngagementLocator {
  if (!isEngagementLocator(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_REF,
      `${field}: invalid locator: ${JSON.stringify(value)}`,
      { field, pattern: ENGAGEMENT_LOCATOR_PATTERN_SOURCE },
    );
  }
  return value;
}

/** Require a positive safe integer (windows, capacities, durations). */
export function toPositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${field} requires a positive safe integer: ${JSON.stringify(value)}`,
      { field },
    );
  }
  return value;
}

/** Require a non-negative safe integer (counters, remaining slots). */
export function toNonNegativeInteger(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${field} requires a non-negative safe integer: ${JSON.stringify(value)}`,
      { field },
    );
  }
  return value;
}

export function expectNonEmptyString(
  value: unknown,
  field: string,
  context: string,
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${context}: ${field} requires a non-empty string: ${JSON.stringify(value)}`,
      { field },
    );
  }
  return value;
}

/**
 * Validate that `value` is a plain object carrying exactly `required`
 * fields (plus any of `optional` when present) — exact-field validation,
 * no silent unknown keys (house law).
 */
export function expectFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${context}: expected an object`,
    );
  }
  const record = value as Record<string, unknown>;
  const missing = required.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${context}: missing required field(s): ${missing.join(', ')}`,
      { missing },
    );
  }
  const allowed = new Set([...required, ...optional]);
  const unknown = Object.keys(record).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_RECORD,
      `${context}: unknown field(s) rejected: ${unknown.join(', ')}`,
      { unknown },
    );
  }
  return record;
}

/** Deep-freeze helper (the house discipline — records are frozen). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Closed vocabularies (consumed, mirrored or owned here)
// ---------------------------------------------------------------------------

/**
 * The urgency classes SLA policy keys on — MIRRORS the merged C001 closed
 * vocabulary (ESCALATION_URGENCIES — routine | priority | urgent |
 * critical) character-for-character; real EscalationRequests pass
 * through unchanged (structural compatibility, the A031 shared-view law).
 */
export const SLA_URGENCY_CLASSES = Object.freeze([
  'routine',
  'priority',
  'urgent',
  'critical',
] as const);
export type SlaUrgencyClass = (typeof SLA_URGENCY_CLASSES)[number];

export function isSlaUrgencyClass(value: unknown): value is SlaUrgencyClass {
  return (
    typeof value === 'string' &&
    (SLA_URGENCY_CLASSES as readonly string[]).includes(value)
  );
}

export function toSlaUrgencyClass(value: unknown, field: string): SlaUrgencyClass {
  if (!isSlaUrgencyClass(value)) {
    throw invalid(
      EXPERT_ENGAGEMENT_ERROR_CODES.INVALID_POLICY,
      `${field} must be one of the closed urgency classes (mirrors C001): ${SLA_URGENCY_CLASSES.join('|')}, got: ${JSON.stringify(value)}`,
      { field, known: [...SLA_URGENCY_CLASSES] },
    );
  }
  return value;
}
