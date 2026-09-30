/**
 * Observability error taxonomy (Work Order A035).
 *
 * Closed code set mirroring @arena/job-protocol's JobError pattern:
 * closed codes, category mapping, structured wire-safe form, strictly
 * validating parser — unknown codes are REJECTED at parse time. Core-level
 * failures (envelope shape, canonicalization, correlation ids) still
 * propagate the original ProtocolError from @arena/protocol-core;
 * observability-domain failures carry OBS_* codes here.
 *
 * Categories reuse the core category vocabulary (encoding / integrity /
 * unknown / validation / versioning).
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const OBS_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const);

export type ObservabilityErrorCategory = (typeof OBS_ERROR_CATEGORIES)[number];

export const OBS_ERROR_CODES = Object.freeze({
  INVALID_IDENTITY: 'OBS_INVALID_IDENTITY',
  INVALID_TIMESTAMP: 'OBS_INVALID_TIMESTAMP',
  INVALID_SIGNAL: 'OBS_INVALID_SIGNAL',
  INVALID_METRIC: 'OBS_INVALID_METRIC',
  INVALID_TRACE: 'OBS_INVALID_TRACE',
  INVALID_LOG: 'OBS_INVALID_LOG',
  INVALID_AUDIT: 'OBS_INVALID_AUDIT',
  INVALID_SLO: 'OBS_INVALID_SLO',
  INVALID_WINDOW: 'OBS_INVALID_WINDOW',
  SAMPLE_OUTSIDE_WINDOW: 'OBS_SAMPLE_OUTSIDE_WINDOW',
  SAMPLES_UNORDERED: 'OBS_SAMPLES_UNORDERED',
  INVALID_ALERT_RULE: 'OBS_INVALID_ALERT_RULE',
  INVALID_ALERT_TRANSITION: 'OBS_INVALID_ALERT_TRANSITION',
  ALERT_COOLDOWN_ACTIVE: 'OBS_ALERT_COOLDOWN_ACTIVE',
  INVALID_HEALTH: 'OBS_INVALID_HEALTH',
  UNKNOWN_EVENT: 'OBS_UNKNOWN_EVENT',
  UNSUPPORTED_SIGNAL_VERSION: 'OBS_UNSUPPORTED_SIGNAL_VERSION',
  SEQUENCE_GAP: 'OBS_SEQUENCE_GAP',
  SEQUENCE_DUPLICATE: 'OBS_SEQUENCE_DUPLICATE',
  STREAM_MISMATCH: 'OBS_STREAM_MISMATCH',
  IDEMPOTENT_CONFLICT: 'OBS_IDEMPOTENT_CONFLICT',
  UNKNOWN_ERROR: 'OBS_UNKNOWN_ERROR',
} as const);

export type ObservabilityErrorCode =
  (typeof OBS_ERROR_CODES)[keyof typeof OBS_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<ObservabilityErrorCode, ObservabilityErrorCategory>> = {
  OBS_INVALID_IDENTITY: 'validation',
  OBS_INVALID_TIMESTAMP: 'validation',
  OBS_INVALID_SIGNAL: 'validation',
  OBS_INVALID_METRIC: 'validation',
  OBS_INVALID_TRACE: 'validation',
  OBS_INVALID_LOG: 'validation',
  OBS_INVALID_AUDIT: 'validation',
  OBS_INVALID_SLO: 'validation',
  OBS_INVALID_WINDOW: 'validation',
  OBS_SAMPLE_OUTSIDE_WINDOW: 'validation',
  OBS_SAMPLES_UNORDERED: 'integrity',
  OBS_INVALID_ALERT_RULE: 'validation',
  OBS_INVALID_ALERT_TRANSITION: 'validation',
  OBS_ALERT_COOLDOWN_ACTIVE: 'validation',
  OBS_INVALID_HEALTH: 'validation',
  OBS_UNKNOWN_EVENT: 'unknown',
  OBS_UNSUPPORTED_SIGNAL_VERSION: 'versioning',
  OBS_SEQUENCE_GAP: 'integrity',
  OBS_SEQUENCE_DUPLICATE: 'integrity',
  OBS_STREAM_MISMATCH: 'integrity',
  OBS_IDEMPOTENT_CONFLICT: 'integrity',
  OBS_UNKNOWN_ERROR: 'unknown',
};

export function isObservabilityErrorCode(value: unknown): value is ObservabilityErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(OBS_ERROR_CODES).includes(value as ObservabilityErrorCode)
  );
}

export function categoryForObservabilityCode(
  code: ObservabilityErrorCode,
): ObservabilityErrorCategory {
  return CODE_CATEGORY[code];
}

export interface ObservabilityErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an ObservabilityError. */
export interface ObservabilityErrorStruct {
  readonly code: ObservabilityErrorCode;
  readonly category: ObservabilityErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class ObservabilityError extends Error {
  readonly code: ObservabilityErrorCode;
  readonly category: ObservabilityErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: ObservabilityErrorCode, init: ObservabilityErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'ObservabilityError';
    this.code = code;
    this.category = categoryForObservabilityCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isObservabilityError(value: unknown): value is ObservabilityError {
  return value instanceof ObservabilityError;
}

export function toObservabilityErrorStruct(error: ObservabilityError): ObservabilityErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured ObservabilityError. Any malformed input — non-object,
 * missing or unknown code, category/code mismatch, missing message, invalid
 * optional fields — throws `ObservabilityError` with code
 * `OBS_UNKNOWN_ERROR` (fail-closed).
 */
export function fromObservabilityErrorStruct(value: unknown): ObservabilityError {
  if (typeof value !== 'object' || value === null) {
    throw unknownStruct('error struct must be a JSON object');
  }
  const record = value as Record<string, unknown>;
  const code = record['code'];
  if (!isObservabilityErrorCode(code)) {
    throw unknownStruct(`unknown observability error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForObservabilityCode(code)) {
    throw unknownStruct(`category/code mismatch for ${String(code)}`);
  }
  const message = record['message'];
  if (typeof message !== 'string' || message.length === 0 || message.length > 4096) {
    throw unknownStruct('error message must be a non-empty string (<= 4096 chars)');
  }
  if (
    record['details'] !== undefined &&
    (typeof record['details'] !== 'object' ||
      record['details'] === null ||
      Array.isArray(record['details']))
  ) {
    throw unknownStruct('details must be a JSON object when present');
  }
  if (
    record['correlationId'] !== undefined &&
    !isCorrelationId(record['correlationId'])
  ) {
    throw unknownStruct('correlationId must be a valid correlation id when present');
  }
  return new ObservabilityError(code, {
    message,
    ...(record['details'] !== undefined
      ? { details: record['details'] as Readonly<Record<string, unknown>> }
      : {}),
    ...(record['correlationId'] !== undefined
      ? { correlationId: record['correlationId'] as CorrelationId }
      : {}),
  });
}

function unknownStruct(reason: string): ObservabilityError {
  return new ObservabilityError(OBS_ERROR_CODES.UNKNOWN_ERROR, {
    message: `malformed ObservabilityError struct: ${reason}`,
  });
}
