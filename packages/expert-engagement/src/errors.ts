/**
 * Expert-engagement protocol error taxonomy (Work Order C011; issue #117).
 *
 * @arena/expert-engagement owns its own closed error code set, mirroring
 * the sibling domain packages' typed errors (@arena/escalation's
 * EscalationError, @arena/payments' PaymentError — closed codes, core
 * category mapping, structured wire-safe form). Core-level failures
 * (canonicalization, envelope shape, correlation ids, schema refs)
 * propagate the original ProtocolError from @arena/protocol-core.
 *
 * ENGAGEMENT AVAILABILITY AND SLA MEASUREMENTS ARE DATA, NEVER
 * ENFORCEMENT AND NEVER MONEY (architecture-lock rules 9/33): no error
 * code, message or structured detail in this taxonomy moves money,
 * grants a permission or applies a penalty. The vocabulary is about
 * validation, integrity, lifecycle guards, capacity accounting and
 * versioning of ENGAGEMENT RECORDS AND MEASUREMENTS only. Enforcement
 * (routing penalties, quality consequences) belongs to downstream
 * consumers (C002/C020); settlement belongs to C010.
 */

export const EXPERT_ENGAGEMENT_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'idempotency',
  'integrity',
  'versioning',
  'unknown',
] as const);

export type ExpertEngagementErrorCategory =
  (typeof EXPERT_ENGAGEMENT_ERROR_CATEGORIES)[number];

export const EXPERT_ENGAGEMENT_ERROR_CODES = Object.freeze({
  INVALID_RECORD: 'EXPERT_ENGAGEMENT_INVALID_RECORD',
  INVALID_IDENTITY: 'EXPERT_ENGAGEMENT_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'EXPERT_ENGAGEMENT_INVALID_TIMESTAMP',
  INVALID_TEXT: 'EXPERT_ENGAGEMENT_INVALID_TEXT',
  INVALID_REF: 'EXPERT_ENGAGEMENT_INVALID_REF',
  INVALID_STATE: 'EXPERT_ENGAGEMENT_INVALID_STATE',
  INVALID_TRANSITION: 'EXPERT_ENGAGEMENT_INVALID_TRANSITION',
  INVALID_WINDOW: 'EXPERT_ENGAGEMENT_INVALID_WINDOW',
  INVALID_CAPACITY: 'EXPERT_ENGAGEMENT_INVALID_CAPACITY',
  INVALID_POLICY: 'EXPERT_ENGAGEMENT_INVALID_POLICY',
  TERMINAL_STATE: 'EXPERT_ENGAGEMENT_TERMINAL_STATE',
  OFFER_EXPIRED: 'EXPERT_ENGAGEMENT_OFFER_EXPIRED',
  DEADLINE_PASSED: 'EXPERT_ENGAGEMENT_DEADLINE_PASSED',
  CAPACITY_EXCEEDED: 'EXPERT_ENGAGEMENT_CAPACITY_EXCEEDED',
  ESCALATION_STATE_MISMATCH: 'EXPERT_ENGAGEMENT_ESCALATION_STATE_MISMATCH',
  IDENTITY_CONFLICT: 'EXPERT_ENGAGEMENT_IDENTITY_CONFLICT',
  DUPLICATE_TRANSITION: 'EXPERT_ENGAGEMENT_DUPLICATE_TRANSITION',
  CROSS_TENANT_ACCESS: 'EXPERT_ENGAGEMENT_CROSS_TENANT_ACCESS',
  TAMPERED: 'EXPERT_ENGAGEMENT_TAMPERED',
  VERSION_CONFLICT: 'EXPERT_ENGAGEMENT_VERSION_CONFLICT',
  NOT_FOUND: 'EXPERT_ENGAGEMENT_NOT_FOUND',
  UNKNOWN_ERROR: 'EXPERT_ENGAGEMENT_UNKNOWN_ERROR',
} as const);

export type ExpertEngagementErrorCode =
  (typeof EXPERT_ENGAGEMENT_ERROR_CODES)[keyof typeof EXPERT_ENGAGEMENT_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<ExpertEngagementErrorCode, ExpertEngagementErrorCategory>
> = {
  EXPERT_ENGAGEMENT_INVALID_RECORD: 'validation',
  EXPERT_ENGAGEMENT_INVALID_IDENTITY: 'validation',
  EXPERT_ENGAGEMENT_INVALID_TIMESTAMP: 'validation',
  EXPERT_ENGAGEMENT_INVALID_TEXT: 'validation',
  EXPERT_ENGAGEMENT_INVALID_REF: 'validation',
  EXPERT_ENGAGEMENT_INVALID_STATE: 'validation',
  EXPERT_ENGAGEMENT_INVALID_TRANSITION: 'state',
  EXPERT_ENGAGEMENT_INVALID_WINDOW: 'validation',
  EXPERT_ENGAGEMENT_INVALID_CAPACITY: 'validation',
  EXPERT_ENGAGEMENT_INVALID_POLICY: 'validation',
  EXPERT_ENGAGEMENT_TERMINAL_STATE: 'state',
  EXPERT_ENGAGEMENT_OFFER_EXPIRED: 'state',
  EXPERT_ENGAGEMENT_DEADLINE_PASSED: 'state',
  EXPERT_ENGAGEMENT_CAPACITY_EXCEEDED: 'scope',
  EXPERT_ENGAGEMENT_ESCALATION_STATE_MISMATCH: 'state',
  EXPERT_ENGAGEMENT_IDENTITY_CONFLICT: 'idempotency',
  EXPERT_ENGAGEMENT_DUPLICATE_TRANSITION: 'idempotency',
  EXPERT_ENGAGEMENT_CROSS_TENANT_ACCESS: 'scope',
  EXPERT_ENGAGEMENT_TAMPERED: 'integrity',
  EXPERT_ENGAGEMENT_VERSION_CONFLICT: 'versioning',
  EXPERT_ENGAGEMENT_NOT_FOUND: 'validation',
  EXPERT_ENGAGEMENT_UNKNOWN_ERROR: 'unknown',
};

export interface ExpertEngagementErrorDetails {
  readonly message: string;
  readonly code: ExpertEngagementErrorCode;
  readonly category: ExpertEngagementErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Structured, wire-safe expert-engagement error. `toJSON` keeps the typed
 * shape serializable; `message` carries the human-auditable line.
 */
export class ExpertEngagementError extends Error {
  readonly code: ExpertEngagementErrorCode;
  readonly category: ExpertEngagementErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: ExpertEngagementErrorCode,
    init: { message: string; details?: Record<string, unknown> },
  ) {
    super(init.message);
    this.name = 'ExpertEngagementError';
    this.code = code;
    this.category = CODE_CATEGORY[code];
    this.details = init.details === undefined ? {} : Object.freeze({ ...init.details });
  }

  toJSON(): ExpertEngagementErrorDetails {
    return {
      message: this.message,
      code: this.code,
      category: this.category,
      ...(Object.keys(this.details).length > 0 ? { details: this.details } : {}),
    };
  }
}

/** Unknown error values → the typed UNKNOWN_ERROR envelope (fail closed). */
export function toExpertEngagementError(
  error: unknown,
  context: string,
): ExpertEngagementError {
  if (error instanceof ExpertEngagementError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ExpertEngagementError(EXPERT_ENGAGEMENT_ERROR_CODES.UNKNOWN_ERROR, {
    message: `${context}: unexpected failure (${message})`,
  });
}
