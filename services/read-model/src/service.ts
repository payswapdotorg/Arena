/**
 * @arena/read-model-service — the canonical read-model service (Work Order
 * B005; issue #71).
 *
 * Composes the B002 `ControlPlaneRepository` port (injected; fakes in
 * tests, hosted adapters at composition time) with the pure
 * @arena/read-model projections:
 *
 *   - `readCanonical(tenantId, recordId)` — a typed canonical read, or
 *     `READ_MODEL_RECORD_NOT_FOUND`, or — when the record EXISTS but
 *     belongs to another tenant — `READ_MODEL_TENANT_SCOPE_VIOLATION`
 *     (distinct from not-found; existence is NOT hidden across tenants,
 *     per the B003/B004 vocabulary);
 *   - `scrollByKind(tenantId, kind, continuation?, limit?)` — one bounded
 *     page + an opaque continuation token, over the repository's
 *     deterministic (kind, recordId)-ascending ordering (stable across
 *     reloads);
 *   - `listKinds(tenantId)` — the disclosed kind inventory with counts.
 *
 * EVERY operation takes the tenant from the B004-authenticated session
 * context (never from request payloads — the tenant boundary is
 * server-controlled; callers pass the validated tenant id).
 *
 * READ-ONLY posture (the governing invariant): the read model is a
 * PROJECTION over canonical Arena objects — never a second authority. The
 * service exposes NO mutation operations and holds NO state: every read
 * re-reads the control plane and carries the source record's version +
 * revision so consumers detect reload drift. readAt is stamped from the
 * injected B002 Clock at projection time (never inside the pure mappers).
 */

import type { Clock, ControlPlaneRepository } from '@arena/persistence';
import {
  READ_MODEL_DEFAULT_PAGE_SIZE,
  READ_MODEL_ERROR_CODES,
  READ_MODEL_KINDS,
  READ_MODEL_RECORD_VERSION,
  ReadModelError,
  decodeContinuation,
  effectiveLimit,
  encodeByKindContinuation,
  encodeByTenantContinuation,
  toCanonicalRead,
  validateReadQuery,
} from '@arena/read-model';
import type {
  CanonicalRead,
  CanonicalReadModel,
  KindInventory,
  KindInventoryEntry,
  ReadPage,
  TenantListingPage,
} from '@arena/read-model';

/** Wire version of the service's contract records. */
export const READ_MODEL_SERVICE_RECORD_VERSION = READ_MODEL_RECORD_VERSION;

// The page/inventory contract shapes (ReadPage, TenantListingPage,
// KindInventory, KindInventoryEntry) live in @arena/read-model's
// contracts surface — services communicate through versioned contracts
// (spec/service-boundaries.md). This service re-exports them for
// convenience of its direct consumers.
export type {
  CanonicalReadModel,
  KindInventory,
  KindInventoryEntry,
  ReadPage,
  TenantListingPage,
} from '@arena/read-model';

/** Injected dependencies (the services/persistence precedent). */
export interface ReadModelServiceDeps {
  readonly repository: ControlPlaneRepository;
  readonly clock: Clock;
}

function requireTenantId(tenantId: string): string {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: `read-model operations require a non-empty tenant id from the authenticated context, got ${JSON.stringify(String(tenantId))}`,
      details: { tenantId },
    });
  }
  return tenantId;
}

function requireRecordId(recordId: string): string {
  if (typeof recordId !== 'string' || recordId.length === 0) {
    throw new ReadModelError(READ_MODEL_ERROR_CODES.INVALID_QUERY, {
      message: `readCanonical requires a non-empty record id, got ${JSON.stringify(String(recordId))}`,
      details: { recordId },
    });
  }
  return recordId;
}

export class ReadModelService implements CanonicalReadModel {
  private readonly repository: ControlPlaneRepository;
  private readonly clock: Clock;

  constructor(deps: ReadModelServiceDeps) {
    if (typeof deps.repository?.get !== 'function') {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'ReadModelService requires an injected ControlPlaneRepository',
      });
    }
    if (typeof deps.clock?.now !== 'function') {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.UNKNOWN_ERROR, {
        message: 'ReadModelService requires an injected Clock',
      });
    }
    this.repository = deps.repository;
    this.clock = deps.clock;
  }

  /**
   * Read one canonical record by id, scoped to the AUTHENTICATED tenant.
   * Outcomes (all typed): the canonical read; RECORD_NOT_FOUND when no
   * such record exists; TENANT_SCOPE_VIOLATION when the record exists
   * but belongs to another tenant (existence never hidden).
   */
  async readCanonical(tenantId: string, recordId: string): Promise<CanonicalRead> {
    requireTenantId(tenantId);
    requireRecordId(recordId);
    const record = await this.repository.get(recordId);
    if (record === null) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `no control-plane record ${JSON.stringify(recordId)} exists`,
        details: { recordId },
      });
    }
    if (String(record.tenantId) !== String(tenantId)) {
      throw new ReadModelError(READ_MODEL_ERROR_CODES.TENANT_SCOPE_VIOLATION, {
        message: `record ${JSON.stringify(recordId)} exists but belongs to tenant ${JSON.stringify(String(record.tenantId))}, not the authenticated tenant ${JSON.stringify(String(tenantId))}`,
        details: {
          recordId,
          recordTenant: String(record.tenantId),
          authenticatedTenant: String(tenantId),
        },
      });
    }
    return toCanonicalRead(record, this.clock.now());
  }

  /**
   * Scroll one disclosed kind within the AUTHENTICATED tenant: one bounded
   * page of canonical reads in (kind, recordId)-ascending order (the
   * repository's deterministic ordering — stable across reloads), plus an
   * opaque continuation token when more records remain. Every page
   * re-reads the control plane; nothing is cached.
   */
  async scrollByKind(
    tenantId: string,
    recordKind: Parameters<CanonicalReadModel['scrollByKind']>[1],
    continuation?: string,
    limit?: number,
  ): Promise<ReadPage> {
    requireTenantId(tenantId);
    // Validate the full paginated-query shape through the pure vocabulary
    // (bounded page sizes, disclosed kinds, closed fields).
    validateReadQuery({
      kind: 'by-kind',
      recordKind,
      ...(limit !== undefined ? { limit } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    });
    const effective =
      limit !== undefined ? effectiveLimit({ limit }) : READ_MODEL_DEFAULT_PAGE_SIZE;
    let offset = 0;
    if (continuation !== undefined) {
      offset = decodeContinuation(continuation, 'by-kind', recordKind).offset;
    }
    const readAt = this.clock.now();
    // Fetch limit + 1 rows to detect whether a next page exists.
    const rows = await this.repository.list({
      tenantId,
      kind: recordKind,
      limit: effective + 1,
      offset,
    });
    const hasMore = rows.length > effective;
    const page = hasMore ? rows.slice(0, effective) : rows;
    return {
      recordVersion: READ_MODEL_SERVICE_RECORD_VERSION,
      kind: 'by-kind',
      recordKind,
      records: page.map((record) => toCanonicalRead(record, readAt)),
      ...(hasMore ? { continuation: encodeByKindContinuation(recordKind, offset + effective) } : {}),
      readAt,
    };
  }

  /**
   * List canonical records across the tenant's kinds (paginated listing
   * in recordId-ascending order over the repository's deterministic
   * projection).
   */
  async listByTenant(
    tenantId: string,
    continuation?: string,
    limit?: number,
  ): Promise<TenantListingPage> {
    requireTenantId(tenantId);
    validateReadQuery({
      kind: 'by-tenant',
      ...(limit !== undefined ? { limit } : {}),
      ...(continuation !== undefined ? { continuation } : {}),
    });
    const effective =
      limit !== undefined ? effectiveLimit({ limit }) : READ_MODEL_DEFAULT_PAGE_SIZE;
    let offset = 0;
    if (continuation !== undefined) {
      offset = decodeContinuation(continuation, 'by-tenant').offset;
    }
    const readAt = this.clock.now();
    const rows = await this.repository.list({
      tenantId,
      limit: effective + 1,
      offset,
    });
    const hasMore = rows.length > effective;
    const page = hasMore ? rows.slice(0, effective) : rows;
    return {
      recordVersion: READ_MODEL_SERVICE_RECORD_VERSION,
      kind: 'by-tenant',
      records: page.map((record) => toCanonicalRead(record, readAt)),
      ...(hasMore
        ? { continuation: encodeByTenantContinuation(offset + effective) }
        : {}),
      readAt,
    };
  }

  /**
   * The disclosed kind inventory for the AUTHENTICATED tenant with counts
   * (kinds with zero records are omitted; the disclosed vocabulary lives
   * in @arena/read-model's READ_MODEL_KINDS).
   */
  async listKinds(tenantId: string): Promise<KindInventory> {
    requireTenantId(tenantId);
    const entries: KindInventoryEntry[] = [];
    for (const kind of READ_MODEL_KINDS) {
      const count = await this.repository.count({ tenantId, kind });
      if (count > 0) {
        entries.push({ kind, count });
      }
    }
    return { recordVersion: READ_MODEL_SERVICE_RECORD_VERSION, kinds: entries };
  }
}

/** Construct a fresh canonical read-model service over injected ports. */
export function createReadModelService(deps: ReadModelServiceDeps): ReadModelService {
  return new ReadModelService(deps);
}
