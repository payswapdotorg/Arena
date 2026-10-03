/**
 * MarketplaceEntitlementsView — the presentational entitlement screen
 * (Work Order B013; issue #88; apps/web/src/marketplace).
 *
 * SYNC presentational component: renders the explicit entitlement state
 * machine (granted / revoked / expired / pending — never implied by
 * ownership) over the A032 marketplace grant ledger and the A033 feature
 * entitlement grants, with lineage, grounds and expiry visible.
 */

import { DemoDataBadge, EmptyState, PageHeader } from '@arena/ui-platform';
import { DEMO_LABELLING } from '@arena/demo';
import type { EntitlementStateView } from '../../../../packages/marketplace-ui/src/index.js';
import type { MarketplaceEntitlementsViewModel } from './marketplace-view.js';
import { MarketplaceTruthMark } from './marketplace-home-view.js';

/** One entitlement grant row (explicit state, lineage visible). */
function GrantRow(props: { readonly grant: EntitlementStateView }) {
  const { grant } = props;
  return (
    <li
      className="marketplace-grant"
      data-arena-grant-state={grant.state}
      data-arena-grant-id={grant.grantId ?? 'unknown'}
    >
      <div className="marketplace-grant__head">
        <strong data-arena-entitlement-state={grant.state}>{grant.stateLabel}</strong>
        <MarketplaceTruthMark kind={grant.truthClass} label={grant.stateLabel} />
        {grant.grantId !== undefined ? <code>{grant.grantId}</code> : null}
      </div>
      <dl className="marketplace-grant__facts">
        {grant.offerId !== undefined ? <div><dt>Offer</dt><dd><code>{grant.offerId}</code></dd></div> : null}
        {grant.featureKey !== undefined ? <div><dt>Feature</dt><dd><code>{grant.featureKey}</code></dd></div> : null}
        {grant.granteeTenant !== undefined ? <div><dt>Grantee tenant</dt><dd>{grant.granteeTenant}</dd></div> : null}
        {grant.permittedUse !== undefined ? <div><dt>Permitted use</dt><dd>{grant.permittedUse}</dd></div> : null}
        {grant.grantedAt !== undefined ? <div><dt>Granted</dt><dd>{grant.grantedAt}</dd></div> : null}
        {grant.validFrom !== undefined ? <div><dt>Valid from</dt><dd>{grant.validFrom}</dd></div> : null}
        {grant.expiresAt !== undefined ? <div><dt>Expires</dt><dd>{grant.expiresAt}</dd></div> : null}
        {grant.revokedAt !== undefined ? <div><dt>Revoked</dt><dd>{grant.revokedAt}</dd></div> : null}
        {grant.grounds !== undefined ? <div><dt>Grounds</dt><dd>{grant.grounds}</dd></div> : null}
      </dl>
      {grant.lineage.length > 0 ? (
        <ol className="marketplace-grant__lineage" data-arena-entitlement-lineage="true">
          {grant.lineage.map((event, index) => (
            <li key={`${event.occurredAt ?? 'unknown'}:${String(index)}`} data-arena-lineage-event={event.kind}>
              {event.kind} at {event.occurredAt ?? 'unknown time'}
              {event.note !== undefined ? <> — {event.note}</> : null}
            </li>
          ))}
        </ol>
      ) : null}
      {grant.unknownFields.length > 0 ? (
        <p className="marketplace-grant__unknown">Unknown fields: {grant.unknownFields.join(', ')}</p>
      ) : null}
    </li>
  );
}

/** The entitlements screen. */
export function MarketplaceEntitlementsView({
  view,
}: {
  readonly view: MarketplaceEntitlementsViewModel;
}) {
  return (
    <div
      className="marketplace-entitlements"
      data-arena-route="marketplace-entitlements"
      data-arena-marketplace-mode={view.mode}
    >
      <PageHeader
        title="Entitlements"
        description="Every marketplace entitlement state renders explicitly — granted, revoked, expired or pending — never implied by ownership."
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
        className="marketplace-entitlements__note"
        aria-label="Entitlement truth"
        data-arena-marketplace-truth="entitlement-state"
      >
        <p>{view.scopeNote}</p>
      </section>

      <section className="marketplace-entitlements__grants" aria-labelledby="marketplace-grants-title">
        <h2 id="marketplace-grants-title">Marketplace access grants</h2>
        {view.marketplaceGrants.length === 0 ? (
          <EmptyState
            title="No marketplace grant recorded"
            hint="No artifact access grant is recorded for this tenant — entitlement is never implied by listing ownership."
          />
        ) : (
          <ul data-arena-marketplace-grants="true">
            {view.marketplaceGrants.map((grant) => (
              <GrantRow key={`${grant.grantId ?? 'unknown'}:${grant.state}:${grant.grantedAt ?? 'unknown'}`} grant={grant} />
            ))}
          </ul>
        )}
      </section>

      <section className="marketplace-entitlements__features" aria-labelledby="marketplace-features-title">
        <h2 id="marketplace-features-title">Feature entitlements</h2>
        {view.featureGrants.length === 0 ? (
          <EmptyState
            title="No feature entitlement recorded"
            hint="No feature entitlement grant is recorded for this tenant."
          />
        ) : (
          <ul data-arena-feature-grants="true">
            {view.featureGrants.map((grant) => (
              <GrantRow key={`${grant.grantId ?? 'unknown'}:${grant.state}`} grant={grant} />
            ))}
          </ul>
        )}
      </section>

      <aside className="marketplace-facts" aria-label="Entitlement facts">
        <dl className="marketplace-facts__list">
          <div><dt>Tenant</dt><dd><code>{view.tenantId}</code></dd></div>
          <div><dt>Mode</dt><dd><code>{view.mode}</code></dd></div>
          <div><dt>Marketplace grants</dt><dd>{String(view.marketplaceGrants.length)}</dd></div>
          <div><dt>Feature grants</dt><dd>{String(view.featureGrants.length)}</dd></div>
        </dl>
        <p className="marketplace-facts__note">{view.generatedNote}</p>
      </aside>
    </div>
  );
}
