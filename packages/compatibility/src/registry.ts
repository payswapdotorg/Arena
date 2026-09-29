/**
 * @arena/compatibility — compatibility record registry (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Append-only compatibility record lineage with content-addressing.
 * Deep-frozen records, tenant/workspace scoping, fail-closed errors.
 */

import { toContentDigest, deepFreeze } from '@arena/agent-body';
import { 
  createCompatibilityResult, 
  type CompatibilityRecord, 
  type CompatibilityResult,
  isCompatibilityRecord
} from './shared.js';
import { CompatibilityError, COMPATIBILITY_ERROR_CODES } from './errors.js';

// Compatibility record registry
export class CompatibilityRegistry {
  private readonly records = new Map<string, CompatibilityRecord>();
  private readonly bodyIndex = new Map<string, Set<string>>();
  private readonly substrateIndex = new Map<string, Set<string>>();
  private readonly tenantIndex = new Map<string, Set<string>>();
  private readonly workspaceIndex = new Map<string, Set<string>>();
  private readonly ledger: CompatibilityRecord[] = [];

  /**
   * Register a compatibility record (append-only, content-addressed).
   */
  register(record: CompatibilityRecord): CompatibilityRecord {
    if (!isCompatibilityRecord(record)) {
      throw new CompatibilityError(COMPATIBILITY_ERROR_CODES.INVALID_RECORD, {
        message: 'invalid compatibility record structure',
        details: { record },
      });
    }

    // Check for duplicate digest (content-addressed dedup)
    if (this.records.has(record.recordDigest)) {
      return this.records.get(record.recordDigest)!;
    }

    // Deep freeze the record
    const frozen = deepFreeze(record);

    // Store the record
    this.records.set(frozen.recordDigest, frozen);
    this.ledger.push(frozen);

    // Update indexes
    this.updateIndexes(frozen);

    return frozen;
  }

  /**
   * Create and register a compatibility record.
   */
  createAndRegister(
    bodyVersionRef: string,
    substrateRef: string,
    result: CompatibilityResult,
    evaluatedAt: string,
    parentDigest?: string,
    tenantId?: string,
    workspaceId?: string,
  ): CompatibilityRecord {
    const record: CompatibilityRecord = {
      recordVersion: 1,
      recordDigest: toContentDigest(JSON.stringify({
        bodyVersionRef,
        substrateRef,
        result,
        evaluatedAt,
        parentDigest,
        tenantId,
        workspaceId,
      })),
      bodyVersionRef,
      substrateRef,
      evaluatedAt,
      verdict: result.verdict,
      reasons: result.reasons,
      details: result.details,
      parentDigest: parentDigest as string | undefined,
    };

    if (tenantId !== undefined) {
      (record as any).tenantId = tenantId;
    }
    if (workspaceId !== undefined) {
      (record as any).workspaceId = workspaceId;
    }

    return this.register(record);
  }

  /**
   * Get a record by digest.
   */
  getRecord(digest: string): CompatibilityRecord | undefined {
    return this.records.get(digest);
  }

  /**
   * Get all records for a body version.
   */
  listRecordsByBody(bodyVersionRef: string): readonly CompatibilityRecord[] {
    const digests = this.bodyIndex.get(bodyVersionRef);
    if (!digests) return [];
    
    return [...digests]
      .map(digest => this.records.get(digest))
      .filter((record): record is CompatibilityRecord => record !== undefined);
  }

  /**
   * Get all records for a substrate.
   */
  listRecordsBySubstrate(substrateRef: string): readonly CompatibilityRecord[] {
    const digests = this.substrateIndex.get(substrateRef);
    if (!digests) return [];
    
    return [...digests]
      .map(digest => this.records.get(digest))
      .filter((record): record is CompatibilityRecord => record !== undefined);
  }

  /**
   * Get records for a specific tenant.
   */
  listRecordsByTenant(tenantId: string): readonly CompatibilityRecord[] {
    const digests = this.tenantIndex.get(tenantId);
    if (!digests) return [];
    
    return [...digests]
      .map(digest => this.records.get(digest))
      .filter((record): record is CompatibilityRecord => record !== undefined);
  }

  /**
   * Get records for a specific workspace.
   */
  listRecordsByWorkspace(workspaceId: string): readonly CompatibilityRecord[] {
    const digests = this.workspaceIndex.get(workspaceId);
    if (!digests) return [];
    
    return [...digests]
      .map(digest => this.records.get(digest))
      .filter((record): record is CompatibilityRecord => record !== undefined);
  }

  /**
   * Get all records (insertion order).
   */
  listRecords(): readonly CompatibilityRecord[] {
    return [...this.ledger];
  }

  /**
   * Get records by verdict kind.
   */
  listRecordsByVerdict(verdict: string): readonly CompatibilityRecord[] {
    return this.ledger.filter(record => record.verdict === verdict);
  }

  /**
   * Get records by time range (evaluatedAt).
   */
  listRecordsByTimeRange(range: { from?: string; to?: string } = {}): readonly CompatibilityRecord[] {
    const { from, to } = range;
    const fromTime = from ? new Date(from).getTime() : 0;
    const toTime = to ? new Date(to).getTime() : Infinity;

    return this.ledger.filter(record => {
      const recordTime = new Date(record.evaluatedAt).getTime();
      return recordTime >= fromTime && recordTime <= toTime;
    });
  }

  /**
   * Get the most recent record for a body/substrate pair.
   */
  getLatestRecord(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined {
    const records = this.listRecordsByBody(bodyVersionRef).filter(
      record => record.substrateRef === substrateRef
    );
    
    if (records.length === 0) return undefined;
    
    // Return the most recent (last in ledger order)
    return records[records.length - 1];
  }

  /**
   * Get compatibility history for a body version (all substrates).
   */
  getBodyCompatibilityHistory(bodyVersionRef: string): readonly CompatibilityRecord[] {
    return this.listRecordsByBody(bodyVersionRef);
  }

  /**
   * Get substrate compatibility history (all body versions).
   */
  getSubstrateCompatibilityHistory(substrateRef: string): readonly CompatibilityRecord[] {
    return this.listRecordsBySubstrate(substrateRef);
  }

  /**
   * Check if a record exists.
   */
  hasRecord(digest: string): boolean {
    return this.records.has(digest);
  }

  /**
   * Get record count.
   */
  getRecordCount(): number {
    return this.records.size;
  }

  /**
   * Clear all records (for testing).
   */
  clear(): void {
    this.records.clear();
    this.bodyIndex.clear();
    this.substrateIndex.clear();
    this.tenantIndex.clear();
    this.workspaceIndex.clear();
    this.ledger.length = 0;
  }

  private updateIndexes(record: CompatibilityRecord): void {
    // Body index
    const bodySet = this.bodyIndex.get(record.bodyVersionRef) ?? new Set<string>();
    bodySet.add(record.recordDigest);
    this.bodyIndex.set(record.bodyVersionRef, bodySet);

    // Substrate index
    const substrateSet = this.substrateIndex.get(record.substrateRef) ?? new Set<string>();
    substrateSet.add(record.recordDigest);
    this.substrateIndex.set(record.substrateRef, substrateSet);

    // Tenant index (if present)
    if ('tenantId' in record) {
      const tenantSet = this.tenantIndex.get(record.tenantId as string) ?? new Set<string>();
      tenantSet.add(record.recordDigest);
      this.tenantIndex.set(record.tenantId as string, tenantSet);
    }

    // Workspace index (if present)
    if ('workspaceId' in record) {
      const workspaceSet = this.workspaceIndex.get(record.workspaceId as string) ?? new Set<string>();
      workspaceSet.add(record.recordDigest);
      this.workspaceIndex.set(record.workspaceId as string, workspaceSet);
    }
  }
}

/**
 * Create a fresh compatibility registry.
 */
export function createCompatibilityRegistry(): CompatibilityRegistry {
  return new CompatibilityRegistry();
}