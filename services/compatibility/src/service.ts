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
  type CompatibilityResult,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  type CompatibilityRecord
} from '@arena/compatibility';
import { 
  CompatibilityEngine, 
  createCompatibilityEngine
} from '@arena/compatibility';
import { 
  type SubstrateRegistry 
} from '@arena/model-substrate';
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
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<CompatibilityRecord>;

  /** Batch evaluate compatibility */
  batchEvaluateAndRecord(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<readonly CompatibilityRecord[]>;

  /** Get compatibility history */
  getHistory(
    bodyVersionRef?: string,
    substrateRef?: string,
    options?: {
      tenantId?: string;
      workspaceId?: string;
      from?: string;
      to?: string;
    }
  ): readonly CompatibilityRecord[];

  /** Get latest compatibility result */
  getLatest(
    bodyVersionRef: string,
    substrateRef: string
  ): CompatibilityRecord | undefined;

  /** Get service statistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
  };
}

/**
 * Create a compatibility service with the given configuration.
 */
export function createCompatibilityService(
  config: CompatibilityServiceConfig = {}
): CompatibilityService {
  const registry = config.registry ?? createCompatibilityRegistry();
  const engine = config.engine ?? createCompatibilityEngine(registry);
  const tenantId = config.tenantId;
  const workspaceId = config.workspaceId;

  return {
    async evaluateAndRecord(
      bodyProfile: SubstrateCompatibilityProfile,
      substrate: CognitiveSubstrate,
      options = {}
    ): Promise<CompatibilityRecord> {
      const { correlationId, idempotencyKey } = options;
      const correlation = toCorrelationId(correlationId);
      const idempotency = toIdempotencyKey(idempotencyKey);

      try {
        const result = await engine.evaluateAndRecord(bodyProfile, substrate, {
          evaluatedAt: new Date().toISOString(),
          tenantId: tenantId,
          workspaceId: workspaceId,
        });

        // Log the operation (would be replaced with actual logging)
        if (process.env.NODE_ENV !== 'test') {
          console.log(`[CompatibilityService] Evaluation completed: ${correlation}`, {
            verdict: result.verdict,
            bodyVersionRef: 'placeholder', // Would come from actual body
            substrateRef: substrate.integrity.contentDigest,
          });
        }

        return result;
      } catch (error) {
        console.error(`[CompatibilityService] Evaluation failed: ${correlation}`, error);
        throw error;
      }
    },

    async batchEvaluateAndRecord(
      bodyProfile: SubstrateCompatibilityProfile,
      substrates: readonly CognitiveSubstrate[],
      options = {}
    ): Promise<readonly CompatibilityRecord[]> {
      const { correlationId, idempotencyKey } = options;
      const correlation = toCorrelationId(correlationId);
      const idempotency = toIdempotencyKey(idempotencyKey);

      try {
        const results = await engine.batchEvaluateAndRecord(bodyProfile, substrates, {
          evaluatedAt: new Date().toISOString(),
          tenantId: tenantId,
          workspaceId: workspaceId,
        });

        // Log the operation
        if (process.env.NODE_ENV !== 'test') {
          console.log(`[CompatibilityService] Batch evaluation completed: ${correlation}`, {
            count: results.length,
            verdicts: results.map(r => r.verdict),
          });
        }

        return results;
      } catch (error) {
        console.error(`[CompatibilityService] Batch evaluation failed: ${correlation}`, error);
        throw error;
      }
    },

    getHistory(
      bodyVersionRef,
      substrateRef,
      options = {}
    ): readonly CompatibilityRecord[] {
      const { tenantId: queryTenantId, workspaceId: queryWorkspaceId, from, to } = options;
      const tenantId = queryTenantId ?? config.tenantId;
      const workspaceId = queryWorkspaceId ?? config.workspaceId;

      let records: CompatibilityRecord[] = [];

      // Filter by body version if specified
      if (bodyVersionRef) {
        records = [...registry.listRecordsByBody(bodyVersionRef)];
      }
      // Filter by substrate if specified
      else if (substrateRef) {
        records = [...registry.listRecordsBySubstrate(substrateRef)];
      }
      // Get all records
      else {
        records = [...registry.listRecords()];
      }

      // Apply tenant/workspace filtering
      if (tenantId) {
        records = records.filter(record => 
          'tenantId' in record && record.tenantId === tenantId
        );
      }

      if (workspaceId) {
        records = records.filter(record => 
          'workspaceId' in record && record.workspaceId === workspaceId
        );
      }

      // Apply time range filtering
      if (from || to) {
        records = registry.listRecordsByTimeRange({ 
          from: from as any, 
          to: to as any 
        }).filter(record =>
          records.some(r => r.recordDigest === record.recordDigest)
        );
      }

      return records;
    },

    getLatest(
      bodyVersionRef: string,
      substrateRef: string
    ): CompatibilityRecord | undefined {
      return registry.getLatestRecord(bodyVersionRef, substrateRef);
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
  };
}