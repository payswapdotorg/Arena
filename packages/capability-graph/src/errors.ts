/**
 * Capability-graph protocol error taxonomy (Work Order A004).
 *
 * @arena/capability-graph owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError and
 * @arena/artifact-protocol's ArtifactError (closed codes, category mapping,
 * structured wire-safe form, strictly validating parser — unknown codes are
 * REJECTED at parse time). The core taxonomy is frozen inside
 * @arena/protocol-core (A001 surface, read-only for this package), so
 * capability-graph-domain failures carry CAPABILITY_GRAPH_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const CAPABILITY_GRAPH_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const;

export type CapabilityGraphErrorCategory =
  (typeof CAPABILITY_GRAPH_ERROR_CATEGORIES)[number];

export const CAPABILITY_GRAPH_ERROR_CODES = {
  INVALID_NODE_KIND: 'CAPABILITY_GRAPH_INVALID_NODE_KIND',
  INVALID_EDGE_KIND: 'CAPABILITY_GRAPH_INVALID_EDGE_KIND',
  INVALID_NODE: 'CAPABILITY_GRAPH_INVALID_NODE',
  INVALID_EDGE: 'CAPABILITY_GRAPH_INVALID_EDGE',
  INVALID_PAYLOAD: 'CAPABILITY_GRAPH_INVALID_PAYLOAD',
  INVALID_REF: 'CAPABILITY_GRAPH_INVALID_REF',
  INVALID_DIGEST: 'CAPABILITY_GRAPH_INVALID_DIGEST',
  INVALID_TIMESTAMP: 'CAPABILITY_GRAPH_INVALID_TIMESTAMP',
  INVALID_ID: 'CAPABILITY_GRAPH_INVALID_ID',
  INVALID_VERSION: 'CAPABILITY_GRAPH_INVALID_VERSION',
  INVALID_SUPERSESSION: 'CAPABILITY_GRAPH_INVALID_SUPERSESSION',
  INVALID_PACK: 'CAPABILITY_GRAPH_INVALID_PACK',
  NODE_NOT_FOUND: 'CAPABILITY_GRAPH_NODE_NOT_FOUND',
  CYCLE_DETECTED: 'CAPABILITY_GRAPH_CYCLE_DETECTED',
  TAMPERED: 'CAPABILITY_GRAPH_TAMPERED',
  IDENTITY_CONFLICT: 'CAPABILITY_GRAPH_IDENTITY_CONFLICT',
  PACK_OVERREACH: 'CAPABILITY_GRAPH_PACK_OVERREACH',
  UNSUPPORTED_RECORD_VERSION: 'CAPABILITY_GRAPH_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'CAPABILITY_GRAPH_UNKNOWN_ERROR',
} as const;

export type CapabilityGraphErrorCode =
  (typeof CAPABILITY_GRAPH_ERROR_CODES)[keyof typeof CAPABILITY_GRAPH_ERROR_CODES];

const CODE_CATEGORY: Readonly<
  Record<CapabilityGraphErrorCode, CapabilityGraphErrorCategory>
> = {
  CAPABILITY_GRAPH_INVALID_NODE_KIND: 'validation',
  CAPABILITY_GRAPH_INVALID_EDGE_KIND: 'validation',
  CAPABILITY_GRAPH_INVALID_NODE: 'validation',
  CAPABILITY_GRAPH_INVALID_EDGE: 'validation',
  CAPABILITY_GRAPH_INVALID_PAYLOAD: 'validation',
  CAPABILITY_GRAPH_INVALID_REF: 'validation',
  CAPABILITY_GRAPH_INVALID_DIGEST: 'validation',
  CAPABILITY_GRAPH_INVALID_TIMESTAMP: 'validation',
  CAPABILITY_GRAPH_INVALID_ID: 'validation',
  CAPABILITY_GRAPH_INVALID_VERSION: 'validation',
  CAPABILITY_GRAPH_INVALID_SUPERSESSION: 'validation',
  CAPABILITY_GRAPH_INVALID_PACK: 'validation',
  CAPABILITY_GRAPH_NODE_NOT_FOUND: 'integrity',
  CAPABILITY_GRAPH_CYCLE_DETECTED: 'integrity',
  CAPABILITY_GRAPH_TAMPERED: 'integrity',
  CAPABILITY_GRAPH_IDENTITY_CONFLICT: 'integrity',
  CAPABILITY_GRAPH_PACK_OVERREACH: 'integrity',
  CAPABILITY_GRAPH_UNSUPPORTED_RECORD_VERSION: 'versioning',
  CAPABILITY_GRAPH_UNKNOWN_ERROR: 'unknown',
};

export function isCapabilityGraphErrorCode(
  value: unknown,
): value is CapabilityGraphErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(CAPABILITY_GRAPH_ERROR_CODES).includes(
      value as CapabilityGraphErrorCode,
    )
  );
}

export function categoryForCapabilityGraphCode(
  code: CapabilityGraphErrorCode,
): CapabilityGraphErrorCategory {
  return CODE_CATEGORY[code];
}

export interface CapabilityGraphErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of a CapabilityGraphError. */
export interface CapabilityGraphErrorStruct {
  readonly code: CapabilityGraphErrorCode;
  readonly category: CapabilityGraphErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

/**
 * The capability-graph domain's structured protocol error.
 *
 * NOTE (Work Order A004 gate 4): the dispatch text requires cycle rejection
 * to "throw a ProtocolError". The core ProtocolError code set is frozen
 * inside @arena/protocol-core (A001 surface, read-only for A004) and has no
 * graph-cycle code, so — exactly like the accepted A002 precedent
 * (ProvenanceError.PROVENANCE_CYCLE_DETECTED, PR #6) — the structured
 * protocol error of THIS package carries cycle rejections, with the
 * offending path in both `message` and `details.path`. Core-level failures
 * still propagate core ProtocolError values untouched.
 */
export class CapabilityGraphError extends Error {
  readonly code: CapabilityGraphErrorCode;
  readonly category: CapabilityGraphErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: CapabilityGraphErrorCode, init: CapabilityGraphErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'CapabilityGraphError';
    this.code = code;
    this.category = categoryForCapabilityGraphCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isCapabilityGraphError(
  value: unknown,
): value is CapabilityGraphError {
  return value instanceof CapabilityGraphError;
}

export function toCapabilityGraphErrorStruct(
  error: CapabilityGraphError,
): CapabilityGraphErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined
      ? { correlationId: error.correlationId }
      : {}),
  };
}

/**
 * Parse a structured CapabilityGraphError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `CapabilityGraphError` with code
 * CAPABILITY_GRAPH_UNKNOWN_ERROR.
 */
export function fromCapabilityGraphErrorStruct(
  value: unknown,
): CapabilityGraphError {
  const fail = (reason: string): never => {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured capability-graph error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isCapabilityGraphErrorCode(code)) {
    return fail(`unknown or missing capability-graph error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForCapabilityGraphCode(code)) {
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

  return new CapabilityGraphError(code, {
    message,
    ...(details !== undefined
      ? { details: details as Readonly<Record<string, unknown>> }
      : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a CapabilityGraphError. */
export function normalizeToCapabilityGraphError(error: unknown): CapabilityGraphError {
  if (isCapabilityGraphError(error)) return error;
  if (error instanceof Error) {
    return new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
