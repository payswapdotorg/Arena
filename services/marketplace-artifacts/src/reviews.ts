/**
 * Marketplace reviews (Work Order A032): review/rating records with
 * CLOSED vocabularies (integer 1-5 ratings, a three-way verdict) and
 * review gating enforced by the fabric (only principals holding an
 * ACTIVE access grant for the exact offer may review).
 */

import { toPrincipalRef } from '@arena/artifact-protocol';
import type { PrincipalRef } from '@arena/artifact-protocol';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import type { MarketplaceOfferRef } from './offers.js';
import {
  deepFreeze,
  expectDigest,
  isMarketplaceCorrelationId,
  isMarketplaceId,
  isMarketplaceText,
  isMarketplaceTimestamp,
  viewDigest,
} from './shared.js';

export const MARKETPLACE_REVIEW_RECORD_VERSION = 1 as const;

/** Closed rating vocabulary (integer stars 1-5). */
export const MARKETPLACE_REVIEW_RATINGS = Object.freeze([1, 2, 3, 4, 5] as const);
export type MarketplaceReviewRating = (typeof MARKETPLACE_REVIEW_RATINGS)[number];

/** Closed review verdict vocabulary. */
export const MARKETPLACE_REVIEW_VERDICTS = Object.freeze([
  'recommend',
  'mixed',
  'not-recommended',
] as const);
export type MarketplaceReviewVerdict = (typeof MARKETPLACE_REVIEW_VERDICTS)[number];

/** The review record view. */
export interface MarketplaceReviewView {
  readonly recordVersion: typeof MARKETPLACE_REVIEW_RECORD_VERSION;
  readonly reviewId: string;
  readonly offer: MarketplaceOfferRef;
  readonly reviewer: PrincipalRef;
  readonly reviewerTenant: string;
  readonly rating: MarketplaceReviewRating;
  readonly verdict: MarketplaceReviewVerdict;
  readonly body: string;
  readonly submittedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly submittedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** A content-addressed review record. */
export interface MarketplaceReview extends MarketplaceReviewView {
  readonly digest: string;
}

/** Input for review record creation. */
export interface CreateMarketplaceReviewInput {
  readonly reviewId: string;
  readonly offer: { offerId: string; offerDigest: string };
  readonly reviewer: { type: string; tenant: string; principalId: string };
  readonly rating: number;
  readonly verdict: MarketplaceReviewVerdict;
  readonly body: string;
  readonly submittedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly submittedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

function expectRating(value: number): MarketplaceReviewRating {
  if (!MARKETPLACE_REVIEW_RATINGS.includes(value as MarketplaceReviewRating)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: `rating must be one of the closed vocabulary ${JSON.stringify([...MARKETPLACE_REVIEW_RATINGS])}`,
      details: { rating: value },
    });
  }
  return value as MarketplaceReviewRating;
}

function expectVerdict(value: MarketplaceReviewVerdict): MarketplaceReviewVerdict {
  if (!MARKETPLACE_REVIEW_VERDICTS.includes(value)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: `verdict must be one of the closed vocabulary ${JSON.stringify([...MARKETPLACE_REVIEW_VERDICTS])}`,
    });
  }
  return value;
}

/** Create one content-addressed, deep-frozen review record. */
export async function createMarketplaceReviewRecord(
  input: CreateMarketplaceReviewInput,
): Promise<MarketplaceReview> {
  if (!isMarketplaceId(input.reviewId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'reviewId must match the marketplace id pattern',
    });
  }
  if (!isMarketplaceId(input.offer.offerId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review offer.offerId must match the marketplace id pattern',
    });
  }
  expectDigest(input.offer.offerDigest, MARKETPLACE_ERROR_CODES.INVALID_REVIEW, 'review offer.offerDigest');
  if (!isMarketplaceCorrelationId(input.correlationId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review correlationId must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceCorrelationId(input.idempotencyKey)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review idempotencyKey must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceId(input.provenance.submittedBy)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review provenance.submittedBy must be a marketplace id',
    });
  }
  if (!isMarketplaceTimestamp(input.submittedAt)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review submittedAt must be a ms-precision UTC timestamp',
    });
  }
  if (!isMarketplaceTimestamp(input.provenance.recordedAt)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review provenance.recordedAt must be a ms-precision UTC timestamp',
    });
  }
  if (!isMarketplaceText(input.body)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_REVIEW, {
      message: 'review body must be 1-512 neutral characters',
    });
  }
  const reviewer = toPrincipalRef(input.reviewer);
  const rating = expectRating(input.rating);
  const verdict = expectVerdict(input.verdict);

  const view: MarketplaceReviewView = {
    recordVersion: MARKETPLACE_REVIEW_RECORD_VERSION,
    reviewId: input.reviewId,
    offer: deepFreeze({ ...input.offer }),
    reviewer,
    reviewerTenant: reviewer.tenant,
    rating,
    verdict,
    body: input.body,
    submittedAt: input.submittedAt,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    provenance: {
      submittedBy: input.provenance.submittedBy,
      recordedAt: input.provenance.recordedAt,
      notes: input.provenance.notes,
    },
  };

  const digest = await viewDigest(view);
  return deepFreeze({ ...view, digest });
}

/** Average rating over a review set (null over the empty set). */
export function averageRatingOf(reviews: readonly MarketplaceReview[]): number | null {
  if (reviews.length === 0) return null;
  const total = reviews.reduce((sum, review) => sum + review.rating, 0);
  return Math.round((total / reviews.length) * 100) / 100;
}
