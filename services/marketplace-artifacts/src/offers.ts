/**
 * Marketplace offer records (Work Order A032): the versioned
 * offer/license records with append-only lineage that back every
 * dataset / evaluation-suite / environment listing.
 *
 * Model (mirrors the A024 ReleaseRecord discipline — one content-
 * addressed, deep-frozen record shape; per-kind forbidden-field
 * discipline; the ledger PROJECTS lifecycle state, records are never
 * mutated):
 *
 *   offer-registration  — full offer content (artifact ref, title,
 *                         summary, publisher, RIGHTS/license metadata,
 *                         visibility, offeredAt). No supersedes/retires/
 *                         grounds (forbidden fields).
 *   offer-supersession  — full NEW offer content for the SAME offerId +
 *                         `supersedes` (digest of the registration being
 *                         replaced) + `grounds` (why). No retires.
 *   offer-retirement    — offer reference only: `retires` (digest of the
 *                         retired registration) + `grounds`. Content
 *                         fields are null (forbidden fields).
 *
 * Validation reuses the A002 guards (toArtifactRef / toPrincipalRef /
 * toRightsMetadata) — the artifact identity, principal and rights
 * vocabularies are NEVER redefined here.
 */

import {
  toArtifactRef,
  toPrincipalRef,
  toRightsMetadata,
} from '@arena/artifact-protocol';
import type { ArtifactRef, PrincipalRef, RightsMetadata } from '@arena/artifact-protocol';
import {
  MARKETPLACE_ERROR_CODES,
  MarketplaceError,
} from './errors.js';
import {
  deepFreeze,
  expectDigest,
  expectEnumMember,
  isEnumMember,
  isMarketplaceCorrelationId,
  isMarketplaceId,
  isMarketplaceText,
  isMarketplaceTimestamp,
  viewDigest,
} from './shared.js';

export const MARKETPLACE_OFFER_RECORD_VERSION = 1 as const;

/** Append-only offer record kinds (closed vocabulary). */
export const MARKETPLACE_OFFER_KINDS = Object.freeze([
  'offer-registration',
  'offer-supersession',
  'offer-retirement',
] as const);
export type MarketplaceOfferKind = (typeof MARKETPLACE_OFFER_KINDS)[number];

/** The three marketplace artifact domains (closed vocabulary). */
export const MARKETPLACE_ARTIFACT_KINDS = Object.freeze([
  'dataset',
  'evaluation-suite',
  'environment',
] as const);
export type MarketplaceArtifactKind = (typeof MARKETPLACE_ARTIFACT_KINDS)[number];

/** Listing visibility (public catalog vs tenant-internal, R24). */
export const MARKETPLACE_VISIBILITIES = Object.freeze(['public', 'tenant-internal'] as const);
export type MarketplaceVisibility = (typeof MARKETPLACE_VISIBILITIES)[number];

/** Projected lifecycle state of an offerId (never stored, always derived). */
export const MARKETPLACE_OFFER_STATES = Object.freeze([
  'registered',
  'superseded',
  'retired',
  'unknown',
] as const);
export type MarketplaceOfferState = (typeof MARKETPLACE_OFFER_STATES)[number];

/** Address of an offer: its id plus the content digest of a registration record. */
export interface MarketplaceOfferRef {
  readonly offerId: string;
  readonly offerDigest: string;
}

/** The offer record view (null-filled per kind; content fields belong to
 * registration/supersession ONLY). */
export interface MarketplaceOfferView {
  readonly recordVersion: typeof MARKETPLACE_OFFER_RECORD_VERSION;
  readonly kind: MarketplaceOfferKind;
  readonly offerId: string;
  readonly artifactKind: MarketplaceArtifactKind;
  readonly artifact: ArtifactRef | null;
  readonly title: string | null;
  readonly summary: string | null;
  readonly publisher: PrincipalRef | null;
  readonly rights: RightsMetadata | null;
  /** Owning tenant (publisher tenant; null on retirement references). */
  readonly tenant: string | null;
  readonly visibility: MarketplaceVisibility | null;
  readonly offeredAt: string | null;
  readonly supersedes: string | null;
  readonly retires: string | null;
  readonly grounds: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly offeredBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** A content-addressed offer record. */
export interface MarketplaceOffer extends MarketplaceOfferView {
  readonly digest: string;
}

/** Input for offer record creation (all optional fields default to null). */
export interface CreateMarketplaceOfferInput {
  readonly kind: MarketplaceOfferKind;
  readonly offerId: string;
  readonly artifactKind: MarketplaceArtifactKind;
  readonly artifact?: { namespace: string; name: string; version: string; digest: string } | null;
  readonly title?: string | null;
  readonly summary?: string | null;
  readonly publisher?: { type: string; tenant: string; principalId: string } | null;
  readonly rights?: unknown;
  readonly visibility?: MarketplaceVisibility | null;
  readonly offeredAt?: string | null;
  readonly supersedes?: string | null;
  readonly retires?: string | null;
  readonly grounds?: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly offeredBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

const CONTENT_FIELDS = Object.freeze([
  'artifact',
  'title',
  'summary',
  'publisher',
  'rights',
  'visibility',
  'offeredAt',
] as const);

function expectOfferText(value: string | null | undefined, field: string): string {
  if (value === undefined || value === null || !isMarketplaceText(value)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: `offer ${JSON.stringify(field)} must be 1-512 printable characters`,
      details: { field },
    });
  }
  return value;
}

/** Create one content-addressed, deep-frozen offer record. */
export async function createMarketplaceOfferRecord(
  input: CreateMarketplaceOfferInput,
): Promise<MarketplaceOffer> {
  const kind = expectEnumMember(
    input.kind,
    MARKETPLACE_OFFER_KINDS,
    MARKETPLACE_ERROR_CODES.INVALID_OFFER,
    'offer kind',
  );
  if (!isMarketplaceId(input.offerId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: `offerId must match ${JSON.stringify('^[a-z][a-z0-9-]{1,63}$')}`,
      details: { offerId: input.offerId },
    });
  }
  expectEnumMember(
    input.artifactKind,
    MARKETPLACE_ARTIFACT_KINDS,
    MARKETPLACE_ERROR_CODES.INVALID_OFFER,
    'artifactKind',
  );
  if (!isMarketplaceCorrelationId(input.correlationId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer correlationId must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceCorrelationId(input.idempotencyKey)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer idempotencyKey must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceId(input.provenance.offeredBy)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer provenance.offeredBy must be a marketplace id',
    });
  }
  if (!isMarketplaceTimestamp(input.provenance.recordedAt)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer provenance.recordedAt must be a ms-precision UTC timestamp',
    });
  }
  if (input.provenance.notes !== null && !isMarketplaceText(input.provenance.notes)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer provenance.notes must be neutral text or null',
    });
  }

  const carriesContent = kind === 'offer-registration' || kind === 'offer-supersession';
  const hasContent =
    input.artifact !== undefined &&
    input.artifact !== null &&
    input.title !== undefined &&
    input.title !== null;

  // --- per-kind forbidden-field discipline (fail closed) -------------------
  if (carriesContent && !hasContent) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: `${JSON.stringify(kind)} requires the offer content fields (artifact, title, summary, publisher, rights, visibility, offeredAt)`,
    });
  }
  if (!carriesContent && hasContent) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: `${JSON.stringify(kind)} must NOT carry offer content fields (they are forbidden on retirement)`,
    });
  }
  if (kind === 'offer-registration' && (input.supersedes ?? null) !== null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer-registration must not carry supersedes (append-only lineage starts clean)',
    });
  }
  if (kind !== 'offer-supersession' && (input.supersedes ?? null) !== null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'supersedes is a supersession-only field',
    });
  }
  if (kind !== 'offer-retirement' && (input.retires ?? null) !== null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'retires is a retirement-only field',
    });
  }
  if (kind === 'offer-registration' && (input.grounds ?? null) !== null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer-registration must not carry grounds',
    });
  }
  if (kind !== 'offer-registration' && (input.grounds ?? null) === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: `${JSON.stringify(kind)} requires grounds (recorded WHY)`,
    });
  }

  // --- content validation (A002 guards reused) -----------------------------
  let artifact: ArtifactRef | null = null;
  let title: string | null = null;
  let summary: string | null = null;
  let publisher: PrincipalRef | null = null;
  let rights: RightsMetadata | null = null;
  let visibility: MarketplaceVisibility | null = null;
  let offeredAt: string | null = null;

  if (carriesContent) {
    artifact = toArtifactRef(input.artifact as { namespace: string; name: string; version: string; digest: string });
    title = expectOfferText(input.title, 'title');
    summary = expectOfferText(input.summary, 'summary');
    publisher = toPrincipalRef(
      input.publisher as { type: string; tenant: string; principalId: string },
    );
    // Architecture-lock rule 23: rights metadata is MANDATORY on publication.
    if (input.rights === undefined || input.rights === null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_RIGHTS, {
        message: 'rights (license metadata) are mandatory on marketplace offers',
      });
    }
    rights = toRightsMetadata(input.rights);
    visibility = expectEnumMember(
      input.visibility ?? null,
      MARKETPLACE_VISIBILITIES,
      MARKETPLACE_ERROR_CODES.INVALID_OFFER,
      'offer visibility',
    );
    if (!isMarketplaceTimestamp(input.offeredAt ?? null)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
        message: 'offeredAt must be a ms-precision UTC timestamp',
      });
    }
    offeredAt = input.offeredAt as string;
  }

  const supersedes =
    input.supersedes === undefined || input.supersedes === null
      ? null
      : expectDigest(input.supersedes, MARKETPLACE_ERROR_CODES.INVALID_OFFER, 'supersedes');
  const retires =
    input.retires === undefined || input.retires === null
      ? null
      : expectDigest(input.retires, MARKETPLACE_ERROR_CODES.INVALID_OFFER, 'retires');
  const grounds =
    input.grounds === undefined || input.grounds === null ? null : expectOfferText(input.grounds, 'grounds');

  // The owning tenant is the publisher's tenant (content kinds only;
  // retirement references carry no tenant — the ledger resolves it).
  const tenant: string | null = carriesContent ? (publisher as PrincipalRef).tenant : null;

  const view: MarketplaceOfferView = {
    recordVersion: MARKETPLACE_OFFER_RECORD_VERSION,
    kind,
    offerId: input.offerId,
    artifactKind: input.artifactKind,
    artifact,
    title,
    summary,
    publisher,
    rights,
    tenant,
    visibility,
    offeredAt,
    supersedes,
    retires,
    grounds,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    provenance: {
      offeredBy: input.provenance.offeredBy,
      recordedAt: input.provenance.recordedAt,
      notes: input.provenance.notes,
    },
  };

  const digest = await viewDigest(view);
  const record: MarketplaceOffer = deepFreeze({ ...view, digest });
  return record;
}

/** Structural (non-throwing) view guard. */
export function isMarketplaceOfferView(value: unknown): value is MarketplaceOfferView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === MARKETPLACE_OFFER_RECORD_VERSION &&
    isEnumMember(candidate['kind'], MARKETPLACE_OFFER_KINDS) &&
    typeof candidate['offerId'] === 'string' &&
    typeof candidate['correlationId'] === 'string' &&
    typeof candidate['idempotencyKey'] === 'string' &&
    typeof candidate['artifactKind'] === 'string'
  );
}

/** Structural (non-throwing) record guard. */
export function isMarketplaceOffer(value: unknown): value is MarketplaceOffer {
  return (
    isMarketplaceOfferView(value) &&
    typeof (value as unknown as Record<string, unknown>)['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(String((value as unknown as Record<string, unknown>)['digest']))
  );
}

/** Recompute the record digest; a mismatch is TAMPERED (fail closed). */
export async function verifyMarketplaceOffer(
  offer: MarketplaceOffer,
  expectedDigest?: string,
): Promise<string> {
  const { digest: _digest, ...view } = offer;
  const recomputed = await viewDigest(view);
  if (recomputed !== offer.digest) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.TAMPERED, {
      message: 'offer record digest does not match its content',
      details: { offerId: offer.offerId },
    });
  }
  if (expectedDigest !== undefined && expectedDigest !== offer.digest) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.TAMPERED, {
      message: 'offer record digest does not match the cited digest',
      details: { offerId: offer.offerId },
    });
  }
  return recomputed;
}

/** The offer reference (id + registration digest). */
export function offerRefOf(offer: MarketplaceOffer): MarketplaceOfferRef {
  return deepFreeze({ offerId: offer.offerId, offerDigest: offer.digest });
}

/** Offer listing summary (the browse/search projection). */
export interface MarketplaceOfferSummary {
  readonly offerId: string;
  readonly offerDigest: string;
  readonly artifactKind: MarketplaceArtifactKind;
  readonly artifact: ArtifactRef;
  readonly title: string;
  readonly tenant: string;
  readonly visibility: MarketplaceVisibility;
  readonly offeredAt: string;
}

/** Project a registration/supersession record into a listing summary. */
export function offerSummaryOf(offer: MarketplaceOffer): MarketplaceOfferSummary {
  if (offer.artifact === null || offer.title === null || offer.visibility === null || offer.offeredAt === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_OFFER, {
      message: 'offer summaries project content-bearing records only',
      details: { offerId: offer.offerId, kind: offer.kind },
    });
  }
  return deepFreeze({
    offerId: offer.offerId,
    offerDigest: offer.digest,
    artifactKind: offer.artifactKind,
    artifact: offer.artifact,
    title: offer.title,
    tenant: offer.tenant as string,
    visibility: offer.visibility,
    offeredAt: offer.offeredAt,
  });
}

/** Resolved status of an offerId (the ledger projection). */
export interface MarketplaceOfferStatus {
  readonly offerId: string;
  readonly state: MarketplaceOfferState;
  readonly visibility: MarketplaceVisibility | 'unknown';
  readonly registration: MarketplaceOffer | null;
  readonly offerDigest: string | null;
}

export { CONTENT_FIELDS };
