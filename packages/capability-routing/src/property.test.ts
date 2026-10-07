/**
 * Property tests (Work Order C015): determinism under input permutation
 * and repetition — the routing invariant (identical inputs ⇒ identical
 * digests, independent of candidate order or run count).
 */

import { describe, expect, it } from 'vitest';
import { matchResources } from './engine.js';
import { compileCrossResourceDemand } from './demand.js';
import { recomputeCrossResourceDemandDigest } from './demand.js';
import { createExpertCandidate } from './catalog.js';
import {
  FIXTURE_EVALUATED_AT,
  buildFixtureGraph,
  fixtureArtifactCandidate,
  fixtureBodyCandidate,
  fixtureCrossDemandInput,
  fixtureKnowledgeCandidate,
  fixtureQualifiedRoutingCandidate,
  fixtureToolCandidate,
} from './test-support.js';

const REQUEST_ID = 'capr_prop0001';

describe('determinism properties', () => {
  it('compile + match digests are stable across repetitions', async () => {
    const graph = await buildFixtureGraph();
    const input = fixtureCrossDemandInput({
      escalationModes: ['SOLVE', 'TOOL_GAP', 'KNOWLEDGE'],
      body: { requiredSubstrate: 'substrate-alpha' },
      tool: { requiredToolIds: ['local-rate-database'] },
      knowledge: { minimumTier: 'candidate-domain-rule' },
      artifact: { artifactKinds: ['dataset'] },
    });
    const digests: string[] = [];
    const matchDigests: string[] = [];
    for (let run = 0; run < 5; run += 1) {
      const compilation = await compileCrossResourceDemand(input, graph, {
        evaluatedAt: FIXTURE_EVALUATED_AT,
      });
      if (compilation.outcome !== 'compilable') throw new Error('fixture demand must compile');
      digests.push(compilation.profile.digest);
      await recomputeCrossResourceDemandDigest(compilation.profile);
      const expert = createExpertCandidate({
        candidate: await fixtureQualifiedRoutingCandidate(graph),
      });
      const match = await matchResources(
        compilation.profile,
        {
          experts: [expert],
          bodies: [fixtureBodyCandidate()],
          tools: [fixtureToolCandidate()],
          knowledge: [fixtureKnowledgeCandidate()],
          artifacts: [fixtureArtifactCandidate()],
        },
        { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
      );
      matchDigests.push(match.digest);
    }
    expect(new Set(digests).size).toBe(1);
    expect(new Set(matchDigests).size).toBe(1);
  });

  it('match digests are invariant under candidate-list permutation', async () => {
    const input = fixtureCrossDemandInput({ escalationModes: ['TOOL_GAP'] });
    delete (input as { expert?: unknown }).expert;
    const graph = await buildFixtureGraph();
    const compilation = await compileCrossResourceDemand(
      { ...input, artifact: { artifactKinds: ['dataset'] }, tool: {} },
      graph,
      { evaluatedAt: FIXTURE_EVALUATED_AT },
    );
    if (compilation.outcome !== 'compilable') throw new Error('fixture demand must compile');
    const tools = [
      fixtureToolCandidate(),
      fixtureToolCandidate({ toolId: 'alt-tool' }),
      fixtureToolCandidate({ availability: 'unavailable' }),
    ];
    const artifacts = [
      fixtureArtifactCandidate({ offerId: 'offer-a', price: { amountMinorUnits: 1000, currency: 'USD' } }),
      fixtureArtifactCandidate({ offerId: 'offer-b' }),
      fixtureArtifactCandidate({ offerId: 'offer-c', state: 'retired' }),
    ];
    const digests: string[] = [];
    for (const permutation of [
      [tools, artifacts],
      [[...tools].reverse(), artifacts],
      [tools, [...artifacts].reverse()],
      [[...tools].reverse(), [...artifacts].reverse()],
    ] as const) {
      const match = await matchResources(
        compilation.profile,
        { tools: permutation[0], artifacts: permutation[1] },
        { requestId: REQUEST_ID, evaluatedAt: FIXTURE_EVALUATED_AT },
      );
      digests.push(match.digest);
    }
    expect(new Set(digests).size).toBe(1);
  });
});
