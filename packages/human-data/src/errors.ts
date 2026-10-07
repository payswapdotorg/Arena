/**
 * Human-data error taxonomy (Work Order C012; issue #118).
 *
 * Mirrors the sibling domain packages' typed errors (@arena/escalation's
 * EscalationError, @arena/datasets' DatasetError): closed code set, category
 * mapping, structured wire-safe form, strictly validating parser (unknown
 * codes are REJECTED at parse time). Failures thrown by the REUSED merged
 * dependencies (@arena/escalation ESCALATION_*, @arena/artifact-protocol
 * ARTIFACT_*, @arena/datasets DATASET_*) propagate unchanged — this package
 * never reimplements their validation, canonicalization or hashing.
 *
 * The closed failure vocabulary of the human-data domain core:
 *   - commission construction/state failures (HUMAN_DATA_INVALID_COMMISSION,
 *     HUMAN_DATA_INVALID_STATE);
 *   - THE RIGHTS WALL (HUMAN_DATA_CONSENT_WALL) — a deliverable without an
 *     explicit GRANTED consent/rights statement can never enter a dataset
 *     bundle (spec/security.md data rights; architecture-lock rules 11, 18,
 *     31; EES1.0 consent);
 *   - tenant isolation (HUMAN_DATA_CROSS_TENANT — customer data is never
 *     used across tenants);
 *   - THE VALIDATION GATE (HUMAN_DATA_VALIDATION_GATE) — deliverables derive
 *     ONLY from C009-ACCEPTED intervention outputs; no self-certification;
 *   - THE REPLAY LAW (HUMAN_DATA_REPLAY_LAW) — a demonstration record may
 *     never masquerade as a live-world mutation (EES1.0);
 *   - integrity (HUMAN_DATA_TAMPERED) and the fallback unknown code.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const HUMAN_DATA_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'state',
  'scope',
  'integrity',
  'unknown',
] as const);
export type HumanDataErrorCategory = (typeof HUMAN_DATA_ERROR_CATEGORIES)[number];

export const HUMAN_DATA_ERROR_CODES = Object.freeze({
  INVALID_COMMISSION: 'HUMAN_DATA_INVALID_COMMISSION',
  INVALID_STATE: 'HUMAN_DATA_INVALID_STATE',
  INVALID_DELIVERABLE: 'HUMAN_DATA_INVALID_DELIVERABLE',
  CONSENT_WALL: 'HUMAN_DATA_CONSENT_WALL',
  CROSS_TENANT: 'HUMAN_DATA_CROSS_TENANT',
  VALIDATION_GATE: 'HUMAN_DATA_VALIDATION_GATE',
  REPLAY_LAW: 'HUMAN_DATA_REPLAY_LAW',
  TAMPERED: 'HUMAN_DATA_TAMPERED',
  UNKNOWN_ERROR: 'HUMAN_DATA_UNKNOWN_ERROR',
} as const);
export type HumanDataErrorCode = (typeof HUMAN_DATA_ERROR_CODES)[keyof typeof HUMAN_DATA_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<HumanDataErrorCode, HumanDataErrorCategory>> = {
  HUMAN_DATA_INVALID_COMMISSION: 'validation',
  HUMAN_DATA_INVALID_STATE: 'state',
  HUMAN_DATA_INVALID_DELIVERABLE: 'validation',
  HUMAN_DATA_CONSENT_WALL: 'scope',
  HUMAN_DATA_CROSS_TENANT: 'scope',
  HUMAN_DATA_VALIDATION_GATE: 'state',
  HUMAN_DATA_REPLAY_LAW: 'integrity',
  HUMAN_DATA_TAMPERED: 'integrity',
  HUMAN_DATA_UNKNOWN_ERROR: 'unknown',
};

export function isHumanDataErrorCode(value: unknown): value is HumanDataErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(HUMAN_DATA_ERROR_CODES).includes(value as HumanDataErrorCode)
  );
}

export function categoryForHumanDataCode(code: HumanDataErrorCode): HumanDataErrorCategory {
  return CODE_CATEGORY[code];
}

export interface HumanDataErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) human-data failure. */
export interface HumanDataErrorStruct {
  readonly code: HumanDataErrorCode;
  readonly category: HumanDataErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class HumanDataError extends Error {
  readonly code: HumanDataErrorCode;
  readonly category: HumanDataErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: HumanDataErrorCode, init: HumanDataErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'HumanDataError';
    this.code = code;
    this.category = categoryForHumanDataCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isHumanDataError(value: unknown): value is HumanDataError {
  return value instanceof HumanDataError;
}

export function toHumanDataErrorStruct(error: HumanDataError): HumanDataErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured HumanDataError. Any malformed input — non-object,
 * unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws HumanDataError with code HUMAN_DATA_UNKNOWN_ERROR.
 */
export function fromHumanDataErrorStruct(value: unknown): HumanDataError {
  const fail = (reason: string): never => {
    throw new HumanDataError(HUMAN_DATA_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured human-data error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isHumanDataErrorCode(code)) {
    return fail(`unknown or missing human-data error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForHumanDataCode(code)) {
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

  return new HumanDataError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into a HumanDataError (fail-closed). */
export function normalizeToHumanDataError(error: unknown): HumanDataError {
  if (isHumanDataError(error)) return error;
  if (error instanceof Error) {
    return new HumanDataError(HUMAN_DATA_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new HumanDataError(HUMAN_DATA_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
