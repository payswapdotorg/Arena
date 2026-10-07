/**
 * Typed error surface for the Epoch escalation reference adapter
 * (Work Order C019; issue #125).
 *
 * Every failure is machine-readable: a closed code vocabulary with a
 * category projection — NEVER a bare boolean, never a stringly verdict.
 * The Epoch escalation adapter is an INTEGRATION BOUNDARY (ES1.0 design
 * constraint; architecture-lock rules 13-15 and 36): it translates and
 * projects, it never becomes Epoch's semantic authority and it never
 * writes back to Epoch authoritative stores.
 */

export const EPOCH_ESCALATION_ERROR_CATEGORIES = Object.freeze([
  'invalid-input',
  'authority-violation',
  'signature-failure',
  'duplicate',
] as const);
export type EpochEscalationErrorCategory = (typeof EPOCH_ESCALATION_ERROR_CATEGORIES)[number];

export const EPOCH_ESCALATION_ERROR_CODES = Object.freeze({
  INVALID_TRIGGER: 'EPOCH_ESCALATION_INVALID_TRIGGER',
  INVALID_POSTURE: 'EPOCH_ESCALATION_INVALID_POSTURE',
  AUTHORIZATION_MISMATCH: 'EPOCH_ESCALATION_AUTHORIZATION_MISMATCH',
  UNKNOWN_FIELD: 'EPOCH_ESCALATION_UNKNOWN_FIELD',
  WRITEBACK_FORBIDDEN: 'EPOCH_ESCALATION_WRITEBACK_FORBIDDEN',
  INVALID_DELIVERY: 'EPOCH_ESCALATION_INVALID_DELIVERY',
  WEBHOOK_SIGNATURE_REJECTED: 'EPOCH_ESCALATION_WEBHOOK_SIGNATURE_REJECTED',
  WEBHOOK_EVENT_REJECTED: 'EPOCH_ESCALATION_WEBHOOK_EVENT_REJECTED',
  WEBHOOK_DUPLICATE_EVENT: 'EPOCH_ESCALATION_WEBHOOK_DUPLICATE_EVENT',
  MAPPING_FAILED: 'EPOCH_ESCALATION_MAPPING_FAILED',
} as const);
export type EpochEscalationErrorCode =
  (typeof EPOCH_ESCALATION_ERROR_CODES)[keyof typeof EPOCH_ESCALATION_ERROR_CODES];

const CODE_TO_CATEGORY: Readonly<Record<EpochEscalationErrorCode, EpochEscalationErrorCategory>> =
  Object.freeze({
    EPOCH_ESCALATION_INVALID_TRIGGER: 'invalid-input',
    EPOCH_ESCALATION_INVALID_POSTURE: 'invalid-input',
    EPOCH_ESCALATION_AUTHORIZATION_MISMATCH: 'authority-violation',
    EPOCH_ESCALATION_UNKNOWN_FIELD: 'invalid-input',
    EPOCH_ESCALATION_WRITEBACK_FORBIDDEN: 'authority-violation',
    EPOCH_ESCALATION_INVALID_DELIVERY: 'invalid-input',
    EPOCH_ESCALATION_WEBHOOK_SIGNATURE_REJECTED: 'signature-failure',
    EPOCH_ESCALATION_WEBHOOK_EVENT_REJECTED: 'invalid-input',
    EPOCH_ESCALATION_WEBHOOK_DUPLICATE_EVENT: 'duplicate',
    EPOCH_ESCALATION_MAPPING_FAILED: 'invalid-input',
  });

export function isEpochEscalationErrorCode(value: unknown): value is EpochEscalationErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(EPOCH_ESCALATION_ERROR_CODES) as readonly string[]).includes(value)
  );
}

export function categoryForEpochEscalationCode(
  code: EpochEscalationErrorCode,
): EpochEscalationErrorCategory {
  return CODE_TO_CATEGORY[code];
}

export interface EpochEscalationErrorDetails {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * The typed adapter error. `epochCause` preserves the upstream typed
 * error (e.g. an @arena/escalation EscalationError raised by the real
 * domain constructor during mapping) for observability — the adapter
 * never swallows a domain failure into a generic one.
 */
export class EpochEscalationError extends Error {
  readonly code: EpochEscalationErrorCode;
  readonly category: EpochEscalationErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly epochCause?: unknown;

  constructor(code: EpochEscalationErrorCode, info: EpochEscalationErrorDetails, cause?: unknown) {
    super(info.message, cause === undefined ? undefined : { cause });
    this.name = 'EpochEscalationError';
    this.code = code;
    this.category = categoryForEpochEscalationCode(code);
    this.details = Object.freeze({ ...(info.details ?? {}) });
    if (cause !== undefined) {
      this.epochCause = cause;
    }
    Object.freeze(this.details);
  }
}

/** Normalize an unknown thrown value into a typed EpochEscalationError. */
export function normalizeToEpochEscalationError(
  error: unknown,
  fallbackCode: EpochEscalationErrorCode = EPOCH_ESCALATION_ERROR_CODES.MAPPING_FAILED,
): EpochEscalationError {
  if (error instanceof EpochEscalationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new EpochEscalationError(fallbackCode, { message });
}

/** Fail-closed guard helper: throw INVALID_TRIGGER with field context. */
export function invalidTrigger(field: string, value: unknown, expected: string): never {
  throw new EpochEscalationError(EPOCH_ESCALATION_ERROR_CODES.INVALID_TRIGGER, {
    message: `Epoch escalation trigger field ${JSON.stringify(field)} is invalid: ${JSON.stringify(value)} (${expected})`,
    details: { field, expected },
  });
}
