/**
 * @arena/compatibility — error codes and error types (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 */

export const COMPATIBILITY_ERROR_CODES = Object.freeze({
  INVALID_VERDICT: 'COMPATIBILITY_INVALID_VERDICT',
  INVALID_RECORD: 'COMPATIBILITY_INVALID_RECORD',
  MISSING_REQUIREMENT: 'COMPATIBILITY_MISSING_REQUIREMENT',
  CONFLICTING_REQUIREMENT: 'COMPATIBILITY_CONFLICTING_REQUIREMENT',
  UNKNOWN_SUBSTRATE: 'COMPATIBILITY_UNKNOWN_SUBSTRATE',
  MISSING_TEST_SUITE: 'COMPATIBILITY_MISSING_TEST_SUITE',
  EVALUATION_ERROR: 'COMPATIBILITY_EVALUATION_ERROR',
  INVALID_INPUT: 'COMPATIBILITY_INVALID_INPUT',
} as const);

export type CompatibilityErrorCode = (typeof COMPATIBILITY_ERROR_CODES)[keyof typeof COMPATIBILITY_ERROR_CODES];

export class CompatibilityError extends Error {
  readonly code: CompatibilityErrorCode;
  readonly details?: Record<string, unknown> | undefined;

  constructor(
    code: CompatibilityErrorCode,
    {
      message,
      details,
    }: {
      message: string;
      details?: Record<string, unknown> | undefined;
    },
  ) {
    super(message);
    this.name = 'CompatibilityError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function isCompatibilityError(value: unknown): value is CompatibilityError {
  return value instanceof Error && 'code' in value && COMPATIBILITY_ERROR_CODES[value.code as keyof typeof COMPATIBILITY_ERROR_CODES] !== undefined;
}