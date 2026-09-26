/**
 * Lineage queries — pure functions over provenance records
 * (architecture-lock rule 18; docs/architecture.md §15; requirement R14).
 *
 * `buildLineageGraph` constructs the immutable parent-edge DAG from a set of
 * records and FAILS CLOSED at construction on:
 *   - self-edges (defensive; record construction already rejects them);
 *   - cycles across records (A's parents include B while B's parents include
 *     A) — PROVENANCE_CYCLE_DETECTED;
 *   - the same identity bound to different digests across records
 *     (PROVENANCE_IDENTITY_CONFLICT — "same identity, different digest");
 *   - two different records for the exact same content-addressed artifact
 *     (PROVENANCE_INVALID_RECORD — one artifact version has one provenance).
 *
 * Re-asserting a bit-identical record is idempotent. Queries over the graph
 * (ancestors, descendants, isAncestorOf, topologicalOrder) are deterministic
 * and total: unknown references (open-world parents) simply have no outgoing
 * edges.
 */

import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';
import type { LineageEdge, ProvenanceRecord } from './record.js';
import type { ArtifactRefView } from './shared.js';
import { artifactRefViewIdentityKey, artifactRefViewKey } from './shared.js';

export interface LineageGraph {
  /** Every record, keyed by artifact ref key (identity + digest). */
  readonly records: ReadonlyMap<string, ProvenanceRecord>;
  /** child ref key → its parent edges. */
  readonly parents: ReadonlyMap<string, readonly LineageEdge[]>;
  /** parent ref key → child artifact refs (derived from the parent edges). */
  readonly children: ReadonlyMap<string, readonly ArtifactRefView[]>;
  /** Every reference seen (records' artifacts, parents, transforms, evidence). */
  readonly nodes: ReadonlyMap<string, ArtifactRefView>;
}

function registerNode(nodes: Map<string, ArtifactRefView>, ref: ArtifactRefView): void {
  const key = artifactRefViewKey(ref);
  if (!nodes.has(key)) nodes.set(key, ref);
}

function recordsEqual(a: ProvenanceRecord, b: ProvenanceRecord): boolean {
  return artifactRefViewKey(a.artifact) === artifactRefViewKey(b.artifact)
    ? JSON.stringify(a) === JSON.stringify(b)
    : false;
}

/**
 * Build the lineage graph from provenance records. Pure: returns a frozen
 * graph; throws on cycles, identity conflicts and contradictory records.
 */
export function buildLineageGraph(records: readonly ProvenanceRecord[]): LineageGraph {
  const recordMap = new Map<string, ProvenanceRecord>();
  const identityDigest = new Map<string, string>();
  const nodes = new Map<string, ArtifactRefView>();
  const parents = new Map<string, LineageEdge[]>();
  const children = new Map<string, ArtifactRefView[]>();

  for (const record of records) {
    const key = artifactRefViewKey(record.artifact);
    const identityKey = artifactRefViewIdentityKey(record.artifact);

    const boundDigest = identityDigest.get(identityKey);
    if (boundDigest !== undefined && boundDigest !== record.artifact.digest) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `identity ${identityKey} is bound to digest ${boundDigest} and ${record.artifact.digest} by different records (artifacts are immutable)`,
        details: { identity: identityKey, bound: boundDigest, attempted: record.artifact.digest },
      });
    }
    identityDigest.set(identityKey, record.artifact.digest);

    const existing = recordMap.get(key);
    if (existing !== undefined) {
      if (!recordsEqual(existing, record)) {
        throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
          message: `conflicting provenance records for the same artifact ${key}`,
          details: { ref: key },
        });
      }
      continue; // idempotent re-assertion of an identical record
    }
    recordMap.set(key, record);
    registerNode(nodes, record.artifact);
    registerNode(nodes, record.transformation.transform);
    for (const input of record.transformation.inputs) registerNode(nodes, input);
    for (const ref of record.verification) registerNode(nodes, ref.evidence);

    const edges: LineageEdge[] = [];
    for (const edge of record.parents) {
      const parentKey = artifactRefViewKey(edge.parent);
      if (parentKey === key) {
        throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
          message: `self-edge in lineage graph at ${parentKey}`,
          details: { ref: parentKey },
        });
      }
      registerNode(nodes, edge.parent);
      edges.push(edge);
      const childList = children.get(parentKey) ?? [];
      childList.push(record.artifact);
      children.set(parentKey, childList);
    }
    parents.set(key, edges);
  }

  // Cycle detection over the parent-edge DAG (defensive even though record
  // construction already rejects self-edges).
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (key: string): void => {
    const status = state.get(key);
    if (status === 'visiting') {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
        message: `cycle detected in lineage graph at ${key}`,
        details: { ref: key },
      });
    }
    if (status === 'done') return;
    state.set(key, 'visiting');
    const childList = children.get(key) ?? [];
    for (const child of childList) {
      visit(artifactRefViewKey(child));
    }
    state.set(key, 'done');
  };
  for (const key of children.keys()) {
    if (!state.has(key)) visit(key);
  }

  return Object.freeze({
    records: recordMap,
    parents,
    children,
    nodes,
  });
}

function sortedKeys(refs: readonly ArtifactRefView[]): string[] {
  return refs.map((ref) => artifactRefViewKey(ref)).sort();
}

function uniqueSortedRefs(refs: ArtifactRefView[]): ArtifactRefView[] {
  const seen = new Set<string>();
  const result: ArtifactRefView[] = [];
  for (const ref of refs) {
    const key = artifactRefViewKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

/**
 * All transitive parents of `ref` (breadth-first, deterministic: expansion
 * order is sorted by ref key). Unknown refs have no parents (open world).
 */
export function ancestors(graph: LineageGraph, ref: ArtifactRefView): ArtifactRefView[] {
  const startKey = artifactRefViewKey(ref);
  const found: ArtifactRefView[] = [];
  const seen = new Set<string>([startKey]);
  const queue: string[] = [startKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) break;
    const edges = graph.parents.get(key) ?? [];
    const freshParents = edges
      .map((edge) => edge.parent)
      .filter((parent) => !seen.has(artifactRefViewKey(parent)));
    for (const parent of uniqueSortedRefs(freshParents)) {
      const parentKey = artifactRefViewKey(parent);
      seen.add(parentKey);
      found.push(parent);
      queue.push(parentKey);
    }
  }
  return uniqueSortedRefs(found).sort((a, b) =>
    artifactRefViewKey(a) < artifactRefViewKey(b) ? -1 : 1,
  );
}

/** All transitive children of `ref` (breadth-first, deterministic). */
export function descendants(graph: LineageGraph, ref: ArtifactRefView): ArtifactRefView[] {
  const startKey = artifactRefViewKey(ref);
  const found: ArtifactRefView[] = [];
  const seen = new Set<string>([startKey]);
  const queue: string[] = [startKey];
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) break;
    const childRefs = graph.children.get(key) ?? [];
    const fresh = childRefs.filter((child) => !seen.has(artifactRefViewKey(child)));
    for (const child of uniqueSortedRefs(fresh)) {
      const childKey = artifactRefViewKey(child);
      seen.add(childKey);
      found.push(child);
      queue.push(childKey);
    }
  }
  return uniqueSortedRefs(found).sort((a, b) =>
    artifactRefViewKey(a) < artifactRefViewKey(b) ? -1 : 1,
  );
}

/** True iff `ancestor` is a transitive parent of `descendant`. */
export function isAncestorOf(
  graph: LineageGraph,
  ancestor: ArtifactRefView,
  descendant: ArtifactRefView,
): boolean {
  const ancestorKey = artifactRefViewKey(ancestor);
  return ancestors(graph, descendant).some(
    (ref) => artifactRefViewKey(ref) === ancestorKey,
  );
}

/**
 * Deterministic topological order of every node in the graph (parents before
 * children; ties broken lexicographically by ref key). Throws defensively
 * on cycles (construction already rejects them).
 */
export function topologicalOrder(graph: LineageGraph): ArtifactRefView[] {
  const indegree = new Map<string, number>();
  for (const key of graph.nodes.keys()) indegree.set(key, 0);
  for (const [childKey, edges] of graph.parents) {
    indegree.set(childKey, edges.length);
  }

  const ready = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([key]) => key)
    .sort();
  const order: ArtifactRefView[] = [];

  while (ready.length > 0) {
    const key = ready.shift();
    if (key === undefined) break;
    const node = graph.nodes.get(key);
    if (node !== undefined) order.push(node);
    for (const child of graph.children.get(key) ?? []) {
      const childKey = artifactRefViewKey(child);
      const degree = (indegree.get(childKey) ?? 0) - 1;
      indegree.set(childKey, degree);
      if (degree === 0) {
        ready.push(childKey);
        ready.sort();
      }
    }
  }

  if (order.length !== graph.nodes.size) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
      message: 'lineage graph is not a DAG; topological order is impossible',
    });
  }
  return order;
}

/** Exposed for tests and tooling: sorted keys of a ref list. */
export function refKeysFor(refs: readonly ArtifactRefView[]): string[] {
  return sortedKeys(refs);
}
