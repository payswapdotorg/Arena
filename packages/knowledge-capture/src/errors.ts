/**
 * Knowledge-capture error taxonomy (Work Order C008) — closed code set,
 * category mapping, structured wire-safe form and a strictly validating
 * parser (unknown codes REJECTED at parse time).
 *
 * PROMOTION_DENIED is the fail-closed code of the no-silent-promotion
 * wall (EES1.0: Arena must not silently promote task-specific advice to
 * universal knowledge); PATCH_DENIED is the fail-closed code of the
 * learning-candidate gate (task-specific guidance can never become a
 * reusable KnowledgePatch).
 */

export const KNOWLEDGE_CAPTURE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'scope',
  'rights',
  'integrity',
  'versioning',
  'unknown',
] as const);
export type KnowledgeCaptureErrorCategory = (typeof KNOWLEDGE_CAPTURE_ERROR_CATEGORIES)[number];

export const KNOWLEDGE_CAPTURE_ERROR_CODES = Object.freeze({
  INVALID_ARTIFACT: 'KNOWLEDGE_CAPTURE_INVALID_ARTIFACT',
  INVALID_SCOPE: 'KNOWLEDGE_CAPTURE_INVALID_SCOPE',
  MISSING_EVIDENCE: 'KNOWLEDGE_CAPTURE_MISSING_EVIDENCE',
  MISSING_RIGHTS: 'KNOWLEDGE_CAPTURE_MISSING_RIGHTS',
  PROMOTION_DENIED: 'KNOWLEDGE_CAPTURE_PROMOTION_DENIED',
  PATCH_DENIED: 'KNOWLEDGE_CAPTURE_PATCH_DENIED',
  PROVENANCE_MISMATCH: 'KNOWLEDGE_CAPTURE_PROVENANCE_MISMATCH',
  DUPLICATE_RECORD: 'KNOWLEDGE_CAPTURE_DUPLICATE_RECORD',
  UNSUPPORTED_VERSION: 'KNOWLEDGE_CAPTURE_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'KNOWLEDGE_CAPTURE_UNKNOWN_ERROR',
} as const);
export type KnowledgeCaptureErrorCode =
  (typeof KNOWLEDGE_CAPTURE_ERROR_CODES)[keyof typeof KNOWLEDGE_CAPTURE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<KnowledgeCaptureErrorCode, KnowledgeCaptureErrorCategory>> = {
  KNOWLEDGE_CAPTURE_INVALID_ARTIFACT: 'validation',
  KNOWLEDGE_CAPTURE_INVALID_SCOPE: 'scope',
  KNOWLEDGE_CAPTURE_MISSING_EVIDENCE: 'validation',
  KNOWLEDGE_CAPTURE_MISSING_RIGHTS: 'rights',
  KNOWLEDGE_CAPTURE_PROMOTION_DENIED: 'scope',
  KNOWLEDGE_CAPTURE_PATCH_DENIED: 'rights',
  KNOWLEDGE_CAPTURE_PROVENANCE_MISMATCH: 'integrity',
  KNOWLEDGE_CAPTURE_DUPLICATE_RECORD: 'integrity',
  KNOWLEDGE_CAPTURE_UNSUPPORTED_VERSION: 'versioning',
  KNOWLEDGE_CAPTURE_UNKNOWN_ERROR: 'unknown',
};

export function isKnowledgeCaptureErrorCode(value: unknown): value is KnowledgeCaptureErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(KNOWLEDGE_CAPTURE_ERROR_CODES).includes(value as KnowledgeCaptureErrorCode)
  );
}

export function categoryForKnowledgeCaptureCode(
  code: KnowledgeCaptureErrorCode,
): KnowledgeCaptureErrorCategory {
  return CODE_CATEGORY[code];
}

/** Structured, wire-safe knowledge-capture failure (fail-closed). */
export class KnowledgeCaptureError extends Error {
  readonly code: KnowledgeCaptureErrorCode;
  readonly category: KnowledgeCaptureErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;
  readonly correlationId: string | null;

  constructor(
    code: KnowledgeCaptureErrorCode,
    input: {
      message: string;
      details?: Readonly<Record<string, unknown>>;
      correlationId?: string | null;
    },
  ) {
    super(input.message);
    this.name = 'KnowledgeCaptureError';
    this.code = code;
    this.category = categoryForKnowledgeCaptureCode(code);
    this.details = input.details === undefined ? {} : input.details;
    this.correlationId = input.correlationId ?? null;
  }

  /** Wire form (plain JSON — safe to travel inside envelopes). */
  toWire(): {
    code: KnowledgeCaptureErrorCode;
    category: KnowledgeCaptureErrorCategory;
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

export interface WireKnowledgeCaptureError {
  readonly code: KnowledgeCaptureErrorCode;
  readonly category: KnowledgeCaptureErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
}

/** Strict wire parser: unknown codes / categories are REJECTED. */
export function parseWireKnowledgeCaptureError(value: unknown): WireKnowledgeCaptureError {
  if (typeof value !== 'object' || value === null) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'wire knowledge-capture error must be an object',
    });
  }
  const candidate = value as Record<string, unknown>;
  if (!isKnowledgeCaptureErrorCode(candidate['code'])) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: `unknown knowledge-capture error code: ${JSON.stringify(candidate['code'])}`,
    });
  }
  if (
    typeof candidate['category'] !== 'string' ||
    !KNOWLEDGE_CAPTURE_ERROR_CATEGORIES.includes(
      candidate['category'] as KnowledgeCaptureErrorCategory,
    )
  ) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: `unknown knowledge-capture error category: ${JSON.stringify(candidate['category'])}`,
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new KnowledgeCaptureError(KNOWLEDGE_CAPTURE_ERROR_CODES.INVALID_ARTIFACT, {
      message: 'wire knowledge-capture error message must be a non-empty string',
    });
  }
  return {
    code: candidate['code'],
    category: candidate['category'] as KnowledgeCaptureErrorCategory,
    message: candidate['message'],
    ...(candidate['details'] !== undefined
      ? { details: candidate['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(candidate['correlationId'] !== undefined
      ? { correlationId: candidate['correlationId'] as string | null }
      : {}),
  };
}
