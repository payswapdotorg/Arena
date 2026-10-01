/**
 * Typed demo-mode errors (Work Order B006; issue #73).
 *
 * House pattern (@arena/read-model, @arena/auth): a single error class
 * with a CLOSED code list and frozen details; no stringly-typed throws.
 */

/** Closed list of demo-mode error codes. */
export const DEMO_ERROR_CODES = Object.freeze({
  /** Demo state was requested outside the demo tenant surface. */
  SCOPE_VIOLATION: 'DEMO_SCOPE_VIOLATION',
  /** The demo store was misused (missing repository, unknown variant...). */
  INVALID_INPUT: 'DEMO_INVALID_INPUT',
  /** A narrative step referenced a corpus record that does not exist. */
  UNKNOWN_RECORD: 'DEMO_UNKNOWN_RECORD',
} as const);

export type DemoErrorCode = (typeof DEMO_ERROR_CODES)[keyof typeof DEMO_ERROR_CODES];

export interface DemoErrorDetails {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/** The typed error every demo-mode failure throws (fail closed). */
export class DemoError extends Error {
  readonly code: DemoErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DemoErrorCode, input: DemoErrorDetails) {
    super(input.message, { cause: input.cause });
    this.name = 'DemoError';
    this.code = code;
    this.details = Object.freeze({ ...(input.details ?? {}) });
  }
}

/** Narrow an unknown thrown value to a DemoError. */
export function isDemoError(value: unknown): value is DemoError {
  return value instanceof DemoError;
}
