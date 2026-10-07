/**
 * Expert-performance protocol error taxonomy (Work Order C005; issue #112).
 *
 * @arena/expert-performance owns its own closed error code set, mirroring
 * the sibling domain packages' typed errors (@arena/expert-calibration's
 * ExpertCalibrationError, @arena/expert-qualification's
 * ExpertQualificationError — closed codes, core category mapping,
 * structured wire-safe form). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * expert-performance-domain failures carry EXPERT_PERFORMANCE_* codes here
 * while core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) propagate the original ProtocolError.
 *
 * PERFORMANCE EVIDENCE IS DATA, NEVER AN AUTHORIZATION AND NEVER A
 * CORRECTNESS VERIFICATION (architecture-lock rules 9/35): no error code,
 * message or structured detail in this taxonomy grants, implies or
 * records a permission or a verification verdict; the vocabulary is about
 * validation, integrity, lifecycle, attribution discipline and versioning
 * of performance DATA only.
 */

export const EXPERT_PERFORMANCE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'lifecycle',
  'privacy',
  'adapter',
  'unknown',
] as const);

export type ExpertPerformanceErrorCategory = (typeof EXPERT_PERFORMANCE_ERROR_CATEGORIES)[number];

export const EXPERT_PERFORMANCE_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'EXPERT_PERFORMANCE_INVALID_RECORD',
  INVALID_DIMENSION: 'EXPERT_PERFORMANCE_INVALID_DIMENSION',
  INVALID_OUTCOME: 'EXPERT_PERFORMANCE_INVALID_OUTCOME',
  INVALID_AGGREGATE: 'EXPERT_PERFORMANCE_INVALID_AGGREGATE',
  INVALID_POLICY: 'EXPERT_PERFORMANCE_INVALID_POLICY',
  INVALID_REF: 'EXPERT_PERFORMANCE_INVALID_REF',
  INVALID_IDENTITY: 'EXPERT_PERFORMANCE_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'EXPERT_PERFORMANCE_INVALID_TIMESTAMP',
  INVALID_SOURCE: 'EXPERT_PERFORMANCE_INVALID_SOURCE',
  ATTRIBUTION_VIOLATION: 'EXPERT_PERFORMANCE_ATTRIBUTION_VIOLATION',
  GLOBAL_SCORE_REJECTED: 'EXPERT_PERFORMANCE_GLOBAL_SCORE_REJECTED',
  APPEND_ONLY_VIOLATION: 'EXPERT_PERFORMANCE_APPEND_ONLY_VIOLATION',
  DUPLICATE_EVIDENCE: 'EXPERT_PERFORMANCE_DUPLICATE_EVIDENCE',
  BACKDATED_RECORD: 'EXPERT_PERFORMANCE_BACKDATED_RECORD',
  NOT_FOUND: 'EXPERT_PERFORMANCE_NOT_FOUND',
  TAMPERED: 'EXPERT_PERFORMANCE_TAMPERED',
  TENANT_MISMATCH: 'EXPERT_PERFORMANCE_TENANT_MISMATCH',
  PRIVACY_VIOLATION: 'EXPERT_PERFORMANCE_PRIVACY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'EXPERT_PERFORMANCE_IDEMPOTENCY_CONFLICT',
  MASQUERADE_REJECTED: 'EXPERT_PERFORMANCE_MASQUERADE_REJECTED',
  PORT_FAILURE: 'EXPERT_PERFORMANCE_PORT_FAILURE',
  VERSION_CONFLICT: 'EXPERT_PERFORMANCE_VERSION_CONFLICT',
  UNKNOWN_ERROR: 'EXPERT_PERFORMANCE_UNKNOWN_ERROR',
} as const);

export type ExpertPerformanceErrorCode =
  (typeof EXPERT_PERFORMANCE_ERROR_CODES)[keyof typeof EXPERT_PERFORMANCE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertPerformanceErrorCode, ExpertPerformanceErrorCategory>> =
  {
    EXPERT_PERFORMANCE_INVALID_RECORD: 'validation',
    EXPERT_PERFORMANCE_INVALID_DIMENSION: 'validation',
    EXPERT_PERFORMANCE_INVALID_OUTCOME: 'validation',
    EXPERT_PERFORMANCE_INVALID_AGGREGATE: 'validation',
    EXPERT_PERFORMANCE_INVALID_POLICY: 'validation',
    EXPERT_PERFORMANCE_INVALID_REF: 'validation',
    EXPERT_PERFORMANCE_INVALID_IDENTITY: 'validation',
    EXPERT_PERFORMANCE_INVALID_TIMESTAMP: 'validation',
    EXPERT_PERFORMANCE_INVALID_SOURCE: 'validation',
    EXPERT_PERFORMANCE_ATTRIBUTION_VIOLATION: 'integrity',
    EXPERT_PERFORMANCE_GLOBAL_SCORE_REJECTED: 'integrity',
    EXPERT_PERFORMANCE_APPEND_ONLY_VIOLATION: 'integrity',
    EXPERT_PERFORMANCE_DUPLICATE_EVIDENCE: 'integrity',
    EXPERT_PERFORMANCE_BACKDATED_RECORD: 'integrity',
    EXPERT_PERFORMANCE_NOT_FOUND: 'validation',
    EXPERT_PERFORMANCE_TAMPERED: 'integrity',
    EXPERT_PERFORMANCE_TENANT_MISMATCH: 'privacy',
    EXPERT_PERFORMANCE_PRIVACY_VIOLATION: 'privacy',
    EXPERT_PERFORMANCE_IDEMPOTENCY_CONFLICT: 'integrity',
    EXPERT_PERFORMANCE_MASQUERADE_REJECTED: 'privacy',
    EXPERT_PERFORMANCE_PORT_FAILURE: 'adapter',
    EXPERT_PERFORMANCE_VERSION_CONFLICT: 'versioning',
    EXPERT_PERFORMANCE_UNKNOWN_ERROR: 'unknown',
  };

export interface ExpertPerformanceErrorDetails {
  readonly message: string;
  readonly code: ExpertPerformanceErrorCode;
  readonly category: ExpertPerformanceErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Structured, wire-safe expert-performance error. `toJSON` keeps the typed
 * shape serializable; `message` carries the human-auditable line.
 */
export class ExpertPerformanceError extends Error {
  readonly code: ExpertPerformanceErrorCode;
  readonly category: ExpertPerformanceErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ExpertPerformanceErrorCode,
    init: { message: string; details?: Record<string, unknown> },
  ) {
    super(init.message);
    this.name = 'ExpertPerformanceError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = init.details === undefined ? {} : Object.freeze({ ...init.details });
  }

  toJSON(): ExpertPerformanceErrorDetails {
    return {
      message: this.message,
      code: this.code,
      category: this.category,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

/** Unknown error values → the typed UNKNOWN_ERROR envelope (fail closed). */
export function toExpertPerformanceError(
  error: unknown,
  context: string,
): ExpertPerformanceError {
  if (error instanceof ExpertPerformanceError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExpertPerformanceError(EXPERT_PERFORMANCE_ERROR_CODES.UNKNOWN_ERROR, {
    message: `${context}: unexpected failure (${message})`,
  });
}
