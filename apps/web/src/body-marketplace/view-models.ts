/**
 * Body-marketplace view models (Work Order C014): pure projections of
 * the runtime compositions into render-ready shapes. The certification
 * presence is RECORD-BACKED ONLY — the shared state vocabulary law
 * (never an invented badge; 'unverified' renders as its honest state).
 */

import type { CapabilityBodyListing, PretrainingRunRecord } from '../../../../services/body-marketplace/src/index.js';
import type { BodyMarketplaceProjection } from './runtime.js';

/** The closed state-vocabulary keys the views render. */
export const BODY_MARKETPLACE_ROUTE_STATES = Object.freeze([
  'loading',
  'empty',
  'error',
  'permission-denied',
  'demo-data',
  'success',
] as const);
export type BodyMarketplaceRouteState = (typeof BODY_MARKETPLACE_ROUTE_STATES)[number];

/** One browse row (record-backed certification only). */
export interface ListingRowViewModel {
  readonly listingId: string;
  readonly title: string;
  readonly summary: string;
  readonly state: string;
  readonly version: number;
  readonly bodyVersion: string;
  readonly channel: string | null;
  readonly certificationState: string;
  readonly grantedLevel: string | null;
  readonly pricing: string | null;
}

/** The detail view model (lineage/provenance, rights, substrates). */
export interface ListingDetailViewModel {
  readonly row: ListingRowViewModel;
  readonly forgeRecordDigest: string | null;
  readonly pretrainingRunId: string | null;
  readonly certificationRefs: readonly string[];
  readonly capabilityEvidenceRefs: readonly string[];
  readonly rights: Readonly<Record<string, unknown>> | null;
  readonly substrateCompatibility: Readonly<Record<string, unknown>> | null;
  readonly history: readonly { readonly from: string; readonly to: string; readonly reason: string }[];
}

/** One pretraining-run row (consequence exposure for blocked runs). */
export interface PretrainingRunRowViewModel {
  readonly runId: string;
  readonly outcome: 'proposed' | 'blocked';
  readonly capabilityNeedSummary: string;
  readonly bodyVersion: string | null;
  readonly blockedReasons: readonly string[];
  readonly validatedEvidenceRefs: readonly string[];
}

/** The browse/home view model. */
export interface BrowseViewModel {
  readonly state: BodyMarketplaceRouteState;
  readonly mode: 'demo' | 'session';
  readonly tenantLabel: string;
  readonly rows: readonly ListingRowViewModel[];
  readonly roleLens: RoleLens;
}

/** The my-listings view model. */
export interface MyListingsViewModel {
  readonly state: BodyMarketplaceRouteState;
  readonly mode: 'demo' | 'session';
  readonly tenantLabel: string;
  readonly rows: readonly ListingRowViewModel[];
  readonly runs: readonly PretrainingRunRowViewModel[];
}

/** The detail view model envelope. */
export interface ListingDetailOutcome {
  readonly state: BodyMarketplaceRouteState;
  readonly model: ListingDetailViewModel | null;
}

/** The persistent role lens (query-state role switching; not permission). */
export const BODY_MARKETPLACE_ROLE_LENSES = Object.freeze([
  'buyer',
  'publisher',
  'auditor',
] as const);
export type RoleLens = (typeof BODY_MARKETPLACE_ROLE_LENSES)[number];

export function toRoleLens(value: string | undefined): RoleLens {
  return (BODY_MARKETPLACE_ROLE_LENSES as readonly string[]).includes(value ?? '')
    ? (value as RoleLens)
    : 'buyer';
}

function pricingLabel(listing: CapabilityBodyListing): string | null {
  if (listing.pricing === null) return null;
  return `${(listing.pricing.amountMinorUnits / 1_000_000).toFixed(2)} ${listing.pricing.currency} (${listing.pricing.model})`;
}

/** Project one listing row (certification presence is record-backed only). */
export function listingRow(
  listing: CapabilityBodyListing,
  certification: { state: string; strongestGrant: string | null },
): ListingRowViewModel {
  return {
    listingId: listing.listingId,
    title: listing.title,
    summary: listing.summary,
    state: listing.state,
    version: listing.version,
    bodyVersion: `${listing.bodyVersionRef.tenant}/${listing.bodyVersionRef.name}@${listing.bodyVersionRef.version}`,
    channel: listing.channel,
    certificationState: certification.state,
    grantedLevel: certification.strongestGrant,
    pricing: pricingLabel(listing),
  };
}

/** Project the browse/home view. */
export function browseView(
  projection: BodyMarketplaceProjection,
  roleLens: RoleLens,
): BrowseViewModel {
  const rows = projection.listings.map((listing) =>
    listingRow(listing, projection.certification[listing.listingId] ?? { state: 'unverified', strongestGrant: null }),
  );
  return {
    state: rows.length === 0 ? 'empty' : projection.mode === 'demo' ? 'demo-data' : 'success',
    mode: projection.mode,
    tenantLabel: projection.tenantId,
    rows,
    roleLens,
  };
}

/** Project my-listings (listings + pretraining runs). */
export function myListingsView(
  projection: BodyMarketplaceProjection,
): MyListingsViewModel {
  const rows = projection.listings.map((listing) =>
    listingRow(listing, projection.certification[listing.listingId] ?? { state: 'unverified', strongestGrant: null }),
  );
  const runs = projection.runs.map((run: PretrainingRunRecord) => ({
    runId: run.runId,
    outcome: run.outcome,
    capabilityNeedSummary: run.capabilityNeedSummary,
    bodyVersion:
      run.bodyVersionRef === null
        ? null
        : `${run.bodyVersionRef.tenant}/${run.bodyVersionRef.name}@${run.bodyVersionRef.version}`,
    blockedReasons: run.blockedReasons.map((reason) => `${reason.code}: ${reason.detail}`),
    validatedEvidenceRefs: run.validatedEvidenceRefs,
  }));
  return {
    state:
      rows.length === 0 && runs.length === 0
        ? 'empty'
        : projection.mode === 'demo'
          ? 'demo-data'
          : 'success',
    mode: projection.mode,
    tenantLabel: projection.tenantId,
    rows,
    runs,
  };
}

/** Project one listing detail (tenant-scoped reads only). */
export function listingDetail(
  listing: CapabilityBodyListing,
  certification: { state: string; strongestGrant: string | null },
): ListingDetailOutcome {
  return {
    state: 'success',
    model: {
      row: listingRow(listing, certification),
      forgeRecordDigest: listing.forgeRecordDigest,
      pretrainingRunId: listing.pretrainingRunId,
      certificationRefs: listing.certificationRefs,
      capabilityEvidenceRefs: listing.capabilityEvidenceRefs,
      rights: listing.rights,
      substrateCompatibility: listing.substrateCompatibility,
      history: listing.history.map((entry) => ({
        from: entry.from,
        to: entry.to,
        reason: entry.reason,
      })),
    },
  };
}
