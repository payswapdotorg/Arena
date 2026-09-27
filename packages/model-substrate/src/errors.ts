/**
 * Model substrate protocol error taxonomy (Work Order A016).
 *
 * @arena/model-substrate owns its own closed error code set, mirroring the
 * pattern of @arena/agent-body's AgentBodyError and @arena/artifact-protocol's
 * ArtifactError (closed codes, category mapping, structured wire-safe form,
 * strictly validating parser — unknown codes are REJECTED at parse time).
 * Core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const MODEL_SUBSTRATE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type ModelSubstrateErrorCategory = (typeof MODEL_SUBSTRATE_ERROR_CATEGORIES)[number];

export const MODEL_SUBSTRATE_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'MODEL_SUBSTRATE_INVALID_IDENTITY',
  INVALID_REF: 'MODEL_SUBSTRATE_INVALID_REF',
  INVALID_DIGEST: 'MODEL_SUBSTRATE_INVALID_DIGEST',
  INVALID_VERSION: 'MODEL_SUBSTRATE_INVALID_VERSION',
  INVALID_TIMESTAMP: 'MODEL_SUBSTRATE_INVALID_TIMESTAMP',
  INVALID_ADAPTER_DESCRIPTOR: 'MODEL_SUBSTRATE_INVALID_ADAPTER_DESCRIPTOR',
  INVALID_SUBSTRATE: 'MODEL_SUBSTRATE_INVALID_SUBSTRATE',
  INVALID_CAPABILITY_PROFILE: 'MODEL_SUBSTRATE_INVALID_CAPABILITY_PROFILE',
  INVALID_HEALTH_REPORT: 'MODEL_SUBSTRATE_INVALID_HEALTH_REPORT',
  INVALID_REGISTRATION: 'MODEL_SUBSTRATE_INVALID_REGISTRATION',
  REGISTRY_CONFLICT: 'MODEL_SUBSTRATE_REGISTRY_CONFLICT',
  ADAPTER_MISMATCH: 'MODEL_SUBSTRATE_ADAPTER_MISMATCH',
  CAPABILITY_EXCEEDED: 'MODEL_SUBSTRATE_CAPABILITY_EXCEEDED',
  INVALID_COMPATIBILITY_TEST: 'MODEL_SUBSTRATE_INVALID_COMPATIBILITY_TEST',
  INVALID_COMPATIBILITY_RESULT: 'MODEL_SUBSTRATE_INVALID_COMPATIBILITY_RESULT',
  INVALID_UPGRADE: 'MODEL_SUBSTRATE_INVALID_UPGRADE',
  POSSESSION_REBIND_FORBIDDEN: 'MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN',
  PROVIDER_NAME_REJECTED: 'MODEL_SUBSTRATE_PROVIDER_NAME_REJECTED',
  CREDENTIAL_REJECTED: 'MODEL_SUBSTRATE_CREDENTIAL_REJECTED',
  SUBSTRATE_ALIAS_FORBIDDEN: 'MODEL_SUBSTRATE_SUBSTRATE_ALIAS_FORBIDDEN',
  TAMPERED: 'MODEL_SUBSTRATE_TAMPERED',
  UNSUPPORTED_VERSION: 'MODEL_SUBSTRATE_UNSUPPORTED_VERSION',
  UNKNOWN_ERROR: 'MODEL_SUBSTRATE_UNKNOWN_ERROR',
} as const);

export type ModelSubstrateErrorCode =
  (typeof MODEL_SUBSTRATE_ERROR_CODES)[keyof typeof MODEL_SUBSTRATE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ModelSubstrateErrorCode, ModelSubstrateErrorCategory>> = Object.freeze({
  MODEL_SUBSTRATE_INVALID_IDENTITY: 'validation',
  MODEL_SUBSTRATE_INVALID_REF: 'validation',
  MODEL_SUBSTRATE_INVALID_DIGEST: 'validation',
  MODEL_SUBSTRATE_INVALID_VERSION: 'validation',
  MODEL_SUBSTRATE_INVALID_TIMESTAMP: 'validation',
  MODEL_SUBSTRATE_INVALID_ADAPTER_DESCRIPTOR: 'validation',
  MODEL_SUBSTRATE_INVALID_SUBSTRATE: 'validation',
  MODEL_SUBSTRATE_INVALID_CAPABILITY_PROFILE: 'validation',
  MODEL_SUBSTRATE_INVALID_HEALTH_REPORT: 'validation',
  MODEL_SUBSTRATE_INVALID_REGISTRATION: 'validation',
  MODEL_SUBSTRATE_REGISTRY_CONFLICT: 'integrity',
  MODEL_SUBSTRATE_ADAPTER_MISMATCH: 'integrity',
  MODEL_SUBSTRATE_CAPABILITY_EXCEEDED: 'validation',
  MODEL_SUBSTRATE_INVALID_COMPATIBILITY_TEST: 'validation',
  MODEL_SUBSTRATE_INVALID_COMPATIBILITY_RESULT: 'validation',
  MODEL_SUBSTRATE_INVALID_UPGRADE: 'validation',
  MODEL_SUBSTRATE_POSSESSION_REBIND_FORBIDDEN: 'validation',
  MODEL_SUBSTRATE_PROVIDER_NAME_REJECTED: 'validation',
  MODEL_SUBSTRATE_CREDENTIAL_REJECTED: 'validation',
  MODEL_SUBSTRATE_SUBSTRATE_ALIAS_FORBIDDEN: 'validation',
  MODEL_SUBSTRATE_TAMPERED: 'integrity',
  MODEL_SUBSTRATE_UNSUPPORTED_VERSION: 'versioning',
  MODEL_SUBSTRATE_UNKNOWN_ERROR: 'unknown',
});

export function isModelSubstrateErrorCode(value: unknown): value is ModelSubstrateErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(MODEL_SUBSTRATE_ERROR_CODES).includes(value as ModelSubstrateErrorCode)
  );
}

export function categoryForModelSubstrateCode(
  code: ModelSubstrateErrorCode,
): ModelSubstrateErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ModelSubstrateErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a ModelSubstrateError. */
export interface ModelSubstrateErrorStruct {
  readonly code: ModelSubstrateErrorCode;
  readonly category: ModelSubstrateErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ModelSubstrateError extends Error {
  readonly code: ModelSubstrateErrorCode;
  readonly category: ModelSubstrateErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ModelSubstrateErrorCode, init: ModelSubstrateErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ModelSubstrateError';
    this.code = code;
    this.category = categoryForModelSubstrateCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isModelSubstrateError(value: unknown): value is ModelSubstrateError {
  return value instanceof ModelSubstrateError;
}

export function toModelSubstrateErrorStruct(error: ModelSubstrateError): ModelSubstrateErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ModelSubstrateError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `ModelSubstrateError` with code
 * `MODEL_SUBSTRATE_UNKNOWN_ERROR`.
 */
export function fromModelSubstrateErrorStruct(value: unknown): ModelSubstrateError {
  const fail = (reason: string): never => {
    throw new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured model substrate error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isModelSubstrateErrorCode(code)) {
    return fail(`unknown or missing model substrate error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForModelSubstrateCode(code)) {
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

  return new ModelSubstrateError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a ModelSubstrateError. */
export function normalizeToModelSubstrateError(error: unknown): ModelSubstrateError {
  if (isModelSubstrateError(error)) return error;
  if (error instanceof Error) {
    return new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new ModelSubstrateError(MODEL_SUBSTRATE_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
