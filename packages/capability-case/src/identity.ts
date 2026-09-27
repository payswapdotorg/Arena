/**
 * Capability-case identity (Work Order A005; spec CC1.0 required fields
 * "case id/version", "tenant/scope"; docs/architecture.md §5).
 *
 * A case identity is (tenant, caseId):
 *   - `tenant` is the owning tenant scope, or the reserved `public`
 *     namespace for explicitly published global cases (lock rule 11);
 *   - `caseId` is the case's stable identifier inside the scope (a slug);
 *   - `version` is a semver-compatible version (major.minor.patch with an
 *     optional prerelease; build metadata is REJECTED — content addressing
 *     requires exact versions, same rule as every sibling package).
 *
 * Identity string form: `arena:case/<tenant>/<caseId>` (versionless) and
 * `arena:case/<tenant>/<caseId>@<version>` for the versioned address.
 * Full content-addressed refs add `#<digest>` (see CaseVersionRef).
 *
 * Identifiers are pure data: creation validates and brands the parts, and no
 * mutation API exists anywhere in this package.
 */

import type { Brand } from '@arena/protocol-core';
import { CAPABILITY_CASE_ERROR_CODES, CapabilityCaseError } from './errors.js';
import {
  isCaseVersion,
  isContentDigest,
  isTenantScope,
  toCaseVersion,
  toContentDigest,
  toTenantScope,
} from './shared.js';
import type { CaseVersion, ContentDigest, TenantScope } from './shared.js';

export type CaseId = Brand<string, 'CaseId'>;

/** Exact pattern source; kept in sync with the generated contracts. */
export const CASE_ID_PATTERN_SOURCE = '^[a-z][a-z0-9-]{0,127}$';

const CASE_ID_PATTERN = new RegExp(CASE_ID_PATTERN_SOURCE);

export function isCaseId(value: unknown): value is CaseId {
  return typeof value === 'string' && CASE_ID_PATTERN.test(value);
}

/** Validate and brand a case id; throws INVALID_IDENTITY otherwise. */
export function toCaseId(value: string): CaseId {
  if (!isCaseId(value)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid case id: ${JSON.stringify(value)}`,
      details: { pattern: CASE_ID_PATTERN_SOURCE },
    });
  }
  return value;
}

/** The stable identity of a logical capability case (versionless). */
export interface CaseIdentity {
  readonly tenant: TenantScope;
  readonly caseId: CaseId;
}

/** String-form prefix for case identities. */
export const CASE_IDENTITY_PREFIX = 'arena:case';

/** Exact pattern source for the identity string form (mirrors the contracts). */
export const CASE_IDENTITY_PATTERN_SOURCE =
  '^arena:case/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,127}$';

const IDENTITY_PARSE_PATTERN =
  /^arena:case\/([a-z][a-z0-9-]{1,62})\/([a-z][a-z0-9-]{0,127})$/;

/** Validate both parts and produce a frozen CaseIdentity. */
export function toCaseIdentity(value: {
  tenant: string;
  caseId: string;
}): CaseIdentity {
  const identity: CaseIdentity = Object.freeze({
    tenant: toTenantScope(value.tenant),
    caseId: toCaseId(value.caseId),
  });
  return identity;
}

export function isCaseIdentity(value: unknown): value is CaseIdentity {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isTenantScope(candidate['tenant']) && isCaseId(candidate['caseId']);
}

/** Format an identity as its stable string form: `arena:case/<tenant>/<caseId>`. */
export function formatCaseIdentity(identity: CaseIdentity): string {
  return `${CASE_IDENTITY_PREFIX}/${identity.tenant}/${identity.caseId}`;
}

/** Strictly parse an identity string form; throws INVALID_IDENTITY otherwise. */
export function parseCaseIdentity(value: string): CaseIdentity {
  const match = IDENTITY_PARSE_PATTERN.exec(value);
  if (!match) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid case identity string: ${JSON.stringify(value)}`,
      details: { pattern: CASE_IDENTITY_PATTERN_SOURCE },
    });
  }
  const tenant = match[1];
  const caseId = match[2];
  if (tenant === undefined || caseId === undefined) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_IDENTITY, {
      message: `invalid case identity string: ${JSON.stringify(value)}`,
    });
  }
  return toCaseIdentity({ tenant, caseId });
}

/** True iff both identities share tenant and case id. */
export function isSameCaseIdentity(a: CaseIdentity, b: CaseIdentity): boolean {
  return a.tenant === b.tenant && a.caseId === b.caseId;
}

// ---------------------------------------------------------------------------
// CaseVersionRef — the full content-addressed case version reference
// ---------------------------------------------------------------------------

/**
 * A content-addressed reference to one exact case-version STATE: identity +
 * version + the sha256 digest of that state's canonical content. Because the
 * lifecycle status and the append-only event log are part of a case state's
 * content, a case version's digest pins its exact lifecycle state; every
 * historical state stays addressable by its digest (append-only history,
 * lock rule 6).
 */
export interface CaseVersionRef {
  readonly tenant: TenantScope;
  readonly caseId: CaseId;
  readonly version: CaseVersion;
  readonly digest: ContentDigest;
}

/** Exact pattern source for the full ref string form (mirrors the contracts). */
export const CASE_VERSION_REF_PATTERN_SOURCE =
  '^arena:case/[a-z][a-z0-9-]{1,62}/[a-z][a-z0-9-]{0,127}@' +
  '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?' +
  '#[0-9a-f]{64}$';

export function isCaseVersionRef(value: unknown): value is CaseVersionRef {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isTenantScope(candidate['tenant']) &&
    isCaseId(candidate['caseId']) &&
    isCaseVersion(candidate['version']) &&
    isContentDigest(candidate['digest'])
  );
}

/** Validate every part and freeze a case version ref; throws INVALID_REF otherwise. */
export function toCaseVersionRef(value: {
  tenant: string;
  caseId: string;
  version: string;
  digest: string;
}): CaseVersionRef {
  if (!isCaseVersionRef(value)) {
    throw new CapabilityCaseError(CAPABILITY_CASE_ERROR_CODES.INVALID_REF, {
      message: `invalid case version reference: ${JSON.stringify(value)} (tenant/caseId identity, semver version, sha256 digest)`,
      details: {
        tenantPattern: '^tenant: ^[a-z][a-z0-9-]{1,62}$',
        caseIdPattern: CASE_ID_PATTERN_SOURCE,
        versionPattern: 'semver major.minor.patch (no build metadata)',
        digestPattern: '^[0-9a-f]{64}$',
      },
    });
  }
  return Object.freeze({
    tenant: toTenantScope(value.tenant),
    caseId: toCaseId(value.caseId),
    version: toCaseVersion(value.version),
    digest: toContentDigest(value.digest),
  });
}

/** Format a full case version ref: `arena:case/<tenant>/<caseId>@<version>#<digest>`. */
export function formatCaseVersionRef(ref: CaseVersionRef): string {
  return `${CASE_IDENTITY_PREFIX}/${ref.tenant}/${ref.caseId}@${ref.version}#${ref.digest}`;
}

/** Stable identity key of a case version: `<tenant>/<caseId>@<version>`. */
export function caseVersionKey(ref: {
  tenant: string;
  caseId: string;
  version: string;
}): string {
  return `${ref.tenant}/${ref.caseId}@${ref.version}`;
}

/** Stable logical key of a case (versionless): `<tenant>/<caseId>`. */
export function caseLogicalKey(identity: { tenant: string; caseId: string }): string {
  return `${identity.tenant}/${identity.caseId}`;
}

/**
 * A case-ref VALUE: either a validated (branded) CaseVersionRef or its plain
 * structural form (for command payload inputs).
 */
export type CaseVersionRefLike =
  | CaseVersionRef
  | { tenant: string; caseId: string; version: string; digest: string };
