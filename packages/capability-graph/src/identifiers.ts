/**
 * Capability-graph identifiers (Work Order A004; docs/architecture.md §4).
 *
 * The Capability Graph relates eleven node kinds:
 *   domain; capability; sub-capability; skill; tool; task family; evaluator;
 *   verifier; expert competency; observed failure; body version.
 *
 * Every node is versioned and digest-addressed:
 *   - `kind` is one of the closed eleven-member enum below;
 *   - `id` is the node's stable identifier within its kind (a slug);
 *   - `version` is a semver-compatible version (major.minor.patch with an
 *     optional prerelease; build metadata is REJECTED, exactly like
 *     @arena/artifact-protocol's versions, because content addressing
 *     requires exact versions);
 *   - the digest (see nodes.ts) is the sha256 over the canonical JSON of the
 *     node's digest-free view.
 *
 * Node addresses have a stable string form:
 *   `arena:capnode/<kind>/<id>@<version>` (plus `#<digest>` for full refs).
 *
 * Identifiers are pure data: creation validates and brands the parts, and no
 * mutation API exists anywhere in this package.
 */

import type { Brand } from '@arena/protocol-core';
import { CAPABILITY_GRAPH_ERROR_CODES, CapabilityGraphError } from './errors.js';

// ---------------------------------------------------------------------------
// Node kinds — the closed eleven-member set (architecture.md §4)
// ---------------------------------------------------------------------------

/** The eleven node kinds of the Capability Graph (architecture.md §4). */
export const CAPABILITY_NODE_KINDS = [
  'domain',
  'capability',
  'sub-capability',
  'skill',
  'tool',
  'task-family',
  'evaluator',
  'verifier',
  'expert-competency',
  'observed-failure',
  'body-version',
] as const;

export type CapabilityNodeKind = (typeof CAPABILITY_NODE_KINDS)[number];

export function isCapabilityNodeKind(value: unknown): value is CapabilityNodeKind {
  return (
    typeof value === 'string' &&
    (CAPABILITY_NODE_KINDS as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------------
// Branded identifier parts
// ---------------------------------------------------------------------------

export type CapabilityNodeId = Brand<string, 'CapabilityNodeId'>;
export type CapabilityNodeVersion = Brand<string, 'CapabilityNodeVersion'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CAPABILITY_NODE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

/**
 * Exact pattern source (kept in sync with the generated contracts):
 * semver 2.0.0 core with optional prerelease, WITHOUT build metadata.
 */
export const CAPABILITY_NODE_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const NODE_ID_PATTERN = new RegExp(CAPABILITY_NODE_ID_PATTERN_SOURCE);
const NODE_VERSION_PATTERN = new RegExp(CAPABILITY_NODE_VERSION_PATTERN_SOURCE);

export function isCapabilityNodeId(value: unknown): value is CapabilityNodeId {
  return typeof value === 'string' && NODE_ID_PATTERN.test(value);
}

export function isCapabilityNodeVersion(
  value: unknown,
): value is CapabilityNodeVersion {
  return typeof value === 'string' && NODE_VERSION_PATTERN.test(value);
}

/** Validate and brand a node id; throws CAPABILITY_GRAPH_INVALID_ID otherwise. */
export function toCapabilityNodeId(value: string): CapabilityNodeId {
  if (!isCapabilityNodeId(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_ID, {
      message: `invalid capability node id: ${JSON.stringify(value)}`,
      details: { pattern: CAPABILITY_NODE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Validate and brand a node version; throws CAPABILITY_GRAPH_INVALID_VERSION otherwise. */
export function toCapabilityNodeVersion(value: string): CapabilityNodeVersion {
  if (!isCapabilityNodeVersion(value)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_VERSION, {
      message: `invalid capability node version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: CAPABILITY_NODE_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Node address string form: arena:capnode/<kind>/<id>@<version>[#<digest>]
// ---------------------------------------------------------------------------

export const CAPABILITY_NODE_PREFIX = 'arena:capnode';

/** Exact pattern source for the address string form (mirrors the contracts). */
export const CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE =
  '^arena:capnode/(domain|capability|sub-capability|skill|tool|task-family|' +
  'evaluator|verifier|expert-competency|observed-failure|body-version)/' +
  '[a-z][a-z0-9-]{0,127}@(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)' +
  '(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const ADDRESS_PARSE_PATTERN = new RegExp(
  '^arena:capnode/([a-z-]+)/([a-z][a-z0-9-]{0,127})@((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)$',
);

/** A parsed node address: kind, id and version (no digest). */
export interface CapabilityNodeAddress {
  readonly kind: CapabilityNodeKind;
  readonly id: CapabilityNodeId;
  readonly version: CapabilityNodeVersion;
}

/** Format a node address as its stable string form (accepts branded or
 *  validated plain id/version fields — branded strings are strings). */
export function formatCapabilityNodeAddress(address: {
  readonly kind: CapabilityNodeKind;
  readonly id: string;
  readonly version: string;
}): string {
  return `${CAPABILITY_NODE_PREFIX}/${address.kind}/${address.id}@${address.version}`;
}

/** Format a full node ref (address + digest) as `<address>#<digest>`. */
export function formatCapabilityNodeRefString(ref: {
  readonly kind: CapabilityNodeKind;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}): string {
  return `${CAPABILITY_NODE_PREFIX}/${ref.kind}/${ref.id}@${ref.version}#${ref.digest}`;
}

/**
 * Strictly parse a node address string. Throws CAPABILITY_GRAPH_INVALID_REF
 * for anything that is not an exact `arena:capnode/<kind>/<id>@<version>`
 * address (including unknown kinds).
 */
export function parseCapabilityNodeAddress(value: string): CapabilityNodeAddress {
  const match = ADDRESS_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node address: ${JSON.stringify(value)}`,
      details: { pattern: CAPABILITY_NODE_ADDRESS_PATTERN_SOURCE },
    });
  }
  const kind = match[1];
  const id = match[2];
  const version = match[3];
  if (kind === undefined || id === undefined || version === undefined) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node address: ${JSON.stringify(value)}`,
    });
  }
  if (!isCapabilityNodeKind(kind)) {
    throw new CapabilityGraphError(CAPABILITY_GRAPH_ERROR_CODES.INVALID_NODE_KIND, {
      message: `unknown capability node kind: ${JSON.stringify(kind)} (known: ${CAPABILITY_NODE_KINDS.join(', ')})`,
      details: { known: [...CAPABILITY_NODE_KINDS] },
    });
  }
  return { kind, id: toCapabilityNodeId(id), version: toCapabilityNodeVersion(version) };
}

// ---------------------------------------------------------------------------
// Stable keys
// ---------------------------------------------------------------------------

/**
 * Stable identity key of a node within a graph:
 * `<kind>/<id>@<version>`. Two nodes with the same key MUST be bit-identical
 * (same digest) or the graph rejects the second (identity immutability).
 * Accepts plain or branded id/version fields (branded strings are strings).
 */
export function capabilityNodeKey(address: {
  readonly kind: CapabilityNodeKind;
  readonly id: string;
  readonly version: string;
}): string {
  return `${address.kind}/${address.id}@${address.version}`;
}

/** Stable logical-node key (kind + id, versionless). */
export function capabilityNodeLogicalKey(address: {
  readonly kind: CapabilityNodeKind;
  readonly id: string;
}): string {
  return `${address.kind}/${address.id}`;
}

// ---------------------------------------------------------------------------
// Semver precedence (local implementation)
// ---------------------------------------------------------------------------

/**
 * Semver 2.0.0 precedence comparison for capability node versions:
 * negative when `a` is lower, positive when `a` is higher, 0 when equal
 * precedence. Build metadata never applies (rejected at validation time).
 * Accepts branded or validated plain versions (branded strings are strings).
 *
 * Implemented locally (mirroring @arena/artifact-protocol's
 * compareArtifactVersions) because this package's only runtime dependency is
 * @arena/protocol-core, which does not export a semver comparator. This is
 * version-precedence logic, NOT canonical-JSON/digest logic — those are
 * always reused from @arena/protocol-core.
 */
export function compareCapabilityNodeVersions(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let i = 0; i < 3; i += 1) {
    const aPart = aCore[i] ?? 0;
    const bPart = bCore[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  if (aPre === null && bPre === null) return 0;
  // A version without prerelease has HIGHER precedence than one with.
  if (aPre === null) return 1;
  if (bPre === null) return -1;
  return comparePrerelease(aPre, bPre);
}

function splitVersion(version: string): [number[], string[] | null] {
  const [core, prerelease] = version.split('-', 2) as [string, string | undefined];
  const coreParts = core.split('.').map((part) => Number.parseInt(part, 10));
  if (prerelease === undefined) return [coreParts, null];
  return [coreParts, prerelease.split('.')];
}

function comparePrerelease(a: string[], b: string[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const aPart = a[i];
    const bPart = b[i];
    if (aPart === undefined) return -1; // shorter set of fields sorts lower
    if (bPart === undefined) return 1;
    const aNum = /^\d+$/.test(aPart) ? Number.parseInt(aPart, 10) : null;
    const bNum = /^\d+$/.test(bPart) ? Number.parseInt(bPart, 10) : null;
    if (aNum !== null && bNum !== null) {
      if (aNum !== bNum) return aNum - bNum;
      continue;
    }
    if (aNum !== null) return -1; // numeric identifiers sort lower than alphanumeric
    if (bNum !== null) return 1;
    if (aPart < bPart) return -1;
    if (aPart > bPart) return 1;
  }
  return 0;
}
