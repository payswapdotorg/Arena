/**
 * Expert identity (Work Order A006; docs/architecture.md §8 "identity";
 * architecture-lock rule 9; PII minimization).
 *
 * An expert identity is (tenant, expertId):
 *   - `tenant` is the owning tenant scope, or the reserved `public`
 *     namespace for explicitly published global experts (lock rule 11);
 *   - `expertId` is a NEUTRAL identifier inside the scope. The id pattern
 *     REQUIRES the `expert-` prefix so a bare personal name can never be
 *     the identifier (PII minimization: identity is a neutral expert id —
 *     NO personal data beyond declared identity refs, which live in
 *     identity.ts as digest-addressed IdentityRefView records);
 *   - `version` is a semver-compatible profile version (major.minor.patch
 *     with an optional prerelease; build metadata is REJECTED — content
 *     addressing requires exact versions, same rule as every sibling
 *     package).
 *
 * Identity string form: `arena:expert/<tenant>/<expertId>` (versionless)
 * and `arena:expert/<tenant>/<expertId>@<version>` for the versioned
 * address. Full content-addressed refs add `#<digest>` (see
 * ExpertVersionRef).
 *
 * Identifiers are pure data: creation validates and brands the parts, and
 * no mutation API exists anywhere in this package.
 */

import type { Brand } from '@arena/protocol-core';
import { EXPERT_ERROR_CODES, ExpertRegistryError } from './errors.js';
import {
  isContentDigest,
  isExpertVersion,
  isNeutralLocator,
  isTenantScope,
  toContentDigest,
  toExpertVersion,
  toNeutralLocator,
  toTenantScope,
} from './shared.js';
import type { ContentDigest, ExpertVersion, TenantScope } from './shared.js';

export type ExpertId = Brand<string, 'ExpertId'>;

/**
 * Exact pattern source; kept in sync with the generated contracts. The
 * mandatory `expert-` prefix keeps identifiers NEUTRAL (machine-assigned
 * slugs/hex ids), never bare personal names.
 */
export const EXPERT_ID_PATTERN_SOURCE = '^expert-[a-z0-9][a-z0-9-]{0,61}$';

const EXPERT_ID_PATTERN = new RegExp(EXPERT_ID_PATTERN_SOURCE);

export function isExpertId(value: unknown): value is ExpertId {
  return typeof value === 'string' && EXPERT_ID_PATTERN.test(value);
}

/** Validate and brand an expert id; throws INVALID_IDENTITY otherwise. */
export function toExpertId(value: string): ExpertId {
  if (!isExpertId(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid expert id: ${JSON.stringify(value)} (neutral id, mandatory expert- prefix, lowercase kebab)`,
      details: { pattern: EXPERT_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** The stable identity of a logical expert (versionless). */
export interface ExpertIdentity {
  readonly tenant: TenantScope;
  readonly expertId: ExpertId;
}

/** String-form prefix for expert identities. */
export const EXPERT_IDENTITY_PREFIX = 'arena:expert';

/** Exact pattern source for the identity string form (mirrors the contracts). */
export const EXPERT_IDENTITY_PATTERN_SOURCE =
  '^arena:expert/[a-z][a-z0-9-]{1,62}/expert-[a-z0-9][a-z0-9-]{0,61}$';

const IDENTITY_PARSE_PATTERN =
  /^arena:expert\/([a-z][a-z0-9-]{1,62})\/(expert-[a-z0-9][a-z0-9-]{0,61})$/;

/** Validate both parts and produce a frozen ExpertIdentity. */
export function toExpertIdentity(value: {
  tenant: string;
  expertId: string;
}): ExpertIdentity {
  return Object.freeze({
    tenant: toTenantScope(value.tenant),
    expertId: toExpertId(value.expertId),
  });
}

export function isExpertIdentity(value: unknown): value is ExpertIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isTenantScope(candidate['tenant']) && isExpertId(candidate['expertId']);
}

/** Format an identity as its stable string form: `arena:expert/<tenant>/<expertId>`. */
export function formatExpertIdentity(identity: ExpertIdentity): string {
  return `${EXPERT_IDENTITY_PREFIX}/${identity.tenant}/${identity.expertId}`;
}

/** Strictly parse an identity string form; throws INVALID_IDENTITY otherwise. */
export function parseExpertIdentity(value: string): ExpertIdentity {
  const match = IDENTITY_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid expert identity string: ${JSON.stringify(value)}`,
      details: { pattern: EXPERT_IDENTITY_PATTERN_SOURCE },
    });
  }
  const tenant = match[1];
  const expertId = match[2];
  if (tenant === undefined || expertId === undefined) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid expert identity string: ${JSON.stringify(value)}`,
    });
  }
  return toExpertIdentity({ tenant, expertId });
}

/** True iff both identities share tenant and expert id. */
export function isSameExpertIdentity(a: ExpertIdentity, b: ExpertIdentity): boolean {
  return a.tenant === b.tenant && a.expertId === b.expertId;
}

// ---------------------------------------------------------------------------
// IdentityRef — the DECLARED identity reference (PII minimization)
// ---------------------------------------------------------------------------

/** Wire version of the identity-ref record shape. */
export const IDENTITY_REF_VERSION = 1 as const;

/**
 * Closed set of declared identity reference kinds. Personal data (legal
 * name, contact channels, government identifiers) NEVER appears inline on
 * a profile; it lives in digest-addressed attestation artifacts held by
 * the owning tenant, and the profile declares only these references.
 */
export const IDENTITY_REF_KINDS = [
  'identity-attestation',
  'contact-attestation',
  'external-identifier',
] as const;

export type IdentityRefKind = (typeof IDENTITY_REF_KINDS)[number];

/**
 * A declared identity reference: what kind of identity claim is declared,
 * the sha256 digest of the attestation artifact backing it, and an OPTIONAL
 * neutral locator (e.g. a DID or registry handle). The locator charset
 * excludes '@', '+' and whitespace, so email addresses and phone numbers
 * are rejected BY CONSTRUCTION (see shared.ts NEUTRAL_LOCATOR_PATTERN).
 */
export interface IdentityRefView {
  readonly refVersion: typeof IDENTITY_REF_VERSION;
  readonly kind: IdentityRefKind;
  readonly digest: ContentDigest;
  readonly locator?: string;
  readonly note?: string;
}

export function isIdentityRefKind(value: unknown): value is IdentityRefKind {
  return (
    typeof value === 'string' &&
    (IDENTITY_REF_KINDS as readonly string[]).includes(value)
  );
}

export function isIdentityRefView(value: unknown): value is IdentityRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['refVersion'] === IDENTITY_REF_VERSION &&
    isIdentityRefKind(candidate['kind']) &&
    isContentDigest(candidate['digest']) &&
    (candidate['locator'] === undefined || isNeutralLocator(candidate['locator'])) &&
    (candidate['note'] === undefined ||
      (typeof candidate['note'] === 'string' && candidate['note'].length > 0))
  );
}

/** Validate and freeze a declared identity ref; throws INVALID_IDENTITY_REF otherwise. */
export function toIdentityRefView(value: {
  kind: string;
  digest: string;
  locator?: string;
  note?: string;
}): IdentityRefView {
  if (!isIdentityRefKind(value.kind)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY_REF, {
      message: `unknown identity ref kind: ${JSON.stringify(value.kind)} (known: ${IDENTITY_REF_KINDS.join(', ')})`,
      details: { known: [...IDENTITY_REF_KINDS] },
    });
  }
  if (!isContentDigest(value.digest)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY_REF, {
      message: `invalid identity ref digest: ${JSON.stringify(value.digest)}`,
      details: { pattern: '^[0-9a-f]{64}$' },
    });
  }
  if (value.locator !== undefined) {
    toNeutralLocator(value.locator, 'identity ref locator');
  }
  if (value.note !== undefined && value.note.length === 0) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_IDENTITY_REF, {
      message: 'identity ref notes, when present, must be non-empty',
    });
  }
  return Object.freeze({
    refVersion: IDENTITY_REF_VERSION,
    kind: value.kind,
    digest: toContentDigest(value.digest),
    ...(value.locator !== undefined ? { locator: value.locator } : {}),
    ...(value.note !== undefined ? { note: value.note } : {}),
  });
}

// ---------------------------------------------------------------------------
// ExpertVersionRef — the full content-addressed profile version reference
// ---------------------------------------------------------------------------

/**
 * A content-addressed reference to one exact expert-profile STATE:
 * identity + version + the sha256 digest of that state's canonical content.
 * Because the lifecycle status and the append-only event log are part of a
 * profile state's content, a profile version's digest pins its exact
 * lifecycle state; every historical state stays addressable by its digest
 * (append-only history, lock rule 6).
 */
export interface ExpertVersionRef {
  readonly tenant: TenantScope;
  readonly expertId: ExpertId;
  readonly version: ExpertVersion;
  readonly digest: ContentDigest;
}

/** Exact pattern source for the full ref string form (mirrors the contracts). */
export const EXPERT_VERSION_REF_PATTERN_SOURCE =
  '^arena:expert/[a-z][a-z0-9-]{1,62}/expert-[a-z0-9][a-z0-9-]{1,61}@' +
  '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?' +
  '#[0-9a-f]{64}$';

export function isExpertVersionRef(value: unknown): value is ExpertVersionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantScope(candidate['tenant']) &&
    isExpertId(candidate['expertId']) &&
    isExpertVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate every part and freeze an expert version ref; throws INVALID_REF otherwise. */
export function toExpertVersionRef(value: {
  tenant: string;
  expertId: string;
  version: string;
  digest: string;
}): ExpertVersionRef {
  if (!isExpertVersionRef(value)) {
    throw new ExpertRegistryError(EXPERT_ERROR_CODES.INVALID_REF, {
      message: `invalid expert version reference: ${JSON.stringify(value)} (tenant/expertId identity, semver version, sha256 digest)`,
      details: {
        tenantPattern: '^[a-z][a-z0-9-]{1,62}$',
        expertIdPattern: EXPERT_ID_PATTERN_SOURCE,
        versionPattern: 'semver major.minor.patch (no build metadata)',
        digestPattern: '^[0-9a-f]{64}$',
      },
    });
  }
  return Object.freeze({
    tenant: toTenantScope(value.tenant),
    expertId: toExpertId(value.expertId),
    version: toExpertVersion(value.version),
    digest: toContentDigest(value.digest),
  });
}

/** Format a full expert version ref: `arena:expert/<tenant>/<expertId>@<version>#<digest>`. */
export function formatExpertVersionRef(ref: ExpertVersionRef): string {
  return `${EXPERT_IDENTITY_PREFIX}/${ref.tenant}/${ref.expertId}@${ref.version}#${ref.digest}`;
}

/** Stable version key of a profile: `<tenant>/<expertId>@<version>`. */
export function expertVersionKey(ref: {
  tenant: string;
  expertId: string;
  version: string;
}): string {
  return `${ref.tenant}/${ref.expertId}@${ref.version}`;
}

/** Stable logical key of an expert (versionless): `<tenant>/<expertId>`. */
export function expertLogicalKey(identity: {
  tenant: string;
  expertId: string;
}): string {
  return `${identity.tenant}/${identity.expertId}`;
}

/**
 * An expert-ref VALUE: either a validated (branded) ExpertVersionRef or its
 * plain structural form (for command payload inputs).
 */
export type ExpertVersionRefLike =
  | ExpertVersionRef
  | { tenant: string; expertId: string; version: string; digest: string };
