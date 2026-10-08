/**
 * Capability-economics error taxonomy (Work Order C016; issue #122).
 * Mirrors the sibling domain packages' typed errors
 * (@arena/capability-routing's CapabilityRoutingError): closed code set,
 * category mapping, structured wire-safe form. Economics outcomes are
 * typed results, never bare booleans; errors are for STRUCTURALLY
 * invalid inputs, missing commercial backing, attribution violations and
 * integrity failures only.
 */

export const CAPABILITY_ECONOMICS_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'integrity',
  'versioning',
  'attribution',
  'unknown',
] as const);
export type CapabilityEconomicsErrorCategory =
  (typeof CAPABILITY_ECONOMICS_ERROR_CATEGORIES)[number];

export const CAPABILITY_ECONOMICS_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'CAPABILITY_ECONOMICS_INVALID_INPUT',
  INVALID_RECORD: 'CAPABILITY_ECONOMICS_INVALID_RECORD',
  INVALID_POLICY: 'CAPABILITY_ECONOMICS_INVALID_POLICY',
  INVALID_AGGREGATE: 'CAPABILITY_ECONOMICS_INVALID_AGGREGATE',
  INVALID_VALUE_RECORD: 'CAPABILITY_ECONOMICS_INVALID_VALUE_RECORD',
  LEDGER_BACKING_MISSING: 'CAPABILITY_ECONOMICS_LEDGER_BACKING_MISSING',
  LEDGER_INTEGRITY: 'CAPABILITY_ECONOMICS_LEDGER_INTEGRITY',
  CROSS_TENANT_ACCESS: 'CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS',
  MIXED_CURRENCY: 'CAPABILITY_ECONOMICS_MIXED_CURRENCY',
  MIXED_TRUTH: 'CAPABILITY_ECONOMICS_MIXED_TRUTH',
  ATTRIBUTION_VIOLATION: 'CAPABILITY_ECONOMICS_ATTRIBUTION_VIOLATION',
  LIFT_GATED: 'CAPABILITY_ECONOMICS_LIFT_GATED',
  COLLAPSED_SCORE: 'CAPABILITY_ECONOMICS_COLLAPSED_SCORE',
  TAMPERED: 'CAPABILITY_ECONOMICS_TAMPERED',
  SUPERSESSION_VIOLATION: 'CAPABILITY_ECONOMICS_SUPERSESSION_VIOLATION',
  UNKNOWN_ERROR: 'CAPABILITY_ECONOMICS_UNKNOWN_ERROR',
} as const);
export type CapabilityEconomicsErrorCode =
  (typeof CAPABILITY_ECONOMICS_ERROR_CODES)[keyof typeof CAPABILITY_ECONOMICS_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityEconomicsErrorCode, CapabilityEconomicsErrorCategory>
> = {
  CAPABILITY_ECONOMICS_INVALID_INPUT: 'validation',
  CAPABILITY_ECONOMICS_INVALID_RECORD: 'validation',
  CAPABILITY_ECONOMICS_INVALID_POLICY: 'validation',
  CAPABILITY_ECONOMICS_INVALID_AGGREGATE: 'validation',
  CAPABILITY_ECONOMICS_INVALID_VALUE_RECORD: 'validation',
  CAPABILITY_ECONOMICS_LEDGER_BACKING_MISSING: 'state',
  CAPABILITY_ECONOMICS_LEDGER_INTEGRITY: 'integrity',
  CAPABILITY_ECONOMICS_CROSS_TENANT_ACCESS: 'scope',
  CAPABILITY_ECONOMICS_MIXED_CURRENCY: 'validation',
  CAPABILITY_ECONOMICS_MIXED_TRUTH: 'validation',
  CAPABILITY_ECONOMICS_ATTRIBUTION_VIOLATION: 'attribution',
  CAPABILITY_ECONOMICS_LIFT_GATED: 'state',
  CAPABILITY_ECONOMICS_COLLAPSED_SCORE: 'validation',
  CAPABILITY_ECONOMICS_TAMPERED: 'integrity',
  CAPABILITY_ECONOMICS_SUPERSESSION_VIOLATION: 'versioning',
  CAPABILITY_ECONOMICS_UNKNOWN_ERROR: 'unknown',
};

export class CapabilityEconomicsError extends Error {
  readonly code: CapabilityEconomicsErrorCode;
  readonly category: CapabilityEconomicsErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: CapabilityEconomicsErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(input.message);
    this.name = 'CapabilityEconomicsError';
    this.code = code;
    this.category = CODE_CATEGORY[code] ?? 'unknown';
    this.details = Object.freeze({ ...(input.details ?? {}) });
  }
}
