/**
 * The marketplace search/browse query surface (Work Order A031;
 * requirements R31, R32; architecture-lock rules 11, 18).
 *
 * A search is a PURE, tenant-scoped query over the marketplace pool:
 * the tenant filter runs FIRST (cross-tenant listings are INVISIBLE,
 * never merely unmatched — lock rule 11), only LISTED listings surface,
 * and every filter/sort operates on closed vocabularies with
 * deterministic tie-breaks (content digests). Ratings and engagement
 * aggregates are RECOMPUTED from the append-only history on every
 * query — the pool stores no standings (the A006 reliability
 * discipline).
 */

import { MARKETPLACE_EXPERTS_ERROR_CODES, MarketplaceExpertsError } from './errors.js';
import {
  isJurisdiction,
  isMarketplaceTimestamp,
  isReviewRating,
  isTenantScope,
  isCurrencyCode,
  isCapabilityNodeId,
  toMarketplaceTimestamp,
  toNonNegativeInteger,
  toPositiveInteger,
  toTenantScope,
} from './shared.js';
import type {
  AvailabilityWindowView,
  JurisdictionView,
  RateView,
} from './shared.js';
import type { QualificationProof, VerifiedQualificationProof } from './listing.js';

/** Wire version of the query shape. */
export const MARKETPLACE_QUERY_VERSION = 1 as const;

/** The closed sort vocabulary. */
export const MARKETPLACE_SORTS = Object.freeze([
  'relevance',
  'rate-asc',
  'rate-desc',
  'rating-desc',
  'recent',
] as const);
export type MarketplaceSort = (typeof MARKETPLACE_SORTS)[number];

export function isMarketplaceSort(value: unknown): value is MarketplaceSort {
  return typeof value === 'string' && (MARKETPLACE_SORTS as readonly string[]).includes(value);
}

/** The default + maximum result limits (closed integers). */
export const MARKETPLACE_DEFAULT_LIMIT = 50 as const;
export const MARKETPLACE_MAX_LIMIT = 200 as const;

/** Digest-free view of one marketplace search query. */
export interface MarketplaceQueryView {
  readonly recordVersion: typeof MARKETPLACE_QUERY_VERSION;
  /** REQUIRED tenant scope — the query never sees other tenants. */
  readonly tenant: string;
  /** The fixed evaluation time (determinism anchor). */
  readonly evaluatedAt: string;
  /** Optional capability-node filter (matches capabilityRefs[].id). */
  readonly capability?: string;
  /** Optional domain filter (matches domainRefs[].id). */
  readonly domain?: string;
  /** Optional jurisdiction filter. */
  readonly jurisdiction?: JurisdictionView;
  /**
   * Optional maximum rate (minor units) — requires `currency` and keeps
   * only listings with ≥1 active offer at or under the bound.
   */
  readonly maxRateMinor?: number;
  readonly currency?: string;
  /** Optional minimum average rating (requires ≥1 review — fail-closed). */
  readonly minRating?: number;
  readonly sort: MarketplaceSort;
  readonly limit: number;
}

export interface CreateMarketplaceQueryInput {
  readonly tenant: string;
  readonly evaluatedAt: string;
  readonly capability?: string;
  readonly domain?: string;
  readonly jurisdiction?: JurisdictionView;
  readonly maxRateMinor?: number;
  readonly currency?: string;
  readonly minRating?: number;
  readonly sort?: MarketplaceSort;
  readonly limit?: number;
}

export function isMarketplaceQuery(value: unknown): value is MarketplaceQueryView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== MARKETPLACE_QUERY_VERSION) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (typeof candidate['evaluatedAt'] !== 'string' || !isMarketplaceTimestamp(candidate['evaluatedAt'])) {
    return false;
  }
  if (candidate['capability'] !== undefined && !isCapabilityNodeId(candidate['capability'])) {
    return false;
  }
  if (candidate['domain'] !== undefined && !isCapabilityNodeId(candidate['domain'])) {
    return false;
  }
  if (candidate['jurisdiction'] !== undefined && !isJurisdiction(candidate['jurisdiction'])) {
    return false;
  }
  if (candidate['maxRateMinor'] !== undefined) {
    if (
      typeof candidate['maxRateMinor'] !== 'number' ||
      !Number.isInteger(candidate['maxRateMinor']) ||
      candidate['maxRateMinor'] < 0
    ) {
      return false;
    }
    if (candidate['currency'] === undefined || !isCurrencyCode(candidate['currency'])) {
      return false;
    }
  }
  if (candidate['minRating'] !== undefined && !isReviewRating(candidate['minRating'])) {
    return false;
  }
  if (!isMarketplaceSort(candidate['sort'])) return false;
  if (
    typeof candidate['limit'] !== 'number' ||
    !Number.isInteger(candidate['limit']) ||
    candidate['limit'] <= 0 ||
    candidate['limit'] > MARKETPLACE_MAX_LIMIT
  ) {
    return false;
  }
  return true;
}

/** Construct + validate + freeze one marketplace search query. */
export function createMarketplaceQuery(input: CreateMarketplaceQueryInput): MarketplaceQueryView {
  const tenant = toTenantScope(input.tenant, 'tenant');
  const evaluatedAt = toMarketplaceTimestamp(input.evaluatedAt, 'evaluatedAt');
  if (input.capability !== undefined && !isCapabilityNodeId(input.capability)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'capability filter must be a capability-graph node id',
      details: { capability: input.capability },
    });
  }
  if (input.domain !== undefined && !isCapabilityNodeId(input.domain)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'domain filter must be a capability-graph node id',
      details: { domain: input.domain },
    });
  }
  if (input.jurisdiction !== undefined && !isJurisdiction(input.jurisdiction)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'jurisdiction filter must be {country, region?}',
      details: { jurisdiction: input.jurisdiction },
    });
  }
  let maxRateMinor: number | undefined;
  let currency: string | undefined;
  if (input.maxRateMinor !== undefined) {
    maxRateMinor = toNonNegativeInteger(input.maxRateMinor, 'maxRateMinor');
    if (input.currency === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
        message: 'maxRateMinor requires the matching currency code',
        details: { maxRateMinor },
      });
    }
    if (!isCurrencyCode(input.currency)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
        message: 'currency requires an ISO 4217 alpha-3 code',
        details: { currency: input.currency },
      });
    }
    currency = input.currency;
  } else if (input.currency !== undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'currency is only valid together with maxRateMinor',
      details: { currency: input.currency },
    });
  }
  if (input.minRating !== undefined && !isReviewRating(input.minRating)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'minRating must be an integer in the closed vocabulary 1..5',
      details: { minRating: input.minRating },
    });
  }
  const sort: MarketplaceSort = input.sort ?? 'relevance';
  if (!isMarketplaceSort(sort)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: 'sort must be one of relevance|rate-asc|rate-desc|rating-desc|recent',
      details: { sort: input.sort },
    });
  }
  const limit = input.limit === undefined ? MARKETPLACE_DEFAULT_LIMIT : input.limit;
  const checkedLimit = toPositiveInteger(limit, 'limit');
  if (checkedLimit > MARKETPLACE_MAX_LIMIT) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_QUERY, {
      message: `limit must be at most ${MARKETPLACE_MAX_LIMIT}`,
      details: { limit: checkedLimit, max: MARKETPLACE_MAX_LIMIT },
    });
  }
  const view: MarketplaceQueryView = {
    recordVersion: MARKETPLACE_QUERY_VERSION,
    tenant,
    evaluatedAt,
    ...(input.capability !== undefined ? { capability: input.capability } : {}),
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    ...(input.jurisdiction !== undefined
      ? { jurisdiction: Object.freeze({ ...input.jurisdiction }) }
      : {}),
    ...(maxRateMinor !== undefined ? { maxRateMinor } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(input.minRating !== undefined ? { minRating: input.minRating } : {}),
    sort,
    limit: checkedLimit,
  };
  return Object.freeze(view);
}

// ---------------------------------------------------------------------------
// The result surface
// ---------------------------------------------------------------------------

/** Wire version of the result shape. */
export const MARKETPLACE_RESULT_VERSION = 1 as const;

/** One active offer projected onto a listing card. */
export interface ListingOfferCard {
  readonly offerRef: string;
  readonly offerId: string;
  readonly kind: string;
  readonly headline: string;
  readonly rate: RateView;
  readonly minNoticeHours: number;
  readonly maxDurationHours: number;
  readonly availability: readonly AvailabilityWindowView[];
  readonly backingReleaseRef?: string;
}

/** Aggregates RECOMPUTED from the append-only history (never stored). */
export interface ListingStats {
  readonly engagements: number;
  readonly completed: number;
  readonly reviews: number;
  /** Mean rating over reviews (null when no reviews — never a fake 0). */
  readonly averageRating: number | null;
}

/** One listing card in a search result. */
export interface MarketplaceListingCard {
  readonly listingRef: string;
  readonly listingId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly headline: string;
  readonly description: string;
  readonly capabilityRefs: readonly { readonly kind: string; readonly id: string; readonly version: string }[];
  readonly domainRefs: readonly { readonly kind: string; readonly id: string; readonly version: string }[];
  readonly jurisdictions: readonly JurisdictionView[];
  readonly qualificationProofs: readonly QualificationProof[];
  /** Gate-verified proof state at the query time (recomputed). */
  readonly inForceProofs: readonly VerifiedQualificationProof[];
  readonly activeOffers: readonly ListingOfferCard[];
  /** The cheapest active offer rate (null when no active offers). */
  readonly cheapestRate: RateView | null;
  readonly stats: ListingStats;
  readonly publishedAt: string | null;
}

/** The authoritative search result. */
export interface MarketplaceSearchResult {
  readonly recordVersion: typeof MARKETPLACE_RESULT_VERSION;
  readonly tenant: string;
  readonly evaluatedAt: string;
  readonly sort: MarketplaceSort;
  readonly totalMatches: number;
  readonly truncated: boolean;
  readonly cards: readonly MarketplaceListingCard[];
}

export function isMarketplaceSearchResult(value: unknown): value is MarketplaceSearchResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== MARKETPLACE_RESULT_VERSION) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (typeof candidate['evaluatedAt'] !== 'string') return false;
  if (!isMarketplaceSort(candidate['sort'])) return false;
  if (typeof candidate['totalMatches'] !== 'number' || !Number.isInteger(candidate['totalMatches'])) {
    return false;
  }
  if (typeof candidate['truncated'] !== 'boolean') return false;
  return Array.isArray(candidate['cards']);
}
