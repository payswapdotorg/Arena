/**
 * @arena/compatibility-fabric — service-layer compatibility registry
 * (Work Order A022; requirements R2, R20; spec AB1.0).
 *
 * Service wrapper for the compatibility registry with additional features:
 * - Error handling
 * - Validation
 * - Statistics
 */

import { 
  CompatibilityRegistry, 
  createCompatibilityRegistry,
  CompatibilityRecord 
} from '@arena/compatibility';
import { CompatibilityError } from '@arena/compatibility';

/** Service compatibility registry interface */
export interface ServiceCompatibilityRegistry {
  /** Register a compatibility record */
  register(record: CompatibilityRecord): CompatibilityRecord;

  /** Create and register a compatibility record */
  createAndRegister(
    bodyVersionRef: string,
    substrateRef: string,
    result: import('@arena/compatibility').CompatibilityResult,
    evaluatedAt: string,
    parentDigest?: string,
    tenantId?: string,
    workspaceId?: string,
  ): CompatibilityRecord;

  /** Get a record by digest */
  getRecord(digest: string): CompatibilityRecord | undefined;

  /** List records by body version */
  listRecordsByBody(bodyVersionRef: string): readonly CompatibilityRecord[];

  /** List records by substrate */
  listRecordsBySubstrate(substrateRef: string): readonly CompatibilityRecord[];

  /** List records by tenant */
  listRecordsByTenant(tenantId: string): readonly CompatibilityRecord[];

  /** List records by workspace */
  listRecordsByWorkspace(workspaceId: string): readonly CompatibilityRecord[];

  /** List all records */
  listRecords(): readonly CompatibilityRecord[];

  /** List records by verdict */
  listRecordsByVerdict(verdict: string): readonly CompatibilityRecord[];

  /** List records by time range */
  listRecordsByTimeRange(range: { from?: string; to?: string }): readonly CompatibilityRecord[];

  /** Get latest record for body/substrate pair */
  getLatestRecord(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined;

  /** Get body compatibility history */
  getBodyCompatibilityHistory(bodyVersionRef: string): readonly CompatibilityRecord[];

  /** Get substrate compatibility history */
  getSubstrateCompatibilityHistory(substrateRef: string): readonly CompatibilityRecord[];

  /** Check if record exists */
  hasRecord(digest: string): boolean;

  /** Get record count */
  getRecordCount(): number;

  /** Clear all records */
  clear(): void;

  /** Get registry statistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByBody: Record<string, number>;
    recordsBySubstrate: Record<string, number>;
  };
}

/** Create a service compatibility registry */
export function createServiceCompatibilityRegistry(): ServiceCompatibilityRegistry {
  const registry = createCompatibilityRegistry();

  return {
    register(record) {
      try {
        return registry.register(record);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error;
        }
        throw new CompatibilityError('INVALID_RECORD', {
          message: 'failed to register compatibility record',
          details: { error: error instanceof Error ? error.message : error },
        });
      }
    },

    createAndRegister(bodyVersionRef, substrateRef, result, evaluatedAt, parentDigest, tenantId, workspaceId) {
      try {
        return registry.createAndRegister(
          bodyVersionRef,
          substrateRef,
          result,
          evaluatedAt,
          parentDigest,
          tenantId,
          workspaceId
        );
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error;
        }
        throw new CompatibilityError('INVALID_RECORD', {
          message: 'failed to create compatibility record',
          details: { error: error instanceof Error ? error.message : error },
        });
      }
    },

    getRecord(digest) {
      return registry.getRecord(digest);
    },

    listRecordsByBody(bodyVersionRef) {
      return registry.listRecordsByBody(bodyVersionRef);
    },

    listRecordsBySubstrate(substrateRef) {
      return registry.listRecordsBySubstrate(substrateRef);
    },

    listRecordsByTenant(tenantId) {
      return registry.listRecordsByTenant(tenantId);
    },

    listRecordsByWorkspace(workspaceId) {
      return registry.listRecordsByWorkspace(workspaceId);
    },

    listRecords() {
      return registry.listRecords();
    },

    listRecordsByVerdict(verdict) {
      return registry.listRecordsByVerdict(verdict);
    },

    listRecordsByTimeRange(range) {
      return registry.listRecordsByTimeRange(range);
    },

    getLatestRecord(bodyVersionRef, substrateRef) {
      return registry.getLatestRecord(bodyVersionRef, substrateRef);
    },

    getBodyCompatibilityHistory(bodyVersionRef) {
      return registry.getBodyCompatibilityHistory(bodyVersionRef);
    },

    getSubstrateCompatibilityHistory(substrateRef) {
      return registry.getSubstrateCompatibilityHistory(substrateRef);
    },

    hasRecord(digest) {
      return registry.hasRecord(digest);
    },

    getRecordCount() {
      return registry.getRecordCount();
    },

    clear() {
      registry.clear();
    },

    getStats() {
      const records = registry.listRecords();
      const recordsByVerdict = records.reduce((acc, record) => {
        acc[record.verdict] = (acc[record.verdict] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const recordsByBody = records.reduce((acc, record) => {
        acc[record.bodyVersionRef] = (acc[record.bodyVersionRef] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const recordsBySubstrate = records.reduce((acc, record) => {
        acc[record.substrateRef] = (acc[record.substrateRef] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalRecords: records.length,
        recordsByVerdict,
        recordsByBody,
        recordsBySubstrate,
      };
    },
  };
}