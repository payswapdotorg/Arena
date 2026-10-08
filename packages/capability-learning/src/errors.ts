/**
 * Capability-learning compiler error taxonomy (Work Order C022) — the
 * house pattern over the domain packages: closed code set, category
 * mapping, wire-safe form, strict parsing.
 *
 * BOUNDARY_VIOLATION is the LE1.0 learning-boundary code (a compiler
 * output colliding with a historical digest is a rewrite attempt by
 * construction); RIGHTS_INSUFFICIENT is the fail-closed rights code
 * (globally reusable outputs require explicit rights — lock rules
 * 31/32); NOT_ADOPTED is the Q1.0 gate code (an ungated improvement can
 * never become a proposal — structurally impossible).
 */

export const CAPABILITY_LEARNING_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'rights',
  'integrity',
  'boundary',
  'versioning',
  'unknown',
] as const);
export type CapabilityLearningErrorCategory =
  (typeof CAPABILITY_LEARNING_ERROR_CATEGORIES)[number];

export const CAPABILITY_LEARNING_ERROR_CODES = Object.freeze({
  INVALID_INPUT: 'CAPABILITY_LEARNING_INVALID_INPUT',
  INVALID_CANDIDATE: 'CAPABILITY_LEARNING_INVALID_CANDIDATE',
  INVALID_PROGRAM: 'CAPABILITY_LEARNING_INVALID_PROGRAM',
  INVALID_EXPERIMENT: 'CAPABILITY_LEARNING_INVALID_EXPERIMENT',
  INVALID_GATE_VERDICT: 'CAPABILITY_LEARNING_INVALID_GATE_VERDICT',
  INVALID_PROPOSAL: 'CAPABILITY_LEARNING_INVALID_PROPOSAL',
  INVALID_FEEDBACK: 'CAPABILITY_LEARNING_INVALID_FEEDBACK',
  RIGHTS_INSUFFICIENT: 'CAPABILITY_LEARNING_RIGHTS_INSUFFICIENT',
  NOT_ADOPTED: 'CAPABILITY_LEARNING_NOT_ADOPTED',
  BOUNDARY_VIOLATION: 'CAPABILITY_LEARNING_BOUNDARY_VIOLATION',
  TENANT_ISOLATION: 'CAPABILITY_LEARNING_TENANT_ISOLATION',
  UNKNOWN_ERROR: 'CAPABILITY_LEARNING_UNKNOWN_ERROR',
} as const);
export type CapabilityLearningErrorCode =
  (typeof CAPABILITY_LEARNING_ERROR_CODES)[keyof typeof CAPABILITY_LEARNING_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityLearningErrorCode, CapabilityLearningErrorCategory>
> = {
  CAPABILITY_LEARNING_INVALID_INPUT: 'validation',
  CAPABILITY_LEARNING_INVALID_CANDIDATE: 'validation',
  CAPABILITY_LEARNING_INVALID_PROGRAM: 'validation',
  CAPABILITY_LEARNING_INVALID_EXPERIMENT: 'validation',
  CAPABILITY_LEARNING_INVALID_GATE_VERDICT: 'validation',
  CAPABILITY_LEARNING_INVALID_PROPOSAL: 'validation',
  CAPABILITY_LEARNING_INVALID_FEEDBACK: 'validation',
  CAPABILITY_LEARNING_RIGHTS_INSUFFICIENT: 'rights',
  CAPABILITY_LEARNING_NOT_ADOPTED: 'state',
  CAPABILITY_LEARNING_BOUNDARY_VIOLATION: 'boundary',
  CAPABILITY_LEARNING_TENANT_ISOLATION: 'scope',
  CAPABILITY_LEARNING_UNKNOWN_ERROR: 'unknown',
};

export function isCapabilityLearningErrorCode(
  value: unknown,
): value is CapabilityLearningErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CAPABILITY_LEARNING_ERROR_CODES).includes(value as CapabilityLearningErrorCode)
  );
}

export function categoryForCapabilityLearningCode(
  code: CapabilityLearningErrorCode,
): CapabilityLearningErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe capability-learning failure (fail-closed). */
export class CapabilityLearningError extends Error {
  readonly code: CapabilityLearningErrorCode;
  readonly category: CapabilityLearningErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: CapabilityLearningErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(input.message);
    this.name = 'CapabilityLearningError';
    this.code = code;
    this.category = categoryForCapabilityLearningCode(code);
    this.details = input.details === undefined ? {} : input.details;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: CapabilityLearningErrorCode;
    category: CapabilityLearningErrorCategory;
    message: string;
    details: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      details: this.details,
    };
  }
}

export interface WireCapabilityLearningError {
  readonly code: CapabilityLearningErrorCode;
  readonly category: CapabilityLearningErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireCapabilityLearningError(
  value: unknown,
): WireCapabilityLearningError {
  if (typeof value !== 'object' || value === null) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'wire capability-learning error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isCapabilityLearningErrorCode(candidate['code'])) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: `unknown capability-learning error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !CAPABILITY_LEARNING_ERROR_CATEGORIES.includes(
      candidate['category'] as CapabilityLearningErrorCategory,
    )
  ) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: `unknown capability-learning error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'wire capability-learning error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as CapabilityLearningErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
  };
}
