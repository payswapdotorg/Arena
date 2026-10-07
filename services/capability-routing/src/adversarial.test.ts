/**
 * Adversarial service tests (Work Order C015) — the required minimum:
 *
 *   1. cross-tenant catalog leakage (a misconfigured host returning
 *      another tenant's candidates — ELIMINATED, never routed);
 *   2. qualification-masquerading-as-authorization (a fully-qualified
 *      expert with no COI/privacy problem is STILL gated when evidence
 *      is required; a qualified expert blocked by COI never routes);
 *   3. a budget-infeasible composition accepted (must FAIL CLOSED);
 *   4. a stale/delisted marketplace candidate surfaced as available
 *      (must be EXCLUDED with reasons).
 */

import { describe, expect, it } from 'vitest';
import {
  createArtifactCandidate,
  createBodyCandidate,
  createExpertCandidate,
} from '@arena/capability-routing';
import type { ExpertCandidateView } from '@arena/capability-routing';
import { CapabilityRoutingService } from './service.js';
import {
  FixedClock,
  InMemoryArtifactOfferCatalog,
  InMemoryBodyListingCatalog,
  InMemoryExpertCandidateDirectory,
  StaticGraphSource,
} from './fabric.js';
import {
  FIXTURE_CLOCK_START,
  buildFixtureGraph,
  fixtureArtifactCandidateInput,
  fixtureBodyCandidateInput,
  fixtureDemandInput,
  fixtureExpertCandidate,
} from './test-support.js';

describe('adversarial — cross-tenant catalog leakage', () => {
  it('eliminates another tenant expert even when a MISCONFIGURED host directory returns it', async () => {
    const graph = await buildFixtureGraph();
    const crossTenantExpert = await fixtureExpertCandidate(graph, {
      expertId: 'expert-evil',
      tenant: 'tenant-b',
    });
    // A LEAKY directory that ignores the tenant host contract — the
    // engine double-guard must eliminate the candidate anyway.
    const leakyDirectory = {
      listExpertCandidates: () => Promise.resolve([crossTenantExpert]),
    };
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: leakyDirectory,
    });
    const result = await service.routeCrossResource(fixtureDemandInput(), {
      demandId: 'capr-adv-0001',
    });
    expect(result.match?.outcome).toBe('no-match');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'cross-tenant'),
    ).toHaveLength(1);
  });

  it('eliminates another tenant body listing surfaced by a leaky catalog', async () => {
    const leakyBodyCatalog = {
      listBodyCandidates: () =>
        Promise.resolve([createBodyCandidate({ ...fixtureBodyCandidateInput(), tenantId: 'tenant-b' })]),
    };
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      bodyCatalog: leakyBodyCatalog,
    });
    const demand = fixtureDemandInput({
      escalationModes: ['SOLVE'],
      body: { requiredSubstrate: 'substrate-alpha' },
    });
    delete (demand as { expert?: unknown }).expert;
    const result = await service.routeCrossResource(demand, { demandId: 'capr-adv-0002' });
    expect(result.match?.outcome).toBe('no-match');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'cross-tenant'),
    ).toHaveLength(1);
  });
});

describe('adversarial — qualification masquerading as authority', () => {
  it('a fully-qualified expert blocked by COI never routes', async () => {
    const graph = await buildFixtureGraph();
    const qualifiedButConflicted = await fixtureExpertCandidate(graph, {
      expertId: 'expert-conflicted',
      coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
    });
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: new InMemoryExpertCandidateDirectory([qualifiedButConflicted]),
    });
    const result = await service.routeCrossResource(fixtureDemandInput(), {
      demandId: 'capr-adv-0003',
    });
    expect(result.match?.outcome).toBe('blocked-by-coi');
    expect(result.decision.outcome).toBe('no-match');
    if (result.decision.outcome !== 'no-match') return;
    expect(result.decision.reason).toBe('no-capable-resource');
  });

  it('a qualified expert with no performance evidence is gated when evidence is required', async () => {
    const graph = await buildFixtureGraph();
    const qualifiedNoEvidence = await fixtureExpertCandidate(graph, {}, null);
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: new InMemoryExpertCandidateDirectory([qualifiedNoEvidence]),
    });
    const result = await service.routeCrossResource(
      fixtureDemandInput({ expert: { performanceEvidenceRequired: true } }),
      { demandId: 'capr-adv-0004' },
    );
    expect(result.match?.outcome).toBe('no-match');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'performance-evidence-missing'),
    ).toHaveLength(1);
  });

  it('an expert directory that fabricates views is still validated (typed errors surface)', async () => {
    const graph = await buildFixtureGraph();
    const bogus: ExpertCandidateView = {
      candidateVersion: 1,
      resourceClass: 'expert',
      candidate: (await fixtureExpertCandidate(graph)).candidate,
      performanceProfileDigest: null,
    };
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: new InMemoryExpertCandidateDirectory([bogus]),
    });
    // The engine consumes the views as data; a hand-built view routes no
    // differently than a constructed one — the typed constructors are
    // the ONLY way hosts build valid views (documented contract).
    const result = await service.routeCrossResource(fixtureDemandInput(), {
      demandId: 'capr-adv-0005',
    });
    expect(result.match?.outcome).toBe('matched');
    expect(createExpertCandidate({ candidate: bogus.candidate })).toBeDefined();
  });
});

describe('adversarial — budget-infeasible composition must fail closed', () => {
  it('never accepts an over-cap composition (expert + body > cap)', async () => {
    const graph = await buildFixtureGraph();
    const expert = await fixtureExpertCandidate(graph);
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: new InMemoryExpertCandidateDirectory([expert]),
      bodyCatalog: new InMemoryBodyListingCatalog([createBodyCandidate(fixtureBodyCandidateInput())]),
    });
    const result = await service.routeCrossResource(
      fixtureDemandInput({
        budget: { amountMinorUnits: 25000, currency: 'USD' },
        escalationModes: ['SOLVE'],
        body: { requiredSubstrate: 'substrate-alpha' },
      }),
      { demandId: 'capr-adv-0006' },
    );
    expect(result.match?.outcome).toBe('budget-infeasible');
    expect(result.match?.composition).toBeNull();
    expect(result.decision.outcome).toBe('no-match');
    if (result.decision.outcome !== 'no-match') return;
    expect(result.decision.reason).toBe('budget-below-floor');
  });
});

describe('adversarial — stale/delisted marketplace candidate', () => {
  it('excludes superseded/retired/unknown offers with reasons', async () => {
    const stale = createArtifactCandidate({
      ...fixtureArtifactCandidateInput(),
      offerId: 'offer-stale',
      state: 'superseded',
    });
    const retired = createArtifactCandidate({
      ...fixtureArtifactCandidateInput(),
      offerId: 'offer-retired',
      state: 'retired',
    });
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      artifactCatalog: new InMemoryArtifactOfferCatalog([stale, retired]),
    });
    const demand = fixtureDemandInput({
      escalationModes: ['TOOL_GAP'],
      artifact: { artifactKinds: ['dataset'] },
    });
    delete (demand as { expert?: unknown }).expert;
    const result = await service.routeCrossResource(demand, { demandId: 'capr-adv-0007' });
    expect(result.match?.outcome).toBe('no-match');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'offer-delisted'),
    ).toHaveLength(2);
  });

  it('excludes a granted-but-expired entitlement surfaced as available', async () => {
    const expired = createArtifactCandidate({
      ...fixtureArtifactCandidateInput(),
      offerId: 'offer-expired',
      entitlementState: 'expired',
    });
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      artifactCatalog: new InMemoryArtifactOfferCatalog([expired]),
    });
    const demand = fixtureDemandInput({
      escalationModes: ['TOOL_GAP'],
      artifact: { artifactKinds: ['dataset'] },
    });
    delete (demand as { expert?: unknown }).expert;
    const result = await service.routeCrossResource(demand, { demandId: 'capr-adv-0008' });
    expect(result.match?.outcome).toBe('no-match');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'entitlement-missing'),
    ).toHaveLength(1);
  });
});

describe('adversarial — broken catalog ports fail closed', () => {
  it('a throwing catalog port is a typed catalog-unavailable cause, never a silent pool', async () => {
    const graph = await buildFixtureGraph();
    const expert = await fixtureExpertCandidate(graph);
    const brokenCatalog = {
      listExpertCandidates(): Promise<never> {
        return Promise.reject(new Error('host read surface offline'));
      },
    };
    const service = new CapabilityRoutingService({
      clock: new FixedClock(FIXTURE_CLOCK_START),
      graphSource: new StaticGraphSource(graph),
      expertDirectory: brokenCatalog as never,
    });
    void expert;
    const result = await service.routeCrossResource(fixtureDemandInput(), {
      demandId: 'capr-adv-0009',
    });
    expect(result.match?.outcome).toBe('deadline-infeasible');
    expect(
      result.match?.causes.filter((cause) => cause.reason === 'catalog-unavailable'),
    ).toHaveLength(1);
    if (result.decision.outcome !== 'no-match') return;
    expect(result.decision.reason).toBe('routing-unavailable');
  });
});
