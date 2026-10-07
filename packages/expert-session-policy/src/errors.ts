/**
 * Expert-session-policy error taxonomy (Work Order C018) — mirrors the
 * sibling domain packages' typed errors (@arena/expert-session's
 * ExpertSessionError): closed code set, category mapping, structured
 * wire-safe form and a strictly validating parser. Unknown codes are
 * REJECTED at parse time.
 *
 * The policy-pack domain's fail-closed boundary codes:
 *   - CONFLICTING_CONTROLS     — a pack whose controls conflict is
 *                                rejected with reasons (never weakened);
 *   - INFEASIBLE_MODES         — a pack incompatible with the request's
 *                                permitted intervention modes is rejected
 *                                with reasons (never silently weakened);
 *   - CROSS_TENANT_POLICY      — pack reads/resolutions are tenant-
 *                                scoped; cross-tenant reuse requires an
 *                                explicit typed authorization;
 *   - RETENTION_CONFLICT       — a pack retention schedule that exceeds
 *                                the request's declared retention bound
 *                                (the retention-bypass adversarial case);
 *   - DUPLICATE_DISPOSITION    — deletion double-spend: a second erasure
 *                                request is a typed duplicate outcome
 *                                with no second effect.
 */

export const EXPERT_SESSION_POLICY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'privacy',
  'retention',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type ExpertSessionPolicyErrorCategory = (typeof EXPERT_SESSION_POLICY_ERROR_CATEGORIES)[number];

export const EXPERT_SESSION_POLICY_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'EXPERT_SESSION_POLICY_INVALID_REQUEST',
  INVALID_CONTROL: 'EXPERT_SESSION_POLICY_INVALID_CONTROL',
  CONFLICTING_CONTROLS: 'EXPERT_SESSION_POLICY_CONFLICTING_CONTROLS',
  INFEASIBLE_MODES: 'EXPERT_SESSION_POLICY_INFEASIBLE_MODES',
  INVALID_TRANSITION: 'EXPERT_SESSION_POLICY_INVALID_TRANSITION',
  TERMINAL_STATE: 'EXPERT_SESSION_POLICY_TERMINAL_STATE',
  DUPLICATE_DISPOSITION: 'EXPERT_SESSION_POLICY_DUPLICATE_DISPOSITION',
  CROSS_TENANT_POLICY: 'EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY',
  RETENTION_CONFLICT: 'EXPERT_SESSION_POLICY_RETENTION_CONFLICT',
  RETENTION_EXPIRED: 'EXPERT_SESSION_POLICY_RETENTION_EXPIRED',
  INVALID_SCHEDULE: 'EXPERT_SESSION_POLICY_INVALID_SCHEDULE',
  INVALID_AUTHORIZATION: 'EXPERT_SESSION_POLICY_INVALID_AUTHORIZATION',
  RESOLUTION_CONFLICT: 'EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT',
  INVALID_AUDIT_EVENT: 'EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT',
  AUDIT_CHAIN_BROKEN: 'EXPERT_SESSION_POLICY_AUDIT_CHAIN_BROKEN',
  AUDIT_REPLAY: 'EXPERT_SESSION_POLICY_AUDIT_REPLAY',
  UNSUPPORTED_VERSION: 'EXPERT_SESSION_POLICY_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'EXPERT_SESSION_POLICY_UNKNOWN_ERROR',
} as const);
export type ExpertSessionPolicyErrorCode =
  (typeof EXPERT_SESSION_POLICY_ERROR_CODES)[keyof typeof EXPERT_SESSION_POLICY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ExpertSessionPolicyErrorCode, ExpertSessionPolicyErrorCategory>> = {
  EXPERT_SESSION_POLICY_INVALID_REQUEST: 'validation',
  EXPERT_SESSION_POLICY_INVALID_CONTROL: 'validation',
  EXPERT_SESSION_POLICY_CONFLICTING_CONTROLS: 'privacy',
  EXPERT_SESSION_POLICY_INFEASIBLE_MODES: 'scope',
  EXPERT_SESSION_POLICY_INVALID_TRANSITION: 'state',
  EXPERT_SESSION_POLICY_TERMINAL_STATE: 'state',
  EXPERT_SESSION_POLICY_DUPLICATE_DISPOSITION: 'retention',
  EXPERT_SESSION_POLICY_CROSS_TENANT_POLICY: 'scope',
  EXPERT_SESSION_POLICY_RETENTION_CONFLICT: 'retention',
  EXPERT_SESSION_POLICY_RETENTION_EXPIRED: 'retention',
  EXPERT_SESSION_POLICY_INVALID_SCHEDULE: 'retention',
  EXPERT_SESSION_POLICY_INVALID_AUTHORIZATION: 'scope',
  EXPERT_SESSION_POLICY_RESOLUTION_CONFLICT: 'state',
  EXPERT_SESSION_POLICY_INVALID_AUDIT_EVENT: 'validation',
  EXPERT_SESSION_POLICY_AUDIT_CHAIN_BROKEN: 'integrity',
  EXPERT_SESSION_POLICY_AUDIT_REPLAY: 'integrity',
  EXPERT_SESSION_POLICY_UNSUPPORTED_VERSION: 'versioning',
  EXPERT_SESSION_POLICY_UNKNOWN_ERROR: 'unknown',
};

export function isExpertSessionPolicyErrorCode(value: unknown): value is ExpertSessionPolicyErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(EXPERT_SESSION_POLICY_ERROR_CODES).includes(value as ExpertSessionPolicyErrorCode)
  );
}

export function categoryForExpertSessionPolicyCode(
  code: ExpertSessionPolicyErrorCode,
): ExpertSessionPolicyErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe expert-session-policy failure (fail-closed). */
export class ExpertSessionPolicyError extends Error {
  readonly code: ExpertSessionPolicyErrorCode;
  readonly category: ExpertSessionPolicyErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: ExpertSessionPolicyErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'ExpertSessionPolicyError';
    this.code = code;
    this.category = categoryForExpertSessionPolicyCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: ExpertSessionPolicyErrorCode;
    category: ExpertSessionPolicyErrorCategory;
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

export interface WireExpertSessionPolicyError {
  readonly code: ExpertSessionPolicyErrorCode;
  readonly category: ExpertSessionPolicyErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireExpertSessionPolicyError(value: unknown): WireExpertSessionPolicyError {
  if (typeof value !== 'object' || value === null) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: 'wire expert-session-policy error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isExpertSessionPolicyErrorCode(candidate['code'])) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown expert-session-policy error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !EXPERT_SESSION_POLICY_ERROR_CATEGORIES.includes(candidate['category'] as ExpertSessionPolicyErrorCategory)
  ) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: `unknown expert-session-policy error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new ExpertSessionPolicyError('EXPERT_SESSION_POLICY_INVALID_REQUEST', {
      message: 'wire expert-session-policy error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as ExpertSessionPolicyErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
