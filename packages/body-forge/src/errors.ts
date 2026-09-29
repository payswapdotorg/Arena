/**
 * Body-forge error taxonomy (Work Order A021; requirement R18).
 *
 * @arena/body-forge owns its own closed error code set, mirroring the
 * pattern of @arena/skill-extraction's SkillExtractionError and
 * @arena/learning's LearningError (closed codes, core category
 * mapping, structured wire-safe form, strictly validating parser —
 * unknown codes are REJECTED at parse time). The core taxonomy is
 * frozen inside @arena/protocol-core (A001 surface, read-only for
 * this package), so body-forge-domain failures carry BODY_FORGE_*
 * codes here while core-level failures (canonicalization, envelope
 * shape, correlation ids, schema refs) still propagate the original
 * ProtocolError.
 *
 * Failures raised by the REAL @arena/agent-body constructor the forge
 * projects through (createBodyVersion) propagate as AgentBodyError —
 * the A003 contract is the final authority on the emitted shape, and
 * this package's guards are strictly stronger for manifest inputs
 * (disclosed in README; forge.test.ts pins the reachable boundary).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const BODY_FORGE_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type BodyForgeErrorCategory = (typeof BODY_FORGE_ERROR_CATEGORIES)[number];

export const BODY_FORGE_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'BODY_FORGE_INVALID_IDENTITY',
  INVALID_DIGEST: 'BODY_FORGE_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'BODY_FORGE_INVALID_TIMESTAMP',
  INVALID_REF: 'BODY_FORGE_INVALID_REF',
  INVALID_MANIFEST: 'BODY_FORGE_INVALID_MANIFEST',
  INVALID_POLICY: 'BODY_FORGE_INVALID_POLICY',
  INVALID_RECIPE: 'BODY_FORGE_INVALID_RECIPE',
  INVALID_RECORD: 'BODY_FORGE_INVALID_RECORD',
  INVALID_PROVENANCE: 'BODY_FORGE_INVALID_PROVENANCE',
  INVALID_SCHEMA_REF: 'BODY_FORGE_INVALID_SCHEMA_REF',
  REQUIREMENT_VIOLATION: 'BODY_FORGE_REQUIREMENT_VIOLATION',
  CONFLICT: 'BODY_FORGE_CONFLICT',
  LINEAGE_VIOLATION: 'BODY_FORGE_LINEAGE_VIOLATION',
  LEARNING_PROVENANCE_REJECTED: 'BODY_FORGE_LEARNING_PROVENANCE_REJECTED',
  NOT_FOUND: 'BODY_FORGE_NOT_FOUND',
  IDENTITY_CONFLICT: 'BODY_FORGE_IDENTITY_CONFLICT',
  IDEMPOTENCY_CONFLICT: 'BODY_FORGE_IDEMPOTENCY_CONFLICT',
  TAMPERED: 'BODY_FORGE_TAMPERED',
  VERSION_CONFLICT: 'BODY_FORGE_VERSION_CONFLICT',
  UNSUPPORTED_RECORD_VERSION: 'BODY_FORGE_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'BODY_FORGE_UNKNOWN_ERROR',
} as const);

export type BodyForgeErrorCode = (typeof BODY_FORGE_ERROR_CODES)[keyof typeof BODY_FORGE_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<BodyForgeErrorCode, BodyForgeErrorCategory>> = {
  BODY_FORGE_INVALID_IDENTITY: 'validation',
  BODY_FORGE_INVALID_DIGEST: 'validation',
  BODY_FORGE_INVALID_TIMESTAMP: 'validation',
  BODY_FORGE_INVALID_REF: 'validation',
  BODY_FORGE_INVALID_MANIFEST: 'validation',
  BODY_FORGE_INVALID_POLICY: 'validation',
  BODY_FORGE_INVALID_RECIPE: 'validation',
  BODY_FORGE_INVALID_RECORD: 'validation',
  BODY_FORGE_INVALID_PROVENANCE: 'validation',
  BODY_FORGE_INVALID_SCHEMA_REF: 'validation',
  BODY_FORGE_REQUIREMENT_VIOLATION: 'validation',
  BODY_FORGE_CONFLICT: 'integrity',
  BODY_FORGE_LINEAGE_VIOLATION: 'integrity',
  BODY_FORGE_LEARNING_PROVENANCE_REJECTED: 'integrity',
  BODY_FORGE_NOT_FOUND: 'validation',
  BODY_FORGE_IDENTITY_CONFLICT: 'integrity',
  BODY_FORGE_IDEMPOTENCY_CONFLICT: 'integrity',
  BODY_FORGE_TAMPERED: 'integrity',
  BODY_FORGE_VERSION_CONFLICT: 'integrity',
  BODY_FORGE_UNSUPPORTED_RECORD_VERSION: 'versioning',
  BODY_FORGE_UNKNOWN_ERROR: 'unknown',
};

export function isBodyForgeErrorCode(value: unknown): value is BodyForgeErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(BODY_FORGE_ERROR_CODES).includes(value as BodyForgeErrorCode)
  );
}

export function categoryForBodyForgeCode(code: BodyForgeErrorCode): BodyForgeErrorCategory {
  return CODE_CATEGORY[code];
}

export interface BodyForgeErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a BodyForgeError. */
export interface BodyForgeErrorStruct {
  readonly code: BodyForgeErrorCode;
  readonly category: BodyForgeErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class BodyForgeError extends Error {
  readonly code: BodyForgeErrorCode;
  readonly category: BodyForgeErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: BodyForgeErrorCode, init: BodyForgeErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'BodyForgeError';
    this.code = code;
    this.category = categoryForBodyForgeCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isBodyForgeError(value: unknown): value is BodyForgeError {
  return value instanceof BodyForgeError;
}

export function toBodyForgeErrorStruct(error: BodyForgeError): BodyForgeErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured BodyForgeError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `BodyForgeError` with code
 * `BODY_FORGE_UNKNOWN_ERROR`.
 */
export function fromBodyForgeErrorStruct(value: unknown): BodyForgeError {
  const fail = (reason: string): never => {
    throw new BodyForgeError(BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured body-forge error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isBodyForgeErrorCode(code)) {
    return fail(`unknown or missing body-forge error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForBodyForgeCode(code)) {
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

  return new BodyForgeError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a BodyForgeError. */
export function normalizeToBodyForgeError(error: unknown): BodyForgeError {
  if (isBodyForgeError(error)) return error;
  if (error instanceof Error) {
    return new BodyForgeError(BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new BodyForgeError(BODY_FORGE_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
