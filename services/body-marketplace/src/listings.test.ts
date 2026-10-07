/**
 * Listing lifecycle tests (Work Order C014): typed transition guards,
 * record-backed certification posture surfacing, versioned publication,
 * append-only history, and the offer/grant seam. Integration with the
 * pretraining pipeline happens over the DEFAULT reference composition
 * (REAL A021/A023/A024 package ports).
 */

import { describe, expect, it } from 'vitest';

import { createBodyMarketplaceFabric } from './fabric.js';
import type { CapabilityBodyListing } from './fabric.js';
import { BodyMarketplaceError } from './errors.js';
import {
  makeAcceptedEvidence,
  makeCandidate,
  makeComposition,
  makeEvidencePort,
  makeCandidatePort,
  makePretrainingRequest,
  EVIDENCE_DIGEST,
  CANDIDATE_ID,
  TENANT,
  T0,
  T1,
  T2,
} from './test-support.js';

async function seedProposedRun() {
  const fabric = createBodyMarketplaceFabric({
    evidence: makeEvidencePort([makeAcceptedEvidence()]),
    candidates: makeCandidatePort([makeCandidate()]),
  });
  const run = await fabric.requestPretraining({
    request: makePretrainingRequest(),
    composition: makeComposition(),
    baseBodyVersionRef: null,
    releaseChannel: 'candidate',
    runId: 'run-0001',
    idempotencyKey: 'idem-run-0001',
    correlationId: 'corr-run-0001',
  });
  return { fabric, run };
}

async function seedListing(): Promise<{
  fabric: ReturnType<typeof createBodyMarketplaceFabric>;
  listing: CapabilityBodyListing;
}> {
  const { fabric, run } = await seedProposedRun();
  const listing = await fabric.createListing({
    listingId: 'listing-0001',
    tenantId: TENANT,
    releaseDigest: run.releaseDigest as string,
    title: 'Ledger Reconciler (pretrained)',
    summary: 'Cross-currency reconciliation capability body, pretrained on validated interventions',
    capabilityEvidenceRefs: [EVIDENCE_DIGEST, CANDIDATE_ID],
    pretrainingRunId: run.runId,
    rights: {
      license: 'Proprietary',
      commercialUse: 'requires-license',
      redistribution: 'tenant-only',
      customerData: 'derived',
      professionalLimitations: ['not a licensed accounting system'],
    },
    substrateCompatibility: {
      requiredModalities: ['text-input', 'text-output'],
      requiredToolCalling: 'json-schema',
      contextRequirements: { minContextUnits: 32768 },
    },
    pricing: { amountMinorUnits: 2500000, currency: 'usd', model: 'per-possession' },
    createdBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
    createdAt: T1,
    idempotencyKey: 'idem-listing-0001',
    correlationId: 'corr-listing-0001',
  });
  return { fabric, listing };
}

describe('capability-body listing lifecycle', () => {
  it('creates a DRAFT listing over a registered A024 release', async () => {
    const { listing } = await seedListing();
    expect(listing.state).toBe('draft');
    expect(listing.version).toBe(1);
    expect(listing.history).toEqual([]);
    expect(listing.certificationRefs.length).toBeGreaterThan(0);
    expect(listing.forgeRecordDigest).not.toBeNull();
    expect(listing.pretrainingRunId).toBe('run-0001');
    expect(listing.channel).toBe('candidate');
  });

  it('REJECTS publication while the release is unpublished (lock rule 12)', async () => {
    const { fabric, listing } = await seedListing();
    const check = await fabric.checkListingPublication(listing);
    expect(check.allowed).toBe(false);
    expect(check.rejections.map((rejection) => rejection.reason)).toContain(
      'release-not-published',
    );
    expect(
      check.rejections.map((rejection) => rejection.reason),
    ).not.toContain('certification-not-record-backed');
  });

  it('publishes through the typed guard when the release is explicitly published', async () => {
    const { fabric, listing } = await seedListing();
    const published = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'published',
      reason: 'marketplace launch 2026-10-07',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      releasePublication: {
        publisher: { type: 'service', tenant: TENANT, principalId: 'arena-body-marketplace' },
        rights: listing.rights,
        publishedAt: T2,
      },
      idempotencyKey: 'idem-publish-0001',
      correlationId: 'corr-publish-0001',
    });
    expect(published.state).toBe('published');
    expect(published.version).toBe(2);
    expect(published.history.length).toBe(1);
    expect(published.history[0]?.to).toBe('published');
    // The pure guard answers for a SUSPENDED listing too (re-publication
    // path): record-backed + published release ⇒ allowed.
    const suspended = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'suspended',
      reason: 'advisory review',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      idempotencyKey: 'idem-suspend-guard-0001',
      correlationId: 'corr-suspend-guard-0001',
    });
    const check = await fabric.checkListingPublication(suspended);
    expect(check.allowed).toBe(true);
    const republished = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'published',
      reason: 'advisory cleared',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      idempotencyKey: 'idem-republish-0001',
      correlationId: 'corr-republish-0001',
    });
    expect(republished.state).toBe('published');
  });

  it('suspends and retires with reasons; history stays append-only', async () => {
    const { fabric, listing } = await seedListing();
    await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'published',
      reason: 'launch',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      releasePublication: {
        publisher: { type: 'service', tenant: TENANT, principalId: 'arena-body-marketplace' },
        rights: listing.rights,
        publishedAt: T2,
      },
      idempotencyKey: 'idem-publish-0002',
      correlationId: 'corr-publish-0002',
    });
    const suspended = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'suspended',
      reason: 'certification advisory under review',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      idempotencyKey: 'idem-suspend-0001',
      correlationId: 'corr-suspend-0001',
    });
    expect(suspended.state).toBe('suspended');
    expect(suspended.version).toBe(3);
    const retired = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'retired',
      reason: 'superseded by reconciler 2.0',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      idempotencyKey: 'idem-retire-0001',
      correlationId: 'corr-retire-0001',
    });
    expect(retired.state).toBe('retired');
    expect(retired.version).toBe(4);
    expect(retired.history.map((entry) => entry.to)).toEqual([
      'published',
      'suspended',
      'retired',
    ]);
    // retired is terminal
    await expect(
      fabric.transitionListing({
        listingId: listing.listingId,
        tenantId: TENANT,
        to: 'published',
        reason: 'zombie',
        actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
        at: T2,
        idempotencyKey: 'idem-zombie-0001',
        correlationId: 'corr-zombie-0001',
      }),
    ).rejects.toThrow(BodyMarketplaceError);
  });

  it('derives the record-backed certification posture from resolvable A023 records', async () => {
    const { fabric, listing } = await seedListing();
    const posture = await fabric.deriveCertificationPosture(listing);
    expect(posture.state).toBe('record-backed');
    if (posture.state !== 'record-backed') return;
    expect(posture.records.length).toBeGreaterThan(0);
    expect(posture.strongestGrant).toBe('CANDIDATE');
    const badge = await fabric.certifiedBadge(listing.listingId, TENANT);
    expect(badge.grantedLevel).toBe('CANDIDATE');
    expect(badge.recordDigests.length).toBeGreaterThan(0);
    expect(badge.scopeNotice).toMatch(/never about the base model/);
  });

  it('grants access only on PUBLISHED listings (the offer/grant seam)', async () => {
    const { fabric, listing } = await seedListing();
    await expect(
      fabric.grantListingAccess({
        grantId: 'grant-0001',
        listingId: listing.listingId,
        tenantId: TENANT,
        grantee: { type: 'user', tenant: 'customer-beta', principalId: 'buyer-01' },
        permittedUse: 'possess',
        expiresAt: null,
        grantedBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
        grantedAt: T2,
        idempotencyKey: 'idem-grant-0001',
        correlationId: 'corr-grant-0001',
      }),
    ).rejects.toThrow(/PUBLISHED/);
    await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'published',
      reason: 'launch',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      releasePublication: {
        publisher: { type: 'service', tenant: TENANT, principalId: 'arena-body-marketplace' },
        rights: listing.rights,
        publishedAt: T2,
      },
      idempotencyKey: 'idem-publish-0003',
      correlationId: 'corr-publish-0003',
    });
    const grant = await fabric.grantListingAccess({
      grantId: 'grant-0001',
      listingId: listing.listingId,
      tenantId: TENANT,
      grantee: { type: 'user', tenant: 'customer-beta', principalId: 'buyer-01' },
      permittedUse: 'possess',
      expiresAt: null,
      grantedBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      grantedAt: T2,
      idempotencyKey: 'idem-grant-0001',
      correlationId: 'corr-grant-0001',
    });
    expect(grant.state).toBe('active');
    expect(grant.permittedUse).toBe('possess');
    // idempotent replay returns the same grant
    const replay = await fabric.grantListingAccess({
      grantId: 'grant-0001',
      listingId: listing.listingId,
      tenantId: TENANT,
      grantee: { type: 'user', tenant: 'customer-beta', principalId: 'buyer-01' },
      permittedUse: 'possess',
      expiresAt: null,
      grantedBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      grantedAt: T2,
      idempotencyKey: 'idem-grant-0001',
      correlationId: 'corr-grant-0001',
    });
    expect(replay.digest).toBe(grant.digest);
  });

  it('replays pretraining commands idempotently (byte-identical)', async () => {
    const { fabric, run } = await seedProposedRun();
    const replay = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-0001',
      idempotencyKey: 'idem-run-0001',
      correlationId: 'corr-run-0001',
    });
    expect(replay.digest).toBe(run.digest);
    expect(fabric.listListings(TENANT)).toEqual([]);
  });

  it('rejects the same idempotency key bound to a different command', async () => {
    const { fabric } = await seedProposedRun();
    await expect(
      fabric.requestPretraining({
        request: makePretrainingRequest({ targetVersion: '1.2.0' }),
        composition: makeComposition(),
        baseBodyVersionRef: null,
        releaseChannel: 'candidate',
        runId: 'run-0002',
        idempotencyKey: 'idem-run-0001',
        correlationId: 'corr-run-0002',
      }),
    ).rejects.toThrow(BodyMarketplaceError);
  });

  it('timestamps come from the injected clock (no hidden wall-clock reads)', async () => {
    let calls = 0;
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
      clock: { now: () => { calls += 1; return Date.parse(T0); } },
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-clock-0001',
      idempotencyKey: 'idem-clock-0001',
      correlationId: 'corr-clock-0001',
    });
    // No hidden wall-clock reads: the run's timestamps come from the
    // REQUEST (deterministic), and the injected clock is never consulted.
    expect(calls).toBe(0);
    expect(run.recordedAt).toBe(T0);
  });
});
