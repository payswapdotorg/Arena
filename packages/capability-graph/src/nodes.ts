/**
 * Capability nodes — the digest-addressed, versioned vertices of the
 * Capability Graph (Work Order A004; docs/architecture.md §3, §4;
 * requirements R4, R17, R32, R37).
 *
 * A node binds:
 *   - its kind (one of the closed eleven-member CAPABILITY_NODE_KINDS),
 *   - a stable id within the kind,
 *   - a semver version (major.minor.patch, optional prerelease, no build
 *     metadata),
 *   - a versioned payload-schema SchemaRef (arena:schema/capability/<name>),
 *   - the kind-specific payload (see payload.ts),
 *   - an optional supersedes digest (append-only supersession — a NEW node
 *     version that supersedes an EARLIER version of the same logical node;
 *     the original is never rewritten and stays addressable), and
 *   - an optional provenance reference (REQUIRED for skill nodes — §3)
 * to a sha256 `digest` computed over the canonical JSON serialization of the
 * digest-free view. Canonicalization and hashing are REUSED from
 * @arena/protocol-core (digestCanonical / canonicalJson) — never
 * reimplemented here.
 *
 * Immutability: `createCapabilityNode` validates, computes the digest and
 * DEEP-FREEZES the result. There is no mutation API in this package — no
 * rename, no setPayload, no bumpVersion — so "same identity, different
 * content" can only exist as a DIFFERENT node with a DIFFERENT digest, and
 * any object claiming a stale digest fails `verifyCapabilityNode`
 * (fail-closed tamper detection).
 *
 * Dedup/content-addressing invariant: same content ⇒ same digest; different
 * content ⇒ different digest (asserted by unit + property tests).
 */

import { digestCanonical } from '@arena/protocol-core';
import type { SchemaRef } from '@arena/protocol-core';
import {
  CAPABILITY_GRAPH_ERROR_CODES,
  CapabilityGraphError,
} from './errors.js';
import {
  capabilityNodeKey,
  isCapabilityNodeId,
  isCapabilityNodeKind,
  isCapabilityNodeVersion,
  toCapabilityNodeId,
  toCapabilityNodeVersion,
} from './identifiers.js';
import type {
  CapabilityNodeId,
  CapabilityNodeKind,
  CapabilityNodeVersion,
} from './identifiers.js';
import {
  deepFreeze,
  validateNodePayload,
} from './payload.js';
import type { CapabilityNodePayload } from './payload.js';
import {
  isObservedFailureNodePayload,
  isSkillNodePayload,
  isTitledNodePayload,
} from './payload.js';
import { isProvenanceRefView, toProvenanceRefView } from './shared.js';
import type { ProvenanceRefView } from './shared.js';

/** Wire version of the edge/node record shapes owned by this package. */
export const CAPABILITY_RECORD_VERSION = 1 as const;

/**
 * The payload schema a node kind uses. Versioned SchemaRefs — the node's
 * `payloadSchema` field carries this address; parity with the generated
 * contracts is asserted by contracts.parity.test.ts.
 */
export function payloadSchemaForNodeKind(kind: CapabilityNodeKind): SchemaRef {
  switch (kind) {
    case 'skill':
      return { namespace: 'capability', name: 'skill-payload', version: '1.0.0' };
    case 'observed-failure':
      return {
        namespace: 'capability',
        name: 'observed-failure-payload',
        version: '1.0.0',
      };
    default:
      return { namespace: 'capability', name: 'node-payload', version: '1.0.0' };
  }
}

// ---------------------------------------------------------------------------
// Node shapes
// ---------------------------------------------------------------------------

/** A content-addressed reference to a capability node (a graph edge value). */
export interface CapabilityNodeRef {
  readonly kind: CapabilityNodeKind;
  readonly id: CapabilityNodeId;
  readonly version: CapabilityNodeVersion;
  readonly digest: string;
}

/** Digest-free view of a capability node — exactly what the digest covers. */
export interface CapabilityNodeContentView {
  readonly kind: CapabilityNodeKind;
  readonly id: CapabilityNodeId;
  readonly version: CapabilityNodeVersion;
  readonly payloadSchema: SchemaRef;
  readonly payload: CapabilityNodePayload;
  readonly provenance?: ProvenanceRefView;
  readonly supersedes?: string;
}

/** A frozen capability node: the content view plus its sha256 digest. */
export interface CapabilityNode extends CapabilityNodeContentView {
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// Node refs
// ---------------------------------------------------------------------------

export function isCapabilityNodeRef(value: unknown): value is CapabilityNodeRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCapabilityNodeKind(candidate['kind']) &&
    isCapabilityNodeId(candidate['id']) &&
    isCapabilityNodeVersion(candidate['version']) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** Validate all parts and freeze a node reference. */
export function toCapabilityNodeRef(value: {
  kind: string;
  id: string;
  version: string;
  digest: string;
}): CapabilityNodeRef {
  if (!isCapabilityNodeKind(value.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE_KIND, {
      message: `unknown capability node kind: ${JSON.stringify(value.kind)}`,
      details: { known: ['domain', 'capability', 'sub-capability', 'skill', 'tool', 'task-family', 'evaluator', 'verifier', 'expert-competency', 'observed-failure', 'body-version'] },
    });
  }
  return Object.freeze({
    kind: value.kind,
    id: toCapabilityNodeId(value.id),
    version: toCapabilityNodeVersion(value.version),
    digest: toNodeDigest(value.digest),
  });
}

function toNodeDigest(value: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid node digest: ${JSON.stringify(value)} (expected lowercase sha256 hex)`,
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  return value;
}

/** Node ref of an existing node (frozen view). */
export function capabilityNodeRef(node: CapabilityNode): CapabilityNodeRef {
  return Object.freeze({
    kind: node.kind,
    id: node.id,
    version: node.version,
    digest: node.digest,
  });
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface CreateCapabilityNodeInput {
  readonly kind: string;
  readonly id: string;
  readonly version: string;
  readonly payload: unknown;
  /** REQUIRED for skill nodes (architecture.md §3). */
  readonly provenance?: { recordDigest: string };
  /**
   * Optional digest of the node version being superseded (append-only
   * supersession; validated against graph state when appended).
   */
  readonly supersedes?: string;
}

/**
 * Compute the sha256 digest over the canonical JSON of the digest-free node
 * view {kind, id, version, payloadSchema, payload, provenance?, supersedes?}.
 */
export async function computeCapabilityNodeDigest(
  view: CapabilityNodeContentView,
): Promise<string> {
  return digestCanonical({
    kind: view.kind,
    id: view.id,
    version: view.version,
    payloadSchema: view.payloadSchema,
    payload: view.payload,
    ...(view.provenance !== undefined ? { provenance: view.provenance } : {}),
    ...(view.supersedes !== undefined ? { supersedes: view.supersedes } : {}),
  });
}

/** The digest-free view of a node (what the digest commits to). */
export function capabilityNodeContentView(
  node: CapabilityNode,
): CapabilityNodeContentView {
  return {
    kind: node.kind,
    id: node.id,
    version: node.version,
    payloadSchema: node.payloadSchema,
    payload: node.payload,
    ...(node.provenance !== undefined ? { provenance: node.provenance } : {}),
    ...(node.supersedes !== undefined ? { supersedes: node.supersedes } : {}),
  };
}

/**
 * Create an immutable capability node: validates kind, id, version, payload
 * (per-kind), provenance (required for skills) and supersedes (sha256 hex),
 * computes the sha256 digest over the canonical serialization of the content
 * view, and deep-freezes the result. The returned object can never be
 * mutated in place.
 */
export async function createCapabilityNode(
  input: CreateCapabilityNodeInput,
): Promise<CapabilityNode> {
  if (!isCapabilityNodeKind(input.kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE_KIND, {
      message: `unknown capability node kind: ${JSON.stringify(input.kind)} (known: domain, capability, sub-capability, skill, tool, task-family, evaluator, verifier, expert-competency, observed-failure, body-version)`,
      details: { known: ['domain', 'capability', 'sub-capability', 'skill', 'tool', 'task-family', 'evaluator', 'verifier', 'expert-competency', 'observed-failure', 'body-version'] },
    });
  }
  const kind: CapabilityNodeKind = input.kind;
  const id = toCapabilityNodeId(input.id);
  const version = toCapabilityNodeVersion(input.version);
  const payload = validateNodePayload(kind, input.payload);
  const payloadSchema = payloadSchemaForNodeKind(kind);

  let provenance: ProvenanceRefView | undefined;
  if (input.provenance !== undefined) {
    if (!isProvenanceRefView(input.provenance)) {
      throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
        message: 'node provenance must be a provenance reference { recordDigest: <sha256 hex> }',
      });
    }
    provenance = toProvenanceRefView(input.provenance);
  }
  if (kind === 'skill' && provenance === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: `skill nodes require provenance (architecture.md §3: a skill is a versioned artifact with inputs, outputs, prerequisites, evidence, tests and provenance)`,
      details: { node: capabilityNodeKey({ kind, id, version }) },
    });
  }

  let supersedes: string | undefined;
  if (input.supersedes !== undefined) {
    supersedes = toNodeDigest(input.supersedes);
  }

  const view: CapabilityNodeContentView = {
    kind,
    id,
    version,
    payloadSchema,
    payload,
    ...(provenance !== undefined ? { provenance } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
  };
  const digest = await computeCapabilityNodeDigest(view);
  const node: CapabilityNode = deepFreeze({
    kind,
    id,
    version,
    payloadSchema: Object.freeze({ ...payloadSchema }),
    payload,
    ...(provenance !== undefined ? { provenance } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
    digest,
  });
  return node;
}

// ---------------------------------------------------------------------------
// Structural validation / verification (fail closed)
// ---------------------------------------------------------------------------

export function isCapabilityNode(value: unknown): value is CapabilityNode {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isCapabilityNodeKind(candidate['kind'])) return false;
  if (!isCapabilityNodeId(candidate['id'])) return false;
  if (!isCapabilityNodeVersion(candidate['version'])) return false;
  if (typeof candidate['payloadSchema'] !== 'object' || candidate['payloadSchema'] === null) {
    return false;
  }
  const schema = candidate['payloadSchema'] as Record<string, unknown>;
  if (
    schema['namespace'] !== 'capability' ||
    typeof schema['name'] !== 'string' ||
    typeof schema['version'] !== 'string'
  ) {
    return false;
  }
  if (
    schema['name'] !== payloadSchemaForNodeKind(candidate['kind']).name ||
    schema['version'] !== payloadSchemaForNodeKind(candidate['kind']).version
  ) {
    return false;
  }
  if (candidate['provenance'] !== undefined && !isProvenanceRefView(candidate['provenance'])) {
    return false;
  }
  if (
    candidate['supersedes'] !== undefined &&
    (typeof candidate['supersedes'] !== 'string' || !/^[0-9a-f]{64}$/.test(candidate['supersedes']))
  ) {
    return false;
  }
  if (typeof candidate['digest'] !== 'string' || !/^[0-9a-f]{64}$/.test(candidate['digest'])) {
    return false;
  }
  return isPayloadForNodeKind(candidate['kind'], candidate['payload']);
}

function isPayloadForNodeKind(
  kind: CapabilityNodeKind,
  payload: unknown,
): boolean {
  switch (kind) {
    case 'skill':
      return isSkillNodePayload(payload);
    case 'observed-failure':
      return isObservedFailureNodePayload(payload);
    default:
      return isTitledNodePayload(payload);
  }
}

/**
 * Re-compute a node's digest and compare it with the claimed digest (or an
 * explicitly expected one). FAILS CLOSED with CAPABILITY_GRAPH_TAMPERED on
 * any mismatch — a mutation of kind, id, version, payload, provenance or
 * supersedes is always detected. Returns the verified digest.
 */
export async function verifyCapabilityNode(
  node: CapabilityNode,
  expectedDigest?: string,
): Promise<string> {
  if (!isCapabilityNode(node)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE, {
      message: 'not a structurally valid capability node',
    });
  }
  const actual = await computeCapabilityNodeDigest(
    capabilityNodeContentView(node),
  );
  const claimed = expectedDigest ?? node.digest;
  if (actual !== claimed) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.TAMPERED, {
      message: `capability node digest mismatch: expected ${claimed}, recomputed ${actual}`,
      details: {
        expected: claimed,
        actual,
        node: capabilityNodeKey(node),
      },
    });
  }
  return actual;
}
