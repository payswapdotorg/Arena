/**
 * Marketplace view-model composition (Work Order B013; issue #88;
 * apps/web/src/marketplace). SERVER-ONLY.
 *
 * Composes the corpus + canonical certification reads into the frozen view
 * models the marketplace screens render — every projection flows through
 * the @arena/marketplace-ui builders (honest readers, truth classes,
 * explicit entitlement states). This layer adds NO interpretation of its
 * own: it scopes listings to the READING tenant (the corpus's own
 * visibility/grantee data — display scoping, never authorization), never
 * computes prices, never certifies.
 */

import {
  asRecord,
  buildArtifactListingCard,
  buildArtifactListingDetail,
  buildCertificationPresence,
  buildExpertListingCard,
  buildPurchaseActionView,
  deepFreezeView,
  entitlementStateFromGrantRecord,
  entitlementStateFromMarketplaceGrant,
  ENTITLEMENT_STATE_NOTE,
  PURCHASE_NOT_CERTIFICATION_NOTE,
  readString,
} from '../../../../packages/marketplace-ui/src/index.js';
import type {
  ArtifactListingCard,
  CertificationPresence,
  EntitlementStateView,
  ExpertListingCard,
  PurchaseActionView,
} from '../../../../packages/marketplace-ui/src/index.js';
import type { MarketplaceReadPort } from './runtime.js';
import type { MarketplaceCorpus, MarketplaceMode } from './corpus.js';

/** The view-model wire version. */
export const MARKETPLACE_VIEW_VERSION = 1 as const;

/** The demo stamp every demo view model carries. */
export interface MarketplaceDemoStamp {
  readonly isDemo: boolean;
  readonly corpusHash: string | undefined;
}

/** The marketplace home (browse) view model. */
export interface MarketplaceHomeViewModel {
  readonly viewVersion: typeof MARKETPLACE_VIEW_VERSION;
  readonly mode: MarketplaceMode;
  readonly demo: MarketplaceDemoStamp;
  readonly tenantId: string;
  readonly workspaceId: string | undefined;
  readonly principalLabel: string | undefined;
  readonly expertListings: readonly ExpertListingCard[];
  readonly artifactListings: readonly ArtifactListingCard[];
  /** Certification records in this workspace (composition-scoped, honestly projected). */
  readonly certifications: readonly CertificationPresence[];
  readonly scopeNote: string;
  readonly generatedNote: string;
  readonly counts: Readonly<Record<string, number>>;
}

/** The listing detail outcome (honest shapes — never a fabricated listing). */
export type MarketplaceDetailOutcome =
  | {
      readonly kind: 'not-found';
      readonly family: string;
      readonly listingId: string;
    }
  | {
      readonly kind: 'expert';
      readonly mode: MarketplaceMode;
      readonly demo: MarketplaceDemoStamp;
      readonly card: ExpertListingCard;
      readonly purchase: PurchaseActionView;
      readonly certifications: readonly CertificationPresence[];
    }
  | {
      readonly kind: 'artifact';
      readonly mode: MarketplaceMode;
      readonly demo: MarketplaceDemoStamp;
      readonly detail: ReturnType<typeof buildArtifactListingDetail>;
      readonly certifications: readonly CertificationPresence[];
    };

/** The entitlements view model. */
export interface MarketplaceEntitlementsViewModel {
  readonly viewVersion: typeof MARKETPLACE_VIEW_VERSION;
  readonly mode: MarketplaceMode;
  readonly demo: MarketplaceDemoStamp;
  readonly tenantId: string;
  /** A032 marketplace access grants (the listing grant ledger). */
  readonly marketplaceGrants: readonly EntitlementStateView[];
  /** A033 feature entitlement grants (the explicit state machine). */
  readonly featureGrants: readonly EntitlementStateView[];
  readonly scopeNote: string;
  readonly generatedNote: string;
}

// ---------------------------------------------------------------------------
// Tenant scoping (the corpus's own visibility/grantee data — a lens, never
// an authorization; the fabrics fail closed on cross-tenant access)
// ---------------------------------------------------------------------------

/** True iff a marketplace grant record belongs to the reading tenant. */
function grantBelongsToTenant(grant: unknown, tenant: string): boolean {
  const data = asRecord(grant);
  if (readString(data, 'granteeTenant') === tenant) return true;
  return readString(asRecord(data['grantee']), 'tenant') === tenant;
}

/** True iff an artifact listing input is visible to the reading tenant. */
function listingVisibleToListingTenant(listing: unknown, tenant: string): boolean {
  const data = asRecord(listing);
  const visibility = readString(data, 'visibility');
  const owner = readString(data, 'tenant');
  if (visibility === 'tenant-internal') return owner === tenant;
  return true;
}

/** Scope one artifact listing input to the reading tenant (its grants only). */
function scopeArtifactListing(listing: unknown, tenant: string): unknown {
  const data = asRecord(listing);
  const grantsValue = data['grants'];
  const grants = Array.isArray(grantsValue)
    ? grantsValue.filter((grant) => grantBelongsToTenant(grant, tenant))
    : [];
  return { ...data, grants };
}

// ---------------------------------------------------------------------------
// Certification reads (the ONE read-model kind the marketplace renders)
// ---------------------------------------------------------------------------

/**
 * Scroll the workspace certification records through the canonical read
 * port (session: the B005 read-API boundary; demo: the DemoReadSession) and
 * project them honestly. The read-model kind vocabulary is B005-owned —
 * the marketplace extends it with NOTHING.
 */
export async function scrollCertificationPresences(
  port: MarketplaceReadPort,
): Promise<readonly CertificationPresence[]> {
  const page = await port.scroll('certification');
  return page.records.map((record) => buildCertificationPresence(record));
}

// ---------------------------------------------------------------------------
// The view builders
// ---------------------------------------------------------------------------

/** The composition input shared by every builder. */
export interface MarketplaceViewInput {
  readonly mode: MarketplaceMode;
  readonly corpus: MarketplaceCorpus;
  /** The reading tenant (session facts or the demo tenant). */
  readonly readingTenant: string;
  readonly workspaceId: string | undefined;
  readonly principalLabel: string | undefined;
  readonly certifications: readonly CertificationPresence[];
  readonly demo: MarketplaceDemoStamp;
}

/** Build the marketplace home (browse) view model. */
export function buildMarketplaceHomeView(input: MarketplaceViewInput): MarketplaceHomeViewModel {
  const expertListings = input.corpus.expertListings
    .filter((listing) => readString(asRecord(listing), 'tenant') === input.readingTenant)
    .map((listing) => buildExpertListingCard(listing));
  const artifactListings = input.corpus.artifactListings
    .filter((listing) => listingVisibleToListingTenant(listing, input.readingTenant))
    .map((listing) => buildArtifactListingCard(scopeArtifactListing(listing, input.readingTenant)));
  return deepFreezeView({
    viewVersion: MARKETPLACE_VIEW_VERSION,
    mode: input.mode,
    demo: input.demo,
    tenantId: input.readingTenant,
    workspaceId: input.workspaceId,
    principalLabel: input.principalLabel,
    expertListings,
    artifactListings,
    certifications: input.certifications,
    scopeNote: PURCHASE_NOT_CERTIFICATION_NOTE,
    generatedNote: input.corpus.generatedNote,
    counts: input.corpus.counts,
  } satisfies MarketplaceHomeViewModel);
}

/**
 * Build the listing detail outcome for one family + listing id. Honest
 * shapes: unknown ids and cross-tenant tenant-internal listings render
 * not-found — never a fabricated listing.
 */
export function buildMarketplaceDetailOutcome(input: {
  readonly mode: MarketplaceMode;
  readonly corpus: MarketplaceCorpus;
  readonly readingTenant: string;
  readonly family: string;
  readonly listingId: string;
  readonly certifications: readonly CertificationPresence[];
  readonly demo: MarketplaceDemoStamp;
}): MarketplaceDetailOutcome {
  if (input.family === 'experts') {
    const listing = input.corpus.expertListings.find(
      (candidate) => readString(asRecord(candidate), 'listingId') === input.listingId,
    );
    const tenant = listing === undefined ? undefined : readString(asRecord(listing), 'tenant');
    if (listing === undefined || tenant !== input.readingTenant) {
      return { kind: 'not-found', family: input.family, listingId: input.listingId };
    }
    const card = buildExpertListingCard(listing);
    const purchase = buildPurchaseActionView({
      family: 'expert-service',
      mode: input.mode,
      state: 'registered',
      offers: card.offers,
      rights: asRecord(listing)['rights'],
    });
    return deepFreezeView({
      kind: 'expert',
      mode: input.mode,
      demo: input.demo,
      card,
      purchase,
      certifications: input.certifications,
    });
  }
  if (input.family === 'artifacts') {
    const listing = input.corpus.artifactListings.find(
      (candidate) => readString(asRecord(candidate), 'offerId') === input.listingId,
    );
    if (listing === undefined || !listingVisibleToListingTenant(listing, input.readingTenant)) {
      return { kind: 'not-found', family: input.family, listingId: input.listingId };
    }
    const detail = buildArtifactListingDetail(scopeArtifactListing(listing, input.readingTenant));
    return deepFreezeView({
      kind: 'artifact',
      mode: input.mode,
      demo: input.demo,
      detail,
      certifications: input.certifications,
    });
  }
  return { kind: 'not-found', family: input.family, listingId: input.listingId };
}

/** Build the entitlements view model (the explicit state machine). */
export function buildMarketplaceEntitlementsView(
  input: MarketplaceViewInput,
): MarketplaceEntitlementsViewModel {
  const marketplaceGrants: EntitlementStateView[] = [];
  for (const listing of input.corpus.artifactListings) {
    if (!listingVisibleToListingTenant(listing, input.readingTenant)) continue;
    const grantsValue = asRecord(listing)['grants'];
    if (!Array.isArray(grantsValue)) continue;
    for (const grant of grantsValue) {
      if (!grantBelongsToTenant(grant, input.readingTenant)) continue;
      marketplaceGrants.push(
        entitlementStateFromMarketplaceGrant(grant, input.corpus.evaluatedAt),
      );
    }
  }
  const featureGrants = input.corpus.entitlementGrants.map((grant) =>
    entitlementStateFromGrantRecord(grant, input.corpus.evaluatedAt),
  );
  return deepFreezeView({
    viewVersion: MARKETPLACE_VIEW_VERSION,
    mode: input.mode,
    demo: input.demo,
    tenantId: input.readingTenant,
    marketplaceGrants,
    featureGrants,
    scopeNote: ENTITLEMENT_STATE_NOTE,
    generatedNote: input.corpus.generatedNote,
  } satisfies MarketplaceEntitlementsViewModel);
}
