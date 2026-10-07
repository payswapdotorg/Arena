/**
 * Intervention error taxonomy (Work Order C007; issue #114). Mirrors the
 * sibling domain packages' typed errors (@arena/expert-session's
 * ExpertSessionError, @arena/escalation's EscalationError): closed code
 * set, category mapping, structured wire-safe form and a strictly
 * validating parser — unknown codes are REJECTED at parse time.
 *
 * Every intervention outcome is machine-readable (never a bare boolean —
 * house verdict style); the codes below are the closed failure
 * vocabulary of the intervention domain core. UNPERMITTED_MODE is the
 * fail-closed mode-authorization code (an escalation mode not listed in
 * the EscalationRequest is rejected, never silently coerced to a weaker
 * or stronger mode — the escalation-modes law); LIVE_WORLD_MUTATION and
 * PRIVATE_REASONING are the fail-closed boundary codes for the two
 * adversarial invariants of C007: the bounded session is never a
 * live-world write path, and no private chain-of-thought is captured or
 * transmitted (architecture-lock rule 30).
 */

export const INTERVENTION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'privacy',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type InterventionErrorCategory = (typeof INTERVENTION_ERROR_CATEGORIES)[number];

export const INTERVENTION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'INTERVENTION_INVALID_REQUEST',
  INVALID_MODE: 'INTERVENTION_INVALID_MODE',
  UNPERMITTED_MODE: 'INTERVENTION_UNPERMITTED_MODE',
  INVALID_TRANSITION: 'INTERVENTION_INVALID_TRANSITION',
  INVALID_STATE: 'INTERVENTION_INVALID_STATE',
  TERMINAL_STATE: 'INTERVENTION_TERMINAL_STATE',
  INVALID_RESULT: 'INTERVENTION_INVALID_RESULT',
  TRAJECTORY_MISSING: 'INTERVENTION_TRAJECTORY_MISSING',
  TRAJECTORY_INVALID: 'INTERVENTION_TRAJECTORY_INVALID',
  PRIVATE_REASONING: 'INTERVENTION_PRIVATE_REASONING',
  LIVE_WORLD_MUTATION: 'INTERVENTION_LIVE_WORLD_MUTATION',
  CROSS_TENANT_ACCESS: 'INTERVENTION_CROSS_TENANT_ACCESS',
  DEADLINE_PASSED: 'INTERVENTION_DEADLINE_PASSED',
  CAPTURE_REQUIRED: 'INTERVENTION_CAPTURE_REQUIRED',
  SCHEMA_MISMATCH: 'INTERVENTION_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'INTERVENTION_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'INTERVENTION_UNKNOWN_ERROR',
} as const);
export type InterventionErrorCode = (typeof INTERVENTION_ERROR_CODES)[keyof typeof INTERVENTION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<InterventionErrorCode, InterventionErrorCategory>> = {
  INTERVENTION_INVALID_REQUEST: 'validation',
  INTERVENTION_INVALID_MODE: 'validation',
  INTERVENTION_UNPERMITTED_MODE: 'scope',
  INTERVENTION_INVALID_TRANSITION: 'state',
  INTERVENTION_INVALID_STATE: 'validation',
  INTERVENTION_TERMINAL_STATE: 'state',
  INTERVENTION_INVALID_RESULT: 'validation',
  INTERVENTION_TRAJECTORY_MISSING: 'integrity',
  INTERVENTION_TRAJECTORY_INVALID: 'integrity',
  INTERVENTION_PRIVATE_REASONING: 'privacy',
  INTERVENTION_LIVE_WORLD_MUTATION: 'scope',
  INTERVENTION_CROSS_TENANT_ACCESS: 'scope',
  INTERVENTION_DEADLINE_PASSED: 'state',
  INTERVENTION_CAPTURE_REQUIRED: 'validation',
  INTERVENTION_SCHEMA_MISMATCH: 'validation',
  INTERVENTION_UNSUPPORTED_VERSION: 'versioning',
  INTERVENTION_UNKNOWN_ERROR: 'unknown',
};

export function isInterventionErrorCode(value: unknown): value is InterventionErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(INTERVENTION_ERROR_CODES).includes(value as InterventionErrorCode)
  );
}

export function categoryForInterventionCode(code: InterventionErrorCode): InterventionErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe intervention failure (fail-closed). */
export class InterventionError extends Error {
  readonly code: InterventionErrorCode;
  readonly category: InterventionErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: InterventionErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'InterventionError';
    this.code = code;
    this.category = categoryForInterventionCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: InterventionErrorCode;
    category: InterventionErrorCategory;
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

export interface WireInterventionError {
  readonly code: InterventionErrorCode;
  readonly category: InterventionErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireInterventionError(value: unknown): WireInterventionError {
  if (typeof value !== 'object' || value === null) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire intervention error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isInterventionErrorCode(candidate['code'])) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown intervention error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !INTERVENTION_ERROR_CATEGORIES.includes(candidate['category'] as InterventionErrorCategory)
  ) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown intervention error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new InterventionError(INTERVENTION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire intervention error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as InterventionErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
