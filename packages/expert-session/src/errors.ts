/**
 * Expert-session error taxonomy (Work Order C006; spec
 * expert-environment-session.md EES1.0). Mirrors the sibling domain
 * packages' typed errors (@arena/escalation's EscalationError): closed
 * code set, category mapping, structured wire-safe form and a strictly
 * validating parser — unknown codes are REJECTED at parse time.
 *
 * Every session outcome is machine-readable (never a bare boolean —
 * house verdict style); the codes below are the closed failure
 * vocabulary of the expert-session domain core. ESCAPE_ATTEMPT and
 * PRIVACY_VIOLATION are the fail-closed boundary codes the privacy
 * barrier throws when an expert action reaches outside the bounded
 * capsule (EES1.0 "The expert cannot escape the bounded session into
 * the application's live environment").
 */

export const EXPERT_SESSION_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'privacy',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type ExpertSessionErrorCategory = (typeof EXPERT_SESSION_ERROR_CATEGORIES)[number];

export const EXPERT_SESSION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'EXPERT_SESSION_INVALID_REQUEST',
  INVALID_MODE: 'EXPERT_SESSION_INVALID_MODE',
  UNPERMITTED_MODE: 'EXPERT_SESSION_UNPERMITTED_MODE',
  INVALID_STATE: 'EXPERT_SESSION_INVALID_STATE',
  INVALID_TRANSITION: 'EXPERT_SESSION_INVALID_TRANSITION',
  TERMINAL_STATE: 'EXPERT_SESSION_TERMINAL_STATE',
  ESCAPE_ATTEMPT: 'EXPERT_SESSION_ESCAPE_ATTEMPT',
  PRIVACY_VIOLATION: 'EXPERT_SESSION_PRIVACY_VIOLATION',
  INVALID_EVENT: 'EXPERT_SESSION_INVALID_EVENT',
  PRIVATE_REASONING: 'EXPERT_SESSION_PRIVATE_REASONING',
  INVALID_TOOL_GAP: 'EXPERT_SESSION_INVALID_TOOL_GAP',
  INVALID_TIER: 'EXPERT_SESSION_INVALID_TIER',
  TIER_PROMOTION_DENIED: 'EXPERT_SESSION_TIER_PROMOTION_DENIED',
  INVALID_SUBMISSION: 'EXPERT_SESSION_INVALID_SUBMISSION',
  CROSS_TENANT_ACCESS: 'EXPERT_SESSION_CROSS_TENANT_ACCESS',
  DEADLINE_PASSED: 'EXPERT_SESSION_DEADLINE_PASSED',
  REPLAY_AS_LIVE: 'EXPERT_SESSION_REPLAY_AS_LIVE',
  SCHEMA_MISMATCH: 'EXPERT_SESSION_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'EXPERT_SESSION_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'EXPERT_SESSION_UNKNOWN_ERROR',
} as const);
export type ExpertSessionErrorCode =
  (typeof EXPERT_SESSION_ERROR_CODES)[keyof typeof EXPERT_SESSION_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertSessionErrorCode, ExpertSessionErrorCategory>> = {
  EXPERT_SESSION_INVALID_REQUEST: 'validation',
  EXPERT_SESSION_INVALID_MODE: 'validation',
  EXPERT_SESSION_UNPERMITTED_MODE: 'scope',
  EXPERT_SESSION_INVALID_STATE: 'validation',
  EXPERT_SESSION_INVALID_TRANSITION: 'state',
  EXPERT_SESSION_TERMINAL_STATE: 'state',
  EXPERT_SESSION_ESCAPE_ATTEMPT: 'scope',
  EXPERT_SESSION_PRIVACY_VIOLATION: 'privacy',
  EXPERT_SESSION_INVALID_EVENT: 'validation',
  EXPERT_SESSION_PRIVATE_REASONING: 'privacy',
  EXPERT_SESSION_INVALID_TOOL_GAP: 'validation',
  EXPERT_SESSION_INVALID_TIER: 'validation',
  EXPERT_SESSION_TIER_PROMOTION_DENIED: 'validation',
  EXPERT_SESSION_INVALID_SUBMISSION: 'validation',
  EXPERT_SESSION_CROSS_TENANT_ACCESS: 'scope',
  EXPERT_SESSION_DEADLINE_PASSED: 'state',
  EXPERT_SESSION_REPLAY_AS_LIVE: 'scope',
  EXPERT_SESSION_SCHEMA_MISMATCH: 'validation',
  EXPERT_SESSION_UNSUPPORTED_VERSION: 'versioning',
  EXPERT_SESSION_UNKNOWN_ERROR: 'unknown',
};

export function isExpertSessionErrorCode(value: unknown): value is ExpertSessionErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EXPERT_SESSION_ERROR_CODES).includes(value as ExpertSessionErrorCode)
  );
}

export function categoryForExpertSessionCode(code: ExpertSessionErrorCode): ExpertSessionErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe expert-session failure (fail-closed). */
export class ExpertSessionError extends Error {
  readonly code: ExpertSessionErrorCode;
  readonly category: ExpertSessionErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: ExpertSessionErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'ExpertSessionError';
    this.code = code;
    this.category = categoryForExpertSessionCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: ExpertSessionErrorCode;
    category: ExpertSessionErrorCategory;
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

export interface WireExpertSessionError {
  readonly code: ExpertSessionErrorCode;
  readonly category: ExpertSessionErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireExpertSessionError(value: unknown): WireExpertSessionError {
  if (typeof value !== 'object' || value === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire expert-session error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isExpertSessionErrorCode(candidate['code'])) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown expert-session error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !EXPERT_SESSION_ERROR_CATEGORIES.includes(candidate['category'] as ExpertSessionErrorCategory)
  ) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown expert-session error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'wire expert-session error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as ExpertSessionErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
