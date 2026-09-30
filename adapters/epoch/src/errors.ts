/**
 * Epoch adapter error taxonomy (Work Order A026; spec/epoch-integration.md
 * EPI1.0 — "closed error vocabulary and fail-closed validation").
 *
 * Mirrors the A025 ArenaApiError discipline: a closed frozen code set, a
 * closed category vocabulary, a typed error class carrying structured
 * details + the correlation id of the failing exchange, strict
 * struct round-trips, and a normalizer so nothing partial ever escapes
 * the adapter boundary.
 */

export const EPOCH_ADAPTER_ERROR_CATEGORIES = Object.freeze([
  'validation',
  'scope',
  'integrity',
  'lifecycle',
  'authority',
  'versioning',
  'unknown',
] as const);

export type EpochAdapterErrorCategory = (typeof EPOCH_ADAPTER_ERROR_CATEGORIES)[number];

export const EPOCH_ADAPTER_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: 'EPOCH_ADAPTER_INVALID_REQUEST',
  INVALID_REF: 'EPOCH_ADAPTER_INVALID_REF',
  INVALID_AUTHORIZATION: 'EPOCH_ADAPTER_INVALID_AUTHORIZATION',
  CROSS_TENANT: 'EPOCH_ADAPTER_CROSS_TENANT',
  IDEMPOTENCY_REQUIRED: 'EPOCH_ADAPTER_IDEMPOTENCY_REQUIRED',
  IDEMPOTENCY_CONFLICT: 'EPOCH_ADAPTER_IDEMPOTENCY_CONFLICT',
  JOB_NOT_FOUND: 'EPOCH_ADAPTER_JOB_NOT_FOUND',
  JOB_TERMINAL: 'EPOCH_ADAPTER_JOB_TERMINAL',
  INVALID_LIFECYCLE: 'EPOCH_ADAPTER_INVALID_LIFECYCLE',
  UNRESOLVED_ARTIFACT: 'EPOCH_ADAPTER_UNRESOLVED_ARTIFACT',
  SCHEMA_MISMATCH: 'EPOCH_ADAPTER_SCHEMA_MISMATCH',
  UNSUPPORTED_VERSION: 'EPOCH_ADAPTER_UNSUPPORTED_VERSION',
  WORLD_MODEL_FORBIDDEN: 'EPOCH_ADAPTER_WORLD_MODEL_FORBIDDEN',
  UNKNOWN_ERROR: 'EPOCH_ADAPTER_UNKNOWN_ERROR',
} as const);

export type EpochAdapterErrorCode =
  (typeof EPOCH_ADAPTER_ERROR_CODES)[keyof typeof EPOCH_ADAPTER_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<EpochAdapterErrorCode, EpochAdapterErrorCategory>> =
  Object.freeze({
    EPOCH_ADAPTER_INVALID_REQUEST: 'validation',
    EPOCH_ADAPTER_INVALID_REF: 'validation',
    EPOCH_ADAPTER_INVALID_AUTHORIZATION: 'scope',
    EPOCH_ADAPTER_CROSS_TENANT: 'scope',
    EPOCH_ADAPTER_IDEMPOTENCY_REQUIRED: 'integrity',
    EPOCH_ADAPTER_IDEMPOTENCY_CONFLICT: 'integrity',
    EPOCH_ADAPTER_JOB_NOT_FOUND: 'lifecycle',
    EPOCH_ADAPTER_JOB_TERMINAL: 'lifecycle',
    EPOCH_ADAPTER_INVALID_LIFECYCLE: 'lifecycle',
    EPOCH_ADAPTER_UNRESOLVED_ARTIFACT: 'integrity',
    EPOCH_ADAPTER_SCHEMA_MISMATCH: 'validation',
    EPOCH_ADAPTER_UNSUPPORTED_VERSION: 'versioning',
    EPOCH_ADAPTER_WORLD_MODEL_FORBIDDEN: 'authority',
    EPOCH_ADAPTER_UNKNOWN_ERROR: 'unknown',
  });

export function isEpochAdapterErrorCode(value: unknown): value is EpochAdapterErrorCode {
  return (
    typeof value === 'string' &&
    (Object.values(EPOCH_ADAPTER_ERROR_CODES) as readonly string[]).includes(value)
  );
}

export function categoryForEpochAdapterCode(
  code: EpochAdapterErrorCode,
): EpochAdapterErrorCategory {
  return CODE_CATEGORY[code];
}

export interface EpochAdapterErrorInit {
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;
}

/** The structured, serializable form of an epoch adapter error. */
export interface EpochAdapterErrorStruct {
  readonly code: EpochAdapterErrorCode;
  readonly category: EpochAdapterErrorCategory;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;
}

export class EpochAdapterError extends Error {
  readonly code: EpochAdapterErrorCode;
  readonly category: EpochAdapterErrorCategory;
  readonly details?: Record<string, unknown>;
  readonly correlationId?: string;

  constructor(code: EpochAdapterErrorCode, init: EpochAdapterErrorInit) {
    // The code prefixes the message so wire consumers and tests can match
    // the closed vocabulary directly on the thrown error.
    super(`${code}: ${init.message}`);
    this.name = 'EpochAdapterError';
    this.code = code;
    this.category = categoryForEpochAdapterCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isEpochAdapterError(value: unknown): value is EpochAdapterError {
  return (
    typeof value === 'object' &&
    value !== null &&
    value instanceof EpochAdapterError &&
    isEpochAdapterErrorCode(value.code)
  );
}

export function toEpochAdapterErrorStruct(
  error: EpochAdapterError,
): EpochAdapterErrorStruct {
  const struct: EpochAdapterErrorStruct = {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined
      ? { correlationId: error.correlationId }
      : {}),
  };
  return Object.freeze(struct);
}

/** Strict, fail-closed struct parse: unknown codes are rejected. */
export function fromEpochAdapterErrorStruct(
  value: unknown,
): EpochAdapterErrorStruct {
  if (typeof value !== 'object' || value === null) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'epoch adapter error struct must be a plain object',
      details: { received: typeof value },
    });
  }
  const candidate = value as Record<string, unknown>;
  const allowed = ['code', 'category', 'message', 'details', 'correlationId'];
  for (const key of Object.keys(candidate)) {
    if (!allowed.includes(key)) {
      throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
        message: `epoch adapter error struct carries unknown field ${JSON.stringify(key)} (closed shape)`,
        details: { field: key },
      });
    }
  }
  if (!isEpochAdapterErrorCode(candidate['code'])) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `unknown epoch adapter error code: ${JSON.stringify(candidate['code'])}`,
      details: { supported: Object.values(EPOCH_ADAPTER_ERROR_CODES) },
    });
  }
  const code = candidate['code'];
  if (candidate['category'] !== categoryForEpochAdapterCode(code)) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: `error category ${JSON.stringify(candidate['category'])} does not match code ${JSON.stringify(code)}`,
      details: { expected: categoryForEpochAdapterCode(code) },
    });
  }
  if (typeof candidate['message'] !== 'string' || candidate['message'].length === 0) {
    throw new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.INVALID_REQUEST, {
      message: 'epoch adapter error struct requires a non-empty message',
    });
  }
  const struct: EpochAdapterErrorStruct = {
    code,
    category: categoryForEpochAdapterCode(code),
    message: candidate['message'],
    ...(typeof candidate['details'] === 'object' && candidate['details'] !== null
      ? { details: candidate['details'] as Record<string, unknown> }
      : {}),
    ...(typeof candidate['correlationId'] === 'string'
      ? { correlationId: candidate['correlationId'] }
      : {}),
  };
  return Object.freeze(struct);
}

/** Normalize any thrown value into a typed EpochAdapterError (fail-closed). */
export function normalizeToEpochAdapterError(
  error: unknown,
  correlationId?: string,
): EpochAdapterError {
  if (isEpochAdapterError(error)) return error;
  return new EpochAdapterError(EPOCH_ADAPTER_ERROR_CODES.UNKNOWN_ERROR, {
    message: `unexpected epoch adapter failure: ${error instanceof Error ? error.message : String(error)}`,
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}
