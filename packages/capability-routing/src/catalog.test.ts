/**
 * Catalog candidate view tests (Work Order C015): strict typed
 * constructors, deep freeze, structural guards.
 */

import { describe, expect, it } from 'vitest';
import {
  RESOURCE_CANDIDATE_VERSION,
  createArtifactCandidate,
  createBodyCandidate,
  createExpertCandidate,
  createKnowledgeCandidate,
  createToolCandidate,
  isResourceCandidate,
} from './catalog.js';
import { CapabilityRoutingError } from './errors.js';
import {
  FIXTURE_EVIDENCE_DIGEST,
  FIXTURE_PROVENANCE_DIGEST,
  fixtureBodyCandidateInput,
  fixtureRoutingCandidate,
} from './test-support.js';

describe('catalog candidate constructors', () => {
  it('creates and freezes a body candidate view', () => {
    const candidate = createBodyCandidate(fixtureBodyCandidateInput());
    expect(candidate.candidateVersion).toBe(RESOURCE_CANDIDATE_VERSION);
    expect(candidate.resourceClass).toBe('body');
    expect(candidate.state).toBe('published');
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.capabilityEvidenceRefs)).toBe(true);
    expect(isResourceCandidate(candidate)).toBe(true);
  });

  it('creates and freezes a tool candidate view', () => {
    const candidate = createToolCandidate({
      toolId: 'local-rate-database',
      tenantId: 'tenant-a',
      operations: ['rate-lookup'],
    });
    expect(candidate.resourceClass).toBe('tool');
    expect(candidate.availability).toBe('available');
    expect(candidate.sourceToolGapSignalId).toBeNull();
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(isResourceCandidate(candidate)).toBe(true);
  });

  it('creates and freezes a knowledge candidate view', () => {
    const candidate = createKnowledgeCandidate({
      recordId: 'knowledge-boq-rules',
      tenantId: 'tenant-a',
      tier: 'verified-domain-constraint',
      scopeKind: 'jurisdiction',
      validationState: 'validated',
      rightsPresent: true,
      evidenceRefs: [FIXTURE_EVIDENCE_DIGEST],
    });
    expect(candidate.resourceClass).toBe('knowledge');
    expect(candidate.tier).toBe('verified-domain-constraint');
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(isResourceCandidate(candidate)).toBe(true);
  });

  it('creates and freezes an artifact candidate view', () => {
    const candidate = createArtifactCandidate({
      offerId: 'offer-rates-dataset',
      tenantId: 'tenant-a',
      artifactKind: 'dataset',
    });
    expect(candidate.resourceClass).toBe('artifact');
    expect(candidate.state).toBe('registered');
    expect(candidate.visibility).toBe('public');
    expect(candidate.entitlementState).toBe('none');
    expect(candidate.price).toBeNull();
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(isResourceCandidate(candidate)).toBe(true);
  });

  it('creates an expert candidate view over a C002 RoutingCandidate', () => {
    const candidate = createExpertCandidate({
      candidate: fixtureRoutingCandidate(),
      performanceProfileDigest: FIXTURE_PROVENANCE_DIGEST,
    });
    expect(candidate.resourceClass).toBe('expert');
    expect(candidate.candidate.expertId).toBe('expert-001');
    expect(candidate.performanceProfileDigest).toBe(FIXTURE_PROVENANCE_DIGEST);
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(isResourceCandidate(candidate)).toBe(true);
  });

  it('rejects structurally invalid inputs with typed errors', () => {
    expect(() =>
      createBodyCandidate(fixtureBodyCandidateInput({ listingId: 'BAD ID' })),
    ).toThrowError(CapabilityRoutingError);
    expect(() =>
      createBodyCandidate(fixtureBodyCandidateInput({ state: 'live' })),
    ).toThrowError(/state is invalid/);
    expect(() =>
      createBodyCandidate(fixtureBodyCandidateInput({ pricing: { amountMinorUnits: -5, currency: 'USD' } })),
    ).toThrowError(/pricing is invalid/);
    expect(() =>
      createBodyCandidate(
        fixtureBodyCandidateInput({ bodyVersionRef: { name: 'x', version: 'not-semver', digest: 'z' } }),
      ),
    ).toThrowError(/bodyVersionRef/);
    expect(() => createToolCandidate({ toolId: 'BAD', tenantId: 'tenant-a' })).toThrowError(
      /toolId is invalid/,
    );
    expect(() =>
      createToolCandidate({ toolId: 'ok-tool', tenantId: 'tenant-a', availability: 'maybe' }),
    ).toThrowError(/availability is invalid/);
    expect(() =>
      createKnowledgeCandidate({ recordId: 'r1', tenantId: 'tenant-a', tier: 'nope', scopeKind: 'task' }),
    ).toThrowError(/tier is invalid/);
    expect(() =>
      createKnowledgeCandidate({
        recordId: 'r1',
        tenantId: 'tenant-a',
        tier: 'scoped-reusable-knowledge',
        scopeKind: 'galaxy',
      }),
    ).toThrowError(/scopeKind is invalid/);
    expect(() =>
      createArtifactCandidate({ offerId: 'BAD', tenantId: 'tenant-a', artifactKind: 'dataset' }),
    ).toThrowError(/offerId is invalid/);
    expect(() =>
      createArtifactCandidate({ offerId: 'o1', tenantId: 'tenant-a', artifactKind: 'model' }),
    ).toThrowError(/artifactKind is invalid/);
    expect(() =>
      createArtifactCandidate({
        offerId: 'o1',
        tenantId: 'tenant-a',
        artifactKind: 'dataset',
        entitlementState: 'pending',
      }),
    ).toThrowError(/entitlementState is invalid/);
    expect(() =>
      createExpertCandidate({ candidate: {} as never }),
    ).toThrowError(/RoutingCandidate/);
    expect(() =>
      createExpertCandidate({
        candidate: fixtureRoutingCandidate(),
        performanceProfileDigest: 'not-a-digest',
      }),
    ).toThrowError(/performanceProfileDigest/);
    expect(isResourceCandidate({ candidateVersion: 1 })).toBe(false);
    expect(isResourceCandidate(null)).toBe(false);
  });
});
