/**
 * Property-style tests (Work Order C002) — order-independence and
 * determinism of the compiler + engine over deterministic permutations
 * (no RNG: fixed rotations of a fixed candidate set).
 */

import { describe, expect, it } from 'vitest';
import { compileDemandProfile } from './demand-profile.js';
import { routeEscalation } from './engine.js';
import { createRoutingCandidate } from './candidate.js';
import type { RoutingCandidate } from './candidate.js';
import {
  buildFixtureGraph,
  fixtureCandidateInput,
  fixtureDemandInput,
  fixtureNodeRef,
  qualificationInput,
  FIXTURE_EVALUATED_AT,
} from './test-support.js';
import type { CapabilityGraph } from '@arena/capability-graph';

async function candidateSet(graph: CapabilityGraph): Promise<RoutingCandidate[]> {
  const skill = await fixtureNodeRef(graph, 'skill', 'boq-assumption-check');
  const sub = await fixtureNodeRef(graph, 'sub-capability', 'boq-verification');
  const cap = await fixtureNodeRef(graph, 'capability', 'quantity-surveying');
  const tool = await fixtureNodeRef(graph, 'tool', 'local-rate-database');
  const domain = await fixtureNodeRef(graph, 'domain', 'construction');
  const base = fixtureCandidateInput(graph, {
    qualifiedCapabilities: [qualificationInput(cap), qualificationInput(sub), qualificationInput(skill)],
    supportedToolRefs: [tool],
    domainRefs: [domain],
    historicalTaskDomainRefs: [domain],
  });
  return ['expert-001', 'expert-002', 'expert-003', 'expert-004'].map((expertId) =>
    createRoutingCandidate({ ...base, expertId }),
  );
}

/** Deterministic rotation (no RNG). */
function rotate<T>(values: readonly T[], offset: number): T[] {
  const length = values.length;
  return values.map((_, index) => values[(index + offset) % length] as T);
}

describe('routing determinism (property-style)', () => {
  it('every rotation of the candidate set yields the SAME verdict digest', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidates = await candidateSet(graph);
    const digests = new Set<string>();
    const experts = new Set<string>();
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const verdict = await routeEscalation(result.profile, rotate(candidates, offset), {
        requestId: 'esc_property_1',
        evaluatedAt: FIXTURE_EVALUATED_AT,
      });
      digests.add(verdict.digest);
      experts.add(verdict.outcome === 'matched' && verdict.expertRef !== undefined ? verdict.expertRef : 'none');
    }
    expect(digests.size).toBe(1);
    expect(experts.size).toBe(1);
  });

  it('repeated compiles are byte-identical (digest stability)', async () => {
    const graph = await buildFixtureGraph();
    const digests = new Set<string>();
    for (let round = 0; round < 5; round += 1) {
      const result = await compileDemandProfile(fixtureDemandInput(), graph, {
        evaluatedAt: FIXTURE_EVALUATED_AT,
      });
      if (result.outcome !== 'compilable') throw new Error('compile failed');
      digests.add(result.profile.digest);
    }
    expect(digests.size).toBe(1);
  });

  it('the shortlist ranking is internally consistent (rank = position + 1)', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidates = await candidateSet(graph);
    const verdict = await routeEscalation(result.profile, candidates, {
      requestId: 'esc_property_2',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
    const shortlist = verdict.shortlist ?? [];
    expect(shortlist.length).toBe(candidates.length);
    shortlist.forEach((entry, index) => {
      expect(entry.rank).toBe(index + 1);
    });
    const ids = shortlist.map((entry) => entry.expertId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filter determinism: the same eliminated candidate reports the same reason across rotations', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(fixtureDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidates = await candidateSet(graph);
    const blocked = createRoutingCandidate({
      ...(await fixtureCandidateInput(graph, {
        coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
      })),
      expertId: 'expert-blocked',
    });
    const digests = new Set<string>();
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const rotated = rotate([...candidates, blocked], offset);
      const verdict = await routeEscalation(result.profile, rotated, {
        requestId: 'esc_property_3',
        evaluatedAt: FIXTURE_EVALUATED_AT,
      });
      digests.add(verdict.digest);
      const cause = (verdict.causes ?? []).find((entry) => entry.expertId === 'expert-blocked');
      expect(cause?.reason).toBe('blocked-by-coi');
    }
    expect(digests.size).toBe(1);
  });
});
