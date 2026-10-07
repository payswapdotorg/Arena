/**
 * Service integration tests (Work Order C015): one demand → cross-resource
 * match over the injected C002/C005/C008/C014/A032-shaped ports on the
 * reference fabric — full lifecycle: compile → catalog reads → engine →
 * decision history (append + chain).
 */

import { describe, expect, it } from 'vitest';
import { verifyResourceDecisionChain } from '@arena/capability-routing';
import { createArtifactCandidate, createBodyCandidate, createKnowledgeCandidate, createToolCandidate } from '@arena/capability-routing';
import { CapabilityRoutingService } from './service.js';
import {
  FixedClock,
  InMemoryArtifactOfferCatalog,
  InMemoryBodyListingCatalog,
  InMemoryExpertCandidateDirectory,
  InMemoryKnowledgeRecordCatalog,
  InMemoryResourceDecisionLog,
  InMemoryToolCandidateCatalog,
  StaticGraphSource,
} from './fabric.js';
import {
  FIXTURE_CLOCK_START,
  buildFixtureGraph,
  fixtureArtifactCandidateInput,
  fixtureBodyCandidateInput,
  fixtureDemandInput,
  fixtureExpertCandidate,
  fixtureKnowledgeCandidateInput,
  fixtureToolCandidateInput,
} from './test-support.js';

async function fixtureService(): Promise<CapabilityRoutingService> {
  const graph = await buildFixtureGraph();
  const expert = await fixtureExpertCandidate(
    graph,
    {},
    'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90a1',
  );
  return new CapabilityRoutingService({
    clock: new FixedClock(FIXTURE_CLOCK_START),
    graphSource: new StaticGraphSource(graph),
    expertDirectory: new InMemoryExpertCandidateDirectory([expert]),
    bodyCatalog: new InMemoryBodyListingCatalog([createBodyCandidate(fixtureBodyCandidateInput())]),
    toolCatalog: new InMemoryToolCandidateCatalog([createToolCandidate(fixtureToolCandidateInput())]),
    knowledgeCatalog: new InMemoryKnowledgeRecordCatalog([
      createKnowledgeCandidate(fixtureKnowledgeCandidateInput()),
    ]),
    artifactCatalog: new InMemoryArtifactOfferCatalog([
      createArtifactCandidate(fixtureArtifactCandidateInput()),
    ]),
    decisionLog: new InMemoryResourceDecisionLog(),
  });
}

describe('CapabilityRoutingService — the integration path', () => {
  it('routes a five-class demand to a typed composition over the injected ports', async () => {
    const service = await fixtureService();
    const result = await service.routeCrossResource(
      fixtureDemandInput({
        escalationModes: ['SOLVE', 'TOOL_GAP', 'KNOWLEDGE'],
        expert: {},
        body: { requiredSubstrate: 'substrate-alpha', environmentRequirements: ['env-standard'] },
        tool: { requiredToolIds: ['local-rate-database'] },
        knowledge: { minimumTier: 'candidate-domain-rule', requiredScopeKind: 'domain' },
        artifact: { artifactKinds: ['dataset'] },
      }),
      { demandId: 'capr-demand-0001' },
    );
    expect(result.compilation.outcome).toBe('compilable');
    expect(result.match?.outcome).toBe('matched');
    expect(result.decision.outcome).toBe('matched');
    if (result.decision.outcome !== 'matched') return;
    expect(result.decision.components).toEqual([
      'expert:expert-001',
      'body:listing-boq-solver',
      'tool:local-rate-database',
      'knowledge:knowledge-boq-rules',
      'artifact:offer-rates-dataset',
    ]);
    expect(result.match?.composition?.totalCostMinorUnits).toBe(35000);
    // Decision history: append + chain integrity.
    const history = await service.decisionHistory('capr-demand-0001', 'tenant-a');
    expect(history).toHaveLength(1);
    expect(history[0]?.matchDigest).toBe(result.match?.digest);
    await expect(verifyResourceDecisionChain(history)).resolves.toBeUndefined();
  });

  it('is deterministic for identical demands and appends supersession records', async () => {
    const service = await fixtureService();
    const demand = fixtureDemandInput({
      escalationModes: ['TOOL_GAP'],
      tool: { requiredToolIds: ['local-rate-database'] },
      artifact: { artifactKinds: ['dataset'] },
    });
    delete (demand as { expert?: unknown }).expert;
    const first = await service.routeCrossResource(demand, { demandId: 'capr-demand-0002' });
    const second = await service.routeCrossResource(demand, { demandId: 'capr-demand-0002' });
    expect(first.match?.digest).toBe(second.match?.digest);
    expect(first.decision).toEqual(second.decision);
    const history = await service.decisionHistory('capr-demand-0002', 'tenant-a');
    expect(history).toHaveLength(2);
    expect(history[1]?.previousRecordDigest).toBe(history[0]?.digest);
    await expect(verifyResourceDecisionChain(history)).resolves.toBeUndefined();
  });

  it('routes single-class demands through the same seam', async () => {
    const service = await fixtureService();
    const demand = fixtureDemandInput({ escalationModes: ['KNOWLEDGE'], knowledge: {} });
    delete (demand as { expert?: unknown }).expert;
    const result = await service.routeCrossResource(demand, { demandId: 'capr-demand-0003' });
    expect(result.match?.outcome).toBe('matched');
    if (result.decision.outcome !== 'matched') return;
    expect(result.decision.components).toEqual(['knowledge:knowledge-boq-rules']);
  });

  it('fail-closes on an under-specified demand (never an invented match)', async () => {
    const service = await fixtureService();
    const result = await service.routeCrossResource(
      fixtureDemandInput({ capabilityNeed: 'construction.nonexistent' }),
      { demandId: 'capr-demand-0004' },
    );
    expect(result.compilation.outcome).toBe('under-specified');
    expect(result.decision.outcome).toBe('no-match');
    if (result.decision.outcome !== 'no-match') return;
    expect(result.decision.reason).toBe('routing-unavailable');
    expect(result.match).toBeUndefined();
  });

  it('maps the engine outcomes onto the closed seam vocabulary', async () => {
    const service = await fixtureService();
    // A KNOWLEDGE-mode demand with an expert facet is class-not-allowed —
    // never silently coerced to the knowledge class.
    const result = await service.routeCrossResource(
      fixtureDemandInput({ escalationModes: ['KNOWLEDGE'] }),
      { demandId: 'capr-demand-0005' },
    );
    expect(result.match?.outcome).toBe('class-not-allowed');
    if (result.decision.outcome !== 'no-match') return;
    expect(result.decision.reason).toBe('class-not-allowed');
  });
});
