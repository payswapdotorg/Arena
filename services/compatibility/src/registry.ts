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

  /** Get service statistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
  };

  /** Clear all records (for testing) */
  clear(): void;
}

/**
 * Create a service compatibility registry.
 */
export function createServiceCompatibilityRegistry(): ServiceCompatibilityRegistry {
  const registry = createCompatibilityRegistry();

  return {
    register(record: CompatibilityRecord): CompatibilityRecord {
      try {
        return registry.register(record);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error; // Re-throw known errors
        }
        
        // Wrap unknown errors
        throw new CompatibilityError('INVALID_RECORD' as CompatibilityErrorCode, {
          message: 'Failed to register compatibility record',
          details: { 
            originalError: error instanceof Error ? error.message : 'Unknown error',
            recordDigest: record.recordDigest,
          },
        });
      }
    },

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
        // Create the record manually
        const record: CompatibilityRecord = {
          recordVersion: 1,
          recordDigest: `generated-${Date.now()}`, // Placeholder - would be properly computed
          bodyVersionRef,
          substrateRef,
          evaluatedAt,
          verdict: result.verdict,
          reasons: result.reasons,
          details: result.details,
          parentDigest,
        };

        if (tenantId !== undefined) {
          (record as any).tenantId = tenantId;
        }
        if (workspaceId !== undefined) {
          (record as any).workspaceId = workspaceId;
        }

        return registry.register(record);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error; // Re-throw known errors
        }
        
        // Wrap unknown errors
        throw new CompatibilityError('INVALID_RECORD' as CompatibilityErrorCode, {
          message: 'Failed to create and register compatibility record',
          details: { 
            originalError: error instanceof Error ? error.message : 'Unknown error',
            bodyVersionRef,
            substrateRef,
          },
        });
      }
    },

    getRecord(digest: string): CompatibilityRecord | undefined {
      return registry.getRecord(digest);
    },

    listRecordsByBody(bodyVersionRef: string): readonly CompatibilityRecord[] {
      return registry.listRecordsByBody(bodyVersionRef);
    },

    listRecordsBySubstrate(substrateRef: string): readonly CompatibilityRecord[] {
      return registry.listRecordsBySubstrate(substrateRef);
    },

    listRecordsByTenant(tenantId: string): readonly CompatibilityRecord[] {
      return registry.listRecordsByTenant(tenantId);
    },

    listRecordsByWorkspace(workspaceId: string): readonly CompatibilityRecord[] {
      return registry.listRecordsByWorkspace(workspaceId);
    },

    listRecords(): readonly CompatibilityRecord[] {
      return registry.listRecords();
    },

    listRecordsByVerdict(verdict: string): readonly CompatibilityRecord[] {
      return registry.listRecordsByVerdict(verdict);
    },

    listRecordsByTimeRange(range: { from?: string; to?: string }): readonly CompatibilityRecord[] {
      return registry.listRecordsByTimeRange(range);
    },

    getLatestRecord(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined {
      return registry.getLatestRecord(bodyVersionRef, substrateRef);
    },

    getBodyCompatibilityHistory(bodyVersionRef: string): readonly CompatibilityRecord[] {
      return registry.getBodyCompatibilityHistory(bodyVersionRef);
    },

    getSubstrateCompatibilityHistory(substrateRef: string): readonly CompatibilityRecord[] {
      return registry.getSubstrateCompatibilityHistory(substrateRef);
    },

    hasRecord(digest: string): boolean {
      return registry.hasRecord(digest);
    },

    getRecordCount(): number {
      return registry.getRecordCount();
    },

    getStats() {
      const allRecords = registry.listRecords();
      const verdictCounts: Record<string, number> = {};

      for (const record of allRecords) {
        verdictCounts[record.verdict] = (verdictCounts[record.verdict] || 0) + 1;
      }

      return {
        totalRecords: allRecords.length,
        recordsByVerdict: verdictCounts,
      };
    },

    clear(): void {
      registry.clear();
    },
  };
}