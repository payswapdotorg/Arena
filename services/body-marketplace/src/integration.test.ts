/**
 * The C014 integration path (Work Order C014): pretraining proposal →
 * A021 forge port → NEW immutable BodyVersion → A023 certification
 * candidate → A024 release registration → listing publication — over
 * the injected C008/C009/A021/A023/A024 ports on the reference fabric,
 * including the envelope-wired facade round trips.
 */

import { describe, expect, it } from 'vitest';

import { createBodyMarketplaceService } from './service.js';
import { createBodyMarketplaceFabric } from './fabric.js';
import {
  makeBodyMarketplaceQueryRequest,
  makeCreateListingCommand,
  makeGrantListingAccessCommand,
  makeListingTransitionCommand,
  makeRequestPretrainingCommand,
  parseBodyMarketplaceQueryResponseFor,
} from './envelopes.js';
import {
  makeAcceptedEvidence,
  makeCandidate,
  makeComposition,
  makeCandidatePort,
  makeEvidencePort,
  makePretrainingRequest,
  EVIDENCE_DIGEST,
  CANDIDATE_ID,
  TENANT,
  T0,
  T1,
  T2,
} from './test-support.js';

describe('pretraining → forge → new version → listing publication (integration)', () => {
  it('walks the full learning-loop path over the injected ports', async () => {
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-int-0001',
      idempotencyKey: 'idem-int-0001',
      correlationId: 'corr-int-0001',
    });
    expect(run.outcome).toBe('proposed');
    expect(run.bodyVersionRef).not.toBeNull();
    expect(run.bodyVersionRef?.version).toBe('1.1.0');
    expect(run.forgeRecordDigest).not.toBeNull();
    expect(run.certificationRefs.length).toBe(1);
    expect(run.releaseDigest).not.toBeNull();
    expect(run.validatedEvidenceRefs).toEqual([EVIDENCE_DIGEST]);
    expect(run.candidateRefs).toEqual([CANDIDATE_ID]);

    // The forge record carries the end-to-end intervention provenance.
    const forgeRecord = await fabric.forge.getRecord(run.forgeRecordDigest as string);
    expect(forgeRecord).toBeDefined();
    expect(JSON.parse((forgeRecord?.provenance.notes ?? 'null') as string)).toMatchObject({
      pretrainingRunId: 'run-int-0001',
      validatedEvidenceRefs: [EVIDENCE_DIGEST],
    });

    // Listing over the release → publication.
    const listing = await fabric.createListing({
      listingId: 'listing-int-0001',
      tenantId: TENANT,
      releaseDigest: run.releaseDigest as string,
      title: 'Ledger Reconciler (pretrained)',
      summary: 'Pretrained on validated cross-currency reconciliation interventions',
      capabilityEvidenceRefs: [EVIDENCE_DIGEST],
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
      idempotencyKey: 'idem-int-listing-0001',
      correlationId: 'corr-int-listing-0001',
    });
    const published = await fabric.transitionListing({
      listingId: listing.listingId,
      tenantId: TENANT,
      to: 'published',
      reason: 'marketplace launch',
      actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
      at: T2,
      releasePublication: {
        publisher: { type: 'service', tenant: TENANT, principalId: 'arena-body-marketplace' },
        rights: listing.rights,
        publishedAt: T2,
      },
      idempotencyKey: 'idem-int-publish-0001',
      correlationId: 'corr-int-publish-0001',
    });
    expect(published.state).toBe('published');
    const badge = await fabric.certifiedBadge(listing.listingId, TENANT);
    expect(badge.grantedLevel).toBe('CANDIDATE');
  });

  it('round-trips the envelope-wired facade (command → event, query → response)', async () => {
    const service = createBodyMarketplaceService({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    const command = makeRequestPretrainingCommand(
      {
        runId: 'run-wire-0001',
        request: makePretrainingRequest(),
        composition: makeComposition() as unknown as Record<string, unknown>,
        baseBodyVersionRef: null,
        releaseChannel: 'candidate',
      },
      'corr-wire-0001',
      'idem-wire-0001',
    );
    const outcome = await service.handleRequestPretrainingCommand(JSON.stringify(command));
    expect((outcome.event as { kind: string }).kind).toBe('event');
    expect((outcome.event as { correlationId: string }).correlationId).toBe('corr-wire-0001');
    expect((outcome.result as { outcome: string }).outcome).toBe('proposed');

    const createListing = makeCreateListingCommand(
      {
        listingId: 'listing-wire-0001',
        tenantId: TENANT,
        releaseDigest: (outcome.result as { releaseDigest: string }).releaseDigest,
        title: 'Ledger Reconciler (pretrained)',
        summary: 'Pretrained on validated interventions',
        capabilityEvidenceRefs: [EVIDENCE_DIGEST],
        pretrainingRunId: 'run-wire-0001',
        rights: null,
        substrateCompatibility: null,
        pricing: null,
        createdBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
        createdAt: T1,
      },
      'corr-wire-0002',
      'idem-wire-0002',
    );
    const listingOutcome = await service.handleCreateListingCommand(JSON.stringify(createListing));
    expect((listingOutcome.result as { state: string }).state).toBe('draft');

    const publish = makeListingTransitionCommand(
      {
        listingId: 'listing-wire-0001',
        tenantId: TENANT,
        to: 'published',
        reason: 'marketplace launch',
        actor: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
        at: T2,
        releasePublication: {
          publisher: { type: 'service', tenant: TENANT, principalId: 'arena-body-marketplace' },
          rights: {
            license: 'Proprietary',
            commercialUse: 'requires-license',
            redistribution: 'tenant-only',
            customerData: 'derived',
            professionalLimitations: ['not a licensed accounting system'],
          },
          publishedAt: T2,
        },
      },
      'corr-wire-0003',
      'idem-wire-0003',
    );
    const publishOutcome = await service.handleListingTransitionCommand(JSON.stringify(publish));
    expect((publishOutcome.result as { state: string }).state).toBe('published');

    const grant = makeGrantListingAccessCommand(
      {
        grantId: 'grant-wire-0001',
        listingId: 'listing-wire-0001',
        tenantId: TENANT,
        grantee: { type: 'user', tenant: 'customer-beta', principalId: 'buyer-01' },
        permittedUse: 'possess',
        expiresAt: null,
        grantedBy: { type: 'user', tenant: TENANT, principalId: 'publisher-01' },
        grantedAt: T2,
      },
      'corr-wire-0004',
      'idem-wire-0004',
    );
    const grantOutcome = await service.handleGrantListingAccessCommand(JSON.stringify(grant));
    expect((grantOutcome.result as { state: string }).state).toBe('active');

    // Query round trip with the fail-closed pairing guard.
    const query = makeBodyMarketplaceQueryRequest(
      { kind: 'certified-badge', params: { listingId: 'listing-wire-0001' }, scope: { tenant: TENANT } },
      'corr-wire-0005',
    );
    const queryOutcome = await service.handleQueryRequest(JSON.stringify(query));
    const parsed = parseBodyMarketplaceQueryResponseFor(
      queryOutcome.serializedResponse,
      JSON.parse(JSON.stringify(query)),
    );
    expect((parsed.payload.result as { grantedLevel: string }).grantedLevel).toBe('CANDIDATE');

    // Blocked-run wire round trip (typed blocked event, nothing trained).
    const baseRequest = makePretrainingRequest();
    const blockedRequest: typeof baseRequest = {
      ...baseRequest,
      inputs: [
        { ...baseRequest.inputs[0]!, rights: { ...baseRequest.inputs[0]!.rights, trainingUse: 'forbidden' as const } },
        ...baseRequest.inputs.slice(1),
      ],
    };
    const blockedCommand = makeRequestPretrainingCommand(
      {
        runId: 'run-wire-0002',
        request: blockedRequest,
        composition: makeComposition() as unknown as Record<string, unknown>,
        baseBodyVersionRef: null,
        releaseChannel: 'candidate',
      },
      'corr-wire-0006',
      'idem-wire-0006',
    );
    const blockedOutcome = await service.handleRequestPretrainingCommand(
      JSON.stringify(blockedCommand),
    );
    expect((blockedOutcome.result as { outcome: string }).outcome).toBe('blocked');
    expect((blockedOutcome.event as { payload: { bodyVersionDigest: string | null } }).payload.bodyVersionDigest).toBeNull();
  });
});

describe('issued-at determinism sanity', () => {
  it('uses the fixture timestamps', () => {
    expect(T0 < T1 && T1 < T2).toBe(true);
    expect(EVIDENCE_DIGEST.length).toBe(64);
    expect(CANDIDATE_ID).toContain('body-improvement');
  });
});
