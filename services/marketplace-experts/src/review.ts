/**
 * ReviewRecord — the post-completion review/rating of one engagement
 * (Work Order A031; requirement R32 "Measure expert and capability
 * quality"; architecture-lock rules 6, 9, 11).
 *
 * Review discipline (fail-closed):
 *   - a review may ONLY reference a REGISTERED engagement whose CURRENT
 *     derived status is 'completed' (the pool enforces this — reviews of
 *     requested/accepted/declined/cancelled engagements are rejected);
 *   - the rating is a CLOSED integer vocabulary (1..5); the verdict is
 *     DERIVED from the rating by the constructor (positive|neutral|
 *     negative) — no caller-supplied verdict exists (the A023 derived-
 *     statement discipline);
 *   - ONE review per engagement (identity conflict on a second, different
 *     review; re-reviewing requires a new engagement);
 *   - the reviewer must be the engagement's customer, in the engagement's
 *     tenant (cross-tenant review attempts are TENANT_VIOLATIONs).
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import {
  deepFreeze,
  isContentDigest,
  isMarketplaceId,
  isMarketplaceTimestamp,
  isNeutralCustomerId,
  isNeutralText,
  isReviewRating,
  isTenantScope,
  toContentDigest,
  toMarketplaceId,
  toMarketplaceTimestamp,
  toNeutralCustomerId,
  toNeutralText,
  toTenantScope,
  verdictForRating,
} from './shared.js';
import type {
  ContentDigest,
  MarketplaceId,
  MarketplaceTimestamp,
  NeutralCustomerId,
  NeutralText,
  ReviewRating,
  ReviewVerdict,
  TenantScope,
} from './shared.js';

/** Wire version of the review record shape. */
export const REVIEW_RECORD_VERSION = 1 as const;

/** Digest-free view of a review — exactly what the digest covers. */
export interface ReviewContentView {
  readonly recordVersion: typeof REVIEW_RECORD_VERSION;
  readonly reviewId: MarketplaceId;
  /** The tenant of the engagement/listing (scope lock — rule 11). */
  readonly tenant: TenantScope;
  /** The COMPLETED engagement this review evaluates (content digest). */
  readonly engagementRef: string;
  readonly listingRef: string;
  readonly expertId: string;
  /** The reviewing customer (must equal the engagement's customer). */
  readonly customer: NeutralCustomerId;
  /** The closed integer rating 1..5. */
  readonly rating: ReviewRating;
  /** DERIVED from the rating — never caller-supplied. */
  readonly verdict: ReviewVerdict;
  /** The review body (neutral text). */
  readonly text: NeutralText;
  readonly reviewedAt: MarketplaceTimestamp;
}

/** A frozen review record: the content view plus its sha256 digest. */
export interface ReviewRecord extends ReviewContentView {
  readonly digest: ContentDigest;
}

export interface CreateReviewInput {
  readonly reviewId: string;
  readonly tenant: string;
  readonly engagementRef: string;
  readonly listingRef: string;
  readonly expertId: string;
  readonly customer: string;
  readonly rating: number;
  readonly text: string;
  readonly reviewedAt: string;
}

export function isReview(value: unknown): value is ReviewRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== REVIEW_RECORD_VERSION) return false;
  if (!isMarketplaceId(candidate['reviewId'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (!isContentDigest(candidate['engagementRef'])) return false;
  if (!isContentDigest(candidate['listingRef'])) return false;
  if (typeof candidate['expertId'] !== 'string' || candidate['expertId'].length === 0) {
    return false;
  }
  if (!isNeutralCustomerId(candidate['customer'])) return false;
  if (!isReviewRating(candidate['rating'])) return false;
  if (
    candidate['verdict'] !== 'positive' &&
    candidate['verdict'] !== 'neutral' &&
    candidate['verdict'] !== 'negative'
  ) {
    return false;
  }
  if (!isNeutralText(candidate['text'])) return false;
  if (!isMarketplaceTimestamp(candidate['reviewedAt'])) return false;
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one review (verdict DERIVED). */
export async function createReview(input: CreateReviewInput): Promise<ReviewRecord> {
  const reviewId = toMarketplaceId(input.reviewId, 'reviewId');
  const tenant = toTenantScope(input.tenant, 'tenant');
  const engagementRef = toContentDigest(input.engagementRef, 'engagementRef');
  const listingRef = toContentDigest(input.listingRef, 'listingRef');
  if (typeof input.expertId !== 'string' || input.expertId.length === 0) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: 'expertId requires a non-empty string',
      details: { field: 'expertId' },
    });
  }
  const customer = toNeutralCustomerId(input.customer, 'customer');
  if (!isReviewRating(input.rating)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_REVIEW, {
      message: 'rating must be an integer in the closed vocabulary 1..5',
      details: { rating: input.rating },
    });
  }
  const text = toNeutralText(input.text, 'text');
  const reviewedAt = toMarketplaceTimestamp(input.reviewedAt, 'reviewedAt');

  const view: ReviewContentView = {
    recordVersion: REVIEW_RECORD_VERSION,
    reviewId,
    tenant,
    engagementRef,
    listingRef,
    expertId: input.expertId,
    customer,
    rating: input.rating,
    verdict: verdictForRating(input.rating),
    text,
    reviewedAt,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}
