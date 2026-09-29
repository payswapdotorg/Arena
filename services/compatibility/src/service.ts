/**
 * @arena/compatibility-fabric — the A022 reference compatibility service
 * (in-process registry + evaluation engine + record ledger).
 *
 * Work Order A022; requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4.
 *
 * Main service interface combining evaluation logic with record management.
 * Fail-closed errors, tenant/workspace scoping, deep-frozen records.
 */

import { 
  CompatibilityRegistry, 
  createCompatibilityRegistry,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  type CompatibilityRecord,
  type EvaluateAndRecordOptions
} from '@arena/compatibility';
import { 
  CompatibilityEngine, 
  createCompatibilityEngine
} from '@arena/compatibility';
import { 
  toCorrelationId, 
  toIdempotencyKey 
} from '@arena/protocol-core';

/** Service configuration */
export interface CompatibilityServiceConfig {
  readonly registry?: CompatibilityRegistry;
  readonly engine?: CompatibilityEngine;
  readonly tenantId?: string;
  readonly workspaceId?: string;
}

/** Compatibility service interface */
export interface CompatibilityService {
  /** Evaluate compatibility and create a record */
  evaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<CompatibilityRecord>;

  /** Batch evaluate compatibility */
  batchEvaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<readonly CompatibilityRecord[]>;

  /** Get compatibility history for a body version */
  getBodyCompatibilityHistory(
    bodyVersionRef: string,
    options?: {
      correlationId?: string;
    }
  ): Promise<readonly CompatibilityRecord[]>;

  /** Get compatibility history for a substrate */
  getSubstrateCompatibilityHistory(
    substrateRef: string,
    options?: {
      correlationId?: string;
    }
  ): Promise<readonly CompatibilityRecord[]>;

  /** Get the latest compatibility record */
  getLatestCompatibilityRecord(
    bodyVersionRef: string,
    substrateRef: string,
    options?: {
      correlationId?: string;
    }
  ): Promise<CompatibilityRecord | undefined>;

  /** Get service statistics */
  getStatistics(options?: {
    correlationId?: string;
  }): Promise<{
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  }>;
}

/** Compatibility service implementation */
export class CompatibilityServiceImpl implements CompatibilityService {
  private readonly registry: CompatibilityRegistry;
  private readonly engine: CompatibilityEngine;
  private readonly tenantId?: string;
  private readonly workspaceId?: string;

  constructor(config: CompatibilityServiceConfig = {}) {
    this.registry = config.registry ?? createCompatibilityRegistry();
    this.engine = config.engine ?? createCompatibilityEngine();
    this.tenantId = config.tenantId;
    this.workspaceId = config.workspaceId;
  }

  /** Evaluate compatibility and create a record */
  async evaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options: {
      correlationId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<CompatibilityRecord> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);

    // Check for existing record with same idempotency key
    if (idempotencyKey) {
      // In a real implementation, we'd check for existing records with this idempotency key
      // For now, we'll just proceed with the evaluation
    }

    try {
      const result = await this.engine.evaluateBodySubstrateCompatibility(bodyProfile, substrate);
      
      return this.registry.createAndRecord(
        bodyVersionRef,
        this.getSubstrateRef(substrate), // This would be extracted from substrate
        result,
        new Date().toISOString(),
        undefined,
        this.tenantId,
        this.workspaceId,
      );
    } catch (error) {
      throw new Error(`Compatibility evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** Batch evaluate compatibility */
  async batchEvaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options: {
      correlationId?: string;
      idempotencyKey?: string;
    } = {},
  ): Promise<readonly CompatibilityRecord[]> {
    const correlationId = toCorrelationId(options.correlationId);
    const idempotencyKey = toIdempotencyKey(options.idempotencyKey);

    const records: CompatibilityRecord[] = [];

    for (const substrate of substrates) {
      try {
        const record = await this.evaluateAndRecord(
          bodyVersionRef,
          bodyProfile,
          substrate,
          { correlationId, idempotencyKey: `${idempotencyKey}-${substrate.modelId}` },
        );
        records.push(record);
      } catch (error) {
        // Create a failure record
        const errorRecord: CompatibilityRecord = {
          recordVersion: 1,
          recordDigest: `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          bodyVersionRef,
          substrateRef: this.getSubstrateRef(substrate),
          evaluatedAt: new Date().toISOString(),
          verdict: 'incompatible-with-reasons',
          reasons: [error instanceof Error ? error.message : 'Unknown error'],
          details: { error: true },
          tenantId: this.tenantId,
          workspaceId: this.workspaceId,
        };
        records.push(errorRecord);
      }
    }

    return records;
  }

  /** Get compatibility history for a body version */
  async getBodyCompatibilityHistory(
    bodyVersionRef: string,
    options: {
      correlationId?: string;
    } = {},
  ): Promise<readonly CompatibilityRecord[]> {
    const correlationId = toCorrelationId(options.correlationId);
    return this.registry.getBodyCompatibilityHistory(bodyVersionRef);
  }

  /** Get compatibility history for a substrate */
  async getSubstrateCompatibilityHistory(
    substrateRef: string,
    options: {
      correlationId?: string;
    } = {},
  ): Promise<readonly CompatibilityRecord[]> {
    const correlationId = toCorrelationId(options.correlationId);
    return this.registry.getSubstrateCompatibilityHistory(substrateRef);
  }

  /** Get the latest compatibility record */
  async getLatestCompatibilityRecord(
    bodyVersionRef: string,
    substrateRef: string,
    options: {
      correlationId?: string;
    } = {},
  ): Promise<CompatibilityRecord | undefined> {
    const correlationId = toCorrelationId(options.correlationId);
    return this.registry.getLatestRecord(bodyVersionRef, substrateRef);
  }

  /** Get service statistics */
  async getStatistics(
    options: {
      correlationId?: string;
    } = {},
  ): Promise<{
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  }> {
    const correlationId = toCorrelationId(options.correlationId);
    
    const allRecords = this.registry.listRecords();
    const recordsByVerdict: Record<string, number> = {};
    const recordsByTenant: Record<string, number> = {};
    const recordsByWorkspace: Record<string, number> = {};

    for (const record of allRecords) {
      recordsByVerdict[record.verdict] = (recordsByVerdict[record.verdict] || 0) + 1;
      
      if (record.tenantId) {
        recordsByTenant[record.tenantId] = (recordsByTenant[record.tenantId] || 0) + 1;
      }
      
      if (record.workspaceId) {
        recordsByWorkspace[record.workspaceId] = (recordsByWorkspace[record.workspaceId] || 0) + 1;
      }
    }

    return {
      totalRecords: allRecords.length,
      recordsByVerdict,
      recordsByTenant,
      recordsByWorkspace,
    };
  }

  /** Helper to extract substrate reference */
  private getSubstrateRef(substrate: CognitiveSubstrate): string {
    return `${substrate.adapterId}:${substrate.modelFamily}:${substrate.modelId}:${substrate.modelRevision}`;
  }
}

/** Create a compatibility service */
export function createCompatibilityService(
  config: CompatibilityServiceConfig = {},
): CompatibilityService {
  return new CompatibilityServiceImpl(config);
}