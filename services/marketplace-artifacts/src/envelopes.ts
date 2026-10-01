/**
 * Marketplace envelope wiring (Work Order A032): the command / event /
 * query wire surface over the fabric, mirroring the A025/A034 envelope
 * discipline:
 *
 *   - commands: envelope kind `command`, REQUIRED idempotency key,
 *     schema namespace `marketplace-artifacts`;
 *   - events: envelope kind `event`, NULL idempotency key, SAME
 *     correlation id as the command that caused them;
 *   - queries: envelope kind `query`, NULL idempotency key (reads are
 *     not commands); responses: kind `response`, echoed correlation id.
 *
 * Parsers are STRICT: kind checks, schema pinning and payload-shape
 * checks run before any fabric dispatch; the parsed envelope is
 * returned as-is (wire fidelity — never re-minted).
 */

import {
  makeEnvelope,
  parseEnvelopeAs,
  serializeEnvelope,
  toCorrelationId,
  toIdempotencyKey,
  formatSchemaRef,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import type { MarketplaceEvidenceRef } from './gate.js';
import { toMarketplaceEvidenceRef } from './gate.js';
import type { MarketplaceQueryRequest, MarketplaceQueryResponse } from './queries.js';
import { MARKETPLACE_QUERY_KINDS } from './queries.js';
import { isPlainObject, isMarketplaceText, isMarketplaceTimestamp } from './shared.js';

export const MARKETPLACE_SCHEMA_VERSION = '1.0.0' as const;

const NS = 'marketplace-artifacts';

/** Closed schema registry (string form per SchemaRef). */
export const MARKETPLACE_SCHEMAS: Readonly<Record<string, string>> = Object.freeze({
  'register-offer-command': formatSchemaRef({ namespace: NS, name: 'register-offer-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'supersede-offer-command': formatSchemaRef({ namespace: NS, name: 'supersede-offer-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'retire-offer-command': formatSchemaRef({ namespace: NS, name: 'retire-offer-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'grant-access-command': formatSchemaRef({ namespace: NS, name: 'grant-access-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'revoke-grant-command': formatSchemaRef({ namespace: NS, name: 'revoke-grant-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'submit-review-command': formatSchemaRef({ namespace: NS, name: 'submit-review-command', version: MARKETPLACE_SCHEMA_VERSION }),
  'offer-registered-event': formatSchemaRef({ namespace: NS, name: 'offer-registered-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'offer-superseded-event': formatSchemaRef({ namespace: NS, name: 'offer-superseded-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'offer-retired-event': formatSchemaRef({ namespace: NS, name: 'offer-retired-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'access-granted-event': formatSchemaRef({ namespace: NS, name: 'access-granted-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'grant-revoked-event': formatSchemaRef({ namespace: NS, name: 'grant-revoked-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'review-submitted-event': formatSchemaRef({ namespace: NS, name: 'review-submitted-event', version: MARKETPLACE_SCHEMA_VERSION }),
  'marketplace-query-request': formatSchemaRef({ namespace: NS, name: 'marketplace-query-request', version: MARKETPLACE_SCHEMA_VERSION }),
  'marketplace-query-response': formatSchemaRef({ namespace: NS, name: 'marketplace-query-response', version: MARKETPLACE_SCHEMA_VERSION }),
  'schema-registry': formatSchemaRef({ namespace: NS, name: 'schema-registry', version: MARKETPLACE_SCHEMA_VERSION }),
});

// ---------------------------------------------------------------------------
// Command payloads
// ---------------------------------------------------------------------------

/** Candidate offer content (correlation/idempotency live on the envelope). */
export interface OfferCandidateWire {
  readonly kind: 'offer-registration' | 'offer-supersession' | 'offer-retirement';
  readonly offerId: string;
  readonly artifactKind: string;
  readonly artifact?: { namespace: string; name: string; version: string; digest: string } | null;
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly publisher?: { type: string; tenant: string; principalId: string } | null;
  readonly rights?: unknown;
  readonly visibility?: string | null;
  readonly offeredAt?: string | null;
  readonly supersedes?: string | null;
  readonly retires?: string | null;
  readonly grounds?: string | null;
  readonly provenance: {
    readonly offeredBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

export interface RegisterOfferCommandPayload {
  readonly candidate: OfferCandidateWire;
  readonly evidence: readonly MarketplaceEvidenceRef[];
}

export interface RetireOfferCommandPayload {
  readonly offerId: string;
  readonly retires: string;
  readonly grounds: string;
  readonly provenance: {
    readonly offeredBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

export interface GrantAccessCommandPayload {
  readonly grantId: string;
  readonly offerId: string;
  readonly grantee: { type: string; tenant: string; principalId: string };
  readonly permittedUse: string;
  readonly asOf: string;
  readonly expiresAt: string | null;
}

export interface RevokeGrantCommandPayload {
  readonly grantId: string;
  readonly grounds: string;
  readonly revoker: { type: string; tenant: string; principalId: string };
  readonly revokedAt: string;
}

export interface SubmitReviewCommandPayload {
  readonly reviewId: string;
  readonly offerId: string;
  readonly reviewer: { type: string; tenant: string; principalId: string };
  readonly rating: number;
  readonly verdict: string;
  readonly body: string;
  readonly submittedAt: string;
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface OfferRegisteredEventPayload {
  readonly offerId: string;
  readonly offerDigest: string;
  readonly admitted: true;
  readonly rejectionCount: 0;
}
export interface OfferSupersededEventPayload {
  readonly offerId: string;
  readonly offerDigest: string;
  readonly supersedes: string;
}
export interface OfferRetiredEventPayload {
  readonly offerId: string;
  readonly retires: string;
}
export interface AccessGrantedEventPayload {
  readonly grantId: string;
  readonly grantDigest: string;
  readonly offerId: string;
  readonly permittedUse: string;
}
export interface GrantRevokedEventPayload {
  readonly grantId: string;
  readonly revokes: string;
}
export interface ReviewSubmittedEventPayload {
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly offerId: string;
  readonly rating: number;
}

// ---------------------------------------------------------------------------
// Command constructors + parsers
// ---------------------------------------------------------------------------

function schemaOf(name: string): string {
  return MARKETPLACE_SCHEMAS[name] as string;
}

function makeCommand<T>(
  schemaName: string,
  payload: T,
  correlationId: string,
  idempotencyKey: string,
): Envelope<T> {
  return makeEnvelope({
    kind: 'command',
    schema: schemaOf(schemaName),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: toIdempotencyKey(idempotencyKey),
    payload,
  });
}

function expectCommandKind(envelope: Envelope<unknown>, schemaName: string): void {
  if (envelope.kind !== 'command') {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
      message: `${JSON.stringify(schemaName)} must arrive in a command envelope`,
      details: { kind: envelope.kind },
    });
  }
  if (envelope.idempotencyKey === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RECORD, {
      message: `${JSON.stringify(schemaName)} requires a non-null idempotency key`,
    });
  }
}

function validateCandidateEvidence(payload: Record<string, unknown>, schemaName: string): readonly MarketplaceEvidenceRef[] {
  const evidence = payload['evidence'];
  if (!Array.isArray(evidence)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_EVIDENCE, {
      message: `${JSON.stringify(schemaName)} requires an evidence citation array`,
    });
  }
  return evidence.map((value) => toMarketplaceEvidenceRef(value));
}

/** Build (client side) a register-offer command envelope. */
export function makeRegisterOfferCommand(
  payload: RegisterOfferCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<RegisterOfferCommandPayload> {
  return makeCommand('register-offer-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a register-offer command envelope (wire fidelity kept). */
export function parseRegisterOfferCommand(
  raw: string,
): Envelope<RegisterOfferCommandPayload> {
  const envelope = parseEnvelopeAs<RegisterOfferCommandPayload>(
    raw,
    schemaOf('register-offer-command'),
  );
  expectCommandKind(envelope, 'register-offer-command');
  if (!isPlainObject(envelope.payload) || !isPlainObject(((envelope.payload as unknown) as Record<string, unknown>)['candidate'])) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'register-offer payload requires a candidate object',
    });
  }
  validateCandidateEvidence((envelope.payload as unknown) as Record<string, unknown>, 'register-offer-command');
  return envelope;
}

/** Build a supersede-offer command envelope. */
export function makeSupersedeOfferCommand(
  payload: RegisterOfferCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<RegisterOfferCommandPayload> {
  return makeCommand('supersede-offer-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a supersede-offer command envelope. */
export function parseSupersedeOfferCommand(
  raw: string,
): Envelope<RegisterOfferCommandPayload> {
  const envelope = parseEnvelopeAs<RegisterOfferCommandPayload>(
    raw,
    schemaOf('supersede-offer-command'),
  );
  expectCommandKind(envelope, 'supersede-offer-command');
  if (!isPlainObject(envelope.payload) || !isPlainObject(((envelope.payload as unknown) as Record<string, unknown>)['candidate'])) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'supersede-offer payload requires a candidate object',
    });
  }
  validateCandidateEvidence((envelope.payload as unknown) as Record<string, unknown>, 'supersede-offer-command');
  return envelope;
}

/** Build a retire-offer command envelope. */
export function makeRetireOfferCommand(
  payload: RetireOfferCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<RetireOfferCommandPayload> {
  return makeCommand('retire-offer-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a retire-offer command envelope. */
export function parseRetireOfferCommand(
  raw: string,
): Envelope<RetireOfferCommandPayload> {
  const envelope = parseEnvelopeAs<RetireOfferCommandPayload>(
    raw,
    schemaOf('retire-offer-command'),
  );
  expectCommandKind(envelope, 'retire-offer-command');
  if (!isMarketplaceText(((envelope.payload as unknown) as Record<string, unknown>)['grounds'] ?? null)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'retire-offer requires grounds',
    });
  }
  return envelope;
}

/** Build a grant-access command envelope. */
export function makeGrantAccessCommand(
  payload: GrantAccessCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<GrantAccessCommandPayload> {
  return makeCommand('grant-access-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a grant-access command envelope. */
export function parseGrantAccessCommand(
  raw: string,
): Envelope<GrantAccessCommandPayload> {
  const envelope = parseEnvelopeAs<GrantAccessCommandPayload>(
    raw,
    schemaOf('grant-access-command'),
  );
  expectCommandKind(envelope, 'grant-access-command');
  if (!isMarketplaceTimestamp(((envelope.payload as unknown) as Record<string, unknown>)['asOf'] ?? null)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant-access requires asOf as a ms-precision UTC timestamp',
    });
  }
  return envelope;
}

/** Build a revoke-grant command envelope. */
export function makeRevokeGrantCommand(
  payload: RevokeGrantCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<RevokeGrantCommandPayload> {
  return makeCommand('revoke-grant-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a revoke-grant command envelope. */
export function parseRevokeGrantCommand(
  raw: string,
): Envelope<RevokeGrantCommandPayload> {
  const envelope = parseEnvelopeAs<RevokeGrantCommandPayload>(
    raw,
    schemaOf('revoke-grant-command'),
  );
  expectCommandKind(envelope, 'revoke-grant-command');
  if (!isMarketplaceText(((envelope.payload as unknown) as Record<string, unknown>)['grounds'] ?? null)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'revoke-grant requires grounds',
    });
  }
  return envelope;
}

/** Build a submit-review command envelope. */
export function makeSubmitReviewCommand(
  payload: SubmitReviewCommandPayload,
  correlationId: string,
  idempotencyKey: string,
): Envelope<SubmitReviewCommandPayload> {
  return makeCommand('submit-review-command', payload, correlationId, idempotencyKey);
}

/** Strict-parse a submit-review command envelope. */
export function parseSubmitReviewCommand(
  raw: string,
): Envelope<SubmitReviewCommandPayload> {
  const envelope = parseEnvelopeAs<SubmitReviewCommandPayload>(
    raw,
    schemaOf('submit-review-command'),
  );
  expectCommandKind(envelope, 'submit-review-command');
  return envelope;
}

// ---------------------------------------------------------------------------
// Event constructors
// ---------------------------------------------------------------------------

function makeEvent<T>(
  schemaName: string,
  payload: T,
  correlationId: string,
): Envelope<T> {
  return makeEnvelope({
    kind: 'event',
    schema: schemaOf(schemaName),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

export function makeOfferRegisteredEvent(
  payload: OfferRegisteredEventPayload,
  correlationId: string,
): Envelope<OfferRegisteredEventPayload> {
  return makeEvent('offer-registered-event', payload, correlationId);
}

export function makeOfferSupersededEvent(
  payload: OfferSupersededEventPayload,
  correlationId: string,
): Envelope<OfferSupersededEventPayload> {
  return makeEvent('offer-superseded-event', payload, correlationId);
}

export function makeOfferRetiredEvent(
  payload: OfferRetiredEventPayload,
  correlationId: string,
): Envelope<OfferRetiredEventPayload> {
  return makeEvent('offer-retired-event', payload, correlationId);
}

export function makeAccessGrantedEvent(
  payload: AccessGrantedEventPayload,
  correlationId: string,
): Envelope<AccessGrantedEventPayload> {
  return makeEvent('access-granted-event', payload, correlationId);
}

export function makeGrantRevokedEvent(
  payload: GrantRevokedEventPayload,
  correlationId: string,
): Envelope<GrantRevokedEventPayload> {
  return makeEvent('grant-revoked-event', payload, correlationId);
}

export function makeReviewSubmittedEvent(
  payload: ReviewSubmittedEventPayload,
  correlationId: string,
): Envelope<ReviewSubmittedEventPayload> {
  return makeEvent('review-submitted-event', payload, correlationId);
}

// ---------------------------------------------------------------------------
// Query envelopes
// ---------------------------------------------------------------------------

/** Build a marketplace query request envelope (NULL idempotency key). */
export function makeMarketplaceQueryRequest(
  payload: MarketplaceQueryRequest,
  correlationId: string,
): Envelope<MarketplaceQueryRequest> {
  return makeEnvelope({
    kind: 'query',
    schema: schemaOf('marketplace-query-request'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

/** Strict-parse a marketplace query request envelope. */
export function parseMarketplaceQueryRequest(
  raw: string,
): Envelope<MarketplaceQueryRequest> {
  const envelope = parseEnvelopeAs<MarketplaceQueryRequest>(
    raw,
    schemaOf('marketplace-query-request'),
  );
  if (envelope.kind !== 'query') {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: 'marketplace queries must arrive in a query envelope',
      details: { kind: envelope.kind },
    });
  }
  if (envelope.idempotencyKey !== null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: 'marketplace queries carry a NULL idempotency key (reads are not commands)',
    });
  }
  const payload = (envelope.payload as unknown) as Record<string, unknown>;
  const kind = payload['kind'];
  if (
    typeof kind !== 'string' ||
    !(MARKETPLACE_QUERY_KINDS as readonly string[]).includes(kind)
  ) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: `unknown marketplace query kind: ${JSON.stringify(kind)}`,
      details: { known: [...MARKETPLACE_QUERY_KINDS] },
    });
  }
  return envelope;
}

/** Build a marketplace query response envelope. */
export function makeMarketplaceQueryResponse(
  payload: MarketplaceQueryResponse,
  correlationId: string,
): Envelope<MarketplaceQueryResponse> {
  return makeEnvelope({
    kind: 'response',
    schema: schemaOf('marketplace-query-response'),
    correlationId: toCorrelationId(correlationId),
    idempotencyKey: null,
    payload,
  });
}

/** Strict-parse a marketplace query response envelope. */
export function parseMarketplaceQueryResponse(
  raw: string,
): Envelope<MarketplaceQueryResponse> {
  const envelope = parseEnvelopeAs<MarketplaceQueryResponse>(
    raw,
    schemaOf('marketplace-query-response'),
  );
  if (envelope.kind !== 'response') {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: 'marketplace query answers must arrive in a response envelope',
      details: { kind: envelope.kind },
    });
  }
  return envelope;
}

/** Pairing guard: the response answers the given request (correlation + kind). */
export function parseMarketplaceQueryResponseFor(
  raw: string,
  request: Envelope<MarketplaceQueryRequest>,
): Envelope<MarketplaceQueryResponse> {
  const response = parseMarketplaceQueryResponse(raw);
  if (response.correlationId !== request.correlationId) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: 'query response correlation id does not match the request',
    });
  }
  if (response.payload.kind !== request.payload.kind) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: 'query response kind does not echo the request kind',
    });
  }
  return response;
}

export { serializeEnvelope, toCorrelationId, toIdempotencyKey };
export type { CorrelationId, IdempotencyKey, Envelope };
