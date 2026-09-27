/**
 * Pure graph queries (Work Order A004; docs/architecture.md §4: "descriptive
 * and queryable"; requirement R4).
 *
 * Every query here is a pure function: no side effects, no mutation, no
 * re-verification, no I/O. Results are deep-frozen and DETERMINISTIC —
 * answer sets are ordered by node key so repeated queries are idempotent
 * reads, insertion order cannot leak into answers, and "no phantom nodes"
 * holds trivially (every result is resolvable via getNode).
 *
 * Queries never consult or mutate object authority: they traverse the
 * descriptive relations recorded in the graph.
 */

import { capabilityNodeKey } from './identifiers.js';
import type { CapabilityNodeKind } from './identifiers.js';
import type { CapabilityEdge, CapabilityEdgeKind } from './edges.js';
import { indicesFor, getNode } from './graph.js';
import type { CapabilityGraph } from './graph.js';
import { capabilityNodeRef } from './nodes.js';
import type { CapabilityNode, CapabilityNodeRef } from './nodes.js';
import { deepFreeze } from './payload.js';

/** Default traversal for taxonomy queries: parent/child decomposition. */
export const TAXONOMY_EDGE_KINDS: readonly CapabilityEdgeKind[] = ['decomposes-into'];

export interface TraversalOptions {
  /**
   * Edge kinds to traverse (default: decomposes-into for taxonomy queries).
   * The order of this list never affects the result — answers are sorted.
   */
  readonly via?: readonly CapabilityEdgeKind[];
}

function viaKinds(options: TraversalOptions | undefined): readonly CapabilityEdgeKind[] {
  return options?.via ?? TAXONOMY_EDGE_KINDS;
}

/** A frozen, key-sorted list of node refs (deterministic answer shape). */
function frozenRefs(nodes: readonly CapabilityNode[]): readonly CapabilityNodeRef[] {
  return deepFreeze(
    nodes
      .map((node) => capabilityNodeRef(node))
      .sort((a, b) => {
        const keyA = capabilityNodeKey(a);
        const keyB = capabilityNodeKey(b);
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      }),
  );
}

/**
 * Transitive closure over the given edge kinds (forward = along
 * source→target). Deterministic; returns deduplicated nodes.
 */
function closureOver(
  graph: CapabilityGraph,
  start: CapabilityNode,
  options: TraversalOptions | undefined,
  direction: 'forward' | 'reverse',
): readonly CapabilityNode[] {
  const kinds = new Set<string>(viaKinds(options));
  const indices = indicesFor(graph);
  const collect = (key: string): string[] => {
    const edges =
      direction === 'forward'
        ? (indices.outgoing.get(key) ?? [])
        : (indices.incoming.get(key) ?? []);
    const targets: string[] = [];
    for (const edge of edges) {
      if (!kinds.has(edge.kind)) continue;
      targets.push(
        direction === 'forward'
          ? capabilityNodeKey(edge.target)
          : capabilityNodeKey(edge.source),
      );
    }
    return targets;
  };

  const seen = new Set<string>();
  const queue: string[] = [capabilityNodeKey(start)];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of collect(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  seen.delete(capabilityNodeKey(start)); // closure excludes the start node
  return [...seen]
    .map((key) => indices.byKey.get(key))
    .filter((node): node is CapabilityNode => node !== undefined);
}

// ---------------------------------------------------------------------------
// Descendants / ancestors (taxonomy closure)
// ---------------------------------------------------------------------------

/**
 * Descendants of a node: everything reachable by following the traversal
 * edges (default: decomposes-into) forward. The start node itself is not
 * included. Sorted by node key.
 */
export function descendantsOf(
  graph: CapabilityGraph,
  node: CapabilityNode,
  options?: TraversalOptions,
): readonly CapabilityNodeRef[] {
  return frozenRefs(closureOver(graph, node, options, 'forward'));
}

/**
 * Ancestors of a node: everything reachable by following the traversal
 * edges (default: decomposes-into) backward. The start node itself is not
 * included. Sorted by node key.
 */
export function ancestorsOf(
  graph: CapabilityGraph,
  node: CapabilityNode,
  options?: TraversalOptions,
): readonly CapabilityNodeRef[] {
  return frozenRefs(closureOver(graph, node, options, 'reverse'));
}

// ---------------------------------------------------------------------------
// Subgraph by node kinds
// ---------------------------------------------------------------------------

/** A frozen subgraph view: the nodes of the requested kinds plus every edge
 *  whose source AND target are both in the view. */
export interface SubgraphView {
  readonly nodes: readonly CapabilityNode[];
  readonly edges: readonly CapabilityEdge[];
}

/**
 * The subgraph induced by the given node kinds (requirement R4: the graph
 * relates skills, tasks, experts, environments-side declarations and
 * evaluators — kind-filtered views are the queryable form of that).
 */
export function subgraphByKinds(
  graph: CapabilityGraph,
  kinds: readonly CapabilityNodeKind[],
): SubgraphView {
  const wanted = new Set<string>(kinds);
  const nodes = graph.nodes.filter((node) => wanted.has(node.kind));
  const nodeKeys = new Set(nodes.map((node) => capabilityNodeKey(node)));
  const edges = graph.edges.filter(
    (edge) =>
      nodeKeys.has(capabilityNodeKey(edge.source)) &&
      nodeKeys.has(capabilityNodeKey(edge.target)),
  );
  return deepFreeze({ nodes: Object.freeze([...nodes]), edges: Object.freeze([...edges]) });
}

// ---------------------------------------------------------------------------
// Reachable skills for a domain (R4)
// ---------------------------------------------------------------------------

/**
 * Every SKILL reachable from a domain node through the decomposition
 * taxonomy (decomposes-into closure, then filtered to kind === 'skill').
 * This is the requirement-R4 view: the skills a domain's capabilities are
 * made of. Sorted by node key.
 */
export function reachableSkillsForDomain(
  graph: CapabilityGraph,
  domain: CapabilityNode,
): readonly CapabilityNodeRef[] {
  if (domain.kind !== 'domain') {
    return frozenRefs([]);
  }
  const reachable = closureOver(graph, domain, { via: TAXONOMY_EDGE_KINDS }, 'forward');
  return frozenRefs(reachable.filter((node) => node.kind === 'skill'));
}

// ---------------------------------------------------------------------------
// Path queries
// ---------------------------------------------------------------------------

export interface PathQueryOptions extends TraversalOptions {
  /**
   * Safety valve for combinatorial blow-up: stop collecting simple paths and
   * mark the result truncated once this many paths are found
   * (default: 1000).
   */
  readonly maxResults?: number;
}

export interface PathQueryResult {
  /** Simple paths from `from` to `to`, each a list of node refs. */
  readonly paths: readonly (readonly CapabilityNodeRef[])[];
  /** True when the traversal stopped at maxResults. */
  readonly truncated: boolean;
}

/**
 * All simple paths from `from` to `to` over the traversal edges (default:
 * decomposes-into). The hierarchical subgraph is a DAG by construction, but
 * this query is safe on any frozen graph: it explores simple paths only
 * (each path visits a node at most once) and truncates at maxResults.
 */
export function simplePaths(
  graph: CapabilityGraph,
  from: CapabilityNode,
  to: CapabilityNode,
  options?: PathQueryOptions,
): PathQueryResult {
  const kinds = new Set<string>(viaKinds(options));
  const maxResults = options?.maxResults ?? 1000;
  const indices = indicesFor(graph);
  const fromKey = capabilityNodeKey(from);
  const toKey = capabilityNodeKey(to);

  const paths: CapabilityNodeRef[][] = [];
  let truncated = false;

  const walk = (current: string, visited: readonly string[], acc: CapabilityNodeRef[]): void => {
    if (truncated) return;
    if (current === toKey) {
      paths.push([...acc]);
      if (paths.length >= maxResults) truncated = true;
      return;
    }
    const edges = indices.outgoing.get(current) ?? [];
    for (const edge of edges) {
      if (!kinds.has(edge.kind)) continue;
      const nextKey = capabilityNodeKey(edge.target);
      if (visited.includes(nextKey)) continue;
      const nextNode = indices.byKey.get(nextKey);
      if (nextNode === undefined) continue;
      walk(nextKey, [...visited, nextKey], [...acc, capabilityNodeRef(nextNode)]);
      if (truncated) return;
    }
  };

  walk(fromKey, [fromKey], [capabilityNodeRef(from)]);
  return deepFreeze({ paths: Object.freeze(paths), truncated });
}

// ---------------------------------------------------------------------------
// Dependents of a skill (R4, R32)
// ---------------------------------------------------------------------------

/**
 * Dependents of a skill: everything that depends on it — the reverse
 * transitive closure over `requires` (who requires this skill, directly or
 * transitively) unioned with the forward transitive closure over `produces`
 * (whom this skill's outputs feed). Sorted by node key.
 */
export function dependentsOfSkill(
  graph: CapabilityGraph,
  skill: CapabilityNode,
): readonly CapabilityNodeRef[] {
  const requiring = closureOver(graph, skill, { via: ['requires'] }, 'reverse');
  const fedBySkill = closureOver(graph, skill, { via: ['produces'] }, 'forward');
  const merged = [...requiring, ...fedBySkill];
  const seen = new Set<string>();
  const unique: CapabilityNode[] = [];
  for (const node of merged) {
    const key = capabilityNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(node);
  }
  return frozenRefs(unique);
}

// ---------------------------------------------------------------------------
// Convenience resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve a node ref against a graph: returns the node when present AND its
 * digest matches the ref; null otherwise. (Pure lookup — no throws.)
 */
export function resolveNodeRef(
  graph: CapabilityGraph,
  ref: CapabilityNodeRef,
): CapabilityNode | null {
  const node = getNode(graph, ref);
  if (node === null || node.digest !== ref.digest) return null;
  return node;
}

/** Every node of the given kind, sorted by node key. */
export function nodesOfKind(
  graph: CapabilityGraph,
  kind: CapabilityNodeKind,
): readonly CapabilityNode[] {
  return frozenNodes(graph.nodes.filter((node) => node.kind === kind));
}

function frozenNodes(nodes: readonly CapabilityNode[]): readonly CapabilityNode[] {
  return Object.freeze([...nodes].sort((a, b) => {
    const keyA = capabilityNodeKey(a);
    const keyB = capabilityNodeKey(b);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  }));
}
