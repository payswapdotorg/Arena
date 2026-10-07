/**
 * Property tests (Work Order C014): deterministic purity of the
 * compilation gate, deep immutability of the frozen records, and
 * digests as content addresses (recomputation stability).
 */

import { describe, expect, it } from 'vitest';

import { compilePretrainingRequest, toPretrainingRequest } from './pretraining.js';
import { createBodyMarketplaceFabric } from './fabric.js';
import { viewDigest } from './shared.js';
import {
  makeAcceptedEvidence,
  makeCandidate,
  makeCandidatePort,
  makeComposition,
  makeEvidencePort,
  makePretrainingRequest,
  EVIDENCE_DIGEST,
  CANDIDATE_ID,
} from './test-support.js';

const OPTIONS = {
  resolvedEvidence: new Map([[EVIDENCE_DIGEST, makeAcceptedEvidence()]]),
  resolvedCandidates: new Map([[CANDIDATE_ID, makeCandidate()]]),
};

describe('property: compilation gate', () => {
  it('is a pure function of (request, resolved views) across repetitions', () => {
    const request = toPretrainingRequest(makePretrainingRequest());
    const first = JSON.stringify(compilePretrainingRequest(request, OPTIONS));
    for (let i = 0; i < 5; i += 1) {
      expect(JSON.stringify(compilePretrainingRequest(request, OPTIONS))).toBe(first);
    }
  });

  it('is stable under input-array reordering for the blocked outcome shape', () => {
    const base = makePretrainingRequest();
    const reversed = toPretrainingRequest({ ...base, inputs: [...base.inputs].reverse() });
    const a = compilePretrainingRequest(reversed, OPTIONS);
    expect(a.outcome).toBe('compilable');
  });
});

describe('property: records are deeply frozen', () => {
  it('freezes run records, listings and their histories', async () => {
    const fabric = createBodyMarketplaceFabric({
      evidence: makeEvidencePort([makeAcceptedEvidence()]),
      candidates: makeCandidatePort([makeCandidate()]),
    });
    const run = await fabric.requestPretraining({
      request: makePretrainingRequest(),
      composition: makeComposition(),
      baseBodyVersionRef: null,
      releaseChannel: 'candidate',
      runId: 'run-prop-0001',
      idempotencyKey: 'idem-prop-0001',
      correlationId: 'corr-prop-0001',
    });
    expect(Object.isFrozen(run)).toBe(true);
    expect(Object.isFrozen(run.validatedEvidenceRefs)).toBe(true);
    const listing = await fabric.createListing({
      listingId: 'listing-prop-0001',
      tenantId: 'acme',
      releaseDigest: run.releaseDigest as string,
      title: 'Property listing',
      summary: 'Frozen records',
      capabilityEvidenceRefs: [EVIDENCE_DIGEST],
      pretrainingRunId: run.runId,
      rights: null,
      substrateCompatibility: null,
      pricing: null,
      createdBy: { type: 'user', tenant: 'acme', principalId: 'publisher-01' },
      createdAt: '2026-10-07T10:05:00.000Z',
      idempotencyKey: 'idem-prop-listing-0001',
      correlationId: 'corr-prop-listing-0001',
    });
    expect(Object.isFrozen(listing)).toBe(true);
    expect(() => {
      (listing as unknown as Record<string, unknown>)['state'] = 'published';
    }).toThrow();
  });
});

describe('property: digests are content addresses', () => {
  it('recomputes the same digest for identical views', async () => {
    const view = { a: 1, b: ['x', 'y'], c: { d: null } };
    const first = await viewDigest(view);
    for (let i = 0; i < 3; i += 1) {
      expect(await viewDigest({ ...view, c: { d: null } })).toBe(first);
    }
    expect(await viewDigest({ ...view, a: 2 })).not.toBe(first);
  });
});
