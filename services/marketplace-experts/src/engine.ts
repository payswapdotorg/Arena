/**
 * ExpertMarketplaceEngine — the deterministic, PURE search engine over
 * the marketplace pool (Work Order A031; mirrors the A007
 * ExpertMatchingEngine discipline).
 *
 * Filter order (fixed precedence, all closed vocabularies):
 *   1. TENANT FILTER FIRST — listings of other tenants are INVISIBLE,
 *      never merely unmatched (lock rule 11);
 *   2. only listings whose CURRENT recomputed status is 'listed';
 *   3. optional capability / domain / jurisdiction filters;
 *   4. optional max-rate filter (≥1 active offer under the bound, in the
 *      query currency);
 *   5. optional minimum-average-rating filter (fail-closed: a listing
 *      with NO reviews cannot satisfy a minimum rating).
 *
 * Sorting is deterministic with digest tie-breaks; aggregates and the
 * in-force proof projection are RECOMPUTED from the append-only history
 * at the query's fixed evaluatedAt. No clocks, no randomness.
 */

import type {
  ListingOfferCard,
  MarketplaceListingCard,
  MarketplaceQueryView,
  MarketplaceSearchResult,
} from './query.js';
import { MARKETPLACE_RESULT_VERSION } from './query.js';
import type { ExpertMarketplacePool } from './pool.js';
import type { VerifiedQualificationProof } from './listing.js';
import type { MarketplaceExpertRecordStore, RateView } from './shared.js';

/** Compare two ratings with null sorting LAST (no fake zeros). */
function compareRatingsDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (a === b) return 0;
  return a < b ? 1 : -1;
}

/** The cheapest rate among active offers (null when none). */
function cheapestRateOf(offers: readonly ListingOfferCard[]): RateView | null {
  if (offers.length === 0) return null;
  const sorted = [...offers].sort((a, b) =>
    a.rate.amountMinor === b.rate.amountMinor
      ? a.rate.currency < b.rate.currency
        ? -1
        : 1
      : a.rate.amountMinor < b.rate.amountMinor
        ? -1
        : 1,
  );
  const cheapest = sorted[0];
  return cheapest === undefined ? null : cheapest.rate;
}

/** The deterministic pure search engine. */
export class ExpertMarketplaceEngine {
  /**
   * Run one query against one pool. Pure: the same pool + the same query
   * + the same injected store always produce the same result.
   *
   * The optional expert-record store resolves the CURRENT state of each
   * listing's qualification proofs (they may have decayed since the
   * publish gate verified them — the projection is honest, never
   * stale-trusting; an unresolvable record displays as NOT in force).
   */
  async search(
    pool: ExpertMarketplacePool,
    query: MarketplaceQueryView,
    expertRecords?: MarketplaceExpertRecordStore,
  ): Promise<MarketplaceSearchResult> {
    // 1. Tenant filter FIRST (rule 11 — cross-tenant listings are invisible).
    const tenantListings = pool
      .listListings()
      .filter((listing) => listing.tenant === query.tenant);

    // 2. Only currently-listed listings surface.
    const listed = tenantListings.filter(
      (listing) => pool.currentListingStatus(listing.digest) === 'listed',
    );

    // 3. Structured filters.
    const filtered = listed.filter((listing) => {
      if (
        query.capability !== undefined &&
        !listing.capabilityRefs.some((ref) => ref.id === query.capability)
      ) {
        return false;
      }
      if (
        query.domain !== undefined &&
        !listing.domainRefs.some((ref) => ref.id === query.domain)
      ) {
        return false;
      }
      if (query.jurisdiction !== undefined) {
        const wanted = query.jurisdiction;
        const matches = listing.jurisdictions.some(
          (entry) =>
            entry.country === wanted.country &&
            (wanted.region === undefined || entry.region === wanted.region),
        );
        if (!matches) return false;
      }
      return true;
    });

    // Project cards (active offers + recomputed stats + in-force proofs).
    const cards: MarketplaceListingCard[] = [];
    for (const listing of filtered) {
      const activeOffers = pool
        .activeOffersForListing(listing.digest, query.evaluatedAt)
        .map(
          (offer): ListingOfferCard =>
            Object.freeze({
              offerRef: offer.digest,
              offerId: offer.offerId,
              kind: offer.kind,
              headline: offer.headline,
              rate: offer.rate,
              minNoticeHours: offer.minNoticeHours,
              maxDurationHours: offer.maxDurationHours,
              availability: offer.availability,
              ...(offer.backingReleaseRef !== undefined
                ? { backingReleaseRef: offer.backingReleaseRef }
                : {}),
            }),
        );
      const stats = pool.listingStats(listing.digest);
      const inForceProofs: VerifiedQualificationProof[] = [];
      for (const proof of listing.qualificationProofs) {
        const record =
          expertRecords === undefined
            ? undefined
            : await expertRecords.getQualificationRecord(proof.recordRef);
        const recordValidFrom = record?.validFrom ?? '';
        const recordValidUntil = record?.validUntil ?? '';
        inForceProofs.push(
          Object.freeze({
            claimRef: proof.claimRef,
            recordRef: proof.recordRef,
            recordStatus: record?.status ?? 'unresolved',
            validFrom: recordValidFrom,
            validUntil: recordValidUntil,
            inForce:
              record !== undefined &&
              record.status === 'qualified' &&
              recordValidFrom !== '' &&
              recordValidUntil !== '' &&
              recordValidFrom <= query.evaluatedAt &&
              query.evaluatedAt <= recordValidUntil,
          }),
        );
      }
      cards.push(
        Object.freeze({
          listingRef: listing.digest,
          listingId: listing.listingId,
          tenant: listing.tenant,
          expertId: listing.expertId,
          headline: listing.headline,
          description: listing.description,
          capabilityRefs: listing.capabilityRefs.map((ref) =>
            Object.freeze({ kind: ref.kind, id: ref.id, version: ref.version }),
          ),
          domainRefs: listing.domainRefs.map((ref) =>
            Object.freeze({ kind: ref.kind, id: ref.id, version: ref.version }),
          ),
          jurisdictions: listing.jurisdictions,
          qualificationProofs: listing.qualificationProofs,
          inForceProofs: Object.freeze(inForceProofs),
          activeOffers: Object.freeze(activeOffers),
          cheapestRate: cheapestRateOf(activeOffers),
          stats,
          publishedAt: pool.listingPublishedAt(listing.digest),
        }),
      );
    }

    // 4. Rate filter (after projection — needs active offers).
    const rateFiltered =
      query.maxRateMinor === undefined
        ? cards
        : cards.filter((card) =>
            card.activeOffers.some(
              (offer) =>
                offer.rate.currency === query.currency &&
                offer.rate.amountMinor <= (query.maxRateMinor as number),
            ),
          );

    // 5. Minimum-rating filter (fail-closed on no reviews).
    const ratingFiltered =
      query.minRating === undefined
        ? rateFiltered
        : rateFiltered.filter(
            (card) =>
              card.stats.averageRating !== null &&
              card.stats.averageRating >= (query.minRating as number),
          );

    // Deterministic sorting with digest tie-breaks.
    const sorted = [...ratingFiltered].sort((a, b) => {
      switch (query.sort) {
        case 'rate-asc':
        case 'rate-desc': {
          const aHas = a.cheapestRate !== null;
          const bHas = b.cheapestRate !== null;
          if (aHas !== bHas) return aHas ? -1 : 1;
          if (aHas && bHas) {
            const aRate = a.cheapestRate as RateView;
            const bRate = b.cheapestRate as RateView;
            if (aRate.amountMinor !== bRate.amountMinor) {
              const asc = aRate.amountMinor < bRate.amountMinor ? -1 : 1;
              return query.sort === 'rate-asc' ? asc : -asc;
            }
          }
          break;
        }
        case 'rating-desc': {
          const byRating = compareRatingsDesc(a.stats.averageRating, b.stats.averageRating);
          if (byRating !== 0) return byRating;
          break;
        }
        case 'recent': {
          const aTime = a.publishedAt ?? '';
          const bTime = b.publishedAt ?? '';
          if (aTime !== bTime) return aTime < bTime ? 1 : -1;
          break;
        }
        case 'relevance':
        default: {
          const aProofs = a.inForceProofs.filter((proof) => proof.inForce).length;
          const bProofs = b.inForceProofs.filter((proof) => proof.inForce).length;
          if (aProofs !== bProofs) return aProofs < bProofs ? 1 : -1;
          const byRating = compareRatingsDesc(a.stats.averageRating, b.stats.averageRating);
          if (byRating !== 0) return byRating;
          break;
        }
      }
      return a.listingRef < b.listingRef ? -1 : 1;
    });

    const limited = sorted.slice(0, query.limit);
    return Object.freeze({
      recordVersion: MARKETPLACE_RESULT_VERSION,
      tenant: query.tenant,
      evaluatedAt: query.evaluatedAt,
      sort: query.sort,
      totalMatches: sorted.length,
      truncated: sorted.length > limited.length,
      cards: Object.freeze(limited),
    });
  }
}

/** Construct a fresh engine (convenience). */
export function createExpertMarketplaceEngine(): ExpertMarketplaceEngine {
  return new ExpertMarketplaceEngine();
}
