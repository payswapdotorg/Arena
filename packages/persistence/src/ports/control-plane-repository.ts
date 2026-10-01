/**
 * ControlPlaneRepository port (Work Order B002; issue #64).
 *
 * The authoritative control-plane state port: a typed, CRUD-ish interface
 * over versioned records. It is deliberately a PORT — interface + result
 * and error types — not an ORM: no query language, no relations, no lazy
 * loading. Providers (hosted or local) implement it; services consume it.
 *
 * Record model (FT2.0 "Database" — the authoritative store for Arena
 * control-plane records):
 *   - identity: caller-supplied `recordId` (stable, bounded charset);
 *   - tenancy: every record carries a `tenantId` (architecture-lock
 *     tenancy rules — customer data is never silently reused across
 *     tenants);
 *   - versioning: `version` is the record's own schema version; `revision`
 *     is the optimistic-concurrency revision (starts at 1, +1 per update);
 *   - payload: `data` is canonical-JSON-safe;
 *   - time: `createdAt`/`updatedAt` are epoch ms supplied by the
 *     implementation's injected Clock.
 *
 * Semantics every implementation MUST honor (asserted by the shared
 * contract suite):
 *   - insert is idempotent: replaying the identical insert returns the
 *     stored record with `created: false`; a conflicting insert under the
 *     same recordId throws PERSISTENCE_RECORD_EXISTS;
 *   - update is optimistic: the caller states `expectedRevision`; a
 *     mismatch throws PERSISTENCE_REVISION_CONFLICT; absent records throw
 *     PERSISTENCE_RECORD_NOT_FOUND; identity fields (recordId, tenantId,
 *     kind, createdAt) never change;
 *   - list/count are deterministic projections ordered by recordId
 *     ascending with explicit limit/offset pagination;
 *   - returned records are frozen deep (read discipline).
 */

import type { JsonSafeValue } from '../shared.js';

/** The authoritative control-plane record (frozen on return). */
export interface ControlPlaneRecord {
  readonly recordId: string;
  readonly tenantId: string;
  readonly kind: string;
  /** Record schema version (positive integer, owned by the writer). */
  readonly version: number;
  /** Optimistic-concurrency revision; 1 at creation, +1 per update. */
  readonly revision: number;
  readonly data: JsonSafeValue;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** Input of an idempotent insert. */
export interface ControlPlaneInsertInput {
  readonly recordId: string;
  readonly tenantId: string;
  readonly kind: string;
  readonly version: number;
  readonly data: JsonSafeValue;
}

/** Insert result: the stored record plus whether THIS call created it. */
export interface ControlPlaneInsertResult {
  readonly record: ControlPlaneRecord;
  readonly created: boolean;
}

/** Update input: optimistic-concurrency guarded data replacement. */
export interface ControlPlaneUpdateInput {
  /** The revision the caller observed; mismatch = conflict. */
  readonly expectedRevision: number;
  readonly data: JsonSafeValue;
}

/** List query: filters + deterministic pagination. */
export interface ControlPlaneListQuery {
  readonly kind?: string;
  readonly tenantId?: string;
  /** Page size when present (>= 1). */
  readonly limit?: number;
  /** Page offset when present (>= 0, default 0). */
  readonly offset?: number;
}

/** Count query: the same filters without pagination. */
export interface ControlPlaneCountQuery {
  readonly kind?: string;
  readonly tenantId?: string;
}

/**
 * The provider-neutral authoritative control-plane port.
 * Implementations: fakes (local parity) and hosted adapters.
 */
export interface ControlPlaneRepository {
  /** Idempotent insert (same input -> replay; conflict -> typed error). */
  insert(input: ControlPlaneInsertInput): Promise<ControlPlaneInsertResult>;
  /** Exact record or null when absent. */
  get(recordId: string): Promise<ControlPlaneRecord | null>;
  /** Optimistic-concurrency update; returns the new revision record. */
  update(recordId: string, update: ControlPlaneUpdateInput): Promise<ControlPlaneRecord>;
  /** True when a record was deleted, false when absent. */
  delete(recordId: string): Promise<boolean>;
  /** Deterministic projection (recordId ascending) with pagination. */
  list(query: ControlPlaneListQuery): Promise<readonly ControlPlaneRecord[]>;
  /** Number of records matching the filters. */
  count(query: ControlPlaneCountQuery): Promise<number>;
}
