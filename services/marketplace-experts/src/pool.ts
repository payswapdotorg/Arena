/**
 * ExpertMarketplacePool — the in-process reference registry of listings,
 * listing-status records, commercial offers, offer-status records,
 * engagements, engagement transitions and reviews (Work Order A031;
 * mirrors the A007 QualifiedExpertPool discipline).
 *
 * Registration discipline (fail-closed everywhere):
 *   - every register* API is IDEMPOTENT by content digest;
 *   - a DIFFERENT digest under the same identity key
 *     ((tenant, expertId, listingId) for listings, (tenant, expertId,
 *     offerId) for offers, (tenant, engagementId) for engagements,
 *     engagementRef for reviews) is an IDENTITY_CONFLICT — changing an
 *     object requires a superseding append, never a silent redefinition;
 *   - supersession chains must reference a REGISTERED record of the SAME
 *     identity (SUPERSESSION_CONFLICT);
 *   - an offer REQUIRES its registered listing; a body-backed offer's
 *     release gate is verified by the FABRIC (never trusted on the wire);
 *   - an engagement REQUIRES its listing AND offer registered, the offer
 *     must belong to the same listing + tenant, and the offer must be
 *     ACTIVE and in its validity window at the requestedAt time —
 *     cross-tenant engagements are TENANT_VIOLATIONs (invisible is for
 *     QUERIES; commands fail loudly);
 *   - engagement transitions are validated against the closed table with
 *     terminal finality (a transition after a terminal state throws
 *     LIFECYCLE_VIOLATION);
 *   - a review REQUIRES its engagement registered, CURRENT status
 *     'completed' (the review gate), matching customer + tenant + listing
 *     + expert, and is ONE-PER-ENGAGEMENT (identity conflict);
 *   - everything is APPEND-ONLY: no update/delete APIs exist; statuses
 *     and aggregates are RECOMPUTED from history on every read.
 */

import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import { commercialOfferIdentityKey } from './offer.js';
import {
  ENGAGEMENT_TRANSITION_TABLE,
  engagementIdentityKey,
} from './engagement.js';
import type {
  EngagementRecord,
  EngagementTransitionRecord,
} from './engagement.js';
import { expertListingIdentityKey, LISTING_TRANSITION_TABLE } from './listing.js';
import type { ExpertListing, ListingStatusRecord } from './listing.js';
import type { CommercialOffer, OfferStatusRecord } from './offer.js';
import type { ReviewRecord } from './review.js';
import type { ListingStats } from './query.js';

/** The in-process reference marketplace pool. */
export class ExpertMarketplacePool {
  /** Listings by digest; identity key → digest. */
  private readonly listingsByDigest = new Map<string, ExpertListing>();
  private readonly listingIdentities = new Map<string, string>();
  /** Listing status records by digest; listingRef → record digests. */
  private readonly listingStatusByDigest = new Map<string, ListingStatusRecord>();
  private readonly listingStatusByListing = new Map<string, string[]>();
  /** Offers by digest; identity key → digest chain; listingRef → offer digests. */
  private readonly offersByDigest = new Map<string, CommercialOffer>();
  private readonly offerIdentities = new Map<string, string>();
  private readonly offersByListing = new Map<string, string[]>();
  /** Offer status records by digest; offerRef → record digests. */
  private readonly offerStatusByDigest = new Map<string, OfferStatusRecord>();
  private readonly offerStatusByOffer = new Map<string, string[]>();
  /** Engagements by digest; identity key → digest. */
  private readonly engagementsByDigest = new Map<string, EngagementRecord>();
  private readonly engagementIdentities = new Map<string, string>();
  /** Engagement transitions by digest; engagementRef → record digests. */
  private readonly engagementTransitionsByDigest = new Map<string, EngagementTransitionRecord>();
  private readonly engagementTransitionsByEngagement = new Map<string, string[]>();
  /** Reviews by digest; engagementRef → review digest (one per engagement). */
  private readonly reviewsByDigest = new Map<string, ReviewRecord>();
  private readonly reviewByEngagement = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Listings
  // -------------------------------------------------------------------------

  /** Register a listing (idempotent by digest; identity conflicts fail). */
  registerListing(listing: ExpertListing): ExpertListing {
    const identity = expertListingIdentityKey(listing);
    const existingDigest = this.listingIdentities.get(identity);
    if (existingDigest !== undefined && existingDigest !== listing.digest) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `listing identity ${JSON.stringify(identity)} is already registered with a different digest (changing a listing requires a superseding append)`,
        details: { identity, registeredDigest: existingDigest, attemptedDigest: listing.digest },
      });
    }
    const existing = this.listingsByDigest.get(listing.digest);
    if (existing !== undefined) return existing;
    if (listing.supersedes !== undefined) {
      const superseded = this.listingsByDigest.get(listing.supersedes);
      if (superseded === undefined) {
        throw new MarketplaceExpertsError(
          MARKETPLACE_EXPERTS_ERROR_CODES.SUPERSESSION_CONFLICT,
          {
            message: `listing supersedes an unregistered listing digest ${listing.supersedes} (lineage is auditable or absent)`,
            details: { supersedes: listing.supersedes },
          },
        );
      }
      if (expertListingIdentityKey(superseded) !== identity) {
        throw new MarketplaceExpertsError(
          MARKETPLACE_EXPERTS_ERROR_CODES.SUPERSESSION_CONFLICT,
          {
            message: `listing supersedes a listing of a DIFFERENT identity (${expertListingIdentityKey(superseded)})`,
            details: { supersedes: listing.supersedes },
          },
        );
      }
    }
    this.listingsByDigest.set(listing.digest, listing);
    this.listingIdentities.set(identity, listing.digest);
    return listing;
  }

  /** Look up a listing by digest. */
  getListing(digest: string): ExpertListing | undefined {
    return this.listingsByDigest.get(digest);
  }

  /** All registered listings (insertion order). */
  listListings(): readonly ExpertListing[] {
    return [...this.listingsByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Listing status records (append-only lifecycle)
  // -------------------------------------------------------------------------

  /** Register a listing-status record (validated against the transition table). */
  registerListingStatusRecord(record: ListingStatusRecord): ListingStatusRecord {
    const existing = this.listingStatusByDigest.get(record.digest);
    if (existing !== undefined) return existing;
    const listing = this.listingsByDigest.get(record.listingRef);
    if (listing === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no listing registered at digest ${record.listingRef} (transitions require a registered listing)`,
        details: { listingRef: record.listingRef },
      });
    }
    if (listing.tenant !== record.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'listing transitions must stay inside the listing tenant (lock rule 11)',
        details: { listingTenant: listing.tenant, recordTenant: record.tenant },
      });
    }
    const current = this.currentListingStatus(record.listingRef);
    const allowed = LISTING_TRANSITION_TABLE[record.transition];
    if (!(allowed.from as readonly string[]).includes(current)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION, {
        message: `listing transition '${record.transition}' is invalid from status '${current}'${current === 'delisted' ? ' (terminal — delisted listings are final)' : ''}`,
        details: { listingRef: record.listingRef, transition: record.transition, currentStatus: current },
      });
    }
    this.listingStatusByDigest.set(record.digest, record);
    const chain = this.listingStatusByListing.get(record.listingRef) ?? [];
    chain.push(record.digest);
    this.listingStatusByListing.set(record.listingRef, chain);
    return record;
  }

  /** The CURRENT listing status — recomputed from the append-only history. */
  currentListingStatus(listingRef: string): string {
    const chain = this.listingStatusByListing.get(listingRef) ?? [];
    let status = 'draft';
    for (const digest of chain) {
      const record = this.listingStatusByDigest.get(digest);
      if (record === undefined) continue;
      status = LISTING_TRANSITION_TABLE[record.transition].to;
    }
    return status;
  }

  /** All status records of one listing (append/insertion order). */
  listListingStatusRecords(listingRef: string): readonly ListingStatusRecord[] {
    const chain = this.listingStatusByListing.get(listingRef) ?? [];
    return chain
      .map((digest) => this.listingStatusByDigest.get(digest))
      .filter((record): record is ListingStatusRecord => record !== undefined);
  }

  /** The publication time of one listing (first publish transition; null when never published). */
  listingPublishedAt(listingRef: string): string | null {
    const records = this.listListingStatusRecords(listingRef);
    const published = records.find((record) => record.transition === 'publish');
    return published === undefined ? null : published.at;
  }

  // -------------------------------------------------------------------------
  // Commercial offers
  // -------------------------------------------------------------------------

  /** Register a commercial offer (idempotent; requires its listing). */
  registerOffer(offer: CommercialOffer): CommercialOffer {
    const identity = commercialOfferIdentityKey(offer);
    const existingDigest = this.offerIdentities.get(identity);
    if (existingDigest !== undefined && existingDigest !== offer.digest) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `offer identity ${JSON.stringify(identity)} is already registered with a different digest (re-pricing requires a superseding append)`,
        details: { identity, registeredDigest: existingDigest, attemptedDigest: offer.digest },
      });
    }
    const existing = this.offersByDigest.get(offer.digest);
    if (existing !== undefined) return existing;
    const listing = this.listingsByDigest.get(offer.listingRef);
    if (listing === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no listing registered at digest ${offer.listingRef} (offers attach to registered listings)`,
        details: { listingRef: offer.listingRef },
      });
    }
    if (
      listing.tenant !== offer.tenant ||
      listing.expertId !== offer.expertId
    ) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'offer identity must match its listing (tenant + expertId)',
        details: {
          listingTenant: listing.tenant,
          offerTenant: offer.tenant,
          listingExpertId: listing.expertId,
          offerExpertId: offer.expertId,
        },
      });
    }
    if (offer.supersedes !== undefined) {
      const superseded = this.offersByDigest.get(offer.supersedes);
      if (superseded === undefined) {
        throw new MarketplaceExpertsError(
          MARKETPLACE_EXPERTS_ERROR_CODES.SUPERSESSION_CONFLICT,
          {
            message: `offer supersedes an unregistered offer digest ${offer.supersedes}`,
            details: { supersedes: offer.supersedes },
          },
        );
      }
      if (commercialOfferIdentityKey(superseded) !== identity) {
        throw new MarketplaceExpertsError(
          MARKETPLACE_EXPERTS_ERROR_CODES.SUPERSESSION_CONFLICT,
          {
            message: `offer supersedes an offer of a DIFFERENT identity (${commercialOfferIdentityKey(superseded)})`,
            details: { supersedes: offer.supersedes },
          },
        );
      }
    }
    this.offersByDigest.set(offer.digest, offer);
    this.offerIdentities.set(identity, offer.digest);
    const chain = this.offersByListing.get(offer.listingRef) ?? [];
    chain.push(offer.digest);
    this.offersByListing.set(offer.listingRef, chain);
    return offer;
  }

  /** Look up an offer by digest. */
  getOffer(digest: string): CommercialOffer | undefined {
    return this.offersByDigest.get(digest);
  }

  /** All offers attached to one listing (insertion order). */
  offersForListing(listingRef: string): readonly CommercialOffer[] {
    const chain = this.offersByListing.get(listingRef) ?? [];
    return chain
      .map((digest) => this.offersByDigest.get(digest))
      .filter((offer): offer is CommercialOffer => offer !== undefined);
  }

  /** All registered offers (insertion order). */
  listOffers(): readonly CommercialOffer[] {
    return [...this.offersByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Offer status records (append-only withdrawal, terminal)
  // -------------------------------------------------------------------------

  /** Register an offer-status record (withdrawal; terminal finality). */
  registerOfferStatusRecord(record: OfferStatusRecord): OfferStatusRecord {
    const existing = this.offerStatusByDigest.get(record.digest);
    if (existing !== undefined) return existing;
    const offer = this.offersByDigest.get(record.offerRef);
    if (offer === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no offer registered at digest ${record.offerRef}`,
        details: { offerRef: record.offerRef },
      });
    }
    if (offer.tenant !== record.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'offer transitions must stay inside the offer tenant (lock rule 11)',
        details: { offerTenant: offer.tenant, recordTenant: record.tenant },
      });
    }
    const current = this.currentOfferStatus(record.offerRef);
    if (current === 'withdrawn') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION, {
        message: "offer is already 'withdrawn' (terminal — withdrawal is final; re-pricing is supersession)",
        details: { offerRef: record.offerRef, currentStatus: current },
      });
    }
    this.offerStatusByDigest.set(record.digest, record);
    const chain = this.offerStatusByOffer.get(record.offerRef) ?? [];
    chain.push(record.digest);
    this.offerStatusByOffer.set(record.offerRef, chain);
    return record;
  }

  /** All status records of one offer (append/insertion order). */
  listOfferStatusRecords(offerRef: string): readonly OfferStatusRecord[] {
    const chain = this.offerStatusByOffer.get(offerRef) ?? [];
    return chain
      .map((digest) => this.offerStatusByDigest.get(digest))
      .filter((record): record is OfferStatusRecord => record !== undefined);
  }

  /** The CURRENT offer status — recomputed from history ('active' until withdrawn). */
  currentOfferStatus(offerRef: string): string {
    const chain = this.offerStatusByOffer.get(offerRef) ?? [];
    let status = 'active';
    for (const digest of chain) {
      const record = this.offerStatusByDigest.get(digest);
      if (record === undefined) continue;
      status = record.transition === 'withdraw' ? 'withdrawn' : status;
    }
    return status;
  }

  /**
   * The ACTIVE, in-validity-window offers of one listing at one fixed
   * time (the deterministic projection the engine consumes).
   */
  activeOffersForListing(listingRef: string, at: string): readonly CommercialOffer[] {
    return this.offersForListing(listingRef).filter(
      (offer) =>
        this.currentOfferStatus(offer.digest) === 'active' &&
        offer.validFrom <= at &&
        at <= offer.validUntil,
    );
  }

  // -------------------------------------------------------------------------
  // Engagements
  // -------------------------------------------------------------------------

  /** Register an engagement request (tenant-checked, offer-gated). */
  registerEngagement(engagement: EngagementRecord): EngagementRecord {
    const identity = engagementIdentityKey(engagement);
    const existingDigest = this.engagementIdentities.get(identity);
    if (existingDigest !== undefined && existingDigest !== engagement.digest) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `engagement identity ${JSON.stringify(identity)} is already registered with a different digest`,
        details: { identity, registeredDigest: existingDigest, attemptedDigest: engagement.digest },
      });
    }
    const existing = this.engagementsByDigest.get(engagement.digest);
    if (existing !== undefined) return existing;
    const listing = this.listingsByDigest.get(engagement.listingRef);
    if (listing === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no listing registered at digest ${engagement.listingRef} (engagements attach to registered listings)`,
        details: { listingRef: engagement.listingRef },
      });
    }
    const offer = this.offersByDigest.get(engagement.offerRef);
    if (offer === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no offer registered at digest ${engagement.offerRef}`,
        details: { offerRef: engagement.offerRef },
      });
    }
    if (engagement.tenant !== listing.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'cross-tenant engagement denied: the engagement tenant must equal the listing tenant (lock rule 11)',
        details: { engagementTenant: engagement.tenant, listingTenant: listing.tenant },
      });
    }
    if (offer.listingRef !== listing.digest) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
        message: 'the engaged offer does not belong to the engaged listing',
        details: { offerRef: offer.digest, offerListing: offer.listingRef, listingRef: listing.digest },
      });
    }
    if (offer.expertId !== engagement.expertId || offer.tenant !== engagement.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
        message: 'engagement expert identity must match the offer',
        details: { offerExpertId: offer.expertId, engagementExpertId: engagement.expertId },
      });
    }
    if (this.currentOfferStatus(offer.digest) !== 'active') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION, {
        message: "the engaged offer is not active (withdrawn offers cannot be engaged)",
        details: { offerRef: offer.digest, status: this.currentOfferStatus(offer.digest) },
      });
    }
    if (offer.validFrom > engagement.requestedAt || engagement.requestedAt > offer.validUntil) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
        message: 'the engaged offer is outside its validity window at the requested time',
        details: {
          offerRef: offer.digest,
          validFrom: offer.validFrom,
          validUntil: offer.validUntil,
          requestedAt: engagement.requestedAt,
        },
      });
    }
    const scheduledEndHours = offer.maxDurationHours;
    const scheduledForMs = Date.parse(engagement.scheduledFor);
    const requestedPlus = Date.parse(engagement.requestedAt) + scheduledEndHours * 3_600_000;
    if (scheduledForMs > requestedPlus) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
        message: 'the scheduled start exceeds the offer maximum duration window from the request time',
        details: {
          offerRef: offer.digest,
          maxDurationHours: offer.maxDurationHours,
          scheduledFor: engagement.scheduledFor,
          requestedAt: engagement.requestedAt,
        },
      });
    }
    const noticeMs =
      Date.parse(engagement.scheduledFor) - Date.parse(engagement.requestedAt);
    if (noticeMs < offer.minNoticeHours * 3_600_000) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_ENGAGEMENT, {
        message: 'the engagement violates the offer minimum notice window',
        details: {
          offerRef: offer.digest,
          minNoticeHours: offer.minNoticeHours,
          scheduledFor: engagement.scheduledFor,
          requestedAt: engagement.requestedAt,
        },
      });
    }
    this.engagementsByDigest.set(engagement.digest, engagement);
    this.engagementIdentities.set(identity, engagement.digest);
    return engagement;
  }

  /** Look up an engagement by digest. */
  getEngagement(digest: string): EngagementRecord | undefined {
    return this.engagementsByDigest.get(digest);
  }

  /** All engagements of one listing (insertion order). */
  engagementsForListing(listingRef: string): readonly EngagementRecord[] {
    return [...this.engagementsByDigest.values()].filter(
      (engagement) => engagement.listingRef === listingRef,
    );
  }

  /** All registered engagements (insertion order). */
  listEngagements(): readonly EngagementRecord[] {
    return [...this.engagementsByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Engagement transitions (append-only, terminal finality)
  // -------------------------------------------------------------------------

  /** Register an engagement transition (validated against the closed table). */
  registerEngagementTransition(record: EngagementTransitionRecord): EngagementTransitionRecord {
    const existing = this.engagementTransitionsByDigest.get(record.digest);
    if (existing !== undefined) return existing;
    const engagement = this.engagementsByDigest.get(record.engagementRef);
    if (engagement === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no engagement registered at digest ${record.engagementRef}`,
        details: { engagementRef: record.engagementRef },
      });
    }
    if (record.tenant !== engagement.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'engagement transitions must stay inside the engagement tenant (lock rule 11)',
        details: { engagementTenant: engagement.tenant, recordTenant: record.tenant },
      });
    }
    const current = this.currentEngagementStatus(record.engagementRef);
    const allowed = ENGAGEMENT_TRANSITION_TABLE[record.transition];
    if (!(allowed.from as readonly string[]).includes(current)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.LIFECYCLE_VIOLATION, {
        message: `engagement transition '${record.transition}' is invalid from status '${current}'${current === 'declined' || current === 'cancelled' || current === 'completed' ? ` (terminal — ${current} engagements are final)` : ''}`,
        details: {
          engagementRef: record.engagementRef,
          transition: record.transition,
          currentStatus: current,
        },
      });
    }
    this.engagementTransitionsByDigest.set(record.digest, record);
    const chain = this.engagementTransitionsByEngagement.get(record.engagementRef) ?? [];
    chain.push(record.digest);
    this.engagementTransitionsByEngagement.set(record.engagementRef, chain);
    return record;
  }

  /** The CURRENT engagement status — recomputed from the transition history. */
  currentEngagementStatus(engagementRef: string): string {
    const chain = this.engagementTransitionsByEngagement.get(engagementRef) ?? [];
    let status = 'requested';
    for (const digest of chain) {
      const record = this.engagementTransitionsByDigest.get(digest);
      if (record === undefined) continue;
      status = ENGAGEMENT_TRANSITION_TABLE[record.transition].to;
    }
    return status;
  }

  /** All transitions of one engagement (append/insertion order). */
  listEngagementTransitions(engagementRef: string): readonly EngagementTransitionRecord[] {
    const chain = this.engagementTransitionsByEngagement.get(engagementRef) ?? [];
    return chain
      .map((digest) => this.engagementTransitionsByDigest.get(digest))
      .filter((record): record is EngagementTransitionRecord => record !== undefined);
  }

  // -------------------------------------------------------------------------
  // Reviews (completion-gated, one per engagement)
  // -------------------------------------------------------------------------

  /** Register a review (the completion gate runs HERE — fail-closed). */
  registerReview(review: ReviewRecord): ReviewRecord {
    const existing = this.reviewsByDigest.get(review.digest);
    if (existing !== undefined) return existing;
    const engagement = this.engagementsByDigest.get(review.engagementRef);
    if (engagement === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.NOT_FOUND, {
        message: `no engagement registered at digest ${review.engagementRef}`,
        details: { engagementRef: review.engagementRef },
      });
    }
    const currentStatus = this.currentEngagementStatus(review.engagementRef);
    if (currentStatus !== 'completed') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `review gate failed: engagement status is '${currentStatus}' (reviews require COMPLETED engagements)`,
        details: { engagementRef: review.engagementRef, status: currentStatus },
      });
    }
    if (review.tenant !== engagement.tenant) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TENANT_VIOLATION, {
        message: 'cross-tenant review denied: the review tenant must equal the engagement tenant (lock rule 11)',
        details: { reviewTenant: review.tenant, engagementTenant: engagement.tenant },
      });
    }
    if (review.customer !== engagement.customer) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_REVIEW, {
        message: 'only the engagement customer may review the engagement',
        details: { reviewCustomer: review.customer, engagementCustomer: engagement.customer },
      });
    }
    if (
      review.listingRef !== engagement.listingRef ||
      review.expertId !== engagement.expertId
    ) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_REVIEW, {
        message: 'the review must reference the engagement\'s own listing and expert',
        details: {
          reviewListingRef: review.listingRef,
          engagementListingRef: engagement.listingRef,
        },
      });
    }
    const existingReviewDigest = this.reviewByEngagement.get(review.engagementRef);
    if (existingReviewDigest !== undefined && existingReviewDigest !== review.digest) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.IDENTITY_CONFLICT, {
        message: 'engagement is already reviewed (ONE review per engagement — re-reviewing requires a new engagement)',
        details: {
          engagementRef: review.engagementRef,
          registeredReview: existingReviewDigest,
          attemptedReview: review.digest,
        },
      });
    }
    this.reviewsByDigest.set(review.digest, review);
    this.reviewByEngagement.set(review.engagementRef, review.digest);
    return review;
  }

  /** Look up a review by digest. */
  getReview(digest: string): ReviewRecord | undefined {
    return this.reviewsByDigest.get(digest);
  }

  /** The review of one engagement (at most one). */
  reviewForEngagement(engagementRef: string): ReviewRecord | undefined {
    const digest = this.reviewByEngagement.get(engagementRef);
    return digest === undefined ? undefined : this.reviewsByDigest.get(digest);
  }

  /** All reviews of one listing (insertion order). */
  reviewsForListing(listingRef: string): readonly ReviewRecord[] {
    return [...this.reviewsByDigest.values()].filter(
      (review) => review.listingRef === listingRef,
    );
  }

  /** All registered reviews (insertion order). */
  listReviews(): readonly ReviewRecord[] {
    return [...this.reviewsByDigest.values()];
  }

  // -------------------------------------------------------------------------
  // Recomputed aggregates (never stored — A006 reliability discipline)
  // -------------------------------------------------------------------------

  /** Listing engagement/review aggregates — recomputed from history. */
  listingStats(listingRef: string): ListingStats {
    const engagements = this.engagementsForListing(listingRef);
    const completed = engagements.filter(
      (engagement) => this.currentEngagementStatus(engagement.digest) === 'completed',
    );
    const reviews = this.reviewsForListing(listingRef);
    const averageRating =
      reviews.length === 0
        ? null
        : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
    return Object.freeze({
      engagements: engagements.length,
      completed: completed.length,
      reviews: reviews.length,
      averageRating,
    });
  }
}
