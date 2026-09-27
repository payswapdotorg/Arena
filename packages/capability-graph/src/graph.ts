/**
 * The Capability Graph — an append-only, deep-frozen, descriptive graph of
 * versioned, digest-addressed nodes and provenance-bearing edges
 * (Work Order A004; docs/architecture.md §4; requirements R4, R17, R32).
 *
 *   "It is descriptive and queryable; it does not replace object authority."
 *
 * Core invariants (all machine-enforced):
 *
 *   1. APPEND-ONLY (architecture-lock rule 6): the ONLY mutation-shaped
 *      operations are appendNode / appendEdge / applyDomainPack, and each of
 *      them is PURE — it returns a NEW frozen graph and leaves the original
 *      untouched. There is no update, no delete, no rewrite API. Supersession
 *      is expressed by APPENDING a new node version whose `supersedes` field
 *      carries the superseded node's digest; the original stays immutable and
 *      addressable forever.
 *
 *   2. DEEP-FREEZE: the graph and every node/edge are deep-frozen at
 *      creation; any in-place mutation attempt throws TypeError (ESM strict
 *      mode). Query results are frozen too.
 *
 *   3. CONTENT ADDRESSING: nodes and edges are admitted only after their
 *      claimed digest is re-verified against their canonical content
 *      (fail-closed, CAPABILITY_GRAPH_TAMPERED). One identity key ⇒ one
 *      digest, forever (CAPABILITY_GRAPH_IDENTITY_CONFLICT otherwise);
 *      bit-identical re-assertion is idempotent.
 *
 *   4. ACYCLIC SKILL TAXONOMY: the subgraph induced by the hierarchical edge
 *      kinds (decomposes-into, extends-domain, requires, produces) is a DAG.
 *      Inserting an edge that would close a cycle throws
 *      CAPABILITY_GRAPH_CYCLE_DETECTED with the offending node path in the
 *      message and in details.path.
 *
 *   5. LINEAR SUPERSESSION: a supersession must target the same logical node
 *      (same kind and id) at a strictly lower version, and each node version
 *      can be superseded at most once (no forks).
 *
 * The graph is descriptive: object authority (the actual skills, artifacts,
 * bodies, evaluators) lives in the owning protocols; nodes carry
 * content-addressed provenance references pointing at that authority.
 */

import { digestCanonical } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';
import {
  capabilityNodeKey,
  capabilityNodeLogicalKey,
  compareCapabilityNodeVersions,
  isCapabilityNodeKind,
} from './identifiers.js';
import type { CapabilityNodeKind } from './identifiers.js';
import {
  EDGE_ENDPOINTS,
  HIERARCHICAL_EDGE_KINDS,
  capabilityEdgeKey,
  isCapabilityEdge,
  isCapabilityEdgeKind,
  verifyCapabilityEdge,
} from './edges.js';
import type { CapabilityEdge, CapabilityEdgeKind } from './edges.js';
import {
  capabilityNodeRef,
  isCapabilityNode,
  verifyCapabilityNode,
} from './nodes.js';
import type { CapabilityNode, CapabilityNodeRef } from './nodes.js';
import { deepFreeze } from './payload.js';
import type { AppliedDomainPack } from './domain-pack.js';

// ---------------------------------------------------------------------------
// Graph shape
// ---------------------------------------------------------------------------

/** An element that can be appended to a capability graph. */
export type CapabilityGraphElement = CapabilityNode | CapabilityEdge;

/** The append-only, descriptive capability graph (deep-frozen). */
export interface CapabilityGraph {
  /** Every admitted node, in append order. Never rewritten, never removed. */
  readonly nodes: readonly CapabilityNode[];
  /** Every admitted edge, in append order. Never rewritten, never removed. */
  readonly edges: readonly CapabilityEdge[];
  /** Every applied domain pack, in application order (append-only). */
  readonly packs: readonly AppliedDomainPack[];
}

/** Derived, regenerable indices over a graph (module-private cache). */
interface GraphIndices {
  /** identity key → node */
  readonly byKey: Map<string, CapabilityNode>;
  /** digest → node */
  readonly byDigest: Map<string, CapabilityNode>;
  /** logical key → node keys (all versions of a logical node) */
  readonly byLogicalKey: Map<string, string[]>;
  /** hierarchical adjacency: source key → target keys */
  readonly adjacency: Map<string, string[]>;
  /** hierarchical reverse adjacency: target key → source keys */
  readonly reverseAdjacency: Map<string, string[]>;
  /** edge key → edge */
  readonly edgeByKey: Map<string, CapabilityEdge>;
  /** node key → outgoing edges (all kinds) */
  readonly outgoing: Map<string, CapabilityEdge[]>;
  /** node key → incoming edges (all kinds) */
  readonly incoming: Map<string, CapabilityEdge[]>;
  /** superseded node digest → superseding node key */
  readonly supersededBy: Map<string, string>;
}

const INDICES = new WeakMap<CapabilityGraph, GraphIndices>();

function emptyIndices(): GraphIndices {
  return {
    byKey: new Map(),
    byDigest: new Map(),
    byLogicalKey: new Map(),
    adjacency: new Map(),
    reverseAdjacency: new Map(),
    edgeByKey: new Map(),
    outgoing: new Map(),
    incoming: new Map(),
    supersededBy: new Map(),
  };
}

/** Indices for a graph created by this module (internal use + queries). */
export function indicesFor(graph: CapabilityGraph): GraphIndices {
  const indices = INDICES.get(graph);
  if (indices === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'not a graph produced by @arena/capability-graph (missing derived indices)',
    });
  }
  return indices;
}

// ---------------------------------------------------------------------------
// Empty graph
// ---------------------------------------------------------------------------

const EMPTY_GRAPH: CapabilityGraph = deepFreeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  packs: Object.freeze([]),
});
INDICES.set(EMPTY_GRAPH, emptyIndices());

/** The (singleton) empty capability graph. */
export function emptyCapabilityGraph(): CapabilityGraph {
  return EMPTY_GRAPH;
}

// ---------------------------------------------------------------------------
// Cycle detection over the hierarchical edge subgraph
// ---------------------------------------------------------------------------

/**
 * Find a path from `from` to `to` over the hierarchical adjacency (DFS,
 * deterministic order), or null when unreachable.
 */
function findPathOverHierarchy(
  indices: GraphIndices,
  from: string,
  to: string,
): readonly string[] | null {
  if (from === to) return [from];
  const parents = new Map<string, string>();
  const visited = new Set<string>([from]);
  const stack: string[] = [from];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    for (const next of indices.adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parents.set(next, current);
      if (next === to) {
        const path: string[] = [next];
        let step: string = next;
        while (step !== from) {
          const parent: string = parents.get(step) as string;
          path.unshift(parent);
          step = parent;
        }
        return path;
      }
      stack.push(next);
    }
  }
  return null;
}

/**
 * Check whether appending `source -> target` would close a cycle in the
 * hierarchical subgraph. Returns the offending path
 * [source, target, ..., source] when it would, null otherwise.
 */
function wouldCloseCycle(
  indices: GraphIndices,
  sourceKey: string,
  targetKey: string,
): readonly string[] | null {
  // Adding source->target closes a cycle iff target already reaches source.
  const existingPath = findPathOverHierarchy(indices, targetKey, sourceKey);
  if (existingPath === null) return null;
  return [sourceKey, ...existingPath];
}

// ---------------------------------------------------------------------------
// Appending (pure: returns a NEW frozen graph)
// ---------------------------------------------------------------------------

function withIndices(graph: CapabilityGraph, indices: GraphIndices): CapabilityGraph {
  INDICES.set(graph, indices);
  return graph;
}

function copyIndices(indices: GraphIndices): GraphIndices {
  return {
    byKey: new Map(indices.byKey),
    byDigest: new Map(indices.byDigest),
    byLogicalKey: new Map(
      [...indices.byLogicalKey].map(([key, keys]) => [key, [...keys]] as const),
    ),
    adjacency: new Map(
      [...indices.adjacency].map(([key, keys]) => [key, [...keys]] as const),
    ),
    reverseAdjacency: new Map(
      [...indices.reverseAdjacency].map(([key, keys]) => [key, [...keys]] as const),
    ),
    edgeByKey: new Map(indices.edgeByKey),
    outgoing: new Map(
      [...indices.outgoing].map(([key, edges]) => [key, [...edges]] as const),
    ),
    incoming: new Map(
      [...indices.incoming].map(([key, edges]) => [key, [...edges]] as const),
    ),
    supersededBy: new Map(indices.supersededBy),
  };
}

function graphView(
  nodes: readonly CapabilityNode[],
  edges: readonly CapabilityEdge[],
  packs: readonly AppliedDomainPack[],
): CapabilityGraph {
  return deepFreeze({
    nodes: Object.freeze([...nodes]),
    edges: Object.freeze([...edges]),
    packs: Object.freeze([...packs]),
  });
}

/**
 * Append a node (pure). Validation, fail-closed:
 *   - structural validity (CAPABILITY_GRAPH_INVALID_NODE);
 *   - digest re-verification (CAPABILITY_GRAPH_TAMPERED);
 *   - identity immutability: the same (kind, id, version) with a DIFFERENT
 *     digest is rejected (CAPABILITY_GRAPH_IDENTITY_CONFLICT); a bit-identical
 *     node is an idempotent no-op returning the SAME graph object;
 *   - supersession rules: target exists, same kind and id, strictly lower
 *     version, not forked (CAPABILITY_GRAPH_INVALID_SUPERSESSION).
 */
export async function appendNode(
  graph: CapabilityGraph,
  node: CapabilityNode,
): Promise<CapabilityGraph> {
  if (!isCapabilityNode(node)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'appendNode requires a structurally valid capability node',
    });
  }
  await verifyCapabilityNode(node);

  const indices = indicesFor(graph);
  const key = capabilityNodeKey(node);
  const existing = indices.byKey.get(key);
  if (existing !== undefined) {
    if (existing.digest === node.digest) {
      return graph; // idempotent re-assertion of bit-identical content
    }
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT, {
      message: `node identity ${key} is already bound to digest ${existing.digest}; attempted to append digest ${node.digest} (nodes are immutable: same identity, different content must be a supersession)`,
      details: { node: key, bound: existing.digest, attempted: node.digest },
    });
  }

  if (node.supersedes !== undefined) {
    const superseded = indices.byDigest.get(node.supersedes);
    if (superseded === undefined) {
      throw new CapabilityGraphError(
        CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `supersedes target digest ${node.supersedes} is not present in the graph`,
          details: { node: key, supersedes: node.supersedes },
        },
      );
    }
    if (superseded.kind !== node.kind || superseded.id !== node.id) {
      throw new CapabilityGraphError(
        CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `supersession must target the same logical node: ${key} attempts to supersede ${capabilityNodeKey(superseded)}`,
          details: { node: key, supersedes: capabilityNodeKey(superseded) },
        },
      );
    }
    if (compareCapabilityNodeVersions(superseded.version, node.version) >= 0) {
      throw new CapabilityGraphError(
        CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `superseding version must be strictly higher: ${key} attempts to supersede ${capabilityNodeKey(superseded)}`,
          details: { node: key, supersedes: capabilityNodeKey(superseded) },
        },
      );
    }
    const fork = indices.supersededBy.get(node.supersedes);
    if (fork !== undefined) {
      throw new CapabilityGraphError(
        CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
        {
          message: `forked supersession: ${capabilityNodeKey(superseded)} is already superseded by ${fork}; ${key} is rejected (supersession chains are linear)`,
          details: { node: key, fork, supersedes: node.supersedes },
        },
      );
    }
  }

  const next = copyIndices(indices);
  next.byKey.set(key, node);
  next.byDigest.set(node.digest, node);
  const logicalKey = capabilityNodeLogicalKey(node);
  const versions = next.byLogicalKey.get(logicalKey) ?? [];
  versions.push(key);
  next.byLogicalKey.set(logicalKey, versions);
  if (node.supersedes !== undefined) {
    next.supersededBy.set(node.supersedes, key);
  }
  return withIndices(graphView([...graph.nodes, node], graph.edges, graph.packs), next);
}

/**
 * Append an edge (pure). Validation, fail-closed:
 *   - structural validity + digest re-verification;
 *   - endpoint resolution: both nodes must already be in the graph with the
 *     EXACT digests the edge references (NODE_NOT_FOUND / TAMPERED);
 *   - per-kind endpoint matrix and self-edge rejection;
 *   - edge identity: the same (kind, source, target) with a DIFFERENT digest
 *     is rejected (IDENTITY_CONFLICT); a bit-identical edge is idempotent;
 *   - acyclicity: an edge that would close a cycle in the hierarchical
 *     subgraph (decomposes-into / extends-domain / requires / produces)
 *     throws CYCLE_DETECTED with the offending path in message + details.
 */
export async function appendEdge(
  graph: CapabilityGraph,
  edge: CapabilityEdge,
): Promise<CapabilityGraph> {
  if (!isCapabilityEdge(edge)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: 'appendEdge requires a structurally valid capability edge',
    });
  }
  await verifyCapabilityEdge(edge);

  const indices = indicesFor(graph);
  const edgeKey = capabilityEdgeKey(edge);
  const existingEdge = indices.edgeByKey.get(edgeKey);
  if (existingEdge !== undefined) {
    if (existingEdge.digest === edge.digest) {
      return graph; // idempotent re-assertion of bit-identical content
    }
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT, {
      message: `edge identity ${edgeKey} is already bound to digest ${existingEdge.digest}; attempted to append digest ${edge.digest}`,
      details: { edge: edgeKey, bound: existingEdge.digest, attempted: edge.digest },
    });
  }

  const sourceKey = capabilityNodeKey(edge.source);
  const targetKey = capabilityNodeKey(edge.target);
  const sourceNode = indices.byKey.get(sourceKey);
  if (sourceNode === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND, {
      message: `edge source node is not in the graph: ${sourceKey}`,
      details: { edge: edgeKey, missing: sourceKey },
    });
  }
  if (sourceNode.digest !== edge.source.digest) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.TAMPERED, {
      message: `edge references source content the graph does not have: ${sourceKey} is ${sourceNode.digest}, edge claims ${edge.source.digest}`,
      details: { edge: edgeKey, node: sourceKey, actual: sourceNode.digest, claimed: edge.source.digest },
    });
  }
  const targetNode = indices.byKey.get(targetKey);
  if (targetNode === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND, {
      message: `edge target node is not in the graph: ${targetKey}`,
      details: { edge: edgeKey, missing: targetKey },
    });
  }
  if (targetNode.digest !== edge.target.digest) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.TAMPERED, {
      message: `edge references target content the graph does not have: ${targetKey} is ${targetNode.digest}, edge claims ${edge.target.digest}`,
      details: { edge: edgeKey, node: targetKey, actual: targetNode.digest, claimed: edge.target.digest },
    });
  }

  const endpoints = EDGE_ENDPOINTS[edge.kind];
  if (!endpoints.source.includes(edge.source.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `edge kind ${JSON.stringify(edge.kind)} does not allow source kind ${JSON.stringify(edge.source.kind)} (allowed: ${endpoints.source.join(', ')})`,
      details: { kind: edge.kind, role: 'source', allowed: [...endpoints.source], got: edge.source.kind },
    });
  }
  if (!endpoints.target.includes(edge.target.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `edge kind ${JSON.stringify(edge.kind)} does not allow target kind ${JSON.stringify(edge.target.kind)} (allowed: ${endpoints.target.join(', ')})`,
      details: { kind: edge.kind, role: 'target', allowed: [...endpoints.target], got: edge.target.kind },
    });
  }
  if (sourceKey === targetKey) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `self-edges are not allowed: ${edgeKey}`,
      details: { edge: edgeKey },
    });
  }

  if ((HIERARCHICAL_EDGE_KINDS as readonly string[]).includes(edge.kind)) {
    const cyclePath = wouldCloseCycle(indices, sourceKey, targetKey);
    if (cyclePath !== null) {
      throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.CYCLE_DETECTED, {
        message: `cycle detected inserting ${edge.kind} edge: ${cyclePath.join(' -> ')}`,
        details: { path: [...cyclePath], edge: edgeKey, kind: edge.kind },
      });
    }
  }

  const next = copyIndices(indices);
  next.edgeByKey.set(edgeKey, edge);
  const out = next.outgoing.get(sourceKey) ?? [];
  out.push(edge);
  next.outgoing.set(sourceKey, out);
  const inc = next.incoming.get(targetKey) ?? [];
  inc.push(edge);
  next.incoming.set(targetKey, inc);
  if ((HIERARCHICAL_EDGE_KINDS as readonly string[]).includes(edge.kind)) {
    const adj = next.adjacency.get(sourceKey) ?? [];
    adj.push(targetKey);
    next.adjacency.set(sourceKey, adj);
    const radj = next.reverseAdjacency.get(targetKey) ?? [];
    radj.push(sourceKey);
    next.reverseAdjacency.set(targetKey, radj);
  }
  return withIndices(graphView(graph.nodes, [...graph.edges, edge], graph.packs), next);
}

/** Append an applied-domain-pack record (internal, used by domain-pack.ts). */
export function appendPackRecord(
  graph: CapabilityGraph,
  appliedPack: AppliedDomainPack,
): CapabilityGraph {
  const indices = copyIndices(indicesFor(graph));
  return withIndices(
    graphView(graph.nodes, graph.edges, [...graph.packs, appliedPack]),
    indices,
  );
}

/**
 * Build a graph from nodes and edges in ORDER: each element is appended with
 * full validation (so edges must come after the nodes they reference).
 * Elements are discriminated by their `kind` (node kinds and edge kinds are
 * disjoint closed sets). Returns the empty graph for an empty list.
 */
export async function buildCapabilityGraph(
  elements: readonly CapabilityGraphElement[],
): Promise<CapabilityGraph> {
  let graph = emptyCapabilityGraph();
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];
    if (element === undefined) continue;
    if (isCapabilityNodeKind((element as { kind: unknown }).kind)) {
      graph = await appendNode(graph, element as CapabilityNode);
    } else if (isCapabilityEdgeKind((element as { kind: unknown }).kind)) {
      graph = await appendEdge(graph, element as CapabilityEdge);
    } else {
      throw new CapabilityGraphError(
        CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE_KIND,
        {
          message: `element at index ${i} is neither a capability node nor a capability edge (unknown kind: ${JSON.stringify((element as { kind: unknown }).kind)})`,
          details: { index: i },
        },
      );
    }
  }
  return graph;
}

// ---------------------------------------------------------------------------
// Structural validation / graph digest / verification
// ---------------------------------------------------------------------------

export function isCapabilityGraph(value: unknown): value is CapabilityGraph {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate['nodes']) &&
    candidate['nodes'].every((node) => isCapabilityNode(node)) &&
    Array.isArray(candidate['edges']) &&
    candidate['edges'].every((edge) => isCapabilityEdge(edge)) &&
    Array.isArray(candidate['packs'])
  );
}

/**
 * Order-independent content digest of a whole graph: sha256 over the
 * canonical JSON of the sorted node digests, sorted edge digests and sorted
 * applied-pack digests. Two graphs containing the same content in different
 * append orders share this digest.
 */
export async function capabilityGraphDigest(
  graph: CapabilityGraph,
): Promise<string> {
  return digestCanonical({
    nodes: [...graph.nodes].map((node) => node.digest).sort(),
    edges: [...graph.edges].map((edge) => edge.digest).sort(),
    packs: [...graph.packs].map((pack) => pack.packDigest).sort(),
  });
}

/**
 * Verify a whole graph, fail-closed: every node digest, every edge digest
 * and every applied-pack digest is recomputed and compared with the claimed
 * value (CAPABILITY_GRAPH_TAMPERED on any mismatch).
 */
export async function verifyCapabilityGraph(
  graph: CapabilityGraph,
): Promise<void> {
  if (!isCapabilityGraph(graph)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'not a structurally valid capability graph',
    });
  }
  for (const node of graph.nodes) {
    await verifyCapabilityNode(node);
  }
  for (const edge of graph.edges) {
    await verifyCapabilityEdge(edge);
  }
  for (const pack of graph.packs) {
    await verifyAppliedPackDigest(pack);
  }
}

// ---------------------------------------------------------------------------
// Node lookup / supersession queries (pure, deterministic)
// ---------------------------------------------------------------------------

/** Look up a node by ref (kind, id, version). Null when unknown. */
export function getNode(
  graph: CapabilityGraph,
  ref: { kind: CapabilityNodeKind; id: string; version: string },
): CapabilityNode | null {
  return indicesFor(graph).byKey.get(capabilityNodeKey(ref)) ?? null;
}

/** Look up a node by its digest. Null when unknown. */
export function getNodeByDigest(
  graph: CapabilityGraph,
  digest: string,
): CapabilityNode | null {
  return indicesFor(graph).byDigest.get(digest) ?? null;
}

/** All versions of a logical node (kind + id), sorted by semver precedence. */
export function nodeVersionsOf(
  graph: CapabilityGraph,
  logical: { kind: CapabilityNodeKind; id: string },
): readonly CapabilityNode[] {
  const indices = indicesFor(graph);
  const keys = indices.byLogicalKey.get(capabilityNodeLogicalKey(logical)) ?? [];
  return keys
    .map((key) => indices.byKey.get(key))
    .filter((node): node is CapabilityNode => node !== undefined)
    .sort((a, b) => compareCapabilityNodeVersions(a.version, b.version));
}

/**
 * The current (non-superseded, highest-version) node version of a logical
 * node, or null when the logical node is unknown.
 */
export function latestNodeVersion(
  graph: CapabilityGraph,
  logical: { kind: CapabilityNodeKind; id: string },
): CapabilityNode | null {
  const indices = indicesFor(graph);
  const keys = indices.byLogicalKey.get(capabilityNodeLogicalKey(logical)) ?? [];
  let latest: CapabilityNode | null = null;
  for (const key of keys) {
    const node = indices.byKey.get(key);
    if (node === undefined) continue;
    if (indices.supersededBy.has(node.digest)) continue; // superseded versions are not current
    if (
      latest === null ||
      compareCapabilityNodeVersions(node.version, latest.version) > 0
    ) {
      latest = node;
    }
  }
  return latest;
}

/** True iff the given node version has been superseded (by anyone). */
export function isNodeSuperseded(graph: CapabilityGraph, node: CapabilityNode): boolean {
  return indicesFor(graph).supersededBy.has(node.digest);
}

/** The node ref of the superseding version, or null when not superseded. */
export function supersedingNodeOf(
  graph: CapabilityGraph,
  node: CapabilityNode,
): CapabilityNodeRef | null {
  const indices = indicesFor(graph);
  const supersedingKey = indices.supersededBy.get(node.digest);
  if (supersedingKey === undefined) return null;
  const superseding = indices.byKey.get(supersedingKey);
  if (superseding === undefined) return null;
  return capabilityNodeRef(superseding);
}

// ---------------------------------------------------------------------------
// Edge queries (pure)
// ---------------------------------------------------------------------------

/** Every edge of the given kind, in append order. */
export function edgesOfKind(
  graph: CapabilityGraph,
  kind: CapabilityEdgeKind,
): readonly CapabilityEdge[] {
  return graph.edges.filter((edge) => edge.kind === kind);
}

/** Every outgoing edge of a node (optionally filtered by kinds). */
export function outgoingEdgesOf(
  graph: CapabilityGraph,
  node: CapabilityNode,
  kinds?: readonly CapabilityEdgeKind[],
): readonly CapabilityEdge[] {
  const edges = indicesFor(graph).outgoing.get(capabilityNodeKey(node)) ?? [];
  if (kinds === undefined) return edges;
  const allowed = new Set<string>(kinds);
  return edges.filter((edge) => allowed.has(edge.kind));
}

/** Every incoming edge of a node (optionally filtered by kinds). */
export function incomingEdgesOf(
  graph: CapabilityGraph,
  node: CapabilityNode,
  kinds?: readonly CapabilityEdgeKind[],
): readonly CapabilityEdge[] {
  const edges = indicesFor(graph).incoming.get(capabilityNodeKey(node)) ?? [];
  if (kinds === undefined) return edges;
  const allowed = new Set<string>(kinds);
  return edges.filter((edge) => allowed.has(edge.kind));
}

// ---------------------------------------------------------------------------
// Pack helpers shared with domain-pack.ts (ownership derivation)
// ---------------------------------------------------------------------------

/**
 * The pack id that declared a node (derived, append-only history), or null
 * for nodes appended outside any pack. Never inspects mutable state —
 * ownership is replayed from the graph's pack application records.
 */
export function nodeDeclaredBy(
  graph: CapabilityGraph,
  node: CapabilityNode,
): string | null {
  const key = capabilityNodeKey(node);
  for (let i = graph.packs.length - 1; i >= 0; i -= 1) {
    const pack = graph.packs[i];
    if (pack === undefined) continue;
    if (pack.declaredNodeKeys.includes(key)) return pack.pack.packId;
  }
  return null;
}

/**
 * Compute the digest of an applied domain pack record (used by
 * verifyCapabilityGraph; the canonical form is owned by domain-pack.ts).
 */
async function verifyAppliedPackDigest(pack: AppliedDomainPack): Promise<void> {
  const recomputed = await digestCanonical({
    recordVersion: pack.recordVersion,
    pack: pack.pack,
    appliedAt: pack.appliedAt,
    declaredNodeKeys: [...pack.declaredNodeKeys],
  });
  if (recomputed !== pack.packDigest) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.TAMPERED, {
      message: `applied domain pack digest mismatch: expected ${pack.packDigest}, recomputed ${recomputed}`,
      details: { expected: pack.packDigest, actual: recomputed },
    });
  }
}
