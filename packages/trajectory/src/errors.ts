/**
 * Trajectory protocol error taxonomy (Work Order A011).
 *
 * @arena/trajectory owns its own closed error code set, mirroring the
 * pattern of @arena/artifact-protocol's ArtifactError,
 * @arena/environment-protocol's EnvironmentError and
 * @arena/environment-runtime's EnvironmentRuntimeError (closed codes, core
 * category mapping, structured wire-safe form, strictly validating parser
 * — unknown codes are REJECTED at parse time). The core taxonomy is frozen
 * inside @arena/protocol-core (A001 surface, read-only for this package),
 * so trajectory-domain failures carry TRAJECTORY_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const TRAJECTORY_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type TrajectoryErrorCategory = (typeof TRAJECTORY_ERROR_CATEGORIES)[number];

export const TRAJECTORY_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'TRAJECTORY_INVALID_IDENTITY',
  INVALID_DIGEST: 'TRAJECTORY_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'TRAJECTORY_INVALID_TIMESTAMP',
  INVALID_RUN_REF: 'TRAJECTORY_INVALID_RUN_REF',
  INVALID_HEADER: 'TRAJECTORY_INVALID_HEADER',
  INVALID_ENTRY: 'TRAJECTORY_INVALID_ENTRY',
  INVALID_PAYLOAD: 'TRAJECTORY_INVALID_PAYLOAD',
  INVALID_RECORD: 'TRAJECTORY_INVALID_RECORD',
  SEQUENCE_GAP: 'TRAJECTORY_SEQUENCE_GAP',
  SEQUENCE_REGRESSION: 'TRAJECTORY_SEQUENCE_REGRESSION',
  TIMESTAMP_REGRESSION: 'TRAJECTORY_TIMESTAMP_REGRESSION',
  ALREADY_COMPLETED: 'TRAJECTORY_ALREADY_COMPLETED',
  NOT_FOUND: 'TRAJECTORY_NOT_FOUND',
  IDENTITY_CONFLICT: 'TRAJECTORY_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'TRAJECTORY_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'TRAJECTORY_TAMPERED',
  VERSION_CONFLICT: 'TRAJECTORY_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'TRAJECTORY_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'TRAJECTORY_UNKNOWN_ERROR',
} as const);

export type TrajectoryErrorCode =
  (typeof TRAJECTORY_ERROR_CODES)[keyof typeof TRAJECTORY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<TrajectoryErrorCode, TrajectoryErrorCategory>> = {
  TRAJECTORY_INVALID_IDENTITY: 'validation',
  TRAJECTORY_INVALID_DIGEST: 'validation',
  TRAJECTORY_INVALID_TIMESTAMP: 'validation',
  TRAJECTORY_INVALID_RUN_REF: 'validation',
  TRAJECTORY_INVALID_HEADER: 'validation',
  TRAJECTORY_INVALID_ENTRY: 'validation',
  TRAJECTORY_INVALID_PAYLOAD: 'validation',
  TRAJECTORY_INVALID_RECORD: 'validation',
  TRAJECTORY_SEQUENCE_GAP: 'integrity',
  TRAJECTORY_SEQUENCE_REGRESSION: 'integrity',
  TRAJECTORY_TIMESTAMP_REGRESSION: 'integrity',
  TRAJECTORY_ALREADY_COMPLETED: 'integrity',
  TRAJECTORY_NOT_FOUND: 'validation',
  TRAJECTORY_IDENTITY_CONFLICT: 'integrity',
  TRAJECTORY_IDEMPOTENCY_CONFLICT: 'integrity',
  TRAJECTORY_TAMPERED: 'integrity',
  TRAJECTORY_VERSION_CONFLICT: 'integrity',
  TRAJECTORY_UNSUPPORTED_RECORD_VERSION: 'versioning',
  TRAJECTORY_UNKNOWN_ERROR: 'unknown',
};

export function isTrajectoryErrorCode(value: unknown): value is TrajectoryErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(TRAJECTORY_ERROR_CODES).includes(value as TrajectoryErrorCode)
  );
}

export function categoryForTrajectoryCode(code: TrajectoryErrorCode): TrajectoryErrorCategory {
  return CODE_CATEGORY[code];
}

export interface TrajectoryErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a TrajectoryError. */
export interface TrajectoryErrorStruct {
  readonly code: TrajectoryErrorCode;
  readonly category: TrajectoryErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class TrajectoryError extends Error {
  readonly code: TrajectoryErrorCode;
  readonly category: TrajectoryErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: TrajectoryErrorCode, init: TrajectoryErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'TrajectoryError';
    this.code = code;
    this.category = categoryForTrajectoryCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isTrajectoryError(value: unknown): value is TrajectoryError {
  return value instanceof TrajectoryError;
}

export function toTrajectoryErrorStruct(error: TrajectoryError): TrajectoryErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured TrajectoryError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `TrajectoryError` with code
 * `TRAJECTORY_UNKNOWN_ERROR`.
 */
export function fromTrajectoryErrorStruct(value: unknown): TrajectoryError {
  const fail = (reason: string): never => {
    throw new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured trajectory error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isTrajectoryErrorCode(code)) {
    return fail(`unknown or missing trajectory error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForTrajectoryCode(code)) {
    return fail(`category ${String(category)} does not match code ${String(code)}`);
  }
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0) {
    return fail('message must be a non-empty string');
  }

  const details = record['details'];
  if (
    details !== undefined &&
    (typeof details !== 'object' || details === null || Array.isArray(details))
  ) {
    return fail('details must be a plain object when present');
  }

  const correlationId = record['correlationId'];
  if (correlationId !== undefined && !isCorrelationId(correlationId)) {
    return fail('correlationId must be a valid correlation id when present');
  }

  return new TrajectoryError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a TrajectoryError. */
export function normalizeToTrajectoryError(error: unknown): TrajectoryError {
  if (isTrajectoryError(error)) return error;
  if (error instanceof Error) {
    return new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new TrajectoryError(TRAJECTORY_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
