/**
 * Envelope wiring for the Arena public/private API (Work Order A025;
 * architecture-lock rules 17, 18, 22; mirrors the sibling protocols'
 * envelope patterns — @arena/certification, @arena/body-registry).
 *
 * This is the FIRST package to exercise @arena/protocol-core's
 * `query` and `response` envelope kinds (the core vocabulary has
 * carried them since A001; no sibling used them before A025). Reads
 * are NOT commands: an idempotency key is REQUIRED on commands only
 * (architecture-lock rule 17) — query and response envelopes carry a
 * NULL idempotency key and are correlated by `correlationId`, which
 * the strict parsers and the client assert match across the pair
 * (ARENA_API_CORRELATION_MISMATCH — fail-closed).
 *
 * Wire messages:
 *   - api-query-request (kind `query`): one closed envelope over every
 *     read path — { kind (closed query vocabulary), params (per-kind),
 *     scope (REQUIRED read scope) };
 *   - api-query-response (kind `response`): { kind (echo), result
 *     (per-kind closed result vocabulary) }.
 *
 * Payload schemas are versioned SchemaRefs in the `api` namespace
 * (arena:schema/api/<name>@<major.minor.patch>) and mirrored by the
 * generated contracts in contracts/api/ (see
 * packages/arena-sdk/scripts/generate-contracts.mjs).
 */

import {
  envelopeDigest,
  makeEnvelope,
  parseEnvelopeAs,
  parseSchemaRef,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, SchemaRef } from '@arena/protocol-core';
import { ARENA_API_ERROR_CODES, ArenaApiError } from './errors.js';
import type { ApiQueryRequest, ApiQueryResponse } from './queries.js';
import { isApiQueryRequest, isApiQueryResponse } from './queries.js';

export const API_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/arena-sdk. Mirrored by the
 * generated contract api-schema-registry.v1.json (parity asserted in
 * contracts.parity.test.ts).
 */
export const API_SCHEMAS = Object.freeze({
  'api/api-error': API_SCHEMA_VERSION,
  'api/api-query-kind': API_SCHEMA_VERSION,
  'api/api-query-request': API_SCHEMA_VERSION,
  'api/api-query-response': API_SCHEMA_VERSION,
  'api/api-read-scope': API_SCHEMA_VERSION,
  'api/api-release-status': API_SCHEMA_VERSION,
  'api/schema-registry': API_SCHEMA_VERSION,
} as const);

export type ApiSchemaName = keyof typeof API_SCHEMAS;

/** Resolve an Arena-API schema name to its SchemaRef. */
export function apiSchemaRef(name: ApiSchemaName): SchemaRef {
  const version = API_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `unknown arena api schema: ${String(name)}`,
      details: { known: Object.keys(API_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names an Arena-API schema at the registered version. */
export function isKnownApiSchema(ref: SchemaRef): boolean {
  const registered = (API_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// api-query-request (envelope kind `query`)
// ---------------------------------------------------------------------------

/** Build the api-query-request envelope (idempotency key is NULL — reads are not commands). */
export function makeApiQueryRequest(
  payload: ApiQueryRequest,
  correlationId: CorrelationId,
): Envelope<ApiQueryRequest> {
  if (!isApiQueryRequest(payload)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY, {
      message: 'api-query-request payload is structurally invalid (closed query kind, per-kind params and a REQUIRED read scope)',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: apiSchemaRef('api/api-query-request'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

/**
 * Parse an api-query-request envelope (strict payload check). The
 * envelope kind MUST be `query` (fail-closed: commands and events are
 * not queries) and the schema MUST be the api-namespace
 * api-query-request schema.
 */
export function parseApiQueryRequest(raw: string): Envelope<ApiQueryRequest> {
  const envelope = parseEnvelopeAs<ApiQueryRequest>(
    raw,
    apiSchemaRef('api/api-query-request'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'api') {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `expected an arena api schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'query') {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `api-query-request must travel in a 'query' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (envelope.idempotencyKey !== null) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY, {
      message: 'api-query-request envelopes carry a NULL idempotency key (idempotency keys are REQUIRED on commands only — architecture-lock rule 17)',
    });
  }
  if (!isApiQueryRequest(envelope.payload)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY, {
      message: 'api-query-request payload is structurally invalid',
    });
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// api-query-response (envelope kind `response`)
// ---------------------------------------------------------------------------

/** Build the api-query-response envelope. */
export function makeApiQueryResponse(
  payload: ApiQueryResponse,
  correlationId: CorrelationId,
): Envelope<ApiQueryResponse> {
  if (!isApiQueryResponse(payload)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
      message: 'api-query-response payload is structurally invalid (echoed closed query kind + per-kind result)',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: apiSchemaRef('api/api-query-response'),
    payload,
    correlationId,
    idempotencyKey: null,
  });
}

/**
 * Parse an api-query-response envelope (strict payload check). The
 * envelope kind MUST be `response`.
 */
export function parseApiQueryResponse(raw: string): Envelope<ApiQueryResponse> {
  const envelope = parseEnvelopeAs<ApiQueryResponse>(
    raw,
    apiSchemaRef('api/api-query-response'),
  );
  if (parseSchemaRef(envelope.schema).namespace !== 'api') {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_SCHEMA_REF, {
      message: `expected an arena api schema, got ${envelope.schema}`,
    });
  }
  if (envelope.kind !== 'response') {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.SCHEMA_MISMATCH, {
      message: `api-query-response must travel in a 'response' envelope, got ${JSON.stringify(envelope.kind)}`,
    });
  }
  if (!isApiQueryResponse(envelope.payload)) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
      message: 'api-query-response payload is structurally invalid',
    });
  }
  return envelope;
}

/**
 * Parse an api-query-response envelope and assert it answers the given
 * request: same correlation id, echoed query kind (fail-closed — a
 * mismatched pair can never be treated as an answer).
 */
export function parseApiQueryResponseFor(
  raw: string,
  request: Envelope<ApiQueryRequest>,
): Envelope<ApiQueryResponse> {
  const response = parseApiQueryResponse(raw);
  if (response.correlationId !== request.correlationId) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.CORRELATION_MISMATCH, {
      message: `response correlation id ${JSON.stringify(String(response.correlationId))} does not match request ${JSON.stringify(String(request.correlationId))}`,
      details: {
        requestCorrelationId: String(request.correlationId),
        responseCorrelationId: String(response.correlationId),
      },
    });
  }
  if (response.payload.kind !== request.payload.kind) {
    throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RESPONSE, {
      message: `response echoes query kind ${JSON.stringify(response.payload.kind)} but the request asked for ${JSON.stringify(request.payload.kind)}`,
      details: { requested: request.payload.kind, echoed: response.payload.kind },
    });
  }
  return response;
}

/** The digest of any Arena-API envelope (wire-integrity check). */
export async function apiEnvelopeDigest(envelope: Envelope<unknown>): Promise<string> {
  return envelopeDigest(envelope);
}
