/**
 * Matching-engine tests (Work Order C015): per-class filter pipelines
 * (order + closed reasons), typed compositions, fail-closed budget
 * feasibility, no silent class coercion, determinism.
 */

import { describe, expect, it } from 'vitest';
import {
  ELIMINATION_REASONS,
  RESOURCE_MATCH_OUTCOMES,
  RESOURCE_MATCH_VERSION,
  isResourceMatch,
  matchResources,
  recomputeResourceMatchDigest,
  resourceMatchCauses,
  resourceMatchView,
} from './engine.js';
import { createExpertCandidate } from './catalog.js';
import {
  FIXTURE_EVALUATED_AT,
  FIXTURE_PROVENANCE_DIGEST,
  buildFixtureGraph,
  fixtureArtifactCandidate,
  fixtureBodyCandidate,
  fixtureCrossDemandInput,
  fixtureKnowledgeCandidate,
  fixtureQualifiedRoutingCandidate,
  fixtureToolCandidate,
} from './test-support.js';
import { compileCrossResourceDemand } from './demand.js';
import type { CrossResourceDemand } from './demand.js';
import type { ResourceMatch } from './engine.js';

const REQUEST_ID = 'capr_fixed0001';

async function compile(
  overrides: Parameters<typeof fixtureCrossDemandInput>[0] = {},
): Promise<CrossResourceDemand> {
  const graph = await buildFixtureGraph();
  const result = await compileCrossResourceDemand(fixtureCrossDemandInput(overrides), graph, {
    evaluatedAt: FIXTURE_EVALUATED_AT,
  });
  expect(result.outcome).toBe('compilable');
  if (result.outcome !== 'compilable') throw new Error('fixture demand must compile');
  return result.profile;
}

function causesOfReason(match: { causes: readonly { reason: string }[] }, reason: string): number {
  return match.causes.filter((cause) => cause.reason === reason).length;
}

describe('matchResources — expert class (C002 delegation)', () => {
  it('matches a qualified expert via the delegated C002 engine', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile();
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
      performanceProfileDigest: FIXTURE_PROVENANCE_DIGEST,
    });
    const match = await matchResources(profile, { experts: [expert] }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(match.outcome).toBe('matched');
    expect(match.classes).toHaveLength(1);
    expect(match.classes[0]?.outcome).toBe('matched');
    expect(match.classes[0]?.shortlist[0]?.ref).toBe('expert-001');
    expect(match.classes[0]?.shortlist[0]?.costMinorUnits).toBe(10000);
    expect(match.composition).toBeNull();
    await expect(recomputeResourceMatchDigest(match)).resolves.toBe(match.digest);
  });

  it('eliminates experts with the C002 closed reasons (COI/privacy)', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile();
    const coiExpert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph, {
        coi: { blockedTenantIds: ['tenant-a'], blockedClientAppIds: [] },
      }),
    });
    const match = await matchResources(profile, { experts: [coiExpert] }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(match.outcome).toBe('blocked-by-coi');
    expect(causesOfReason(match, 'blocked-by-coi')).toBe(1);
  });

  it('gates experts lacking C005 performance evidence when the facet requires it', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile({ expert: { performanceEvidenceRequired: true } });
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
    });
    const match = await matchResources(profile, { experts: [expert] }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(match.outcome).toBe('no-match');
    expect(causesOfReason(match, 'performance-evidence-missing')).toBe(1);
    // QUALIFICATION MASQUERADING AS AUTHORITY: even a fully-qualified
    // expert with no COI/privacy block is NOT matched without evidence.
    expect(causesOfReason(match, 'blocked-by-coi')).toBe(0);
    expect(causesOfReason(match, 'blocked-by-privacy')).toBe(0);
  });
});

describe('matchResources — body class', () => {
  it('matches a published compatible priced listing', async () => {
    const profile = await compile2({
      escalationModes: ['SOLVE'],
      body: { requiredSubstrate: 'substrate-alpha', environmentRequirements: ['env-standard'] },
    });
    const match = await matchResources(
      profile,
      { bodies: [fixtureBodyCandidate()] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(match.classes[0]?.shortlist[0]?.ref).toBe('listing-boq-solver');
  });

  it('applies the body filters in contract order with closed reasons', async () => {
    const profile = await compile2({
      escalationModes: ['SOLVE'],
      body: { requiredSubstrate: 'substrate-alpha', environmentRequirements: ['env-standard'] },
    });
    const match = await matchResources(
      profile,
      {
        bodies: [
          // cross-tenant wins over every later reason (order is the contract)
          fixtureBodyCandidate({ tenantId: 'tenant-b', state: 'draft' }),
          // state
          fixtureBodyCandidate({ state: 'suspended' }),
          fixtureBodyCandidate({ state: 'retired' }),
          // substrate
          fixtureBodyCandidate({ substrateCompatibility: { substrateId: 'substrate-beta', environmentIds: ['env-standard'] } }),
          // environment requirement
          fixtureBodyCandidate({ substrateCompatibility: { substrateId: 'substrate-alpha', environmentIds: [] } }),
          // unpriced (fail-closed)
          fixtureBodyCandidate({ pricing: null }),
          // currency mismatch
          fixtureBodyCandidate({ pricing: { amountMinorUnits: 20000, currency: 'EUR' } }),
          // over-cap
          fixtureBodyCandidate({ pricing: { amountMinorUnits: 60000, currency: 'USD' } }),
        ],
      },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('no-match');
    expect(causesOfReason(match, 'cross-tenant')).toBe(1);
    expect(causesOfReason(match, 'listing-not-published')).toBe(2);
    expect(causesOfReason(match, 'incompatible-substrate')).toBe(2);
    expect(causesOfReason(match, 'budget-infeasible')).toBe(3);
    expect(match.classes[0]?.outcome).toBe('no-match');
  });
});

describe('matchResources — tool class', () => {
  it('matches available tools and applies the closed reasons', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      tool: { requiredToolIds: ['local-rate-database'] },
    });
    const match = await matchResources(
      profile,
      {
        tools: [
          fixtureToolCandidate({ toolId: 'other-tool' }),
          fixtureToolCandidate({ availability: 'unavailable' }),
          fixtureToolCandidate({ tenantId: 'tenant-b' }),
          fixtureToolCandidate(),
        ],
      },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(causesOfReason(match, 'tools-unsupported')).toBe(1);
    expect(causesOfReason(match, 'unavailable')).toBe(1);
    expect(causesOfReason(match, 'cross-tenant')).toBe(1);
    expect(match.classes[0]?.shortlist).toHaveLength(1);
    expect(match.classes[0]?.shortlist[0]?.ref).toBe('local-rate-database');
  });
});

describe('matchResources — knowledge class', () => {
  it('matches tier/scope-sufficient validated knowledge with rights', async () => {
    const profile = await compile2({
      escalationModes: ['KNOWLEDGE'],
      knowledge: { minimumTier: 'verified-domain-constraint', requiredScopeKind: 'domain' },
    });
    const match = await matchResources(
      profile,
      { knowledge: [fixtureKnowledgeCandidate({ tier: 'verified-domain-constraint' })] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(match.classes[0]?.shortlist[0]?.ref).toBe('knowledge-boq-rules');
  });

  it('applies the knowledge filters in contract order with closed reasons', async () => {
    const profile = await compile2({
      escalationModes: ['KNOWLEDGE'],
      knowledge: { minimumTier: 'verified-domain-constraint', requiredScopeKind: 'domain' },
    });
    const match = await matchResources(
      profile,
      {
        knowledge: [
          fixtureKnowledgeCandidate({ tenantId: 'tenant-b', tier: 'verified-domain-constraint', validationState: 'unvalidated' }),
          fixtureKnowledgeCandidate({ tier: 'scoped-reusable-knowledge' }),
          fixtureKnowledgeCandidate({ tier: 'verified-domain-constraint', validationState: 'unvalidated' }),
          fixtureKnowledgeCandidate({ tier: 'verified-domain-constraint', rightsPresent: false }),
          fixtureKnowledgeCandidate({ tier: 'verified-domain-constraint', scopeKind: 'task' }),
        ],
      },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('no-match');
    expect(causesOfReason(match, 'cross-tenant')).toBe(1);
    expect(causesOfReason(match, 'tier-insufficient')).toBe(1);
    expect(causesOfReason(match, 'validation-missing')).toBe(1);
    expect(causesOfReason(match, 'rights-missing')).toBe(1);
    expect(causesOfReason(match, 'scope-insufficient')).toBe(1);
  });
});

describe('matchResources — artifact class', () => {
  it('matches registered entitled offers and excludes stale ones with reasons', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      artifact: { artifactKinds: ['dataset'] },
    });
    const match = await matchResources(
      profile,
      {
        artifacts: [
          // STALE/DELISTED candidate surfaced as available → excluded.
          fixtureArtifactCandidate({ offerId: 'offer-old', state: 'superseded' }),
          fixtureArtifactCandidate({ offerId: 'offer-gone', state: 'retired' }),
          fixtureArtifactCandidate({ offerId: 'offer-mystery', state: 'unknown' }),
          fixtureArtifactCandidate({ offerId: 'offer-eval', artifactKind: 'evaluation-suite' }),
          fixtureArtifactCandidate({ offerId: 'offer-ungranted', entitlementState: 'revoked' }),
          fixtureArtifactCandidate({ offerId: 'offer-expired', entitlementState: 'expired' }),
          fixtureArtifactCandidate({ offerId: 'offer-none', entitlementState: 'none' }),
          fixtureArtifactCandidate({ offerId: 'offer-eur', price: { amountMinorUnits: 5, currency: 'EUR' } }),
          fixtureArtifactCandidate({ offerId: 'offer-pricy', price: { amountMinorUnits: 90000, currency: 'USD' } }),
          fixtureArtifactCandidate({ offerId: 'offer-internal', visibility: 'tenant-internal', tenantId: 'tenant-b' }),
          fixtureArtifactCandidate(),
        ],
      },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(causesOfReason(match, 'offer-delisted')).toBe(3);
    expect(causesOfReason(match, 'artifact-kind-unwanted')).toBe(1);
    expect(causesOfReason(match, 'entitlement-missing')).toBe(3);
    expect(causesOfReason(match, 'budget-infeasible')).toBe(2);
    expect(causesOfReason(match, 'cross-tenant')).toBe(1);
    expect(match.classes[0]?.shortlist[0]?.ref).toBe('offer-rates-dataset');
  });

  it('skips the entitlement gate when the demand facet opts out', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      artifact: { entitlementRequired: false },
    });
    const match = await matchResources(
      profile,
      { artifacts: [fixtureArtifactCandidate({ entitlementState: 'none', price: null })] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(match.classes[0]?.shortlist[0]?.costMinorUnits).toBe(0);
  });
});

describe('matchResources — typed compositions', () => {
  it('composes expert + tool + knowledge + artifact within the budget cap', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile({
      escalationModes: ['SOLVE', 'TOOL_GAP', 'KNOWLEDGE'],
      tool: { requiredToolIds: ['local-rate-database'] },
      knowledge: { minimumTier: 'candidate-domain-rule', requiredScopeKind: 'domain' },
      artifact: { artifactKinds: ['dataset'] },
    });
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
    });
    const match = await matchResources(
      profile,
      {
        experts: [expert],
        tools: [fixtureToolCandidate()],
        knowledge: [fixtureKnowledgeCandidate()],
        artifacts: [fixtureArtifactCandidate()],
      },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('matched');
    expect(match.composition).not.toBeNull();
    expect(match.composition?.components.map((c) => c.resourceClass)).toEqual([
      'expert',
      'tool',
      'knowledge',
      'artifact',
    ]);
    // 10000 (expert) + 0 (tool) + 0 (knowledge) + 5000 (artifact).
    expect(match.composition?.totalCostMinorUnits).toBe(15000);
    expect(match.composition?.currency).toBe('USD');
    await expect(recomputeResourceMatchDigest(match)).resolves.toBe(match.digest);
  });

  it('FAILS CLOSED on a budget-infeasible composition (never an over-cap match)', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile({
      budget: { amountMinorUnits: 25000, currency: 'USD' },
      escalationModes: ['SOLVE'],
      body: { requiredSubstrate: 'substrate-alpha' },
    });
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
    });
    const match = await matchResources(
      profile,
      { experts: [expert], bodies: [fixtureBodyCandidate()] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    // Expert 10000 + body 20000 = 30000 > 25000 cap — each fits alone,
    // the composition does not: FAIL CLOSED (no composition, no match).
    expect(match.outcome).toBe('budget-infeasible');
    expect(match.composition).toBeNull();
    expect(match.classes.every((c) => c.outcome === 'matched')).toBe(true);
  });

  it('never delivers a partial multi-class match as the verdict', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile({
      escalationModes: ['SOLVE', 'TOOL_GAP'],
      tool: { requiredToolIds: ['local-rate-database'] },
    });
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
    });
    const match = await matchResources(
      profile,
      { experts: [expert], tools: [fixtureToolCandidate({ availability: 'unavailable' })] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('no-match');
    expect(match.classes.find((c) => c.resourceClass === 'expert')?.outcome).toBe('matched');
    expect(match.composition).toBeNull();
  });

  it('composes body + artifact and fails closed when the sum exceeds the cap', async () => {
    const profile = await compile2({
      escalationModes: ['SOLVE', 'TOOL_GAP'],
      body: { requiredSubstrate: 'substrate-alpha' },
      artifact: { artifactKinds: ['dataset'] },
    });
    // Body 20000 + artifact 5000 = 25000 > 22000 cap — each fits alone.
    const tight = await compile2({
      budget: { amountMinorUnits: 22000, currency: 'USD' },
      escalationModes: ['SOLVE', 'TOOL_GAP'],
      body: { requiredSubstrate: 'substrate-alpha' },
      artifact: { artifactKinds: ['dataset'] },
    });
    const catalogs = {
      bodies: [fixtureBodyCandidate()],
      artifacts: [fixtureArtifactCandidate()],
    };
    const comfortable = await matchResources(profile, catalogs, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(comfortable.outcome).toBe('matched');
    expect(comfortable.composition?.totalCostMinorUnits).toBe(25000);
    const overCap = await matchResources(tight, catalogs, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(overCap.outcome).toBe('budget-infeasible');
    expect(overCap.composition).toBeNull();
    expect(overCap.classes.every((c) => c.outcome === 'matched')).toBe(true);
  });
});

describe('matchResources — policy + fail-closed catalogs', () => {
  it('never coerces classes: KNOWLEDGE demand with an expert facet is class-not-allowed', async () => {
    const graph = await buildFixtureGraph();
    const profile = await compile({ escalationModes: ['KNOWLEDGE'] });
    const expert = createExpertCandidate({
      candidate: await fixtureQualifiedRoutingCandidate(graph),
    });
    const match = await matchResources(profile, { experts: [expert] }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(match.outcome).toBe('class-not-allowed');
    expect(causesOfReason(match, 'class-not-allowed-for-mode')).toBe(1);
    expect(match.classes[0]?.allowedByPolicy).toBe(false);
  });

  it('marks unavailable catalogs fail-closed (never a silent empty pool)', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      tool: { requiredToolIds: ['local-rate-database'] },
    });
    const match = await matchResources(
      profile,
      { tools: [fixtureToolCandidate()] },
      {
        requestId: REQUEST_ID,
        evaluatedAt: FIXTURE_EVALUATED_AT,
        unavailableCatalogs: ['tool'],
      },
    );
    expect(match.outcome).toBe('deadline-infeasible'); // catalog-unavailable classification
    expect(causesOfReason(match, 'catalog-unavailable')).toBe(1);
    expect(match.classes[0]?.shortlist).toHaveLength(0);
  });
});

describe('matchResources — determinism + surface', () => {
  it('produces identical digests for identical inputs regardless of candidate order', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      artifact: { artifactKinds: ['dataset', 'environment'] },
    });
    const artifacts = [
      fixtureArtifactCandidate({ offerId: 'offer-a', price: { amountMinorUnits: 1000, currency: 'USD' } }),
      fixtureArtifactCandidate({ offerId: 'offer-b', price: { amountMinorUnits: 1000, currency: 'USD' } }),
      fixtureArtifactCandidate({ offerId: 'offer-c', state: 'retired' }),
    ];
    const first = await matchResources(profile, { artifacts }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const second = await matchResources(profile, { artifacts: [...artifacts].reverse() }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const third = await matchResources(profile, { artifacts }, {
      requestId: REQUEST_ID,
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(first.digest).toBe(second.digest);
    expect(first.digest).toBe(third.digest);
    // Cheaper-first artifact ranking with id tie-break.
    expect(first.classes[0]?.shortlist.map((c) => c.ref)).toEqual(['offer-a', 'offer-b']);
  });

  it('exposes a coherent typed surface', () => {
    expect(RESOURCE_MATCH_VERSION).toBe(1);
    expect(RESOURCE_MATCH_OUTCOMES).toContain('matched');
    expect(RESOURCE_MATCH_OUTCOMES).toContain('incompatible-substrate');
    expect(RESOURCE_MATCH_OUTCOMES).toContain('class-not-allowed');
    expect(ELIMINATION_REASONS).toContain('offer-delisted');
    expect(ELIMINATION_REASONS).toContain('performance-evidence-missing');
    expect(ELIMINATION_REASONS).toHaveLength(22);
    expect(isResourceMatch({})).toBe(false);
    expect(isResourceMatch(null)).toBe(false);
  });

  it('view + causes accessors behave and tampering is typed', async () => {
    const profile = await compile2({
      escalationModes: ['TOOL_GAP'],
      tool: { requiredToolIds: ['local-rate-database'] },
    });
    const match = await matchResources(
      profile,
      { tools: [fixtureToolCandidate({ availability: 'unavailable' })] },
      { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(match.outcome).toBe('deadline-infeasible');
    expect(resourceMatchCauses(match)).toHaveLength(1);
    expect((resourceMatchView(match) as { digest?: string }).digest).toBeUndefined();
    expect(isResourceMatch(match)).toBe(true);
    const tampered: ResourceMatch = { ...match, outcome: 'matched' };
    await expect(recomputeResourceMatchDigest(tampered)).rejects.toThrowError(/digest mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile a demand WITHOUT the default expert facet (per-class tests). */
async function compile2(
  overrides: Parameters<typeof fixtureCrossDemandInput>[0] = {},
): Promise<CrossResourceDemand> {
  const input = fixtureCrossDemandInput(overrides);
  delete (input as { expert?: unknown }).expert;
  const graph = await buildFixtureGraph();
  const result = await compileCrossResourceDemand(input, graph, {
    evaluatedAt: FIXTURE_EVALUATED_AT,
  });
  expect(result.outcome).toBe('compilable');
  if (result.outcome !== 'compilable') throw new Error('fixture demand must compile');
  return result.profile;
}
