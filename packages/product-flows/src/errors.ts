/**
 * Typed errors for @arena/product-flows (Work Order B008; issue #80).
 *
 * DELIBERATELY SMALL vocabulary. The guided flow owns exactly three
 * failure families of its own:
 *
 *   - unknown guided step id (`PRODUCT_FLOW_UNKNOWN_STEP`);
 *   - malformed runtime input (`PRODUCT_FLOW_MALFORMED_INPUT`);
 *   - a control-plane record that exists but is NOT a canonical
 *     capability-case protocol object (`PRODUCT_FLOW_RECORD_INVALID`) —
 *     e.g. a demo narrative-shaped `capability-case` record.
 *
 * EVERY lifecycle rule violation is raised by the canonical A005
 * `CapabilityCaseError` (INVALID_TRANSITION, TERMINAL_STATE,
 * DUPLICATE_EVIDENCE, INVALID_EVIDENCE, TAMPERED, …) and propagates
 * VERBATIM — this package never translates, swallows or re-codes a
 * canonical lifecycle rejection into a parallel vocabulary, because
 * "lifecycle transitions are canonical (A005) or rejected — never
 * invented". B002 persistence errors (REVISION_CONFLICT, RECORD_EXISTS)
 * propagate verbatim for the same reason.
 */

/** The closed error-code vocabulary of this package. */
export const PRODUCT_FLOW_ERROR_CODES = Object.freeze({
  UNKNOWN_STEP: 'PRODUCT_FLOW_UNKNOWN_STEP',
  MALFORMED_INPUT: 'PRODUCT_FLOW_MALFORMED_INPUT',
  RECORD_INVALID: 'PRODUCT_FLOW_RECORD_INVALID',
  CASE_NOT_FOUND: 'PRODUCT_FLOW_CASE_NOT_FOUND',
  COMPOSER_ABSENT: 'PRODUCT_FLOW_COMPOSER_ABSENT',
} as const);

export type ProductFlowErrorCode =
  (typeof PRODUCT_FLOW_ERROR_CODES)[keyof typeof PRODUCT_FLOW_ERROR_CODES];

/** The typed error of the product-flows package (fail-closed everywhere). */
export class ProductFlowError extends Error {
  readonly code: ProductFlowErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: ProductFlowErrorCode, options: { message: string; details?: Readonly<Record<string, unknown>> }) {
    super(options.message);
    this.name = 'ProductFlowError';
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
  }
}

/** True iff the thrown value is a typed ProductFlowError. */
export function isProductFlowError(error: unknown): error is ProductFlowError {
  return error instanceof ProductFlowError;
}

/**
 * True iff the thrown value is a CANONICAL typed lifecycle error (A005
 * CapabilityCaseError). The runtime surfaces these verbatim; callers use
 * this guard to render canonical rejections truthfully.
 */
export function isCanonicalCaseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    String((error as { code: unknown }).code).startsWith('CAPABILITY_CASE_')
  );
}
