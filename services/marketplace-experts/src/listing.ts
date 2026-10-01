/**
 * ExpertListing — the commercial listing record for one qualified expert
 * (Work Order A031; requirements R31, R48; architecture-lock rules 6, 9,
 * 11, 23).
 *
 * A listing is DATA about commercial availability, never an
 * authorization: it references an @arena/expert-registry profile (A006),
 * an @arena/expert-qualification card (A007) and a NON-EMPTY set of
 * QUALIFICATION PROOFS (claim digest + qualification-record digest
 * pairs). The publish gate (`verifyListingGate`) resolves every proof
 * through the INJECTED expert-record store, tamper-verifies the records
 * and requires each record to be a QUALIFIED verdict in force at the
 * publication time — an unqualified expert cannot publish a listing
 * (fail-closed, never best-effort).
 *
 * Append-only discipline (lock rule 6):
 *   - the listing record is created in status 'draft' and never mutated;
 *   - lifecycle transitions (publish/unlist/relist/delist) are APPENDED
 *     ListingStatusRecords with a closed transition table and terminal
 *     finality on 'delisted';
 *   - new listing versions supersede old ones by digest (lineage is
 *     auditable or absent).
 */

import type { ExpertProfile } from '@arena/expert-registry';
import type { QualifiedExpertCard } from '@arena/expert-qualification';
import { replayQualificationRecord } from '@arena/expert-qualification';
import type { CompetencyClaim, QualificationRecord } from '@arena/expert-qualification';
import { digestCanonical } from '@arena/protocol-core';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import {
  deepFreeze,
  isCapabilityNodeRef,
  isContentDigest,
  isJurisdiction,
  isListingStatus,
  isListingTransition,
  isMarketplaceId,
  isMarketplaceTimestamp,
  isNeutralText,
  isTenantScope,
  toContentDigest,
  toMarketplaceId,
  toMarketplaceTimestamp,
  toNeutralText,
  toTenantScope,
} from './shared.js';
import type {
  CapabilityNodeRefView,
  ContentDigest,
  JurisdictionView,
  ListingStatus,
  ListingTransition,
  MarketplaceExpertRecordStore,
  MarketplaceId,
  MarketplaceTimestamp,
  NeutralText,
  TenantScope,
} from './shared.js';

/** Wire version of the expert-listing record shape. */
export const EXPERT_LISTING_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Listing status vocabulary + transition table (closed, machine-auditable)
// ---------------------------------------------------------------------------

/** The closed listing transition table (from-statuses → to-status). */
export const LISTING_TRANSITION_TABLE = {
  publish: { from: ['draft', 'unlisted'], to: 'listed' },
  unlist: { from: ['listed'], to: 'unlisted' },
  relist: { from: ['unlisted'], to: 'listed' },
  delist: { from: ['draft', 'listed', 'unlisted'], to: 'delisted' },
} as const satisfies Record<
  ListingTransition,
  { readonly from: readonly ListingStatus[]; readonly to: ListingStatus }
>;

// ---------------------------------------------------------------------------
// Qualification proofs (the A007 gate evidence)
// ---------------------------------------------------------------------------

/** One qualification proof: an A007 claim digest + record digest pair. */
export interface QualificationProof {
  /** Digest of the @arena/expert-qualification CompetencyClaim. */
  readonly claimRef: string;
  /** Digest of the @arena/expert-qualification QualificationRecord. */
  readonly recordRef: string;
}

export function isQualificationProof(value: unknown): value is QualificationProof {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isContentDigest(candidate['claimRef']) && isContentDigest(candidate['recordRef']);
}

// ---------------------------------------------------------------------------
// The listing record
// ---------------------------------------------------------------------------

/** Digest-free view of an expert listing — exactly what the digest covers. */
export interface ExpertListingContentView {
  readonly recordVersion: typeof EXPERT_LISTING_RECORD_VERSION;
  /** Listing identity inside the tenant (one live listing per id). */
  readonly listingId: MarketplaceId;
  /** Owning tenant (lock rule 11 — listings are tenant-scoped). */
  readonly tenant: TenantScope;
  /** The neutral expert id (A006 identity). */
  readonly expertId: string;
  /** One-line commercial headline (neutral text). */
  readonly headline: NeutralText;
  /** Longer description (neutral text). */
  readonly description: NeutralText;
  /** Digest of the registered A006 ExpertProfile backing this listing. */
  readonly profileRef: string;
  /** Digest of the registered A007 QualifiedExpertCard backing this listing. */
  readonly cardRef: string;
  /** ≥1 qualification proofs — the publish gate verifies every one. */
  readonly qualificationProofs: readonly QualificationProof[];
  /** Capability-graph node refs offered commercially. */
  readonly capabilityRefs: readonly CapabilityNodeRefView[];
  /** Domain refs the listing is scoped to (from the A007 card). */
  readonly domainRefs: readonly CapabilityNodeRefView[];
  /** Jurisdictions the expert serves. */
  readonly jurisdictions: readonly JurisdictionView[];
  /** Initial status — listings are created 'draft' and transition by append. */
  readonly status: ListingStatus;
  /** The previous listing version this one replaces (append-only lineage). */
  readonly supersedes?: string;
  /** When this listing version was declared (injected — never a clock read). */
  readonly declaredAt: MarketplaceTimestamp;
}

/** A frozen expert listing: the content view plus its sha256 digest. */
export interface ExpertListing extends ExpertListingContentView {
  readonly digest: ContentDigest;
}

export interface CreateExpertListingInput {
  readonly listingId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly headline: string;
  readonly description: string;
  readonly profileRef: string;
  readonly cardRef: string;
  readonly qualificationProofs: readonly QualificationProof[];
  readonly capabilityRefs?: readonly CapabilityNodeRefView[];
  readonly domainRefs?: readonly CapabilityNodeRefView[];
  readonly jurisdictions?: readonly JurisdictionView[];
  readonly supersedes?: string;
  readonly declaredAt: string;
}

/** The listing identity key — (tenant, expertId, listingId). */
export function expertListingIdentityKey(
  source: Pick<ExpertListingContentView, 'tenant' | 'expertId' | 'listingId'>,
): string {
  return `${source.tenant}/${source.expertId}/${source.listingId}`;
}

/** Structural (non-throwing) check for the digest-free view. */
export function isExpertListingView(value: unknown): value is ExpertListingContentView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== EXPERT_LISTING_RECORD_VERSION) return false;
  if (!isMarketplaceId(candidate['listingId'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (typeof candidate['expertId'] !== 'string' || candidate['expertId'].length === 0) {
    return false;
  }
  if (!isNeutralText(candidate['headline']) || !isNeutralText(candidate['description'])) {
    return false;
  }
  if (!isContentDigest(candidate['profileRef']) || !isContentDigest(candidate['cardRef'])) {
    return false;
  }
  const proofs = candidate['qualificationProofs'];
  if (!Array.isArray(proofs) || proofs.length === 0) return false;
  if (!proofs.every((proof) => isQualificationProof(proof))) return false;
  const seenClaims = new Set<string>();
  for (const proof of proofs) {
    if (seenClaims.has(proof.claimRef)) return false;
    seenClaims.add(proof.claimRef);
  }
  const capabilityRefs = candidate['capabilityRefs'];
  if (!Array.isArray(capabilityRefs) || !capabilityRefs.every((ref) => isCapabilityNodeRef(ref))) {
    return false;
  }
  const domainRefs = candidate['domainRefs'];
  if (!Array.isArray(domainRefs) || !domainRefs.every((ref) => isCapabilityNodeRef(ref))) {
    return false;
  }
  const jurisdictions = candidate['jurisdictions'];
  if (!Array.isArray(jurisdictions) || !jurisdictions.every((entry) => isJurisdiction(entry))) {
    return false;
  }
  if (!isListingStatus(candidate['status'])) return false;
  if (!isMarketplaceTimestamp(candidate['declaredAt'])) return false;
  if (
    candidate['supersedes'] !== undefined &&
    !isContentDigest(candidate['supersedes'])
  ) {
    return false;
  }
  return true;
}

/** Structural (non-throwing) check for the frozen record. */
export function isExpertListing(value: unknown): value is ExpertListing {
  return isExpertListingView(value) && isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

/** Construct + validate + digest + freeze one expert listing (status: draft). */
export async function createExpertListing(
  input: CreateExpertListingInput,
): Promise<ExpertListing> {
  const listingId = toMarketplaceId(input.listingId, 'listingId');
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (typeof input.expertId !== 'string' || input.expertId.length === 0) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: 'expertId requires a non-empty string',
      details: { field: 'expertId' },
    });
  }
  const headline = toNeutralText(input.headline, 'headline');
  const description = toNeutralText(input.description, 'description');
  const profileRef = toContentDigest(input.profileRef, 'profileRef');
  const cardRef = toContentDigest(input.cardRef, 'cardRef');
  if (!Array.isArray(input.qualificationProofs) || input.qualificationProofs.length === 0) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: 'a listing requires at least one qualification proof (claimRef + recordRef) — unqualified experts cannot publish listings',
      details: { proofCount: Array.isArray(input.qualificationProofs) ? input.qualificationProofs.length : 0 },
    });
  }
  const qualificationProofs = input.qualificationProofs.map((proof) => {
    if (!isQualificationProof(proof)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
        message: 'each qualification proof requires valid claimRef + recordRef content digests',
        details: { proof },
      });
    }
    return Object.freeze({ claimRef: proof.claimRef, recordRef: proof.recordRef });
  });
  const seenClaims = new Set<string>();
  for (const proof of qualificationProofs) {
    if (seenClaims.has(proof.claimRef)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
        message: 'duplicate qualification proof for one claim (deduplicate proofs — closed sets only)',
        details: { claimRef: proof.claimRef },
      });
    }
    seenClaims.add(proof.claimRef);
  }
  const capabilityRefs = (input.capabilityRefs ?? []).map((ref) => {
    if (!isCapabilityNodeRef(ref)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
        message: 'capabilityRefs entries must be valid capability-graph node refs',
        details: { ref },
      });
    }
    return Object.freeze({ ...ref });
  });
  const domainRefs = (input.domainRefs ?? []).map((ref) => {
    if (!isCapabilityNodeRef(ref)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
        message: 'domainRefs entries must be valid capability-graph node refs',
        details: { ref },
      });
    }
    return Object.freeze({ ...ref });
  });
  const jurisdictions = (input.jurisdictions ?? []).map((entry) => {
    if (!isJurisdiction(entry)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
        message: 'jurisdictions entries must be valid {country, region?} views',
        details: { entry },
      });
    }
    return Object.freeze({ ...entry });
  });
  const declaredAt = toMarketplaceTimestamp(input.declaredAt, 'declaredAt');
  const supersedes = input.supersedes === undefined ? undefined : toContentDigest(input.supersedes, 'supersedes');

  const view: ExpertListingContentView = {
    recordVersion: EXPERT_LISTING_RECORD_VERSION,
    listingId,
    tenant,
    expertId: input.expertId,
    headline,
    description,
    profileRef,
    cardRef,
    qualificationProofs: Object.freeze(qualificationProofs),
    capabilityRefs: Object.freeze(capabilityRefs),
    domainRefs: Object.freeze(domainRefs),
    jurisdictions: Object.freeze(jurisdictions),
    status: 'draft',
    ...(supersedes !== undefined ? { supersedes } : {}),
    declaredAt,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// ListingStatusRecord — the append-only lifecycle transition record
// ---------------------------------------------------------------------------

/** Wire version of the listing-status record shape. */
export const LISTING_STATUS_RECORD_VERSION = 1 as const;

/** Digest-free view of one appended listing transition. */
export interface ListingStatusRecordView {
  readonly recordVersion: typeof LISTING_STATUS_RECORD_VERSION;
  /** The listing this transition applies to (content digest). */
  readonly listingRef: string;
  /** The tenant of the listing (scope lock — rule 11). */
  readonly tenant: TenantScope;
  readonly transition: ListingTransition;
  readonly at: MarketplaceTimestamp;
  readonly note?: NeutralText;
}

/** A frozen listing-status record: the view plus its sha256 digest. */
export interface ListingStatusRecord extends ListingStatusRecordView {
  readonly digest: ContentDigest;
}

export interface CreateListingStatusRecordInput {
  readonly listingRef: string;
  readonly tenant: string;
  readonly transition: ListingTransition;
  readonly at: string;
  readonly note?: string;
}

export function isListingStatusRecord(value: unknown): value is ListingStatusRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== LISTING_STATUS_RECORD_VERSION) return false;
  if (!isContentDigest(candidate['listingRef'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (!isListingTransition(candidate['transition'])) return false;
  if (typeof candidate['at'] !== 'string' || !isMarketplaceTimestamp(candidate['at'])) {
    return false;
  }
  if (candidate['note'] !== undefined && !isNeutralText(candidate['note'])) return false;
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one listing-status record. */
export async function createListingStatusRecord(
  input: CreateListingStatusRecordInput,
): Promise<ListingStatusRecord> {
  const listingRef = toContentDigest(input.listingRef, 'listingRef');
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (!isListingTransition(input.transition)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_LISTING, {
      message: 'transition must be one of publish|unlist|relist|delist',
      details: { transition: input.transition },
    });
  }
  const at = toMarketplaceTimestamp(input.at, 'at');
  const note = input.note === undefined ? undefined : toNeutralText(input.note, 'note');
  const view: ListingStatusRecordView = {
    recordVersion: LISTING_STATUS_RECORD_VERSION,
    listingRef,
    tenant,
    transition: input.transition,
    ...(note !== undefined ? { note } : {}),
    at,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// The publish gate — qualification evidence verification (A007, fail-closed)
// ---------------------------------------------------------------------------

/** The verified state of one qualification proof at the gate time. */
export interface VerifiedQualificationProof {
  readonly claimRef: string;
  readonly recordRef: string;
  readonly recordStatus: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly inForce: boolean;
}

/** The full gate report (recorded with the publish event as evidence). */
export interface ListingGateReport {
  readonly listingRef: string;
  readonly evaluatedAt: string;
  readonly profileStatus: string;
  readonly cardMatched: boolean;
  readonly proofs: readonly VerifiedQualificationProof[];
}

/**
 * Verify the listing publication gate at one fixed time:
 *
 *   1. the referenced A006 ExpertProfile resolves, its digest matches
 *      (tamper check), its identity matches the listing's
 *      (expertId, tenant) and its lifecycle status is 'published';
 *   2. the referenced A007 QualifiedExpertCard resolves, its digest
 *      matches and its identity matches;
 *   3. EVERY qualification proof resolves through the store, replays
 *      byte-identically (A007 tamper verification), belongs to the same
 *      expert, is a 'qualified' verdict and is IN FORCE at the
 *      evaluation time (validFrom ≤ evaluatedAt ≤ validUntil).
 *
 * Any failure throws GATE_FAILURE/TAMPERED — the marketplace never
 * publishes an unqualified listing, never partially accepts evidence.
 */
export async function verifyListingGate(
  listing: ExpertListing,
  evaluatedAt: string,
  store: MarketplaceExpertRecordStore,
): Promise<ListingGateReport> {
  const at = toMarketplaceTimestamp(evaluatedAt, 'evaluatedAt');

  // 1. The A006 profile.
  const profile: ExpertProfile | undefined = await store.getExpertProfile(listing.profileRef);
  if (profile === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: `listing gate failed: no expert profile registered at digest ${listing.profileRef}`,
      details: { listingRef: listing.digest, profileRef: listing.profileRef },
    });
  }
  if (profile.digest !== listing.profileRef) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TAMPERED, {
      message: 'listing gate failed: profile digest mismatch (tamper check)',
      details: { listingRef: listing.digest, expected: listing.profileRef, actual: profile.digest },
    });
  }
  if (
    String(profile.identity.expertId) !== String(listing.expertId) ||
    String(profile.identity.tenant) !== String(listing.tenant)
  ) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: 'listing gate failed: profile identity does not match the listing identity',
      details: {
        listingExpertId: listing.expertId,
        listingTenant: listing.tenant,
        profileExpertId: profile.identity.expertId,
        profileTenant: profile.identity.tenant,
      },
    });
  }
  if (profile.status !== 'published') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: `listing gate failed: expert profile status is '${profile.status}' (requires 'published')`,
      details: { profileRef: listing.profileRef, status: profile.status },
    });
  }

  // 2. The A007 qualified-expert card.
  const card: QualifiedExpertCard | undefined = await store.getQualifiedExpertCard(
    listing.cardRef,
  );
  if (card === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: `listing gate failed: no qualified-expert card registered at digest ${listing.cardRef}`,
      details: { listingRef: listing.digest, cardRef: listing.cardRef },
    });
  }
  if (card.digest !== listing.cardRef) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TAMPERED, {
      message: 'listing gate failed: qualified-expert card digest mismatch (tamper check)',
      details: { listingRef: listing.digest, expected: listing.cardRef, actual: card.digest },
    });
  }
  if (String(card.expertId) !== String(listing.expertId) || String(card.tenant) !== String(listing.tenant)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: 'listing gate failed: qualified-expert card identity does not match the listing identity',
      details: {
        listingExpertId: listing.expertId,
        listingTenant: listing.tenant,
        cardExpertId: card.expertId,
        cardTenant: card.tenant,
      },
    });
  }

  // 3. Every qualification proof: resolve → replay-verify → qualified + in force.
  const proofs: VerifiedQualificationProof[] = [];
  for (const proof of listing.qualificationProofs) {
    let record: QualificationRecord;
    const resolved: QualificationRecord | undefined = await store.getQualificationRecord(
      proof.recordRef,
    );
    if (resolved === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `listing gate failed: no qualification record registered at digest ${proof.recordRef}`,
        details: { listingRef: listing.digest, recordRef: proof.recordRef },
      });
    }
    try {
      record = await replayQualificationRecord(resolved);
    } catch (cause) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TAMPERED, {
        message: `listing gate failed: qualification record ${proof.recordRef} failed A007 replay verification`,
        details: { recordRef: proof.recordRef },
        cause,
      });
    }
    if (record.claimDigest !== proof.claimRef) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: 'listing gate failed: qualification record does not evaluate the proof\'s claim',
        details: { claimRef: proof.claimRef, recordClaim: record.claimDigest },
      });
    }
    const claim: CompetencyClaim | undefined = await store.getCompetencyClaim(proof.claimRef);
    if (claim === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `listing gate failed: no competency claim registered at digest ${proof.claimRef}`,
        details: { listingRef: listing.digest, claimRef: proof.claimRef },
      });
    }
    if (String(claim.expertId) !== String(listing.expertId) || String(claim.tenant) !== String(listing.tenant)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: 'listing gate failed: qualification proof belongs to a different expert',
        details: {
          claimRef: proof.claimRef,
          claimExpertId: claim.expertId,
          claimTenant: claim.tenant,
        },
      });
    }
    if (record.status !== 'qualified') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `listing gate failed: qualification record status is '${record.status}' (requires 'qualified') — unqualified experts cannot publish listings`,
        details: { recordRef: proof.recordRef, status: record.status },
      });
    }
    const validFrom = record.validFrom ?? '';
    const validUntil = record.validUntil ?? '';
    if (validFrom === '' || validUntil === '') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: 'listing gate failed: qualified record is missing its validity window (malformed evidence)',
        details: { recordRef: proof.recordRef },
      });
    }
    const inForce = validFrom <= at && at <= validUntil;
    if (!inForce) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: 'listing gate failed: qualification record is not in force at the publication time',
        details: {
          recordRef: proof.recordRef,
          validFrom,
          validUntil,
          evaluatedAt: at,
        },
      });
    }
    proofs.push(
      Object.freeze({
        claimRef: proof.claimRef,
        recordRef: proof.recordRef,
        recordStatus: record.status,
        validFrom,
        validUntil,
        inForce: true,
      }),
    );
  }

  return deepFreeze({
    listingRef: listing.digest,
    evaluatedAt: at,
    profileStatus: profile.status,
    cardMatched: true,
    proofs: Object.freeze(proofs),
  });
}
