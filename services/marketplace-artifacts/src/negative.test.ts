/**
 * Negative / adversarial suite for @arena/marketplace-artifacts-fabric
 * (Work Order A032): tampered evidence, digest-mismatch denial,
 * unprovenanced listing rejection, cross-tenant access denial, license
 * violations, review gating — every adversarial path fails CLOSED.
 */

import { describe, expect, it } from 'vitest';
import { makeEnvelope, serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { createMarketplaceArtifactsService } from './service.js';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import { marketplaceQueryRequest, toMarketplaceReadScope } from './queries.js';
import {
  CORR_A,
  GRANTEE_B,
  IDEM_A,
  TENANT_A,
  TENANT_B,
  T4,
  T5,
  makeDatasetManifestFor,
  makeEvidenceArtifact,
  makeEvidencedSubjectFor,
  makeOfferCandidate,
  evidenceRefsOf,
  seedMarketplaceFabric,
} from './test-support.js';

function codeOf(error: unknown): string {
  expect(error instanceof MarketplaceError).toBe(true);
  return (error as MarketplaceError).code;
}

describe('adversarial: tampered evidence records (digest-mismatch denial)', () => {
  it('a TAMPERED verification record (content mutated, digest kept) is denied at ingest-gate time', async () => {
    const fabric = (await seedMarketplaceFabric()).fabric;
    const artifact = await makeEvidenceArtifact(400, { namespace: TENANT_A, name: 'tamper-target' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    // Adversary forges a record whose digest field cites the REAL record but
    // whose content was mutated (outcome forced to pass on a failing record).
    const failing = await makeEvidencedSubjectFor(ref, { outcomeOverride: 'fail' });
    const forged = {
      ...failing.verification.record,
      outcome: 'pass',
      digest: failing.verification.record.digest,
    };
    fabric.putVerificationRecord(forged);
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    try {
      await fabric.registerOffer({
        candidate: makeOfferCandidate({ offerId: 'forged-offer', artifactKind: 'dataset', artifact: ref }),
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
        evidence: [
          { kind: 'provenance', digest: fixture.provenanceDigest },
          { kind: 'verification', digest: failing.verification.record.digest },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED);
      const details = (error as MarketplaceError).details as {
        rejections: readonly { reason: string }[];
      };
      expect(details.rejections.some((r) => r.reason === 'evidence-digest-mismatch')).toBe(true);
    }
    expect(fabric.counts()['offers']).toBe(3);
  });

  it('a TAMPERED provenance record is denied the same way', async () => {
    const fabric = (await seedMarketplaceFabric()).fabric;
    const artifact = await makeEvidenceArtifact(401, { namespace: TENANT_A, name: 'tamper-provenance' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    fabric.putVerificationRecord(fixture.verification.record);
    const forgedProvenance = {
      ...fixture.provenanceRecord,
      recordedAt: '2027-12-31T23:59:59.999Z',
    };
    await fabric.putProvenanceRecord(forgedProvenance);
    try {
      await fabric.registerOffer({
        candidate: makeOfferCandidate({ offerId: 'forged-provenance-offer', artifactKind: 'dataset', artifact: ref }),
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
        evidence: [
          { kind: 'provenance', digest: fixture.provenanceDigest },
          { kind: 'verification', digest: fixture.verification.record.digest },
        ],
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED);
    }
  });
});

describe('adversarial: unprovenanced listing rejection', () => {
  it('no provenance at all → rejection with the closed reason', async () => {
    const fabric = (await seedMarketplaceFabric()).fabric;
    const artifact = await makeEvidenceArtifact(402, { namespace: TENANT_A, name: 'orphan-2' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    fabric.putVerificationRecord(fixture.verification.record);
    try {
      await fabric.registerOffer({
        candidate: makeOfferCandidate({ offerId: 'orphan-2-offer', artifactKind: 'dataset', artifact: ref }),
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
        // verification only — NO provenance citation
        evidence: [{ kind: 'verification', digest: fixture.verification.record.digest }],
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED);
      const details = (error as MarketplaceError).details as {
        rejections: readonly { reason: string }[];
      };
      expect(details.rejections.some((r) => r.reason === 'provenance-missing')).toBe(true);
    }
  });
});

describe('adversarial: cross-tenant access denial', () => {
  it('a foreign tenant cannot query a tenant-internal offer profile', async () => {
    const seeded = await seedMarketplaceFabric();
    try {
      await seeded.fabric.handleQueryRequest(
        marketplaceQueryRequest(
          'resolve-offer-status',
          { offerId: seeded.environmentOfferId },
          toMarketplaceReadScope(TENANT_A),
        ),
      );
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });

  it('a foreign tenant cannot list another tenant grant ledger', async () => {
    const seeded = await seedMarketplaceFabric();
    try {
      await seeded.fabric.handleQueryRequest(
        marketplaceQueryRequest('list-grants', { tenant: TENANT_B }, toMarketplaceReadScope(TENANT_A)),
      );
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.CROSS_TENANT_ACCESS);
    }
  });
});

describe('adversarial: license violations', () => {
  it('redistribution-prohibited license blocks cross-tenant grants with the closed reason', async () => {
    const artifact = await makeEvidenceArtifact(403, { namespace: TENANT_A, name: 'locked-dataset' });
    const manifest = await makeDatasetManifestFor(artifact, {
      license: 'Proprietary-1.0',
      commercialUse: 'prohibited',
      redistribution: 'prohibited',
      customerData: 'none',
    });
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = (await seedMarketplaceFabric()).fabric;
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    await fabric.registerOffer({
      candidate: makeOfferCandidate({
        offerId: 'locked-offer',
        artifactKind: 'dataset',
        artifact: ref,
        rights: { license: 'Proprietary-1.0', commercialUse: 'prohibited', redistribution: 'prohibited', customerData: 'none' },
        visibility: 'public',
      }),
      correlationId: 'corr-negative-locked',
      idempotencyKey: 'idem-negative-locked',
      evidence: evidenceRefsOf(fixture),
    });
    try {
      await fabric.grantAccess({
        grantId: 'grant-locked-001',
        offerId: 'locked-offer',
        grantee: GRANTEE_B,
        permittedUse: 'evaluation',
        asOf: T4,
        correlationId: 'corr-locked-001',
        idempotencyKey: 'idem-locked-001',
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN);
      const details = (error as MarketplaceError).details as { reason: string };
      expect(details.reason).toBe('license-redistribution-prohibited');
    }
  });

  it('customer-data-bearing artifacts block cross-tenant-learning (R47)', async () => {
    const artifact = await makeEvidenceArtifact(404, { namespace: TENANT_A, name: 'cd-dataset' });
    const manifest = await makeDatasetManifestFor(artifact, {
      license: 'CC-BY-4.0',
      commercialUse: 'allowed',
      redistribution: 'allowed',
      customerData: 'contains',
    });
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    const fabric = (await seedMarketplaceFabric()).fabric;
    await fabric.putProvenanceRecord(fixture.provenanceRecord);
    fabric.putVerificationRecord(fixture.verification.record);
    await fabric.registerOffer({
      candidate: makeOfferCandidate({
        offerId: 'cd-offer',
        artifactKind: 'dataset',
        artifact: ref,
        rights: { license: 'CC-BY-4.0', commercialUse: 'allowed', redistribution: 'allowed', customerData: 'contains' },
        visibility: 'public',
      }),
      correlationId: 'corr-negative-cd',
      idempotencyKey: 'idem-negative-cd',
      evidence: evidenceRefsOf(fixture),
    });
    try {
      await fabric.grantAccess({
        grantId: 'grant-cd-blocked',
        offerId: 'cd-offer',
        grantee: GRANTEE_B,
        permittedUse: 'cross-tenant-learning',
        asOf: T4,
        correlationId: 'corr-cdb-001',
        idempotencyKey: 'idem-cdb-001',
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.GRANT_FORBIDDEN);
      const details = (error as MarketplaceError).details as { reason: string };
      expect(details.reason).toBe('license-customer-data');
    }
  });
});

describe('adversarial: review gating', () => {
  it('a principal whose grant EXPIRED cannot review', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    await fabric.grantAccess({
      grantId: 'grant-expired-review',
      offerId: seeded.datasetOfferId,
      grantee: { type: 'user', tenant: TENANT_A, principalId: 'user-a-review' },
      permittedUse: 'tenant-internal',
      asOf: T4,
      expiresAt: T5,
      correlationId: 'corr-expr-001',
      idempotencyKey: 'idem-expr-001',
    });
    try {
      await fabric.submitReview({
        reviewId: 'review-expired-001',
        offerId: seeded.datasetOfferId,
        reviewer: { type: 'user', tenant: TENANT_A, principalId: 'user-a-review' },
        rating: 5,
        verdict: 'recommend',
        body: 'Review after expiry.',
        submittedAt: T5,
        correlationId: 'corr-expr-002',
        idempotencyKey: 'idem-expr-002',
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.REVIEW_UNAUTHORIZED);
    }
  });

  it('a grant for a DIFFERENT offer does not unlock reviews', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    // grant on the environment offer (tenant-b, own tenant) …
    await fabric.grantAccess({
      grantId: 'grant-env-001',
      offerId: seeded.environmentOfferId,
      grantee: { type: 'user', tenant: TENANT_B, principalId: 'user-b-env' },
      permittedUse: 'tenant-internal',
      asOf: T4,
      correlationId: 'corr-env-001',
      idempotencyKey: 'idem-env-001',
    });
    // … does NOT authorize a review of the dataset offer
    try {
      await fabric.submitReview({
        reviewId: 'review-wrong-offer',
        offerId: seeded.datasetOfferId,
        reviewer: { type: 'user', tenant: TENANT_B, principalId: 'user-b-env' },
        rating: 5,
        verdict: 'recommend',
        body: 'I only accessed the environment, not the dataset.',
        submittedAt: T5,
        correlationId: 'corr-wrongoff-001',
        idempotencyKey: 'idem-wrongoff-001',
      });
      expect.unreachable();
    } catch (error) {
      expect(codeOf(error)).toBe(MARKETPLACE_ERROR_CODES.REVIEW_UNAUTHORIZED);
    }
  });
});

describe('adversarial: wire-level attacks', () => {
  it('a command envelope with a NULL idempotency key is rejected by protocol-core (fail closed)', () => {
    expect(() =>
      makeEnvelope({
        kind: 'command',
        schema: 'arena:schema/marketplace-artifacts/register-offer-command@1.0.0',
        correlationId: toCorrelationId('corr-null-idem'),
        idempotencyKey: null,
        payload: {},
      }),
    ).toThrowError();
  });

  it('garbage wire input is normalized, never crashes the service', async () => {
    const service = createMarketplaceArtifactsService();
    for (const garbage of ['', 'null', '[]', '{"v":9}', 'not json at all']) {
      try {
        await service.handleQueryRequest(garbage);
        expect.unreachable();
      } catch (error) {
        expect(error instanceof MarketplaceError).toBe(true);
      }
    }
  });

  it('a review command for an unknown offer fails closed', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });
    const command = service.buildSubmitReviewCommand(
      {
        reviewId: 'review-unknown-offer',
        offerId: 'does-not-exist',
        reviewer: GRANTEE_B,
        rating: 5,
        verdict: 'recommend',
        body: 'Review of nothing.',
        submittedAt: T5,
      },
      CORR_A,
      IDEM_A,
    );
    await expect(service.handleSubmitReviewCommand(serializeEnvelope(command))).rejects.toThrowError(
      MarketplaceError,
    );
  });

  it('a registration citing evidence of an UNKNOWN kind is rejected at parse time', async () => {
    const service = createMarketplaceArtifactsService();
    const artifact = await makeEvidenceArtifact(405, { namespace: TENANT_A, name: 'bad-evidence-kind' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const envelope = makeEnvelope({
      kind: 'command',
      schema: 'arena:schema/marketplace-artifacts/register-offer-command@1.0.0',
      correlationId: toCorrelationId(CORR_A),
      idempotencyKey: toIdempotencyKey(IDEM_A),
      payload: {
        candidate: makeOfferCandidate({ offerId: 'bad-evidence-offer', artifactKind: 'dataset', artifact: ref }),
        evidence: [{ kind: 'rumor', digest: 'a'.repeat(64) }],
      },
    });
    try {
      await service.handleRegisterOfferCommand(serializeEnvelope(envelope));
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
    }
  });
});
