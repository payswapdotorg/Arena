/**
 * Environment protocol error taxonomy (Work Order A009).
 *
 * @arena/environment-protocol owns its own closed error code set, mirroring
 * the pattern of @arena/artifact-protocol's ArtifactError and
 * @arena/agent-body's AgentBodyError (closed codes, core category mapping,
 * structured wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * environment-domain failures carry ENVIRONMENT_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const ENVIRONMENT_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type EnvironmentErrorCategory = (typeof ENVIRONMENT_ERROR_CATEGORIES)[number];

export const ENVIRONMENT_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'ENVIRONMENT_INVALID_IDENTITY',
  INVALID_DIGEST: 'ENVIRONMENT_INVALID_DIGEST',
  INVALID_IMAGE: 'ENVIRONMENT_INVALID_IMAGE',
  INVALID_SNAPSHOT: 'ENVIRONMENT_INVALID_SNAPSHOT',
  INVALID_SEED_POLICY: 'ENVIRONMENT_INVALID_SEED_POLICY',
  INVALID_REPRODUCIBILITY: 'ENVIRONMENT_INVALID_REPRODUCIBILITY',
  INVALID_ACTION_SURFACE: 'ENVIRONMENT_INVALID_ACTION_SURFACE',
  INVALID_OBSERVATION_SURFACE: 'ENVIRONMENT_INVALID_OBSERVATION_SURFACE',
  INVALID_RESOURCE_LIMITS: 'ENVIRONMENT_INVALID_RESOURCE_LIMITS',
  INVALID_NETWORK_POLICY: 'ENVIRONMENT_INVALID_NETWORK_POLICY',
  INVALID_FILESYSTEM_POLICY: 'ENVIRONMENT_INVALID_FILESYSTEM_POLICY',
  INVALID_SECRET_POLICY: 'ENVIRONMENT_INVALID_SECRET_POLICY',
  INVALID_TIME_LIMITS: 'ENVIRONMENT_INVALID_TIME_LIMITS',
  INVALID_RESET_SEMANTICS: 'ENVIRONMENT_INVALID_RESET_SEMANTICS',
  INVALID_CHECKPOINT_SEMANTICS: 'ENVIRONMENT_INVALID_CHECKPOINT_SEMANTICS',
  INVALID_EVIDENCE_OUTPUTS: 'ENVIRONMENT_INVALID_EVIDENCE_OUTPUTS',
  INVALID_EVALUATION_HOOKS: 'ENVIRONMENT_INVALID_EVALUATION_HOOKS',
  INVALID_DEFINITION: 'ENVIRONMENT_INVALID_DEFINITION',
  INVALID_RUN_ADDRESS: 'ENVIRONMENT_INVALID_RUN_ADDRESS',
  INVALID_WORKLOAD: 'ENVIRONMENT_INVALID_WORKLOAD',
  LEAST_PRIVILEGE_VIOLATION: 'ENVIRONMENT_LEAST_PRIVILEGE_VIOLATION',
  RUNTIME_LEAKAGE: 'ENVIRONMENT_RUNTIME_LEAKAGE',
  CREDENTIAL_REJECTED: 'ENVIRONMENT_CREDENTIAL_REJECTED',
  TAMPERED: 'ENVIRONMENT_TAMPERED',
  VERSION_CONFLICT: 'ENVIRONMENT_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'ENVIRONMENT_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'ENVIRONMENT_UNKNOWN_ERROR',
} as const);

export type EnvironmentErrorCode =
  (typeof ENVIRONMENT_ERROR_CODES)[keyof typeof ENVIRONMENT_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EnvironmentErrorCode, EnvironmentErrorCategory>> = {
  ENVIRONMENT_INVALID_IDENTITY: 'validation',
  ENVIRONMENT_INVALID_DIGEST: 'validation',
  ENVIRONMENT_INVALID_IMAGE: 'validation',
  ENVIRONMENT_INVALID_SNAPSHOT: 'validation',
  ENVIRONMENT_INVALID_SEED_POLICY: 'validation',
  ENVIRONMENT_INVALID_REPRODUCIBILITY: 'validation',
  ENVIRONMENT_INVALID_ACTION_SURFACE: 'validation',
  ENVIRONMENT_INVALID_OBSERVATION_SURFACE: 'validation',
  ENVIRONMENT_INVALID_RESOURCE_LIMITS: 'validation',
  ENVIRONMENT_INVALID_NETWORK_POLICY: 'validation',
  ENVIRONMENT_INVALID_FILESYSTEM_POLICY: 'validation',
  ENVIRONMENT_INVALID_SECRET_POLICY: 'validation',
  ENVIRONMENT_INVALID_TIME_LIMITS: 'validation',
  ENVIRONMENT_INVALID_RESET_SEMANTICS: 'validation',
  ENVIRONMENT_INVALID_CHECKPOINT_SEMANTICS: 'validation',
  ENVIRONMENT_INVALID_EVIDENCE_OUTPUTS: 'validation',
  ENVIRONMENT_INVALID_EVALUATION_HOOKS: 'validation',
  ENVIRONMENT_INVALID_DEFINITION: 'validation',
  ENVIRONMENT_INVALID_RUN_ADDRESS: 'validation',
  ENVIRONMENT_INVALID_WORKLOAD: 'validation',
  ENVIRONMENT_LEAST_PRIVILEGE_VIOLATION: 'validation',
  ENVIRONMENT_RUNTIME_LEAKAGE: 'validation',
  ENVIRONMENT_CREDENTIAL_REJECTED: 'validation',
  ENVIRONMENT_TAMPERED: 'integrity',
  ENVIRONMENT_VERSION_CONFLICT: 'integrity',
  ENVIRONMENT_UNSUPPORTED_RECORD_VERSION: 'versioning',
  ENVIRONMENT_UNKNOWN_ERROR: 'unknown',
};

export function isEnvironmentErrorCode(value: unknown): value is EnvironmentErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(ENVIRONMENT_ERROR_CODES).includes(value as EnvironmentErrorCode)
  );
}

export function categoryForEnvironmentCode(code: EnvironmentErrorCode): EnvironmentErrorCategory {
  return CODE_CATEGORY[code];
}

export interface EnvironmentErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an EnvironmentError. */
export interface EnvironmentErrorStruct {
  readonly code: EnvironmentErrorCode;
  readonly category: EnvironmentErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class EnvironmentError extends Error {
  readonly code: EnvironmentErrorCode;
  readonly category: EnvironmentErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: EnvironmentErrorCode, init: EnvironmentErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'EnvironmentError';
    this.code = code;
    this.category = categoryForEnvironmentCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isEnvironmentError(value: unknown): value is EnvironmentError {
  return value instanceof EnvironmentError;
}

export function toEnvironmentErrorStruct(error: EnvironmentError): EnvironmentErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured EnvironmentError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `EnvironmentError` with code
 * `ENVIRONMENT_UNKNOWN_ERROR`.
 */
export function fromEnvironmentErrorStruct(value: unknown): EnvironmentError {
  const fail = (reason: string): never => {
    throw new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured environment error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isEnvironmentErrorCode(code)) {
    return fail(`unknown or missing environment error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForEnvironmentCode(code)) {
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

  return new EnvironmentError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an EnvironmentError. */
export function normalizeToEnvironmentError(error: unknown): EnvironmentError {
  if (isEnvironmentError(error)) return error;
  if (error instanceof Error) {
    return new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new EnvironmentError(ENVIRONMENT_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
