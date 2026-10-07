/**
 * Tool-gap error taxonomy (Work Order C008) — mirrors the sibling domain
 * packages' typed errors (@arena/intervention's InterventionError): closed
 * code set, category mapping, structured wire-safe form and a strictly
 * validating parser. Unknown codes are REJECTED at parse time.
 *
 * SIGNAL_INVALID_STAGE / SIGNAL_TERMINAL_STAGE are the fail-closed codes of
 * the closed stage machine (a denied transition is a typed rejection with a
 * machine-readable reason, never a silent no-op or coercion); SIGNAL_DUPLICATE
 * is the duplicate-injection code (the same signal content cannot be captured
 * twice — the append-only ledger deduplicates by content key).
 */

export const TOOL_GAP_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type ToolGapErrorCategory = (typeof TOOL_GAP_ERROR_CATEGORIES)[number];

export const TOOL_GAP_ERROR_CODES = Object.freeze({
  INVALID_SIGNAL: 'TOOL_GAP_INVALID_SIGNAL',
  INVALID_PROVENANCE: 'TOOL_GAP_INVALID_PROVENANCE',
  INVALID_TRANSITION: 'TOOL_GAP_INVALID_TRANSITION',
  TERMINAL_STAGE: 'TOOL_GAP_TERMINAL_STAGE',
  DUPLICATE_SIGNAL: 'TOOL_GAP_DUPLICATE_SIGNAL',
  SCOPE_MISMATCH: 'TOOL_GAP_SCOPE_MISMATCH',
  PROVENANCE_TAMPERED: 'TOOL_GAP_PROVENANCE_TAMPERED',
  UNSUPPORTED_VERSION: 'TOOL_GAP_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'TOOL_GAP_UNKNOWN_ERROR',
} as const);
export type ToolGapErrorCode = (typeof TOOL_GAP_ERROR_CODES)[keyof typeof TOOL_GAP_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ToolGapErrorCode, ToolGapErrorCategory>> = {
  TOOL_GAP_INVALID_SIGNAL: 'validation',
  TOOL_GAP_INVALID_PROVENANCE: 'validation',
  TOOL_GAP_INVALID_TRANSITION: 'state',
  TOOL_GAP_TERMINAL_STAGE: 'state',
  TOOL_GAP_DUPLICATE_SIGNAL: 'integrity',
  TOOL_GAP_SCOPE_MISMATCH: 'scope',
  TOOL_GAP_PROVENANCE_TAMPERED: 'integrity',
  TOOL_GAP_UNSUPPORTED_VERSION: 'versioning',
  TOOL_GAP_UNKNOWN_ERROR: 'unknown',
};

export function isToolGapErrorCode(value: unknown): value is ToolGapErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(TOOL_GAP_ERROR_CODES).includes(value as ToolGapErrorCode)
  );
}

export function categoryForToolGapCode(code: ToolGapErrorCode): ToolGapErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe tool-gap failure (fail-closed). */
export class ToolGapError extends Error {
  readonly code: ToolGapErrorCode;
  readonly category: ToolGapErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: ToolGapErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'ToolGapError';
    this.code = code;
    this.category = categoryForToolGapCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: ToolGapErrorCode;
    category: ToolGapErrorCategory;
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

export interface WireToolGapError {
  readonly code: ToolGapErrorCode;
  readonly category: ToolGapErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireToolGapError(value: unknown): WireToolGapError {
  if (typeof value !== 'object' || value === null) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: 'wire tool-gap error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isToolGapErrorCode(candidate['code'])) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: `unknown tool-gap error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !TOOL_GAP_ERROR_CATEGORIES.includes(candidate['category'] as ToolGapErrorCategory)
  ) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: `unknown tool-gap error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new ToolGapError(TOOL_GAP_ERROR_CODES.INVALID_SIGNAL, {
      message: 'wire tool-gap error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as ToolGapErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
