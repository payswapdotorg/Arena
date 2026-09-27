/**
 * Agent Body protocol error taxonomy (Work Order A003).
 *
 * @arena/agent-body owns its own closed error code set, mirroring the
 * pattern of @arena/protocol-core's ProtocolError and
 * @arena/artifact-protocol's ArtifactError (closed codes, category
 * mapping, structured wire-safe form, strictly validating parser —
 * unknown codes are REJECTED at parse time). The core taxonomy is frozen
 * inside @arena/protocol-core (A001 surface, read-only for this package),
 * so agent-body-domain failures carry AGENT_BODY_* codes here while
 * core-level failures (canonicalization, envelope shape, correlation ids,
 * schema refs) still propagate the original ProtocolError from
 * @arena/protocol-core.
 *
 * Categories reuse the core category vocabulary so wire consumers need only
 * one category model.
 */

import type { CorrelationId } from '@arena/protocol-core';
import { isCorrelationId } from '@arena/protocol-core';

export const AGENT_BODY_ERROR_CATEGORIES = [
  'validation',
  'encoding',
  'versioning',
  'integrity',
  'unknown',
] as const;

export type AgentBodyErrorCategory = (typeof AGENT_BODY_ERROR_CATEGORIES)[number];

export const AGENT_BODY_ERROR_CODES = {
  INVALID_IDENTITY: 'AGENT_BODY_INVALID_IDENTITY',
  INVALID_REF: 'AGENT_BODY_INVALID_REF',
  INVALID_DIGEST: 'AGENT_BODY_INVALID_DIGEST',
  INVALID_VERSION: 'AGENT_BODY_INVALID_VERSION',
  INVALID_TIMESTAMP: 'AGENT_BODY_INVALID_TIMESTAMP',
  INVALID_RIGHTS: 'AGENT_BODY_INVALID_RIGHTS',
  MISSING_RIGHTS: 'AGENT_BODY_MISSING_RIGHTS',
  INVALID_POLICY: 'AGENT_BODY_INVALID_POLICY',
  INVALID_BODY_VERSION: 'AGENT_BODY_INVALID_BODY_VERSION',
  VERSION_CONFLICT: 'AGENT_BODY_VERSION_CONFLICT',
  TAMPERED: 'AGENT_BODY_TAMPERED',
  INVALID_SUBSTRATE: 'AGENT_BODY_INVALID_SUBSTRATE',
  SUBSTRATE_CREDENTIAL_REJECTED: 'AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED',
  PROVIDER_NAME_REJECTED: 'AGENT_BODY_PROVIDER_NAME_REJECTED',
  SUBSTRATE_ALIAS_FORBIDDEN: 'AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN',
  INVALID_COMPATIBILITY_PROFILE: 'AGENT_BODY_INVALID_COMPATIBILITY_PROFILE',
  INVALID_POSSESSION: 'AGENT_BODY_INVALID_POSSESSION',
  POSSESSION_TAMPERED: 'AGENT_BODY_POSSESSION_TAMPERED',
  ARTIFACT_VERSION_CONFLICT: 'AGENT_BODY_ARTIFACT_VERSION_CONFLICT',
  INVALID_INSTANCE: 'AGENT_BODY_INVALID_INSTANCE',
  INSTANCE_TERMINATED: 'AGENT_BODY_INSTANCE_TERMINATED',
  INVALID_INSTANCE_EVENT: 'AGENT_BODY_INVALID_INSTANCE_EVENT',
  UNSUPPORTED_RECORD_VERSION: 'AGENT_BODY_UNSUPPORTED_RECORD_VERSION',
  UNKNOWN_ERROR: 'AGENT_BODY_UNKNOWN_ERROR',
} as const;

export type AgentBodyErrorCode = (typeof AGENT_BODY_ERROR_CODES)[keyof typeof AGENT_BODY_ERROR_CODES];

const CODE_CATEGORY: Readonly<Record<AgentBodyErrorCode, AgentBodyErrorCategory>> = {
  AGENT_BODY_INVALID_IDENTITY: 'validation',
  AGENT_BODY_INVALID_REF: 'validation',
  AGENT_BODY_INVALID_DIGEST: 'validation',
  AGENT_BODY_INVALID_VERSION: 'validation',
  AGENT_BODY_INVALID_TIMESTAMP: 'validation',
  AGENT_BODY_INVALID_RIGHTS: 'validation',
  AGENT_BODY_MISSING_RIGHTS: 'validation',
  AGENT_BODY_INVALID_POLICY: 'validation',
  AGENT_BODY_INVALID_BODY_VERSION: 'validation',
  AGENT_BODY_VERSION_CONFLICT: 'integrity',
  AGENT_BODY_TAMPERED: 'integrity',
  AGENT_BODY_INVALID_SUBSTRATE: 'validation',
  AGENT_BODY_SUBSTRATE_CREDENTIAL_REJECTED: 'validation',
  AGENT_BODY_PROVIDER_NAME_REJECTED: 'validation',
  AGENT_BODY_SUBSTRATE_ALIAS_FORBIDDEN: 'validation',
  AGENT_BODY_INVALID_COMPATIBILITY_PROFILE: 'validation',
  AGENT_BODY_INVALID_POSSESSION: 'validation',
  AGENT_BODY_POSSESSION_TAMPERED: 'integrity',
  AGENT_BODY_ARTIFACT_VERSION_CONFLICT: 'integrity',
  AGENT_BODY_INVALID_INSTANCE: 'validation',
  AGENT_BODY_INSTANCE_TERMINATED: 'validation',
  AGENT_BODY_INVALID_INSTANCE_EVENT: 'validation',
  AGENT_BODY_UNSUPPORTED_RECORD_VERSION: 'versioning',
  AGENT_BODY_UNKNOWN_ERROR: 'unknown',
};

export function isAgentBodyErrorCode(value: unknown): value is AgentBodyErrorCode {
  return (
    typeof value === 'string' &&
    Object.values(AGENT_BODY_ERROR_CODES).includes(value as AgentBodyErrorCode)
  );
}

export function categoryForAgentBodyCode(code: AgentBodyErrorCode): AgentBodyErrorCategory {
  return CODE_CATEGORY[code];
}

export interface AgentBodyErrorInit {
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
  readonly cause?: unknown;
}

/** Structured (wire-safe) form of an AgentBodyError. */
export interface AgentBodyErrorStruct {
  readonly code: AgentBodyErrorCode;
  readonly category: AgentBodyErrorCategory;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;
}

export class AgentBodyError extends Error {
  readonly code: AgentBodyErrorCode;
  readonly category: AgentBodyErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly correlationId?: CorrelationId;

  constructor(code: AgentBodyErrorCode, init: AgentBodyErrorInit) {
    super(init.message, { cause: init.cause });
    this.name = 'AgentBodyError';
    this.code = code;
    this.category = categoryForAgentBodyCode(code);
    if (init.details !== undefined) this.details = init.details;
    if (init.correlationId !== undefined) this.correlationId = init.correlationId;
  }
}

export function isAgentBodyError(value: unknown): value is AgentBodyError {
  return value instanceof AgentBodyError;
}

export function toAgentBodyErrorStruct(error: AgentBodyError): AgentBodyErrorStruct {
  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(error.details !== undefined ? { details: error.details } : {}),
    ...(error.correlationId !== undefined ? { correlationId: error.correlationId } : {}),
  };
}

/**
 * Parse a structured AgentBodyError. Any malformed input — non-object, missing
 * or unknown code, category/code mismatch, missing message, invalid optional
 * fields — throws `AgentBodyError` with code `AGENT_BODY_UNKNOWN_ERROR`.
 */
export function fromAgentBodyErrorStruct(value: unknown): AgentBodyError {
  const fail = (reason: string): never => {
    throw new AgentBodyError(AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR, {
      message: `malformed structured agent body error: ${reason}`,
      details: { receivedType: typeof value },
    });
  };

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('expected a plain object');
  }
  const record = value as Record<string, unknown>;

  const code = record['code'];
  if (!isAgentBodyErrorCode(code)) {
    return fail(`unknown or missing agent body error code: ${String(code)}`);
  }
  const category = record['category'];
  if (category !== categoryForAgentBodyCode(code)) {
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

  return new AgentBodyError(code, {
    message,
    ...(details !== undefined ? { details: details as Readonly<Record<string, unknown>> } : {}),
    ...(correlationId !== undefined ? { correlationId } : {}),
  });
}

/** Normalize any thrown value into an AgentBodyError. */
export function normalizeToAgentBodyError(error: unknown): AgentBodyError {
  if (isAgentBodyError(error)) return error;
  if (error instanceof Error) {
    return new AgentBodyError(AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR, {
      message: error.message,
      cause: error,
    });
  }
  return new AgentBodyError(AGENT_BODY_ERROR_CODES.UNKNOWN_ERROR, {
    message: String(error),
    cause: error,
  });
}
