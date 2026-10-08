/**
 * Capability-learning service error taxonomy (Work Order C022) — the
 * services-layer house pattern: closed code set, category mapping,
 * wire-safe form, strict parsing.
 *
 * NOT_ADOPTED is the Q1.0 gate code (dispatch of an ungated improvement
 * fails closed); NOT_FOUND covers unknown AND cross-tenant ids
 * (indistinguishable by design); TENANT_ISOLATION is the explicit
 * cross-tenant refusal code.
 */

export const CAPABILITY_LEARNING_SERVICE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'rights',
  'integrity',
  'boundary',
  'versioning',
  'unknown',
] as const);
export type CapabilityLearningServiceErrorCategory =
  (typeof CAPABILITY_LEARNING_SERVICE_ERROR_CATEGORIES)[number];

export const CAPABILITY_LEARNING_SERVICE_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'CAPABILITY_LEARNING_SVC_INVALID_INPUT',
  NOT_FOUND: 'CAPABILITY_LEARNING_SVC_NOT_FOUND',
  NOT_ADOPTED: 'CAPABILITY_LEARNING_SVC_NOT_ADOPTED',
  TENANT_ISOLATION: 'CAPABILITY_LEARNING_SVC_TENANT_ISOLATION',
  IDEMPOTENCY_CONFLICT: 'CAPABILITY_LEARNING_SVC_IDEMPOTENCY_CONFLICT',
  PROPOSAL_CONFLICT: 'CAPABILITY_LEARNING_SVC_PROPOSAL_CONFLICT',
  EXPERIMENT_FAILED: 'CAPABILITY_LEARNING_SVC_EXPERIMENT_FAILED',
  UNKNOWN_ERROR: 'CAPABILITY_LEARNING_SVC_UNKNOWN_ERROR',
} as const);
export type CapabilityLearningServiceErrorCode =
  (typeof CAPABILITY_LEARNING_SERVICE_ERROR_CODES)[keyof typeof CAPABILITY_LEARNING_SERVICE_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityLearningServiceErrorCode, CapabilityLearningServiceErrorCategory>
> = {
  CAPABILITY_LEARNING_SVC_INVALID_INPUT: 'validation',
  CAPABILITY_LEARNING_SVC_NOT_FOUND: 'state',
  CAPABILITY_LEARNING_SVC_NOT_ADOPTED: 'state',
  CAPABILITY_LEARNING_SVC_TENANT_ISOLATION: 'scope',
  CAPABILITY_LEARNING_SVC_IDEMPOTENCY_CONFLICT: 'integrity',
  CAPABILITY_LEARNING_SVC_PROPOSAL_CONFLICT: 'integrity',
  CAPABILITY_LEARNING_SVC_EXPERIMENT_FAILED: 'integrity',
  CAPABILITY_LEARNING_SVC_UNKNOWN_ERROR: 'unknown',
};

export function isCapabilityLearningServiceErrorCode(
  value: unknown,
): value is CapabilityLearningServiceErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CAPABILITY_LEARNING_SERVICE_ERROR_CODES).includes(
      value as CapabilityLearningServiceErrorCode,
    )
  );
}

export function categoryForCapabilityLearningServiceCode(
  code: CapabilityLearningServiceErrorCode,
): CapabilityLearningServiceErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe capability-learning service failure (fail-closed). */
export class CapabilityLearningServiceError extends Error {
  readonly code: CapabilityLearningServiceErrorCode;
  readonly category: CapabilityLearningServiceErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: CapabilityLearningServiceErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'CapabilityLearningServiceError';
    this.code = code;
    this.category = categoryForCapabilityLearningServiceCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: CapabilityLearningServiceErrorCode;
    category: CapabilityLearningServiceErrorCategory;
    message: string;
    details: Readonly<Record<string, unknown>>;
    correlationId: string | null;
  } {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
      correlationId: this.correlationId,
    };
  }
}

export interface WireCapabilityLearningServiceError {
  readonly code: CapabilityLearningServiceErrorCode;
  readonly category: CapabilityLearningServiceErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireCapabilityLearningServiceError(
  value: unknown,
): WireCapabilityLearningServiceError {
  if (typeof value !== 'object' || value === null) {
    throw new CapabilityLearningServiceError(
      CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT,
      { message: 'wire capability-learning service error must be an object' },
    );
  }
  const candidate = value as Record<string, unknown>;
  if (!isCapabilityLearningServiceErrorCode(candidate['code'])) {
    throw new CapabilityLearningServiceError(
      CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT,
      {
        message: `unknown capability-learning service error code: ${JSON.stringify(candidate['code'])}`,
      },
    );
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !CAPABILITY_LEARNING_SERVICE_ERROR_CATEGORIES.includes(
      candidate['category'] as CapabilityLearningServiceErrorCategory,
    )
  ) {
    throw new CapabilityLearningServiceError(
      CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT,
      {
        message: `unknown capability-learning service error category: ${JSON.stringify(candidate['category'])}`,
      },
    );
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new CapabilityLearningServiceError(
      CAPABILITY_LEARNING_SERVICE_ERROR_CODES.INVALID_INPUT,
      { message: 'wire capability-learning service error message must be a non-empty string' },
    );
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as CapabilityLearningServiceErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
