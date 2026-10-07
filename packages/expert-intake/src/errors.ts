/**
 * Expert-intake protocol error taxonomy (Work Order C003; issue #110).
 *
 * @arena/expert-intake owns its own closed error code set, mirroring the
 * pattern of the sibling domain packages' typed errors
 * (@arena/expert-qualification's ExpertQualificationError,
 * @arena/escalation-routing's EscalationRoutingError — closed codes, core
 * category mapping, structured wire-safe form). The core taxonomy is
 * frozen inside @arena/protocol-core (A001 surface, read-only for this
 * package), so expert-intake failures carry EXPERT_INTAKE_* codes here
 * while core-level failures (canonicalization, envelope shape,
 * correlation ids, schema refs) propagate the original ProtocolError.
 *
 * CLAIMS ARE DATA, NEVER AN ACCESS GRANT (architecture-lock rules 9/35):
 * no error code, message or structured detail in this taxonomy grants,
 * implies or records a permission. The vocabulary is about validation,
 * integrity, privacy discipline and versioning of intake DATA only.
 */

export const EXPERT_INTAKE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'privacy',
  'lifecycle',
  'adapter',
  'unknown',
] as const);

export type ExpertIntakeErrorCategory = (typeof EXPERT_INTAKE_ERROR_CATEGORIES)[number];

export const EXPERT_INTAKE_ERROR_CODES = Object.freeze({
  INVALID_SESSION: 'EXPERT_INTAKE_INVALID_SESSION',
  INVALID_ITEM: 'EXPERT_INTAKE_INVALID_ITEM',
  INVALID_ANSWER: 'EXPERT_INTAKE_INVALID_ANSWER',
  INVALID_PROFILE: 'EXPERT_INTAKE_INVALID_PROFILE',
  INVALID_OUTCOME: 'EXPERT_INTAKE_INVALID_OUTCOME',
  INVALID_REF: 'EXPERT_INTAKE_INVALID_REF',
  INVALID_TIMESTAMP: 'EXPERT_INTAKE_INVALID_TIMESTAMP',
  INVALID_SEED: 'EXPERT_INTAKE_INVALID_SEED',
  LIFECYCLE_CONFLICT: 'EXPERT_INTAKE_LIFECYCLE_CONFLICT',
  NOT_FOUND: 'EXPERT_INTAKE_NOT_FOUND',
  TAMPERED: 'EXPERT_INTAKE_TAMPERED',
  TENANT_MISMATCH: 'EXPERT_INTAKE_TENANT_MISMATCH',
  PRIVACY_VIOLATION: 'EXPERT_INTAKE_PRIVACY_VIOLATION',
  IDEMPOTENCY_CONFLICT: 'EXPERT_INTAKE_IDEMPOTENCY_CONFLICT',
  MODEL_ADAPTER_FAILURE: 'EXPERT_INTAKE_MODEL_ADAPTER_FAILURE',
  PORT_FAILURE: 'EXPERT_INTAKE_PORT_FAILURE',
  VERSION_CONFLICT: 'EXPERT_INTAKE_VERSION_CONFLICT',
  UNKNOWN_ERROR: 'EXPERT_INTAKE_UNKNOWN_ERROR',
} as const);

export type ExpertIntakeErrorCode = (typeof EXPERT_INTAKE_ERROR_CODES)[keyof typeof EXPERT_INTAKE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertIntakeErrorCode, ExpertIntakeErrorCategory>> = {
  EXPERT_INTAKE_INVALID_SESSION: 'validation',
  EXPERT_INTAKE_INVALID_ITEM: 'validation',
  EXPERT_INTAKE_INVALID_ANSWER: 'validation',
  EXPERT_INTAKE_INVALID_PROFILE: 'validation',
  EXPERT_INTAKE_INVALID_OUTCOME: 'validation',
  EXPERT_INTAKE_INVALID_REF: 'validation',
  EXPERT_INTAKE_INVALID_TIMESTAMP: 'validation',
  EXPERT_INTAKE_INVALID_SEED: 'validation',
  EXPERT_INTAKE_LIFECYCLE_CONFLICT: 'lifecycle',
  EXPERT_INTAKE_NOT_FOUND: 'validation',
  EXPERT_INTAKE_TAMPERED: 'integrity',
  EXPERT_INTAKE_TENANT_MISMATCH: 'privacy',
  EXPERT_INTAKE_PRIVACY_VIOLATION: 'privacy',
  EXPERT_INTAKE_IDEMPOTENCY_CONFLICT: 'integrity',
  EXPERT_INTAKE_MODEL_ADAPTER_FAILURE: 'adapter',
  EXPERT_INTAKE_PORT_FAILURE: 'adapter',
  EXPERT_INTAKE_VERSION_CONFLICT: 'versioning',
  EXPERT_INTAKE_UNKNOWN_ERROR: 'unknown',
};

export interface ExpertIntakeErrorDetails {
  readonly message: string;
  readonly code: ExpertIntakeErrorCode;
  readonly category: ExpertIntakeErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Structured, wire-safe expert-intake error. `toJSON` keeps the typed
 * shape serializable; `message` carries the human-auditable line.
 */
export class ExpertIntakeError extends Error {
  readonly code: ExpertIntakeErrorCode;
  readonly category: ExpertIntakeErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ExpertIntakeErrorCode, init: { message: string; details?: Record<string, unknown> }) {
    super(init.message);
    this.name = 'ExpertIntakeError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = init.details === undefined ? {} : Object.freeze({ ...init.details });
  }

  toJSON(): ExpertIntakeErrorDetails {
    return {
      message: this.message,
      code: this.code,
      category: this.category,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

/** Unknown error values → the typed UNKNOWN_ERROR envelope (fail closed). */
export function toExpertIntakeError(error: unknown, context: string): ExpertIntakeError {
  if (error instanceof ExpertIntakeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.UNKNOWN_ERROR, {
    message: `${context}: unexpected failure (${message})`,
  });
}
