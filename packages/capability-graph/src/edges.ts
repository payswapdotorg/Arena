/**
 * Capability-graph edges — typed, provenance-bearing relations between
 * digest-addressed nodes (Work Order A004; docs/architecture.md §4).
 *
 * The graph relates: domain; capability; sub-capability; skill; tool; task
 * family; evaluator; verifier; expert competency; observed failure; body
 * version (architecture.md §4). Edges are the RELATIONS of that graph:
 *
 *   decomposes-into     — hierarchical decomposition (domain → capability →
 *                         sub-capability → skill, and skill → sub-skill);
 *   requires            — dependency (skill → skill, skill → tool);
 *   produces            — output feeding (skill → skill: the source's
 *                         outputs feed the target's inputs);
 *   evaluates           — evaluator → evaluated capability/skill/task/body;
 *   verifies            — verifier → verified capability/skill/task/body
 *                         (evaluation and verification stay distinct —
 *                         architecture-lock rule 7);
 *   observes-failure-of — observed failure → the node it was observed on;
 *   competent-in        — expert competency → domain/capability/skill;
 *   exercised-by        — skill/capability exercised by task family or body
 *                         version;
 *   extends-domain      — domain → domain extension (domain packs).
 *
 * Every edge carries:
 *   - a kind from the closed enum above (unknown kinds are REJECTED);
 *   - source/target node refs (kind-constrained per edge kind — the typed
 *     endpoint matrix EDGE_ENDPOINTS below);
 *   - a versioned payload-schema SchemaRef and a plain-JSON edge payload;
 *   - a REQUIRED provenance reference (lock rule 18: provenance-addressed);
 *   - a sha256 digest over the canonical JSON of the digest-free edge view.
 *
 * Edges are deep-frozen at creation; no mutation API exists.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';
import {
  capabilityNodeKey,
} from './identifiers.js';
import type { CapabilityNodeKind } from './identifiers.js';
import { CAPABILITY_RECORD_VERSION, isCapabilityNodeRef } from './nodes.js';
import type { CapabilityNodeRef } from './nodes.js';
import { deepFreeze } from './payload.js';
import { isProvenanceRefView, toProvenanceRefView } from './shared.js';
import type { ProvenanceRefView } from './shared.js';

// ---------------------------------------------------------------------------
// Edge kinds — the closed relation set
// ---------------------------------------------------------------------------

export const CAPABILITY_EDGE_KINDS = [
  'decomposes-into',
  'requires',
  'produces',
  'evaluates',
  'verifies',
  'observes-failure-of',
  'competent-in',
  'exercised-by',
  'extends-domain',
] as const;

export type CapabilityEdgeKind = (typeof CAPABILITY_EDGE_KINDS)[number];

export function isCapabilityEdgeKind(value: unknown): value is CapabilityEdgeKind {
  return (
    typeof value === 'string' &&
    (CAPABILITY_EDGE_KINDS as readonly string[]).includes(value)
  );
}

/**
 * The typed endpoint matrix: which node kinds may be the source and the
 * target of each edge kind. Enforced on every edge creation/insertion.
 */
export const EDGE_ENDPOINTS: Readonly<
  Record<CapabilityEdgeKind, { readonly source: readonly CapabilityNodeKind[]; readonly target: readonly CapabilityNodeKind[] }>
> = {
  'decomposes-into': {
    source: ['domain', 'capability', 'sub-capability', 'skill'],
    target: ['capability', 'sub-capability', 'skill'],
  },
  requires: {
    source: ['skill'],
    target: ['skill', 'tool'],
  },
  produces: {
    source: ['skill'],
    target: ['skill'],
  },
  evaluates: {
    source: ['evaluator'],
    target: [
      'domain',
      'capability',
      'sub-capability',
      'skill',
      'task-family',
      'body-version',
    ],
  },
  verifies: {
    source: ['verifier'],
    target: [
      'domain',
      'capability',
      'sub-capability',
      'skill',
      'task-family',
      'body-version',
    ],
  },
  'observes-failure-of': {
    source: ['observed-failure'],
    target: [
      'domain',
      'capability',
      'sub-capability',
      'skill',
      'tool',
      'task-family',
      'body-version',
    ],
  },
  'competent-in': {
    source: ['expert-competency'],
    target: ['domain', 'capability', 'sub-capability', 'skill'],
  },
  'exercised-by': {
    source: ['skill', 'capability', 'sub-capability'],
    target: ['task-family', 'body-version'],
  },
  'extends-domain': {
    source: ['domain'],
    target: ['domain'],
  },
};

/**
 * Edge kinds that participate in the acyclic invariant: the subgraph they
 * induce must remain a DAG (skill taxonomy cycles, circular dependencies and
 * domain-extension cycles are all rejected at insertion — see graph.ts).
 */
export const HIERARCHICAL_EDGE_KINDS: readonly CapabilityEdgeKind[] = [
  'decomposes-into',
  'extends-domain',
  'requires',
  'produces',
];

/** The payload schema of every edge (versioned SchemaRef). */
export function edgePayloadSchema(): SchemaRef {
  return { namespace: 'capability', name: 'edge-payload', version: '1.0.0' };
}

// ---------------------------------------------------------------------------
// Edge shapes
// ---------------------------------------------------------------------------

/** The plain-JSON payload of an edge (versioned by edgePayloadSchema). */
export interface CapabilityEdgePayload {
  readonly note?: string;
}

/** Digest-free view of an edge — exactly what the digest covers. */
export interface CapabilityEdgeContentView {
  readonly recordVersion: typeof CAPABILITY_RECORD_VERSION;
  readonly kind: CapabilityEdgeKind;
  readonly source: CapabilityNodeRef;
  readonly target: CapabilityNodeRef;
  readonly payload: CapabilityEdgePayload;
  readonly provenance: ProvenanceRefView;
}

/** A frozen edge: the content view plus its sha256 digest. */
export interface CapabilityEdge extends CapabilityEdgeContentView {
  readonly digest: string;
}

/** Stable identity key of an edge: `<kind>:<source> -> <target>`. */
export function capabilityEdgeKey(edge: {
  readonly kind: CapabilityEdgeKind;
  readonly source: CapabilityNodeRef;
  readonly target: CapabilityNodeRef;
}): string {
  return `${edge.kind}:${capabilityNodeKey(edge.source)} -> ${capabilityNodeKey(edge.target)}`;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateCapabilityEdgeInput {
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
  /** REQUIRED on every edge (architecture-lock rule 18). */
  readonly provenance: { readonly recordDigest: string };
}

function validateEdgePayload(value: unknown): CapabilityEdgePayload {
  if (value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PAYLOAD, {
      message: 'edge payload must be a plain object (optional note)',
    });
  }
  const candidate = value as Record<string, unknown>;
  const note = candidate['note'];
  if (note !== undefined && (typeof note !== 'string' || note.length === 0 || note.length > 2048)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_PAYLOAD, {
      message: `invalid edge payload note: ${JSON.stringify(note)} (non-empty string, at most 2048 characters)`,
    });
  }
  return deepFreeze({
    ...(note !== undefined ? { note } : {}),
  });
}

/**
 * Compute the sha256 digest over the canonical JSON of the digest-free edge
 * view {recordVersion, kind, source, target, payload, provenance}.
 */
export async function computeCapabilityEdgeDigest(
  view: CapabilityEdgeContentView,
): Promise<string> {
  return digestCanonical({
    recordVersion: view.recordVersion,
    kind: view.kind,
    source: view.source,
    target: view.target,
    payload: view.payload,
    provenance: view.provenance,
  });
}

/**
 * Create an immutable capability edge: validates the edge kind (closed set),
 * source/target node refs, per-kind endpoint constraints, the payload and
 * the REQUIRED provenance reference; rejects self-edges; computes the sha256
 * digest and deep-freezes the result.
 *
 * NOTE: this validates the edge IN ISOLATION. Graph-level rules (endpoint
 * nodes exist, no duplicate triple with different content, acyclicity of
 * the hierarchical edge subgraph) are enforced by appendEdge /
 * buildCapabilityGraph in graph.ts.
 */
export async function createCapabilityEdge(
  input: CreateCapabilityEdgeInput,
): Promise<CapabilityEdge> {
  if (!isCapabilityEdgeKind(input.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE_KIND, {
      message: `unknown capability edge kind: ${JSON.stringify(input.kind)} (known: ${CAPABILITY_EDGE_KINDS.join(', ')})`,
      details: { known: [...CAPABILITY_EDGE_KINDS] },
    });
  }
  const kind: CapabilityEdgeKind = input.kind;

  const source = toEdgeEndpoint(input.source, kind, 'source');
  const target = toEdgeEndpoint(input.target, kind, 'target');

  const endpoints = EDGE_ENDPOINTS[kind];
  if (!endpoints.source.includes(source.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `edge kind ${JSON.stringify(kind)} does not allow source kind ${JSON.stringify(source.kind)} (allowed: ${endpoints.source.join(', ')})`,
      details: { kind, role: 'source', allowed: [...endpoints.source], got: source.kind },
    });
  }
  if (!endpoints.target.includes(target.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `edge kind ${JSON.stringify(kind)} does not allow target kind ${JSON.stringify(target.kind)} (allowed: ${endpoints.target.join(', ')})`,
      details: { kind, role: 'target', allowed: [...endpoints.target], got: target.kind },
    });
  }

  if (capabilityNodeKey(source) === capabilityNodeKey(target)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: `self-edges are not allowed: ${capabilityEdgeKey({ kind, source, target })}`,
      details: { edge: capabilityEdgeKey({ kind, source, target }) },
    });
  }

  if (!isProvenanceRefView(input.provenance)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: 'every edge requires a valid provenance reference { recordDigest: <sha256 hex> } (architecture-lock rule 18)',
    });
  }
  const provenance = toProvenanceRefView(input.provenance);

  const payload = validateEdgePayload(input.payload);

  const view: CapabilityEdgeContentView = {
    recordVersion: CAPABILITY_RECORD_VERSION,
    kind,
    source,
    target,
    payload,
    provenance,
  };
  const digest = await computeCapabilityEdgeDigest(view);
  const edge: CapabilityEdge = deepFreeze({
    recordVersion: CAPABILITY_RECORD_VERSION,
    kind,
    source,
    target,
    payload,
    provenance,
    digest,
  });
  return edge;
}

function toEdgeEndpoint(
  value: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  },
  edgeKind: CapabilityEdgeKind,
  role: 'source' | 'target',
): CapabilityNodeRef {
  if (!isCapabilityNodeRef(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: `edge ${role} must be a valid capability node ref (kind, id, version, digest): ${JSON.stringify(value)}`,
      details: { role, edgeKind },
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Structural validation / verification (fail closed)
// ---------------------------------------------------------------------------

export function isCapabilityEdge(value: unknown): value is CapabilityEdge {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === CAPABILITY_RECORD_VERSION &&
    isCapabilityEdgeKind(candidate['kind']) &&
    isCapabilityNodeRef(candidate['source']) &&
    isCapabilityNodeRef(candidate['target']) &&
    typeof candidate['payload'] === 'object' &&
    candidate['payload'] !== null &&
    !Array.isArray(candidate['payload']) &&
    isProvenanceRefView(candidate['provenance']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of an edge (what the digest commits to). */
export function capabilityEdgeContentView(
  edge: CapabilityEdge,
): CapabilityEdgeContentView {
  return {
    recordVersion: edge.recordVersion,
    kind: edge.kind,
    source: edge.source,
    target: edge.target,
    payload: edge.payload,
    provenance: edge.provenance,
  };
}

/**
 * Re-compute an edge's digest and compare it with the claimed digest (or an
 * explicitly expected one). FAILS CLOSED with CAPABILITY_GRAPH_TAMPERED on
 * any mismatch.
 */
export async function verifyCapabilityEdge(
  edge: CapabilityEdge,
  expectedDigest?: string,
): Promise<string> {
  if (!isCapabilityEdge(edge)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_EDGE, {
      message: 'not a structurally valid capability edge',
    });
  }
  const actual = await computeCapabilityEdgeDigest(
    capabilityEdgeContentView(edge),
  );
  const claimed = expectedDigest ?? edge.digest;
  if (actual !== claimed) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.TAMPERED, {
      message: `capability edge digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: { expected: claimed, actual, edge: capabilityEdgeKey(edge) },
    });
  }
  return actual;
}
