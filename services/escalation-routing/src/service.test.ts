/**
 * EscalationRoutingService unit + integration tests (Work Order C002) —
 * routing over injected ports, the C001 seam decision mapping, the
 * append-only decision history and determinism.
 */

import { describe, expect, it } from 'vitest';
import { EscalationRoutingService, portDecisionOf } from './service.js';
import { FixedClock, StaticGraphSource, StaticRoutingCandidateDirectory } from './fabric.js';
import type { RoutingVerdict } from '@arena/escalation-routing';
import {
  FIXTURE_NOW,
  buildFixtureGraph,
  fixtureCandidate,
  fixtureEscalationRecord,
} from './test-support.js';

describe('routing service over injected ports — the C001 seam', () => {
  it('routes a qualified, available, COI-clean expert to a matched port decision', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord();
    const decision = await service.route(record);
    expect(decision).toEqual({ outcome: 'matched', expertRef: 'expert-001' });
  });

  it('routeDetailed carries the compilation, the verdict and the history record', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord();
    const detailed = await service.routeDetailed(record);
    expect(detailed.compilation.outcome).toBe('compilable');
    expect(detailed.verdict?.outcome).toBe('matched');
    expect(detailed.record?.verdictOutcome).toBe('matched');
    expect(detailed.record?.sequence).toBe(1);
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history).toHaveLength(1);
    expect(history[0]?.digest).toBe(detailed.record?.digest);
  });

  it('the decision history chains across re-routes (supersession by append)', async () => {
    const graph = await buildFixtureGraph();
    const clock = new FixedClock(FIXTURE_NOW);
    const service = new EscalationRoutingService({
      clock,
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord();
    await service.routeDetailed(record);
    clock.advanceBy(60_000);
    await service.routeDetailed(record);
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history).toHaveLength(2);
    expect(history[1]?.previousRecordDigest).toBe(history[0]?.digest);
    expect(history[1]?.sequence).toBe(2);
  });

  it('an empty pool is a typed no-qualified-expert (never a throw)', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'no-qualified-expert' });
  });

  it('COI-blocked experts compress to no-qualified-expert at the port (verdict keeps the truth)', async () => {
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
    expect(detailed.verdict?.outcome).toBe('blocked-by-coi');
    expect(detailed.decision).toEqual({ outcome: 'no-match', reason: 'no-qualified-expert' });
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history[0]?.verdictOutcome).toBe('blocked-by-coi');
  });

  it('budget infeasibility maps to budget-below-floor', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, { rateCard: { engagementRateMinorUnits: 60000, currency: 'USD' } }),
      ]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'budget-below-floor' });
  });

  it('locale gaps map to locale-uncovered', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph, { locale: 'fr' })]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'locale-uncovered' });
  });

  it('deadline infeasibility maps to routing-unavailable', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, {
          availability: [{ recurrence: 'one-time', date: '2026-10-06', startUtc: '09:00', endUtc: '17:00' }],
        }),
      ]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'routing-unavailable' });
  });

  it('an under-specified demand (unresolved capability need) is routing-unavailable with typed reasons', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord({ capabilityNeed: 'medicine.surgery' });
    const detailed = await service.routeDetailed(record);
    expect(detailed.compilation.outcome).toBe('under-specified');
    if (detailed.compilation.outcome !== 'under-specified') return;
    expect(detailed.compilation.reasons).toContain('capability-need-unresolved');
    expect(detailed.decision).toEqual({ outcome: 'no-match', reason: 'routing-unavailable' });
    expect(detailed.verdict).toBeUndefined();
  });

  it('a broken graph source degrades fail-closed to routing-unavailable', async () => {
    const graph = await buildFixtureGraph();
    const broken = {
      load: () => Promise.reject(new Error('graph backend down')),
    };
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: broken,
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'routing-unavailable' });
  });

  it('a broken candidate directory degrades fail-closed to routing-unavailable', async () => {
    const graph = await buildFixtureGraph();
    const broken = {
      listRoutingCandidates: () => Promise.reject(new Error('registry backend down')),
    };
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: broken,
    });
    const decision = await service.route(await fixtureEscalationRecord());
    expect(decision).toEqual({ outcome: 'no-match', reason: 'routing-unavailable' });
  });

  it('identical inputs at the same clock produce identical verdict digests (determinism)', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, { expertId: 'expert-001' }),
        fixtureCandidate(graph, { expertId: 'expert-002' }),
      ]),
    });
    const record = await fixtureEscalationRecord();
    const first = await service.routeDetailed(record);
    const second = await service.routeDetailed(record);
    expect(first.verdict?.digest).toBe(second.verdict?.digest);
    // Two routing RUNS are two history entries (supersession by append);
    // the verdicts are identical because the inputs were.
    const history = await service.decisionHistory(record.request.requestId, 'tenant-a');
    expect(history).toHaveLength(2);
    expect(history[1]?.previousRecordDigest).toBe(history[0]?.digest);
  });

  it('malformed request jurisdictions fail closed (under-specified)', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const record = await fixtureEscalationRecord({ jurisdictions: ['Ghana'] });
    const detailed = await service.routeDetailed(record);
    expect(detailed.compilation.outcome).toBe('under-specified');
    expect(detailed.decision).toEqual({ outcome: 'no-match', reason: 'routing-unavailable' });
  });
});

describe('port decision mapping (the documented table)', () => {
  const base = {
    verdictVersion: 1 as const,
    requestId: 'esc_00000001',
    tenantId: 'tenant-a',
    profileDigest: 'a'.repeat(64),
    evaluatedAt: '2026-10-07T12:00:00.000Z',
    causes: [],
    digest: 'b'.repeat(64),
  };
  const verdict = (outcome: string, extra: Record<string, unknown> = {}): RoutingVerdict =>
    ({ ...base, outcome, ...extra }) as unknown as RoutingVerdict;

  it('maps every engine outcome onto the C001 closed vocabulary', () => {
    expect(portDecisionOf(verdict('matched', { expertRef: 'expert-001' }))).toEqual({
      outcome: 'matched',
      expertRef: 'expert-001',
    });
    expect(portDecisionOf(verdict('no-match'))).toEqual({
      outcome: 'no-match',
      reason: 'no-qualified-expert',
    });
    expect(portDecisionOf(verdict('blocked-by-coi'))).toEqual({
      outcome: 'no-match',
      reason: 'no-qualified-expert',
    });
    expect(portDecisionOf(verdict('blocked-by-privacy'))).toEqual({
      outcome: 'no-match',
      reason: 'no-qualified-expert',
    });
    expect(portDecisionOf(verdict('budget-infeasible'))).toEqual({
      outcome: 'no-match',
      reason: 'budget-below-floor',
    });
    expect(portDecisionOf(verdict('locale-uncovered'))).toEqual({
      outcome: 'no-match',
      reason: 'locale-uncovered',
    });
    expect(portDecisionOf(verdict('deadline-infeasible'))).toEqual({
      outcome: 'no-match',
      reason: 'routing-unavailable',
    });
  });
});
