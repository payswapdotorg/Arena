/**
 * Shared primitives for the capability-economics domain (Work Order C016;
 * issue #122). House conventions mirrored from @arena/payments /
 * @arena/capability-routing shared.ts:
 *   - branded identifiers validated by strict guards;
 *   - canonical ms-UTC timestamps as strings (NEVER wall-clock reads —
 *     injected by callers, architecture-lock rule 17);
 *   - plain-JSON value discipline + deep-freeze helpers;
 *   - closed vocabularies for every semantic field.
 *
 * THE NO-MONEY-TRUTH LAW: this package is the economic VIEW, never the
 * money authority (C010 owns the ledger — spec/service-boundaries.md "one
 * logical authority per data object"). Money FIGURES in economics records
 * are projections folded ONLY out of real C010 ledger state (see cost.ts);
 * they are recorded as canonical minor-unit strings using the C010 Money
 * primitives (composed, never forked).
 */

import {
  isMinorUnits,
  minorUnitsToBigInt,
  toMinorUnits,
} from '@arena/payments';
import type { MinorUnits } from '@arena/payments';
import { CAPABILITY_ECONOMICS_ERROR_CODES, CapabilityEconomicsError } from './errors.js';

// ---------------------------------------------------------------------------
// Wire version
// ---------------------------------------------------------------------------

/** Wire version of every capability-economics payload shape in this package. */
export const CAPABILITY_ECONOMICS_WIRE_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type EconomicsRecordId = string & { readonly __brand: 'EconomicsRecordId' };
export type EconomicsTenantId = string & { readonly __brand: 'EconomicsTenantId' };
export type EconomicsPolicyId = string & { readonly __brand: 'EconomicsPolicyId' };
export type ValueRecordId = string & { readonly __brand: 'ValueRecordId' };

export const ECONOMICS_RECORD_ID_PATTERN_SOURCE = '^econ_[0-9a-f]{32}$';
export const ECONOMICS_TENANT_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ECONOMICS_POLICY_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const VALUE_RECORD_ID_PATTERN_SOURCE = '^val_[0-9a-f]{32}$';

const ECONOMICS_RECORD_ID_RE = new RegExp(ECONOMICS_RECORD_ID_PATTERN_SOURCE);
const ECONOMICS_TENANT_ID_RE = new RegExp(ECONOMICS_TENANT_ID_PATTERN_SOURCE);
const ECONOMICS_POLICY_ID_RE = new RegExp(ECONOMICS_POLICY_ID_PATTERN_SOURCE);
const VALUE_RECORD_ID_RE = new RegExp(VALUE_RECORD_ID_PATTERN_SOURCE);

export function isEconomicsRecordId(value: unknown): value is EconomicsRecordId {
  return typeof value === 'string' && ECONOMICS_RECORD_ID_RE.test(value);
}

export function isEconomicsTenantId(value: unknown): value is EconomicsTenantId {
  return typeof value === 'string' && ECONOMICS_TENANT_ID_RE.test(value);
}

export function isEconomicsPolicyId(value: unknown): value is EconomicsPolicyId {
  return typeof value === 'string' && ECONOMICS_POLICY_ID_RE.test(value);
}

export function isValueRecordId(value: unknown): value is ValueRecordId {
  return typeof value === 'string' && VALUE_RECORD_ID_RE.test(value);
}

function brand<T extends string>(value: string): T {
  return Object.freeze(value) as T;
}

/** Validate and brand an economics record id (econ_ + 32 lowercase hex). */
export function toEconomicsRecordId(value: string): EconomicsRecordId {
  if (!isEconomicsRecordId(value)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `invalid economics record id: ${JSON.stringify(value)} (expected ${ECONOMICS_RECORD_ID_PATTERN_SOURCE})`,
    });
  }
  return brand<EconomicsRecordId>(value);
}

/** Validate and brand an economics tenant id. */
export function toEconomicsTenantId(value: string): EconomicsTenantId {
  if (!isEconomicsTenantId(value)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `invalid tenant id: ${JSON.stringify(value)} (expected ${ECONOMICS_TENANT_ID_PATTERN_SOURCE})`,
    });
  }
  return brand<EconomicsTenantId>(value);
}

/** Validate and brand an economics policy id. */
export function toEconomicsPolicyId(value: string): EconomicsPolicyId {
  if (!isEconomicsPolicyId(value)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_POLICY, {
      message: `invalid economics policy id: ${JSON.stringify(value)} (expected ${ECONOMICS_POLICY_ID_PATTERN_SOURCE})`,
    });
  }
  return brand<EconomicsPolicyId>(value);
}

/** Validate and brand a value record id (val_ + 32 lowercase hex). */
export function toValueRecordId(value: string): ValueRecordId {
  if (!isValueRecordId(value)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_VALUE_RECORD, {
      message: `invalid value record id: ${JSON.stringify(value)} (expected ${VALUE_RECORD_ID_PATTERN_SOURCE})`,
    });
  }
  return brand<ValueRecordId>(value);
}

/** Generate a fresh economics record id. */
export function newEconomicsRecordId(): EconomicsRecordId {
  return toEconomicsRecordId(`econ_${crypto.randomUUID().replaceAll('-', '')}`);
}

/** Generate a fresh value record id. */
export function newValueRecordId(): ValueRecordId {
  return toValueRecordId(`val_${crypto.randomUUID().replaceAll('-', '')}`);
}

// ---------------------------------------------------------------------------
// Timestamps (canonical ms-UTC strings; always injected, never wall-clock)
// ---------------------------------------------------------------------------

export const ECONOMICS_TIMESTAMP_PATTERN_SOURCE =
  '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$';

const ECONOMICS_TIMESTAMP_RE = new RegExp(ECONOMICS_TIMESTAMP_PATTERN_SOURCE);

export type EconomicsTimestamp = string;

export function isEconomicsTimestamp(value: unknown): value is EconomicsTimestamp {
  if (typeof value !== 'string' || !ECONOMICS_TIMESTAMP_RE.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

/** Normalize an injected time (epoch ms, ISO string or Date) to the canonical form. */
export function toEconomicsTimestamp(input: number | string | Date): EconomicsTimestamp {
  const ms =
    input instanceof Date ? input.getTime() : typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `invalid economics timestamp input: ${JSON.stringify(input)}`,
    });
  }
  return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Truth labels (mirrors the C010 law — demo money is never customer money)
// ---------------------------------------------------------------------------

export const ECONOMICS_TRUTH_LABELS = Object.freeze(['demo', 'customer'] as const);
export type EconomicsTruth = (typeof ECONOMICS_TRUTH_LABELS)[number];

export function isEconomicsTruth(value: unknown): value is EconomicsTruth {
  return (
    typeof value === 'string' &&
    (ECONOMICS_TRUTH_LABELS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Minor-unit figure helpers (C010 primitives — composed, never forked)
// ---------------------------------------------------------------------------

/** Sum a list of canonical minor-unit figures (BigInt-only arithmetic). */
export function sumMinorUnits(values: readonly MinorUnits[]): MinorUnits {
  let sum = 0n;
  for (const value of values) {
    if (!isMinorUnits(value)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
        message: `not a canonical minor-units figure: ${JSON.stringify(value)}`,
      });
    }
    sum += minorUnitsToBigInt(value);
  }
  return toMinorUnits(sum.toString(10));
}

/** Clamp a minor-unit figure at zero (recorded, never silently negative). */
export function clampMinorUnitsAtZero(value: MinorUnits): MinorUnits {
  const raw = minorUnitsToBigInt(value);
  return raw < 0n ? toMinorUnits('0') : value;
}

// ---------------------------------------------------------------------------
// Field validation helpers (exact-field discipline)
// ---------------------------------------------------------------------------

/** Reject unknown fields (smuggled collapsed scores, authority-shaped keys). */
export function rejectUnknownFields(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  typeName: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
        message: `unknown field ${JSON.stringify(key)} on ${typeName} — exact-field validation (allowed: ${allowed.join(', ')})`,
        details: { field: key, typeName, allowed },
      });
    }
  }
}

const COLLAPSED_SCORE_FIELD_PATTERN = /^(roi|roi_score|roiscore|score|global_score|value_score)$/i;

/**
 * THE NO-COLLAPSED-SCORE LAW (spec/quality-model.md, mirroring the C005
 * no-single-global-score law): economics aggregates and records never
 * carry a single collapsed score field. Smuggled score-shaped keys are
 * rejected with a typed COLLAPSED_SCORE error.
 */
export function rejectCollapsedScoreFields(
  value: Readonly<Record<string, unknown>>,
  typeName: string,
): void {
  for (const key of Object.keys(value)) {
    if (COLLAPSED_SCORE_FIELD_PATTERN.test(key)) {
      throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.COLLAPSED_SCORE, {
        message: `collapsed score field ${JSON.stringify(key)} is not representable on ${typeName} — Arena optimizes for verified capability gain per unit of expert effort, disclosed dimensionally (Q1.0); no single global score`,
        details: { field: key, typeName },
      });
    }
  }
}

/** Require a bounded non-empty string field. */
export function requireBoundedString(
  value: unknown,
  field: string,
  minLength = 1,
  maxLength = 256,
): string {
  if (typeof value !== 'string' || value.length < minLength || value.length > maxLength) {
    throw new CapabilityEconomicsError(CAPABILITY_ECONOMICS_ERROR_CODES.INVALID_INPUT, {
      message: `${field} must be a string of ${minLength}..${maxLength} characters: ${JSON.stringify(value)}`,
    });
  }
  return value;
}
