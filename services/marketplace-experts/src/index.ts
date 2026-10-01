/**
 * @arena/marketplace-experts-fabric — the A031 reference expert
 * marketplace fabric (in-process pool + pure search engine + command/
 * query orchestration over the REAL sibling domain protocols).
 *
 * Public surface:
 *   - errors.ts / shared.ts — closed error taxonomy, branded scalars,
 *     closed commercial vocabularies, injected evidence-store contracts;
 *   - listing.ts — ExpertListing, ListingStatusRecord, the A007
 *     qualification publish gate (verifyListingGate);
 *   - offer.ts — CommercialOffer, OfferStatusRecord, the A024+A023
 *     body-backed gate (verifyOfferBackingGate);
 *   - engagement.ts — EngagementRecord, EngagementTransitionRecord, the
 *     closed engagement transition table;
 *   - review.ts — ReviewRecord (completion-gated, derived verdicts);
 *   - query.ts — MarketplaceQuery + MarketplaceSearchResult surfaces;
 *   - envelopes.ts — the envelope wiring (commands REQUIRE idempotency
 *     keys — lock rule 17);
 *   - pool.ts — ExpertMarketplacePool (append-only, idempotent,
 *     identity/supersession discipline, recomputed statuses+aggregates);
 *   - engine.ts — ExpertMarketplaceEngine (deterministic, tenant-first
 *     pure search);
 *   - fabric.ts — ExpertMarketplaceFabric (command orchestration + event
 *     log + the search query round trip).
 */

export * from './errors.js';
export * from './shared.js';
export * from './listing.js';
export * from './offer.js';
export * from './engagement.js';
export * from './review.js';
export * from './query.js';
export * from './envelopes.js';
export * from './pool.js';
export * from './engine.js';
export * from './fabric.js';
