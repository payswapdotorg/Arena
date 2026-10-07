/**
 * The C014 adversarial minimum (Work Order C014): four fail-closed
 * guarantees —
 *
 *   1. an attempt to MUTATE an existing certified BodyVersion through a
 *      pretraining run must FAIL CLOSED (immutability; lock rule 5);
 *   2. a listing WITHOUT record-backed certification surfacing a
 *      certified badge must FAIL CLOSED;
 *   3. rights-free data entering a pretraining run must BLOCK (the
 *      forge is never even called);
 *   4. cross-tenant listing access must FAIL CLOSED.
 */

import { describe, expect, it } from 'vitest';

import { createBodyMarketplaceFabric } from './fabric.js';
import type { ForgePort, ForgeSubmission } from './ports.js';
import { BodyMarketplaceError, BODY_MARKETPLACE_ERROR_CODES, isBodyMarketplaceError } from './errors.js';
import {
  makeAcceptedEvidence,
  makeCandidate,
  makeComposition,
  makeCandidatePort,
  makeEvidencePort,
  makePretrainingRequest,
  TENANT,
  T1,
} from './test-support.js';

describe('adversarial: immutability of certified BodyVersions', () => {
  it('fail-closes a re-forge of an existing version identity with different content', async () => {
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    // First run forges acme/ledger-reconciler@1.1.0.
    await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0001',
      idempotencyKey: 'idem-adv-0001',
      correlationId: 'corr-adv-0001',
    });
    // The "mutation" attempt: the SAME body identity + SAME version
    // number, but a DIFFERENT composition (different skills) — an
    // attempt to silently mutate the existing (now certified-candidate)
    // version. Must FAIL CLOSED.
    const mutatedComposition: ReturnType<typeof makeComposition> = {
      ...makeComposition(),
      mission: 'Different mission — a silent mutation attempt',
    };
    const attempt = fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: mutatedComposition,
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0002',
      idempotencyKey: 'idem-adv-0002',
      correlationId: 'corr-adv-0002',
    });
    await expect(attempt).rejects.toSatisfy((error: unknown) => {
      if (!isBodyMarketplaceError(error)) return false;
      expect(error.code).toBe(BODY_MARKETPLACE_ERROR_CODES.FORGE_REJECTED);
      expect(error.message).toMatch(/immutable and content-addressed/);
      return true;
    });
  });
});

describe('adversarial: certification badges are record-backed only', () => {
  it('fail-closes the certified badge on a listing without record-backed certification', async () => {
    // A fabric whose certification store resolves NOTHING: the release
    // cites certification refs that no longer resolve (record-backed
    // posture is unverified) — a certified badge must fail closed.
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
      certificationStore: { resolve: async () => undefined },
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0003',
      idempotencyKey: 'idem-adv-0003',
      correlationId: 'corr-adv-0003',
    });
    const listing = await fabric.createListing({
      listingId: 'listing-adv-0001',
      tenantId: TENANT,
      releaseDigest: run.releaseDigest as string,
      title: 'Unbacked listing',
      summary: 'Its certification refs do not resolve',
      capabilityEvidenceRefs: ['a1111111111111111111111111111111111111111111111111111111111111111'],
      pretrainingRunId: run.runId,
      rights: null,
      substrateCompatibility: null,
      pricing: null,
      createdBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      createdAt: T1,
      idempotencyKey: 'idem-adv-listing-0001',
      correlationId: 'corr-adv-listing-0001',
    });
    const posture = await fabric.deriveCertificationPosture(listing);
    expect(posture.state).toBe('unverified');
    if (posture.state !== 'unverified') return;
    expect(posture.unresolved.length).toBeGreaterThan(0);
    await expect(fabric.certifiedBadge(listing.listingId, TENANT)).rejects.toSatisfy(
      (error: unknown) => {
        if (!isBodyMarketplaceError(error)) return false;
        expect(error.code).toBe(BODY_MARKETPLACE_ERROR_CODES.CERTIFICATION_NOT_RECORD_BACKED);
        return true;
      },
    );
    // And the publication guard refuses the unbacked listing too.
    const check = await fabric.checkListingPublication(listing);
    expect(check.allowed).toBe(false);
    expect(check.rejections.map((rejection) => rejection.reason)).toContain(
      'certification-not-record-backed',
    );
  });
});

describe('adversarial: rights-free data never trains', () => {
  it('BLOCKS the run without ever calling the forge port', async () => {
    let forgeSubmissions = 0;
    const countingForge: ForgePort = {
      submit: async (_submission: ForgeSubmission) => {
        forgeSubmissions += 1;
        throw new Error('the forge must never see rights-free data');
      },
      getRecord: async () => undefined,
    };
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
      forge: countingForge,
    });
    const baseRequest = makePretrainingRequest();
    const request: typeof baseRequest = {
      ...baseRequest,
      inputs: [
        { ...baseRequest.inputs[0]!, rights: { ...baseRequest.inputs[0]!.rights, trainingUse: 'forbidden' as const } }, // rights-free data
        ...baseRequest.inputs.slice(1),
      ],
    };
    const run = await fabric.requestPretraining({
      request,
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0004',
      idempotencyKey: 'idem-adv-0004',
      correlationId: 'corr-adv-0004',
    });
    expect(run.outcome).toBe('blocked');
    if (run.outcome !== 'blocked') return;
    expect(run.blockedReasons.map((reason) => reason.code)).toContain('rights-insufficient');
    expect(run.bodyVersionRef).toBeNull();
    expect(run.forgeRecordDigest).toBeNull();
    expect(forgeSubmissions).toBe(0);
  });
});

describe('adversarial: cross-tenant isolation', () => {
  it('fail-closes cross-tenant listing reads, badge reads and run reads', async () => {
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0005',
      idempotencyKey: 'idem-adv-0005',
      correlationId: 'corr-adv-0005',
    });
    const listing = await fabric.createListing({
      listingId: 'listing-adv-0002',
      tenantId: TENANT,
      releaseDigest: run.releaseDigest as string,
      title: 'Tenant-private listing',
      summary: 'Cross-tenant access must fail closed',
      capabilityEvidenceRefs: ['b2222222222222222222222222222222222222222222222222222222222222222'],
      pretrainingRunId: run.runId,
      rights: null,
      substrateCompatibility: null,
      pricing: null,
      createdBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      createdAt: T1,
      idempotencyKey: 'idem-adv-listing-0002',
      correlationId: 'corr-adv-listing-0002',
    });
    const attacker = 'rival-tenant';
    expect(() => fabric.getListing(listing.listingId, attacker)).toThrow(BodyMarketplaceError);
    await expect(fabric.certifiedBadge(listing.listingId, attacker)).rejects.toSatisfy(
      (error: unknown) =>
        isBodyMarketplaceError(error) && error.code === BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED,
    );
    expect(() => fabric.getPretrainingRun(run.runId, attacker)).toThrow(BodyMarketplaceError);
    // The attacker's browse does not leak the tenant-private listing.
    expect(fabric.listListings(attacker)).toEqual([]);
  });

  it('fail-closes listing creation over another tenant\'s release', async () => {
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-adv-0006',
      idempotencyKey: 'idem-adv-0006',
      correlationId: 'corr-adv-0006',
    });
    await expect(
      fabric.createListing({
        listingId: 'listing-adv-0003',
        tenantId: 'rival-tenant',
        releaseDigest: run.releaseDigest as string,
        title: 'Stolen release',
        summary: 'Another tenant cannot list a release it does not own',
        capabilityEvidenceRefs: ['c3333333333333333333333333333333333333333333333333333333333333333'],
        pretrainingRunId: null,
        rights: null,
        substrateCompatibility: null,
        pricing: null,
        createdBy: { type: 'user', tenant: 'rival-tenant', principalId: 'thief-01' },
        createdAt: T1,
        idempotencyKey: 'idem-adv-listing-0003',
        correlationId: 'corr-adv-listing-0003',
      }),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isBodyMarketplaceError(error) && error.code === BODY_MARKETPLACE_ERROR_CODES.TENANT_ACCESS_DENIED,
    );
  });
});
