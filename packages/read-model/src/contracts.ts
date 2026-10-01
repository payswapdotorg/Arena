/**
 * The versioned read-model CONTRACT surface (Work Order B005; issue #71;
 * spec/service-boundaries.md: services communicate only through versioned
 * contracts — so the page/inventory/port vocabulary lives HERE, in the
 * package, not in a service).
 *
 * `CanonicalReadModel` is the port every consumer (the read-model
 * service, the API read boundary, future UI wiring) shares: the pure
 * read operations over canonical control-plane records. B005's
 * services/read-model implements it; services/api-read consumes it
 * through injection; B006/B007 UI wiring consumes the record shapes.
 */

import type { CanonicalRead, ReadModelKind } from './models.js';
import { READ_MODEL_RECORD_VERSION } from './models.js';

/** Wire version of the read-model contract records. */
export const READ_MODEL_CONTRACT_VERSION = READ_MODEL_RECORD_VERSION;

/** One page of a deterministic kind scroll. */
export interface ReadPage {
  readonly recordVersion: typeof READ_MODEL_CONTRACT_VERSION;
  readonly kind: 'by-kind';
  readonly recordKind: ReadModelKind;
  readonly records: readonly CanonicalRead[];
  /** Present iff more records remain in this scroll. */
  readonly continuation?: string;
  readonly readAt: number;
}

/** One page of a tenant-wide listing. */
export interface TenantListingPage {
  readonly recordVersion: typeof READ_MODEL_CONTRACT_VERSION;
  readonly kind: 'by-tenant';
  readonly records: readonly CanonicalRead[];
  readonly continuation?: string;
  readonly readAt: number;
}

/** One entry of the disclosed kind inventory. */
export interface KindInventoryEntry {
  readonly kind: ReadModelKind;
  readonly count: number;
}

/** The disclosed kind inventory for a tenant, with counts. */
export interface KindInventory {
  readonly recordVersion: typeof READ_MODEL_CONTRACT_VERSION;
  readonly kinds: readonly KindInventoryEntry[];
}

/**
 * The canonical read-model port (READ-ONLY by construction — no mutation
 * operation exists on the interface). Implementations take the tenant
 * from the authenticated context, never from request payloads.
 */
export interface CanonicalReadModel {
  /** One canonical read by id; RECORD_NOT_FOUND / TENANT_SCOPE_VIOLATION. */
  readCanonical(tenantId: string, recordId: string): Promise<CanonicalRead>;
  /** One bounded page of a (kind, recordId)-ordered scroll + continuation. */
  scrollByKind(
    tenantId: string,
    recordKind: ReadModelKind,
    continuation?: string,
    limit?: number,
  ): Promise<ReadPage>;
  /** One bounded page of the tenant-wide listing + continuation. */
  listByTenant(tenantId: string, continuation?: string, limit?: number): Promise<TenantListingPage>;
  /** The disclosed kind inventory with counts. */
  listKinds(tenantId: string): Promise<KindInventory>;
}
