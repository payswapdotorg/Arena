/**
 * Wire envelope conventions for @arena/body-marketplace-service (Work
 * Order C014) — the A015-family envelope discipline over
 * @arena/protocol-core: command envelopes REQUIRE a non-null
 * idempotency key (lock rule 17); event/query-response envelopes carry
 * the SAME correlation id and a NULL idempotency key. Every envelope
 * payload is strict-parsed against the typed shapes (fail closed on
 * unknown fields — INVALID_ENVELOPE).
 */

import {
  makeEnvelope,
  parseEnvelope,
  serializeEnvelope,
  formatSchemaRef,
  toCorrelationId,
  toIdempotencyKey,
} from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';

import {
  BODY_MARKETPLACE_ERROR_CODES,
  BodyMarketplaceError,
  normalizeToBodyMarketplaceError,
} from './errors.js';
import type { ListingState, ListingPermittedUse } from './fabric.js';
import {
  LISTING_PERMITTED_USES,
  LISTING_STATES,
} from './fabric.js';
import type { PretrainingRequestInput } from './pretraining.js';
import {
  PRETRAINING_INPUT_KINDS,
  TRAINING_USE_RIGHTS,
} from './pretraining.js';
import {
  isBodyMarketplaceId,
  isPlainObject,
  isTenant,
} from './shared.js';

/** The schema namespace this surface owns. */
const NS = 'body-marketplace';

/** Version of this surface's wire schema set. */
export const BODY_MARKETPLACE_SCHEMA_VERSION = '1.0.0' as const;

/** The schema registry (in-package SchemaRef data; no contracts surface). */
export const BODY_MARKETPLACE_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
  'request-pretraining-command': formatSchemaRef({
    namespace: NS,
    name: 'request-pretraining-command',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'pretraining-run-event': formatSchemaRef({
    namespace: NS,
    name: 'pretraining-run-event',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'create-listing-command': formatSchemaRef({
    namespace: NS,
    name: 'create-listing-command',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'listing-transition-command': formatSchemaRef({
    namespace: NS,
    name: 'listing-transition-command',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'listing-transitioned-event': formatSchemaRef({
    namespace: NS,
    name: 'listing-transitioned-event',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'grant-listing-access-command': formatSchemaRef({
    namespace: NS,
    name: 'grant-listing-access-command',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'listing-access-granted-event': formatSchemaRef({
    namespace: NS,
    name: 'listing-access-granted-event',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'body-marketplace-query-request': formatSchemaRef({
    namespace: NS,
    name: 'body-marketplace-query-request',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
  'body-marketplace-query-response': formatSchemaRef({
    namespace: NS,
    name: 'body-marketplace-query-response',
    version: BODY_MARKETPLACE_SCHEMA_VERSION,
  }),
});

function schema(name: keyof typeof BODY_MARKETPLACE_SCHEMAS): string {
  return BODY_MARKETPLACE_SCHEMAS[name] as string;
}

function expectString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `envelope payload field ${field} must be a non-empty string`,
    });
  }
  return value;
}

function expectOptionalString(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return expectString(value, field);
}

function expectPrincipal(value: unknown, field: string): { type: string; tenant: string; principalId: string } {
  if (
    !isPlainObject(value) ||
    typeof value['type'] !== 'string' ||
    !isTenant(value['tenant']) ||
    typeof value['principalId'] !== 'string'
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `envelope payload field ${field} must be a principal ref`,
    });
  }
  return { type: value['type'], tenant: value['tenant'], principalId: value['principalId'] };
}

// ---------------------------------------------------------------------------
// Request-pretraining command
// ---------------------------------------------------------------------------

/** The request-pretraining-command payload (wire form). */
export interface RequestPretrainingCommandPayload {
  readonly runId: string;
  readonly request: PretrainingRequestInput;
  readonly composition: Record<string, unknown>;
  readonly baseBodyVersionRef: { tenant: string; name: string; version: string; digest: string } | null;
  readonly releaseChannel: string;
}

export function makeRequestPretrainingCommand(
  payload: RequestPretrainingCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<RequestPretrainingCommandPayload> {
  return makeEnvelope({
    kind: 'command',
    schema: schema('request-pretraining-command'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: toIdempotencyKey(idempotencyKey),
    payload,
  });
}

export function parseRequestPretrainingCommand(
  raw: string,
): Envelope<RequestPretrainingCommandPayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (envelope.schema !== schema('request-pretraining-command') || envelope.kind !== 'command') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a request-pretraining-command envelope, got schema=${envelope.schema}`,
    });
  }
  if (envelope.idempotencyKey === null) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'command envelopes require a non-null idempotency key (lock rule 17)',
    });
  }
  const payload = envelope.payload;
  if (!isPlainObject(payload)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'request-pretraining-command payload must be a plain object',
    });
  }
  if (!isBodyMarketplaceId(payload['runId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'request-pretraining-command requires a marketplace-id runId',
    });
  }
  if (!isPlainObject(payload['request']) || !isPlainObject(payload['composition'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'request-pretraining-command requires request and composition objects',
    });
  }
  const base = payload['baseBodyVersionRef'];
  if (base !== null && base !== undefined) {
    if (!isPlainObject(base)) {
      throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
        message: 'envelope payload field baseBodyVersionRef must be an object ref',
      });
    }
    expectString(base['tenant'], 'baseBodyVersionRef.tenant');
    expectString(base['name'], 'baseBodyVersionRef.name');
    expectString(base['version'], 'baseBodyVersionRef.version');
    expectString(base['digest'], 'baseBodyVersionRef.digest');
  }
  return envelope as Envelope<RequestPretrainingCommandPayload>;
}

/** The pretraining-run-event payload. */
export interface PretrainingRunEventPayload {
  readonly runId: string;
  readonly outcome: 'proposed' | 'blocked';
  readonly bodyVersionDigest: string | null;
  readonly releaseDigest: string | null;
}

export function makePretrainingRunEvent(
  payload: PretrainingRunEventPayload,
  correlationId: string,
): Envelope<PretrainingRunEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schema('pretraining-run-event'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Create-listing command
// ---------------------------------------------------------------------------

/** The create-listing-command payload (wire form). */
export interface CreateListingCommandPayload {
  readonly listingId: string;
  readonly tenantId: string;
  readonly releaseDigest: string;
  readonly title: string;
  readonly summary: string;
  readonly capabilityEvidenceRefs: readonly string[];
  readonly pretrainingRunId: string | null;
  readonly rights: Record<string, unknown> | null;
  readonly substrateCompatibility: Record<string, unknown> | null;
  readonly pricing: { amountMinorUnits: number; currency: string; model: string } | null;
  readonly createdBy: { type: string; tenant: string; principalId: string };
  readonly createdAt: string;
}

export function makeCreateListingCommand(
  payload: CreateListingCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<CreateListingCommandPayload> {
  return makeEnvelope({
    kind: 'command',
    schema: schema('create-listing-command'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: toIdempotencyKey(idempotencyKey),
    payload,
  });
}

export function parseCreateListingCommand(raw: string): Envelope<CreateListingCommandPayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (envelope.schema !== schema('create-listing-command') || envelope.kind !== 'command') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a create-listing-command envelope, got schema=${envelope.schema}`,
    });
  }
  const payload = envelope.payload;
  if (!isPlainObject(payload)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'create-listing-command payload must be a plain object',
    });
  }
  if (!isBodyMarketplaceId(payload['listingId']) || !isTenant(payload['tenantId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'create-listing-command requires a listingId and a tenantId',
    });
  }
  expectString(payload['releaseDigest'], 'releaseDigest');
  expectString(payload['title'], 'title');
  expectString(payload['summary'], 'summary');
  if (!Array.isArray(payload['capabilityEvidenceRefs'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'create-listing-command requires capabilityEvidenceRefs',
    });
  }
  expectPrincipal(payload['createdBy'], 'createdBy');
  expectString(payload['createdAt'], 'createdAt');
  return envelope as Envelope<CreateListingCommandPayload>;
}

// ---------------------------------------------------------------------------
// Listing-transition command
// ---------------------------------------------------------------------------

/** The listing-transition-command payload (wire form). */
export interface ListingTransitionCommandPayload {
  readonly listingId: string;
  readonly tenantId: string;
  readonly to: ListingState;
  readonly reason: string;
  readonly actor: { type: string; tenant: string; principalId: string };
  readonly at: string;
  readonly releasePublication?: {
    publisher: { type: string; tenant: string; principalId: string };
    rights: unknown;
    publishedAt: string;
  };
}

export function makeListingTransitionCommand(
  payload: ListingTransitionCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<ListingTransitionCommandPayload> {
  if (!(LISTING_STATES as readonly string[]).includes(payload.to)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `listing transition target must be one of ${JSON.stringify([...LISTING_STATES])}`,
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: schema('listing-transition-command'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: toIdempotencyKey(idempotencyKey),
    payload,
  });
}

export function parseListingTransitionCommand(
  raw: string,
): Envelope<ListingTransitionCommandPayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (envelope.schema !== schema('listing-transition-command') || envelope.kind !== 'command') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a listing-transition-command envelope, got schema=${envelope.schema}`,
    });
  }
  const payload = envelope.payload;
  if (!isPlainObject(payload)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'listing-transition-command payload must be a plain object',
    });
  }
  if (!(LISTING_STATES as readonly string[]).includes(payload['to'] as string)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `listing transition target must be one of ${JSON.stringify([...LISTING_STATES])}`,
    });
  }
  if (!isBodyMarketplaceId(payload['listingId']) || !isTenant(payload['tenantId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'listing-transition-command requires a listingId and a tenantId',
    });
  }
  expectString(payload['reason'], 'reason');
  expectPrincipal(payload['actor'], 'actor');
  expectString(payload['at'], 'at');
  return envelope as Envelope<ListingTransitionCommandPayload>;
}

/** The listing-transitioned-event payload. */
export interface ListingTransitionedEventPayload {
  readonly listingId: string;
  readonly from: ListingState;
  readonly to: ListingState;
  readonly version: number;
  readonly reason: string;
}

export function makeListingTransitionedEvent(
  payload: ListingTransitionedEventPayload,
  correlationId: string,
): Envelope<ListingTransitionedEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schema('listing-transitioned-event'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Grant-listing-access command
// ---------------------------------------------------------------------------

/** The grant-listing-access-command payload (wire form). */
export interface GrantListingAccessCommandPayload {
  readonly grantId: string;
  readonly listingId: string;
  readonly tenantId: string;
  readonly grantee: { type: string; tenant: string; principalId: string };
  readonly permittedUse: ListingPermittedUse;
  readonly expiresAt: string | null;
  readonly grantedBy: { type: string; tenant: string; principalId: string };
  readonly grantedAt: string;
}

export function makeGrantListingAccessCommand(
  payload: GrantListingAccessCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<GrantListingAccessCommandPayload> {
  if (!(LISTING_PERMITTED_USES as readonly string[]).includes(payload.permittedUse)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `permittedUse must be one of ${JSON.stringify([...LISTING_PERMITTED_USES])}`,
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: schema('grant-listing-access-command'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: toIdempotencyKey(idempotencyKey),
    payload,
  });
}

export function parseGrantListingAccessCommand(
  raw: string,
): Envelope<GrantListingAccessCommandPayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (envelope.schema !== schema('grant-listing-access-command') || envelope.kind !== 'command') {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a grant-listing-access-command envelope, got schema=${envelope.schema}`,
    });
  }
  const payload = envelope.payload;
  if (!isPlainObject(payload)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'grant-listing-access-command payload must be a plain object',
    });
  }
  if (!isBodyMarketplaceId(payload['grantId']) || !isBodyMarketplaceId(payload['listingId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'grant-listing-access-command requires a grantId and a listingId',
    });
  }
  if (!isTenant(payload['tenantId'])) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'grant-listing-access-command requires a tenantId',
    });
  }
  if (!(LISTING_PERMITTED_USES as readonly string[]).includes(payload['permittedUse'] as string)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `permittedUse must be one of ${JSON.stringify([...LISTING_PERMITTED_USES])}`,
    });
  }
  expectPrincipal(payload['grantee'], 'grantee');
  expectPrincipal(payload['grantedBy'], 'grantedBy');
  expectString(payload['grantedAt'], 'grantedAt');
  expectOptionalString(payload['expiresAt'], 'expiresAt');
  return envelope as Envelope<GrantListingAccessCommandPayload>;
}

/** The listing-access-granted-event payload. */
export interface ListingAccessGrantedEventPayload {
  readonly grantId: string;
  readonly listingId: string;
  readonly permittedUse: ListingPermittedUse;
}

export function makeListingAccessGrantedEvent(
  payload: ListingAccessGrantedEventPayload,
  correlationId: string,
): Envelope<ListingAccessGrantedEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: schema('listing-access-granted-event'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

// ---------------------------------------------------------------------------
// Query request / response (reads are not commands)
// ---------------------------------------------------------------------------

/** The closed query-kind vocabulary. */
export const BODY_MARKETPLACE_QUERY_KINDS = Object.freeze([
  'list-listings',
  'get-listing',
  'certification-posture',
  'certified-badge',
  'get-pretraining-run',
] as const);
export type BodyMarketplaceQueryKind = (typeof BODY_MARKETPLACE_QUERY_KINDS)[number];

/** The query-request payload. */
export interface BodyMarketplaceQueryRequestPayload {
  readonly kind: BodyMarketplaceQueryKind;
  readonly params: Record<string, unknown>;
  readonly scope: { readonly tenant: string };
}

/** The query-response payload. */
export interface BodyMarketplaceQueryResponsePayload {
  readonly kind: BodyMarketplaceQueryKind;
  readonly result: unknown;
}

export function makeBodyMarketplaceQueryRequest(
  payload: BodyMarketplaceQueryRequestPayload,
  correlationId: string,
): Envelope<BodyMarketplaceQueryRequestPayload> {
  if (!(BODY_MARKETPLACE_QUERY_KINDS as readonly string[]).includes(payload.kind)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `query kind must be one of ${JSON.stringify([...BODY_MARKETPLACE_QUERY_KINDS])}`,
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: schema('body-marketplace-query-request'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

export function parseBodyMarketplaceQueryRequest(
  raw: string,
): Envelope<BodyMarketplaceQueryRequestPayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (
    envelope.schema !== schema('body-marketplace-query-request') ||
    envelope.kind !== 'query'
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a body-marketplace-query-request envelope, got schema=${envelope.schema}`,
    });
  }
  const payload = envelope.payload;
  if (
    !isPlainObject(payload) ||
    !(BODY_MARKETPLACE_QUERY_KINDS as readonly string[]).includes(payload['kind'] as string) ||
    !isPlainObject(payload['params']) ||
    !isPlainObject(payload['scope']) ||
    !isTenant((payload['scope'] as Record<string, unknown>)['tenant'])
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'body-marketplace query payload is malformed',
    });
  }
  return envelope as Envelope<BodyMarketplaceQueryRequestPayload>;
}

export function makeBodyMarketplaceQueryResponse(
  payload: BodyMarketplaceQueryResponsePayload,
  correlationId: string,
): Envelope<BodyMarketplaceQueryResponsePayload> {
  return makeEnvelope({
    kind: 'response',
    schema: schema('body-marketplace-query-response'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

export function parseBodyMarketplaceQueryResponse(
  raw: string,
): Envelope<BodyMarketplaceQueryResponsePayload> {
  let envelope: Envelope<unknown>;
  try {
    envelope = parseEnvelope(raw);
  } catch (error) {
    throw normalizeToBodyMarketplaceError(error);
  }
  if (
    envelope.schema !== schema('body-marketplace-query-response') ||
    envelope.kind !== 'response'
  ) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: `expected a body-marketplace-query-response envelope, got schema=${envelope.schema}`,
    });
  }
  const payload = envelope.payload;
  if (!isPlainObject(payload) || !(BODY_MARKETPLACE_QUERY_KINDS as readonly string[]).includes(payload['kind'] as string)) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'body-marketplace query response payload is malformed',
    });
  }
  return envelope as Envelope<BodyMarketplaceQueryResponsePayload>;
}

/** FAIL-CLOSED pairing guard: the response must answer THIS request. */
export function parseBodyMarketplaceQueryResponseFor(
  raw: string,
  request: Envelope<BodyMarketplaceQueryRequestPayload>,
): Envelope<BodyMarketplaceQueryResponsePayload> {
  const response = parseBodyMarketplaceQueryResponse(raw);
  if (response.correlationId !== request.correlationId) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'query response correlation id does not match the request (fail-closed pairing)',
    });
  }
  if (response.payload.kind !== request.payload.kind) {
    throw new BodyMarketplaceError(BODY_MARKETPLACE_ERROR_CODES.INVALID_ENVELOPE, {
      message: 'query response kind does not match the request kind (fail-closed pairing)',
    });
  }
  return response;
}

/** Serialize an envelope canonically. */
export function serialize(envelope: Envelope<unknown>): string {
  return serializeEnvelope(envelope);
}

/** Vocabularies re-exported for envelope-side strict checks. */
export const ENVELOPE_PRETRAINING_INPUT_KINDS = PRETRAINING_INPUT_KINDS;
export const ENVELOPE_TRAINING_USE_RIGHTS = TRAINING_USE_RIGHTS;
