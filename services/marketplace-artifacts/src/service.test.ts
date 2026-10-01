import { describe, expect, it } from 'vitest';
import { parseEnvelope, serializeEnvelope } from '@arena/protocol-core';
import { createMarketplaceArtifactsService } from './service.js';
import { MARKETPLACE_ERROR_CODES, MarketplaceError } from './errors.js';
import { toMarketplaceReadScope } from './queries.js';
import {
  CORR_A,
  GRANTEE_B,
  IDEM_A,
  PUBLISHER_A,
  TENANT_A,
  TENANT_B,
  T4,
  makeDatasetManifestFor,
  makeEvidenceArtifact,
  makeEvidencedSubjectFor,
  makeOfferCandidate,
  evidenceRefsOf,
  seedMarketplaceFabric,
} from './test-support.js';

describe('marketplace service: command envelope round trips', () => {
  it('register-offer: command → gate → event (same correlation id, wire-serializable)', async () => {
    const service = createMarketplaceArtifactsService();
    const artifact = await makeEvidenceArtifact(300, { namespace: TENANT_A, name: 'wire-dataset' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const fixture = await makeEvidencedSubjectFor(ref);
    await service.fabric.putProvenanceRecord(fixture.provenanceRecord);
    service.fabric.putVerificationRecord(fixture.verification.record);

    const command = service.buildRegisterOfferCommand(
      { candidate: makeOfferCandidate({ offerId: 'wire-offer', artifactKind: 'dataset', artifact: ref }), evidence: evidenceRefsOf(fixture) },
      CORR_A,
      IDEM_A,
    );
    const outcome = await service.handleRegisterOfferCommand(serializeEnvelope(command));
    expect(outcome.event.kind).toBe('event');
    expect(outcome.event.correlationId).toBe(CORR_A);
    expect(outcome.event.idempotencyKey).toBeNull();
    expect(outcome.result.idempotent).toBe(false);
    const parsed = parseEnvelope(outcome.serializedEvent);
    expect(parsed.kind).toBe('event');
    expect((parsed.payload as Record<string, unknown>)['offerId']).toBe('wire-offer');
  });

  it('grant-access and submit-review round trip through the wire', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });

    const grantCommand = service.buildGrantAccessCommand(
      {
        grantId: 'grant-wire-001',
        offerId: seeded.datasetOfferId,
        grantee: { type: 'user', tenant: TENANT_B, principalId: 'user-b-wire' },
        permittedUse: 'evaluation',
        asOf: T4,
        expiresAt: null,
      },
      CORR_A,
      IDEM_A,
    );
    const grantOutcome = await service.handleGrantAccessCommand(serializeEnvelope(grantCommand));
    expect((grantOutcome.event.payload as Record<string, unknown>)['grantId']).toBe('grant-wire-001');

    const reviewCommand = service.buildSubmitReviewCommand(
      {
        reviewId: 'review-wire-001',
        offerId: seeded.datasetOfferId,
        reviewer: { type: 'user', tenant: TENANT_B, principalId: 'user-b-wire' },
        rating: 5,
        verdict: 'recommend',
        body: 'Excellent provenance discipline.',
        submittedAt: T4,
      },
      CORR_A,
      IDEM_A,
    );
    const reviewOutcome = await service.handleSubmitReviewCommand(serializeEnvelope(reviewCommand));
    expect((reviewOutcome.event.payload as Record<string, unknown>)['rating']).toBe(5);
  });

  it('retire + revoke round trips emit their lineage events', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });

    const revoke = await service.handleRevokeGrantCommand(
      serializeEnvelope(
        service.buildRevokeGrantCommand(
          {
            grantId: seeded.grantBId,
            grounds: 'wire revocation grounds',
            revoker: PUBLISHER_A,
            revokedAt: T4,
          },
          CORR_A,
          IDEM_A,
        ),
      ),
    );
    expect((revoke.event.payload as Record<string, unknown>)['revokes']).toBe(seeded.grantBToDataset);

    const retire = await service.handleRetireOfferCommand(
      serializeEnvelope(
        service.buildRetireOfferCommand(
          {
            offerId: seeded.datasetOfferId,
            retires: seeded.datasetOfferDigest,
            grounds: 'dataset withdrawn by the owner',
            provenance: { offeredBy: 'publisher-a-001', recordedAt: T4, notes: null },
          },
          CORR_A,
          IDEM_A,
        ),
      ),
    );
    expect((retire.event.payload as Record<string, unknown>)['retires']).toBe(seeded.datasetOfferDigest);
  });
});

describe('marketplace service: query envelope round trips', () => {
  it('query → response with SAME correlation id, echoed kind, pairing guard', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });
    const request = service.makeQuery('list-offers', { artifactKind: 'dataset' }, TENANT_A, CORR_A);
    const outcome = await service.handleQueryRequest(serializeEnvelope(request));
    expect(outcome.response.kind).toBe('response');
    expect(outcome.response.correlationId).toBe(CORR_A);
    expect(outcome.response.payload.kind).toBe('list-offers');
    const result = service.readQueryResponseFor(outcome.serializedResponse, request);
    expect((result as readonly unknown[]).length).toBeGreaterThanOrEqual(1);

    // pairing guard: a DIFFERENT request cannot consume this response
    const otherRequest = service.makeQuery('get-offer', { offerId: 'nope' }, TENANT_A, 'corr-other-9999');
    try {
      service.readQueryResponseFor(outcome.serializedResponse, otherRequest);
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
    }
  });

  it('queries reject non-query envelopes and non-null idempotency keys', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });
    // a command envelope is not a query
    const command = service.buildGrantAccessCommand(
      {
        grantId: 'wrong-kind',
        offerId: seeded.datasetOfferId,
        grantee: GRANTEE_B,
        permittedUse: 'evaluation',
        asOf: T4,
        expiresAt: null,
      },
      CORR_A,
      IDEM_A,
    );
    try {
      await service.handleQueryRequest(serializeEnvelope(command));
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
    }
  });
});

describe('marketplace service: fail-closed error normalization', () => {
  it('malformed JSON becomes a typed marketplace error', async () => {
    const service = createMarketplaceArtifactsService();
    try {
      await service.handleQueryRequest('{not json');
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
      expect((error as MarketplaceError).code).toBe(MARKETPLACE_ERROR_CODES.UNKNOWN_ERROR);
    }
  });

  it('gate rejections surface as REGISTRATION_REJECTED with structured rejections', async () => {
    const service = createMarketplaceArtifactsService();
    const artifact = await makeEvidenceArtifact(301, { namespace: TENANT_A, name: 'rejected-dataset' });
    const manifest = await makeDatasetManifestFor(artifact);
    const ref = {
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    };
    const command = service.buildRegisterOfferCommand(
      { candidate: makeOfferCandidate({ offerId: 'rejected-offer', artifactKind: 'dataset', artifact: ref }), evidence: [{ kind: 'provenance', digest: 'a'.repeat(64) }] },
      CORR_A,
      IDEM_A,
    );
    try {
      await service.handleRegisterOfferCommand(serializeEnvelope(command));
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
      expect((error as MarketplaceError).code).toBe(MARKETPLACE_ERROR_CODES.REGISTRATION_REJECTED);
      expect((error as MarketplaceError).correlationId).toBe(CORR_A);
    }
  });

  it('command envelopes require the marketplace schema pin (wrong schema rejected)', async () => {
    const service = createMarketplaceArtifactsService();
    const grantCommand = service.buildGrantAccessCommand(
      {
        grantId: 'schema-mismatch',
        offerId: 'unknown-offer',
        grantee: GRANTEE_B,
        permittedUse: 'evaluation',
        asOf: T4,
        expiresAt: null,
      },
      CORR_A,
      IDEM_A,
    );
    // rewrap the payload under the WRONG schema (register-offer-command)
    const rewrapped = serializeEnvelope({
      ...grantCommand,
      schema: 'arena:schema/marketplace-artifacts/register-offer-command@1.0.0',
    });
    try {
      await service.handleGrantAccessCommand(rewrapped);
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
    }
  });

  it('scope construction fails closed on invalid tenants', () => {
    expect(() => toMarketplaceReadScope('BAD TENANT')).toThrowError(MarketplaceError);
    expect(toMarketplaceReadScope(TENANT_A).tenant).toBe(TENANT_A);
  });
});
