/**
 * Cross-tenant learning authorization gate (Work Order A034;
 * spec/security.md S1.0: "Customer data is never used for cross-tenant
 * learning without explicit authorization"; AGENTS.md Security section;
 * requirement R47 "without raw customer data leakage").
 *
 * This gate is NOT a rubber stamp. Cross-tenant learning consumption is
 * denied by default and requires BOTH:
 *
 *   1. an EXPLICIT, unexpired, unrevoked LearningAuthorizationGrant from
 *      the data-owning tenant, naming the exact tenant-scoped dataset
 *      refs it covers; and
 *   2. per-dataset data-rights records whose permittedUse is exactly
 *      'cross-tenant-learning'.
 *
 * A missing grant, an expired grant, a revoked grant, a dataset outside
 * the grant's named scope, a dataset owned by a different tenant than
 * the grantor, a dataset whose rights record does not permit cross-
 * tenant learning, or a dataset with NO rights record — each is a DENY
 * with a closed machine-readable reason. Grant revocation is an
 * append-only status transition (active → revoked): there is no delete
 * or un-revoke surface, and revocation is effective immediately for NEW
 * authorizations (historical authorized uses remain auditable).
 */

import { SECURITY_ERROR_CODES, SecurityError } from './errors.js';
import { deepFreeze, expectEnumMember, expectFields, isEnumMember } from './shared.js';
import { toNeutralId, toTenantId } from './shared.js';
import type { NeutralId, TenantId } from './shared.js';
import { checkDataRightsForAction } from './data-rights.js';
import type { DataRightsRecord } from './data-rights.js';
import { isTenantScopedRef } from './tenancy.js';
import type { TenantScopedRef } from './tenancy.js';

// ---------------------------------------------------------------------------
// Grant shape
// ---------------------------------------------------------------------------

/** Wire version of the learning grant shape. */
export const LEARNING_GRANT_VERSION = 1 as const;

/** The closed grant status vocabulary (append-only transitions). */
export const LEARNING_GRANT_STATUSES = Object.freeze(['active', 'revoked'] as const);
export type LearningGrantStatus = (typeof LEARNING_GRANT_STATUSES)[number];

/**
 * An explicit cross-tenant learning authorization: tenant `grantor`
 * authorizes learning consumption of EXACTLY the named dataset refs
 * until `expiresAt` (absolute, ms-precision UTC), revocable at any time
 * via an append-only status transition. `grantedAt` < `expiresAt` is
 * enforced at construction. The named datasets must ALL belong to the
 * grantor (validated at construction AND re-checked at authorization
 * time — trust nothing, re-validate everything).
 */
export interface LearningAuthorizationGrant {
  readonly recordVersion: typeof LEARNING_GRANT_VERSION;
  readonly grantId: NeutralId;
  readonly grantor: TenantId;
  readonly datasets: readonly TenantScopedRef[];
  readonly grantedAt: string;
  readonly expiresAt: string;
  readonly status: LearningGrantStatus;
  readonly revokedAt: string | null;
}

const GRANT_CONTEXT = 'LearningAuthorizationGrant';

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isLearningAuthorizationGrant(value: unknown): value is LearningAuthorizationGrant {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record['recordVersion'] !== LEARNING_GRANT_VERSION) return false;
  if (typeof record['grantId'] !== 'string') return false;
  if (typeof record['grantor'] !== 'string') return false;
  if (!Array.isArray(record['datasets'])) return false;
  if (typeof record['grantedAt'] !== 'string') return false;
  if (typeof record['expiresAt'] !== 'string') return false;
  if (!isEnumMember(record['status'], LEARNING_GRANT_STATUSES)) return false;
  return true;
}

export function toLearningAuthorizationGrant(value: unknown): LearningAuthorizationGrant {
  const record = expectFields(
    value,
    ['recordVersion', 'grantId', 'grantor', 'datasets', 'grantedAt', 'expiresAt', 'status', 'revokedAt'],
    [],
    SECURITY_ERROR_CODES.INVALID_GRANT,
    GRANT_CONTEXT,
  );
  if (record['recordVersion'] !== LEARNING_GRANT_VERSION) {
    throw new SecurityError(SECURITY_ERROR_CODES.UNSUPPORTED_RECORD_VERSION, {
      message: `${GRANT_CONTEXT}: unsupported recordVersion: ${String(record['recordVersion'])}`,
    });
  }
  const grantId = toNeutralId(String(record['grantId']), `${GRANT_CONTEXT}.grantId`);
  const grantor = toTenantId(String(record['grantor']), `${GRANT_CONTEXT}.grantor`);
  const rawDatasets = record['datasets'];
  if (!Array.isArray(rawDatasets) || rawDatasets.length === 0) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
      message: `${GRANT_CONTEXT}.datasets: a grant must name at least one dataset ref (blanket grants are rejected — this is not a rubber stamp)`,
    });
  }
  const datasets: TenantScopedRef[] = [];
  for (const ref of rawDatasets) {
    if (!isTenantScopedRef(ref)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
        message: `${GRANT_CONTEXT}.datasets: every entry must be a structurally valid TenantScopedRef`,
        details: { received: JSON.stringify(ref) },
      });
    }
    if (ref.tenantId !== grantor) {
      throw new SecurityError(SECURITY_ERROR_CODES.TENANT_MISMATCH, {
        message: `${GRANT_CONTEXT}: named dataset '${ref.recordId}' belongs to tenant ${String(ref.tenantId)}, not the grantor ${String(grantor)} — a tenant can only grant ITS OWN data`,
        details: { datasetTenant: ref.tenantId, grantor },
      });
    }
    if (ref.boundaryClass !== 'dataset') {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
        message: `${GRANT_CONTEXT}: learning grants may only name 'dataset' boundary-class refs (got '${ref.boundaryClass}')`,
      });
    }
    datasets.push(ref);
  }
  const ids = new Set(datasets.map((ref) => ref.recordId));
  if (ids.size !== datasets.length) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
      message: `${GRANT_CONTEXT}: duplicate dataset recordIds are rejected`,
    });
  }
  const grantedAt = String(record['grantedAt']);
  const expiresAt = String(record['expiresAt']);
  if (!TIMESTAMP_PATTERN.test(grantedAt) || !TIMESTAMP_PATTERN.test(expiresAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: `${GRANT_CONTEXT}: grantedAt/expiresAt must be ms-precision UTC RFC 3339 timestamps`,
      details: { grantedAt, expiresAt },
    });
  }
  if (Date.parse(expiresAt) <= Date.parse(grantedAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
      message: `${GRANT_CONTEXT}: expiresAt must be strictly after grantedAt (a zero-duration grant is never valid)`,
      details: { grantedAt, expiresAt },
    });
  }
  const status = expectEnumMember(
    record['status'],
    LEARNING_GRANT_STATUSES,
    'status',
    SECURITY_ERROR_CODES.INVALID_GRANT,
    GRANT_CONTEXT,
  );
  let revokedAt: string | null = null;
  if (record['revokedAt'] !== null && record['revokedAt'] !== undefined) {
    revokedAt = String(record['revokedAt']);
    if (!TIMESTAMP_PATTERN.test(revokedAt)) {
      throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
        message: `${GRANT_CONTEXT}.revokedAt: must be a ms-precision UTC RFC 3339 timestamp`,
      });
    }
  }
  if (status === 'active' && revokedAt !== null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
      message: `${GRANT_CONTEXT}: an active grant must carry revokedAt=null (revocation is the only status transition)`,
    });
  }
  if (status === 'revoked' && revokedAt === null) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_GRANT, {
      message: `${GRANT_CONTEXT}: a revoked grant must carry an explicit revokedAt timestamp`,
    });
  }
  return deepFreeze({
    recordVersion: LEARNING_GRANT_VERSION,
    grantId,
    grantor,
    datasets: Object.freeze([...datasets]),
    grantedAt,
    expiresAt,
    status,
    revokedAt,
  });
}

/**
 * Append-only revocation transition: returns a NEW frozen grant with
 * status 'revoked' (the original is untouched). Revoking a revoked grant
 * is SECURITY_GRANT_REVOKED (no double transitions); revoking with a
 * timestamp before grantedAt is rejected.
 */
export function revokeLearningAuthorizationGrant(
  grant: LearningAuthorizationGrant,
  revokedAt: string,
): LearningAuthorizationGrant {
  if (!TIMESTAMP_PATTERN.test(revokedAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'revokeLearningAuthorizationGrant: revokedAt must be ms-precision UTC RFC 3339',
      details: { received: revokedAt },
    });
  }
  if (grant.status === 'revoked') {
    throw new SecurityError(SECURITY_ERROR_CODES.GRANT_REVOKED, {
      message: `grant ${String(grant.grantId)} is already revoked (append-only: no double revocation, no un-revoke)`,
    });
  }
  if (Date.parse(revokedAt) < Date.parse(grant.grantedAt)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'revokedAt cannot precede grantedAt (causality is monotonic)',
      details: { grantedAt: grant.grantedAt, revokedAt },
    });
  }
  return deepFreeze({
    ...grant,
    status: 'revoked',
    revokedAt,
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/** The closed learning-authorization reason vocabulary. */
export const LEARNING_AUTHORIZATION_REASONS = Object.freeze([
  'grant-authorized',
  'grant-missing',
  'grant-expired',
  'grant-revoked',
  'dataset-not-in-grant',
  'dataset-tenant-mismatch',
  'permitted-use-excluded',
  'rights-missing',
] as const);

export type LearningAuthorizationReason = (typeof LEARNING_AUTHORIZATION_REASONS)[number];

export interface LearningAuthorizationDecision {
  readonly allowed: boolean;
  readonly reason: LearningAuthorizationReason;
  readonly grantId: NeutralId | null;
  readonly consumerTenant: TenantId | 'untenanted';
  readonly deniedDataset: string | null;
}

/** One authorization request: consumer tenant + the datasets it wants. */
export interface LearningAuthorizationRequest {
  readonly consumerTenant: TenantId;
  readonly datasets: readonly TenantScopedRef[];
  /** Rights records by dataset recordId (the governed half). */
  readonly dataRights: Readonly<Record<string, DataRightsRecord>>;
}

/**
 * PURE cross-tenant learning gate. Evaluates EVERY requested dataset
 * against the grant set and the rights records:
 *
 *   - no active grant covering the consumer for a dataset ⇒ deny
 *     'grant-missing' (THE default — explicit authorization is the only
 *     path to allow);
 *   - grant expired at `asOf` ⇒ deny 'grant-expired';
 *   - grant revoked ⇒ deny 'grant-revoked' (revocation beats expiry —
 *     checked first because it is permanent);
 *   - dataset not named in the grant ⇒ deny 'dataset-not-in-grant'
 *     (scope is exact; supersets are never granted);
 *   - dataset not owned by the grantor ⇒ deny 'dataset-tenant-mismatch';
 *   - dataset rights record missing ⇒ deny 'rights-missing';
 *   - dataset permittedUse is not 'cross-tenant-learning' ⇒ deny
 *     'permitted-use-excluded';
 *   - everything satisfied ⇒ allow 'grant-authorized'.
 *
 * The consumer tenant itself is checked to be a real tenant (not
 * 'untenanted') — cross-tenant learning is tenant-to-tenant, never
 * platform-to-tenant.
 */
export function authorizeCrossTenantLearning(
  request: LearningAuthorizationRequest,
  grants: readonly LearningAuthorizationGrant[],
  asOf: string,
): LearningAuthorizationDecision {
  if (!TIMESTAMP_PATTERN.test(asOf)) {
    throw new SecurityError(SECURITY_ERROR_CODES.INVALID_TIMESTAMP, {
      message: 'authorizeCrossTenantLearning: asOf must be ms-precision UTC RFC 3339',
      details: { received: asOf },
    });
  }
  const asOfMs = Date.parse(asOf);
  const deny = (
    reason: Exclude<LearningAuthorizationReason, 'grant-authorized'>,
    grantId: NeutralId | null,
    deniedDataset: string | null,
  ): LearningAuthorizationDecision =>
    deepFreeze({
      allowed: false,
      reason,
      grantId,
      consumerTenant: request.consumerTenant,
      deniedDataset,
    });

  // A grant can never authorize the grantor's own tenant learning from
  // itself as "cross-tenant" (that path is in-tenant and does not need
  // this gate) — but more importantly a grant cannot authorize the
  // GRANTOR to consume its own data as a consumer; that's a no-op we
  // still evaluate strictly through the same rules.
  for (const dataset of request.datasets) {
    if (!isTenantScopedRef(dataset)) {
      return deny('dataset-tenant-mismatch', null, null);
    }
    if (dataset.boundaryClass !== 'dataset') {
      return deny('dataset-tenant-mismatch', null, dataset.recordId);
    }
    if (dataset.tenantId === request.consumerTenant) {
      // consuming your own tenant's data is not a cross-tenant request;
      // this gate fail-closes rather than silently allowing
      return deny('dataset-tenant-mismatch', null, dataset.recordId);
    }

    const candidates = grants.filter(
      (grant) =>
        grant.grantor === dataset.tenantId &&
        grant.datasets.some((named) => named.recordId === dataset.recordId) &&
        grant.datasets.every((named) => named.tenantId === grant.grantor),
    );

    if (candidates.length === 0) {
      return deny('grant-missing', null, dataset.recordId);
    }

    // Revocation beats expiry; expiry beats scope; only then allow.
    const revoked = candidates.find((grant) => grant.status === 'revoked');
    if (revoked !== undefined) {
      return deny('grant-revoked', revoked.grantId, dataset.recordId);
    }
    const active = candidates.filter((grant) => {
      const expiryMs = Date.parse(grant.expiresAt);
      return asOfMs < expiryMs;
    });
    if (active.length === 0) {
      // Every covering grant is expired at asOf.
      return deny('grant-expired', candidates[0]?.grantId ?? null, dataset.recordId);
    }

    // Rights half: the dataset must present a valid rights record whose
    // permittedUse is exactly 'cross-tenant-learning'.
    const rights = request.dataRights[dataset.recordId];
    if (rights === null || rights === undefined || !isDataRightsRights(rights)) {
      return deny('rights-missing', null, dataset.recordId);
    }
    const rightsDecision = checkDataRightsForAction(rights, 'use-for-learning', asOf, {
      crossTenant: true,
    });
    if (!rightsDecision.allowed) {
      return deny('permitted-use-excluded', null, dataset.recordId);
    }
  }

  const drivingGrant = grants.find(
    (grant) =>
      grant.status === 'active' &&
      Date.parse(grant.expiresAt) > asOfMs &&
      request.datasets.every((dataset) =>
        grant.datasets.some((named) => named.recordId === dataset.recordId),
      ),
  );

  return deepFreeze({
    allowed: true,
    reason: 'grant-authorized',
    grantId: drivingGrant?.grantId ?? null,
    consumerTenant: request.consumerTenant,
    deniedDataset: null,
  });
}

function isDataRightsRights(value: unknown): value is DataRightsRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'permittedUse' in value &&
    'publicationStatus' in value &&
    'owner' in value &&
    'retention' in value
  );
}

/** Guard form: throws typed SECURITY_FORBIDDEN on denial. */
export function assertCrossTenantLearning(
  request: LearningAuthorizationRequest,
  grants: readonly LearningAuthorizationGrant[],
  asOf: string,
): void {
  const decision = authorizeCrossTenantLearning(request, grants, asOf);
  if (!decision.allowed) {
    throw new SecurityError(SECURITY_ERROR_CODES.FORBIDDEN, {
      message: `cross-tenant learning denied: ${decision.reason}` +
        (decision.deniedDataset !== null ? ` (dataset: ${decision.deniedDataset})` : ''),
      details: {
        reason: decision.reason,
        consumerTenant: String(decision.consumerTenant),
        grantId: decision.grantId === null ? null : String(decision.grantId),
        deniedDataset: decision.deniedDataset,
      },
    });
  }
}
