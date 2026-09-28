/**
 * Shared structural components (Work Order A006).
 *
 * @arena/expert-registry is a DOMAIN package: its only runtime dependency is
 * @arena/protocol-core, so it cannot import the value surface of sibling
 * domain packages (@arena/artifact-protocol, @arena/agent-body,
 * @arena/capability-graph, @arena/capability-case,
 * @arena/environment-protocol, @arena/model-substrate,
 * @arena/provenance). Every cross-protocol object an expert profile
 * references is therefore defined HERE as a validated plain-string VIEW
 * type — the same pattern @arena/capability-case uses (see its shared.ts).
 *
 * The views are STRUCTURALLY COMPATIBLE with the owning packages' types
 * (plain strings accept branded strings), so a capability-graph competency
 * node ref or a provenance record ref can be passed through these
 * validators unchanged. Pattern sources are duplicated from the owning
 * packages' surfaces and mirrored in the generated contracts, so the
 * duplication cannot drift silently (see contracts.parity.test.ts).
 */

import type { Brand } from '@arena/protocol-core';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';

// ---------------------------------------------------------------------------
// Deep freeze (convention of every Arena domain package)
// ---------------------------------------------------------------------------

/**
 * Recursively freeze a value (arrays, plain objects; Maps are not used in
 * canonical objects — the registry keeps frozen arrays instead).
 */
export function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
    return value;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Tenant scope (architecture-lock rule 11; artifact-protocol convention)
// ---------------------------------------------------------------------------

export type TenantScope = Brand<string, 'TenantScope'>;

/**
 * The reserved GLOBAL namespace: explicitly published, tenant-independent
 * experts (the artifact-protocol `public` namespace convention — lock rule
 * 12: public artifacts are explicitly published and versioned). Every
 * tenant may READ the public scope; only the public scope's own actors
 * mutate it.
 */
export const PUBLIC_TENANT = 'public' as const;

/** Exact pattern source; MUST equal @arena/artifact-protocol's namespace pattern. */
export const TENANT_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';

const TENANT_PATTERN = new RegExp(TENANT_PATTERN_SOURCE);

export function isTenantScope(value: unknown): value is TenantScope {
  return typeof value === 'string' && TENANT_PATTERN.test(value);
}

/** Validate and brand a tenant scope; throws INVALID_IDENTITY otherwise. */
export function toTenantScope(value: string): TenantScope {
  if (!isTenantScope(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid tenant scope: ${JSON.stringify(value)} (lowercase kebab, 2-63 chars; the reserved global namespace is "public")`,
      details: { pattern: TENANT_PATTERN_SOURCE },
    });
  }
  return value;
}

/**
 * True iff a profile owned by `profileTenant` is visible to a reader acting
 * in `readerTenant` (lock rule 11: customer data is tenant-scoped and
 * cannot be silently cross-reused; the reserved `public` namespace is the
 * only globally readable scope).
 */
export function isTenantVisible(profileTenant: string, readerTenant: string): boolean {
  return profileTenant === readerTenant || profileTenant === PUBLIC_TENANT;
}

// ---------------------------------------------------------------------------
// Content digests (sha256, lowercase hex — computed by @arena/protocol-core)
// ---------------------------------------------------------------------------

export type ContentDigest = Brand<string, 'ContentDigest'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';

const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);

export function isContentDigest(value: unknown): value is ContentDigest {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

/** Validate and brand a sha256 content digest; throws INVALID_DIGEST otherwise. */
export function toContentDigest(value: string): ContentDigest {
  if (!isContentDigest(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_DIGEST, {
      message: `invalid content digest: ${JSON.stringify(value)} (expected a lowercase 64-char sha256 hex digest)`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return value;
}

// ---------------------------------------------------------------------------
// Semver (pattern + precedence, duplicated from the sibling convention)
// ---------------------------------------------------------------------------

export type ExpertVersion = Brand<string, 'ExpertVersion'>;

/**
 * Exact pattern source (kept in sync with the generated contracts):
 * semver 2.0.0 core with optional prerelease, WITHOUT build metadata
 * (content addressing requires exact versions — same rule as
 * @arena/artifact-protocol and @arena/capability-case).
 */
export const EXPERT_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';

const VERSION_PATTERN = new RegExp(EXPERT_VERSION_PATTERN_SOURCE);

export function isExpertVersion(value: unknown): value is ExpertVersion {
  return typeof value === 'string' && VERSION_PATTERN.test(value);
}

/** Validate and brand a profile version; throws INVALID_VERSION otherwise. */
export function toExpertVersion(value: string): ExpertVersion {
  if (!isExpertVersion(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_VERSION, {
      message: `invalid expert profile version: ${JSON.stringify(value)} (semver major.minor.patch with optional prerelease; build metadata is not allowed)`,
      details: { pattern: EXPERT_VERSION_PATTERN_SOURCE },
    });
  }
  return value;
}

/**
 * Semver 2.0.0 precedence comparison (local implementation mirroring the
 * sibling packages; @arena/protocol-core does not export a comparator).
 * Negative when `a` is lower, positive when `a` is higher, 0 when equal.
 */
export function compareExpertVersions(a: string, b: string): number {
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
    if (aNum !== null) return -1; // numeric identifiers sort lower
    if (bNum !== null) return 1;
    if (aPart < bPart) return -1;
    if (aPart > bPart) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// PrincipalRefView — the tenant-scoped actor (artifact-protocol convention)
// ---------------------------------------------------------------------------

/** Closed set of principal types (mirrors @arena/artifact-protocol). */
export const PRINCIPAL_TYPES = [
  'agent-body',
  'expert',
  'user',
  'service',
  'system',
] as const;

export type PrincipalType = (typeof PRINCIPAL_TYPES)[number];

/** Exact pattern source; mirrors @arena/artifact-protocol's principal ids. */
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';

const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);

/**
 * The tenant-scoped principal that registered or acted on an expert
 * profile. Structurally compatible with @arena/artifact-protocol's
 * PrincipalRef. Never a raw provider identity (lock rule 10): the closed
 * type enum has no model/provider member and the id charset excludes
 * provider identity shapes.
 */
export interface PrincipalRefView {
  readonly type: PrincipalType;
  readonly tenant: TenantScope;
  readonly principalId: string;
}

export function isPrincipalType(value: unknown): value is PrincipalType {
  return (
    typeof value === 'string' &&
    (PRINCIPAL_TYPES as readonly string[]).includes(value)
  );
}

export function isPrincipalRefView(value: unknown): value is PrincipalRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isPrincipalType(candidate['type']) &&
    isTenantScope(candidate['tenant']) &&
    typeof candidate['principalId'] === 'string' &&
    PRINCIPAL_ID_PATTERN.test(candidate['principalId'])
  );
}

/** Validate and freeze a principal reference; throws INVALID_PRINCIPAL otherwise. */
export function toPrincipalRefView(value: {
  type: string;
  tenant: string;
  principalId: string;
}): PrincipalRefView {
  if (!isPrincipalType(value.type)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `unknown principal type: ${JSON.stringify(value.type)} (known: ${PRINCIPAL_TYPES.join(', ')})`,
      details: { known: [...PRINCIPAL_TYPES] },
    });
  }
  if (!isTenantScope(value.tenant)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `invalid principal tenant scope: ${JSON.stringify(value.tenant)}`,
      details: { pattern: TENANT_PATTERN_SOURCE },
    });
  }
  if (
    typeof value.principalId !== 'string' ||
    !PRINCIPAL_ID_PATTERN.test(value.principalId)
  ) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `invalid principal id: ${JSON.stringify(value.principalId)} (raw provider identities are not principal identifiers)`,
      details: { pattern: PRINCIPAL_ID_PATTERN_SOURCE },
    });
  }
  return Object.freeze({
    type: value.type,
    tenant: value.tenant,
    principalId: value.principalId,
  });
}

/**
 * A principal VALUE: either a validated (branded) PrincipalRefView or its
 * plain structural form (the job-protocol convention for actor inputs).
 */
export type PrincipalRefLike =
  | PrincipalRefView
  | { type: string; tenant: string; principalId: string };

// ---------------------------------------------------------------------------
// EvidenceRef — digest-addressed evidence (lock rule 6 discipline)
// ---------------------------------------------------------------------------

export interface EvidenceRef {
  readonly digest: ContentDigest;
  readonly description: string;
}

export type EvidenceRefLike = EvidenceRef | { digest: string; description: string };

export function isEvidenceRef(value: unknown): value is EvidenceRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isContentDigest(candidate['digest']) &&
    typeof candidate['description'] === 'string' &&
    candidate['description'].length > 0
  );
}

/** Validate and freeze a digest-addressed evidence ref; throws INVALID_EVIDENCE otherwise. */
export function toEvidenceRef(value: {
  digest: string;
  description: string;
}): EvidenceRef {
  if (!isContentDigest(value.digest)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_EVIDENCE, {
      message: `invalid evidence digest: ${JSON.stringify(value.digest)}`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  if (typeof value.description !== 'string' || value.description.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_EVIDENCE, {
      message: `evidence description must be a non-empty string: ${JSON.stringify(value.description)}`,
    });
  }
  return Object.freeze({ digest: value.digest, description: value.description });
}

/** Assert no duplicate evidence digests appear in a list (append discipline). */
export function assertNoDuplicateEvidence(evidence: readonly EvidenceRef[]): void {
  const seen = new Set<string>();
  for (const ref of evidence) {
    if (seen.has(ref.digest)) {
      throw new ExpertRegistryError(EXPERT_ERROR_CODES.DUPLICATE_EVIDENCE, {
        message: `duplicate evidence digest: ${ref.digest}`,
        details: { digest: ref.digest },
      });
    }
    seen.add(ref.digest);
  }
}

// ---------------------------------------------------------------------------
// CapabilityNodeRefView — a capability-graph node reference (A004 view)
// ---------------------------------------------------------------------------

/**
 * The eleven node kinds of the Capability Graph (docs/architecture.md §4).
 * Pattern source MUST equal @arena/capability-graph's CAPABILITY_NODE_KINDS;
 * mirrored in the generated contracts so the duplication cannot drift.
 */
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

export type CapabilityNodeKindView = (typeof CAPABILITY_NODE_KINDS)[number];

/** Exact pattern source; MUST equal @arena/capability-graph's node id pattern. */
export const CAPABILITY_NODE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const CAPABILITY_NODE_ID_PATTERN = new RegExp(CAPABILITY_NODE_ID_PATTERN_SOURCE);

/**
 * A content-addressed reference to a Capability Graph node (structurally
 * @arena/capability-graph's CapabilityNodeRef). An expert competency
 * references the graph; the graph does not own the profile, and neither
 * replaces the other's authority (architecture.md §4: "It is descriptive
 * and queryable; it does not replace object authority").
 */
export interface CapabilityNodeRefView {
  readonly kind: CapabilityNodeKindView;
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}

export function isCapabilityNodeKindView(
  value: unknown,
): value is CapabilityNodeKindView {
  return (
    typeof value === 'string' &&
    (CAPABILITY_NODE_KINDS as readonly string[]).includes(value)
  );
}

export function isCapabilityNodeRefView(
  value: unknown,
): value is CapabilityNodeRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isCapabilityNodeKindView(candidate['kind']) &&
    typeof candidate['id'] === 'string' &&
    CAPABILITY_NODE_ID_PATTERN.test(candidate['id']) &&
    isExpertVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/**
 * Validate and freeze a capability-node reference, optionally constraining
 * the node kind to an allowed subset (§8 endpoint discipline: a profile's
 * competency refs use `capability`/`sub-capability`/`skill`/
 * `expert-competency` nodes; its domain refs use `domain` nodes).
 */
export function toCapabilityNodeRefView(
  value: {
    kind: string;
    id: string;
    version: string;
    digest: string;
  },
  allowedKinds?: readonly CapabilityNodeKindView[],
): CapabilityNodeRefView {
  const kind = value.kind;
  if (!isCapabilityNodeKindView(kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `unknown capability node kind: ${JSON.stringify(value.kind)} (known: ${CAPABILITY_NODE_KINDS.join(', ')})`,
      details: { known: [...CAPABILITY_NODE_KINDS] },
    });
  }
  if (allowedKinds !== undefined && !allowedKinds.includes(kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `capability node kind ${JSON.stringify(kind)} is not allowed here (expected: ${allowedKinds.join(', ')})`,
      details: { allowed: [...allowedKinds] },
    });
  }
  if (typeof value.id !== 'string' || !CAPABILITY_NODE_ID_PATTERN.test(value.id)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node id: ${JSON.stringify(value.id)}`,
      details: { pattern: CAPABILITY_NODE_ID_PATTERN_SOURCE },
    });
  }
  if (!isExpertVersion(value.version)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node version: ${JSON.stringify(value.version)}`,
      details: { pattern: EXPERT_VERSION_PATTERN_SOURCE },
    });
  }
  if (!isContentDigest(value.digest)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `invalid capability node digest: ${JSON.stringify(value.digest)}`,
      details: { pattern: CONTENT_DIGEST_PATTERN_SOURCE },
    });
  }
  return Object.freeze({
    kind,
    id: value.id,
    version: value.version,
    digest: value.digest,
  });
}

/** Stable key for a capability node ref: `<kind>:<id>@<version>#<digest>`. */
export function capabilityNodeRefViewKey(ref: CapabilityNodeRefView): string {
  return `${ref.kind}:${ref.id}@${ref.version}#${ref.digest}`;
}

// ---------------------------------------------------------------------------
// Neutral identifier locator — charset excludes PII shapes by construction
// ---------------------------------------------------------------------------

/**
 * Exact pattern for neutral locator strings (identity refs, credential
 * references). The charset deliberately EXCLUDES '@', '+', '(' and spaces,
 * which structurally prevents email addresses and phone numbers from
 * being carried as "neutral identifiers" (PII minimization, §8 identity).
 */
export const NEUTRAL_LOCATOR_PATTERN_SOURCE =
  '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$';

const NEUTRAL_LOCATOR_PATTERN = new RegExp(NEUTRAL_LOCATOR_PATTERN_SOURCE);

export function isNeutralLocator(value: unknown): value is string {
  return typeof value === 'string' && NEUTRAL_LOCATOR_PATTERN.test(value);
}

/** Validate a neutral locator string; throws INVALID_REF otherwise. */
export function toNeutralLocator(value: string, what: string): string {
  if (!isNeutralLocator(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `invalid ${what}: ${JSON.stringify(value)} (neutral identifier charset — email/phone-shaped strings are rejected by construction)`,
      details: { pattern: NEUTRAL_LOCATOR_PATTERN_SOURCE },
    });
  }
  return value;
}
