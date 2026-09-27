/**
 * Graph tests (Work Order A004, gates 4, 6, 11): append-only semantics,
 * idempotent re-assertion, identity immutability, fail-closed admission,
 * the acyclic taxonomy invariant (cycle rejection with the offending path in
 * the error), linear supersession-by-append, deep-freeze of the graph, and
 * the order-independent whole-graph digest.
 */

import { describe, expect, it } from 'vitest';
import {
  appendEdge,
  appendNode,
  buildCapabilityGraph,
  capabilityGraphDigest,
  emptyCapabilityGraph,
  getNode,
  getNodeByDigest,
  isCapabilityGraph,
  isNodeSuperseded,
  latestNodeVersion,
  nodeVersionsOf,
  supersedingNodeOf,
  verifyCapabilityGraph,
} from './graph.js';
import { createCapabilityEdge } from './edges.js';
import { CAPABILITY_GRAPH_ERROR_CODES } from './errors.js';
import { CapabilityGraphError } from './errors.js';
import { createCapabilityNode } from './nodes.js';
import { FIXTURE_PROVENANCE, FIXTURE_PROVENANCE_2, makeFixtureTaxonomy, makeNode, skillPayload } from './testing.js';

async function taxonomyGraph() {
  const t = await makeFixtureTaxonomy();
  const elements = [
    t.domain,
    t.capabilityReview,
    t.capabilityRefactoring,
    t.subCapabilityPlanning,
    t.skillReadDiff,
    t.skillReadSource,
    t.skillWriteNotes,
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: t.domain,
      target: t.capabilityReview,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: t.domain,
      target: t.capabilityRefactoring,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: t.capabilityReview,
      target: t.subCapabilityPlanning,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
    await createCapabilityEdge({
      kind: 'decomposes-into',
      source: t.subCapabilityPlanning,
      target: t.skillReadDiff,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
    await createCapabilityEdge({
      kind: 'requires',
      source: t.skillReadDiff,
      target: t.skillReadSource,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
    await createCapabilityEdge({
      kind: 'produces',
      source: t.skillReadDiff,
      target: t.skillWriteNotes,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    }),
  ];
  return { taxonomy: t, graph: await buildCapabilityGraph(elements) };
}

describe('graph construction (positive)', () => {
  it('builds the fixture taxonomy with all nodes and edges', async () => {
    const { graph } = await taxonomyGraph();
    expect(graph.nodes).toHaveLength(7);
    expect(graph.edges).toHaveLength(6);
    expect(isCapabilityGraph(graph)).toBe(true);
    expect(Object.isFrozen(graph)).toBe(true);
    expect(Object.isFrozen(graph.nodes)).toBe(true);
    await expect(verifyCapabilityGraph(graph)).resolves.toBeUndefined();
  });

  it('the empty graph is a frozen singleton', () => {
    const empty = emptyCapabilityGraph();
    expect(empty.nodes).toHaveLength(0);
    expect(empty.edges).toHaveLength(0);
    expect(empty.packs).toHaveLength(0);
    expect(emptyCapabilityGraph()).toBe(empty);
    expect(() => {
      (empty as unknown as Record<string, unknown>)['nodes'] = [];
    }).toThrow(TypeError);
    expect(() => {
      (empty.nodes as unknown as { push(item: unknown): void }).push({ kind: 'domain' });
    }).toThrow(TypeError);
  });

  it('appendNode/appendEdge are pure: the original graph is untouched', async () => {
    const { taxonomy, graph } = await taxonomyGraph();
    const extra = await makeNode('tool', 'extra-tool', '1.0.0');
    const next = await appendNode(graph, extra);
    expect(next).not.toBe(graph);
    expect(next.nodes).toHaveLength(graph.nodes.length + 1);
    expect(graph.nodes).toHaveLength(7); // original unchanged
    const extraEdge = await createCapabilityEdge({
      kind: 'requires',
      source: taxonomy.skillReadDiff,
      target: extra,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const nextNext = await appendEdge(next, extraEdge);
    expect(nextNext.edges).toHaveLength(next.edges.length + 1);
    expect(next.edges).toHaveLength(6);
    expect(nextNext.nodes).toHaveLength(8);
  });
});

describe('graph admission (negative — fail closed)', () => {
  it('rejects a structurally invalid node', async () => {
    await expect(
      appendNode(emptyCapabilityGraph(), { kind: 'tool' } as never),
    ).rejects.toMatchObject({ code: CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE });
  });

  it('rejects a node whose claimed digest does not match its content', async () => {
    const honest = await makeNode('tool', 't', '1.0.0');
    const liar = { ...honest, payload: { title: 'Something else entirely' } };
    await expect(appendNode(emptyCapabilityGraph(), liar)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects the same identity with different content (identity immutability)', async () => {
    const a = await makeNode('tool', 't', '1.0.0');
    const graph = await appendNode(emptyCapabilityGraph(), a);
    const conflicting = await makeNode('tool', 't', '1.0.0', {
      payload: { title: 'A different tool' },
    });
    await expect(appendNode(graph, conflicting)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('idempotently re-asserts bit-identical nodes and edges', async () => {
    const { taxonomy, graph } = await taxonomyGraph();
    const same = await appendNode(graph, taxonomy.skillReadDiff);
    expect(same).toBe(graph); // same object: nothing appended
    const sameEdge = graph.edges[0];
    expect(sameEdge).toBeDefined();
    if (sameEdge === undefined) throw new Error('fixture edge missing');
    const reasserted = await appendEdge(graph, sameEdge);
    expect(reasserted).toBe(graph);
  });

  it('rejects edges whose endpoints are missing', async () => {
    const { taxonomy } = await taxonomyGraph();
    const orphanEdge = await createCapabilityEdge({
      kind: 'requires',
      source: taxonomy.skillReadDiff,
      target: taxonomy.skillReadSource,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(
      appendEdge(emptyCapabilityGraph(), orphanEdge),
    ).rejects.toMatchObject({ code: CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND });
  });

  it('rejects edges whose endpoint digests disagree with the graph', async () => {
    const { taxonomy } = await taxonomyGraph();
    const graph = await buildCapabilityGraph([
      taxonomy.skillReadDiff,
      taxonomy.skillReadSource,
    ]);
    const staleTarget = {
      ...taxonomy.skillReadSource,
      digest: 'f'.repeat(64),
    };
    const staleEdge = await createCapabilityEdge({
      kind: 'requires',
      source: taxonomy.skillReadDiff,
      target: staleTarget,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(appendEdge(graph, staleEdge)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.TAMPERED,
    });
  });

  it('rejects the same edge identity with different content', async () => {
    const { taxonomy, graph } = await taxonomyGraph();
    const variant = await createCapabilityEdge({
      kind: 'requires',
      source: taxonomy.skillReadDiff,
      target: taxonomy.skillReadSource,
      payload: { note: 'variant with a note' },
      provenance: { recordDigest: FIXTURE_PROVENANCE_2.recordDigest },
    });
    await expect(appendEdge(graph, variant)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT,
    });
  });

  it('rejects unknown elements in buildCapabilityGraph', async () => {
    await expect(
      buildCapabilityGraph([{ kind: 'mystery' } as never]),
    ).rejects.toMatchObject({ code: CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE_KIND });
  });
});

describe('skill taxonomy cycle rejection (gate 4)', () => {
  it('a decomposes-into cycle throws with the offending path in the message', async () => {
    const skillA = await makeNode('skill', 'skill-a', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const skillB = await makeNode('skill', 'skill-b', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    let graph = await buildCapabilityGraph([skillA, skillB]);
    graph = await appendEdge(
      graph,
      await createCapabilityEdge({
        kind: 'decomposes-into',
        source: skillA,
        target: skillB,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    );
    const closingEdge = await createCapabilityEdge({
      kind: 'decomposes-into',
      source: skillB,
      target: skillA,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    let caught: unknown;
    try {
      graph = await appendEdge(graph, closingEdge);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CapabilityGraphError);
    const graphError = caught as CapabilityGraphError;
    expect(graphError.code).toBe(CAPABILITY_GRAPH_ERROR_CODES.CYCLE_DETECTED);
    expect(graphError.message).toContain('cycle detected inserting decomposes-into edge');
    // The offending path starts at the closing edge's source and walks the
    // full cycle back to it: skill-b -> skill-a -> skill-b.
    expect(graphError.message).toContain(
      'skill/skill-b@1.0.0 -> skill/skill-a@1.0.0 -> skill/skill-b@1.0.0',
    );
    const path = (graphError.details as { path?: string[] }).path;
    expect(path).toEqual([
      'skill/skill-b@1.0.0',
      'skill/skill-a@1.0.0',
      'skill/skill-b@1.0.0',
    ]);
    // the failed append left the graph untouched
    expect(graph.edges).toHaveLength(1);
  });

  it('a requires cycle throws with the offending path (longer chain)', async () => {
    const skills = await Promise.all(
      ['sk-1', 'sk-2', 'sk-3'].map((id) =>
        makeNode('skill', id, '1.0.0', {
          provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
        }),
      ),
    );
    const [sk1, sk2, sk3] = skills;
    if (sk1 === undefined || sk2 === undefined || sk3 === undefined) {
      throw new Error('fixture skills missing');
    }
    let graph = await buildCapabilityGraph(skills);
    graph = await appendEdge(
      graph,
      await createCapabilityEdge({
        kind: 'requires',
        source: sk1,
        target: sk2,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    );
    graph = await appendEdge(
      graph,
      await createCapabilityEdge({
        kind: 'requires',
        source: sk2,
        target: sk3,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    );
    await expect(
      appendEdge(
        graph,
        await createCapabilityEdge({
          kind: 'requires',
          source: sk3,
          target: sk1,
          provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
        }),
      ),
    ).rejects.toThrow(
      /skill\/sk-3@1\.0\.0 -> skill\/sk-1@1\.0\.0 -> skill\/sk-2@1\.0\.0 -> skill\/sk-3@1\.0\.0/,
    );
  });

  it('an extends-domain cycle throws too (domains do not fork the lifecycle)', async () => {
    const domainA = await makeNode('domain', 'dom-a', '1.0.0');
    const domainB = await makeNode('domain', 'dom-b', '1.0.0');
    let graph = await buildCapabilityGraph([domainA, domainB]);
    graph = await appendEdge(
      graph,
      await createCapabilityEdge({
        kind: 'extends-domain',
        source: domainA,
        target: domainB,
        provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      }),
    );
    await expect(
      appendEdge(
        graph,
        await createCapabilityEdge({
          kind: 'extends-domain',
          source: domainB,
          target: domainA,
          provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
        }),
      ),
    ).rejects.toMatchObject({ code: CAPABILITY_GRAPH_ERROR_CODES.CYCLE_DETECTED });
  });

  it('non-hierarchical edges do not participate in cycle rejection', async () => {
    const { taxonomy, graph } = await taxonomyGraph();
    // evaluates/competent-in etc. are descriptive relations, not hierarchy:
    const evaluator = await makeNode('evaluator', 'review-evaluator', '1.0.0');
    const withEvaluator = await appendNode(graph, evaluator);
    const evaluates = await createCapabilityEdge({
      kind: 'evaluates',
      source: evaluator,
      target: taxonomy.skillReadDiff,
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    await expect(appendEdge(withEvaluator, evaluates)).resolves.toBeDefined();
  });
});

describe('supersession (append-only, gate 6)', () => {
  it('superseding a node keeps the original immutable and addressable', async () => {
    const v1 = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    let graph = await appendNode(emptyCapabilityGraph(), v1);
    const v2 = await makeNode('skill', 'read-diff', '1.1.0', {
      payload: skillPayload({ summary: 'Improved diff reading.' }),
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const superseding = await createCapabilityNode({
      kind: 'skill',
      id: 'read-diff',
      version: '1.2.0',
      payload: skillPayload({ summary: 'Even better diff reading.' }),
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: v1.digest,
    });
    graph = await appendNode(graph, v2);
    graph = await appendNode(graph, superseding);

    // the original is still there, immutable and addressable
    expect(graph.nodes).toHaveLength(3);
    const original = getNode(graph, { kind: 'skill', id: 'read-diff', version: '1.0.0' });
    expect(original).toBe(v1);
    expect(original?.digest).toBe(v1.digest);
    expect(getNodeByDigest(graph, v1.digest)).toBe(v1);
    expect(Object.isFrozen(original)).toBe(true);

    // supersession bookkeeping
    expect(isNodeSuperseded(graph, v1)).toBe(true);
    expect(isNodeSuperseded(graph, v2)).toBe(false);
    expect(supersedingNodeOf(graph, v1)?.version).toBe('1.2.0');
    expect(latestNodeVersion(graph, { kind: 'skill', id: 'read-diff' })?.version).toBe('1.2.0');
    expect(nodeVersionsOf(graph, { kind: 'skill', id: 'read-diff' })).toHaveLength(3);
  });

  it('rejects supersession of an unknown digest', async () => {
    const v1 = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await appendNode(emptyCapabilityGraph(), v1);
    const bogus = await makeNode('skill', 'read-diff', '2.0.0', {
      payload: skillPayload(),
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: 'e'.repeat(64),
    });
    await expect(appendNode(graph, bogus)).rejects.toMatchObject({
      code: CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
    });
  });

  it('rejects supersession across logical nodes', async () => {
    const v1 = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const other = await makeNode('skill', 'other-skill', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await buildCapabilityGraph([v1, other]);
    const impostor = await makeNode('skill', 'other-skill', '2.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: v1.digest,
    });
    await expect(appendNode(graph, impostor)).rejects.toThrow(/same logical node/);
  });

  it('rejects supersession that does not raise the version', async () => {
    const v2 = await makeNode('skill', 'read-diff', '2.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const graph = await appendNode(emptyCapabilityGraph(), v2);
    const lower = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: v2.digest,
    });
    await expect(appendNode(graph, lower)).rejects.toThrow(/strictly higher/);
  });

  it('rejects forked supersession (linear chains only)', async () => {
    const v1 = await makeNode('skill', 'read-diff', '1.0.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
    });
    const v2 = await makeNode('skill', 'read-diff', '1.1.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: v1.digest,
    });
    const graph = await buildCapabilityGraph([v1, v2]);
    const fork = await makeNode('skill', 'read-diff', '1.2.0', {
      provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
      supersedes: v1.digest, // v1 is already superseded by v2
    });
    await expect(appendNode(graph, fork)).rejects.toThrow(/forked supersession/);
  });
});

describe('deep-freeze of the graph (gate 6)', () => {
  it('any mutation attempt on the graph throws', async () => {
    const { graph } = await taxonomyGraph();
    expect(() => {
      (graph as unknown as Record<string, unknown>)['nodes'] = [];
    }).toThrow(TypeError);
    expect(() => {
      (graph as unknown as Record<string, unknown>)['edges'] = [];
    }).toThrow(TypeError);
    expect(() => {
      (graph.nodes as unknown as { push(item: unknown): void }).push({ kind: 'domain' });
    }).toThrow(TypeError);
    expect(() => {
      (graph.edges as unknown as { pop(): unknown }).pop();
    }).toThrow(TypeError);
    expect(() => {
      (graph.packs as unknown as { push(item: unknown): void }).push({});
    }).toThrow(TypeError);
    // no API rewrites or deletes history: the frozen arrays prove the point
    expect(graph.nodes).toHaveLength(7);
    expect(graph.edges).toHaveLength(6);
  });
});

describe('whole-graph digest (order-independent)', () => {
  it('same content in different append orders shares the graph digest', async () => {
    const { taxonomy, graph } = await taxonomyGraph();
    const reordered = await buildCapabilityGraph([
      taxonomy.skillReadSource,
      taxonomy.capabilityRefactoring,
      taxonomy.skillWriteNotes,
      taxonomy.domain,
      taxonomy.skillReadDiff,
      taxonomy.capabilityReview,
      taxonomy.subCapabilityPlanning,
      ...[...graph.edges].reverse(),
    ]);
    expect(reordered.nodes).toHaveLength(7);
    expect(reordered.edges).toHaveLength(6);
    await expect(capabilityGraphDigest(reordered)).resolves.toBe(
      await capabilityGraphDigest(graph),
    );
  });

  it('different content yields a different graph digest', async () => {
    const { graph } = await taxonomyGraph();
    const extra = await makeNode('tool', 'extra', '1.0.0');
    const bigger = await appendNode(graph, extra);
    expect(await capabilityGraphDigest(bigger)).not.toBe(await capabilityGraphDigest(graph));
  });
});
