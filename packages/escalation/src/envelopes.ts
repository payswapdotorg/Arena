/**
 * Envelope wiring for the escalation domain (Work Order C001; mirrors
 * @arena/arena-sdk / @arena/job-protocol envelope patterns).
 *
 * Wire messages (all in the `escalation` SchemaRef namespace,
 * arena:schema/escalation/<name>@<major.minor.patch>):
 *
 *   - create-escalation-command (kind `command`, REQUIRED idempotency
 *     key — lock rule 17): the POST /v1/escalations wire form;
 *   - get-escalation-status-query (kind `query`, NULL idempotency key —
 *     reads are not commands): the GET /v1/escalations/{request_id} wire
 *     form;
 *   - escalation-response (kind `response`): the per-surface result
 *     vocabulary (created | replayed | status | error);
 *   - escalation-webhook-event (kind `event`): the 13-event projection
 *     of the canonical lifecycle.
 *
 * Parsing is STRICT: wrong envelope kind, wrong namespace, unknown
 * payload shape — all fail closed with typed escalation errors.
 */

import {
  makeEnvelope,
  parseEnvelopeAs,
  parseSchemaRef,
  toCorrelationId,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { toIdempotencyKey } from '@arena/protocol-core';
import { ESCALATION_ERROR_CODES, EscalationError } from './errors.js';
import type { EscalationWebhookEvent } from './events.js';
import { isEscalationWebhookEvent } from './events.js';
import type { EscalationRecord } from './lifecycle.js';
import { isEscalationRecord } from './lifecycle.js';
import type { EscalationRequest } from './request.js';
import { isEscalationRequest } from './request.js';

export const ESCALATION_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/escalation. Mirrored by the
 * generated contract escalation-schema-registry.v1.json (parity asserted
 * by contracts.parity.test.ts; drift by drift.test.ts + G9).
 */
export const ESCALATION_SCHEMAS = Object.freeze({
  'escalation/create-escalation-command': ESCALATION_SCHEMA_VERSION,
  'escalation/get-escalation-status-query': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-response': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-webhook-event': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-request': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-error': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-state': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-mode': ESCALATION_SCHEMA_VERSION,
  'escalation/escalation-result': ESCALATION_SCHEMA_VERSION,
  'escalation/schema-registry': ESCALATION_SCHEMA_VERSION,
} as const);

export type EscalationSchemaName = keyof typeof ESCALATION_SCHEMAS;

/** Resolve an escalation schema name to its SchemaRef. */
export function escalationSchemaRef(name: EscalationSchemaName): SchemaRef {
  const version = ESCALATION_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `unknown escalation schema: ${String(name)}`,
      details: { known: Object.keys(ESCALATION_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an escalation schema at the registered version. */
export function isKnownEscalationSchema(ref: SchemaRef): boolean {
  const registered = (ESCALATION_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// create-escalation-command (POST /v1/escalations)
// ---------------------------------------------------------------------------

export function makeCreateEscalationCommand(
  payload: EscalationRequest,
  correlationId: CorrelationId,
  idempotencyKey: IdempotencyKey,
): Envelope<EscalationRequest> {
  if (!isEscalationRequest(payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'create-escalation-command payload is not a structurally valid EscalationRequest',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: escalationSchemaRef('escalation/create-escalation-command'),
    payload,
    correlationId,
    idempotencyKey,
  });
}

/** Parse a create-escalation-command envelope (strict). */
export function parseCreateEscalationCommand(raw: string): Envelope<EscalationRequest> {
  const envelope = parseEnvelopeAs<EscalationRequest>(
    raw,
    escalationSchemaRef('escalation/create-escalation-command'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'escalation') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an escalation schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'command') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `create-escalation-command must travel in a 'command' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (envelope.idempotencyKey === null) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'create-escalation-command requires a non-null idempotency key (architecture-lock rule 17)',
    });
  }
  if (!isEscalationRequest(envelope.payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'create-escalation-command payload is not a structurally valid EscalationRequest',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// get-escalation-status-query (GET /v1/escalations/{request_id})
// ---------------------------------------------------------------------------

export interface GetEscalationStatusQuery {
  readonly queryVersion: 1;
  readonly requestId: string;
  readonly tenantId: string;
}

export function isGetEscalationStatusQuery(value: unknown): value is GetEscalationStatusQuery {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['queryVersion'] === 1 &&
    typeof candidate['requestId'] === 'string' &&
    candidate['requestId'].length > 0 &&
    typeof candidate['tenantId'] === 'string' &&
    candidate['tenantId'].length > 0
  );
}

export function makeGetEscalationStatusQuery(
  payload: GetEscalationStatusQuery,
  correlationId: CorrelationId,
): Envelope<GetEscalationStatusQuery> {
  if (!isGetEscalationStatusQuery(payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-escalation-status-query payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: escalationSchemaRef('escalation/get-escalation-status-query'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

export function parseGetEscalationStatusQuery(raw: string): Envelope<GetEscalationStatusQuery> {
  const envelope = parseEnvelopeAs<GetEscalationStatusQuery>(
    raw,
    escalationSchemaRef('escalation/get-escalation-status-query'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'escalation') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an escalation schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'query') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `get-escalation-status-query must travel in a 'query' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (envelope.idempotencyKey !== null) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-escalation-status-query envelopes carry a NULL idempotency key (reads are not commands)',
    });
  }
  if (!isGetEscalationStatusQuery(envelope.payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'get-escalation-status-query payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// escalation-response (the per-surface result vocabulary)
// ---------------------------------------------------------------------------

/** Closed result vocabulary of the escalation API surface. */
export const ESCALATION_RESPONSE_KINDS = Object.freeze([
  'escalation-created',
  'escalation-replayed',
  'escalation-status',
] as const);
export type EscalationResponseKind = (typeof ESCALATION_RESPONSE_KINDS)[number];

export type EscalationResponse =
  | {
      readonly responseVersion: 1;
      readonly kind: 'escalation-created' | 'escalation-replayed';
      readonly requestId: string;
      readonly correlationId: string;
      readonly duplicate: boolean;
    }
  | {
      readonly responseVersion: 1;
      readonly kind: 'escalation-status';
      readonly record: EscalationRecord;
    };

export function isEscalationResponse(value: unknown): value is EscalationResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['responseVersion'] !== 1) return false;
  if (candidate['kind'] === 'escalation-created' || candidate['kind'] === 'escalation-replayed') {
    return typeof candidate['requestId'] === 'string' && typeof candidate['duplicate'] === 'boolean';
  }
  if (candidate['kind'] === 'escalation-status') {
    return isEscalationRecord(candidate['record']);
  }
  return false;
}

export function makeEscalationResponse(
  payload: EscalationResponse,
  correlationId: CorrelationId,
): Envelope<EscalationResponse> {
  if (!isEscalationResponse(payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'escalation-response payload is structurally invalid (closed kind vocabulary + per-kind fields)',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: escalationSchemaRef('escalation/escalation-response'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

export function parseEscalationResponse(raw: string): Envelope<EscalationResponse> {
  const envelope = parseEnvelopeAs<EscalationResponse>(
    raw,
    escalationSchemaRef('escalation/escalation-response'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'escalation') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an escalation schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'response') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `escalation-response must travel in a 'response' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (!isEscalationResponse(envelope.payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: 'escalation-response payload is structurally invalid',
    });
  }
  return envelope;
}

/** Parse a response and assert it answers the given query (same correlation id). */
export function parseEscalationResponseFor(
  raw: string,
  request: Envelope<GetEscalationStatusQuery>,
): Envelope<EscalationResponse> {
  const response = parseEscalationResponse(raw);
  if (response.correlationId !== request.correlationId) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
      message: `response correlation id ${JSON.stringify(String(response.correlationId))} does not match request ${JSON.stringify(String(request.correlationId))}`,
    });
  }
  return response;
}

// ---------------------------------------------------------------------------
// escalation-webhook-event (kind `event`)
// ---------------------------------------------------------------------------

export function makeEscalationWebhookEventEnvelope(
  event: EscalationWebhookEvent,
  correlationId: CorrelationId,
): Envelope<EscalationWebhookEvent> {
  if (!isEscalationWebhookEvent(event)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
      message: 'escalation-webhook-event payload is structurally invalid',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: escalationSchemaRef('escalation/escalation-webhook-event'),
    payload: event,
    correlationId,
    idempotencyKey: toIdempotencyKey(event.eventId),
  });
}

export function parseEscalationWebhookEventEnvelope(raw: string): Envelope<EscalationWebhookEvent> {
  const envelope = parseEnvelopeAs<EscalationWebhookEvent>(
    raw,
    escalationSchemaRef('escalation/escalation-webhook-event'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'escalation') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `expected an escalation schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'event') {
    throw new EscalationError(ESCALATION_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `escalation-webhook-event must travel in an 'event' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (!isEscalationWebhookEvent(envelope.payload)) {
    throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
      message: 'escalation-webhook-event payload is structurally invalid',
    });
  }
  return envelope;
}

/** Convenience re-export for wire correlation ids. */
export { toCorrelationId };
