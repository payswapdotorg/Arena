/**
 * ExpertMarketplaceFabric — the in-process reference ORCHESTRATOR over
 * the pool and the pure engine (Work Order A031; requirements R31, R32,
 * R34; architecture-lock rules 6, 11, 17, 18; mirrors the A007
 * ExpertMatchingFabric structurally).
 *
 * Commands (idempotency key REQUIRED — lock rule 17):
 *   - `publishListing` — runs the REAL qualification gate
 *     (verifyListingGate) against the injected expert-record store at a
 *     fixed time and appends the publish transition + gate evidence;
 *   - `transitionListing` — unlist/relist/delist (closed table, terminal
 *     finality);
 *   - `recordOffer` — verifies the body-backed gate (A024 release +
 *     A023 certification re-verification) when the offer cites a release;
 *   - `withdrawOffer` — appends the terminal withdrawal record;
 *   - `requestEngagement` — tenant-checked, offer-gated booking append;
 *   - `transitionEngagement` — accept/decline/cancel/complete;
 *   - `recordReview` — completion-gated review append.
 *
 * Query (pure — no idempotency key): `searchMarketplace` runs the engine
 * and emits the marketplace-search-query / search-completed-response
 * envelope round trip.
 *
 * Idempotency (lock rule 17): the same key + the same command tuple
 * replays as a no-op returning the stored outcome; the same key + a
 * different tuple is an IDEMPOTENCY_CONFLICT.
 */

import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import { createEngagementTransition } from './engagement.js';
import { createListingStatusRecord, verifyListingGate } from './listing.js';
import { createOfferStatusRecord, verifyOfferBackingGate } from './offer.js';
import { ExpertMarketplacePool } from './pool.js';
import { ExpertMarketplaceEngine } from './engine.js';
import { createMarketplaceQuery } from './query.js';
import type { MarketplaceQueryView } from './query.js';
import {
  makeEngagementRequestedEvent,
  makeEngagementTransitionRecordedEvent,
  makeListingPublishedEvent,
  makeListingStatusRecordedEvent,
  makeMarketplaceSearchCompletedResponse,
  makeMarketplaceSearchQuery,
  makeReviewRecordedEvent,
  makeOfferRecordedEvent,
  makeOfferWithdrawnEvent,
  makePublishListingCommand,
  makeRecordOfferCommand,
  makeRecordReviewCommand,
  makeRequestEngagementCommand,
  makeTransitionEngagementCommand,
  makeTransitionListingCommand,
  makeWithdrawOfferCommand,
} from './envelopes.js';
import type {
  EngagementRequestedEventPayload,
  EngagementTransitionRecordedEventPayload,
  ListingPublishedEventPayload,
  ListingStatusRecordedEventPayload,
  MarketplaceSearchCompletedResponsePayload,
  MarketplaceSearchQueryPayload,
  OfferRecordedEventPayload,
  OfferWithdrawnEventPayload,
  ReviewRecordedEventPayload,
} from './envelopes.js';
import type { EngagementTransition as EngagementTransitionKind } from './shared.js';
import type {
  ListingTransition,
  MarketplaceCertificationRecordStore,
  MarketplaceExpertRecordStore,
  MarketplaceReleaseRecordStore,
} from './shared.js';
import {
  AbsentCertificationRecordStore,
  AbsentExpertRecordStore,
  AbsentReleaseRecordStore,
} from './shared.js';

/** Options for one fabric command run. */
export interface CommandOptions {
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

/** Options for one fabric query run (pure — no idempotency key). */
export interface QueryOptions {
  readonly correlationId: string;
}

/** The injected cross-service evidence stores (fail-closed defaults). */
export interface MarketplaceStores {
  readonly expertRecords?: MarketplaceExpertRecordStore;
  readonly releases?: MarketplaceReleaseRecordStore;
  readonly certifications?: MarketplaceCertificationRecordStore;
}

interface IdempotencyBinding {
  readonly commandCanonical: string;
  readonly outcomeDigest: string;
}

type MarketEvent =
  | { readonly kind: 'listing-published'; readonly envelope: Envelope<ListingPublishedEventPayload> }
  | { readonly kind: 'listing-status-recorded'; readonly envelope: Envelope<ListingStatusRecordedEventPayload> }
  | { readonly kind: 'offer-recorded'; readonly envelope: Envelope<OfferRecordedEventPayload> }
  | { readonly kind: 'offer-withdrawn'; readonly envelope: Envelope<OfferWithdrawnEventPayload> }
  | { readonly kind: 'engagement-requested'; readonly envelope: Envelope<EngagementRequestedEventPayload> }
  | {
      readonly kind: 'engagement-transition-recorded';
      readonly envelope: Envelope<EngagementTransitionRecordedEventPayload>;
    }
  | { readonly kind: 'review-recorded'; readonly envelope: Envelope<ReviewRecordedEventPayload> };

/**
 * The in-process reference fabric: pool + engine + command orchestration +
 * event log. Construct with `new ExpertMarketplaceFabric()` (fresh pool,
 * fail-closed absent stores) or inject a pre-populated pool + stores.
 */
export class ExpertMarketplaceFabric {
  readonly pool: ExpertMarketplacePool;
  readonly engine: ExpertMarketplaceEngine;
  readonly stores: Required<MarketplaceStores>;

  /** Insertion-ordered event log (append-only). */
  private readonly events: MarketEvent[] = [];
  /** Run idempotency keys → the run they authorized. */
  private readonly runKeys = new Map<string, IdempotencyBinding>();

  // Registration pass-through (the pool enforces the discipline).
  registerListing: ExpertMarketplacePool['registerListing'];
  registerOffer: ExpertMarketplacePool['registerOffer'];
  registerEngagement: ExpertMarketplacePool['registerEngagement'];
  registerReview: ExpertMarketplacePool['registerReview'];

  constructor(
    pool: ExpertMarketplacePool = new ExpertMarketplacePool(),
    injected: MarketplaceStores = {},
  ) {
    this.pool = pool;
    this.engine = new ExpertMarketplaceEngine();
    this.stores = {
      expertRecords: injected.expertRecords ?? new AbsentExpertRecordStore(),
      releases: injected.releases ?? new AbsentReleaseRecordStore(),
      certifications: injected.certifications ?? new AbsentCertificationRecordStore(),
    };
    this.registerListing = pool.registerListing.bind(pool);
    this.registerOffer = pool.registerOffer.bind(pool);
    this.registerEngagement = pool.registerEngagement.bind(pool);
    this.registerReview = pool.registerReview.bind(pool);
  }

  // -------------------------------------------------------------------------
  // publishListing (command — the qualification gate runs HERE)
  // -------------------------------------------------------------------------

  /** Gate-verify and publish one listing at one fixed time. */
  async publishListing(
    command: { listingRef: string; at: string },
    options: CommandOptions,
  ): Promise<{
    record: import('./listing.js').ListingStatusRecord;
    gate: import('./listing.js').ListingGateReport;
    event: Envelope<ListingPublishedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makePublishListingCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify(['publish-listing', command.listingRef, command.at]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const replayRecord = this.pool
        .listListingStatusRecords(command.listingRef)
        .find((record) => record.digest === binding.outcomeDigest);
      if (replayRecord !== undefined) {
        const gate = await verifyListingGate(
          this.requireListing(command.listingRef),
          command.at,
          this.stores.expertRecords,
        );
        const replayEvent = makeListingPublishedEvent(
          { record: replayRecord, gate },
          { correlationId, idempotencyKey },
        );
        return { record: replayRecord, gate, event: replayEvent };
      }
    }

    const listing = this.requireListing(command.listingRef);
    // The gate: REAL A007 evidence verification, fail-closed.
    const gate = await verifyListingGate(listing, command.at, this.stores.expertRecords);
    const record = await createListingStatusRecord({
      listingRef: listing.digest,
      tenant: listing.tenant,
      transition: 'publish',
      at: command.at,
    });
    this.pool.registerListingStatusRecord(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, outcomeDigest: record.digest });
    const event = makeListingPublishedEvent({ record, gate }, { correlationId, idempotencyKey });
    this.events.push({ kind: 'listing-published', envelope: event });
    return { record, gate, event };
  }

  // -------------------------------------------------------------------------
  // transitionListing (command — unlist / relist / delist)
  // -------------------------------------------------------------------------

  /** Append one non-publish listing transition. */
  async transitionListing(
    command: {
      listingRef: string;
      transition: Exclude<ListingTransition, 'publish'>;
      at: string;
      note?: string;
    },
    options: CommandOptions,
  ): Promise<{
    record: import('./listing.js').ListingStatusRecord;
    event: Envelope<ListingStatusRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeTransitionListingCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify([
      'transition-listing',
      command.listingRef,
      command.transition,
      command.at,
      command.note ?? null,
    ]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const replayRecord = this.pool
        .listListingStatusRecords(command.listingRef)
        .find((record) => record.digest === binding.outcomeDigest);
      if (replayRecord !== undefined) {
        const replayEvent = makeListingStatusRecordedEvent(
          { record: replayRecord },
          { correlationId, idempotencyKey },
        );
        return { record: replayRecord, event: replayEvent };
      }
    }

    const listing = this.requireListing(command.listingRef);
    const record = await createListingStatusRecord({
      listingRef: listing.digest,
      tenant: listing.tenant,
      transition: command.transition,
      at: command.at,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
    this.pool.registerListingStatusRecord(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, outcomeDigest: record.digest });
    const event = makeListingStatusRecordedEvent({ record }, { correlationId, idempotencyKey });
    this.events.push({ kind: 'listing-status-recorded', envelope: event });
    return { record, event };
  }

  // -------------------------------------------------------------------------
  // recordOffer (command — the body-backed gate runs HERE)
  // -------------------------------------------------------------------------

  /** Gate-verify and record one commercial offer. */
  async recordOffer(
    command: { offer: import('./offer.js').CommercialOffer },
    options: CommandOptions,
  ): Promise<{
    offer: import('./offer.js').CommercialOffer;
    backingGate: import('./offer.js').OfferBackingGateReport | null;
    event: Envelope<OfferRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeRecordOfferCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify(['record-offer', command.offer.digest]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const stored = this.pool.getOffer(binding.outcomeDigest);
      if (stored !== undefined) {
        const backingGate = await verifyOfferBackingGate(
          stored,
          this.stores.releases,
          this.stores.certifications,
        );
        const replayEvent = makeOfferRecordedEvent(
          { offer: stored, backingGate },
          { correlationId, idempotencyKey },
        );
        return { offer: stored, backingGate, event: replayEvent };
      }
    }

    // The listing must exist before the offer can attach.
    this.requireListing(command.offer.listingRef);
    // The backing gate (A024 + A023 re-verification), fail-closed.
    const backingGate = await verifyOfferBackingGate(
      command.offer,
      this.stores.releases,
      this.stores.certifications,
    );
    this.pool.registerOffer(command.offer);
    this.runKeys.set(idempotencyKey, {
      commandCanonical: canonical,
      outcomeDigest: command.offer.digest,
    });
    const event = makeOfferRecordedEvent(
      { offer: command.offer, backingGate },
      { correlationId, idempotencyKey },
    );
    this.events.push({ kind: 'offer-recorded', envelope: event });
    return { offer: command.offer, backingGate, event };
  }

  // -------------------------------------------------------------------------
  // withdrawOffer (command — terminal withdrawal)
  // -------------------------------------------------------------------------

  /** Withdraw one offer (terminal; re-pricing is supersession). */
  async withdrawOffer(
    command: { offerRef: string; at: string; note?: string },
    options: CommandOptions,
  ): Promise<{
    record: import('./offer.js').OfferStatusRecord;
    event: Envelope<OfferWithdrawnEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeWithdrawOfferCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify([
      'withdraw-offer',
      command.offerRef,
      command.at,
      command.note ?? null,
    ]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    const offer = this.pool.getOffer(command.offerRef);
    if (offer === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no offer registered at digest ${JSON.stringify(command.offerRef)}`,
        details: { offerRef: command.offerRef },
      });
    }
    if (binding !== undefined) {
      const replayRecord = this.pool
        .listOfferStatusRecords(command.offerRef)
        .find((record) => record.digest === binding.outcomeDigest);
      if (replayRecord !== undefined) {
        const replayEvent = makeOfferWithdrawnEvent(
          { record: replayRecord },
          { correlationId, idempotencyKey },
        );
        return { record: replayRecord, event: replayEvent };
      }
    }

    const record = await createOfferStatusRecord({
      offerRef: offer.digest,
      tenant: offer.tenant,
      transition: 'withdraw',
      at: command.at,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
    this.pool.registerOfferStatusRecord(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, outcomeDigest: record.digest });
    const event = makeOfferWithdrawnEvent({ record }, { correlationId, idempotencyKey });
    this.events.push({ kind: 'offer-withdrawn', envelope: event });
    return { record, event };
  }

  // -------------------------------------------------------------------------
  // requestEngagement (command — tenant-checked booking)
  // -------------------------------------------------------------------------

  /** Record one engagement request. */
  async requestEngagement(
    command: { engagement: import('./engagement.js').EngagementRecord },
    options: CommandOptions,
  ): Promise<{
    engagement: import('./engagement.js').EngagementRecord;
    event: Envelope<EngagementRequestedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeRequestEngagementCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify(['request-engagement', command.engagement.digest]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const stored = this.pool.getEngagement(binding.outcomeDigest);
      if (stored !== undefined) {
        const replayEvent = makeEngagementRequestedEvent(
          { engagement: stored },
          { correlationId, idempotencyKey },
        );
        return { engagement: stored, event: replayEvent };
      }
    }

    this.pool.registerEngagement(command.engagement);
    this.runKeys.set(idempotencyKey, {
      commandCanonical: canonical,
      outcomeDigest: command.engagement.digest,
    });
    const event = makeEngagementRequestedEvent(
      { engagement: command.engagement },
      { correlationId, idempotencyKey },
    );
    this.events.push({ kind: 'engagement-requested', envelope: event });
    return { engagement: command.engagement, event };
  }

  // -------------------------------------------------------------------------
  // transitionEngagement (command — accept/decline/cancel/complete)
  // -------------------------------------------------------------------------

  /** Append one engagement transition (closed table, terminal finality). */
  async transitionEngagement(
    command: {
      engagementRef: string;
      transition: EngagementTransitionKind;
      at: string;
      note?: string;
    },
    options: CommandOptions,
  ): Promise<{
    record: import('./engagement.js').EngagementTransitionRecord;
    event: Envelope<EngagementTransitionRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeTransitionEngagementCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify([
      'transition-engagement',
      command.engagementRef,
      command.transition,
      command.at,
      command.note ?? null,
    ]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const replayRecord = this.pool
        .listEngagementTransitions(command.engagementRef)
        .find((record) => record.digest === binding.outcomeDigest);
      if (replayRecord !== undefined) {
        const replayEvent = makeEngagementTransitionRecordedEvent(
          { record: replayRecord },
          { correlationId, idempotencyKey },
        );
        return { record: replayRecord, event: replayEvent };
      }
    }

    const engagement = this.pool.getEngagement(command.engagementRef);
    if (engagement === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no engagement registered at digest ${JSON.stringify(command.engagementRef)}`,
        details: { engagementRef: command.engagementRef },
      });
    }
    const record = await createEngagementTransition({
      engagementRef: engagement.digest,
      tenant: engagement.tenant,
      transition: command.transition,
      at: command.at,
      ...(command.note !== undefined ? { note: command.note } : {}),
    });
    this.pool.registerEngagementTransition(record);
    this.runKeys.set(idempotencyKey, { commandCanonical: canonical, outcomeDigest: record.digest });
    const event = makeEngagementTransitionRecordedEvent(
      { record },
      { correlationId, idempotencyKey },
    );
    this.events.push({ kind: 'engagement-transition-recorded', envelope: event });
    return { record, event };
  }

  // -------------------------------------------------------------------------
  // recordReview (command — completion-gated)
  // -------------------------------------------------------------------------

  /** Record one review (the pool's completion gate runs inside). */
  async recordReview(
    command: { review: import('./review.js').ReviewRecord },
    options: CommandOptions,
  ): Promise<{
    review: import('./review.js').ReviewRecord;
    event: Envelope<ReviewRecordedEventPayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const idempotencyKey: IdempotencyKey = toIdempotencyKey(options.idempotencyKey);
    void makeRecordReviewCommand(command, { correlationId, idempotencyKey });

    const canonical = JSON.stringify(['record-review', command.review.digest]);
    const binding = this.runKeys.get(idempotencyKey);
    if (binding !== undefined && binding.commandCanonical !== canonical) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDEMPOTENCY_CONFLICT, {
        message: `idempotency key ${JSON.stringify(idempotencyKey)} is already bound to a different command`,
        details: { idempotencyKey, bound: binding.commandCanonical, attempted: canonical },
      });
    }
    if (binding !== undefined) {
      const stored = this.pool.getReview(binding.outcomeDigest);
      if (stored !== undefined) {
        const replayEvent = makeReviewRecordedEvent(
          { review: stored },
          { correlationId, idempotencyKey },
        );
        return { review: stored, event: replayEvent };
      }
    }

    this.pool.registerReview(command.review);
    this.runKeys.set(idempotencyKey, {
      commandCanonical: canonical,
      outcomeDigest: command.review.digest,
    });
    const event = makeReviewRecordedEvent(
      { review: command.review },
      { correlationId, idempotencyKey },
    );
    this.events.push({ kind: 'review-recorded', envelope: event });
    return { review: command.review, event };
  }

  // -------------------------------------------------------------------------
  // searchMarketplace (query — pure, no idempotency key)
  // -------------------------------------------------------------------------

  /** Run one marketplace search (envelope round trip). */
  async searchMarketplace(
    query: MarketplaceQueryView | import('./query.js').CreateMarketplaceQueryInput,
    options: QueryOptions,
  ): Promise<{
    result: import('./query.js').MarketplaceSearchResult;
    query: Envelope<MarketplaceSearchQueryPayload>;
    response: Envelope<MarketplaceSearchCompletedResponsePayload>;
  }> {
    const correlationId: CorrelationId = toCorrelationId(options.correlationId);
    const view: MarketplaceQueryView = createMarketplaceQuery(query);
    const queryEnvelope = makeMarketplaceSearchQuery({ query: view }, { correlationId });
    const result = await this.engine.search(this.pool, view, this.stores.expertRecords);
    const response = makeMarketplaceSearchCompletedResponse({ result }, { correlationId });
    return { result, query: queryEnvelope, response };
  }

  // -------------------------------------------------------------------------
  // Observability
  // -------------------------------------------------------------------------

  /** The append-only event log (insertion order, raw envelopes). */
  listEvents(): readonly Envelope<unknown>[] {
    return this.events.map((entry) => entry.envelope);
  }

  /** The event kinds in insertion order (compact observability). */
  listEventKinds(): readonly string[] {
    return this.events.map((entry) => entry.kind);
  }

  /** A deterministic observability dump of the pool state. */
  describe(): {
    listings: number;
    listingStatusRecords: number;
    offers: number;
    offerStatusRecords: number;
    engagements: number;
    engagementTransitions: number;
    reviews: number;
    events: number;
    runKeys: number;
  } {
    return {
      listings: this.pool.listListings().length,
      listingStatusRecords: this.pool.listListings().reduce(
        (sum, listing) => sum + this.pool.listListingStatusRecords(listing.digest).length,
        0,
      ),
      offers: this.pool.listOffers().length,
      offerStatusRecords: this.pool.listOffers().reduce(
        (sum, offer) => sum + this.pool.listOfferStatusRecords(offer.digest).length,
        0,
      ),
      engagements: this.pool.listEngagements().length,
      engagementTransitions: this.pool.listEngagements().reduce(
        (sum, engagement) =>
          sum + this.pool.listEngagementTransitions(engagement.digest).length,
        0,
      ),
      reviews: this.pool.listReviews().length,
      events: this.events.length,
      runKeys: this.runKeys.size,
    };
  }

  /** Resolve one listing or throw NOT_FOUND. */
  private requireListing(listingRef: string): import('./listing.js').ExpertListing {
    const listing = this.pool.getListing(listingRef);
    if (listing === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no listing registered at digest ${JSON.stringify(listingRef)}`,
        details: { listingRef },
      });
    }
    return listing;
  }
}

/** Construct a fresh fabric (convenience). */
export function createExpertMarketplaceFabric(
  pool?: ExpertMarketplacePool,
  stores?: MarketplaceStores,
): ExpertMarketplaceFabric {
  return new ExpertMarketplaceFabric(pool, stores);
}
