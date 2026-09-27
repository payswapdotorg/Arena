/**
 * Domain packs — the extension point for new domains (Work Order A004;
 * architecture-lock rule 21; requirement R37).
 *
 *   "New domains extend skills/environments/evaluators/packs; they do not
 *    fork the Arena lifecycle."
 *
 * A DomainPack is a descriptor (id, version, target domain, declared
 * extensions, provenance). Applying a pack to a graph is APPEND-ONLY:
 *   - it may ADD new skill nodes, new evaluator nodes and new edges;
 *   - it may declare environment extensions as explicit versioned
 *     references (environments are owned by the environment protocol; the
 *     graph records the references and never models them as first-class
 *     nodes, so a pack extends environments without forking the Arena
 *     lifecycle);
 *   - it may supersede ONLY nodes previously declared by the SAME pack id;
 *   - it can NEVER redefine, rewrite, supersede or remove a node it does not
 *     own (CAPABILITY_GRAPH_PACK_OVERREACH — packs only append);
 *   - it can NEVER alter the lifecycle semantics (versioning, supersession
 *     chains, append-only history) of existing nodes — those are core
 *     invariants enforced by appendNode/appendEdge, which the pack pipeline
 *     reuses verbatim.
 *
 * Pack application is pure: it returns a NEW frozen graph with an
 * AppliedDomainPack record appended to the pack history. Ownership is
 * DERIVED from the append-only pack records (nodeDeclaredBy), never from
 * mutable side state.
 */

import { digestCanonical } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';
import { capabilityNodeKey } from './identifiers.js';
import { createCapabilityEdge } from './edges.js';
import type { CapabilityEdge } from './edges.js';
import {
  appendEdge,
  appendNode,
  appendPackRecord,
  getNode,
  indicesFor,
  nodeDeclaredBy,
} from './graph.js';
import type { CapabilityGraph } from './graph.js';
import { CAPABILITY_RECORD_VERSION, createCapabilityNode } from './nodes.js';
import { deepFreeze } from './payload.js';
import type { SkillNodePayload, TitledNodePayload } from './payload.js';
import { isProvenanceRefView } from './shared.js';
import type { ProvenanceRefView } from './shared.js';
import { toCapabilityTimestamp } from './timestamp.js';
import type { CapabilityTimestamp } from './timestamp.js';

// ---------------------------------------------------------------------------
// Pack ids and environment extension references
// ---------------------------------------------------------------------------

/** Exact pattern source; kept in sync with the generated contracts. */
export const DOMAIN_PACK_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';

const PACK_ID_PATTERN = new RegExp(DOMAIN_PACK_ID_PATTERN_SOURCE);

export type DomainPackId = string;

export function isDomainPackId(value: unknown): value is DomainPackId {
  return typeof value === 'string' && PACK_ID_PATTERN.test(value);
}

/**
 * An environment extension declared by a pack: an explicit, versioned
 * reference to an environment (owned by the environment protocol, Work
 * Order A009). The graph records the reference on the pack record — it
 * NEVER becomes a first-class node, so packs extend environments without
 * forking the Arena lifecycle (lock rule 21).
 */
export interface EnvironmentExtensionRef {
  readonly environmentId: string;
  readonly version: string;
}

const ENVIRONMENT_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;
const ENVIRONMENT_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$/;

export function isEnvironmentExtensionRef(
  value: unknown,
): value is EnvironmentExtensionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['environmentId'] === 'string' &&
    ENVIRONMENT_ID_PATTERN.test(candidate['environmentId']) &&
    typeof candidate['version'] === 'string' &&
    ENVIRONMENT_VERSION_PATTERN.test(candidate['version'])
  );
}

// ---------------------------------------------------------------------------
// Pack declarations
// ---------------------------------------------------------------------------

/** A skill node declared by a pack (created and appended on application). */
export interface SkillDeclaration {
  readonly id: string;
  readonly version: string;
  readonly payload: SkillNodePayload;
  /** REQUIRED for skill nodes (architecture.md §3). */
  readonly provenance: { readonly recordDigest: string };
  /** Optional: supersede a node previously declared by the SAME pack. */
  readonly supersedes?: string;
}

/** An evaluator node declared by a pack (created and appended on application). */
export interface EvaluatorDeclaration {
  readonly id: string;
  readonly version: string;
  readonly payload: TitledNodePayload;
  readonly provenance?: { readonly recordDigest: string };
  readonly supersedes?: string;
}

/** An edge declared by a pack (endpoints: existing or pack-declared nodes). */
export interface PackEdgeDeclaration {
  readonly kind: string;
  readonly source: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly target: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly payload?: { readonly note?: string };
  readonly provenance: { readonly recordDigest: string };
}

export interface DomainPackDeclaration {
  /** New skill nodes the pack adds to the target domain's taxonomy. */
  readonly skills: readonly SkillDeclaration[];
  /** New evaluator nodes the pack adds. */
  readonly evaluators: readonly EvaluatorDeclaration[];
  /**
   * Environment extensions declared by the pack (explicit versioned
   * references; owned by the environment protocol, not by this graph).
   */
  readonly environments: readonly EnvironmentExtensionRef[];
  /** Edges among declared and existing nodes (append-only). */
  readonly edges: readonly PackEdgeDeclaration[];
}

// ---------------------------------------------------------------------------
// Pack descriptor
// ---------------------------------------------------------------------------

/** The target domain locator of a pack. */
export interface DomainPackTargetDomain {
  readonly kind: 'domain';
  readonly id: string;
  readonly version: string;
}

export interface DomainPackDescriptor {
  readonly packId: DomainPackId;
  readonly version: string;
  readonly targetDomain: DomainPackTargetDomain;
  readonly declaration: DomainPackDeclaration;
  /** Provenance of the pack itself (lock rule 18). */
  readonly provenance: ProvenanceRefView;
}

/** An applied pack record, appended to the graph's pack history. */
export interface AppliedDomainPack {
  readonly recordVersion: typeof CAPABILITY_RECORD_VERSION;
  readonly pack: DomainPackDescriptor;
  /** sha256 over the canonical {recordVersion, pack, appliedAt, declaredNodeKeys}. */
  readonly packDigest: string;
  readonly appliedAt: CapabilityTimestamp;
  /** Identity keys of the nodes this application declared (ownership proof). */
  readonly declaredNodeKeys: readonly string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function invalidPack(reason: string, details?: Readonly<Record<string, unknown>>): never {
  throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PACK, {
    message: reason,
    ...(details !== undefined ? { details } : {}),
  });
}

/** Structural validation of a domain pack descriptor. */
export function isDomainPack(value: unknown): value is DomainPackDescriptor {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const declaration = candidate['declaration'];
  if (typeof declaration !== 'object' || declaration === null) return false;
  const decl = declaration as Record<string, unknown>;
  const targetDomain = candidate['targetDomain'];
  if (typeof targetDomain !== 'object' || targetDomain === null) return false;
  const target = targetDomain as Record<string, unknown>;
  return (
    isDomainPackId(candidate['packId']) &&
    typeof candidate['version'] === 'string' &&
    ENVIRONMENT_VERSION_PATTERN.test(candidate['version']) &&
    target['kind'] === 'domain' &&
    typeof target['id'] === 'string' &&
    ENVIRONMENT_ID_PATTERN.test(target['id']) &&
    typeof target['version'] === 'string' &&
    ENVIRONMENT_VERSION_PATTERN.test(target['version']) &&
    Array.isArray(decl['skills']) &&
    Array.isArray(decl['evaluators']) &&
    Array.isArray(decl['environments']) &&
    decl['environments'].every((env) => isEnvironmentExtensionRef(env)) &&
    Array.isArray(decl['edges']) &&
    isProvenanceRefView(candidate['provenance'])
  );
}

/** Validate and freeze a domain pack descriptor; throws INVALID_PACK. */
export function toDomainPack(value: {
  packId: string;
  version: string;
  targetDomain: { kind: 'domain'; id: string; version: string };
  declaration: {
    skills: readonly SkillDeclaration[];
    evaluators: readonly EvaluatorDeclaration[];
    environments: readonly EnvironmentExtensionRef[];
    edges: readonly PackEdgeDeclaration[];
  };
  provenance: { recordDigest: string };
}): DomainPackDescriptor {
  if (!isDomainPackId(value.packId)) {
    invalidPack(`invalid domain pack id: ${JSON.stringify(value.packId)}`, {
      pattern: DOMAIN_PACK_ID_PATTERN_SOURCE,
    });
  }
  if (typeof value.version !== 'string' || !ENVIRONMENT_VERSION_PATTERN.test(value.version)) {
    invalidPack(`invalid domain pack version: ${JSON.stringify(value.version)}`, {
      pattern: 'semver major.minor.patch (no build metadata)',
    });
  }
  const target = value.targetDomain;
  if (
    target.kind !== 'domain' ||
    typeof target.id !== 'string' ||
    !ENVIRONMENT_ID_PATTERN.test(target.id) ||
    typeof target.version !== 'string' ||
    !ENVIRONMENT_VERSION_PATTERN.test(target.version)
  ) {
    invalidPack('pack targetDomain must be a domain node locator { kind: "domain", id, version }');
  }
  const declaration = value.declaration;
  if (typeof declaration !== 'object' || declaration === null) {
    invalidPack('pack declaration must be an object');
  }
  if (!Array.isArray(declaration.skills)) {
    invalidPack('pack declaration requires a skills array');
  }
  if (!Array.isArray(declaration.evaluators)) {
    invalidPack('pack declaration requires an evaluators array');
  }
  if (!Array.isArray(declaration.environments)) {
    invalidPack('pack declaration requires an environments array');
  }
  for (const env of declaration.environments) {
    if (!isEnvironmentExtensionRef(env)) {
      invalidPack(`invalid environment extension reference: ${JSON.stringify(env)}`);
    }
  }
  if (!Array.isArray(declaration.edges)) {
    invalidPack('pack declaration requires an edges array');
  }
  if (!isProvenanceRefView(value.provenance)) {
    invalidPack('domain packs require a provenance reference { recordDigest: <sha256 hex> }');
  }
  return deepFreeze({
    packId: value.packId,
    version: value.version,
    targetDomain: Object.freeze({ ...value.targetDomain }),
    declaration: deepFreeze({ ...value.declaration }),
    provenance: Object.freeze({ ...value.provenance }),
  });
}

// ---------------------------------------------------------------------------
// Application (append-only; ownership-enforced)
// ---------------------------------------------------------------------------

export interface ApplyDomainPackOptions {
  /** Explicit application time (deterministic tests); default: now. */
  readonly appliedAt?: string;
}

/**
 * sha256 digest over the canonical serialization of an applied-pack record
 * (recordVersion, pack, appliedAt, declaredNodeKeys) — the record's content
 * address.
 */
export async function appliedDomainPackDigest(
  record: Omit<AppliedDomainPack, 'packDigest'>,
): Promise<string> {
  return digestCanonical({
    recordVersion: record.recordVersion,
    pack: record.pack,
    appliedAt: record.appliedAt,
    declaredNodeKeys: [...record.declaredNodeKeys],
  });
}

/**
 * Apply a domain pack to a graph (pure, append-only). Returns a NEW graph.
 *
 * Enforcement (lock rule 21 — packs only append, they never fork):
 *   - the target domain node must exist in the graph;
 *   - a pack application with the same (packId, version) and identical
 *     descriptor is an idempotent no-op (SAME graph object returned); the
 *     same identity with different content is rejected
 *     (CAPABILITY_GRAPH_IDENTITY_CONFLICT);
 *   - declared nodes whose identity key already exists are allowed ONLY if
 *     bit-identical AND previously declared by the same pack id — anything
 *     else is a rewrite attempt (CAPABILITY_GRAPH_PACK_OVERREACH);
 *   - a declared node may supersede ONLY nodes owned by the same pack id
 *     (CAPABILITY_GRAPH_PACK_OVERREACH otherwise); supersession validity
 *     (same logical node, strictly higher version, no forks) is then
 *     enforced by the shared appendNode invariants;
 *   - declared edges go through the shared appendEdge invariants (endpoint
 *     resolution, per-kind endpoint matrix, acyclicity).
 */
export async function applyDomainPack(
  graph: CapabilityGraph,
  pack: DomainPackDescriptor,
  options?: ApplyDomainPackOptions,
): Promise<CapabilityGraph> {
  if (!isDomainPack(pack)) {
    invalidPack('applyDomainPack requires a structurally valid domain pack descriptor');
  }

  // Idempotency: same (packId, version)?
  for (const applied of graph.packs) {
    if (applied.pack.packId === pack.packId && applied.pack.version === pack.version) {
      const sameContent = await packDescriptorEquals(applied.pack, pack);
      if (sameContent) {
        return graph; // idempotent re-application of a bit-identical pack
      }
      throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `domain pack ${pack.packId}@${pack.version} is already applied with different content`,
        details: { packId: pack.packId, version: pack.version },
      });
    }
  }

  // Target domain must exist.
  const targetDomainNode = getNode(graph, {
    kind: 'domain',
    id: pack.targetDomain.id,
    version: pack.targetDomain.version,
  });
  if (targetDomainNode === null) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.NODE_NOT_FOUND, {
      message: `domain pack target domain is not in the graph: domain/${pack.targetDomain.id}@${pack.targetDomain.version}`,
      details: { packId: pack.packId, missing: `domain/${pack.targetDomain.id}@${pack.targetDomain.version}` },
    });
  }

  const declaredInThisApplication = new Set<string>();
  let nextGraph = graph;

  const declareNode = async (
    kind: 'skill' | 'evaluator',
    declaration: SkillDeclaration | EvaluatorDeclaration,
  ): Promise<void> => {
    const key = capabilityNodeKey({
      kind,
      id: declaration.id,
      version: declaration.version,
    });
    const existing = indicesFor(nextGraph).byKey.get(key);

    if (existing !== undefined) {
      // Existing key: only a bit-identical re-declaration by the SAME pack
      // is allowed (idempotent); anything else rewrites history.
      const owner = nodeDeclaredBy(nextGraph, existing);
      if (owner !== pack.packId && !declaredInThisApplication.has(key)) {
        throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.PACK_OVERREACH, {
          message: `domain pack ${pack.packId} attempts to redefine existing node ${key} (declared by ${owner === null ? 'the core graph' : `pack ${owner}`}); packs only append`,
          details: { packId: pack.packId, node: key, owner },
        });
      }
      // Reconstruct the node the declaration would produce and compare
      // digests; identical content is an idempotent skip, different content
      // without supersession is a rewrite attempt.
      const candidate = await createCapabilityNode({
        kind,
        id: declaration.id,
        version: declaration.version,
        payload: declaration.payload,
        ...(declaration.provenance !== undefined ? { provenance: declaration.provenance } : {}),
        ...(declaration.supersedes !== undefined ? { supersedes: declaration.supersedes } : {}),
      });
      if (candidate.digest === existing.digest) {
        declaredInThisApplication.add(key);
        return; // idempotent: the node is already in the graph
      }
      if (declaration.supersedes === undefined) {
        throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.PACK_OVERREACH, {
          message: `domain pack ${pack.packId} attempts to redefine existing node ${key} with different content and no supersession; packs only append`,
          details: { packId: pack.packId, node: key },
        });
      }
      // Supersession path: the target must be owned by this pack (fall
      // through to the shared appendNode supersession invariants, but
      // ownership is checked here first).
    }

    if (declaration.supersedes !== undefined) {
      const target = indicesFor(nextGraph).byDigest.get(declaration.supersedes);
      if (target === undefined) {
        throw new CapabilityGraphError(
          CAPABILITY_GRAPH_ERROR_CODES.INVALID_SUPERSESSION,
          {
            message: `domain pack ${pack.packId} declares a supersession of unknown digest ${declaration.supersedes}`,
            details: { packId: pack.packId, node: key, supersedes: declaration.supersedes },
          },
        );
      }
      const targetOwner = nodeDeclaredBy(nextGraph, target);
      if (targetOwner !== pack.packId && !declaredInThisApplication.has(capabilityNodeKey(target))) {
        throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.PACK_OVERREACH, {
          message: `domain pack ${pack.packId} attempts to supersede node ${capabilityNodeKey(target)} which it does not own (declared by ${targetOwner === null ? 'the core graph' : `pack ${targetOwner}`}); packs can only supersede their own nodes`,
          details: { packId: pack.packId, node: key, target: capabilityNodeKey(target), targetOwner },
        });
      }
    }

    const node = await createCapabilityNode({
      kind,
      id: declaration.id,
      version: declaration.version,
      payload: declaration.payload,
      ...(declaration.provenance !== undefined ? { provenance: declaration.provenance } : {}),
      ...(declaration.supersedes !== undefined ? { supersedes: declaration.supersedes } : {}),
    });
    nextGraph = await appendNode(nextGraph, node);
    declaredInThisApplication.add(key);
  };

  for (const declaration of pack.declaration.skills) {
    await declareNode('skill', declaration);
  }
  for (const declaration of pack.declaration.evaluators) {
    await declareNode('evaluator', declaration);
  }

  for (const edgeDeclaration of pack.declaration.edges) {
    const edge: CapabilityEdge = await createCapabilityEdge(edgeDeclaration);
    nextGraph = await appendEdge(nextGraph, edge);
  }

  const appliedAt = toCapabilityTimestamp(options?.appliedAt ?? new Date().toISOString());
  const declaredNodeKeys = [...declaredInThisApplication].sort();
  const record: Omit<AppliedDomainPack, 'packDigest'> = {
    recordVersion: CAPABILITY_RECORD_VERSION,
    pack,
    appliedAt,
    declaredNodeKeys,
  };
  const packDigest = await appliedDomainPackDigest(record);
  const applied: AppliedDomainPack = deepFreeze({
    ...record,
    packDigest,
  });
  return appendPackRecord(nextGraph, applied);
}

async function packDescriptorEquals(
  a: DomainPackDescriptor,
  b: DomainPackDescriptor,
): Promise<boolean> {
  const da = await digestCanonical(a);
  const db = await digestCanonical(b);
  return da === db;
}
