import { describe, expect, it } from 'vitest';
import { createMarketplaceArtifactsFabric } from './fabric.js';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import {
  marketplaceQueryRequest,
  toMarketplaceReadScope,
  MARKETPLACE_QUERY_KINDS,
} from './queries.js';
import {
  CORR_A,
  GRANTEE_A,
  GRANTEE_B,
  PUBLISHER_A,
  PUBLISHER_B,
  RIGHTS_PROPRIETARY,
  T4,
  T5,
  T6,
  T7,
  T_LATE,
  TENANT_A,
  TENANT_B,
  evidenceRefsOf,
  makeDatasetManifestFor,
  makeEvidenceArtifact,
  makeEvidencedSubjectFor,
  makeOfferCandidate,
  seedMarketplaceFabric,
} from './test-support.js';

function expectCode(error: unknown, code: string): void {
  expect(error instanceof MarketplaceError).toBe(true);
  expect((error as MarketplaceError).code).toBe(code);
}

describe('fabric: ingest is guard-validated and idempotent', () => {
  it('rejects structurally invalid records of every evidence kind', async () => {
    const fabric = createMarketplaceArtifactsFabric();
    await expect(fabric.putProvenanceRecord({ nonsense: true })).rejects.toThrowError(
      MarketplaceError,
    );
    expect(() => fabric.putVerificationRecord({ nonsense: true })).toThrowError(MarketplaceError);
    expect(() => fabric.putDatasetManifest({ nonsense: true })).toThrowError(MarketplaceError);
    expect(() => fabric.putEvaluationCriteria({ nonsense: true })).toThrowError(MarketplaceError);
    expect(() => fabric.putEnvironmentDefinition({ nonsense: true })).toThrowError(MarketplaceError);
  });

  it('ingests the three marketplace artifact domains and counts them', async () => {
    const seeded = await seedMarketplaceFabric();
    const counts = seeded.fabric.counts();
    expect(counts['datasets']).toBe(1);
    expect(counts['evaluationCriteria']).toBe(1);
    expect(counts['environments']).toBe(1);
    expect(counts['offers']).toBeGreaterThanOrEqual(3);
    expect(counts['grants']).toBe(2);
    expect(counts['reviews']).toBe(2);
    expect(counts['provenanceRecords']).toBe(3);
    expect(counts['verificationRecords']).toBe(3);
  });
});

describe('fabric: offer registration (gate → idempotency → binding → append)', () => {
  it('rejects UNPROVENANCED listings (the gate fails closed, nothing is appended)', async () => {
    const fabric = createMarketplaceArtifactsFabric();
    const artifact = await makeEvidenceArtifact(200, { namespace: TENANT_A, name: 'orphan-dataset' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    fabric.putDatasetManifest(manifest);
    // NO provenance / verification ingested.
    await expect(
      fabric.registerOffer({
        candidate: makeOfferCandidate({
          offerId: 'orphan-offer',
          artifactKind: 'dataset',
          artifact: ref,
        }),
        correlationId: CORR_A,
        idempotencyKey: 'idem-orphan-001',
        evidence: [{ kind: 'provenance', digest: 'a'.repeat(64) }],
      }),
    ).rejects.toThrowError(MarketplaceError);
    expect(fabric.counts()['offers']).toBe(0);
  });

  it('rejects a publisher listing another tenant namespace artifact', async () => {
    const fabric = createMarketplaceArtifactsFabric();
    const artifact = await makeEvidenceArtifact(201, { namespace: TENANT_B, name: 'foreign-artifact' });
    const fixture = await makeEvidencedSubjectFor({
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    });
    await expect(
      fabric.registerOffer({
        candidate: makeOfferCandidate({
          offerId: 'foreign-namespace-offer',
          artifactKind: 'dataset',
          artifact: fixture.artifact,
        }),
        correlationId: CORR_A,
        idempotencyKey: 'idem-foreign-001',
        evidence: evidenceRefsOf(fixture),
      }),
    ).rejects.toThrowError(MarketplaceError);
    // The gate rejection (REGISTRATION_REJECTED) fires after the tenant check:
    await expect(
      fabric.registerOffer({
        candidate: makeOfferCandidate({
          offerId: 'foreign-namespace-offer-2',
          artifactKind: 'dataset',
          artifact: fixture.artifact,
        }),
        correlationId: CORR_A,
        idempotencyKey: 'idem-foreign-002',
        evidence: evidenceRefsOf(fixture),
      }),
    ).rejects.toThrowError();
  });

  it('replays idempotently for the same command and conflicts on divergent commands', async () => {
    const artifact = await makeEvidenceArtifact(202, { namespace: TENANT_A, name: 'idem-dataset' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = createMarketplaceArtifactsFabric();
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);

    const command = {
      candidate: makeOfferCandidate({
        offerId: 'idempotent-offer',
        artifactKind: 'dataset',
        artifact: ref,
      }),
      correlationId: CORR_A,
      idempotencyKey: 'idem-idem-001',
      evidence: evidenceRefsOf(fixture),
    };
    const first = await fabric.registerOffer(command);
    const replay = await fabric.registerOffer(command);
    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    expect(replay.record.digest).toBe(first.record.digest);
    expect(fabric.counts()['offers']).toBe(1);

    await expect(
      fabric.registerOffer({
        ...command,
        candidate: { ...command.candidate, title: 'A divergent title' },
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('identity-conflicts when a new registration targets a bound offerId', async () => {
    const artifact = await makeEvidenceArtifact(203, { namespace: TENANT_A, name: 'identity-dataset' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = createMarketplaceArtifactsFabric();
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    const base = {
      candidate: makeOfferCandidate({
        offerId: 'bound-offer',
        artifactKind: 'dataset',
        artifact: ref,
      }),
      evidence: evidenceRefsOf(fixture),
    };
    await fabric.registerOffer({ ...base, correlationId: CORR_A, idempotencyKey: 'idem-bound-001' });
    await expect(
      fabric.registerOffer({
        ...base,
        candidate: { ...base.candidate, title: 'conflicting content' },
        correlationId: 'corr-bound-002',
        idempotencyKey: 'idem-bound-002',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('supersession re-gates, projects state and requires citing the active digest', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;

    // supersession citing a stale digest is rejected
    await expect(
      fabric.supersedeOffer({
        candidate: makeOfferCandidate({
          kind: 'offer-supersession',
          offerId: seeded.datasetOfferId,
          artifactKind: 'dataset',
          artifact: seeded.datasetArtifact,
          supersedes: 'd'.repeat(64),
          grounds: 'wrong citation',
        }),
        correlationId: 'corr-sup-001',
        idempotencyKey: 'idem-sup-001',
        evidence: [],
      }),
    ).rejects.toThrowError(MarketplaceError);

    // supersession with NO evidence for the new content is gate-rejected
    await expect(
      fabric.supersedeOffer({
        candidate: makeOfferCandidate({
          kind: 'offer-supersession',
          offerId: seeded.datasetOfferId,
          artifactKind: 'dataset',
          artifact: seeded.datasetArtifact,
          supersedes: seeded.datasetOfferDigest,
          grounds: 'new version without evidence',
        }),
        correlationId: 'corr-sup-002',
        idempotencyKey: 'idem-sup-002',
        evidence: [],
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('retirement projects the offer out of the active set', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    await fabric.retireOffer({
      offerId: seeded.environmentOfferId,
      retires: seeded.environmentOfferDigest,
      grounds: 'the sandbox image was deprecated upstream',
      provenance: { offeredBy: 'publisher-b-001', recordedAt: T7, notes: null },
      correlationId: 'corr-retire-001',
      idempotencyKey: 'idem-retire-001',
    });
    const status = await fabric.handleQueryRequest(
      marketplaceQueryRequest(
        'resolve-offer-status',
        { offerId: seeded.environmentOfferId },
        toMarketplaceReadScope(TENANT_B),
      ),
    );
    const result = status.result as { state: string };
    expect(result.state).toBe('unknown');
    await expect(
      fabric.grantAccess({
        grantId: 'grant-after-retire',
        offerId: seeded.environmentOfferId,
        grantee: GRANTEE_B,
        permittedUse: 'tenant-internal',
        asOf: T7,
        correlationId: 'corr-gone-001',
        idempotencyKey: 'idem-gone-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });
});

describe('fabric: access grants (tenant boundary, license rules, data rights)', () => {
  it('grants cross-tenant access on a public, redistribution-allowed offer', async () => {
    const seeded = await seedMarketplaceFabric();
    const grant = await seeded.fabric.grantAccess({
      grantId: 'grant-x-tenant-001',
      offerId: seeded.datasetOfferId,
      grantee: { type: 'user', tenant: TENANT_B, principalId: 'user-x-001' },
      permittedUse: 'evaluation',
      asOf: T5,
      correlationId: 'corr-gx-001',
      idempotencyKey: 'idem-gx-001',
    });
    expect(grant.idempotent).toBe(false);
    expect(grant.record.granteeTenant).toBe(TENANT_B);
    expect(grant.dataRights.allowed).toBe(true);
  });

  it('denies cross-tenant grants on tenant-internal offers (fail closed)', async () => {
    const seeded = await seedMarketplaceFabric();
    try {
      await seeded.fabric.grantAccess({
        grantId: 'grant-cross-internal',
        offerId: seeded.environmentOfferId,
        grantee: GRANTEE_A,
        permittedUse: 'evaluation',
        asOf: T5,
        correlationId: 'corr-gc-001',
        idempotencyKey: 'idem-gc-001',
      });
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('denies grants forbidden by redistribution licenses', async () => {
    const artifact = await makeEvidenceArtifact(210, { namespace: TENANT_A, name: 'proprietary-dataset' });
    const manifest = await makeDatasetManifestFor(artifact, RIGHTS_PROPRIETARY);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = createMarketplaceArtifactsFabric();
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    await fabric.registerOffer({
      candidate: makeOfferCandidate({
        offerId: 'proprietary-offer',
        artifactKind: 'dataset',
        artifact: ref,
        rights: RIGHTS_PROPRIETARY,
        visibility: 'public',
      }),
      correlationId: CORR_A,
      idempotencyKey: 'idem-proprietary-001',
      evidence: evidenceRefsOf(fixture),
    });
    try {
      await fabric.grantAccess({
        grantId: 'grant-prop-001',
        offerId: 'proprietary-offer',
        grantee: GRANTEE_B,
        permittedUse: 'evaluation',
        asOf: T5,
        correlationId: 'corr-prop-001',
        idempotencyKey: 'idem-prop-001',
      });
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN);
      const details = (error as MarketplaceError).details as { reason: string };
      expect(details.reason).toBe('license-redistribution-prohibited');
    }
  });

  it('denies commercial use when the license prohibits it and public display is requested', async () => {
    const artifact = await makeEvidenceArtifact(211, { namespace: TENANT_A, name: 'commercial-dataset' });
    const manifest = await makeDatasetManifestFor(artifact, RIGHTS_PROPRIETARY);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = createMarketplaceArtifactsFabric();
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    await fabric.registerOffer({
      candidate: makeOfferCandidate({
        offerId: 'commercial-offer',
        artifactKind: 'dataset',
        artifact: ref,
        rights: RIGHTS_PROPRIETARY,
        visibility: 'public',
      }),
      correlationId: CORR_A,
      idempotencyKey: 'idem-commercial-001',
      evidence: evidenceRefsOf(fixture),
    });
    try {
      await fabric.grantAccess({
        grantId: 'grant-commercial-001',
        offerId: 'commercial-offer',
        grantee: GRANTEE_A,
        permittedUse: 'public-display',
        asOf: T5,
        correlationId: 'corr-commercial-001',
        idempotencyKey: 'idem-commercial-002',
      });
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN);
      const details = (error as MarketplaceError).details as { reason: string };
      expect(details.reason).toBe('license-commercial-prohibited');
    }
  });

  it('denies cross-tenant-learning when the artifact carries customer data (R47)', async () => {
    const artifact = await makeEvidenceArtifact(212, { namespace: TENANT_A, name: 'customer-data-dataset' });
    const manifest = await makeDatasetManifestFor(artifact, RIGHTS_PROPRIETARY);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = createMarketplaceArtifactsFabric();
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    await fabric.registerOffer({
      candidate: makeOfferCandidate({
        offerId: 'customer-data-offer',
        artifactKind: 'dataset',
        artifact: ref,
        rights: RIGHTS_PROPRIETARY,
        visibility: 'public',
      }),
      correlationId: CORR_A,
      idempotencyKey: 'idem-cd-001',
      evidence: evidenceRefsOf(fixture),
    });
    try {
      await fabric.grantAccess({
        grantId: 'grant-cd-001',
        offerId: 'customer-data-offer',
        grantee: GRANTEE_B,
        permittedUse: 'cross-tenant-learning',
        asOf: T5,
        correlationId: 'corr-cd-001',
        idempotencyKey: 'idem-cd-002',
      });
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN);
      const details = (error as MarketplaceError).details as { reason: string };
      expect(details.reason).toBe('license-redistribution-prohibited');
    }
  });

  it('rejects unknown permitted-use vocabulary', async () => {
    const seeded = await seedMarketplaceFabric();
    await expect(
      seeded.fabric.grantAccess({
        grantId: 'grant-bad-use',
        offerId: seeded.datasetOfferId,
        grantee: GRANTEE_A,
        permittedUse: 'world-domination',
        asOf: T5,
        correlationId: 'corr-baduse-001',
        idempotencyKey: 'idem-baduse-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('authorizeDownload re-checks revocation, expiry and data rights (fail closed)', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;

    // active grant authorizes
    const authorization = await fabric.authorizeDownload(seeded.grantBId, T5);
    expect(authorization.dataRights.allowed).toBe(true);
    expect(authorization.grant.grantId).toBe(seeded.grantBId);

    // unknown grant fails closed
    await expect(fabric.authorizeDownload('no-such-grant', T5)).rejects.toThrowError(
      MarketplaceError,
    );

    // revoked grant fails closed
    await fabric.revokeGrant({
      grantId: seeded.grantBId,
      grounds: 'the grantee violated the evaluation terms',
      revoker: PUBLISHER_A,
      revokedAt: T7,
      correlationId: 'corr-revoke-001',
      idempotencyKey: 'idem-revoke-001',
    });
    await expect(fabric.authorizeDownload(seeded.grantBId, T_LATE)).rejects.toThrowError(
      MarketplaceError,
    );

    // expired grant fails closed
    const expired = await fabric.grantAccess({
      grantId: 'grant-expiring-001',
      offerId: seeded.datasetOfferId,
      grantee: GRANTEE_A,
      permittedUse: 'tenant-internal',
      asOf: T4,
      expiresAt: T5,
      correlationId: 'corr-exp-001',
      idempotencyKey: 'idem-exp-001',
    });
    expect(expired.record.expiresAt).toBe(T5);
    await expect(fabric.authorizeDownload('grant-expiring-001', T6)).rejects.toThrowError(
      MarketplaceError,
    );
  });

  it('revocation is owner-only and single-shot', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    // a tenant-b principal cannot revoke a tenant-a offer grant
    await expect(
      fabric.revokeGrant({
        grantId: seeded.grantBId,
        grounds: 'not the owner',
        revoker: PUBLISHER_B,
        revokedAt: T7,
        correlationId: 'corr-notowner-001',
        idempotencyKey: 'idem-notowner-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
    // owner revokes once
    await fabric.revokeGrant({
      grantId: seeded.grantBId,
      grounds: 'terms violation',
      revoker: PUBLISHER_A,
      revokedAt: T7,
      correlationId: 'corr-owner-001',
      idempotencyKey: 'idem-owner-001',
    });
    await expect(
      fabric.revokeGrant({
        grantId: seeded.grantBId,
        grounds: 'second attempt',
        revoker: PUBLISHER_A,
        revokedAt: T7,
        correlationId: 'corr-owner-002',
        idempotencyKey: 'idem-owner-002',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });
});

describe('fabric: review gating (closed vocabularies, active grants)', () => {
  it('accepts a review from a principal holding an active grant', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    await fabric.grantAccess({
      grantId: 'grant-b2-dataset-001',
      offerId: seeded.datasetOfferId,
      grantee: { type: 'user', tenant: TENANT_B, principalId: 'user-b-002' },
      permittedUse: 'evaluation',
      asOf: T5,
      correlationId: 'corr-grant-b2-001',
      idempotencyKey: 'idem-grant-b2-001',
    });
    const review = await fabric.submitReview({
      reviewId: 'review-x-001',
      offerId: seeded.datasetOfferId,
      reviewer: { type: 'user', tenant: TENANT_B, principalId: 'user-b-002' },
      rating: 3,
      verdict: 'mixed',
      body: 'Usable but the split balance is uneven.',
      submittedAt: T5,
      correlationId: 'corr-rev-001',
      idempotencyKey: 'idem-rev-001',
    });
    expect(review.record.rating).toBe(3);
    expect(review.record.verdict).toBe('mixed');
  });

  it('rejects reviews from principals with NO grant (fail closed)', async () => {
    const seeded = await seedMarketplaceFabric();
    try {
      await seeded.fabric.submitReview({
        reviewId: 'review-nogrant-001',
        offerId: seeded.datasetOfferId,
        reviewer: { type: 'user', tenant: TENANT_B, principalId: 'user-b-777' },
        rating: 5,
        verdict: 'recommend',
        body: 'I never accessed this dataset but here is a review anyway.',
        submittedAt: T5,
        correlationId: 'corr-revng-001',
        idempotencyKey: 'idem-revng-001',
      });
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.REVIEW_UNAUTHORIZED);
    }
  });

  it('rejects reviews after the grant was revoked', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    await fabric.revokeGrant({
      grantId: seeded.grantBId,
      grounds: 'terms violation',
      revoker: PUBLISHER_A,
      revokedAt: T6,
      correlationId: 'corr-revrg-001',
      idempotencyKey: 'idem-revrg-001',
    });
    await expect(
      fabric.submitReview({
        reviewId: 'review-post-revoke-001',
        offerId: seeded.datasetOfferId,
        reviewer: GRANTEE_B,
        rating: 5,
        verdict: 'recommend',
        body: 'Post-revocation review.',
        submittedAt: T7,
        correlationId: 'corr-revpr-001',
        idempotencyKey: 'idem-revpr-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('rejects closed-vocabulary violations (rating, verdict)', async () => {
    const seeded = await seedMarketplaceFabric();
    await expect(
      seeded.fabric.submitReview({
        reviewId: 'review-bad-rating',
        offerId: seeded.datasetOfferId,
        reviewer: GRANTEE_B,
        rating: 6,
        verdict: 'recommend',
        body: 'Over the top.',
        submittedAt: T5,
        correlationId: 'corr-badr-001',
        idempotencyKey: 'idem-badr-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
    await expect(
      seeded.fabric.submitReview({
        reviewId: 'review-bad-verdict',
        offerId: seeded.datasetOfferId,
        reviewer: GRANTEE_B,
        rating: 4,
        verdict: 'masterpiece',
        body: 'Not a closed verdict.',
        submittedAt: T5,
        correlationId: 'corr-badv-001',
        idempotencyKey: 'idem-badv-001',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('one review per reviewer per offer; idempotent replay of the same review', async () => {
    const seeded = await seedMarketplaceFabric();
    await seeded.fabric.grantAccess({
      grantId: 'grant-b3-dataset-001',
      offerId: seeded.datasetOfferId,
      grantee: { type: 'user', tenant: TENANT_B, principalId: 'user-b-003' },
      permittedUse: 'evaluation',
      asOf: T5,
      correlationId: 'corr-grant-b3-001',
      idempotencyKey: 'idem-grant-b3-001',
    });
    const command = {
      reviewId: 'review-dup-001',
      offerId: seeded.datasetOfferId,
      reviewer: { type: 'user', tenant: TENANT_B, principalId: 'user-b-003' },
      rating: 2,
      verdict: 'not-recommended',
      body: 'Duplicate check.',
      submittedAt: T5,
      correlationId: 'corr-dup-001',
      idempotencyKey: 'idem-dup-001',
    };
    const first = await seeded.fabric.submitReview(command);
    const replay = await seeded.fabric.submitReview(command);
    expect(first.idempotent).toBe(false);
    expect(replay.idempotent).toBe(true);
    await expect(
      seeded.fabric.submitReview({
        ...command,
        reviewId: 'review-dup-002',
        rating: 5,
        body: 'Same reviewer, different content.',
        correlationId: 'corr-dup-002',
        idempotencyKey: 'idem-dup-002',
      }),
    ).rejects.toThrowError(MarketplaceError);
  });
});

describe('fabric: query dispatch (scope-checked first, fail closed)', () => {
  it('lists and searches public offers across the three domains', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const scope = toMarketplaceReadScope(TENANT_B);
    const list = await fabric.handleQueryRequest(
      marketplaceQueryRequest('list-offers', { artifactKind: 'all' }, scope),
    );
    const offers = list.result as readonly { offerId: string; tenant: string }[];
    expect(offers.map((o) => o.offerId)).toContain(seeded.datasetOfferId);
    expect(offers.map((o) => o.offerId)).toContain(seeded.evaluationOfferId);
    // the owner tenant sees its tenant-internal listing; foreign tenants do not
    expect(offers.map((o) => o.offerId)).toContain(seeded.environmentOfferId);
    const foreign = await fabric.handleQueryRequest(
      marketplaceQueryRequest('list-offers', { artifactKind: 'all' }, toMarketplaceReadScope(TENANT_A)),
    );
    const foreignOffers = foreign.result as readonly { offerId: string }[];
    expect(foreignOffers.map((o) => o.offerId)).not.toContain(seeded.environmentOfferId);
    expect(foreignOffers.map((o) => o.offerId)).toHaveLength(2);

    const datasets = await fabric.handleQueryRequest(
      marketplaceQueryRequest('list-offers', { artifactKind: 'dataset' }, scope),
    );
    expect((datasets.result as readonly unknown[]).map((s) => (s as { offerId: string }).offerId)).toEqual([
      seeded.datasetOfferId,
    ]);

    const search = await fabric.handleQueryRequest(
      marketplaceQueryRequest('search-offers', { query: 'SOLDER', artifactKind: 'all' }, scope),
    );
    const results = search.result as readonly { offerId: string }[];
    expect(results.map((r) => r.offerId)).toContain(seeded.datasetOfferId);
    expect(results.map((r) => r.offerId)).toContain(seeded.evaluationOfferId);

    const none = await fabric.handleQueryRequest(
      marketplaceQueryRequest('search-offers', { query: 'structural-bridge', artifactKind: 'all' }, scope),
    );
    expect(none.result).toHaveLength(0);
  });

  it('hides tenant-internal offers from other tenants and fails closed on direct reads', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const foreignScope = toMarketplaceReadScope(TENANT_A);
    try {
      await fabric.handleQueryRequest(
        marketplaceQueryRequest('get-offer', { offerId: seeded.environmentOfferId }, foreignScope),
      );
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
    const ownScope = toMarketplaceReadScope(TENANT_B);
    const own = await fabric.handleQueryRequest(
      marketplaceQueryRequest('get-offer', { offerId: seeded.environmentOfferId }, ownScope),
    );
    const profile = own.result as { state: string; reviewCount: number };
    expect(profile.state).toBe('registered');

    // list-reviews for a foreign tenant-internal offer fails closed too
    try {
      await fabric.handleQueryRequest(
        marketplaceQueryRequest('list-reviews', { offerId: seeded.environmentOfferId }, foreignScope),
      );
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('profiles carry review aggregates; unknown offers answer state unknown', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const profile = await fabric.handleQueryRequest(
      marketplaceQueryRequest('get-offer', { offerId: seeded.datasetOfferId }, toMarketplaceReadScope(TENANT_A)),
    );
    const value = profile.result as { reviewCount: number; averageRating: number | null };
    expect(value.reviewCount).toBe(2);
    expect(value.averageRating).toBe(4.5);

    const unknown = await fabric.handleQueryRequest(
      marketplaceQueryRequest('get-offer', { offerId: 'does-not-exist' }, toMarketplaceReadScope(TENANT_A)),
    );
    expect((unknown.result as { state: string }).state).toBe('unknown');
  });

  it('grant queries are tenant-scoped; cross-tenant reads fail closed', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const own = await fabric.handleQueryRequest(
      marketplaceQueryRequest('get-grant', { grantId: seeded.grantBId }, toMarketplaceReadScope(TENANT_B)),
    );
    expect((own.result as { state: string }).state).toBe('active');
    // the offer-owning tenant may also read grants over its own offer
    const ownerView = await fabric.handleQueryRequest(
      marketplaceQueryRequest('get-grant', { grantId: seeded.grantBId }, toMarketplaceReadScope(TENANT_A)),
    );
    expect((ownerView.result as { state: string }).state).toBe('active');
    // a THIRD tenant cannot read the grant at all
    try {
      await fabric.handleQueryRequest(
        marketplaceQueryRequest('get-grant', { grantId: seeded.grantBId }, toMarketplaceReadScope('tenant-c')),
      );
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('list-grants is addressability-checked (only own tenant or public)', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const own = await fabric.handleQueryRequest(
      marketplaceQueryRequest('list-grants', { tenant: TENANT_B }, toMarketplaceReadScope(TENANT_B)),
    );
    expect((own.result as readonly unknown[]).length).toBeGreaterThanOrEqual(1);
    try {
      await fabric.handleQueryRequest(
        marketplaceQueryRequest('list-grants', { tenant: TENANT_B }, toMarketplaceReadScope(TENANT_A)),
      );
      expect.unreachable();
    } catch (error) {
      expectCode(error, MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('rejects unknown query kinds and malformed params (fail closed)', async () => {
    const seeded = await seedMarketplaceFabric();
    const scope = toMarketplaceReadScope(TENANT_A);
    await expect(
      seeded.fabric.handleQueryRequest({
        requestVersion: 1,
        kind: 'teleport-offer' as never,
        params: {} as never,
        scope,
      }),
    ).rejects.toThrowError(MarketplaceError);
    expect(() =>
      marketplaceQueryRequest('list-offers', { artifactKind: 'datasets' }, scope),
    ).toThrowError(MarketplaceError);
    expect(() => marketplaceQueryRequest('search-offers', { query: '' }, scope)).toThrowError(
      MarketplaceError,
    );
    expect(() => toMarketplaceReadScope('Invalid_Tenant')).toThrowError(MarketplaceError);
    expect([...MARKETPLACE_QUERY_KINDS]).toHaveLength(7);
  });
});
