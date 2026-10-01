/**
 * @arena/body-ui — typed rejections (Work Order B010; issue #82).
 *
 * The view-model builders fail CLOSED and TYPED: a canonical read of the
 * wrong kind is never coerced into a body view (the same posture as the
 * B005 read model's `READ_MODEL_KIND_MISMATCH`).
 */

/** The closed body-ui rejection vocabulary. */
export const BODY_UI_ERROR_CODES = Object.freeze([
  'BODY_UI_KIND_MISMATCH',
  'BODY_UI_INVALID_INPUT',
] as const);

/** One body-ui rejection code (closed vocabulary). */
export type BodyUiErrorCode = (typeof BODY_UI_ERROR_CODES)[number];

/** True iff the value is one of the closed body-ui rejection codes. */
export function isBodyUiErrorCode(value: unknown): value is BodyUiErrorCode {
  return (
    typeof value === 'string' &&
    (BODY_UI_ERROR_CODES as readonly string[]).includes(value)
  );
}

/** The typed body-ui rejection (never a bare Error). */
export class BodyUiError extends Error {
  readonly code: BodyUiErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: BodyUiErrorCode, details: Readonly<Record<string, unknown>>) {
    const message = typeof details['message'] === 'string' ? details['message'] : code;
    super(message);
    this.name = 'BodyUiError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/** Assert a canonical read is of the expected kind (typed rejection otherwise). */
export function assertReadKind(
  kind: string,
  expected: string,
  recordId: string,
): void {
  if (kind !== expected) {
    throw new BodyUiError('BODY_UI_KIND_MISMATCH', {
      message: `expected a canonical read of kind ${JSON.stringify(expected)}, got ${JSON.stringify(kind)}`,
      expectedKind: expected,
      actualKind: kind,
      recordId,
    });
  }
}
