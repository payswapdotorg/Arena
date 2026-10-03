/**
 * Artifact listing view models (Work Order B013; issue #88;
 * packages/marketplace-ui).
 *
 * An artifact listing projects the A032 marketplace offer profile shape
 * honestly: identity, the full provenance chain (evidence class), the
 * licence rights posture, the verification status (own class, decided only
 * by recorded outcomes), certification presence ONLY when a certification
 * record backs it, and the explicit entitlement state machine over the
 * viewer-tenant's grant records (append-only: the latest recorded event
 * governs the current posture; every grant's own state renders in grants[]).
 */

import { buildCertificationPresence } from './certification.js';
import type { CertificationPresence } from './certification.js';
import {
  entitlementStateFromMarketplaceGrant,
  noGrantEntitlement,
} from './entitlement.js';
import type { EntitlementStateView } from './entitlement.js';
import { buildProvenanceSummary } from './provenance.js';
import type { ProvenanceSummary } from './provenance.js';
import { buildRightsPosture } from './rights.js';
import type { RightsPosture } from './rights.js';
import {
  asRecord,
  deepFreezeView,
  MARKETPLACE_UI_VIEW_VERSION,
  readCount,
  readNumber,
  readString,
} from './shared.js';
import { buildPurchaseActionView } from './purchase.js';
import type { PurchaseActionView } from './purchase.js';
import { buildVerificationStatus } from './verification.js';
import type { VerificationStatus } from './verification.js';

/** One marketplace review (an expert judgment, honestly read). */
export interface ListingReviewView {
  readonly rating: number | undefined;
  readonly verdict: string | undefined;
  readonly body: string | undefined;
  readonly reviewerTenant: string | undefined;
}

/** The artifact listing card. */
export interface ArtifactListingCard {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  readonly family: 'artifact';
  readonly offerId: string | undefined;
  readonly title: string | undefined;
  readonly summary: string | undefined;
  readonly artifactKind: string | undefined;
  readonly visibility: string | undefined;
  readonly tenant: string | undefined;
  readonly state: string | undefined;
  readonly offerDigest: string | undefined;
  readonly artifactIdentity: string | undefined;
  readonly provenance: ProvenanceSummary;
  readonly rights: RightsPosture;
  readonly verification: VerificationStatus;
  readonly certification: CertificationPresence;
  /** The latest recorded grant event's state (append-only order). */
  readonly entitlement: EntitlementStateView;
  /** Every viewer-tenant grant with its own explicit state (history). */
  readonly grants: readonly EntitlementStateView[];
  readonly reviews: readonly ListingReviewView[];
  readonly reviewCount: number | undefined;
  readonly averageRating: number | undefined;
  readonly unknownFields: readonly string[];
}

/** The artifact listing detail (card + purchase action view model). */
export interface ArtifactListingDetail {
  readonly viewVersion: typeof MARKETPLACE_UI_VIEW_VERSION;
  readonly card: ArtifactListingCard;
  readonly purchase: PurchaseActionView;
}

function readReviews(value: unknown, unknownFields: string[]): readonly ListingReviewView[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const reviews: ListingReviewView[] = [];
  value.forEach((entry, index) => {
    const data = asRecord(entry);
    const review = {
      rating: readCount(data, 'rating'),
      verdict: readString(data, 'verdict'),
      body: readString(data, 'body'),
      reviewerTenant: readString(data, 'reviewerTenant'),
    };
    if (
      review.rating === undefined &&
      review.verdict === undefined &&
      review.body === undefined
    ) {
      unknownFields.push(`reviews[${String(index)}] (malformed)`);
      return;
    }
    reviews.push(Object.freeze(review));
  });
  return Object.freeze(reviews);
}

/**
 * Build the artifact listing card from an A032 offer-profile-shaped payload
 * (identity, rights, evidence, grants, reviews) plus the composed provenance
 * chain input (`provenanceRecord`) and, only when one exists, the
 * `certificationRecord` that backs a badge. Honest: every missing field
 * degrades to unknown (listed) — a listing without certification renders
 * "not certified", never a blank.
 */
export function buildArtifactListingCard(listing: unknown): ArtifactListingCard {
  const data = asRecord(listing);
  const unknownFields: string[] = [];

  const offerId = readString(data, 'offerId');
  if (offerId === undefined) unknownFields.push('offerId');
  const title = readString(data, 'title');
  if (title === undefined) unknownFields.push('title');
  const summary = readString(data, 'summary');
  const artifactKind = readString(data, 'artifactKind');
  if (artifactKind === undefined) unknownFields.push('artifactKind');
  const visibility = readString(data, 'visibility');
  const tenant = readString(data, 'tenant');
  if (tenant === undefined) unknownFields.push('tenant');
  const state = readString(data, 'state');
  if (state === undefined) unknownFields.push('state');
  const offerDigest = readString(data, 'offerDigest');
  const artifactIdentity = readString(data, 'artifactIdentity');

  const provenance = buildProvenanceSummary(data['provenanceRecord']);
  const rights = buildRightsPosture(data['rights']);
  const verification = buildVerificationStatus(data['evidence']);
  const certification = buildCertificationPresence(data['certificationRecord']);

  const at = readString(data, 'evaluatedAt');
  const grants: EntitlementStateView[] = [];
  const grantsValue = data['grants'];
  if (!Array.isArray(grantsValue)) {
    unknownFields.push('grants');
  } else {
    grantsValue.forEach((entry, index) => {
      const grantData = asRecord(entry);
      if (readString(grantData, 'grantId') === undefined && readString(grantData, 'kind') === undefined) {
        unknownFields.push(`grants[${String(index)}] (malformed)`);
        return;
      }
      grants.push(entitlementStateFromMarketplaceGrant(entry, at));
    });
  }
  const entitlement = grants.at(-1) ?? noGrantEntitlement();

  const reviews = readReviews(data['reviews'], unknownFields);
  const reviewCount = readCount(data, 'reviewCount');
  const averageRating = readNumber(data, 'averageRating');

  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    family: 'artifact',
    offerId,
    title,
    summary,
    artifactKind,
    visibility,
    tenant,
    state,
    offerDigest,
    artifactIdentity,
    provenance,
    rights,
    verification,
    certification,
    entitlement,
    grants: Object.freeze(grants),
    reviews,
    reviewCount,
    averageRating,
    unknownFields: Object.freeze(unknownFields),
  } satisfies ArtifactListingCard);
}

/**
 * Build the artifact listing detail: the card plus the purchase action view
 * model (what a purchase grants and explicitly does NOT grant).
 */
export function buildArtifactListingDetail(listing: unknown): ArtifactListingDetail {
  const card = buildArtifactListingCard(listing);
  const data = asRecord(listing);
  const purchase = buildPurchaseActionView({
    family: 'artifact',
    mode: readString(data, 'mode') === 'demo' ? 'demo' : 'session',
    state: card.state,
    rights: data['rights'],
    offers: Object.freeze([]),
  });
  return deepFreezeView({
    viewVersion: MARKETPLACE_UI_VIEW_VERSION,
    card,
    purchase,
  } satisfies ArtifactListingDetail);
}
