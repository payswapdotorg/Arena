/**
 * Expert-calibration protocol error taxonomy (Work Order C004; issue #111).
 *
 * @arena/expert-calibration owns its own closed error code set, mirroring
 * the pattern of the sibling domain packages' typed errors
 * (@arena/expert-qualification's ExpertQualificationError,
 * @arena/expert-intake's ExpertIntakeError — closed codes, core category
 * mapping, structured wire-safe form). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * expert-calibration-domain failures carry EXPERT_CALIBRATION_* codes here
 * while core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) propagate the original ProtocolError.
 *
 * CALIBRATION IS DATA, NEVER AUTHORIZATION (architecture-lock rules 9/35):
 * no error code, message or structured detail in this taxonomy grants,
 * implies or records a permission; the vocabulary is about validation,
 * integrity, lifecycle and versioning of calibration DATA only.
 */

export const EXPERT_CALIBRATION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'lifecycle',
  'privacy',
  'adapter',
  'unknown',
] as const);

export type ExpertCalibrationErrorCategory = (typeof EXPERT_CALIBRATION_ERROR_CATEGORIES)[number];

export const EXPERT_CALIBRATION_ERROR_CODES = Object.freeze({
  INVALID_PROGRAM: 'EXPERT_CALIBRATION_INVALID_PROGRAM',
  INVALID_PROBE: 'EXPERT_CALIBRATION_INVALID_PROBE',
  INVALID_RECORD: 'EXPERT_CALIBRATION_INVALID_RECORD',
  INVALID_VERDICT: 'EXPERT_CALIBRATION_INVALID_VERDICT',
  INVALID_TRACK: 'EXPERT_CALIBRATION_INVALID_TRACK',
  INVALID_PROPOSAL: 'EXPERT_CALIBRATION_INVALID_PROPOSAL',
  INVALID_POLICY: 'EXPERT_CALIBRATION_INVALID_POLICY',
  INVALID_REF: 'EXPERT_CALIBRATION_INVALID_REF',
  INVALID_IDENTITY: 'EXPERT_CALIBRATION_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'EXPERT_CALIBRATION_INVALID_TIMESTAMP',
  INVALID_SEED: 'EXPERT_CALIBRATION_INVALID_SEED',
  BACKDATED_OUTCOME: 'EXPERT_CALIBRATION_BACKDATED_OUTCOME',
  LIFECYCLE_CONFLICT: 'EXPERT_CALIBRATION_LIFECYCLE_CONFLICT',
  NOT_FOUND: 'EXPERT_CALIBRATION_NOT_FOUND',
  TAMPERED: 'EXPERT_CALIBRATION_TAMPERED',
  TENANT_MISMATCH: 'EXPERT_CALIBRATION_TENANT_MISMATCH',
  PRIVACY_VIOLATION: 'EXPERT_CALIBRATION_PRIVACY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'EXPERT_CALIBRATION_IDEMPOTENCY_CONFLICT',
  MASQUERADE_REJECTED: 'EXPERT_CALIBRATION_MASQUERADE_REJECTED',
  PORT_FAILURE: 'EXPERT_CALIBRATION_PORT_FAILURE',
  VERSION_CONFLICT: 'EXPERT_CALIBRATION_VERSION_CONFLICT',
  UNKNOWN_ERROR: 'EXPERT_CALIBRATION_UNKNOWN_ERROR',
} as const);

export type ExpertCalibrationErrorCode = (typeof EXPERT_CALIBRATION_ERROR_CODES)[keyof typeof EXPERT_CALIBRATION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertCalibrationErrorCode, ExpertCalibrationErrorCategory>> = {
  EXPERT_CALIBRATION_INVALID_PROGRAM: 'validation',
  EXPERT_CALIBRATION_INVALID_PROBE: 'validation',
  EXPERT_CALIBRATION_INVALID_RECORD: 'validation',
  EXPERT_CALIBRATION_INVALID_VERDICT: 'validation',
  EXPERT_CALIBRATION_INVALID_TRACK: 'validation',
  EXPERT_CALIBRATION_INVALID_PROPOSAL: 'validation',
  EXPERT_CALIBRATION_INVALID_POLICY: 'validation',
  EXPERT_CALIBRATION_INVALID_REF: 'validation',
  EXPERT_CALIBRATION_INVALID_IDENTITY: 'validation',
  EXPERT_CALIBRATION_INVALID_TIMESTAMP: 'validation',
  EXPERT_CALIBRATION_INVALID_SEED: 'validation',
  EXPERT_CALIBRATION_BACKDATED_OUTCOME: 'integrity',
  EXPERT_CALIBRATION_LIFECYCLE_CONFLICT: 'lifecycle',
  EXPERT_CALIBRATION_NOT_FOUND: 'validation',
  EXPERT_CALIBRATION_TAMPERED: 'integrity',
  EXPERT_CALIBRATION_TENANT_MISMATCH: 'privacy',
  EXPERT_CALIBRATION_PRIVACY_VIOLATION: 'privacy',
  EXPERT_CALIBRATION_IDEMPOTENCY_CONFLICT: 'integrity',
  EXPERT_CALIBRATION_MASQUERADE_REJECTED: 'privacy',
  EXPERT_CALIBRATION_PORT_FAILURE: 'adapter',
  EXPERT_CALIBRATION_VERSION_CONFLICT: 'versioning',
  EXPERT_CALIBRATION_UNKNOWN_ERROR: 'unknown',
};

export interface ExpertCalibrationErrorDetails {
  readonly message: string;
  readonly code: ExpertCalibrationErrorCode;
  readonly category: ExpertCalibrationErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Structured, wire-safe expert-calibration error. `toJSON` keeps the typed
 * shape serializable; `message` carries the human-auditable line.
 */
export class ExpertCalibrationError extends Error {
  readonly code: ExpertCalibrationErrorCode;
  readonly category: ExpertCalibrationErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ExpertCalibrationErrorCode,
    init: { message: string; details?: Record<string, unknown> },
  ) {
    super(init.message);
    this.name = 'ExpertCalibrationError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = init.details === undefined ? {} : Object.freeze({ ...init.details });
  }

  toJSON(): ExpertCalibrationErrorDetails {
    return {
      message: this.message,
      code: this.code,
      category: this.category,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

/** Unknown error values → the typed UNKNOWN_ERROR envelope (fail closed). */
export function toExpertCalibrationError(error: unknown, context: string): ExpertCalibrationError {
  if (error instanceof ExpertCalibrationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.UNKNOWN_ERROR, {
    message: `${context}: unexpected failure (${message})`,
  });
}
