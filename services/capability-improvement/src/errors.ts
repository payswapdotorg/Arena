/**
 * Capability-improvement service error taxonomy (Work Order C008) — the
 * services-layer house pattern over the domain errors (@arena/tool-gap's
 * ToolGapError, @arena/knowledge-capture's KnowledgeCaptureError): closed
 * code set, category mapping, wire-safe form, strict parsing.
 *
 * MISSING_CONSENT is the fail-closed rights code (reusable knowledge
 * requires the EES1.0 completion contract's GRANTED consent statement);
 * NOT_FOUND covers unknown AND cross-tenant ids (indistinguishable by
 * design); the stage/wall failures of the domain cores propagate as
 * their own typed errors.
 */

export const CAPABILITY_IMPROVEMENT_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'rights',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type CapabilityImprovementErrorCategory =
  (typeof CAPABILITY_IMPROVEMENT_ERROR_CATEGORIES)[number];

export const CAPABILITY_IMPROVEMENT_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'CAPABILITY_IMPROVEMENT_INVALID_INPUT',
  INVALID_SCOPE: 'CAPABILITY_IMPROVEMENT_INVALID_SCOPE',
  NOT_FOUND: 'CAPABILITY_IMPROVEMENT_NOT_FOUND',
  MISSING_CONSENT: 'CAPABILITY_IMPROVEMENT_MISSING_CONSENT',
  IDEMPOTENCY_CONFLICT: 'CAPABILITY_IMPROVEMENT_IDEMPOTENCY_CONFLICT',
  PROPOSAL_CONFLICT: 'CAPABILITY_IMPROVEMENT_PROPOSAL_CONFLICT',
  UNSUPPORTED_VERSION: 'CAPABILITY_IMPROVEMENT_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'CAPABILITY_IMPROVEMENT_UNKNOWN_ERROR',
} as const);
export type CapabilityImprovementErrorCode =
  (typeof CAPABILITY_IMPROVEMENT_ERROR_CODES)[keyof typeof CAPABILITY_IMPROVEMENT_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityImprovementErrorCode, CapabilityImprovementErrorCategory>
> = {
  CAPABILITY_IMPROVEMENT_INVALID_INPUT: 'validation',
  CAPABILITY_IMPROVEMENT_INVALID_SCOPE: 'scope',
  CAPABILITY_IMPROVEMENT_NOT_FOUND: 'state',
  CAPABILITY_IMPROVEMENT_MISSING_CONSENT: 'rights',
  CAPABILITY_IMPROVEMENT_IDEMPOTENCY_CONFLICT: 'integrity',
  CAPABILITY_IMPROVEMENT_PROPOSAL_CONFLICT: 'integrity',
  CAPABILITY_IMPROVEMENT_UNSUPPORTED_VERSION: 'versioning',
  CAPABILITY_IMPROVEMENT_UNKNOWN_ERROR: 'unknown',
};

export function isCapabilityImprovementErrorCode(
  value: unknown,
): value is CapabilityImprovementErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CAPABILITY_IMPROVEMENT_ERROR_CODES).includes(value as CapabilityImprovementErrorCode)
  );
}

export function categoryForCapabilityImprovementCode(
  code: CapabilityImprovementErrorCode,
): CapabilityImprovementErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe capability-improvement failure (fail-closed). */
export class CapabilityImprovementError extends Error {
  readonly code: CapabilityImprovementErrorCode;
  readonly category: CapabilityImprovementErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: CapabilityImprovementErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'CapabilityImprovementError';
    this.code = code;
    this.category = categoryForCapabilityImprovementCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: CapabilityImprovementErrorCode;
    category: CapabilityImprovementErrorCategory;
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

export interface WireCapabilityImprovementError {
  readonly code: CapabilityImprovementErrorCode;
  readonly category: CapabilityImprovementErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireCapabilityImprovementError(
  value: unknown,
): WireCapabilityImprovementError {
  if (typeof value !== 'object' || value === null) {
    throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
      message: 'wire capability-improvement error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isCapabilityImprovementErrorCode(candidate['code'])) {
    throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
      message: `unknown capability-improvement error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !CAPABILITY_IMPROVEMENT_ERROR_CATEGORIES.includes(
      candidate['category'] as CapabilityImprovementErrorCategory,
    )
  ) {
    throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
      message: `unknown capability-improvement error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new CapabilityImprovementError(CAPABILITY_IMPROVEMENT_ERROR_CODES.INVALID_INPUT, {
      message: 'wire capability-improvement error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as CapabilityImprovementErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
