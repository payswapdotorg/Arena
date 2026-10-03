import { describe, expect, it } from 'vitest';

import {
  artifactListingInput,
  buildArtifactListingCard,
  buildArtifactListingDetail,
  buildCertificationPresence,
  buildExpertListingCard,
  buildProvenanceSummary,
  buildRightsPosture,
  buildVerificationStatus,
  certifiedArtifactListingInput,
  compositionCertificationRecordInput,
  expertListingInput,
  malformedArtifactListingInput,
  malformedExpertListingInput,
  MARKETPLACE_FIXTURE_DIGESTS,
  PURCHASE_NOT_CERTIFICATION_NOTE,
} from './index.js';

describe('marketplace-ui listing view models (B013 truth)', () => {
  it('builds the artifact listing card with every truth section (positive)', () => {
    const card = buildArtifactListingCard(artifactListingInput());
    expect(card.family).toBe('artifact');
    expect(card.offerId).toBe('solder-defect-dataset');
    expect(card.title).toBe('Solder joint defect dataset');
    expect(card.provenance.truthClass).toBe('evidence');
    expect(card.provenance.artifact?.key).toBe(
      `tenant-a/solder-joint-defects@1.0.0#${MARKETPLACE_FIXTURE_DIGESTS.artifact}`,
    );
    expect(card.rights.posture).toBe('open');
    expect(card.rights.postureLabel).toBe('Open licence');
    expect(card.rights.license).toBe('CC-BY-4.0');
    expect(card.verification.status).toBe('verified');
    expect(card.verification.truthClass).toBe('verified-fact');
    expect(card.certification.status).toBe('not-certified');
    expect(card.entitlement.state).toBe('granted');
    expect(card.entitlement.truthClass).toBe('verified-fact');
    expect(card.grants).toHaveLength(1);
    expect(card.reviews[0]?.rating).toBe(5);
    expect(card.averageRating).toBe(5);
    expect(card.unknownFields).toHaveLength(0);
  });

  it('carries the evidence addresses of the full provenance chain (positive)', () => {
    const card = buildArtifactListingCard(artifactListingInput());
    expect(card.provenance.parents[0]?.relation).toBe('derived-from');
    expect(card.provenance.parents[0]?.parent.digest).toBe(MARKETPLACE_FIXTURE_DIGESTS.parent);
    expect(card.provenance.transformation?.transform.digest).toBe(
      MARKETPLACE_FIXTURE_DIGESTS.transform,
    );
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.artifact);
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.parent);
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.transform);
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.verification);
    expect(card.provenance.creator?.principalId).toBe('expert-001');
  });

  it('renders not certified — never a blank — when no certification record backs the listing (negative)', () => {
    const card = buildArtifactListingCard(artifactListingInput());
    expect(card.certification.status).toBe('not-certified');
    expect(card.certification.statusLabel).toBe('Not certified');
    expect(card.certification.subject).toBeUndefined();
    expect(card.certification.scopeNote).toContain('purchase');
    const rendered = JSON.stringify(card.certification);
    expect(rendered).toContain('Not certified');
  });

  it('renders a certification badge only from a record, with its composition scope (positive)', () => {
    const card = buildArtifactListingCard(certifiedArtifactListingInput());
    expect(card.certification.status).toBe('certified');
    expect(card.certification.truthClass).toBe('certification');
    expect(card.certification.certificationId).toBe('cert-software-engineer-1-1-0');
    expect(card.certification.subject?.bodyVersion).toBe('body-software-engineer@1.1.0');
    expect(card.certification.verdict).toBe('certified');
    // The un-carried composition fields stay unknown — listed, never narrowed.
    expect(card.certification.unknownFields).toContain('suiteRef');
  });

  it('reads the composition-scoped certification record shape (subject refs + suite) (positive)', () => {
    const presence = buildCertificationPresence(compositionCertificationRecordInput());
    expect(presence.status).toBe('certified');
    expect(presence.subject?.bodyVersion).toBe('structural-engineer-body@1.4.0');
    expect(presence.subject?.substrate).toBe('substrate-llm-a');
    expect(presence.subject?.environment).toBe('env-prod-eu');
    expect(presence.subject?.runtime).toBe('runtime-arena-1');
    expect(presence.subject?.suite).toBe(MARKETPLACE_FIXTURE_DIGESTS.suite);
  });

  it('degrades malformed artifact listings truthfully (negative)', () => {
    const card = buildArtifactListingCard(malformedArtifactListingInput());
    expect(card.offerId).toBeUndefined();
    expect(card.title).toBeUndefined();
    expect(card.unknownFields.length).toBeGreaterThan(0);
    expect(card.verification.status).toBe('malformed');
    expect(card.rights.posture).toBe('unknown');
    expect(card.entitlement.state).toBe('unknown');
    expect(card.grants).toHaveLength(0);
  });

  it('builds the expert listing card with the qualification evidence chain (positive)', () => {
    const card = buildExpertListingCard(expertListingInput());
    expect(card.family).toBe('expert-service');
    expect(card.listingId).toBe('listing-ada-review');
    expect(card.provenance.artifact?.key).toBe(
      `tenant-a/rust-code-review@2.1.0#${MARKETPLACE_FIXTURE_DIGESTS.claim}`,
    );
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.work1);
    expect(card.provenance.evidenceAddresses).toContain(MARKETPLACE_FIXTURE_DIGESTS.work2);
    expect(card.verification.status).toBe('verified');
    expect(card.offers[0]?.amountMinor).toBe(12500);
    expect(card.averageRating).toBe(5);
    // Expert rights posture: engagement terms + professional limitations.
    expect(card.rights.posture).toBe('restricted');
    expect(card.rights.professionalLimitations).toEqual(['Advisory code review only.']);
  });

  it('renders expert services as not certified — a qualification is not a certification (negative)', () => {
    const card = buildExpertListingCard(expertListingInput());
    expect(card.certification.status).toBe('not-certified');
    expect(card.certification.scopeNote).toContain('qualification is not a certification');
    expect(card.entitlement.state).toBe('unknown');
    expect(card.entitlement.scopeNote).toContain('engagement records');
  });

  it('degrades malformed expert listings truthfully (negative)', () => {
    const card = buildExpertListingCard(malformedExpertListingInput());
    expect(card.listingId).toBeUndefined();
    expect(card.qualificationProofs).toHaveLength(0);
    expect(card.offers).toHaveLength(0);
    expect(card.provenance.unknownFields).toContain('capability ref');
    expect(card.verification.status).toBe('none');
  });

  it('is deterministic: building twice yields deep-equal view models (positive)', () => {
    expect(buildArtifactListingCard(artifactListingInput())).toEqual(
      buildArtifactListingCard(artifactListingInput()),
    );
    expect(buildExpertListingCard(expertListingInput())).toEqual(
      buildExpertListingCard(expertListingInput()),
    );
    expect(buildProvenanceSummary(malformedArtifactListingInput())).toEqual(
      buildProvenanceSummary(malformedArtifactListingInput()),
    );
  });

  it('deep-freezes every view model (positive)', () => {
    const card = buildArtifactListingCard(certifiedArtifactListingInput());
    expect(Object.isFrozen(card)).toBe(true);
    expect(Object.isFrozen(card.provenance)).toBe(true);
    expect(Object.isFrozen(card.rights)).toBe(true);
    expect(Object.isFrozen(card.grants)).toBe(true);
    expect(Object.isFrozen(card.grants[0])).toBe(true);
    expect(Object.isFrozen(card.certification)).toBe(true);
    const expert = buildExpertListingCard(expertListingInput());
    expect(Object.isFrozen(expert)).toBe(true);
    expect(Object.isFrozen(expert.provenance.evidenceAddresses)).toBe(true);
  });

  it('builds the detail with the fail-closed purchase action (positive)', () => {
    const detail = buildArtifactListingDetail(artifactListingInput());
    expect(detail.purchase.availability).toBe('offered');
    expect(detail.purchase.doesNotGrant[0]).toContain('Certification');
    expect(detail.purchase.price).toBeUndefined();
    expect(detail.purchase.priceNote).toContain('never fabricated');
    expect(detail.purchase.truthNote).toBe(PURCHASE_NOT_CERTIFICATION_NOTE);
  });

  it('keeps unknown sections unknown — never guessed rights or verification (negative)', () => {
    expect(buildRightsPosture(undefined).posture).toBe('unknown');
    expect(buildRightsPosture(undefined).postureLabel).toBe('Rights unknown');
    expect(buildVerificationStatus(undefined).status).toBe('none');
    expect(
      buildVerificationStatus([{ kind: 'verification', digest: 'x', outcome: 'unknown' }]).status,
    ).toBe('unknown-outcome');
    expect(buildVerificationStatus([{ kind: 'verification', digest: 'x', outcome: 'fail' }]).status).toBe(
      'failed',
    );
  });
});
