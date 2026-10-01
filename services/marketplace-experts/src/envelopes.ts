/**
 * Envelope wiring for the expert-marketplace protocol surface (Work
 * Order A031; architecture-lock rules 17, 18, 22).
 *
 * Every wire shape travels inside @arena/protocol-core's Envelope<T>:
 * COMMANDS carry a REQUIRED non-null idempotency key (publish-listing /
 * transition-listing / record-offer / withdraw-offer / request-engagement
 * / transition-engagement / record-review), QUERIES carry none
 * (marketplace-search is a pure query — lock rule 17's command
 * discipline applies to state-changing intents), events carry the causal
 * command's key. All messages carry a correlation id; payloads are
 * canonical-JSON serializable and digest-verifiable.
 *
 * Payload schemas are versioned SchemaRefs in the `marketplace-experts`
 * namespace (arena:schema/marketplace-experts/<name>@<version>). A031
 * owns NO generated-contracts surface (spec/work-items.md row A031) —
 * the schema registry here is the in-code source of truth, mirrored by
 * the envelope round trips in the fabric tests.
 */

import {
  makeEnvelope,
} from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey, SchemaRef } from '@arena/protocol-core';
import { MARKETPLACE_EXPERTS_ERROR_CODES, MarketplaceExpertsError } from './errors.js';
import { isCommercialOffer } from './offer.js';
import type {
  CommercialOffer,
  OfferBackingGateReport,
  OfferStatusRecord,
} from './offer.js';
import { isEngagement } from './engagement.js';
import type { EngagementRecord, EngagementTransitionRecord } from './engagement.js';
import { isListingStatusRecord } from './listing.js';
import type { ListingGateReport, ListingStatusRecord } from './listing.js';
import { isMarketplaceQuery, isMarketplaceSearchResult } from './query.js';
import type { MarketplaceQueryView, MarketplaceSearchResult } from './query.js';
import { isReview } from './review.js';
import type { ReviewRecord } from './review.js';
import { isContentDigest, isListingTransition, isEngagementTransition, isMarketplaceTimestamp } from './shared.js';
import type { EngagementTransition as EngagementTransitionKind, ListingTransition } from './shared.js';

export const MARKETPLACE_EXPERTS_SCHEMA_VERSION = '1.0.0' as const;

/**
 * Registry of the schemas owned by @arena/marketplace-experts-fabric.
 */
export const MARKETPLACE_EXPERTS_SCHEMAS = Object.freeze({
  'marketplace-experts/expert-listing': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/listing-status-record': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/commercial-offer': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/offer-status-record': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/engagement': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/engagement-transition-record': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/review': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/publish-listing-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/transition-listing-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/record-offer-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/withdraw-offer-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/request-engagement-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/transition-engagement-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/record-review-command': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/listing-published-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/listing-status-recorded-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/offer-recorded-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/offer-withdrawn-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/engagement-requested-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/engagement-transition-recorded-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/review-recorded-event': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/marketplace-search-query': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
  'marketplace-experts/marketplace-search-completed-response': MARKETPLACE_EXPERTS_SCHEMA_VERSION,
} as const);

export type MarketplaceExpertsSchemaName = keyof typeof MARKETPLACE_EXPERTS_SCHEMAS;

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Resolve a marketplace-experts schema name to its SchemaRef. */
export function marketplaceExpertsSchemaRef(name: MarketplaceExpertsSchemaName): SchemaRef {
  const version = MARKETPLACE_EXPERTS_SCHEMAS[name];
  const namespace = name.split('/')[0];
  const schemaName = name.split('/')[1];
  if (version === undefined || namespace === undefined || schemaName === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.UNKNOWN_ERROR, {
      message: `unknown expert-marketplace protocol schema: ${String(name)}`,
      details: { known: Object.keys(MARKETPLACE_EXPERTS_SCHEMAS) },
    });
  }
  return { namespace, name: schemaName, version };
}

/** True iff the ref names a marketplace-experts schema at the registered version. */
export function isKnownMarketplaceExpertsSchema(ref: SchemaRef): boolean {
  const registered = (MARKETPLACE_EXPERTS_SCHEMAS as Readonly<Record<string, string>>)[
    `${ref.namespace}/${ref.name}`
  ];
  return registered === ref.version;
}

// ---------------------------------------------------------------------------
// Wire payloads
// ---------------------------------------------------------------------------

/** Command payload: publish (gate-verify) one listing at one fixed time. */
export interface PublishListingCommandPayload {
  readonly listingRef: string;
  readonly at: string;
}

/** Command payload: append one non-publish listing transition. */
export interface TransitionListingCommandPayload {
  readonly listingRef: string;
  readonly transition: Exclude<ListingTransition, 'publish'>;
  readonly at: string;
  readonly note?: string;
}

/** Command payload: record one commercial offer (gate-verified backing). */
export interface RecordOfferCommandPayload {
  readonly offer: CommercialOffer;
}

/** Command payload: withdraw one offer. */
export interface WithdrawOfferCommandPayload {
  readonly offerRef: string;
  readonly at: string;
  readonly note?: string;
}

/** Command payload: request one engagement. */
export interface RequestEngagementCommandPayload {
  readonly engagement: EngagementRecord;
}

/** Command payload: append one engagement transition. */
export interface TransitionEngagementCommandPayload {
  readonly engagementRef: string;
  readonly transition: EngagementTransitionKind;
  readonly at: string;
  readonly note?: string;
}

/** Command payload: record one review (completion-gated). */
export interface RecordReviewCommandPayload {
  readonly review: ReviewRecord;
}

/** Event payload: a listing was published (with the gate evidence). */
export interface ListingPublishedEventPayload {
  readonly record: ListingStatusRecord;
  readonly gate: ListingGateReport;
}

/** Event payload: a non-publish listing transition was appended. */
export interface ListingStatusRecordedEventPayload {
  readonly record: ListingStatusRecord;
}

/** Event payload: an offer was recorded (with backing gate evidence when present). */
export interface OfferRecordedEventPayload {
  readonly offer: CommercialOffer;
  readonly backingGate: OfferBackingGateReport | null;
}

/** Event payload: an offer was withdrawn. */
export interface OfferWithdrawnEventPayload {
  readonly record: OfferStatusRecord;
}

/** Event payload: an engagement was requested. */
export interface EngagementRequestedEventPayload {
  readonly engagement: EngagementRecord;
}

/** Event payload: an engagement transition was appended. */
export interface EngagementTransitionRecordedEventPayload {
  readonly record: EngagementTransitionRecord;
}

/** Event payload: a review was recorded. */
export interface ReviewRecordedEventPayload {
  readonly review: ReviewRecord;
}

/** Query payload: search the marketplace. */
export interface MarketplaceSearchQueryPayload {
  readonly query: MarketplaceQueryView;
}

/** Response payload: the authoritative search result. */
export interface MarketplaceSearchCompletedResponsePayload {
  readonly result: MarketplaceSearchResult;
}

export interface MarketplaceExpertsEnvelopeContext {
  readonly correlationId: CorrelationId;
  readonly idempotencyKey?: IdempotencyKey;
}

function requireCommandIdempotencyKey(
  context: MarketplaceExpertsEnvelopeContext,
): IdempotencyKey {
  if (context.idempotencyKey === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: 'command envelopes require an idempotency key (architecture-lock rule 17)',
    });
  }
  return context.idempotencyKey;
}

function requireDigest(value: unknown, field: string, what: string): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_DIGEST, {
      message: `${what} requires a valid content digest in '${field}'`,
      details: { field, pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

function requireTimestamp(value: unknown, field: string, what: string): string {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${what} requires an ms-precision UTC ${field}`,
      details: { field },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Command / event / query / response constructors
// ---------------------------------------------------------------------------

export function makePublishListingCommand(
  payload: PublishListingCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<PublishListingCommandPayload> {
  requireDigest(payload.listingRef, 'listingRef', 'publish-listing command payload');
  requireTimestamp(payload.at, 'at', 'publish-listing command payload');
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/publish-listing-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeTransitionListingCommand(
  payload: TransitionListingCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<TransitionListingCommandPayload> {
  requireDigest(payload.listingRef, 'listingRef', 'transition-listing command payload');
  if (!isListingTransition(payload.transition) || (payload.transition as string) === 'publish') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: "transition-listing command payload requires transition 'unlist'|'relist'|'delist'",
      details: { transition: payload.transition },
    });
  }
  requireTimestamp(payload.at, 'at', 'transition-listing command payload');
  if (payload.note !== undefined && typeof payload.note !== 'string') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TEXT, {
      message: "transition-listing command payload note must be a string when present",
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/transition-listing-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeRecordOfferCommand(
  payload: RecordOfferCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<RecordOfferCommandPayload> {
  if (!isCommercialOffer(payload.offer)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: 'record-offer command payload requires a structurally valid commercial offer',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/record-offer-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeWithdrawOfferCommand(
  payload: WithdrawOfferCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<WithdrawOfferCommandPayload> {
  requireDigest(payload.offerRef, 'offerRef', 'withdraw-offer command payload');
  requireTimestamp(payload.at, 'at', 'withdraw-offer command payload');
  if (payload.note !== undefined && typeof payload.note !== 'string') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TEXT, {
      message: 'withdraw-offer command payload note must be a string when present',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/withdraw-offer-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeRequestEngagementCommand(
  payload: RequestEngagementCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<RequestEngagementCommandPayload> {
  if (!isEngagement(payload.engagement)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
      message: 'request-engagement command payload requires a structurally valid engagement record',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/request-engagement-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeTransitionEngagementCommand(
  payload: TransitionEngagementCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<TransitionEngagementCommandPayload> {
  requireDigest(payload.engagementRef, 'engagementRef', 'transition-engagement command payload');
  if (!isEngagementTransition(payload.transition)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
      message: "transition-engagement command payload requires transition 'accept'|'decline'|'cancel'|'complete'",
      details: { transition: payload.transition },
    });
  }
  requireTimestamp(payload.at, 'at', 'transition-engagement command payload');
  if (payload.note !== undefined && typeof payload.note !== 'string') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TEXT, {
      message: 'transition-engagement command payload note must be a string when present',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/transition-engagement-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeRecordReviewCommand(
  payload: RecordReviewCommandPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<RecordReviewCommandPayload> {
  if (!isReview(payload.review)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_REVIEW, {
      message: 'record-review command payload requires a structurally valid review record',
    });
  }
  return makeEnvelope({
    kind: 'command',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/record-review-command'),
    correlationId: context.correlationId,
    idempotencyKey: requireCommandIdempotencyKey(context),
    payload,
  });
}

export function makeListingPublishedEvent(
  payload: ListingPublishedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<ListingPublishedEventPayload> {
  if (!isListingStatusRecord(payload.record) || payload.record.transition !== 'publish') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: "listing-published event payload requires a 'publish' listing-status record",
    });
  }
  if (
    typeof payload.gate !== 'object' ||
    payload.gate === null ||
    !isContentDigest(payload.gate.listingRef)
  ) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: 'listing-published event payload requires the gate report evidence',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/listing-published-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeListingStatusRecordedEvent(
  payload: ListingStatusRecordedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<ListingStatusRecordedEventPayload> {
  if (!isListingStatusRecord(payload.record)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: 'listing-status-recorded event payload requires a structurally valid listing-status record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/listing-status-recorded-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeOfferRecordedEvent(
  payload: OfferRecordedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<OfferRecordedEventPayload> {
  if (!isCommercialOffer(payload.offer)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: 'offer-recorded event payload requires a structurally valid commercial offer',
    });
  }
  if (payload.backingGate !== null && typeof payload.backingGate !== 'object') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: 'offer-recorded event payload backingGate must be a report or null',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/offer-recorded-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeOfferWithdrawnEvent(
  payload: OfferWithdrawnEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<OfferWithdrawnEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/offer-withdrawn-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeEngagementRequestedEvent(
  payload: EngagementRequestedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<EngagementRequestedEventPayload> {
  if (!isEngagement(payload.engagement)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
      message: 'engagement-requested event payload requires a structurally valid engagement record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/engagement-requested-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeEngagementTransitionRecordedEvent(
  payload: EngagementTransitionRecordedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<EngagementTransitionRecordedEventPayload> {
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef(
      'marketplace-experts/engagement-transition-recorded-event',
    ),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeReviewRecordedEvent(
  payload: ReviewRecordedEventPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<ReviewRecordedEventPayload> {
  if (!isReview(payload.review)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_REVIEW, {
      message: 'review-recorded event payload requires a structurally valid review record',
    });
  }
  return makeEnvelope({
    kind: 'event',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/review-recorded-event'),
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey ?? null,
    payload,
  });
}

export function makeMarketplaceSearchQuery(
  payload: MarketplaceSearchQueryPayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<MarketplaceSearchQueryPayload> {
  if (!isMarketplaceQuery(payload.query)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'marketplace-search query payload requires a structurally valid query',
    });
  }
  return makeEnvelope({
    kind: 'query',
    schema: marketplaceExpertsSchemaRef('marketplace-experts/marketplace-search-query'),
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

export function makeMarketplaceSearchCompletedResponse(
  payload: MarketplaceSearchCompletedResponsePayload,
  context: MarketplaceExpertsEnvelopeContext,
): Envelope<MarketplaceSearchCompletedResponsePayload> {
  if (!isMarketplaceSearchResult(payload.result)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'marketplace-search-completed response payload requires a structurally valid result',
    });
  }
  return makeEnvelope({
    kind: 'response',
    schema: marketplaceExpertsSchemaRef(
      'marketplace-experts/marketplace-search-completed-response',
    ),
    correlationId: context.correlationId,
    idempotencyKey: null,
    payload,
  });
}

// Re-export the timestamp guard for envelope consumers.
export { isMarketplaceTimestamp };
