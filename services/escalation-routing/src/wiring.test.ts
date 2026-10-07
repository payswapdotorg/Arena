/**
 * C001 seam wiring tests (Work Order C002). The escalation-api service
 * may NOT be imported here (boundary rule B2 — services communicate
 * through versioned contracts/ports), so this suite proves plug
 * compatibility STRUCTURALLY: the mirrored RoutingPort contract (the
 * closed decision vocabulary byte-equal to services/escalation-api's
 * ports.ts) accepts this service, and a consumer harness drives the
 * reference lifecycle (created → triaged → matching → route → offered)
 * exactly the way EscalationApiService.createEscalation does.
 *
 * C001's own tests are UNTOUCHED by this work order (the stub remains
 * the escalation-api default) — they stay green by construction.
 */

import { describe, expect, it } from 'vitest';
import { applyEscalationTransition } from '@arena/escalation';
import { EscalationRoutingService } from './service.js';
import { FixedClock, StaticGraphSource, StaticRoutingCandidateDirectory } from './fabric.js';
import type { RoutingPortLike } from './ports.js';
import { ROUTING_NO_MATCH_REASONS } from './ports.js';
import {
  FIXTURE_NOW,
  buildFixtureGraph,
  fixtureCandidate,
  fixtureEscalationRecord,
  fixtureRequestId,
} from './test-support.js';

describe('wiring through the C001 routing seam (structural plug compatibility)', () => {
  it('the service satisfies the mirrored RoutingPort contract', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    // Compile-time structural compatibility with the C001 seam.
    const port: RoutingPortLike = service;
    const record = await fixtureEscalationRecord();
    const decision = await port.route(record);
    expect(decision.outcome).toBe('matched');
  });

  it('the mirrored no-match vocabulary is byte-equal to C001\u2019s port contract', () => {
    // Parity check against services/escalation-api/src/ports.ts
    // (ROUTING_NO_MATCH_REASONS). A drift here is a contract break the
    // type system cannot see — so it is asserted at runtime.
    expect([...ROUTING_NO_MATCH_REASONS]).toEqual([
      'no-qualified-expert',
      'budget-below-floor',
      'locale-uncovered',
      'routing-unavailable',
    ]);
  });

  it('a consumer harness drives the reference lifecycle through the seam', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([
        fixtureCandidate(graph, { expertId: 'expert-001' }),
        fixtureCandidate(graph, { expertId: 'expert-002' }),
      ]),
    });
    const port: RoutingPortLike = service;

    // The EscalationApiService.createEscalation drive, mirrored:
    // create → triaged → matching → route → offered (on match).
    let record = await fixtureEscalationRecord({ requestId: fixtureRequestId('wiring-01') });
    const now = Date.parse(record.request.createdAt);
    record = applyEscalationTransition(record, 'triaged', { now });
    record = applyEscalationTransition(record, 'matching', { now });
    const decision = await port.route(record);
    expect(decision.outcome).toBe('matched');
    if (decision.outcome !== 'matched') return;
    record = applyEscalationTransition(record, 'offered', { now, expertRef: decision.expertRef });
    expect(record.state).toBe('offered');
    expect(record.expertRef).toBe('expert-001');

    // No-match keeps the escalation in `matching` (the C001 contract:
    // the stub never silently best-efforts — neither does the engine).
    const noMatch = await fixtureEscalationRecord({ requestId: fixtureRequestId('wiring-02'), capabilityNeed: 'medicine.surgery' });
    const noMatchDecision = await port.route(noMatch);
    expect(noMatchDecision.outcome).toBe('no-match');
    expect(noMatchDecision.outcome === 'no-match' ? noMatchDecision.reason : undefined).toBe(
      'routing-unavailable',
    );
  });

  it('two consumers injecting the same service observe consistent decisions', async () => {
    const graph = await buildFixtureGraph();
    const service = new EscalationRoutingService({
      clock: new FixedClock(FIXTURE_NOW),
      graphSource: new StaticGraphSource(graph),
      directory: new StaticRoutingCandidateDirectory([fixtureCandidate(graph)]),
    });
    const first: RoutingPortLike = service;
    const second: RoutingPortLike = service;
    const record = await fixtureEscalationRecord();
    const a = await first.route(record);
    const b = await second.route(record);
    expect(a).toEqual(b);
  });
});
