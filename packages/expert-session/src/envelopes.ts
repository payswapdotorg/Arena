/**
 * Envelope wiring for the expert-session domain (Work Order C006;
 * mirrors @arena/escalation's envelope patterns).
 *
 * Wire messages (all in the `expert-session` SchemaRef namespace,
 * arena:schema/expert-session/<name>@<major.minor.patch>):
 *
 *   - open-expert-session-command (kind `command`, REQUIRED idempotency
 *     key — lock rule 17): the capsule derivation request;
 *   - submit-expert-session-command (kind `command`, REQUIRED
 *     idempotency key): the EES1.0 session completion contract;
 *   - get-expert-session-query (kind `query`, NULL idempotency key —
 *     reads are not commands): session status/stream polling;
 *   - expert-session-response (kind `response`): the closed result
 *     vocabulary (session-opened | session-active | session-status |
 *     session-submitted | error).
 *
 * Parsing is STRICT: wrong envelope kind, wrong namespace, unknown
 * payload shape — all fail closed with typed expert-session errors.
 */

import { makeEnvelope, parseEnvelopeAs, parseSchemaRef, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { EXPERT_SESSION_ERROR_CODES, ExpertSessionError } from './errors.js';
import type { ComposePrivacyBarrierInput } from './barrier.js';
import type { ExecutionCapsuleSource } from './capsule.js';
import type { ExpertSessionMode } from './modes.js';
import { isExpertSessionMode } from './modes.js';
import type { ExpertSessionSubmission } from './submission.js';
import { isExpertSessionSubmission } from './submission.js';
import type { PlainJsonValue } from './shared.js';
import { isPlainJsonValue } from './shared.js';

export const EXPERT_SESSION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/expert-session.
 */
export const EXPERT_SESSION_SCHEMAS = Object.freeze({
  'expert-session/open-expert-session-command': EXPERT_SESSION_SCHEMA_VERSION,
  'expert-session/submit-expert-session-command': EXPERT_SESSION_SCHEMA_VERSION,
  'expert-session/get-expert-session-query': EXPERT_SESSION_SCHEMA_VERSION,
  'expert-session/expert-session-response': EXPERT_SESSION_SCHEMA_VERSION,
  'expert-session/expert-session-capsule': EXPERT_SESSION_SCHEMA_VERSION,
  'expert-session/expert-session-error': EXPERT_SESSION_SCHEMA_VERSION,
} as const);

export type ExpertSessionSchemaName = keyof typeof EXPERT_SESSION_SCHEMAS;

/** Resolve an expert-session schema name to its SchemaRef. */
export function expertSessionSchemaRef(name: ExpertSessionSchemaName): SchemaRef {
  const version = EXPERT_SESSION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `unknown expert-session schema: ${String(name)}`,
      details: { known: Object.keys(EXPERT_SESSION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

// ---------------------------------------------------------------------------
// open-expert-session-command
// ---------------------------------------------------------------------------

/** Wire payload of the open command (the capsule derivation request). */
export interface OpenExpertSessionCommand {
  readonly commandVersion: 1;
  readonly escalationRef: { readonly requestId: string; readonly tenantId: string };
  readonly sessionMode: ExpertSessionMode;
  readonly allowedModes: readonly ExpertSessionMode[];
  readonly barrier: ComposePrivacyBarrierInput;
  readonly source: ExecutionCapsuleSource;
  readonly now: string;
  readonly expiresAt: string;
  readonly sessionId?: string;
}

export function isOpenExpertSessionCommand(value: unknown): value is OpenExpertSessionCommand {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const escalationRef = candidate['escalationRef'] as Record<string, unknown> | undefined;
  return (
    candidate['commandVersion'] === 1 &&
    typeof escalationRef === 'object' &&
    escalationRef !== null &&
    typeof escalationRef['requestId'] === 'string' &&
    typeof escalationRef['tenantId'] === 'string' &&
    isExpertSessionMode(candidate['sessionMode']) &&
    Array.isArray(candidate['allowedModes']) &&
    (candidate['allowedModes'] as readonly unknown[]).every((mode) => isExpertSessionMode(mode)) &&
    typeof candidate['barrier'] === 'object' &&
    candidate['barrier'] !== null &&
    typeof candidate['source'] === 'object' &&
    candidate['source'] !== null &&
    typeof candidate['now'] === 'string' &&
    typeof candidate['expiresAt'] === 'string'
  );
}

export function makeOpenExpertSessionCommand(
  payload: OpenExpertSessionCommand,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<OpenExpertSessionCommand> {
  if (!isOpenExpertSessionCommand(payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'open-expert-session-command payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: expertSessionSchemaRef('expert-session/open-expert-session-command'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

export function parseOpenExpertSessionCommand(raw: string): Envelope<OpenExpertSessionCommand> {
  const envelope = parseEnvelopeAs<OpenExpertSessionCommand>(
    raw,
    expertSessionSchemaRef('expert-session/open-expert-session-command'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'expert-session') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an expert-session schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'command') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `open-expert-session-command must travel in a 'command' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (envelope.idempotencyKey === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'command envelopes require a non-null idempotencyKey (lock rule 17)',
    });
  }
  if (!isOpenExpertSessionCommand(envelope.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'open-expert-session-command payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// submit-expert-session-command
// ---------------------------------------------------------------------------

export function makeSubmitExpertSessionCommand(
  payload: ExpertSessionSubmission,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<ExpertSessionSubmission> {
  if (!isExpertSessionSubmission(payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'submit-expert-session-command payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: expertSessionSchemaRef('expert-session/submit-expert-session-command'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

export function parseSubmitExpertSessionCommand(raw: string): Envelope<ExpertSessionSubmission> {
  const envelope = parseEnvelopeAs<ExpertSessionSubmission>(
    raw,
    expertSessionSchemaRef('expert-session/submit-expert-session-command'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'expert-session') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an expert-session schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'command' || envelope.idempotencyKey === null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: 'submit-expert-session-command must travel in a command envelope with an idempotencyKey',
    });
  }
  if (!isExpertSessionSubmission(envelope.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_SUBMISSION, {
      message: 'submit-expert-session-command payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// get-expert-session-query
// ---------------------------------------------------------------------------

export interface GetExpertSessionQuery {
  readonly queryVersion: 1;
  readonly sessionId: string;
  readonly tenantId: string;
}

export function isGetExpertSessionQuery(value: unknown): value is GetExpertSessionQuery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['queryVersion'] === 1 &&
    typeof candidate['sessionId'] === 'string' &&
    candidate['sessionId'].length > 0 &&
    typeof candidate['tenantId'] === 'string' &&
    candidate['tenantId'].length > 0
  );
}

export function makeGetExpertSessionQuery(
  payload: GetExpertSessionQuery,
  correlationId: CorrelationId,
): Envelope<GetExpertSessionQuery> {
  if (!isGetExpertSessionQuery(payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-expert-session-query payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: expertSessionSchemaRef('expert-session/get-expert-session-query'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

export function parseGetExpertSessionQuery(raw: string): Envelope<GetExpertSessionQuery> {
  const envelope = parseEnvelopeAs<GetExpertSessionQuery>(
    raw,
    expertSessionSchemaRef('expert-session/get-expert-session-query'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'expert-session') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an expert-session schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'query') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `get-expert-session-query must travel in a 'query' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (envelope.idempotencyKey !== null) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-expert-session-query envelopes carry a NULL idempotency key (reads are not commands)',
    });
  }
  if (!isGetExpertSessionQuery(envelope.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-expert-session-query payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// expert-session-response
// ---------------------------------------------------------------------------

export const EXPERT_SESSION_RESPONSE_KINDS = Object.freeze([
  'session-opened',
  'session-active',
  'session-status',
  'session-submitted',
] as const);
export type ExpertSessionResponseKind = (typeof EXPERT_SESSION_RESPONSE_KINDS)[number];

export interface ExpertSessionResponse {
  readonly responseVersion: 1;
  readonly kind: ExpertSessionResponseKind;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly state: string;
  readonly capsuleDigest: string;
  readonly eventCount: number;
  readonly detail?: PlainJsonValue;
}

export function isExpertSessionResponse(value: unknown): value is ExpertSessionResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['responseVersion'] === 1 &&
    typeof candidate['kind'] === 'string' &&
    (EXPERT_SESSION_RESPONSE_KINDS as readonly string[]).includes(candidate['kind']) &&
    typeof candidate['sessionId'] === 'string' &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['state'] === 'string' &&
    typeof candidate['capsuleDigest'] === 'string' &&
    typeof candidate['eventCount'] === 'number' &&
    (candidate['detail'] === undefined || isPlainJsonValue(candidate['detail']))
  );
}

export function makeExpertSessionResponse(
  payload: ExpertSessionResponse,
  correlationId: CorrelationId,
): Envelope<ExpertSessionResponse> {
  if (!isExpertSessionResponse(payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'expert-session-response payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: expertSessionSchemaRef('expert-session/expert-session-response'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

export function parseExpertSessionResponse(raw: string): Envelope<ExpertSessionResponse> {
  const envelope = parseEnvelopeAs<ExpertSessionResponse>(
    raw,
    expertSessionSchemaRef('expert-session/expert-session-response'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'expert-session') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an expert-session schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'response') {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expert-session-response must travel in a 'response' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (!isExpertSessionResponse(envelope.payload)) {
    throw new ExpertSessionError(EXPERT_SESSION_ERROR_CODES.INVALID_REQUEST, {
      message: 'expert-session-response payload is structurally invalid',
    });
  }
  return envelope;
}

/** Normalize a raw idempotency key string (strict — used by service wiring). */
export function toSessionIdempotencyKey(value: string): IdempotencyKey {
  return toIdempotencyKey(value);
}
