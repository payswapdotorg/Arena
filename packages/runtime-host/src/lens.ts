/**
 * The canonical demo/customer truth lens (Work Order P002; issue #154;
 * ADR-P001-02 — "the explicit Demo/customer truth lens is the canonical
 * read-model convention").
 *
 * Rules encoded here (ADR-P001-02):
 *   1. exactly two values: 'demo' and 'customer' — no third lens is
 *      representable;
 *   2. the reserved demo tenant composition is the ONLY path that
 *      resolves `demo`; every other tenant resolves `customer`;
 *   3. cross-lens reads fail closed rather than silently merging —
 *      `assertLensMatches` throws the typed lens-conflict error.
 *
 * Persisted lens discipline (ADR-P001-02 consequences): the host stamps
 * the lens onto lifecycle/event/job/idempotency records at WRITE time
 * (the durable stores in @arena/hosted-neon-postgres carry the lens
 * column); read paths compare the caller's lens against the recorded
 * lens and fail closed on mismatch.
 */

/** Exactly two truth lenses. Demo state is not customer state (lock A2.0). */
export const TRUTH_LENSES = Object.freeze(['demo', 'customer'] as const);
export type TruthLens = (typeof TRUTH_LENSES)[number];

/**
 * The reserved demo tenant id. The C-series used visible demo tenants
 * (demo twins under /demo/**, the C021 labelled demo board tenant); the
 * host canonizes ONE reserved id so lens resolution is deterministic at
 * the composition boundary.
 */
export const DEMO_TENANT_ID = 'demo' as const;

/** Error code namespace for lens failures (closed vocabulary). */
export const LENS_ERROR_CODES = Object.freeze({
  LENS_CONFLICT: 'RUNTIME_LENS_CONFLICT',
  INVALID_LENS: 'RUNTIME_INVALID_LENS',
} as const);
export type LensErrorCode = (typeof LENS_ERROR_CODES)[keyof typeof LENS_ERROR_CODES];

/** Typed, machine-readable lens failure (never a bare boolean). */
export class LensError extends Error {
  readonly code: LensErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: LensErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'LensError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Type guard for the two-value lens vocabulary. */
export function isTruthLens(value: unknown): value is TruthLens {
  return typeof value === 'string' && (TRUTH_LENSES as readonly string[]).includes(value);
}

/** Validate + freeze a lens value; throws the typed error on anything else. */
export function toTruthLens(value: unknown): TruthLens {
  if (!isTruthLens(value)) {
    throw new LensError(
      LENS_ERROR_CODES.INVALID_LENS,
      `invalid truth lens: ${JSON.stringify(value)} (exactly two values are representable: demo, customer)`,
      { representable: [...TRUTH_LENSES] },
    );
  }
  return value;
}

/**
 * Resolve the lens for a tenant (ADR-P001-02 rule 3): the reserved demo
 * tenant resolves `demo`; every other tenant id resolves `customer`.
 */
export function lensForTenant(tenantId: string): TruthLens {
  return tenantId === DEMO_TENANT_ID ? 'demo' : 'customer';
}

/**
 * Fail-closed cross-lens guard (ADR-P001-02 rule 2): reading a record
 * persisted under one lens through a caller bound to the other lens is a
 * typed conflict — never a silent merge.
 */
export function assertLensMatches(recorded: TruthLens, caller: TruthLens): void {
  if (recorded !== caller) {
    throw new LensError(
      LENS_ERROR_CODES.LENS_CONFLICT,
      `truth-lens conflict: the record was persisted under lens "${recorded}" and may not be read through lens "${caller}" (cross-lens reads fail closed)`,
      { recorded, caller },
    );
  }
}
