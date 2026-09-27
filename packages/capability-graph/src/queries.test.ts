/**
 * Query tests (Work Order A004, gate 5): pure, deterministic, frozen query
 * results — descendants/ancestors, subgraph by kinds, reachable skills for a
 * domain, simple paths, dependents of a skill, resolvers. Idempotent reads
 * and no phantom nodes.
 */

import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  dependentsOfSkill,
  descendantsOf,
  nodesOfKind,
  reachableSkillsForDomain,
  resolveNodeRef,
  simplePaths,
  subgraphByKinds,
} from './queries.js';
import { buildCapabilityGraph, getNode } from './graph.js';
import { createCapabilityEdge } from './edges.js';
import type { CapabilityEdge } from './edges.js';
import type { CapabilityNode } from './nodes.js';
import { capabilityNodeRef } from './nodes.js';
import { capabilityNodeKey } from './identifiers.js';
import { FIXTURE_PROVENANCE, makeFixtureTaxonomy, makeNode } from './testing.js';

async function fixtureGraph() {
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

describe('descendants / ancestors (taxonomy closure)', () => {
  it('descendants of the domain walk the decomposition tree', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const descendants = descendantsOf(graph, taxonomy.domain);
    expect(descendants.map((ref) => capabilityNodeKey(ref)).sort()).toEqual(
      [
        'capability/code-review@1.0.0',
        'capability/refactoring@1.0.0',
        'skill/read-diff@1.0.0',
        'sub-capability/review-planning@1.0.0',
      ].sort(),
    );
    // the start node is never included
    expect(descendants.map((ref) => capabilityNodeKey(ref))).not.toContain(
      'domain/software-engineering@1.0.0',
    );
  });

  it('ancestors of the leaf skill walk up the tree', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const ancestors = ancestorsOf(graph, taxonomy.skillReadDiff);
    expect(ancestors.map((ref) => capabilityNodeKey(ref)).sort()).toEqual(
      [
        'capability/code-review@1.0.0',
        'domain/software-engineering@1.0.0',
        'sub-capability/review-planning@1.0.0',
      ].sort(),
    );
  });

  it('traversal can be customized (via requires: skill-level dependents)', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const requiring = descendantsOf(graph, taxonomy.skillReadDiff, {
      via: ['requires'],
    });
    expect(requiring.map((ref) => capabilityNodeKey(ref))).toEqual([
      'skill/read-source@1.0.0',
    ]);
  });
});

describe('subgraph by kinds', () => {
  it('filters nodes and keeps only edges inside the view', async () => {
    const { graph } = await fixtureGraph();
    const skillsOnly = subgraphByKinds(graph, ['skill']);
    expect(skillsOnly.nodes).toHaveLength(3);
    expect(skillsOnly.edges).toHaveLength(2); // requires + produces between skills
    const noKinds = subgraphByKinds(graph, []);
    expect(noKinds.nodes).toHaveLength(0);
    expect(noKinds.edges).toHaveLength(0);
    const domainAndSkills = subgraphByKinds(graph, ['domain', 'skill']);
    // decomposes-into edges domain->capability are cut (capability not in view)
    expect(domainAndSkills.nodes).toHaveLength(4);
    expect(domainAndSkills.edges).toHaveLength(2);
    expect(Object.isFrozen(skillsOnly.nodes)).toBe(true);
  });
});

describe('reachable skills for a domain (R4)', () => {
  it('collects exactly the skills under the domain decomposition', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const skills = reachableSkillsForDomain(graph, taxonomy.domain);
    expect(skills.map((ref) => capabilityNodeKey(ref))).toEqual(['skill/read-diff@1.0.0']);
  });

  it('returns empty for non-domain start nodes', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    expect(reachableSkillsForDomain(graph, taxonomy.skillReadDiff)).toEqual([]);
  });
});

describe('simple paths', () => {
  it('finds every simple path from the domain to the skill', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const result = simplePaths(graph, taxonomy.domain, taxonomy.skillReadDiff);
    expect(result.truncated).toBe(false);
    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path?.map((ref) => capabilityNodeKey(ref))).toEqual([
      'domain/software-engineering@1.0.0',
      'capability/code-review@1.0.0',
      'sub-capability/review-planning@1.0.0',
      'skill/read-diff@1.0.0',
    ]);
  });

  it('finds no path between disconnected nodes', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const result = simplePaths(graph, taxonomy.skillReadSource, taxonomy.domain);
    expect(result.paths).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });

  it('finds multiple simple paths in a diamond', async () => {
    const t = await makeFixtureTaxonomy();
    // domain -> a, domain -> b, a -> c, b -> c (diamond over c)
    const a = await makeSkillNode('diamond-a');
    const b = await makeSkillNode('diamond-b');
    const c = await makeSkillNode('diamond-c');
    const elements = await Promise.all([
      Promise.resolve(t.domain),
      Promise.resolve(a),
      Promise.resolve(b),
      Promise.resolve(c),
      edge('decomposes-into', t.domain, a),
      edge('decomposes-into', t.domain, b),
      edge('decomposes-into', a, c),
      edge('decomposes-into', b, c),
    ]);
    const graph = await buildCapabilityGraph(elements);
    const result = simplePaths(graph, t.domain, c);
    expect(result.paths).toHaveLength(2);
    for (const path of result.paths) {
      expect(path[0]?.kind).toBe('domain');
      expect(path[path.length - 1]?.id).toBe('diamond-c');
    }
  });

  it('truncates at maxResults', async () => {
    const t = await makeFixtureTaxonomy();
    const a = await makeSkillNode('trunc-a');
    const b = await makeSkillNode('trunc-b');
    const c = await makeSkillNode('trunc-c');
    const graph = await buildCapabilityGraph(
      await Promise.all([
        Promise.resolve(t.domain),
        Promise.resolve(a),
        Promise.resolve(b),
        Promise.resolve(c),
        edge('decomposes-into', t.domain, a),
        edge('decomposes-into', t.domain, b),
        edge('decomposes-into', a, c),
        edge('decomposes-into', b, c),
      ]),
    );
    const result = simplePaths(graph, t.domain, c, { maxResults: 1 });
    expect(result.paths).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe('dependents of a skill', () => {
  it('reverse requires closure plus forward produces closure', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    // read-source is required by read-diff; read-diff is required by nothing.
    const dependentsOfSource = dependentsOfSkill(graph, taxonomy.skillReadSource);
    expect(dependentsOfSource.map((ref) => capabilityNodeKey(ref))).toEqual([
      'skill/read-diff@1.0.0',
    ]);
    // read-diff produces for write-review-notes: that skill depends on it.
    const dependentsOfDiff = dependentsOfSkill(graph, taxonomy.skillReadDiff);
    expect(dependentsOfDiff.map((ref) => capabilityNodeKey(ref))).toEqual([
      'skill/write-review-notes@1.0.0',
    ]);
  });
});

describe('query invariants (gate 5)', () => {
  it('queries are idempotent reads (byte-equal, frozen)', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const first = descendantsOf(graph, taxonomy.domain);
    const second = descendantsOf(graph, taxonomy.domain);
    expect(first).toEqual(second);
    expect(first).not.toBe(second); // fresh frozen results
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as unknown as { push(item: unknown): void }).push(
        capabilityNodeRef(taxonomy.skillReadDiff),
      );
    }).toThrow(TypeError);
  });

  it('no phantom nodes: every query result resolves in the graph', async () => {
    const { taxonomy, graph } = await fixtureGraph();
    const all = [
      ...descendantsOf(graph, taxonomy.domain),
      ...ancestorsOf(graph, taxonomy.skillReadDiff),
      ...reachableSkillsForDomain(graph, taxonomy.domain),
      ...dependentsOfSkill(graph, taxonomy.skillReadDiff),
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const ref of all) {
      const node = resolveNodeRef(graph, ref);
      expect(node, `phantom node: ${capabilityNodeKey(ref)}`).not.toBeNull();
      expect(getNode(graph, ref)?.digest).toBe(ref.digest);
    }
  });

  it('nodesOfKind lists every node of a kind, key-sorted', async () => {
    const { graph } = await fixtureGraph();
    const skills = nodesOfKind(graph, 'skill');
    expect(skills.map((node) => capabilityNodeKey(node))).toEqual([
      'skill/read-diff@1.0.0',
      'skill/read-source@1.0.0',
      'skill/write-review-notes@1.0.0',
    ]);
    expect(nodesOfKind(graph, 'verifier')).toEqual([]);
  });
});

// -- local helpers ----------------------------------------------------------

async function makeSkillNode(id: string): Promise<CapabilityNode> {
  return makeNode('skill', id, '1.0.0', {
    provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
  });
}

function edge(
  kind: 'decomposes-into' | 'requires' | 'produces',
  source: { kind: string; id: string; version: string; digest: string },
  target: { kind: string; id: string; version: string; digest: string },
): Promise<CapabilityEdge> {
  return createCapabilityEdge({
    kind,
    source,
    target,
    provenance: { recordDigest: FIXTURE_PROVENANCE.recordDigest },
  });
}
