/**
 * Marketplace access grants (Work Order A032): download/access-grant
 * records with data-rights enforcement (A034) and closed license rules.
 *
 *   - grant issuance records snapshot the offer reference, the grantee
 *     principal, the permitted use (A034 closed vocabulary) and optional
 *     expiry — append-only, content-addressed, deep-frozen;
 *   - grant revocation records cite the issuance digest + grounds
 *     (append-only; the ledger PROJECTS state, never mutates);
 *   - `dataRightsForOffer` derives the A034 DataRightsRecord view of an
 *     offer registration (publication status mapping, license contract
 *     reference, fixed no-retention default) so every read/export
 *     decision goes through @arena/security's closed decision engine;
 *   - `licenseDenial` encodes the marketplace's CLOSED license rules
 *     over the A002 RightsMetadata vocabulary (redistribution /
 *     commercial-use / customer-data).
 */

import { toPrincipalRef } from '@arena/artifact-protocol';
import type { PrincipalRef } from '@arena/artifact-protocol';
import {
  PERMITTED_USES,
  checkDataRightsForAction,
  toDataRightsRecord,
} from '@arena/security';
import type { DataRightsRecord, PermittedUse } from '@arena/security';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import type { MarketplaceOffer, MarketplaceOfferRef } from './offers.js';
import {
  deepFreeze,
  expectDigest,
  expectEnumMember,
  isMarketplaceCorrelationId,
  isMarketplaceId,
  isMarketplaceText,
  isMarketplaceTimestamp,
  viewDigest,
} from './shared.js';

export const MARKETPLACE_GRANT_RECORD_VERSION = 1 as const;

/** Append-only grant record kinds (closed vocabulary). */
export const MARKETPLACE_GRANT_KINDS = Object.freeze([
  'grant-issuance',
  'grant-revocation',
] as const);
export type MarketplaceGrantKind = (typeof MARKETPLACE_GRANT_KINDS)[number];

/** Projected grant lifecycle state (derived by the ledger). */
export const MARKETPLACE_GRANT_STATES = Object.freeze([
  'active',
  'revoked',
  'expired',
  'unknown',
] as const);
export type MarketplaceGrantState = (typeof MARKETPLACE_GRANT_STATES)[number];

/** The grant record view (null-filled per kind). */
export interface MarketplaceGrantView {
  readonly recordVersion: typeof MARKETPLACE_GRANT_RECORD_VERSION;
  readonly kind: MarketplaceGrantKind;
  readonly grantId: string;
  readonly offer: MarketplaceOfferRef;
  readonly grantee: PrincipalRef;
  readonly granteeTenant: string;
  readonly permittedUse: PermittedUse | null;
  readonly grantedAt: string | null;
  readonly expiresAt: string | null;
  readonly revokes: string | null;
  readonly grounds: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly grantedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** A content-addressed grant record. */
export interface MarketplaceGrant extends MarketplaceGrantView {
  readonly digest: string;
}

/** Input for grant record creation. */
export interface CreateMarketplaceGrantInput {
  readonly kind: MarketplaceGrantKind;
  readonly grantId: string;
  readonly offer: { offerId: string; offerDigest: string };
  readonly grantee: { type: string; tenant: string; principalId: string };
  readonly permittedUse?: PermittedUse | null;
  readonly grantedAt?: string | null;
  readonly expiresAt?: string | null;
  readonly revokes?: string | null;
  readonly grounds?: string | null;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly provenance: {
    readonly grantedBy: string;
    readonly recordedAt: string;
    readonly notes: string | null;
  };
}

/** Create one content-addressed, deep-frozen grant record. */
export async function createMarketplaceGrantRecord(
  input: CreateMarketplaceGrantInput,
): Promise<MarketplaceGrant> {
  const kind = expectEnumMember(
    input.kind,
    MARKETPLACE_GRANT_KINDS,
    MARKETPLACE_ERROR_CODES.INVALID_GRANT,
    'grant kind',
  );
  if (!isMarketplaceId(input.grantId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grantId must match the marketplace id pattern',
    });
  }
  if (!isMarketplaceId(input.offer.offerId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant offer.offerId must match the marketplace id pattern',
    });
  }
  expectDigest(input.offer.offerDigest, MARKETPLACE_ERROR_CODES.INVALID_GRANT, 'grant offer.offerDigest');
  if (!isMarketplaceCorrelationId(input.correlationId)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant correlationId must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceCorrelationId(input.idempotencyKey)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant idempotencyKey must match the protocol-core identifier pattern',
    });
  }
  if (!isMarketplaceId(input.provenance.grantedBy)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant provenance.grantedBy must be a marketplace id',
    });
  }
  if (!isMarketplaceTimestamp(input.provenance.recordedAt)) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'grant provenance.recordedAt must be a ms-precision UTC timestamp',
    });
  }

  const grantee = toPrincipalRef(input.grantee);

  // Per-kind forbidden-field discipline (fail closed).
  if (kind === 'grant-issuance') {
    if (input.revokes !== undefined && input.revokes !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-issuance must not carry revokes',
      });
    }
    if (input.grounds !== undefined && input.grounds !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-issuance must not carry grounds',
      });
    }
    if (input.permittedUse === undefined || input.permittedUse === null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-issuance requires a permittedUse (A034 closed vocabulary)',
        details: { known: [...PERMITTED_USES] },
      });
    }
    expectEnumMember(
      input.permittedUse,
      PERMITTED_USES,
      MARKETPLACE_ERROR_CODES.INVALID_GRANT,
      'grant permittedUse',
    );
    if (!isMarketplaceTimestamp(input.grantedAt ?? null)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-issuance requires grantedAt as a ms-precision UTC timestamp',
      });
    }
    if (
      input.expiresAt !== undefined &&
      input.expiresAt !== null &&
      !isMarketplaceTimestamp(input.expiresAt)
    ) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant expiresAt must be a ms-precision UTC timestamp or null',
      });
    }
    if (input.expiresAt !== undefined && input.expiresAt !== null && input.grantedAt !== undefined && input.grantedAt !== null) {
      if (Date.parse(input.expiresAt) <= Date.parse(input.grantedAt)) {
        throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
          message: 'grant expiresAt must be strictly after grantedAt',
        });
      }
    }
  } else {
    // grant-revocation
    if (input.permittedUse !== undefined && input.permittedUse !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-revocation must not carry permittedUse',
      });
    }
    if (input.grantedAt !== undefined && input.grantedAt !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-revocation must not carry grantedAt',
      });
    }
    if (input.expiresAt !== undefined && input.expiresAt !== null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-revocation must not carry expiresAt',
      });
    }
    if (input.revokes === undefined || input.revokes === null) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-revocation requires revokes (digest of the issuance record)',
      });
    }
    expectDigest(input.revokes, MARKETPLACE_ERROR_CODES.INVALID_GRANT, 'grant revokes');
    if (input.grounds === undefined || input.grounds === null || !isMarketplaceText(input.grounds)) {
      throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
        message: 'grant-revocation requires grounds (recorded WHY)',
      });
    }
  }

  const view: MarketplaceGrantView = {
    recordVersion: MARKETPLACE_GRANT_RECORD_VERSION,
    kind,
    grantId: input.grantId,
    offer: deepFreeze({ ...input.offer }),
    grantee,
    granteeTenant: grantee.tenant,
    permittedUse: input.permittedUse ?? null,
    grantedAt: input.grantedAt ?? null,
    expiresAt: input.expiresAt ?? null,
    revokes: input.revokes ?? null,
    grounds: input.grounds ?? null,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    provenance: {
      grantedBy: input.provenance.grantedBy,
      recordedAt: input.provenance.recordedAt,
      notes: input.provenance.notes,
    },
  };

  const digest = await viewDigest(view);
  return deepFreeze({ ...view, digest });
}

// ---------------------------------------------------------------------------
// Data-rights derivation (A034 enforcement) and closed license rules
// ---------------------------------------------------------------------------

/** Marketplace license denial reasons (closed vocabulary). */
export const MARKETPLACE_LICENSE_DENIAL_REASONS = Object.freeze([
  'license-redistribution-prohibited',
  'license-commercial-prohibited',
  'license-customer-data',
] as const);
export type MarketplaceLicenseDenialReason =
  (typeof MARKETPLACE_LICENSE_DENIAL_REASONS)[number];

/**
 * Derive the A034 DataRightsRecord view of an offer registration:
 *   - publication status maps from listing visibility;
 *   - the license id becomes the contract reference;
 *   - retention defaults to 'none' (marketplace offers never carry
 *     time-boxed retention — that is the offer owner's governance).
 */
export function dataRightsForOffer(offer: MarketplaceOffer): DataRightsRecord {
  if (offer.rights === null || offer.visibility === null || offer.offeredAt === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'data rights projection requires a content-bearing offer record',
      details: { offerId: offer.offerId },
    });
  }
  return toDataRightsRecord({
    recordVersion: 1,
    owner: offer.tenant,
    source: `marketplace-offer:${offer.offerId}`,
    permittedUse: 'tenant-internal',
    contractRef: offer.rights.license,
    retention: { recordVersion: 1, mode: 'none', retentionDays: null, expiresAt: null },
    publicationStatus: offer.visibility === 'public' ? 'public' : 'tenant-internal',
    recordedAt: offer.offeredAt,
  });
}

/**
 * The closed license rules over A002 RightsMetadata:
 *   L1 redistribution — cross-tenant grants require 'allowed';
 *   L2 commercial-use — 'prohibited' forbids the public-display use;
 *   L3 customer-data — non-'none' forbids cross-tenant-learning
 *      (R47: no raw customer data leakage across tenants).
 * Returns the denial reason or null when the license permits the grant.
 */
export function licenseDenial(
  offer: MarketplaceOffer,
  granteeTenant: string,
  permittedUse: PermittedUse,
): MarketplaceLicenseDenialReason | null {
  if (offer.rights === null) {
    throw new MarketplaceError(MARKETPLACE_ERROR_CODES.INVALID_GRANT, {
      message: 'license evaluation requires a content-bearing offer record',
    });
  }
  const crossTenant = granteeTenant !== offer.tenant;
  if (crossTenant && offer.rights.redistribution !== 'allowed') {
    return 'license-redistribution-prohibited';
  }
  if (offer.rights.commercialUse === 'prohibited' && permittedUse === 'public-display') {
    return 'license-commercial-prohibited';
  }
  if (offer.rights.customerData !== 'none' && permittedUse === 'cross-tenant-learning') {
    return 'license-customer-data';
  }
  return null;
}

/** A034 read decision for a grant (as-of evaluated, fail closed). */
export function dataRightsReadDecision(
  offer: MarketplaceOffer,
  asOf: string,
  granteeTenant: string,
): ReturnType<typeof checkDataRightsForAction> {
  const rights = dataRightsForOffer(offer);
  return checkDataRightsForAction(rights, 'read', asOf, {
    crossTenant: granteeTenant !== offer.tenant,
  });
}

/** The grant reference (id + issuance digest). */
export function grantRefOf(grant: MarketplaceGrant): MarketplaceOfferRef {
  return deepFreeze({ offerId: grant.grantId, offerDigest: grant.digest });
}

export type { MarketplaceOfferRef };
