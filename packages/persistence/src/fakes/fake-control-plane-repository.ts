/**
 * FakeControlPlaneRepository (Work Order B002) — the local in-memory
 * implementation of the authoritative control-plane port, with FULL
 * contract parity with the hosted adapter (the shared contract suite runs
 * against both; FT2.0 "Local parity").
 */

import { PERSISTENCE_ERROR_CODES, PersistenceError } from '../errors.js';
import type {
  ControlPlaneCountQuery,
  ControlPlaneInsertInput,
  ControlPlaneInsertResult,
  ControlPlaneListQuery,
  ControlPlaneRecord,
  ControlPlaneRepository,
  ControlPlaneUpdateInput,
} from '../ports/control-plane-repository.js';
import type { Clock } from '../ports/clock.js';
import { SystemClock } from './clock.js';
import {
  canonicalEqual,
  deepFreeze,
  isRecordId,
  isRecordKind,
  isTenantId,
  toRecordData,
} from '../shared.js';

export interface FakeControlPlaneRepositoryOptions {
  readonly clock?: Clock;
}

export class FakeControlPlaneRepository implements ControlPlaneRepository {
  private readonly clock: Clock;
  private readonly records = new Map<string, ControlPlaneRecord>();

  constructor(options: FakeControlPlaneRepositoryOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
  }

  async insert(input: ControlPlaneInsertInput): Promise<ControlPlaneInsertResult> {
    const validated = this.validateInsertInput(input);
    const existing = this.records.get(validated.recordId);
    if (existing !== undefined) {
      const identical =
        existing.tenantId === validated.tenantId &&
        existing.kind === validated.kind &&
        existing.version === validated.version &&
        canonicalEqual(existing.data, validated.data);
      if (!identical) {
        throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_EXISTS, {
          message: `record already exists with different content: ${validated.recordId}`,
          details: { recordId: validated.recordId },
        });
      }
      return { record: existing, created: false };
    }
    const now = this.clock.now();
    const record: ControlPlaneRecord = deepFreeze({
      recordId: validated.recordId,
      tenantId: validated.tenantId,
      kind: validated.kind,
      version: validated.version,
      revision: 1,
      data: deepFreeze(validated.data),
      createdAt: now,
      updatedAt: now,
    });
    this.records.set(validated.recordId, record);
    return { record, created: true };
  }

  async get(recordId: string): Promise<ControlPlaneRecord | null> {
    this.validateRecordId(recordId);
    return this.records.get(recordId) ?? null;
  }

  async update(recordId: string, update: ControlPlaneUpdateInput): Promise<ControlPlaneRecord> {
    this.validateRecordId(recordId);
    if (
      !Number.isInteger(update.expectedRevision) ||
      update.expectedRevision < 1
    ) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_REVISION, {
        message: 'expectedRevision must be a positive integer',
        details: { received: update.expectedRevision },
      });
    }
    const data = toRecordData(update.data);
    const existing = this.records.get(recordId);
    if (existing === undefined) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.RECORD_NOT_FOUND, {
        message: `record not found: ${recordId}`,
        details: { recordId },
      });
    }
    if (existing.revision !== update.expectedRevision) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.REVISION_CONFLICT, {
        message: `revision conflict for ${recordId}: expected ${String(update.expectedRevision)}, current ${String(existing.revision)}`,
        details: { recordId, expectedRevision: update.expectedRevision, currentRevision: existing.revision },
      });
    }
    const updated: ControlPlaneRecord = deepFreeze({
      ...existing,
      revision: existing.revision + 1,
      data: deepFreeze(data),
      updatedAt: this.clock.now(),
    });
    this.records.set(recordId, updated);
    return updated;
  }

  async delete(recordId: string): Promise<boolean> {
    this.validateRecordId(recordId);
    return this.records.delete(recordId);
  }

  async list(query: ControlPlaneListQuery): Promise<readonly ControlPlaneRecord[]> {
    this.validateListQuery(query);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? Number.POSITIVE_INFINITY;
    const matches = [...this.records.values()]
      .filter(
        (record) =>
          (query.kind === undefined || record.kind === query.kind) &&
          (query.tenantId === undefined || record.tenantId === query.tenantId),
      )
      .sort((a, b) => (a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0));
    return Object.freeze(matches.slice(offset, offset + limit));
  }

  async count(query: ControlPlaneCountQuery): Promise<number> {
    this.validateCountQuery(query);
    let total = 0;
    for (const record of this.records.values()) {
      if (
        (query.kind === undefined || record.kind === query.kind) &&
        (query.tenantId === undefined || record.tenantId === query.tenantId)
      ) {
        total += 1;
      }
    }
    return total;
  }

  /** Number of stored records (test/inspection helper). */
  get size(): number {
    return this.records.size;
  }

  private validateInsertInput(
    input: ControlPlaneInsertInput,
  ): ControlPlaneInsertInput & { data: ReturnType<typeof toRecordData> } {
    if (!isRecordId(input.recordId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(input.recordId)}`,
      });
    }
    if (!isTenantId(input.tenantId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id: ${JSON.stringify(input.tenantId)}`,
      });
    }
    if (!isRecordKind(input.kind)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind: ${JSON.stringify(input.kind)}`,
      });
    }
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_VERSION, {
        message: `record version must be a positive integer: ${String(input.version)}`,
      });
    }
    const data = toRecordData(input.data);
    return { ...input, data };
  }

  private validateRecordId(recordId: string): void {
    if (!isRecordId(recordId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_ID, {
        message: `invalid record id: ${JSON.stringify(recordId)}`,
      });
    }
  }

  private validateListQuery(query: ControlPlaneListQuery): void {
    if (query.kind !== undefined && !isRecordKind(query.kind)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind filter: ${JSON.stringify(query.kind)}`,
      });
    }
    if (query.tenantId !== undefined && !isTenantId(query.tenantId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id filter: ${JSON.stringify(query.tenantId)}`,
      });
    }
    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `limit must be a positive integer: ${String(query.limit)}`,
      });
    }
    if (query.offset !== undefined && (!Number.isInteger(query.offset) || query.offset < 0)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_DATA, {
        message: `offset must be a non-negative integer: ${String(query.offset)}`,
      });
    }
  }

  private validateCountQuery(query: ControlPlaneCountQuery): void {
    if (query.kind !== undefined && !isRecordKind(query.kind)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_RECORD_KIND, {
        message: `invalid record kind filter: ${JSON.stringify(query.kind)}`,
      });
    }
    if (query.tenantId !== undefined && !isTenantId(query.tenantId)) {
      throw new PersistenceError(PERSISTENCE_ERROR_CODES.INVALID_TENANT_ID, {
        message: `invalid tenant id filter: ${JSON.stringify(query.tenantId)}`,
      });
    }
  }
}
