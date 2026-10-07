/**
 * Cross-resource demand compiler tests (Work Order C015): typed closed
 * outcomes, per-facet validation, C002 delegation, determinism, digest
 * integrity.
 */

import { describe, expect, it } from 'vitest';
import {
  CROSS_RESOURCE_DEMAND_VERSION,
  CROSS_UNDER_SPECIFIED_REASONS,
  compileCrossResourceDemand,
  crossResourceDemandView,
  embeddedExpertProfileView,
  isCrossResourceDemand,
  recomputeCrossResourceDemandDigest,
} from './demand.js';
import type { CrossResourceDemandInput } from './demand.js';
import { CapabilityRoutingError } from './errors.js';
import {
  FIXTURE_EVALUATED_AT,
  buildFixtureGraph,
  fixtureCrossDemandInput,
} from './test-support.js';

describe('compileCrossResourceDemand', () => {
  it('compiles a single-class expert demand by delegating to the C002 compiler', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileCrossResourceDemand(fixtureCrossDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    expect(result.profile.profileVersion).toBe(CROSS_RESOURCE_DEMAND_VERSION);
    expect(result.profile.requestedClasses).toEqual(['expert']);
    expect(result.profile.expertProfile).toBeDefined();
    expect(result.profile.facets.expert?.profileDigest).toBe(result.profile.expertProfile?.digest);
    expect(result.profile.escalationModes).toEqual(['SOLVE']);
    await expect(recomputeCrossResourceDemandDigest(result.profile)).resolves.toBe(
      result.profile.digest,
    );
  });

  it('compiles every resource-class facet deterministically', async () => {
    const graph = await buildFixtureGraph();
    const input = fixtureCrossDemandInput({
      escalationModes: ['SOLVE', 'TOOL_GAP', 'KNOWLEDGE'],
      body: { requiredSubstrate: 'substrate-alpha', environmentRequirements: ['env-standard'] },
      tool: { requiredToolIds: ['local-rate-database'] },
      knowledge: { minimumTier: 'verified-domain-constraint', requiredScopeKind: 'domain' },
      artifact: { artifactKinds: ['dataset', 'environment'], entitlementRequired: true },
    });
    const first = await compileCrossResourceDemand(input, graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    const second = await compileCrossResourceDemand(input, graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(first.outcome).toBe('compilable');
    expect(second.outcome).toBe('compilable');
    if (first.outcome !== 'compilable' || second.outcome !== 'compilable') return;
    expect(first.profile.digest).toBe(second.profile.digest);
    expect(first.profile.requestedClasses).toEqual([
      'expert',
      'body',
      'tool',
      'knowledge',
      'artifact',
    ]);
    expect(first.profile.facets.body?.requiredSubstrate).toBe('substrate-alpha');
    expect(first.profile.facets.knowledge?.minimumTier).toBe('verified-domain-constraint');
    expect(first.profile.facets.artifact?.artifactKinds).toEqual(['dataset', 'environment']);
    expect(Object.isFrozen(first.profile)).toBe(true);
    expect(Object.isFrozen(first.profile.requestedClasses)).toBe(true);
  });

  it('is under-specified-with-reasons when no resource-class facet is requested', async () => {
    const graph = await buildFixtureGraph();
    const input = fixtureCrossDemandInput();
    delete (input as { expert?: unknown }).expert;
    const result = await compileCrossResourceDemand(input, graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('resource-class-missing');
  });

  it('is under-specified when the delegated C002 expert demand is under-specified', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileCrossResourceDemand(
      fixtureCrossDemandInput({ capabilityNeed: 'construction.nonexistent' }),
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('under-specified');
    if (result.outcome !== 'under-specified') return;
    expect(result.reasons).toContain('expert-demand-under-specified');
    expect(result.unresolved).toContain('construction.nonexistent');
  });

  it('carries the closed under-specification vocabulary for malformed facets', async () => {
    const graph = await buildFixtureGraph();
    const cases: readonly [Partial<Record<string, unknown>>, string][] = [
      [{ escalationModes: ['SOLVE', 'NOT_A_MODE'] }, 'escalation-mode-invalid'],
      [{ locale: 'not-a-locale' }, 'locale-malformed'],
      [{ budget: { amountMinorUnits: -1, currency: 'USD' } }, 'budget-malformed'],
      [{ deadline: 'never' }, 'deadline-malformed'],
      [{ body: { requiredSubstrate: 'BAD SUBSTRATE' } }, 'body-substrate-malformed'],
      [{ tool: { requiredToolIds: ['BAD TOOL'] } }, 'tool-demand-malformed'],
      [{ knowledge: { minimumTier: 'universal-truth' } }, 'knowledge-tier-invalid'],
      [{ knowledge: { requiredScopeKind: 'galaxy' } }, 'knowledge-scope-invalid'],
      [{ artifact: { artifactKinds: ['model'] } }, 'artifact-kind-invalid'],
    ];
    for (const [overrides, expectedReason] of cases) {
      const result = await compileCrossResourceDemand(
        fixtureCrossDemandInput(overrides as unknown as Partial<CrossResourceDemandInput>),
        graph,
        { evaluatedAt: FIXTURE_EVALUATED_AT },
      );
      expect(result.outcome, JSON.stringify(overrides)).toBe('under-specified');
      if (result.outcome !== 'under-specified') continue;
      expect(result.reasons, JSON.stringify(overrides)).toContain(expectedReason);
    }
    expect(CROSS_UNDER_SPECIFIED_REASONS).toHaveLength(12);
  });

  it('is not-derivable (graph-missing) when the expert facet has no graph', async () => {
    const result = await compileCrossResourceDemand(fixtureCrossDemandInput(), null, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('not-derivable');
    if (result.outcome !== 'not-derivable') return;
    expect(result.reason).toBe('graph-missing');
  });

  it('is not-derivable (graph-lookup-failed) on a non-graph object', async () => {
    const result = await compileCrossResourceDemand(
      fixtureCrossDemandInput(),
      {} as never,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('not-derivable');
    if (result.outcome !== 'not-derivable') return;
    expect(result.reason).toBe('graph-missing');
  });

  it('compiles non-expert demands without a graph', async () => {
    const input = fixtureCrossDemandInput();
    delete (input as { expert?: unknown }).expert;
    const result = await compileCrossResourceDemand(
      { ...input, tool: { requiredToolIds: ['local-rate-database'] } },
      null,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    expect(result.outcome).toBe('compilable');
  });

  it('throws typed INVALID_DEMAND_INPUT for a non-object input', async () => {
    const graph = await buildFixtureGraph();
    await expect(
      compileCrossResourceDemand(null as never, graph, { evaluatedAt: FIXTURE_EVALUATED_AT }),
    ).rejects.toBeInstanceOf(CapabilityRoutingError);
  });

  it('structural guard + views behave', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileCrossResourceDemand(fixtureCrossDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    expect(isCrossResourceDemand(result.profile)).toBe(true);
    expect(isCrossResourceDemand({})).toBe(false);
    const view = crossResourceDemandView(result.profile);
    expect((view as { digest?: string }).digest).toBeUndefined();
    expect(embeddedExpertProfileView(result.profile)?.capabilityNeed).toBe(
      result.profile.capabilityNeed,
    );
  });

  it('detects digest tampering (typed TAMPERED)', async () => {
    const graph = await buildFixtureGraph();
    const result = await compileCrossResourceDemand(fixtureCrossDemandInput(), graph, {
      evaluatedAt: FIXTURE_EVALUATED_AT,
    });
    expect(result.outcome).toBe('compilable');
    if (result.outcome !== 'compilable') return;
    const tampered = { ...result.profile, urgency: 'low' };
    await expect(recomputeCrossResourceDemandDigest(tampered)).rejects.toThrowError(
      /digest mismatch/,
    );
  });
});
