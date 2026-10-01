/**
 * Marketplace query vocabulary (Work Order A032): the closed search /
 * browse query surface over datasets, evaluation suites and
 * environments, mirroring the A025 query-request discipline:
 *
 *   - a closed `MARKETPLACE_QUERY_KINDS` vocabulary;
 *   - every query carries a REQUIRED read scope (no unscoped reads);
 *   - per-kind closed params and closed result vocabularies;
 *   - queries are envelope kind `query` with NULL idempotency key
 *     (reads are not commands).
 */

import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import type {
  MarketplaceOffer,
  MarketplaceOfferState,
  MarketplaceOfferStatus,
  MarketplaceVisibility,
} from './offers.js';
import type { MarketplaceGrant, MarketplaceGrantState } from './grants.js';
import {
  deepFreeze,
  expectEnumMember,
  isMarketplaceId,
  isTenant,
  isPlainObject,
} from './shared.js';

/** Closed query vocabulary. */
export const MARKETPLACE_QUERY_KINDS = Object.freeze([
  'list-offers',
  'get-offer',
  'resolve-offer-status',
  'search-offers',
  'list-reviews',
  'get-grant',
  'list-grants',
] as const);
export type MarketplaceQueryKind = (typeof MARKETPLACE_QUERY_KINDS)[number];

export const MARKETPLACE_QUERY_REQUEST_VERSION = 1 as const;
export const MARKETPLACE_QUERY_RESPONSE_VERSION = 1 as const;

/** Artifact-kind filter (the three domains or 'all'). */
export const MARKETPLACE_KIND_FILTERS = Object.freeze([
  'all',
  'dataset',
  'evaluation-suite',
  'environment',
] as const);
export type MarketplaceKindFilter = (typeof MARKETPLACE_KIND_FILTERS)[number];

/** Read scope: no unscoped reads (fail closed). */
export interface MarketplaceReadScope {
  readonly tenant: string;
}

/** The query request (closed kind + params + REQUIRED scope). */
export interface MarketplaceQueryRequest {
  readonly requestVersion: typeof MARKETPLACE_QUERY_REQUEST_VERSION;
  readonly kind: MarketplaceQueryKind;
  readonly params: MarketplaceQueryParams;
  readonly scope: MarketplaceReadScope;
}

/** The query response (echoed kind + closed result vocabulary). */
export interface MarketplaceQueryResponse {
  readonly responseVersion: typeof MARKETPLACE_QUERY_RESPONSE_VERSION;
  readonly kind: MarketplaceQueryKind;
  readonly result: MarketplaceQueryResultValue;
}

export interface ListOffersParams {
  readonly artifactKind: MarketplaceKindFilter;
}
export interface GetOfferParams {
  readonly offerId: string;
}
export interface ResolveOfferStatusParams {
  readonly offerId: string;
}
export interface SearchOffersParams {
  readonly query: string;
  readonly artifactKind: MarketplaceKindFilter;
}
export interface ListReviewsParams {
  readonly offerId: string;
}
export interface GetGrantParams {
  readonly grantId: string;
}
export interface ListGrantsParams {
  readonly tenant: string;
}

export type MarketplaceQueryParams =
  | ListOffersParams
  | GetOfferParams
  | ResolveOfferStatusParams
  | SearchOffersParams
  | ListReviewsParams
  | GetGrantParams
  | ListGrantsParams;

/** Offer profile (get-offer result). */
export interface MarketplaceOfferProfile {
  readonly offerId: string;
  readonly state: MarketplaceOfferState;
  readonly offerDigest: string | null;
  readonly registration: MarketplaceOffer | null;
  readonly reviewCount: number;
  readonly averageRating: number | null;
}

/** Grant status (get-grant result). */
export interface MarketplaceGrantStatus {
  readonly grantId: string;
  readonly state: MarketplaceGrantState;
  readonly grant: MarketplaceGrant | null;
}

export type MarketplaceQueryResultValue =
  | readonly unknown[]
  | MarketplaceOfferProfile
  | MarketplaceOfferStatus
  | MarketplaceGrantStatus
  | null;

/** Per-kind params field table (closed). */
export const MARKETPLACE_QUERY_PARAMS_FIELDS: Readonly<
  Record<MarketplaceQueryKind, readonly string[]>
> = Object.freeze({
  'list-offers': ['artifactKind'],
  'get-offer': ['offerId'],
  'resolve-offer-status': ['offerId'],
  'search-offers': ['query', 'artifactKind'],
  'list-reviews': ['offerId'],
  'get-grant': ['grantId'],
  'list-grants': ['tenant'],
});

/** Scope guard (tenant pattern; 'public' is a valid READER scope). */
export function isMarketplaceReadScope(value: unknown): value is MarketplaceReadScope {
  return (
    isPlainObject(value) && typeof (value as Record<string, unknown>)['tenant'] === 'string'
  );
}

/** Scope constructor (fail closed on invalid tenants). */
export function toMarketplaceReadScope(tenant: string): MarketplaceReadScope {
  if (!isTenant(tenant)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_SCOPE, {
      message: `read scope tenant must match ${JSON.stringify('^[a-z][a-z0-9-]{1,62}$')}`,
      details: { tenant },
    });
  }
  return deepFreeze({ tenant });
}

/** A tenant is addressable from a scope when it is the scope's own tenant
 * (or the reserved public tenant). */
export function isTenantAddressable(targetTenant: string, scope: MarketplaceReadScope): boolean {
  return targetTenant === scope.tenant || targetTenant === 'public';
}

function expectParams(
  kind: MarketplaceQueryKind,
  value: unknown,
): Record<string, unknown> {
  const fields = MARKETPLACE_QUERY_PARAMS_FIELDS[kind];
  if (!isPlainObject(value)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
      message: `query params for ${JSON.stringify(kind)} must be a plain object`,
      details: { expected: [...fields] },
    });
  }
  for (const field of fields) {
    if (!(field in value)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
        message: `query params for ${JSON.stringify(kind)} are missing ${JSON.stringify(field)}`,
        details: { expected: [...fields] },
      });
    }
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
        message: `query params for ${JSON.stringify(kind)} carry unknown field ${JSON.stringify(key)}`,
        details: { expected: [...fields] },
      });
    }
  }
  return value;
}

/** Request constructor (validates the closed vocabulary; fail closed). */
export function marketplaceQueryRequest(
  kind: MarketplaceQueryKind,
  params: unknown,
  scope: MarketplaceReadScope,
): MarketplaceQueryRequest {
  if (!expectEnumMemberSafe(kind)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_QUERY, {
      message: `unknown marketplace query kind: ${JSON.stringify(kind)}`,
      details: { known: [...MARKETPLACE_QUERY_KINDS] },
    });
  }
  if (!isMarketplaceReadScope(scope)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_SCOPE, {
      message: 'a marketplace query requires a structurally valid read scope',
    });
  }
  const record = expectParams(kind, params);
  const typed = validateParamsFields(kind, record);
  return deepFreeze({
    requestVersion: MARKETPLACE_QUERY_REQUEST_VERSION,
    kind,
    params: typed,
    scope,
  });
}

function expectEnumMemberSafe(kind: string): kind is MarketplaceQueryKind {
  return (
    typeof kind === 'string' &&
    (MARKETPLACE_QUERY_KINDS as readonly string[]).includes(kind)
  );
}

function validateParamsFields(
  kind: MarketplaceQueryKind,
  record: Record<string, unknown>,
): MarketplaceQueryParams {
  switch (kind) {
    case 'list-offers':
      return {
        artifactKind: expectEnumMember(
          record['artifactKind'],
          MARKETPLACE_KIND_FILTERS,
          MARKETPLACE_ERROR_CODES.INVALID_PARAMS,
          'list-offers artifactKind',
        ),
      };
    case 'get-offer':
    case 'resolve-offer-status':
    case 'list-reviews':
      return { offerId: expectOfferId(record['offerId'], kind) };
    case 'search-offers': {
      const query = record['query'];
      if (typeof query !== 'string' || query.length === 0 || query.length > 128) {
        throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
          message: 'search-offers query must be a 1-128 character string',
        });
      }
      return {
        query,
        artifactKind: expectEnumMember(
          record['artifactKind'],
          MARKETPLACE_KIND_FILTERS,
          MARKETPLACE_ERROR_CODES.INVALID_PARAMS,
          'search-offers artifactKind',
        ),
      };
    }
    case 'get-grant':
      return { grantId: expectOfferId(record['grantId'], kind) };
    case 'list-grants': {
      const tenant = record['tenant'];
      if (!isTenant(tenant)) {
        throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
          message: 'list-grants tenant must match the tenant pattern',
        });
      }
      return { tenant };
    }
  }
}

function expectOfferId(value: unknown, kind: MarketplaceQueryKind): string {
  if (!isMarketplaceId(value)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_PARAMS, {
      message: `${JSON.stringify(kind)} requires a marketplace id`,
    });
  }
  return value;
}

/** Structural request guard (non-throwing). */
export function isMarketplaceQueryRequest(
  value: unknown,
): value is MarketplaceQueryRequest {
  if (!isPlainObject(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record['requestVersion'] === MARKETPLACE_QUERY_REQUEST_VERSION &&
    expectEnumMemberSafe(String(record['kind'])) &&
    isMarketplaceReadScope(record['scope'])
  );
}

/** Response constructor (fabric side; validates result closure). */
export function marketplaceQueryResponse(
  kind: MarketplaceQueryKind,
  result: MarketplaceQueryResultValue,
): MarketplaceQueryResponse {
  return deepFreeze({
    responseVersion: MARKETPLACE_QUERY_RESPONSE_VERSION,
    kind,
    result,
  });
}

/** Search normalization (closed semantics: trim + lowercase). */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Visibility filter for listing projections (R24 discipline). */
export function visibleToScope(
  offerTenant: string,
  visibility: MarketplaceVisibility,
  scope: MarketplaceReadScope,
): boolean {
  if (visibility === 'public') return true;
  return offerTenant === scope.tenant;
}
