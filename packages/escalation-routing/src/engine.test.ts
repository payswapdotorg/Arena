/**
 * Routing engine unit tests (Work Order C002) — the ES1.0 routing input
 * acceptance list as explicit, ordered filters; typed decision outcomes;
 * deterministic ranking.
 */

import { describe, expect, it } from 'vitest';
import { createRoutingCandidate, isRoutingCandidate } from './candidate.js';
import type { CreateRoutingCandidateInput, RoutingCandidate } from './candidate.js';
import { compileDemandProfile, recomputeDemandProfileDigest } from './demand-profile.js';
import { routeEscalation, recomputeRoutingVerdictDigest } from './engine.js';
import type { DemandProfile } from './demand-profile.js';
import {
  buildFixtureGraph,
  fixtureCandidateInput,
  fixtureDemandInput,
  fixtureNodeRef,
  qualificationInput,
  FIXTURE_EVALUATED_AT,
} from './test-support.js';
import type { CapabilityGraph } from '@arena/capability-graph';

async function compile(graph: CapabilityGraph): Promise<DemandProfile> {
  const result = await compileDemandProfile(fixtureDemandInput(), graph, {
    evaluatedAt: FIXTURE_EVALUATED_AT,
  });
  if (result.outcome !== 'compilable') {
    throw new Error(`fixture demand failed to compile: ${JSON.stringify(result)}`);
  }
  return result.profile;
}

/** A fully-qualified candidate over the fixture taxonomy. */
async function qualifiedCandidate(
  graph: CapabilityGraph,
  overrides: Partial<CreateRoutingCandidateInput> & { expertId?: string } = {},
): Promise<RoutingCandidate> {
  const skill = await fixtureNodeRef(graph, 'skill', 'boq-assumption-check');
  const sub = await fixtureNodeRef(graph, 'sub-capability', 'boq-verification');
  const cap = await fixtureNodeRef(graph, 'capability', 'quantity-surveying');
  const tool = await fixtureNodeRef(graph, 'tool', 'local-rate-database');
  const domain = await fixtureNodeRef(graph, 'domain', 'construction');
  return createRoutingCandidate(
    fixtureCandidateInput(graph, {
      ...overrides,
      qualifiedCapabilities:
        overrides.qualifiedCapabilities ?? [
          qualificationInput(cap),
          qualificationInput(sub),
          qualificationInput(skill),
        ],
      supportedToolRefs: overrides.supportedToolRefs ?? [tool],
      domainRefs: overrides.domainRefs ?? [domain],
      historicalTaskDomainRefs: overrides.historicalTaskDomainRefs ?? [domain],
    }),
  );
}

describe('routing engine — matched path', () => {
  it('matches a fully-qualified, available, COI-clean candidate', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph);
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000001',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
    expect(verdict.expertRef).toBe('expert-001');
    expect(verdict.shortlist?.[0]?.rank).toBe(1);
    expect(verdict.profileDigest).toBe(profile.digest);
    expect(Object.isFrozen(verdict)).toBe(true);
    await expect(recomputeRoutingVerdictDigest(verdict)).resolves.toBe(verdict.digest);
  });

  it('preferred locales widen coverage (request locale stays first)', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ preferredLocales: ['fr'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidate = await qualifiedCandidate(graph, { locale: 'fr' });
    const verdict = await routeEscalation(result.profile, [candidate], {
      requestId: 'esc_00000002',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
    expect(verdict.shortlist?.[0]?.score.localeMatch).toBe(0);
  });

  it('a public-scope expert serves a tenant demand (lock rule 11)', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, { tenant: 'public' });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000003',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
  });
});

describe('routing engine — the filter order is the contract', () => {
  it('a candidate failing several filters reports the FIRST filter reason', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, {
      tenant: 'tenant-b',
      coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
      privacyClearance: { maxDataClassification: 'public', piiHandling: 'forbid' },
      locale: 'fr',
    });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000004',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes).toEqual([{ expertId: 'expert-001', reason: 'cross-tenant' }]);
  });

  it('COI precedes privacy and qualification', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, {
      coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
      privacyClearance: { maxDataClassification: 'public', piiHandling: 'forbid' },
      qualifiedCapabilities: [],
    });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000005',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-coi');
    expect(verdict.causes?.[0]?.reason).toBe('blocked-by-coi');
  });

  it('privacy precedes qualification, tools, locale and budget', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ privacyPolicy: { dataClassification: 'confidential', pii: 'forbid' } }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidate = await qualifiedCandidate(graph, {
      privacyClearance: { maxDataClassification: 'public', piiHandling: 'forbid' },
      qualifiedCapabilities: [],
      locale: 'fr',
      rateCard: { engagementRateMinorUnits: 999999, currency: 'EUR' },
    });
    const verdict = await routeEscalation(result.profile, [candidate], {
      requestId: 'esc_00000006',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-privacy');
    expect(verdict.causes?.[0]?.reason).toBe('blocked-by-privacy');
  });
});

describe('routing engine — COI and privacy are explicit, tested blocks', () => {
  it('a tenant conflict blocks the expert regardless of qualification', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, {
      coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
    });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000007',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-coi');
  });

  it('a client-app conflict blocks the expert', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, {
      coi: { blockedTenantIds: [], blockedClientAppIds: ['app-alpha'] },
    });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000008',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-coi');
  });

  it('an under-classified expert is blocked on confidential demands', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ privacyPolicy: { dataClassification: 'confidential', pii: 'forbid' } }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidate = await qualifiedCandidate(graph, {
      privacyClearance: { maxDataClassification: 'internal', piiHandling: 'forbid' },
    });
    const verdict = await routeEscalation(result.profile, [candidate], {
      requestId: 'esc_00000009',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-privacy');
  });

  it('a PII-permitting demand requires a PII-capable expert', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ privacyPolicy: { dataClassification: 'public', pii: 'allow' } }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidate = await qualifiedCandidate(graph, {
      privacyClearance: { maxDataClassification: 'confidential', piiHandling: 'redact' },
    });
    const verdict = await routeEscalation(result.profile, [candidate], {
      requestId: 'esc_00000010',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('blocked-by-privacy');
  });
});

describe('routing engine — qualification is INPUT, never authorization', () => {
  it('a missing required qualification eliminates the candidate', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, { qualifiedCapabilities: [] });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000011',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes?.[0]?.reason).toBe('qualification-missing');
  });

  it('an unsupported required tool eliminates the candidate', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, { supportedToolRefs: [] });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000012',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes?.[0]?.reason).toBe('tools-unsupported');
  });
});

describe('routing engine — geography, budget, deadline', () => {
  it('an uncovered locale eliminates the candidate', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, { locale: 'fr' });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000013',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('locale-uncovered');
    expect(verdict.causes?.[0]?.reason).toBe('locale-uncovered');
  });

  it('an uncovered jurisdiction eliminates the candidate', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ jurisdictions: ['GH'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const candidate = await qualifiedCandidate(graph, { jurisdictions: [{ country: 'FR' }] });
    const verdict = await routeEscalation(result.profile, [candidate], {
      requestId: 'esc_00000014',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes?.[0]?.reason).toBe('jurisdiction-uncovered');
  });

  it('a rate above the budget cap is budget-infeasible (fail-closed currency equality)', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const over = await qualifiedCandidate(graph, {
      rateCard: { engagementRateMinorUnits: 50001, currency: 'USD' },
    });
    const verdict = await routeEscalation(profile, [over], {
      requestId: 'esc_00000015',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('budget-infeasible');

    const wrongCurrency = await qualifiedCandidate(graph, {
      rateCard: { engagementRateMinorUnits: 1, currency: 'EUR' },
    });
    const verdict2 = await routeEscalation(profile, [wrongCurrency], {
      requestId: 'esc_00000016',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict2.outcome).toBe('budget-infeasible');
  });

  it('a zero budget cap authorizes only zero-rate engagements', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileDemandProfile(
      fixtureDemandInput({ budget: { amountMinorUnits: 0, currency: 'USD' } }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const zeroRate = await qualifiedCandidate(graph, {
      rateCard: { engagementRateMinorUnits: 0, currency: 'USD' },
    });
    const verdict = await routeEscalation(result.profile, [zeroRate], {
      requestId: 'esc_00000017',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
  });

  it('an availability window that misses the deadline window is deadline-infeasible', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const yesterday = await qualifiedCandidate(graph, {
      availability: [{ recurrence: 'one-time', date: '2026-10-06', startUtc: '09:00', endUtc: '17:00' }],
    });
    const verdict = await routeEscalation(profile, [yesterday], {
      requestId: 'esc_00000018',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('deadline-infeasible');
    expect(verdict.causes?.[0]?.reason).toBe('deadline-infeasible');
  });

  it('an expert with no declared availability is eliminated as unavailable', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph, { availability: [] });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000019',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes?.[0]?.reason).toBe('unavailable');
  });

  it('a weekly window on the right day covers the demand window', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    // 2026-10-07 is a Wednesday (ISO day 3).
    const candidate = await qualifiedCandidate(graph, {
      availability: [{ recurrence: 'weekly', dayOfWeek: 3, startUtc: '11:00', endUtc: '13:00' }],
    });
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000020',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
  });
});

describe('routing engine — deterministic ranking', () => {
  it('historical task fit outranks demonstrated performance', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const domain = await fixtureNodeRef(graph, 'domain', 'construction');
    const fitExpert = await qualifiedCandidate(graph, {
      expertId: 'expert-zzz',
      historicalTaskDomainRefs: [domain, domain, domain],
      reliability: { completed: 1, failed: 0, noResponse: 0 },
    });
    const reliableExpert = await qualifiedCandidate(graph, {
      expertId: 'expert-aaa',
      historicalTaskDomainRefs: [],
      reliability: { completed: 100, failed: 0, noResponse: 0 },
    });
    const verdict = await routeEscalation(profile, [reliableExpert, fitExpert], {
      requestId: 'esc_00000021',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
    expect(verdict.expertRef).toBe('expert-zzz');
    expect(verdict.shortlist?.map((entry) => entry.expertId)).toEqual(['expert-zzz', 'expert-aaa']);
  });

  it('exact-locale match outranks evidence depth; expert-id breaks ties', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const a = await qualifiedCandidate(graph, { expertId: 'expert-bbb', locale: 'en' });
    const b = await qualifiedCandidate(graph, { expertId: 'expert-aaa', locale: 'fr' });
    // 'fr' is not covered by the demand locales — use preferred to keep both alive.
    const result = await compileDemandProfile(
      fixtureDemandInput({ preferredLocales: ['fr'] }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (result.outcome !== 'compilable') throw new Error('compile failed');
    const verdict = await routeEscalation(result.profile, [b, a], {
      requestId: 'esc_00000022',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('matched');
    expect(verdict.expertRef).toBe('expert-bbb');
    expect(verdict.shortlist?.[0]?.score.localeMatch).toBe(1);

    // Tie-break: identical scores ⇒ lexicographic expert id.
    const c = await qualifiedCandidate(graph, { expertId: 'expert-ccc' });
    const d = await qualifiedCandidate(graph, { expertId: 'expert-aaa' });
    const tie = await routeEscalation(profile, [c, d], {
      requestId: 'esc_00000023',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(tie.expertRef).toBe('expert-aaa');
  });

  it('identical inputs in different candidate order produce identical verdict digests', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const one = await qualifiedCandidate(graph, { expertId: 'expert-one' });
    const two = await qualifiedCandidate(graph, { expertId: 'expert-two' });
    const three = await qualifiedCandidate(graph, { expertId: 'expert-three' });
    const first = await routeEscalation(profile, [one, two, three], {
      requestId: 'esc_00000024',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const second = await routeEscalation(profile, [three, two, one], {
      requestId: 'esc_00000024',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(second.digest).toBe(first.digest);
  });

  it('an empty candidate set is a typed no-match (never a throw)', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const verdict = await routeEscalation(profile, [], {
      requestId: 'esc_00000025',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.outcome).toBe('no-match');
    expect(verdict.causes).toEqual([]);
  });

  it('verdict tampering is detected via digest recomputation', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    const candidate = await qualifiedCandidate(graph);
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000026',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const tampered = { ...verdict, expertRef: 'expert-hacker' };
    await expect(recomputeRoutingVerdictDigest(tampered)).rejects.toThrow(/digest mismatch/);
  });
});

describe('routing candidates — validation guards', () => {
  it('creates and freezes a candidate; structural guard accepts it', async () => {
    const graph = await buildFixtureGraph();
    const candidate = await qualifiedCandidate(graph);
    expect(isRoutingCandidate(candidate)).toBe(true);
    expect(Object.isFrozen(candidate)).toBe(true);
  });

  it('rejects malformed inputs with typed errors', async () => {
    const graph = await buildFixtureGraph();
    const skill = await fixtureNodeRef(graph, 'skill', 'boq-assumption-check');
    const sub = await fixtureNodeRef(graph, 'sub-capability', 'boq-verification');
    const cap = await fixtureNodeRef(graph, 'capability', 'quantity-surveying');
    const clean = fixtureCandidateInput(graph, {
      qualifiedCapabilities: [qualificationInput(cap), qualificationInput(sub), qualificationInput(skill)],
    });
    const badDigest = fixtureCandidateInput(graph, {
      qualifiedCapabilities: [
        {
          capability: { kind: 'skill', id: 'boq-assumption-check', version: '1.0.0', digest: 'a'.repeat(64) },
          proficiency: 'proficient',
          claimDigest: 'not-a-digest',
          recordDigest: 'b'.repeat(64),
          evidenceDigests: [],
        },
      ],
    });
    expect(() => createRoutingCandidate(badDigest)).toThrow(/sha256 claim\/record digests/);
    expect(() =>
      createRoutingCandidate({ ...clean, locale: 'not-a-locale' }),
    ).toThrow(/locale is invalid/);
    expect(() =>
      createRoutingCandidate({
        ...clean,
        privacyClearance: { maxDataClassification: 'top-secret', piiHandling: 'allow' },
      }),
    ).toThrow(/privacyClearance is invalid/);
    expect(() =>
      createRoutingCandidate({
        ...clean,
        rateCard: { engagementRateMinorUnits: -5, currency: 'USD' },
      }),
    ).toThrow(/rateCard is invalid/);
    expect(() =>
      createRoutingCandidate({
        ...clean,
        coi: { blockedTenantIds: ['NOT VALID'], blockedClientAppIds: [] },
      }),
    ).toThrow(/blockedTenantIds/);
    expect(() =>
      createRoutingCandidate({
        ...clean,
        supportedToolRefs: [{ kind: 'domain', id: 'construction', version: '1.0.0', digest: 'a'.repeat(64) }],
      }),
    ).toThrow(/supportedToolRefs/);
  });
});

describe('demand compiler + engine — end-to-end digest discipline', () => {
  it('the verdict commits to the profile digest it routed over', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile(graph);
    await expect(recomputeDemandProfileDigest(profile)).resolves.toBe(profile.digest);
    const candidate = await qualifiedCandidate(graph);
    const verdict = await routeEscalation(profile, [candidate], {
      requestId: 'esc_00000027',
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(verdict.profileDigest).toBe(profile.digest);
  });
});
