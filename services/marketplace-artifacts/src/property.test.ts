/**
 * Property suite for @arena/marketplace-artifacts-fabric (Work Order
 * A032): seeded-LCG invariants — content addressing uniqueness,
 * deterministic replay, freeze depth, closed gate vocabulary, closed
 * query result shapes.
 */

import { describe, expect, it } from 'vitest';
import { createMarketplaceOfferRecord } from './offers.js';
import { evaluateListingGate, MARKETPLACE_GATE_REJECTION_REASONS } from './gate.js';
import { MARKETPLACE_REVIEW_RATINGS, averageRatingOf } from './reviews.js';
import { marketplaceQueryRequest, toMarketplaceReadScope, MARKETPLACE_QUERY_KINDS } from './queries.js';
import { createMarketplaceArtifactsService } from './service.js';
import {
  CORR_A,
  IDEM_A,
  TENANT_A,
  TestLcg,
  makeDatasetManifestFor,
  makeEvidenceArtifact,
  makeEvidencedSubjectFor,
  makeOfferCandidate,
  seedMarketplaceFabric,
} from './test-support.js';

const artifactPool = async (count: number) => {
  const out: { namespace: string; name: string; version: string; digest: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const artifact = await makeEvidenceArtifact(500 + i, {
      namespace: TENANT_A,
      name: `property-artifact-${String(i).padStart(3, '0')}`,
    });
    const manifest = await makeDatasetManifestFor(artifact);
    out.push({
      namespace: manifest.identity.namespace,
      name: manifest.identity.name,
      version: manifest.identity.version,
      digest: manifest.digest,
    });
  }
  return out;
};

describe('property: content addressing (seeded LCG)', () => {
  it('distinct candidates produce distinct digests; identical candidates replay identically', async () => {
    const lcg = new TestLcg(0x5eed032);
    const refs = await artifactPool(24);
    const digests = new Set<string>();
    for (let i = 0; i < 24; i += 1) {
      const ref = lcg.pick(refs);
      const record = await createMarketplaceOfferRecord({
        ...makeOfferCandidate({
          offerId: `property-offer-${String(i).padStart(3, '0')}`,
          artifactKind: 'dataset',
          artifact: ref,
          title: `Property offer ${String(i).padStart(3, '0')}`,
        }),
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
      });
      digests.add(record.digest);
      const replay = await createMarketplaceOfferRecord({
        ...makeOfferCandidate({
          offerId: `property-offer-${String(i).padStart(3, '0')}`,
          artifactKind: 'dataset',
          artifact: ref,
          title: `Property offer ${String(i).padStart(3, '0')}`,
        }),
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
      });
      expect(replay.digest).toBe(record.digest);
    }
    expect(digests.size).toBe(24);
  });

  it('every record is deeply frozen (no mutation surface)', async () => {
    const refs = await artifactPool(3);
    const record = await createMarketplaceOfferRecord({
      ...makeOfferCandidate({ offerId: 'frozen-offer', artifactKind: 'dataset', artifact: refs[0] as never }),
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
    expect(() => {
      (record as unknown as Record<string, unknown>)['title'] = 'mutated';
    }).toThrowError();
  });
});

describe('property: gate verdicts stay in the closed vocabulary', () => {
  it('randomized evidence mixes never emit out-of-vocabulary reasons', async () => {
    const lcg = new TestLcg(0xa032a032);
    const refs = await artifactPool(4);
    const fixtures: Awaited<ReturnType<typeof makeEvidencedSubjectFor>>[] = [];
    for (const ref of refs) {
      fixtures.push(await makeEvidencedSubjectFor(ref));
    }
    const reasonStrings = MARKETPLACE_GATE_REJECTION_REASONS as readonly string[];
    for (let i = 0; i < 12; i += 1) {
      const subject = lcg.pick(refs);
      const citations = [];
      const count = lcg.next() % 3;
      for (let j = 0; j < count; j += 1) {
        citations.push({
          kind: lcg.next() % 2 === 0 ? ('provenance' as const) : ('verification' as const),
          digest: lcg.next() % 2 === 0 ? (lcg.pick(fixtures) as { provenanceDigest: string }).provenanceDigest : 'e'.repeat(64),
        });
      }
      const verdict = await evaluateListingGate(subject as never, citations, {
        provenance: (digest) =>
          fixtures.find((f) => f.provenanceDigest === digest)?.provenanceRecord ?? null,
        verification: (digest) =>
          fixtures.find((f) => f.verification.record.digest === digest)?.verification.record ?? null,
      });
      expect(verdict.admitted).toBe(verdict.rejections.length === 0);
      for (const rejection of verdict.rejections) {
        expect(reasonStrings).toContain(rejection.reason);
      }
    }
  });
});

describe('property: query surface invariants', () => {
  it('search is deterministic and case-insensitive over the seeded corpus', async () => {
    const seeded = await seedMarketplaceFabric();
    const fabric = seeded.fabric;
    const lower = await fabric.handleQueryRequest(
      marketplaceQueryRequest('search-offers', { query: 'solder', artifactKind: 'all' }, toMarketplaceReadScope(TENANT_A)),
    );
    const upper = await fabric.handleQueryRequest(
      marketplaceQueryRequest('search-offers', { query: '  SOLDER ', artifactKind: 'all' }, toMarketplaceReadScope(TENANT_A)),
    );
    expect(JSON.stringify(upper.result)).toBe(JSON.stringify(lower.result));
  });

  it('average rating stays in the closed rating bounds', () => {
    const lcg = new TestLcg(0x7a7a7a);
    for (let i = 0; i < 8; i += 1) {
      const reviews = Array.from({ length: 1 + (lcg.next() % 5) }, () => ({
        rating: MARKETPLACE_REVIEW_RATINGS[lcg.next() % 5] as number,
      })) as never[];
      const average = averageRatingOf(reviews);
      if (average !== null) {
        expect(average).toBeGreaterThanOrEqual(1);
        expect(average).toBeLessThanOrEqual(5);
      }
    }
    expect(averageRatingOf([])).toBeNull();
  });

  it('query dispatch over all kinds is total (closed switch)', async () => {
    const seeded = await seedMarketplaceFabric();
    const service = createMarketplaceArtifactsService({ fabric: seeded.fabric });
    const paramsByKind: Record<string, unknown> = {
      'list-offers': { artifactKind: 'all' },
      'get-offer': { offerId: seeded.datasetOfferId },
      'resolve-offer-status': { offerId: seeded.datasetOfferId },
      'search-offers': { query: 'solder', artifactKind: 'all' },
      'list-reviews': { offerId: seeded.datasetOfferId },
      'get-grant': { grantId: seeded.grantBId },
      'list-grants': { tenant: TENANT_A },
    };
    for (const kind of MARKETPLACE_QUERY_KINDS) {
      const request = service.makeQuery(kind, paramsByKind[kind] as never, TENANT_A, `corr-prop-${kind}`);
      const outcome = await service.handleQueryRequest(
        (await import('@arena/protocol-core')).serializeEnvelope(request),
      );
      expect(outcome.response.payload.kind).toBe(kind);
      expect(outcome.response.correlationId).toBe(`corr-prop-${kind}`);
    }
  });
});
