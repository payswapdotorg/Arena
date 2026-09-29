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
  type CompatibilityRecord,
  CompatibilityError,
  type CompatibilityErrorCode
} from '@arena/compatibility';

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

  /** Get all records for a body version */
  listRecordsByBody(bodyVersionRef: string): readonly CompatibilityRecord[];

  /** Get all records for a substrate */
  listRecordsBySubstrate(substrateRef: string): readonly CompatibilityRecord[];

  /** Get records for a specific tenant */
  listRecordsByTenant(tenantId: string): readonly CompatibilityRecord[];

  /** Get records for a specific workspace */
  listRecordsByWorkspace(workspaceId: string): readonly CompatibilityRecord[];

  /** Get all records */
  listRecords(): readonly CompatibilityRecord[];

  /** Get records by verdict */
  listRecordsByVerdict(verdict: string): readonly CompatibilityRecord[];

  /** Get records by time range */
  listRecordsByTimeRange(range: { from?: string; to?: string }): readonly CompatibilityRecord[];

  /** Get the most recent record for a body/substrate pair */
  getLatestRecord(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined;

  /** Get compatibility history for a body version */
  getBodyCompatibilityHistory(bodyVersionRef: string): readonly CompatibilityRecord[];

  /** Get substrate compatibility history */
  getSubstrateCompatibilityHistory(substrateRef: string): readonly CompatibilityRecord[];

  /** Check if a record exists */
  hasRecord(digest: string): boolean;

  /** Get record count */
  getRecordCount(): number;

  /** Clear all records */
  clear(): void;

  /** Get registry statistics */
  getStatistics(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  };
}

/** Service compatibility registry implementation */
export class ServiceCompatibilityRegistryImpl implements ServiceCompatibilityRegistry {
  private readonly registry: CompatibilityRegistry;
  private readonly tenantId?: string;
  private readonly workspaceId?: string;

  constructor(
    registry?: CompatibilityRegistry,
    tenantId?: string,
    workspaceId?: string,
  ) {
    this.registry = registry ?? createCompatibilityRegistry();
    this.tenantId = tenantId;
    this.workspaceId = workspaceId;
  }

  /** Register a compatibility record with error handling */
  register(record: CompatibilityRecord): CompatibilityRecord {
    try {
      return this.registry.register(record);
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw new CompatibilityError(error.code, {
          message: `Failed to register compatibility record: ${error.message}`,
          details: error.details,
        });
      }
      throw error;
    }
  }

  /** Create and register a compatibility record with error handling */
  createAndRegister(
    bodyVersionRef: string,
    substrateRef: string,
    result: import('@arena/compatibility').CompatibilityResult,
    evaluatedAt: string,
    parentDigest?: string,
    tenantId?: string,
    workspaceId?: string,
  ): CompatibilityRecord {
    try {
      return this.registry.createAndRegister(
        bodyVersionRef,
        substrateRef,
        result,
        evaluatedAt,
        parentDigest,
        tenantId || this.tenantId,
        workspaceId || this.workspaceId,
      );
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw new CompatibilityError(error.code, {
          message: `Failed to create compatibility record: ${error.message}`,
          details: error.details,
        });
      }
      throw error;
    }
  }

  /** Get a record by digest */
  getRecord(digest: string): CompatibilityRecord | undefined {
    return this.registry.getRecord(digest);
  }

  /** Get all records for a body version */
  listRecordsByBody(bodyVersionRef: string): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByBody(bodyVersionRef);
  }

  /** Get all records for a substrate */
  listRecordsBySubstrate(substrateRef: string): readonly CompatibilityRecord[] {
    return this.registry.listRecordsBySubstrate(substrateRef);
  }

  /** Get records for a specific tenant */
  listRecordsByTenant(tenantId: string): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByTenant(tenantId);
  }

  /** Get records for a specific workspace */
  listRecordsByWorkspace(workspaceId: string): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByWorkspace(workspaceId);
  }

  /** Get all records */
  listRecords(): readonly CompatibilityRecord[] {
    return this.registry.listRecords();
  }

  /** Get records by verdict */
  listRecordsByVerdict(verdict: string): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByVerdict(verdict);
  }

  /** Get records by time range */
  listRecordsByTimeRange(range: { from?: string; to?: string }): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByTimeRange(range);
  }

  /** Get the most recent record for a body/substrate pair */
  getLatestRecord(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined {
    return this.registry.getLatestRecord(bodyVersionRef, substrateRef);
  }

  /** Get compatibility history for a body version */
  getBodyCompatibilityHistory(bodyVersionRef: string): readonly CompatibilityRecord[] {
    return this.registry.getBodyCompatibilityHistory(bodyVersionRef);
  }

  /** Get substrate compatibility history */
  getSubstrateCompatibilityHistory(substrateRef: string): readonly CompatibilityRecord[] {
    return this.registry.getSubstrateCompatibilityHistory(substrateRef);
  }

  /** Check if a record exists */
  hasRecord(digest: string): boolean {
    return this.registry.hasRecord(digest);
  }

  /** Get record count */
  getRecordCount(): number {
    return this.registry.getRecordCount();
  }

  /** Clear all records */
  clear(): void {
    this.registry.clear();
  }

  /** Get registry statistics */
  getStatistics(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  } {
    const records = this.listRecords();
    const recordsByVerdict: Record<string, number> = {};
    const recordsByTenant: Record<string, number> = {};
    const recordsByWorkspace: Record<string, number> = {};

    for (const record of records) {
      // Count by verdict
      recordsByVerdict[record.verdict] = (recordsByVerdict[record.verdict] || 0) + 1;

      // Count by tenant
      if (record.tenantId) {
        recordsByTenant[record.tenantId] = (recordsByTenant[record.tenantId] || 0) + 1;
      }

      // Count by workspace
      if (record.workspaceId) {
        recordsByWorkspace[record.workspaceId] = (recordsByWorkspace[record.workspaceId] || 0) + 1;
      }
    }

    return {
      totalRecords: records.length,
      recordsByVerdict,
      recordsByTenant,
      recordsByWorkspace,
    };
  }
}

/** Create a service compatibility registry */
export function createServiceCompatibilityRegistry(
  tenantId?: string,
  workspaceId?: string,
): ServiceCompatibilityRegistry {
  return new ServiceCompatibilityRegistryImpl(undefined, tenantId, workspaceId);
}