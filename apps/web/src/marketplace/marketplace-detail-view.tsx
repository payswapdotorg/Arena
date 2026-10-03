/**
 * MarketplaceDetailView — the presentational listing detail screen
 * (Work Order B013; issue #88; apps/web/src/marketplace).
 *
 * SYNC presentational component: renders the detail view model with the
 * full provenance chain, licence terms, verification evidence addresses,
 * entitlement history, certification presence and the fail-closed purchase
 * action panel (what a purchase grants and DOES NOT grant — certification
 * first among them). Unknown ids render the honest not-found state.
 */

import { EmptyState, PageHeader } from '@arena/ui-platform';
import type {
  ArtifactListingDetail,
  ExpertListingCard,
  PurchaseActionView,
} from '../../../../packages/marketplace-ui/src/index.js';
import type { MarketplaceDetailOutcome } from './marketplace-view.js';
import { CertificationPresenceLine, MarketplaceTruthMark } from './marketplace-home-view.js';
import type { CertificationPresence } from '../../../../packages/marketplace-ui/src/index.js';

/** Render one maybe-unknown value (unknown stays unknown — never guessed). */
function Maybe(props: { readonly value: string | undefined }) {
  if (props.value === undefined) {
    return <span className="marketplace-unknown" data-unknown="true">Unknown</span>;
  }
  return <span>{props.value}</span>;
}

/** The purchase action panel: grants / does-not-grant / price / demo. */
function PurchasePanel(props: { readonly purchase: PurchaseActionView }) {
  const { purchase } = props;
  return (
    <section
      className="marketplace-purchase"
      aria-labelledby="marketplace-purchase-title"
      data-arena-purchase-availability={purchase.availability}
      data-arena-purchase-mode={purchase.mode}
    >
      <h2 id="marketplace-purchase-title">Purchase — what it grants and does not</h2>
      <p className="marketplace-purchase__status">
        <strong>{purchase.availabilityLabel}</strong>
        {purchase.price !== undefined ? <> · recorded price <code>{purchase.price.display}</code></> : null}
      </p>
      <ul className="marketplace-purchase__grants" data-arena-purchase-grants="true">
        {purchase.grants.map((entry) => (
          <li key={entry} data-arena-purchase-grant="true">{entry}</li>
        ))}
      </ul>
      <ul className="marketplace-purchase__does-not-grant" data-arena-purchase-does-not-grant="true">
        {purchase.doesNotGrant.map((entry) => (
          <li key={entry} data-arena-purchase-not-granted="true">{entry}</li>
        ))}
      </ul>
      {purchase.priceNote !== undefined ? (
        <p className="marketplace-purchase__price-note">{purchase.priceNote}</p>
      ) : null}
      {purchase.demoNote !== undefined ? (
        <p className="marketplace-purchase__demo-note" data-arena-demo-banner="true">{purchase.demoNote}</p>
      ) : null}
      <p className="marketplace-purchase__truth-note" data-arena-marketplace-truth="purchase-not-certification">
        {purchase.truthNote}
      </p>
    </section>
  );
}

/** The provenance chain section (the evidence class). */
function ProvenanceSection(props: {
  readonly provenance: ArtifactListingDetail['card']['provenance'];
}) {
  const { provenance } = props;
  return (
    <section
      className="marketplace-provenance"
      aria-labelledby="marketplace-provenance-title"
      data-arena-provenance-class={provenance.truthClass}
    >
      <h2 id="marketplace-provenance-title">Provenance chain</h2>
      <p className="marketplace-provenance__note">{provenance.scopeNote}</p>
      <dl className="marketplace-provenance__facts">
        <div><dt>Artifact</dt><dd><code><Maybe value={provenance.artifact?.key} /></code></dd></div>
        <div>
          <dt>Creator</dt>
          <dd>
            {provenance.creator !== undefined
              ? `${provenance.creator.type ?? 'unknown'} / ${provenance.creator.tenant} / ${provenance.creator.principalId}`
              : 'Unknown'}
          </dd>
        </div>
        <div><dt>Created</dt><dd><Maybe value={provenance.createdAt} /></dd></div>
        <div><dt>Recorded</dt><dd><Maybe value={provenance.recordedAt} /></dd></div>
        <div><dt>Lineage edges</dt><dd>{String(provenance.parents.length)}</dd></div>
      </dl>
      {provenance.parents.length > 0 ? (
        <ul className="marketplace-provenance__parents">
          {provenance.parents.map((edge) => (
            <li key={edge.parent.key} data-arena-lineage-relation={edge.relation ?? 'unknown'}>
              {edge.relation ?? 'unknown relation'} → <code>{edge.parent.key}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="marketplace-provenance__parents-empty">No lineage edges (root artifact).</p>
      )}
      {provenance.transformation !== undefined ? (
        <p className="marketplace-provenance__transformation" data-arena-transformation="true">
          Transformation: <code>{provenance.transformation.transform.key}</code> over{' '}
          {String(provenance.transformation.inputs.length)} input(s)
        </p>
      ) : (
        <p className="marketplace-provenance__transformation" data-arena-transformation="unknown">
          Transformation: Unknown
        </p>
      )}
      <div className="marketplace-provenance__addresses">
        <h3>Evidence addresses (append-only)</h3>
        <ul data-arena-evidence-addresses="true">
          {provenance.evidenceAddresses.map((address) => (
            <li key={address} data-arena-evidence-address={address}>
              <code>{address}</code>
            </li>
          ))}
        </ul>
      </div>
      {provenance.unknownFields.length > 0 ? (
        <p className="marketplace-provenance__unknown">
          Unknown fields: {provenance.unknownFields.join(', ')}
        </p>
      ) : null}
    </section>
  );
}

/** The entitlement history section (explicit states, never implied). */
function EntitlementSection(props: {
  readonly entitlement: ArtifactListingDetail['card']['entitlement'];
  readonly grants: ArtifactListingDetail['card']['grants'];
  readonly scopeNote: string;
}) {
  const { entitlement, grants, scopeNote } = props;
  return (
    <section
      className="marketplace-entitlement"
      aria-labelledby="marketplace-entitlement-title"
      data-arena-entitlement-state={entitlement.state}
    >
      <h2 id="marketplace-entitlement-title">Entitlement</h2>
      <p className="marketplace-entitlement__note">{scopeNote}</p>
      <p className="marketplace-entitlement__current">
        Current posture (latest recorded grant event): <strong>{entitlement.stateLabel}</strong>
        <MarketplaceTruthMark kind={entitlement.truthClass} label={entitlement.stateLabel} />
      </p>
      {grants.length === 0 ? (
        <p className="marketplace-entitlement__none" data-arena-entitlement-grants="none">
          No entitlement grant is recorded for this listing in this workspace — entitlement
          is never implied by ownership or purchase intent.
        </p>
      ) : (
        <ul className="marketplace-entitlement__grants" data-arena-entitlement-grants="true">
          {grants.map((grant) => (
            <li
              key={`${grant.grantId ?? 'unknown'}:${grant.state}:${grant.grantedAt ?? 'unknown'}`}
              data-arena-grant-state={grant.state}
            >
              <strong>{grant.stateLabel}</strong>
              {grant.grantId !== undefined ? <> · <code>{grant.grantId}</code></> : null}
              {grant.permittedUse !== undefined ? <> · use: {grant.permittedUse}</> : null}
              {grant.grantedAt !== undefined ? <> · granted {grant.grantedAt}</> : null}
              {grant.expiresAt !== undefined ? <> · expires {grant.expiresAt}</> : null}
              {grant.revokedAt !== undefined ? <> · revoked {grant.revokedAt}</> : null}
              {grant.grounds !== undefined ? <> · grounds: {grant.grounds}</> : null}
              {grant.lineage.length > 0 ? (
                <ol className="marketplace-entitlement__lineage">
                  {grant.lineage.map((event, index) => (
                    <li key={`${event.occurredAt ?? 'unknown'}:${String(index)}`} data-arena-lineage-event={event.kind}>
                      {event.kind} at <Maybe value={event.occurredAt} />
                      {event.note !== undefined ? <> — {event.note}</> : null}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The verification section (own truth class, evidence addresses). */
function VerificationSection(props: {
  readonly verification: ArtifactListingDetail['card']['verification'];
}) {
  const { verification } = props;
  return (
    <section
      className="marketplace-verification"
      aria-labelledby="marketplace-verification-title"
      data-arena-verification-status={verification.status}
    >
      <h2 id="marketplace-verification-title">Verification</h2>
      <p className="marketplace-verification__note">{verification.scopeNote}</p>
      <p className="marketplace-verification__status">
        Status: <strong>{verification.statusLabel}</strong>
        <MarketplaceTruthMark kind={verification.truthClass} label={verification.statusLabel} />
      </p>
      {verification.entries.length > 0 ? (
        <ul className="marketplace-verification__entries">
          {verification.entries.map((entry) => (
            <li
              key={`${entry.kind ?? 'unknown'}:${entry.address ?? 'unknown'}`}
              data-arena-verification-entry={entry.kind ?? 'unknown'}
              data-arena-verification-outcome={entry.outcome ?? 'none'}
            >
              {entry.kind ?? 'unknown kind'} · <code>{entry.address ?? 'address unknown'}</code> ·
              outcome {entry.outcome ?? 'not recorded'}
            </li>
          ))}
        </ul>
      ) : (
        <p className="marketplace-verification__none">No verification evidence entries.</p>
      )}
    </section>
  );
}

/** The rights/licence terms section (evidence class). */
function RightsSection(props: { readonly rights: ArtifactListingDetail['card']['rights'] }) {
  const { rights } = props;
  return (
    <section
      className="marketplace-rights"
      aria-labelledby="marketplace-rights-title"
      data-arena-rights-posture={rights.posture}
    >
      <h2 id="marketplace-rights-title">Licence &amp; rights</h2>
      <p className="marketplace-rights__note">{rights.scopeNote}</p>
      <dl className="marketplace-rights__terms">
        <div><dt>Posture</dt><dd>{rights.postureLabel}</dd></div>
        <div><dt>Licence</dt><dd><Maybe value={rights.license} /></dd></div>
        <div><dt>Commercial use</dt><dd><Maybe value={rights.commercialUse} /></dd></div>
        <div><dt>Redistribution</dt><dd><Maybe value={rights.redistribution} /></dd></div>
        <div><dt>Customer data</dt><dd><Maybe value={rights.customerData} /></dd></div>
      </dl>
      {rights.professionalLimitations.length > 0 ? (
        <ul className="marketplace-rights__limitations">
          {rights.professionalLimitations.map((limitation) => (
            <li key={limitation} data-arena-professional-limitation="true">{limitation}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** The workspace certifications context (a listing is never implied certified). */
function WorkspaceCertifications(props: {
  readonly certifications: readonly CertificationPresence[];
}) {
  const { certifications } = props;
  if (certifications.length === 0) {
    return (
      <p className="marketplace-detail__certifications" data-arena-workspace-certifications="0">
        No certification record exists in this workspace — every listing renders as not
        certified (an honest absence, never a blank).
      </p>
    );
  }
  return (
    <div className="marketplace-detail__certifications" data-arena-workspace-certifications={String(certifications.length)}>
      <p>
        {String(certifications.length)} certification record(s) exist in this workspace —
        each scoped to its own tested composition. None of them certifies this listing:
      </p>
      <ul>
        {certifications.map((presence) => (
          <li key={presence.certificationId ?? presence.recordId ?? 'unknown'}>
            <CertificationPresenceLine presence={presence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The expert-service listing detail body. */
function ExpertDetail(props: {
  readonly card: ExpertListingCard;
  readonly purchase: PurchaseActionView;
  readonly certifications: readonly CertificationPresence[];
}) {
  const { card, purchase, certifications } = props;
  return (
    <div className="marketplace-detail" data-arena-route="marketplace-detail" data-arena-detail-family="expert-service">
      <PageHeader
        title={card.headline ?? 'Unnamed expert service'}
        description={card.description ?? 'No description is recorded on the listing.'}
      />
      <dl className="marketplace-detail__identity">
        <div><dt>Listing</dt><dd><code><Maybe value={card.listingId} /></code></dd></div>
        <div><dt>Expert</dt><dd><Maybe value={card.expertId} /></dd></div>
        <div><dt>Tenant</dt><dd><Maybe value={card.tenant} /></dd></div>
        <div><dt>Published</dt><dd><Maybe value={card.publishedAt} /></dd></div>
        <div><dt>Capabilities</dt><dd>{card.capabilities.join(', ') || 'Unknown'}</dd></div>
        <div><dt>Domains</dt><dd>{card.domains.join(', ') || 'Unknown'}</dd></div>
        <div><dt>Jurisdictions</dt><dd>{card.jurisdictions.join(', ') || 'Unknown'}</dd></div>
      </dl>

      <section className="marketplace-detail__qualifications" aria-labelledby="expert-qualifications-title">
        <h2 id="expert-qualifications-title">Qualification evidence (the A007 gate)</h2>
        <ul data-arena-qualification-proofs="true">
          {card.qualificationProofs.map((proof) => (
            <li key={proof.recordRef ?? proof.claimRef ?? 'unknown'} data-arena-qualification-in-force={String(proof.inForce)}>
              {proof.status ?? 'status unknown'} · in force {String(proof.inForce)} ·
              valid until <Maybe value={proof.validUntil} />
            </li>
          ))}
        </ul>
        <p className="marketplace-detail__verification-note">
          {card.verification.statusLabel} — {card.verification.scopeNote}
        </p>
      </section>

      <RightsSection rights={card.rights} />

      <section className="marketplace-detail__certification">
        <h2>Certification</h2>
        <CertificationPresenceLine presence={card.certification} />
        <WorkspaceCertifications certifications={certifications} />
      </section>

      <EntitlementSection
        entitlement={card.entitlement}
        grants={[]}
        scopeNote={card.entitlement.scopeNote}
      />

      <PurchasePanel purchase={purchase} />
    </div>
  );
}

/** The artifact listing detail body. */
function ArtifactDetail(props: {
  readonly detail: ArtifactListingDetail;
  readonly certifications: readonly CertificationPresence[];
}) {
  const { detail, certifications } = props;
  const card = detail.card;
  return (
    <div className="marketplace-detail" data-arena-route="marketplace-detail" data-arena-detail-family="artifact">
      <PageHeader
        title={card.title ?? 'Unnamed artifact'}
        description={card.summary ?? 'No summary is recorded on the offer.'}
      />
      <dl className="marketplace-detail__identity">
        <div><dt>Offer</dt><dd><code><Maybe value={card.offerId} /></code></dd></div>
        <div><dt>Kind</dt><dd><Maybe value={card.artifactKind} /></dd></div>
        <div><dt>Visibility</dt><dd><Maybe value={card.visibility} /></dd></div>
        <div><dt>State</dt><dd><Maybe value={card.state} /></dd></div>
        <div><dt>Artifact</dt><dd><code><Maybe value={card.artifactIdentity} /></code></dd></div>
      </dl>

      <ProvenanceSection provenance={card.provenance} />
      <RightsSection rights={card.rights} />
      <VerificationSection verification={card.verification} />

      <section className="marketplace-detail__certification">
        <h2>Certification</h2>
        <CertificationPresenceLine presence={card.certification} />
        <WorkspaceCertifications certifications={certifications} />
      </section>

      <EntitlementSection
        entitlement={card.entitlement}
        grants={card.grants}
        scopeNote={card.entitlement.scopeNote}
      />

      <section className="marketplace-detail__reviews" aria-labelledby="marketplace-reviews-title">
        <h2 id="marketplace-reviews-title">Reviews (expert judgments)</h2>
        {card.reviews.length === 0 ? (
          <p className="marketplace-detail__reviews-none">No review is recorded for this listing.</p>
        ) : (
          <ul data-arena-reviews="true">
            {card.reviews.map((review, index) => (
              <li key={`${review.reviewerTenant ?? 'unknown'}:${String(index)}`} data-arena-review-rating={review.rating ?? 'unknown'}>
                <MarketplaceTruthMark kind="expert-judgment" label="Expert judgment" />
                {review.rating !== undefined ? ` ${String(review.rating)}/5` : ' rating unknown'}
                {review.verdict !== undefined ? ` · ${review.verdict}` : ''}
                {review.body !== undefined ? <> — “{review.body}”</> : null}
                {review.reviewerTenant !== undefined ? <> (tenant {review.reviewerTenant})</> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <PurchasePanel purchase={detail.purchase} />
    </div>
  );
}

/** The listing detail screen (honest not-found included). */
export function MarketplaceDetailView({ outcome }: { readonly outcome: MarketplaceDetailOutcome }) {
  if (outcome.kind === 'not-found') {
    return (
      <div className="marketplace-detail" data-arena-route="marketplace-detail" data-arena-detail-family={outcome.family}>
        <PageHeader title="Listing not found" description="The requested marketplace listing does not exist in this posture." />
        <EmptyState
          title="Listing not found"
          hint={`No ${outcome.family} listing “${outcome.listingId}” is visible here. Unknown stays unknown — nothing is fabricated.`}
        />
      </div>
    );
  }
  if (outcome.kind === 'expert') {
    return (
      <ExpertDetail
        card={outcome.card}
        purchase={outcome.purchase}
        certifications={outcome.certifications}
      />
    );
  }
  return <ArtifactDetail detail={outcome.detail} certifications={outcome.certifications} />;
}
