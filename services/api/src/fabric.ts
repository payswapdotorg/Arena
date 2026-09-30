/**
 * ApiFabric — the reference server-side fabric for the Arena
 * public/private API (Work Order A025; architecture-lock rules 5, 6,
 * 11, 17, 18; mirrors the sibling reference fabrics' discipline —
 * services/certification's CertificationFabric, services/body-registry's
 * BodyRegistryService).
 *
 * Pure reference fabric, injected-deps-free by design: an IN-PROCESS
 * read model the host populates with the AUTHORITATIVE records of the
 * completed platform core (A003 body versions, A023 certification
 * records/suites, A022 compatibility records, A024 release records and
 * publication records) and the tenant-scoped query dispatch that
 * answers @arena/arena-sdk's closed query vocabulary. The fabric
 * satisfies the SDK's `ArenaQueryHandler` port STRUCTURALLY — hosts
 * wire `createLoopbackTransport(fabric)` (or a network bridge over the
 * same envelopes).
 *
 * Discipline:
 *   - ingest is GUARD-VALIDATED (the owning sibling packages' is*
 *     guards) and IDEMPOTENT by content digest — the fabric never
 *     re-gates, re-certifies or rewrites anything: the platform's
 *     write paths stay in their owning work orders (read-only
 *     projection of the completed core);
 *   - every query dispatch is scope-checked FIRST (cross-tenant reads
 *     fail closed with ARENA_API_CROSS_TENANT_ACCESS; lock rule 11);
 *   - results are validated against the per-kind closed result
 *     vocabulary before they leave the fabric (fail-closed);
 *   - no network/HTTP layer (the A025 reference slice, like the A013/
 *     A023/A024 fabrics).
 */

import type { BodyVersion } from '@arena/agent-body';
import { isBodyVersion } from '@arena/agent-body';
import type {
  CertificationRecord,
  CertificationSuite,
} from '@arena/certification';
import {
  certificationSubjectKey,
  isCertificationRecord,
  isCertificationSuite,
} from '@arena/certification';
import type { CompatibilityRecord } from '@arena/compatibility';
import { isCompatibilityRecord } from '@arena/compatibility';
import type {
  ReleasePublicationRecord,
  ReleaseRecord,
} from '@arena/body-registry';
import {
  isReleasePublicationRecord,
  isReleaseRecord,
} from '@arena/body-registry';
import {
  ARENA_API_ERROR_CODES,
  ArenaApiError,
  normalizeToArenaApiError,
} from '@arena/arena-sdk';
import type {
  ApiQueryKind,
  ApiQueryRequest,
  ApiQueryResponse,
  ApiQueryResultValue,
  ApiReadScope,
  ApiReleaseStatus,
} from '@arena/arena-sdk';
import {
  apiQueryResponse,
  isApiQueryRequest,
  isTenantAddressable,
} from '@arena/arena-sdk';
import { PUBLIC_TENANT, deepFreeze, isTenantVisible } from '@arena/arena-sdk';

// ---------------------------------------------------------------------------
// Visibility (the public/private boundary)
// ---------------------------------------------------------------------------

function releaseVisible(record: ReleaseRecord, scope: ApiReadScope): boolean {
  return record.tenantId === null || isTenantVisible(record.tenantId, scope.tenant);
}

function certificationVisible(record: CertificationRecord, scope: ApiReadScope): boolean {
  return record.tenantId === null || isTenantVisible(record.tenantId, scope.tenant);
}

function compatibilityVisible(record: CompatibilityRecord, scope: ApiReadScope): boolean {
  return (
    record.tenantId === undefined ||
    isTenantVisible(record.tenantId, scope.tenant)
  );
}

function bodyVersionVisible(record: BodyVersion, scope: ApiReadScope): boolean {
  return isTenantVisible(record.body.tenant, scope.tenant);
}

function publicationVisible(record: ReleasePublicationRecord, scope: ApiReadScope): boolean {
  return isTenantVisible(record.publisher.tenant, scope.tenant);
}

// ---------------------------------------------------------------------------
// Fabric
// ---------------------------------------------------------------------------

/** The reference query fabric over the platform core's read paths. */
export class ApiFabric {
  private readonly releaseRecords: ReleaseRecord[] = [];
  private readonly releaseByDigest = new Map<string, ReleaseRecord>();
  private readonly supersededReleases = new Set<string>();
  private readonly retiredReleases = new Set<string>();

  private readonly publications: ReleasePublicationRecord[] = [];
  private readonly publicationByDigest = new Map<string, ReleasePublicationRecord>();

  private readonly certificationRecords: CertificationRecord[] = [];
  private readonly certificationByDigest = new Map<string, CertificationRecord>();
  private readonly revokedCertifications = new Set<string>();
  private readonly supersededCertifications = new Set<string>();

  private readonly suites: CertificationSuite[] = [];
  private readonly suiteByDigest = new Map<string, CertificationSuite>();

  private readonly compatibilityRecords: CompatibilityRecord[] = [];
  private readonly compatibilityByDigest = new Map<string, CompatibilityRecord>();

  private readonly bodyVersions: BodyVersion[] = [];
  private readonly bodyVersionByDigest = new Map<string, BodyVersion>();

  // -------------------------------------------------------------------------
  // Ingest — guard-validated, idempotent by digest, deep-frozen
  // -------------------------------------------------------------------------

  /** Ingest one authoritative A024 ReleaseRecord. Returns its digest. */
  putReleaseRecord(record: unknown): string {
    if (!isReleaseRecord(record)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A024 ReleaseRecord',
      });
    }
    deepFreeze(record);
    if (!this.releaseByDigest.has(record.digest)) {
      this.releaseByDigest.set(record.digest, record);
      this.releaseRecords.push(record);
      if (record.kind === 'release-supersession' && record.supersedes !== null) {
        this.supersededReleases.add(record.supersedes);
      }
      if (record.kind === 'release-retirement' && record.retires !== null) {
        this.retiredReleases.add(record.retires);
      }
    }
    return record.digest;
  }

  /** Ingest one authoritative A024 ReleasePublicationRecord. */
  putReleasePublication(record: unknown): string {
    if (!isReleasePublicationRecord(record)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A024 ReleasePublicationRecord',
      });
    }
    deepFreeze(record);
    if (!this.publicationByDigest.has(record.digest)) {
      this.publicationByDigest.set(record.digest, record);
      this.publications.push(record);
    }
    return record.digest;
  }

  /** Ingest one authoritative A023 CertificationRecord. */
  putCertificationRecord(record: unknown): string {
    if (!isCertificationRecord(record)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A023 CertificationRecord',
      });
    }
    deepFreeze(record);
    if (!this.certificationByDigest.has(record.digest)) {
      this.certificationByDigest.set(record.digest, record);
      this.certificationRecords.push(record);
      if (record.kind === 'revocation' && record.revokes !== null) {
        this.revokedCertifications.add(record.revokes);
      }
      if (record.kind === 'certification-run' && record.supersedes !== null) {
        this.supersededCertifications.add(record.supersedes);
      }
    }
    return record.digest;
  }

  /** Ingest one authoritative A023 CertificationSuite. */
  putCertificationSuite(suite: unknown): string {
    if (!isCertificationSuite(suite)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A023 CertificationSuite',
      });
    }
    deepFreeze(suite);
    if (!this.suiteByDigest.has(suite.digest)) {
      this.suiteByDigest.set(suite.digest, suite);
      this.suites.push(suite);
    }
    return suite.digest;
  }

  /** Ingest one authoritative A022 CompatibilityRecord. */
  putCompatibilityRecord(record: unknown): string {
    if (!isCompatibilityRecord(record)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A022 CompatibilityRecord',
      });
    }
    deepFreeze(record);
    if (!this.compatibilityByDigest.has(record.recordDigest)) {
      this.compatibilityByDigest.set(record.recordDigest, record);
      this.compatibilityRecords.push(record);
    }
    return record.recordDigest;
  }

  /** Ingest one authoritative A003 BodyVersion. */
  putBodyVersion(record: unknown): string {
    if (!isBodyVersion(record)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_RECORD, {
        message: 'not a structurally valid A003 BodyVersion',
      });
    }
    deepFreeze(record);
    if (!this.bodyVersionByDigest.has(record.digest)) {
      this.bodyVersionByDigest.set(record.digest, record);
      this.bodyVersions.push(record);
    }
    return record.digest;
  }

  /** Ingest counts (evidence of the read model's population). */
  counts(): Readonly<Record<string, number>> {
    return Object.freeze({
      releaseRecords: this.releaseRecords.length,
      publications: this.publications.length,
      certificationRecords: this.certificationRecords.length,
      suites: this.suites.length,
      compatibilityRecords: this.compatibilityRecords.length,
      bodyVersions: this.bodyVersions.length,
    });
  }

  // -------------------------------------------------------------------------
  // Query dispatch (the ArenaQueryHandler port, satisfied structurally)
  // -------------------------------------------------------------------------

  /** Dispatch one validated query payload (scope-checked, fail-closed). */
  async handleQueryRequest(payload: ApiQueryRequest): Promise<ApiQueryResponse> {
    if (!isApiQueryRequest(payload)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.INVALID_QUERY, {
        message: 'arena api query request payload is structurally invalid',
      });
    }
    try {
      const result = await this.dispatch(payload);
      return apiQueryResponse(payload.kind, result);
    } catch (error) {
      throw normalizeToArenaApiError(error);
    }
  }

  private async dispatch(payload: ApiQueryRequest): Promise<ApiQueryResultValue> {
    const scope = payload.scope;
    const kind: ApiQueryKind = payload.kind;
    switch (kind) {
      case 'get-release-record':
        return this.getReleaseRecordByDigest(String((payload.params as Record<string, unknown>)['digest']), scope);
      case 'list-release-records':
        return this.listVisible(this.releaseRecords, (record) => releaseVisible(record, scope));
      case 'list-body-registrations':
        return this.listBodyRegistrations(payload.params as { tenant: string; name: string }, scope);
      case 'resolve-active-release':
        return this.resolveActiveRelease(
          payload.params as { tenant: string; name: string; channel: string },
          scope,
        );
      case 'resolve-release-status':
        return this.resolveReleaseStatus(
          payload.params as { namespace: string; name: string; version: string },
          scope,
        );
      case 'get-release-publication':
        return this.getReleasePublicationByDigest(
          String((payload.params as Record<string, unknown>)['digest']),
          scope,
        );
      case 'get-certification-record':
        return this.getCertificationByDigest(
          String((payload.params as Record<string, unknown>)['digest']),
          scope,
        );
      case 'list-certification-records':
        return this.listVisible(this.certificationRecords, (record) =>
          certificationVisible(record, scope),
        );
      case 'list-certifications-by-suite':
        return this.listVisible(
          this.certificationRecords.filter(
            (record) =>
              record.kind === 'certification-run' &&
              record.suiteRef === (payload.params as Record<string, unknown>)['suiteRef'],
          ),
          (record) => certificationVisible(record, scope),
        );
      case 'current-certification':
        return this.currentCertification(payload.params as { subject: never }, scope);
      case 'get-certification-suite':
        return this.suiteByDigest.get(String((payload.params as Record<string, unknown>)['suiteRef'])) ?? null;
      case 'list-certification-suites':
        return [...this.suites];
      case 'get-compatibility-record':
        return this.getCompatibilityByDigest(
          String((payload.params as Record<string, unknown>)['digest']),
          scope,
        );
      case 'list-compatibility-records':
        return this.listVisible(this.compatibilityRecords, (record) =>
          compatibilityVisible(record, scope),
        );
      case 'latest-compatibility-verdict':
        return this.latestCompatibilityVerdict(
          payload.params as { bodyVersionRef: string; substrateRef: string },
        );
      case 'get-body-version':
        return this.getBodyVersionByDigest(
          String((payload.params as Record<string, unknown>)['digest']),
          scope,
        );
    }
  }

  // -------------------------------------------------------------------------
  // Per-kind projections
  // -------------------------------------------------------------------------

  private getReleaseRecordByDigest(digest: string, scope: ApiReadScope): ReleaseRecord | null {
    const record = this.releaseByDigest.get(digest);
    if (record === undefined) return null;
    if (!releaseVisible(record, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `release record ${JSON.stringify(digest)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { digest },
      });
    }
    return record;
  }

  private listBodyRegistrations(
    params: { tenant: string; name: string },
    scope: ApiReadScope,
  ): readonly ReleaseRecord[] {
    if (!isTenantAddressable(params.tenant, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `body registrations of tenant ${JSON.stringify(params.tenant)} are not addressable from scope ${JSON.stringify(String(scope.tenant))}`,
        details: { tenant: params.tenant },
      });
    }
    return this.listVisible(
      this.releaseRecords.filter(
        (record) =>
          record.kind === 'release-registration' &&
          record.bodyVersionRef !== null &&
          record.bodyVersionRef.tenant === params.tenant &&
          record.bodyVersionRef.name === params.name,
      ),
      () => true,
    );
  }

  private resolveActiveRelease(
    params: { tenant: string; name: string; channel: string },
    scope: ApiReadScope,
  ): ReleaseRecord | null {
    if (!isTenantAddressable(params.tenant, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `active releases of tenant ${JSON.stringify(params.tenant)} are not addressable from scope ${JSON.stringify(String(scope.tenant))}`,
        details: { tenant: params.tenant },
      });
    }
    let active: ReleaseRecord | null = null;
    for (const record of this.releaseRecords) {
      if (
        record.kind === 'release-registration' &&
        record.bodyVersionRef !== null &&
        record.bodyVersionRef.tenant === params.tenant &&
        record.bodyVersionRef.name === params.name &&
        record.channel === params.channel &&
        !this.supersededReleases.has(record.digest) &&
        !this.retiredReleases.has(record.digest)
      ) {
        active = record;
      }
    }
    return active;
  }

  private resolveReleaseStatus(
    params: { namespace: string; name: string; version: string },
    scope: ApiReadScope,
  ): ApiReleaseStatus {
    let registration: ReleaseRecord | null = null;
    for (const record of this.releaseRecords) {
      if (
        record.kind === 'release-registration' &&
        record.release !== null &&
        record.release.namespace === params.namespace &&
        record.release.name === params.name &&
        record.release.version === params.version
      ) {
        registration = record;
      }
    }
    if (registration === null) {
      return {
        state: 'unknown',
        visibility: 'unpublished',
        registration: null,
        publication: null,
      };
    }
    if (!releaseVisible(registration, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `release status for ${JSON.stringify(`${params.namespace}/${params.name}@${params.version}`)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { namespace: params.namespace, name: params.name, version: params.version },
      });
    }
    const state = this.retiredReleases.has(registration.digest)
      ? ('retired' as const)
      : this.supersededReleases.has(registration.digest)
        ? ('superseded' as const)
        : ('registered' as const);
    let visibility: 'published' | 'unpublished' = 'unpublished';
    let publication: ReleasePublicationRecord | null = null;
    for (const record of this.publications) {
      if (
        record.release.namespace === params.namespace &&
        record.release.name === params.name &&
        record.release.version === params.version
      ) {
        if (record.action === 'publish') {
          visibility = 'published';
          publication = record;
        } else {
          visibility = 'unpublished';
          publication = null;
        }
      }
    }
    return { state, visibility, registration, publication };
  }

  private getReleasePublicationByDigest(
    digest: string,
    scope: ApiReadScope,
  ): ReleasePublicationRecord | null {
    const record = this.publicationByDigest.get(digest);
    if (record === undefined) return null;
    if (!publicationVisible(record, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `release publication ${JSON.stringify(digest)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { digest },
      });
    }
    return record;
  }

  private getCertificationByDigest(digest: string, scope: ApiReadScope): CertificationRecord | null {
    const record = this.certificationByDigest.get(digest);
    if (record === undefined) return null;
    if (!certificationVisible(record, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `certification record ${JSON.stringify(digest)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { digest },
      });
    }
    return record;
  }

  private currentCertification(
    params: { subject: never },
    scope: ApiReadScope,
  ): CertificationRecord | null {
    const subjectKey = certificationSubjectKey(params.subject);
    let current: CertificationRecord | null = null;
    for (const record of this.certificationRecords) {
      if (
        record.kind === 'certification-run' &&
        record.subject !== null &&
        certificationSubjectKey(record.subject) === subjectKey &&
        !this.revokedCertifications.has(record.digest) &&
        !this.supersededCertifications.has(record.digest) &&
        certificationVisible(record, scope)
      ) {
        current = record;
      }
    }
    return current;
  }

  private getCompatibilityByDigest(digest: string, scope: ApiReadScope): CompatibilityRecord | null {
    const record = this.compatibilityByDigest.get(digest);
    if (record === undefined) return null;
    if (!compatibilityVisible(record, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `compatibility record ${JSON.stringify(digest)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { digest },
      });
    }
    return record;
  }

  private latestCompatibilityVerdict(params: {
    bodyVersionRef: string;
    substrateRef: string;
  }): CompatibilityRecord | null {
    let latest: CompatibilityRecord | null = null;
    for (const record of this.compatibilityRecords) {
      if (
        record.bodyVersionRef === params.bodyVersionRef &&
        record.substrateRef === params.substrateRef
      ) {
        latest = record;
      }
    }
    return latest;
  }

  private getBodyVersionByDigest(digest: string, scope: ApiReadScope): BodyVersion | null {
    const record = this.bodyVersionByDigest.get(digest);
    if (record === undefined) return null;
    if (!bodyVersionVisible(record, scope)) {
      throw new ArenaApiError(ARENA_API_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `body version ${JSON.stringify(digest)} belongs to another tenant — cross-tenant reads fail closed`,
        details: { digest },
      });
    }
    return record;
  }

  private listVisible<T>(records: readonly T[], visible: (record: T) => boolean): readonly T[] {
    return records.filter(visible);
  }
}

/** Construct a fresh, empty reference query fabric. */
export function createApiFabric(): ApiFabric {
  return new ApiFabric();
}

/** The reserved public tenant namespace (re-exported for hosts). */
export { PUBLIC_TENANT };
