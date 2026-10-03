/**
 * MarketplaceHomeView — the presentational `/marketplace` + `/demo/marketplace`
 * browse screen (Work Order B013; issue #88; apps/web/src/marketplace).
 *
 * SYNC presentational component (renderable through react-dom/server in the
 * house test style): the async composition (session probe, canonical
 * certification reads, tenant scoping) happens in the composition helpers,
 * and this component renders the resulting view model deterministically.
 *
 * THE governing truths rendered here:
 *   - a marketplace purchase is NOT a certification (always visible);
 *   - every truth section carries its truth class (evidence / verified
 *     fact / certification / pending / unknown — never collapsed);
 *   - entitlement state is explicit (granted / revoked / expired /
 *     pending), never implied by ownership;
 *   - listings without certification render "Not certified", never a blank;
 *   - demo mode renders under the B006 labelling contract.
 */

import {
  DemoDataBadge,
  EmptyState,
  PageHeader,
  TruthBadge,
} from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import type { StateKind } from '@arena/ui-platform';
import { isBadgeTreatment, truthTreatment } from '../cockpit/state-mark.js';
import type { MarketplaceTruthClass } from '../../../../packages/marketplace-ui/src/index.js';
import type {
  ArtifactListingCard,
  CertificationPresence,
  ExpertListingCard,
} from '../../../../packages/marketplace-ui/src/index.js';
import type { MarketplaceHomeViewModel } from './marketplace-view.js';

/** The href base for listing links (session vs demo routes). */
function listingHrefBase(mode: 'session' | 'demo'): string {
  return mode === 'demo' ? '/demo/marketplace' : '/marketplace';
}

/** Render one truth mark (badge kinds + the marketplace's pending/unknown marks). */
export function MarketplaceTruthMark(props: {
  readonly kind: MarketplaceTruthClass;
  readonly label: string;
  readonly meaning?: string;
}) {
  const treatment = truthTreatment(props.kind);
  if (isBadgeTreatment(treatment)) {
    return <TruthBadge kind={treatment as StateKind} />;
  }
  return (
    <span
      className="marketplace-truth marketplace-truth--pending-unknown"
      data-arena-truth={treatment}
      title={props.meaning ?? props.label}
    >
      <span className="marketplace-truth__marker" aria-hidden="true" />
      <span className="marketplace-truth__label">{props.label}</span>
    </span>
  );
}

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
function Maybe(props: { readonly value: string | undefined }) {
  if (props.value === undefined) {
    return <span className="marketplace-unknown" data-unknown="true">Unknown</span>;
  }
  return <span>{props.value}</span>;
}

/** Render the certification presence line (never a blank). */
export function CertificationPresenceLine(props: { readonly presence: CertificationPresence }) {
  const { presence } = props;
  return (
    <p
      className="marketplace-listing__certification"
      data-arena-certification={presence.status}
      data-arena-certification-label={presence.statusLabel}
    >
      <strong>{presence.statusLabel}</strong>
      {' — '}
      {presence.subject !== undefined ? (
        <>
          scope <code>{presence.subject.bodyVersion ?? 'unknown'}</code>
          {' · '}
        </>
      ) : null}
      {presence.scopeNote}
    </p>
  );
}

/** One expert-service listing card. */
function ExpertListing(props: { readonly card: ExpertListingCard; readonly mode: 'session' | 'demo' }) {
  const { card, mode } = props;
  const price = card.offers[0];
  return (
    <article
      className="marketplace-card"
      data-arena-expert-listing={card.listingId ?? 'unknown'}
      data-arena-listing-family="expert-service"
    >
      <header className="marketplace-card__head">
        <h3>
          <a href={`${listingHrefBase(mode)}/experts/${encodeURIComponent(card.listingId ?? 'unknown')}`}>
            {card.headline ?? 'Unnamed expert service'}
          </a>
        </h3>
        <MarketplaceTruthMark kind={card.verification.truthClass} label={card.verification.statusLabel} />
        {mode === 'demo' ? <DemoDataBadge /> : null}
      </header>
      <p className="marketplace-card__summary">{card.description}</p>
      <dl className="marketplace-card__facts">
        <div><dt>Expert</dt><dd><Maybe value={card.expertId} /></dd></div>
        <div><dt>Tenant</dt><dd><Maybe value={card.tenant} /></dd></div>
        <div><dt>Qualifications in force</dt><dd>{String(card.qualificationProofs.length)}</dd></div>
        <div>
          <dt>Engagement rate</dt>
          <dd data-arena-price={price !== undefined && price.currency !== undefined && price.amountMinor !== undefined ? `${price.currency} ${(price.amountMinor / 100).toFixed(2)}` : 'unknown'}>
            {price !== undefined && price.currency !== undefined && price.amountMinor !== undefined
              ? `${price.currency} ${(price.amountMinor / 100).toFixed(2)} ${price.unit ?? ''}`.trim()
              : 'Unknown'}
          </dd>
        </div>
        <div><dt>Rating</dt><dd>{card.averageRating !== undefined ? `${card.averageRating.toFixed(1)}/5 over ${String(card.reviews ?? 0)} review(s)` : 'Unknown'}</dd></div>
        <div>
          <dt>Entitlement</dt>
          <dd data-arena-entitlement-state={card.entitlement.state}>{card.entitlement.stateLabel}</dd>
        </div>
      </dl>
      <CertificationPresenceLine presence={card.certification} />
      <p className="marketplace-card__truth-note">{card.certification.scopeNote}</p>
    </article>
  );
}

/** One artifact listing card. */
function ArtifactListing(props: { readonly card: ArtifactListingCard; readonly mode: 'session' | 'demo' }) {
  const { card, mode } = props;
  return (
    <article
      className="marketplace-card"
      data-arena-artifact-listing={card.offerId ?? 'unknown'}
      data-arena-listing-family="artifact"
    >
      <header className="marketplace-card__head">
        <h3>
          <a href={`${listingHrefBase(mode)}/artifacts/${encodeURIComponent(card.offerId ?? 'unknown')}`}>
            {card.title ?? 'Unnamed artifact'}
          </a>
        </h3>
        <MarketplaceTruthMark kind={card.verification.truthClass} label={card.verification.statusLabel} />
        {mode === 'demo' ? <DemoDataBadge /> : null}
      </header>
      <p className="marketplace-card__summary">{card.summary}</p>
      <dl className="marketplace-card__facts">
        <div><dt>Kind</dt><dd><Maybe value={card.artifactKind} /></dd></div>
        <div><dt>Visibility</dt><dd><Maybe value={card.visibility} /></dd></div>
        <div>
          <dt>Provenance</dt>
          <dd data-arena-provenance-class={card.provenance.truthClass}>
            <MarketplaceTruthMark kind={card.provenance.truthClass} label="Evidence chain" />
            {' '}
            {String(card.provenance.evidenceAddresses.length)} evidence address(es)
          </dd>
        </div>
        <div><dt>Rights</dt><dd data-arena-rights-posture={card.rights.posture}>{card.rights.postureLabel}{card.rights.license !== undefined ? ` — ${card.rights.license}` : ''}</dd></div>
        <div>
          <dt>Verification</dt>
          <dd data-arena-verification-status={card.verification.status}>{card.verification.statusLabel}</dd>
        </div>
        <div>
          <dt>Entitlement</dt>
          <dd data-arena-entitlement-state={card.entitlement.state}>{card.entitlement.stateLabel}</dd>
        </div>
        <div><dt>Reviews</dt><dd>{card.averageRating !== undefined ? `${card.averageRating.toFixed(1)}/5 over ${String(card.reviewCount ?? 0)} review(s)` : 'None'}</dd></div>
      </dl>
      <CertificationPresenceLine presence={card.certification} />
    </article>
  );
}

/** The marketplace home (browse) screen. */
export function MarketplaceHomeView({ view }: { readonly view: MarketplaceHomeViewModel }) {
  return (
    <div
      className="marketplace"
      data-arena-route="marketplace"
      data-arena-marketplace-mode={view.mode}
    >
      <PageHeader
        title="Marketplace"
        description="Discover expert services and artifacts — with provenance, rights, verification and entitlements in the open."
      />

      {view.demo.isDemo ? (
        <section
          className="marketplace-demo-banner"
          aria-label="Demo mode notice"
          data-arena-demo-banner="true"
        >
          <DemoDataBadge note="deterministic seed" />
          <p>
            <strong>{DEMO_LABELLING.bannerTitle}.</strong> {DEMO_LABELLING.bannerText}
          </p>
        </section>
      ) : null}

      <section
        className="marketplace-distinction"
        aria-label="Purchase is not certification"
        data-arena-marketplace-truth="purchase-not-certification"
      >
        <p>{view.scopeNote}</p>
      </section>

      <section className="marketplace-experts" aria-labelledby="marketplace-experts-title">
        <h2 id="marketplace-experts-title">Expert services</h2>
        {view.expertListings.length === 0 ? (
          <EmptyState
            title="No expert services visible"
            hint="No expert-service listing is visible to this tenant. Nothing is fabricated to fill the space."
          />
        ) : (
          <ul className="marketplace-experts__cards" data-arena-expert-listings="true">
            {view.expertListings.map((card) => (
              <li key={card.listingId ?? card.listingRef ?? 'unknown'} className="marketplace-experts__item">
                <ExpertListing card={card} mode={view.mode} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="marketplace-artifacts" aria-labelledby="marketplace-artifacts-title">
        <h2 id="marketplace-artifacts-title">Artifacts</h2>
        {view.artifactListings.length === 0 ? (
          <EmptyState
            title="No artifacts visible"
            hint="No artifact listing is visible to this tenant. Nothing is fabricated to fill the space."
          />
        ) : (
          <ul className="marketplace-artifacts__cards" data-arena-artifact-listings="true">
            {view.artifactListings.map((card) => (
              <li key={card.offerId ?? card.offerDigest ?? 'unknown'} className="marketplace-artifacts__item">
                <ArtifactListing card={card} mode={view.mode} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="marketplace-certifications"
        aria-labelledby="marketplace-certifications-title"
        data-arena-marketplace-certifications={String(view.certifications.length)}
      >
        <h2 id="marketplace-certifications-title">Certification records in this workspace</h2>
        <p className="marketplace-certifications__note">
          Certification is composition-scoped: a record certifies the tested composition
          (Body Version × Substrate × Environment × Runtime × Suite) — never a marketplace
          listing, and never a purchase.
        </p>
        {view.certifications.length === 0 ? (
          <EmptyState
            title="No certification record in this workspace"
            hint="Every listing therefore renders as not certified — an honest absence, never a blank."
          />
        ) : (
          <ul className="marketplace-certifications__list">
            {view.certifications.map((presence) => (
              <li
                key={presence.certificationId ?? presence.recordId ?? 'unknown'}
                data-arena-workspace-certification={presence.status}
              >
                <CertificationPresenceLine presence={presence} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="marketplace-facts" aria-label="Marketplace facts" data-arena-marketplace-inspector="true">
        <h2>Marketplace facts</h2>
        <dl className="marketplace-facts__list">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          {view.workspaceId !== undefined ? <div><dt>Workspace</dt><dd><code>{view.workspaceId}</code></dd></div> : null}
          {view.principalLabel !== undefined ? <div><dt>Principal</dt><dd>{view.principalLabel}</dd></div> : null}
          <div><dt>Mode</dt><dd><code>{view.mode}</code></dd></div>
          <div><dt>Expert listings</dt><dd>{String(view.expertListings.length)}</dd></div>
          <div><dt>Artifact listings</dt><dd>{String(view.artifactListings.length)}</dd></div>
          <div><dt>Workspace certifications</dt><dd>{String(view.certifications.length)}</dd></div>
        </dl>
        {view.demo.isDemo && view.demo.corpusHash !== undefined ? (
          <p className="marketplace-facts__hash" data-arena-corpus-hash="true">
            Demo marketplace corpus hash: <code>{view.demo.corpusHash.slice(0, 72)}…</code>
          </p>
        ) : null}
        <p className="marketplace-facts__note">{view.generatedNote}</p>
      </aside>
    </div>
  );
}
