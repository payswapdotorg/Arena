/**
 * CommercialOffer — the commercial terms record attached to one expert
 * listing (Work Order A031; requirements R31, R34, R48; architecture-lock
 * rules 6, 17, 18).
 *
 * An offer is DATA: closed-kind commercial products (consulting session,
 * code review, expert observation, capability development, or a service
 * BACKED BY A RELEASED AGENT BODY), an integer-minor-unit rate in an ISO
 * 4217 currency over a closed unit vocabulary, notice/duration terms and
 * typed availability windows. Rates change by SUPERSESSION (a new offer
 * version with `supersedes`), never by mutation; withdrawal is an
 * appended OfferStatusRecord with terminal finality.
 *
 * The body-backed gate (`verifyOfferBackingGate`): an offer of kind
 * 'body-backed-service' REQUIRES a backing A024 ReleaseRecord digest;
 * the gate resolves the release through the INJECTED release store,
 * requires a 'release-registration' record with frozen gate evidence,
 * and re-verifies EVERY cited A023 CertificationRecord through the
 * INJECTED certification store — each must resolve and carry a
 * 'satisfied' verdict (fail-closed: an unverifiable backing can never be
 * offered commercially).
 */

import type {
  CertificationRecordView,
  MarketplaceCertificationRecordStore,
  MarketplaceReleaseRecordStore,
  ReleaseRecordView,
} from './shared.js';
import { digestCanonical } from '@arena/protocol-core';
import {
  MARKETPLACE_EXPERTS_ERROR_CODES,
  MarketplaceExpertsError,
} from './errors.js';
import {
  deepFreeze,
  isAvailabilityWindow,
  isContentDigest,
  isCurrencyCode,
  isMarketplaceId,
  isMarketplaceTimestamp,
  isNeutralText,
  isOfferKind,
  isOfferStatus,
  isRateUnit,
  isTenantScope,
  toContentDigest,
  toCurrencyCode,
  toMarketplaceId,
  toMarketplaceTimestamp,
  toNeutralText,
  toNonNegativeInteger,
  toPositiveInteger,
  toTenantScope,
} from './shared.js';
import type {
  AvailabilityWindowView,
  ContentDigest,
  MarketplaceId,
  MarketplaceTimestamp,
  NeutralText,
  OfferKind,
  OfferStatus,
  RateUnit,
  RateView,
  TenantScope,
} from './shared.js';

/** Wire version of the commercial-offer record shape. */
export const COMMERCIAL_OFFER_RECORD_VERSION = 1 as const;

/** Wire version of the offer-status record shape. */
export const OFFER_STATUS_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// The offer record
// ---------------------------------------------------------------------------

/** Digest-free view of a commercial offer — exactly what the digest covers. */
export interface CommercialOfferContentView {
  readonly recordVersion: typeof COMMERCIAL_OFFER_RECORD_VERSION;
  /** Offer identity inside the tenant (one live offer chain per id). */
  readonly offerId: MarketplaceId;
  readonly tenant: TenantScope;
  readonly expertId: string;
  /** The listing this offer belongs to (content digest). */
  readonly listingRef: string;
  readonly kind: OfferKind;
  readonly headline: NeutralText;
  readonly rate: RateView;
  /** Minimum notice before an engagement may start (hours, ≥ 0). */
  readonly minNoticeHours: number;
  /** Maximum engagement duration (hours, > 0). */
  readonly maxDurationHours: number;
  readonly availability: readonly AvailabilityWindowView[];
  /**
   * Backing A024 ReleaseRecord digest — REQUIRED iff kind is
   * 'body-backed-service', FORBIDDEN otherwise (closed discipline).
   */
  readonly backingReleaseRef?: string;
  readonly validFrom: MarketplaceTimestamp;
  readonly validUntil: MarketplaceTimestamp;
  /** Initial status — offers are created 'active' and withdraw by append. */
  readonly status: OfferStatus;
  /** The previous offer version this one replaces (append-only lineage). */
  readonly supersedes?: string;
  readonly declaredAt: MarketplaceTimestamp;
}

/** A frozen commercial offer: the content view plus its sha256 digest. */
export interface CommercialOffer extends CommercialOfferContentView {
  readonly digest: ContentDigest;
}

export interface CreateCommercialOfferInput {
  readonly offerId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly listingRef: string;
  readonly kind: OfferKind;
  readonly headline: string;
  readonly rate: {
    readonly currency: string;
    readonly amountMinor: number;
    readonly unit: RateUnit;
  };
  readonly minNoticeHours: number;
  readonly maxDurationHours: number;
  readonly availability?: readonly AvailabilityWindowView[];
  readonly backingReleaseRef?: string;
  readonly validFrom: string;
  readonly validUntil: string;
  readonly supersedes?: string;
  readonly declaredAt: string;
}

/** The offer identity key — (tenant, expertId, offerId). */
export function commercialOfferIdentityKey(
  source: Pick<CommercialOfferContentView, 'tenant' | 'expertId' | 'offerId'>,
): string {
  return `${source.tenant}/${source.expertId}/${source.offerId}`;
}

export function isCommercialOffer(value: unknown): value is CommercialOffer {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== COMMERCIAL_OFFER_RECORD_VERSION) return false;
  if (!isMarketplaceId(candidate['offerId'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (typeof candidate['expertId'] !== 'string' || candidate['expertId'].length === 0) {
    return false;
  }
  if (!isContentDigest(candidate['listingRef'])) return false;
  if (!isOfferKind(candidate['kind'])) return false;
  if (!isNeutralText(candidate['headline'])) return false;
  const rate = candidate['rate'];
  if (typeof rate !== 'object' || rate === null || Array.isArray(rate)) return false;
  const rateRecord = rate as Record<string, unknown>;
  if (!isCurrencyCode(rateRecord['currency'])) return false;
  if (
    typeof rateRecord['amountMinor'] !== 'number' ||
    !Number.isInteger(rateRecord['amountMinor']) ||
    rateRecord['amountMinor'] < 0
  ) {
    return false;
  }
  if (!isRateUnit(rateRecord['unit'])) return false;
  if (
    typeof candidate['minNoticeHours'] !== 'number' ||
    !Number.isInteger(candidate['minNoticeHours']) ||
    candidate['minNoticeHours'] < 0
  ) {
    return false;
  }
  if (
    typeof candidate['maxDurationHours'] !== 'number' ||
    !Number.isInteger(candidate['maxDurationHours']) ||
    candidate['maxDurationHours'] <= 0
  ) {
    return false;
  }
  const availability = candidate['availability'];
  if (!Array.isArray(availability) || !availability.every((entry) => isAvailabilityWindow(entry))) {
    return false;
  }
  if (candidate['kind'] === 'body-backed-service') {
    if (!isContentDigest(candidate['backingReleaseRef'])) return false;
  } else if (candidate['backingReleaseRef'] !== undefined) {
    return false;
  }
  if (!isMarketplaceTimestamp(candidate['validFrom']) || !isMarketplaceTimestamp(candidate['validUntil'])) {
    return false;
  }
  if (candidate['validFrom'] > candidate['validUntil']) return false;
  if (!isOfferStatus(candidate['status'])) return false;
  if (!isMarketplaceTimestamp(candidate['declaredAt'])) return false;
  if (candidate['supersedes'] !== undefined && !isContentDigest(candidate['supersedes'])) {
    return false;
  }
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one commercial offer (status: active). */
export async function createCommercialOffer(
  input: CreateCommercialOfferInput,
): Promise<CommercialOffer> {
  const offerId = toMarketplaceId(input.offerId, 'offerId');
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (typeof input.expertId !== 'string' || input.expertId.length === 0) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_IDENTITY, {
      message: 'expertId requires a non-empty string',
      details: { field: 'expertId' },
    });
  }
  const listingRef = toContentDigest(input.listingRef, 'listingRef');
  if (!isOfferKind(input.kind)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: 'kind must be one of consulting-session|code-review|expert-observation|capability-development|body-backed-service',
      details: { kind: input.kind },
    });
  }
  const headline = toNeutralText(input.headline, 'headline');
  if (typeof input.rate !== 'object' || input.rate === null) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: 'rate requires { currency, amountMinor, unit }',
      details: { field: 'rate' },
    });
  }
  const currency = toCurrencyCode(input.rate.currency, 'rate.currency');
  const amountMinor = toNonNegativeInteger(input.rate.amountMinor, 'rate.amountMinor');
  if (!isRateUnit(input.rate.unit)) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: 'rate.unit must be one of per-hour|per-session|per-task|per-day|fixed',
      details: { unit: input.rate.unit },
    });
  }
  const rate: RateView = Object.freeze({ currency, amountMinor, unit: input.rate.unit });
  const minNoticeHours = toNonNegativeInteger(input.minNoticeHours, 'minNoticeHours');
  const maxDurationHours = toPositiveInteger(input.maxDurationHours, 'maxDurationHours');
  const availability = (input.availability ?? []).map((entry) => {
    if (!isAvailabilityWindow(entry)) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
        message: 'availability entries must be valid typed windows {recurrence, startUtc, endUtc, dayOfWeek?, date?}',
        details: { entry },
      });
    }
    return Object.freeze({ ...entry });
  });
  const backingRequired = input.kind === 'body-backed-service';
  if (backingRequired && input.backingReleaseRef === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: "offers of kind 'body-backed-service' REQUIRE a backingReleaseRef (A024 release digest)",
      details: { kind: input.kind },
    });
  }
  if (!backingRequired && input.backingReleaseRef !== undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: 'backingReleaseRef is only valid on offers of kind body-backed-service (closed discipline)',
      details: { kind: input.kind },
    });
  }
  const backingReleaseRef =
    input.backingReleaseRef === undefined
      ? undefined
      : toContentDigest(input.backingReleaseRef, 'backingReleaseRef');
  const validFrom = toMarketplaceTimestamp(input.validFrom, 'validFrom');
  const validUntil = toMarketplaceTimestamp(input.validUntil, 'validUntil');
  if (validFrom > validUntil) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_TERMS, {
      message: 'offer validity window is inverted (validFrom must be ≤ validUntil)',
      details: { validFrom, validUntil },
    });
  }
  const declaredAt = toMarketplaceTimestamp(input.declaredAt, 'declaredAt');
  const supersedes =
    input.supersedes === undefined ? undefined : toContentDigest(input.supersedes, 'supersedes');

  const view: CommercialOfferContentView = {
    recordVersion: COMMERCIAL_OFFER_RECORD_VERSION,
    offerId,
    tenant,
    expertId: input.expertId,
    listingRef,
    kind: input.kind,
    headline,
    rate,
    minNoticeHours,
    maxDurationHours,
    availability: Object.freeze(availability),
    ...(backingReleaseRef !== undefined ? { backingReleaseRef } : {}),
    validFrom,
    validUntil,
    status: 'active',
    ...(supersedes !== undefined ? { supersedes } : {}),
    declaredAt,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// OfferStatusRecord — the append-only withdrawal record (terminal)
// ---------------------------------------------------------------------------

/** Digest-free view of one appended offer transition. */
export interface OfferStatusRecordView {
  readonly recordVersion: typeof OFFER_STATUS_RECORD_VERSION;
  /** The offer this transition applies to (content digest). */
  readonly offerRef: string;
  /** The tenant of the offer (scope lock — rule 11). */
  readonly tenant: TenantScope;
  /** The closed offer transition vocabulary: withdrawal only. */
  readonly transition: 'withdraw';
  readonly at: MarketplaceTimestamp;
  readonly note?: NeutralText;
}

/** A frozen offer-status record: the view plus its sha256 digest. */
export interface OfferStatusRecord extends OfferStatusRecordView {
  readonly digest: ContentDigest;
}

export interface CreateOfferStatusRecordInput {
  readonly offerRef: string;
  readonly tenant: string;
  readonly transition: 'withdraw';
  readonly at: string;
  readonly note?: string;
}

export function isOfferStatusRecord(value: unknown): value is OfferStatusRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate['recordVersion'] !== OFFER_STATUS_RECORD_VERSION) return false;
  if (!isContentDigest(candidate['offerRef'])) return false;
  if (!isTenantScope(candidate['tenant'])) return false;
  if (candidate['transition'] !== 'withdraw') return false;
  if (typeof candidate['at'] !== 'string' || !isMarketplaceTimestamp(candidate['at'])) {
    return false;
  }
  if (candidate['note'] !== undefined && !isNeutralText(candidate['note'])) return false;
  return isContentDigest(candidate['digest']);
}

/** Construct + validate + digest + freeze one offer-status record. */
export async function createOfferStatusRecord(
  input: CreateOfferStatusRecordInput,
): Promise<OfferStatusRecord> {
  const offerRef = toContentDigest(input.offerRef, 'offerRef');
  const tenant = toTenantScope(input.tenant, 'tenant');
  if (input.transition !== 'withdraw') {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.INVALID_OFFER, {
      message: "the only offer transition is 'withdraw' (re-pricing is supersession, not mutation)",
      details: { transition: input.transition },
    });
  }
  const at = toMarketplaceTimestamp(input.at, 'at');
  const note = input.note === undefined ? undefined : toNeutralText(input.note, 'note');
  const view: OfferStatusRecordView = {
    recordVersion: OFFER_STATUS_RECORD_VERSION,
    offerRef,
    tenant,
    transition: 'withdraw',
    ...(note !== undefined ? { note } : {}),
    at,
  };
  const digest = (await digestCanonical(view)) as ContentDigest;
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// The body-backed gate — A024 release + A023 certification verification
// ---------------------------------------------------------------------------

/** The verified state of one cited certification record. */
export interface VerifiedCertificationRef {
  readonly recordRef: string;
  readonly verdict: string;
  readonly grantedLevel: string | null;
}

/** The full backing-gate report (recorded with the offer event). */
export interface OfferBackingGateReport {
  readonly offerRef: string;
  readonly releaseRef: string;
  readonly releaseKind: string;
  readonly releaseChannel: string | null;
  readonly certifications: readonly VerifiedCertificationRef[];
}

/**
 * Verify the body-backed gate of one offer (fail-closed):
 *
 *   1. the backing A024 ReleaseRecord resolves through the injected
 *      release store and is a 'release-registration' record carrying
 *      frozen gate evidence;
 *   2. EVERY certification digest cited by the release's gate evidence
 *      resolves through the injected certification store AND carries a
 *      'satisfied' verdict (A023 re-verification — the marketplace never
 *      trusts an unverifiable backing).
 */
export async function verifyOfferBackingGate(
  offer: CommercialOffer,
  releases: MarketplaceReleaseRecordStore,
  certifications: MarketplaceCertificationRecordStore,
): Promise<OfferBackingGateReport | null> {
  if (offer.backingReleaseRef === undefined) return null;
  const release: ReleaseRecordView | undefined = await releases.getReleaseRecord(
    offer.backingReleaseRef,
  );
  if (release === undefined) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: `offer backing gate failed: no release record registered at digest ${offer.backingReleaseRef}`,
      details: { offerRef: offer.digest, releaseRef: offer.backingReleaseRef },
    });
  }
  if (release.digest !== offer.backingReleaseRef) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.TAMPERED, {
      message: 'offer backing gate failed: release digest mismatch (tamper check)',
      details: { expected: offer.backingReleaseRef, actual: release.digest },
    });
  }
  if (release.kind !== 'release-registration' || release.gate === null) {
    throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
      message: `offer backing gate failed: release record is a '${release.kind}' (requires 'release-registration' with frozen gate evidence)`,
      details: { releaseRef: offer.backingReleaseRef, kind: release.kind },
    });
  }
  const verifiedCertifications: VerifiedCertificationRef[] = [];
  for (const recordRef of release.gate.certificationRefs) {
    const record: CertificationRecordView | undefined =
      await certifications.getCertificationRecord(recordRef);
    if (record === undefined) {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `offer backing gate failed: cited certification record ${recordRef} does not resolve`,
        details: { releaseRef: offer.backingReleaseRef, recordRef },
      });
    }
    if (record.verdict !== 'satisfied') {
      throw new MarketplaceExpertsError(MARKETPLACE_EXPERTS_ERROR_CODES.GATE_FAILURE, {
        message: `offer backing gate failed: cited certification record ${recordRef} carries verdict '${record.verdict}' (requires 'satisfied')`,
        details: { recordRef, verdict: record.verdict },
      });
    }
    verifiedCertifications.push(
      Object.freeze({
        recordRef,
        verdict: record.verdict,
        grantedLevel: record.grantedLevel,
      }),
    );
  }
  return deepFreeze({
    offerRef: offer.digest,
    releaseRef: offer.backingReleaseRef,
    releaseKind: release.kind,
    releaseChannel: release.channel,
    certifications: Object.freeze(verifiedCertifications),
  });
}
