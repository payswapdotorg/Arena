/**
 * Adversarial tests (Work Order C002) — the three named attack classes
 * plus the fail-closed posture:
 *
 *   1. qualification-masquerading-as-an-access-grant — a fully
 *      qualified candidate must STILL be blocked by COI/privacy rules;
 *      qualification alone never produces a match;
 *   2. cross-tenant candidate leakage — a misconfigured host directory
 *      returning foreign-tenant candidates never leaks an expertRef;
 *   3. COI bypass — a top-ranked expert with a declared conflict is
 *      never selected over a weaker, conflict-free expert.
 */

import { describe, expect, it } from 'vitest';
import { EscalationRoutingService } from './service.js';
import {
  DelegatingRoutingCandidateDirectory,
  FixedClock,
  StaticGraphSource,
  StaticRoutingCandidateDirectory,
} from './fabric.js';
import {
  FIXTURE_NOW,
  buildFixtureGraph,
  fixtureCandidate,
  fixtureEscalationRecord,
  fixtureRequestId,
} from './test-support.js';

describe('adversarial — qualification is DATA, never an access grant', () => {
  it('a fully-qualified expert with a tenant conflict is NEVER matched', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, { coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] } }),
      ]),
    });
    const record = await fixtureEscalationRecord();
    const detailed = await service.routeDetailed(record);
    // Qualification evidence is present for every required competency…
    const verdict = detailed.verdict;
    expect(verdict).toBeDefined();
    if (verdict === undefined) return;
    // …and the verdict is still a COI block, never a match.
    expect(verdict.outcome).toBe('blocked-by-coi');
    expect(verdict.causes).toEqual([{ expertId: 'expert-001', reason: 'blocked-by-coi' }]);
    expect(detailed.decision.outcome).toBe('no-match');
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history[0]?.verdictOutcome).toBe('blocked-by-coi');
  });

  it('a fully-qualified expert without privacy clearance is NEVER matched', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, {
          privacyClearance: { maxDataClassification: 'public', piiHandling: 'forbid' },
        }),
      ]),
    });
    const record = await fixtureEscalationRecord({
      privacy: { dataClassification: 'confidential', pii: 'forbid' },
    });
    const detailed = await service.routeDetailed(record);
    expect(detailed.verdict?.outcome).toBe('blocked-by-privacy');
    expect(detailed.decision.outcome).toBe('no-match');
  });

  it('qualification entries alone (no availability, no budget fit) produce no match', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, {
          availability: [],
          rateCard: { engagementRateMinorUnits: 999999, currency: 'USD' },
        }),
      ]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision.outcome).toBe('no-match');
  });
});

describe('adversarial — cross-tenant candidate leakage', () => {
  it('a misconfigured directory returning foreign-tenant candidates leaks nothing', async () => {
    const graph = await buildFixtureGraph();
    // HOST BUG simulation: the directory ignores the tenant argument and
    // returns tenant-b experts for a tenant-a request.
    const leaking = new DelegatingRoutingCandidateDirectory(async () => [
      fixtureCandidate(graph, { tenant: 'tenant-b', expertId: 'expert-spy' }),
    ]);
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: leaking,
    });
    const record = await fixtureEscalationRecord();
    const detailed = await service.routeDetailed(record);
    expect(detailed.verdict?.outcome).toBe('no-match');
    expect(detailed.verdict?.causes).toEqual([{ expertId: 'expert-spy', reason: 'cross-tenant' }]);
    expect(detailed.decision).toEqual({ outcome: 'no-match', reason: 'no-qualified-expert' });
    // No expertRef is EVER exposed for a cross-tenant candidate.
    expect(detailed.verdict?.expertRef).toBeUndefined();
  });

  it('a public-scope expert IS routable (the one sanctioned cross-scope case)', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, { tenant: 'public', expertId: 'expert-global' }),
      ]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'matched', expertRef: 'expert-global' });
  });

  it('the decision history of tenant-a never contains tenant-b records', async () => {
    const graph = await buildFixtureGraph();
    const mixed = new DelegatingRoutingCandidateDirectory(async (tenantId) => [
      fixtureCandidate(graph, { tenant: tenantId === 'tenant-a' ? 'tenant-b' : 'tenant-a' }),
    ]);
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: mixed,
    });
    const forA = await fixtureEscalationRecord({ tenantId: 'tenant-a', requestId: fixtureRequestId('adv-01') });
    const detailedA = await service.routeDetailed(forA);
    expect(detailedA.decision.outcome).toBe('no-match');
    const historyA = await service.decisionHistory('esc_000000000000000000000000000000aa', 'tenant-a');
    expect(historyA.every((entry) => entry.tenantId === 'tenant-a')).toBe(true);
    // A tenant-b caller cannot read tenant-a's history (tenant-scoped port).
    const historyB = await service.decisionHistory('esc_000000000000000000000000000000aa', 'tenant-b');
    expect(historyB).toHaveLength(0);
  });
});

describe('adversarial — COI bypass attempt', () => {
  it('a top-ranked conflicted expert loses to a weaker conflict-free expert', async () => {
    const graph = await buildFixtureGraph();
    const conflictedTop = fixtureCandidate(graph, {
      expertId: 'expert-000',
      reliability: { completed: 100, failed: 0, noResponse: 0 },
      coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
    });
    const weakerClean = fixtureCandidate(graph, {
      expertId: 'expert-zzz',
      reliability: { completed: 1, failed: 5, noResponse: 5 },
    });
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([conflictedTop, weakerClean]),
    });
    const record = await fixtureEscalationRecord();
    const detailed = await service.routeDetailed(record);
    expect(detailed.verdict?.outcome).toBe('matched');
    // The matched expert is the CONFLICT-FREE one — never the higher-
    // ranked conflicted one.
    expect(detailed.verdict?.expertRef).toBe('expert-zzz');
    expect(detailed.verdict?.shortlist?.map((entry) => entry.expertId)).toEqual(['expert-zzz']);
    expect(detailed.verdict?.causes).toEqual([{ expertId: 'expert-000', reason: 'blocked-by-coi' }]);
  });

  it('a client-app conflict also bypasses nothing', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, {
          coi: { blockedTenantIds: [], blockedClientAppIds: ['app-alpha'] },
        }),
      ]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision.outcome).toBe('no-match');
  });
});
