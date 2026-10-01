import { describe, expect, it } from 'vitest';
import { ArtifactError } from '@arena/artifact-protocol';
import {
  MARKETPLACE_ERROR_CODES,
  MarketplaceError,
} from './errors.js';
import {
  MARKETPLACE_ARTIFACT_KINDS,
  MARKETPLACE_OFFER_KINDS,
  MARKETPLACE_VISIBILITIES,
  createMarketplaceOfferRecord,
  isMarketplaceOffer,
  offerSummaryOf,
  verifyMarketplaceOffer,
} from './offers.js';
import {
  CORR_A,
  IDEM_A,
  PUBLISHER_A,
  RIGHTS_OPEN,
  RIGHTS_TENANT_ONLY,
  T1,
  T2,
  makeEvidenceArtifact,
  makeOfferCandidate,
} from './test-support.js';

describe('offer records: positive construction', () => {
  it('creates a content-addressed registration record', async () => {
    const artifact = await makeEvidenceArtifact(1);
    const record = await createMarketplaceOfferRecord({
      kind: 'offer-registration',
      offerId: 'solder-defect-dataset',
      artifactKind: 'dataset',
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
      title: 'Solder joint defect dataset',
      summary: 'Labeled solder joint inspection imagery for evaluation suites.',
      publisher: PUBLISHER_A,
      rights: RIGHTS_OPEN,
      visibility: 'public',
      offeredAt: T1,
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
      provenance: { offeredBy: 'publisher-a-001', recordedAt: T1, notes: null },
    });
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.kind).toBe('offer-registration');
    expect(record.supersedes).toBeNull();
    expect(record.retires).toBeNull();
    expect(record.grounds).toBeNull();
    expect(Object.isFrozen(record)).toBe(true);
    expect(isMarketplaceOffer(record)).toBe(true);
  });

  it('is deterministic for identical content and digests differ for different content', async () => {
    const artifact = await makeEvidenceArtifact(2);
    const base = {
      kind: 'offer-registration' as const,
      offerId: 'deterministic-offer',
      artifactKind: 'dataset' as const,
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
      title: 'Title',
      summary: 'Summary',
      publisher: PUBLISHER_A,
      rights: RIGHTS_OPEN,
      visibility: 'public' as const,
      offeredAt: T1,
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
      provenance: { offeredBy: 'publisher-a-001', recordedAt: T1, notes: null },
    };
    const first = await createMarketplaceOfferRecord(base);
    const second = await createMarketplaceOfferRecord(base);
    const third = await createMarketplaceOfferRecord({
      ...base,
      title: 'A different title',
    });
    expect(first.digest).toBe(second.digest);
    expect(third.digest).not.toBe(first.digest);
  });

  it('supersession carries supersedes + grounds; retirement carries retires + grounds', async () => {
    const artifact = await makeEvidenceArtifact(3);
    const supersession = await createMarketplaceOfferRecord({
      kind: 'offer-supersession',
      offerId: 'versioned-offer',
      artifactKind: 'dataset',
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
      title: 'v2 listing',
      summary: 'Second version.',
      publisher: PUBLISHER_A,
      rights: RIGHTS_OPEN,
      visibility: 'tenant-internal',
      offeredAt: T2,
      supersedes: 'a'.repeat(64),
      grounds: 'refreshed artifact version',
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
      provenance: { offeredBy: 'publisher-a-001', recordedAt: T2, notes: null },
    });
    expect(supersession.supersedes).toBe('a'.repeat(64));
    expect(supersession.grounds).toBe('refreshed artifact version');

    const retirement = await createMarketplaceOfferRecord({
      kind: 'offer-retirement',
      offerId: 'versioned-offer',
      artifactKind: 'dataset',
      retires: 'b'.repeat(64),
      grounds: 'the dataset is deprecated',
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
      provenance: { offeredBy: 'publisher-a-001', recordedAt: T2, notes: null },
    });
    expect(retirement.retires).toBe('b'.repeat(64));
    expect(retirement.artifact).toBeNull();
    expect(retirement.title).toBeNull();
  });
});

describe('offer records: forbidden-field discipline (fail closed)', () => {
  const artifactRef = async () => {
    const artifact = await makeEvidenceArtifact(4);
    return {
      namespace: artifact.identity.namespace,
      name: artifact.identity.name,
      version: artifact.identity.version,
      digest: artifact.digest,
    };
  };

  it('registration with supersedes is rejected', async () => {
    const candidate = makeOfferCandidate({
      offerId: 'bad-registration',
      artifactKind: 'dataset',
      artifact: await artifactRef(),
      supersedes: 'a'.repeat(64),
    });
    await expect(
      createMarketplaceOfferRecord({ ...candidate, correlationId: CORR_A, idempotencyKey: IDEM_A }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('registration with grounds is rejected', async () => {
    const candidate = makeOfferCandidate({
      offerId: 'bad-registration-grounds',
      artifactKind: 'dataset',
      artifact: await artifactRef(),
      grounds: 'no grounds on registration',
    });
    await expect(
      createMarketplaceOfferRecord({ ...candidate, correlationId: CORR_A, idempotencyKey: IDEM_A }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('supersession without grounds is rejected', async () => {
    const candidate = makeOfferCandidate({
      kind: 'offer-supersession',
      offerId: 'bad-supersession',
      artifactKind: 'dataset',
      artifact: await artifactRef(),
      supersedes: 'a'.repeat(64),
      grounds: null,
    });
    await expect(
      createMarketplaceOfferRecord({ ...candidate, correlationId: CORR_A, idempotencyKey: IDEM_A }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('retirement with content is rejected', async () => {
    await expect(
      createMarketplaceOfferRecord({
        kind: 'offer-retirement',
        offerId: 'bad-retirement',
        artifactKind: 'dataset',
        artifact: await artifactRef(),
        title: 'should not be here',
        retires: 'b'.repeat(64),
        grounds: 'retiring',
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
        provenance: { offeredBy: 'publisher-a-001', recordedAt: T2, notes: null },
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('retirement without grounds is rejected', async () => {
    await expect(
      createMarketplaceOfferRecord({
        kind: 'offer-retirement',
        offerId: 'bad-retirement-2',
        artifactKind: 'dataset',
        retires: 'b'.repeat(64),
        grounds: '',
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
        provenance: { offeredBy: 'publisher-a-001', recordedAt: T2, notes: null },
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('missing rights are rejected (architecture-lock rule 23)', async () => {
    const candidate = makeOfferCandidate({
      offerId: 'no-rights',
      artifactKind: 'dataset',
      artifact: await artifactRef(),
      rights: null,
    });
    await expect(
      createMarketplaceOfferRecord({
        ...candidate,
        rights: null,
        correlationId: CORR_A,
        idempotencyKey: IDEM_A,
      }),
    ).rejects.toThrowError(MarketplaceError);
  });

  it('invalid rights vocabulary is rejected by the reused A002 guard', async () => {
    const candidate = makeOfferCandidate({
      offerId: 'bad-rights',
      artifactKind: 'dataset',
      artifact: await artifactRef(),
      rights: { license: 'CC-BY-4.0', commercialUse: 'sometimes', redistribution: 'allowed', customerData: 'none' },
    });
    await expect(
      createMarketplaceOfferRecord({ ...candidate, correlationId: CORR_A, idempotencyKey: IDEM_A }),
    ).rejects.toThrowError(ArtifactError);
  });

  it('unknown artifact kind / visibility / offerId shape are rejected', async () => {
    const ref = await artifactRef();
    await expect(
      createMarketplaceOfferRecord(
        makeOfferCandidate({
          offerId: 'bad-id-offer',
          artifactKind: 'dataset',
          artifact: ref,
        }) as never,
      ),
    ).rejects.toThrowError();
    await expect(
      createMarketplaceOfferRecord(
        makeOfferCandidate({
          offerId: 'Bad_ID',
          artifactKind: 'model',
          artifact: ref,
          visibility: 'secret',
        } as never) as never,
      ),
    ).rejects.toThrowError();
  });
});

describe('offer records: verification + summaries', () => {
  it('verifyMarketplaceOffer passes and detects tampering', async () => {
    const artifact = await makeEvidenceArtifact(5);
    const candidate = makeOfferCandidate({
      offerId: 'tamper-check',
      artifactKind: 'dataset',
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
    });
    const record = await createMarketplaceOfferRecord({
      ...candidate,
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
    });
    await expect(verifyMarketplaceOffer(record)).resolves.toBe(record.digest);
    await expect(verifyMarketplaceOffer(record, record.digest)).resolves.toBe(record.digest);
    try {
      await verifyMarketplaceOffer(record, 'c'.repeat(64));
      expect.unreachable();
    } catch (error) {
      expect(error instanceof MarketplaceError).toBe(true);
      expect((error as MarketplaceError).code).toBe(MARKETPLACE_ERROR_CODES.TAMPERED);
    }
    const tampered = { ...record, title: 'mutated' } as typeof record;
    await expect(verifyMarketplaceOffer(tampered)).rejects.toThrowError(MarketplaceError);
  });

  it('offerSummaryOf projects content-bearing records only', async () => {
    const artifact = await makeEvidenceArtifact(6);
    const candidate = makeOfferCandidate({
      offerId: 'summary-check',
      artifactKind: 'dataset',
      artifact: {
        namespace: artifact.identity.namespace,
        name: artifact.identity.name,
        version: artifact.identity.version,
        digest: artifact.digest,
      },
      rights: RIGHTS_TENANT_ONLY,
      visibility: 'tenant-internal',
    });
    const record = await createMarketplaceOfferRecord({
      ...candidate,
      correlationId: CORR_A,
      idempotencyKey: IDEM_A,
    });
    const summary = offerSummaryOf(record);
    expect(summary.offerId).toBe('summary-check');
    expect(summary.visibility).toBe('tenant-internal');
    expect(Object.isFrozen(summary)).toBe(true);
  });

  it('closed vocabularies are frozen and complete', () => {
    expect(Object.isFrozen(MARKETPLACE_OFFER_KINDS)).toBe(true);
    expect(Object.isFrozen(MARKETPLACE_ARTIFACT_KINDS)).toBe(true);
    expect(Object.isFrozen(MARKETPLACE_VISIBILITIES)).toBe(true);
    expect([...MARKETPLACE_ARTIFACT_KINDS]).toEqual(['dataset', 'evaluation-suite', 'environment']);
  });
});
