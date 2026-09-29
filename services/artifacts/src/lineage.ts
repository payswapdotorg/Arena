/**
 * LineageService (Work Order A014) — record + query transformation
 * lineage over stored material artifacts (requirement R14;
 * docs/architecture.md §15; architecture-lock rules 6, 18).
 *
 * Wraps the REUSED @arena/provenance machinery — createProvenanceRecord
 * (full §15 record validation: creator, timestamps, parent edges,
 * transformation, rights, verification refs) and buildLineageGraph — and
 * adds the A014 service semantics:
 *
 *   - record(input) — APPEND-ONLY lineage edge recording. The record is
 *     created by the A002 provenance constructor; parents are validated
 *     against the ArtifactStore (every parent ref must be RESOLVABLE and
 *     DIGEST-VERIFIED — closed-world provenance; the store read scope is
 *     the artifact's own namespace, so cross-tenant parents are
 *     unresolvable and fail closed); an edge that would create a CYCLE is
 *     rejected with the OFFENDING PATH in the error details; a
 *     bit-identical record replays idempotently; a contradictory record
 *     for the same artifact is rejected (PROVENANCE_INVALID_RECORD).
 *     Verification/evaluation refs (A013 verification-record digests /
 *     A012 evaluation-record digests) are carried by the closed
 *     @arena/provenance kind vocabulary (kind `verification` /
 *     `attestation` / `evaluation`) and are recorded as open-world
 *     references.
 *   - ancestryOf / descendantsOf / isAncestorOf — DEEP lineage queries
 *     (deterministic transitive walks with a defensive cycle guard that
 *     reports the offending path — impossible after the append gate, but
 *     fail-closed defense in depth).
 *   - validateProvenance(ref) — re-run the provenance validation for a
 *     recorded artifact: every parent ref re-resolved and re-verified
 *     against the store.
 *   - getRecord / listRecords — pure projections.
 */

import {
  PROVENANCE_ERROR_CODES,
  ProvenanceError,
  buildLineageGraph,
  createProvenanceRecord,
} from '@arena/provenance';
import type {
  CreateProvenanceRecordInput,
  LineageEdge,
  ProvenanceRecord,
} from '@arena/provenance';
import type { ArtifactRefView } from '@arena/provenance';
import { artifactRefViewKey } from '@arena/provenance';
import { ARTIFACT_ERROR_CODES, ArtifactError, verifyArtifact } from '@arena/artifact-protocol';
import { ARTIFACTS_ERROR_CODES, ArtifactsError } from './errors.js';
import type { ArtifactStore } from './store.js';

/**
 * The lineage service: append-only edge recording + deep queries over the
 * artifact store. Construct with `new LineageService(store)`.
 */
export class LineageService {
  private readonly store: ArtifactStore;
  /** Insertion-ordered record list (append-only). */
  private readonly records: ProvenanceRecord[] = [];
  /** child ref key → its record (one provenance record per artifact). */
  private readonly recordsByKey = new Map<string, ProvenanceRecord>();
  /** child ref key → parent edges (the lineage adjacency). */
  private readonly parentEdges = new Map<string, readonly LineageEdge[]>();
  /** parent ref key → children ref views. */
  private readonly childrenOf = new Map<string, ArtifactRefView[]>();

  constructor(store: ArtifactStore) {
    this.store = store;
  }

  /**
   * Record provenance for an artifact: validate the §15 record through the
   * REUSED A002 constructor, validate every parent ref against the store
   * (resolvable + digest-verified, closed-world), reject cycles WITH THE
   * OFFENDING PATH, then append (idempotently) to the lineage graph.
   */
  async record(input: CreateProvenanceRecordInput): Promise<ProvenanceRecord> {
    const record = createProvenanceRecord(input);

    // Idempotent re-assertion of a bit-identical record.
    const key = artifactRefViewKey(record.artifact);
    const existing = this.recordsByKey.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) === JSON.stringify(record)) {
        return existing;
      }
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RECORD, {
        message: `conflicting provenance record for the same artifact ${key} (append-only: one record per artifact; a different record for the same content-addressed artifact is rejected)`,
        details: { ref: key },
      });
    }

    // Provenance validation: every parent ref resolvable + digest-verified
    // through the store, reading as the artifact's own namespace (tenant
    // scoping — cross-tenant parents do not resolve and fail closed).
    await this.validateParents(record);

    // Append-time cycle rejection with the offending path: following
    // parent edges from each new parent must never reach the child.
    for (const edge of record.parents) {
      this.assertNoCycleFrom(edge.parent, record.artifact);
    }

    // Structural double-check through the REUSED graph builder (identity
    // conflicts across records, contradictory duplicates, cycles).
    buildLineageGraph([...this.records, record]);

    // Append (append-only: never rewrite an existing edge).
    this.records.push(record);
    this.recordsByKey.set(key, record);
    this.parentEdges.set(key, record.parents);
    for (const edge of record.parents) {
      const parentKey = artifactRefViewKey(edge.parent);
      const list = this.childrenOf.get(parentKey) ?? [];
      list.push(record.artifact);
      this.childrenOf.set(parentKey, list);
    }
    return record;
  }

  /** The provenance record of an artifact (undefined when unrecorded). */
  async getRecord(ref: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }): Promise<ProvenanceRecord | undefined> {
    const record = this.recordsByKey.get(
      `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`,
    );
    return record;
  }

  /**
   * DEEP lineage query: all transitive parents of a ref (breadth-first,
   * deterministic — expansion sorted by ref key). Unknown refs have no
   * parents (open world). Defensive cycle guard reports the offending
   * path (unreachable after the append gate; fail-closed defense).
   */
  async ancestryOf(ref: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }): Promise<readonly ArtifactRefView[]> {
    const startKey = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    return this.walkAncestors(startKey);
  }

  /** DEEP lineage query: all transitive children of a ref. */
  async descendantsOf(ref: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }): Promise<readonly ArtifactRefView[]> {
    const startKey = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    const found: ArtifactRefView[] = [];
    const seen = new Set<string>([startKey]);
    const queue: string[] = [startKey];
    while (queue.length > 0) {
      const key = queue.shift();
      if (key === undefined) break;
      for (const child of this.childrenOf.get(key) ?? []) {
        const childKey = artifactRefViewKey(child);
        if (seen.has(childKey)) continue;
        seen.add(childKey);
        found.push(child);
        queue.push(childKey);
      }
    }
    return Object.freeze(
      uniqueSorted(found).sort((a, b) =>
        artifactRefViewKey(a) < artifactRefViewKey(b) ? -1 : 1,
      ),
    );
  }

  /** True iff `ancestor` is a transitive parent of `descendant`. */
  async isAncestorOf(
    ancestor: { namespace: string; name: string; version: string; digest: string },
    descendant: { namespace: string; name: string; version: string; digest: string },
  ): Promise<boolean> {
    const ancestors = await this.ancestryOf(descendant);
    const target = `${ancestor.namespace}/${ancestor.name}@${ancestor.version}#${ancestor.digest}`;
    return ancestors.some((ref) => artifactRefViewKey(ref) === target);
  }

  /**
   * Re-run provenance validation for a recorded artifact: every parent ref
   * re-resolved and re-verified against the store. Fail closed (typed
   * errors); returns the number of verified parents.
   */
  async validateProvenance(ref: {
    namespace: string;
    name: string;
    version: string;
    digest: string;
  }): Promise<{ ref: string; parentsVerified: number }> {
    const key = `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
    const record = this.recordsByKey.get(key);
    if (record === undefined) {
      throw new ArtifactsError(ARTIFACTS_ERROR_CODES.NOT_FOUND, {
        message: `no provenance record for ${key}`,
        details: { ref: key },
      });
    }
    await this.validateParents(record);
    return { ref: key, parentsVerified: record.parents.length };
  }

  /** Every recorded provenance record (insertion order; frozen copy). */
  async listRecords(): Promise<readonly ProvenanceRecord[]> {
    return Object.freeze([...this.records]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Closed-world parent validation: every parent ref must resolve in the
   * store (reading as the artifact's own namespace), carry the exact
   * referenced identity AND digest, and pass content verification.
   */
  private async validateParents(record: ProvenanceRecord): Promise<void> {
    const scope = record.artifact.namespace;
    const resolver = this.store.resolverFor({ type: 'service', tenant: scope, principalId: 'arena-lineage-service' });
    for (const edge of record.parents) {
      const resolved = await resolver(edge.parent);
      if (resolved === null) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.UNRESOLVED_REF, {
          message: `parent ref ${artifactRefViewKey(edge.parent)} is not resolvable in namespace scope ${scope} (closed-world provenance: every parent must be stored and digest-verified before recording lineage)`,
          details: { ref: artifactRefViewKey(edge.parent), scope },
        });
      }
      if (
        resolved.identity.namespace !== edge.parent.namespace ||
        resolved.identity.name !== edge.parent.name ||
        resolved.identity.version !== edge.parent.version
      ) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
          message: `resolved parent identity does not match the reference: expected ${edge.parent.namespace}/${edge.parent.name}@${edge.parent.version}, got ${resolved.identity.namespace}/${resolved.identity.name}@${resolved.identity.version}`,
          details: { ref: artifactRefViewKey(edge.parent) },
        });
      }
      if (resolved.digest !== edge.parent.digest) {
        throw new ArtifactError(ARTIFACT_ERROR_CODES.TAMPERED, {
          message: `resolved parent digest does not match the reference: expected ${edge.parent.digest}, got ${resolved.digest}`,
          details: { ref: artifactRefViewKey(edge.parent), expected: edge.parent.digest, actual: resolved.digest },
        });
      }
      await verifyArtifact(resolved);
    }
  }

  /**
   * Cycle rejection WITH THE OFFENDING PATH: DFS from each new parent
   * following parent-edges upward; reaching the child proves the new edge
   * closes a cycle (child → parent → … → child). The reported path is the
   * full loop.
   */
  private assertNoCycleFrom(start: ArtifactRefView, child: ArtifactRefView): void {
    const childKey = artifactRefViewKey(child);
    const startKey = artifactRefViewKey(start);
    const visited = new Set<string>();
    const path: string[] = [startKey];
    const visit = (key: string): void => {
      if (key === childKey) {
        // The loop, in edge order: child → start → …(walked parents)… → child.
        // `path` already ends at the child (it was pushed before visit),
        // so the loop is [child, ...path] with no duplicate tail.
        throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
          message: `lineage cycle rejected: ${[childKey, ...path].join(' → ')}`,
          details: { path: [childKey, ...path], ref: childKey },
        });
      }
      if (visited.has(key)) return;
      visited.add(key);
      const edges = this.parentEdges.get(key) ?? [];
      const sorted = [...edges]
        .map((edge) => artifactRefViewKey(edge.parent))
        .sort();
      for (const parentKey of sorted) {
        path.push(parentKey);
        visit(parentKey);
        path.pop();
      }
    };
    visit(startKey);
  }

  /**
   * Ancestry walk (depth-first, deterministic: expansion sorted by ref
   * key) with a defensive cycle guard: the append gate makes cycles
   * impossible, but if corrupted state ever closed a loop the walk fails
   * closed WITH THE OFFENDING PATH instead of diverging. Diamonds (a node
   * reached through several branches) are NOT cycles — the done-set
   * distinguishes them exactly like A002's verifyArtifactTree.
   */
  private walkAncestors(startKey: string): readonly ArtifactRefView[] {
    const found: ArtifactRefView[] = [];
    const collected = new Set<string>();
    const done = new Set<string>();
    const onPath = new Set<string>();
    const path: string[] = [];
    const visit = (key: string): void => {
      if (done.has(key)) return;
      if (onPath.has(key)) {
        throw new ProvenanceError(PROVENANCE_ERROR_CODES.CYCLE_DETECTED, {
          message: `lineage cycle detected during ancestry walk at ${key}`,
          details: { path: [...path, key], ref: key },
        });
      }
      onPath.add(key);
      path.push(key);
      const edges = this.parentEdges.get(key) ?? [];
      const sorted = [...edges]
        .map((edge) => edge.parent)
        .sort((a, b) => (artifactRefViewKey(a) < artifactRefViewKey(b) ? -1 : 1));
      for (const parent of sorted) {
        const parentKey = artifactRefViewKey(parent);
        if (!collected.has(parentKey)) {
          collected.add(parentKey);
          found.push(parent);
        }
        visit(parentKey);
      }
      path.pop();
      onPath.delete(key);
      done.add(key);
    };
    visit(startKey);
    return Object.freeze(
      uniqueSorted(found).sort((a, b) =>
        artifactRefViewKey(a) < artifactRefViewKey(b) ? -1 : 1,
      ),
    );
  }
}

function uniqueSorted(refs: readonly ArtifactRefView[]): ArtifactRefView[] {
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
