/**
 * Shared provenance view types (Work Order A002).
 *
 * @arena/provenance must stay runtime-independent beyond @arena/protocol-core
 * (Work Order acceptance criterion 9), so it cannot import the value surface
 * of @arena/artifact-protocol. The record's structural components — artifact
 * references, principals, rights, timestamps — are therefore defined HERE as
 * validated plain-string view types.
 *
 * These views are STRUCTURALLY COMPATIBLE with the corresponding
 * @arena/artifact-protocol types (plain strings accept branded strings):
 * an artifact-protocol ArtifactRef / PrincipalRef / RightsMetadata value can
 * be passed through these validators unchanged, and vice versa. The
 * cross-package parity test (src/cross-parity.test.ts) asserts pattern and
 * enum equality between the two definitions, so the duplication cannot
 * drift silently.
 */

import { PROVENANCE_ERROR_CODES, ProvenanceError } from './errors.js';

// ---------------------------------------------------------------------------
// Pattern sources — MUST equal the @arena/artifact-protocol constants
// (asserted by cross-parity.test.ts). Duplicated here because this package
// cannot take a runtime dependency on that one.
// ---------------------------------------------------------------------------

export const ARTIFACT_NAMESPACE_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,62}$';
export const ARTIFACT_NAME_PATTERN_SOURCE = '^[a-z][a-z0-9-]{1,127}$';
export const ARTIFACT_VERSION_PATTERN_SOURCE =
  '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$';
export const CONTENT_DIGEST_PATTERN_SOURCE = '^[0-9a-f]{64}$';
export const PROVENANCE_TIMESTAMP_PATTERN_SOURCE =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$';
export const PRINCIPAL_ID_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$';
export const LICENSE_PATTERN_SOURCE = '^[A-Za-z0-9][A-Za-z0-9 .+()\\-]{0,63}$';

const NAMESPACE_PATTERN = new RegExp(ARTIFACT_NAMESPACE_PATTERN_SOURCE);
const NAME_PATTERN = new RegExp(ARTIFACT_NAME_PATTERN_SOURCE);
const VERSION_PATTERN = new RegExp(ARTIFACT_VERSION_PATTERN_SOURCE);
const DIGEST_PATTERN = new RegExp(CONTENT_DIGEST_PATTERN_SOURCE);
const TIMESTAMP_PATTERN = new RegExp(PROVENANCE_TIMESTAMP_PATTERN_SOURCE);
const PRINCIPAL_ID_PATTERN = new RegExp(PRINCIPAL_ID_PATTERN_SOURCE);
const LICENSE_PATTERN = new RegExp(LICENSE_PATTERN_SOURCE);

// ---------------------------------------------------------------------------
// Artifact reference view
// ---------------------------------------------------------------------------

/** A content-addressed artifact reference (structurally ArtifactRef). */
export interface ArtifactRefView {
  readonly namespace: string;
  readonly name: string;
  readonly version: string;
  readonly digest: string;
}

export function isArtifactRefView(value: unknown): value is ArtifactRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['namespace'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['namespace']) &&
    typeof candidate['name'] === 'string' &&
    NAME_PATTERN.test(candidate['name']) &&
    typeof candidate['version'] === 'string' &&
    VERSION_PATTERN.test(candidate['version']) &&
    typeof candidate['digest'] === 'string' &&
    DIGEST_PATTERN.test(candidate['digest'])
  );
}

/** Validate and freeze an artifact reference view; throws PROVENANCE_INVALID_REF. */
export function toArtifactRefView(value: {
  namespace: string;
  name: string;
  version: string;
  digest: string;
}): ArtifactRefView {
  if (!isArtifactRefView(value)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_REF, {
      message: `invalid artifact reference: ${JSON.stringify(value)}`,
      details: {
        namespace: ARTIFACT_NAMESPACE_PATTERN_SOURCE,
        name: ARTIFACT_NAME_PATTERN_SOURCE,
        version: ARTIFACT_VERSION_PATTERN_SOURCE,
        digest: CONTENT_DIGEST_PATTERN_SOURCE,
      },
    });
  }
  return Object.freeze({ ...value });
}

/** Stable key for a reference view: `<namespace>/<name>@<version>#<digest>`. */
export function artifactRefViewKey(ref: ArtifactRefView): string {
  return `${ref.namespace}/${ref.name}@${ref.version}#${ref.digest}`;
}

/** Identity key for a reference view: `<namespace>/<name>@<version>`. */
export function artifactRefViewIdentityKey(ref: ArtifactRefView): string {
  return `${ref.namespace}/${ref.name}@${ref.version}`;
}

// ---------------------------------------------------------------------------
// Principal view
// ---------------------------------------------------------------------------

/** Closed principal types (must equal @arena/artifact-protocol's). */
export const PRINCIPAL_TYPES = ['agent-body', 'expert', 'user', 'service', 'system'] as const;
export type PrincipalTypeView = (typeof PRINCIPAL_TYPES)[number];

/** Tenant-scoped principal (structurally PrincipalRef; never a raw provider identity). */
export interface PrincipalRefView {
  readonly type: PrincipalTypeView;
  readonly tenant: string;
  readonly principalId: string;
}

export function isPrincipalRefView(value: unknown): value is PrincipalRefView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['type'] === 'string' &&
    (PRINCIPAL_TYPES as readonly string[]).includes(candidate['type']) &&
    typeof candidate['tenant'] === 'string' &&
    NAMESPACE_PATTERN.test(candidate['tenant']) &&
    typeof candidate['principalId'] === 'string' &&
    PRINCIPAL_ID_PATTERN.test(candidate['principalId'])
  );
}

/** Validate and freeze a principal view; throws PROVENANCE_INVALID_PRINCIPAL. */
export function toPrincipalRefView(value: {
  type: string;
  tenant: string;
  principalId: string;
}): PrincipalRefView {
  if (!isPrincipalRefView(value)) {
    if (
      typeof value?.type === 'string' &&
      !(PRINCIPAL_TYPES as readonly string[]).includes(value.type)
    ) {
      throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_PRINCIPAL, {
        message: `unknown principal type: ${JSON.stringify(value.type)} (known: ${PRINCIPAL_TYPES.join(', ')})`,
        details: { known: [...PRINCIPAL_TYPES] },
      });
    }
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_PRINCIPAL, {
      message: `invalid provenance principal: ${JSON.stringify(value)}`,
    });
  }
  return Object.freeze({ ...value });
}

// ---------------------------------------------------------------------------
// Rights view
// ---------------------------------------------------------------------------

export const COMMERCIAL_USE_POLICIES = ['allowed', 'requires-license', 'prohibited'] as const;
export const REDISTRIBUTION_POLICIES = ['allowed', 'tenant-only', 'prohibited'] as const;
export const CUSTOMER_DATA_POLICIES = ['none', 'derived', 'contains'] as const;

export type CommercialUsePolicyView = (typeof COMMERCIAL_USE_POLICIES)[number];
export type RedistributionPolicyView = (typeof REDISTRIBUTION_POLICIES)[number];
export type CustomerDataPolicyView = (typeof CUSTOMER_DATA_POLICIES)[number];

/** Rights metadata (structurally RightsMetadata; mandatory on records). */
export interface RightsMetadataView {
  readonly license: string;
  readonly commercialUse: CommercialUsePolicyView;
  readonly redistribution: RedistributionPolicyView;
  readonly customerData: CustomerDataPolicyView;
  readonly professionalLimitations?: readonly string[];
}

export function isRightsMetadataView(value: unknown): value is RightsMetadataView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate['license'] !== 'string' ||
    !LICENSE_PATTERN.test(candidate['license']) ||
    typeof candidate['commercialUse'] !== 'string' ||
    !(COMMERCIAL_USE_POLICIES as readonly string[]).includes(candidate['commercialUse']) ||
    typeof candidate['redistribution'] !== 'string' ||
    !(REDISTRIBUTION_POLICIES as readonly string[]).includes(candidate['redistribution']) ||
    typeof candidate['customerData'] !== 'string' ||
    !(CUSTOMER_DATA_POLICIES as readonly string[]).includes(candidate['customerData'])
  ) {
    return false;
  }
  const limitations = candidate['professionalLimitations'];
  if (
    limitations !== undefined &&
    (!Array.isArray(limitations) ||
      !limitations.every((item) => typeof item === 'string' && item.length > 0))
  ) {
    return false;
  }
  return true;
}

/**
 * Validate and freeze rights metadata. Missing/not-an-object throws
 * PROVENANCE_MISSING_RIGHTS (rights are mandatory); malformed values throw
 * PROVENANCE_INVALID_RIGHTS.
 */
export function toRightsMetadataView(value: unknown): RightsMetadataView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.MISSING_RIGHTS, {
      message: 'rights metadata is required on provenance records (architecture-lock rule 23)',
    });
  }
  if (!isRightsMetadataView(value)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_RIGHTS, {
      message: `invalid provenance rights metadata: ${JSON.stringify(value)}`,
    });
  }
  const record = value as RightsMetadataView;
  return Object.freeze({
    license: record.license,
    commercialUse: record.commercialUse,
    redistribution: record.redistribution,
    customerData: record.customerData,
    ...(record.professionalLimitations !== undefined
      ? { professionalLimitations: Object.freeze([...record.professionalLimitations]) }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Timestamp view
// ---------------------------------------------------------------------------

/** UTC ISO-8601 timestamp with exactly millisecond precision. */
export type TimestampView = string;

export function isTimestampView(value: unknown): value is TimestampView {
  if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

/** Validate a timestamp view; throws PROVENANCE_INVALID_TIMESTAMP. */
export function toTimestampView(value: string): TimestampView {
  if (!isTimestampView(value)) {
    throw new ProvenanceError(PROVENANCE_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `invalid provenance timestamp: ${JSON.stringify(value)} (expected UTC ISO-8601 with exactly millisecond precision)`,
      details: { pattern: PROVENANCE_TIMESTAMP_PATTERN_SOURCE },
    });
  }
  return value;
}

/** Current time as a canonical timestamp view. */
export function nowTimestampView(): TimestampView {
  return new Date().toISOString();
}
