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
  type CompatibilityRecord,
  type EvaluateAndRecordOptions
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
      bodyVersionRef: string,
      bodyProfile: SubstrateCompatibilityProfile,
      substrate: CognitiveSubstrate,
      options = {}
    ): Promise<CompatibilityRecord> {
      const { correlationId, idempotencyKey } = options;
      
      try {
        const options: EvaluateAndRecordOptions = {
          evaluatedAt: new Date().toISOString(),
          ...(tenantId !== undefined ? { tenantId } : {}),
          ...(workspaceId !== undefined ? { workspaceId } : {}),
        };

        const result = await engine.evaluateAndRecord(
          bodyVersionRef,
          bodyProfile,
          substrate,
          options
        );

        // Log the operation (would be replaced with actual logging)
        if (process.env.NODE_ENV !== 'test') {
          const correlation = correlationId ? toCorrelationId(correlationId) : undefined;
          const idempotency = idempotencyKey ? toIdempotencyKey(idempotencyKey) : undefined;
          
          console.log(`[CompatibilityService] Evaluation completed: ${correlation}`, {
            verdict: result.verdict,
            bodyVersionRef: bodyVersionRef,
            substrateRef: substrate.integrity.contentDigest,
          });
        }

        return result;
      } catch (error) {
        const correlation = correlationId ? toCorrelationId(correlationId) : undefined;
        console.error(`[CompatibilityService] Evaluation failed: ${correlation}`, error);
        throw error;
      }
    },

    async batchEvaluateAndRecord(
      bodyVersionRef: string,
      bodyProfile: SubstrateCompatibilityProfile,
      substrates: readonly CognitiveSubstrate[],
      options = {}
    ): Promise<readonly CompatibilityRecord[]> {
      const { correlationId, idempotencyKey } = options;

      try {
        const records: CompatibilityRecord[] = [];

        for (const substrate of substrates) {
          const options: EvaluateAndRecordOptions = {
            evaluatedAt: new Date().toISOString(),
            ...(tenantId !== undefined ? { tenantId } : {}),
            ...(workspaceId !== undefined ? { workspaceId } : {}),
          };

          const record = await engine.evaluateAndRecord(
            bodyVersionRef,
            bodyProfile,
            substrate,
            options
          );
          records.push(record);
        }

        // Log the operation (would be replaced with actual logging)
        if (process.env.NODE_ENV !== 'test') {
          const correlation = correlationId ? toCorrelationId(correlationId) : undefined;
          const idempotency = idempotencyKey ? toIdempotencyKey(idempotencyKey) : undefined;
          
          console.log(`[CompatibilityService] Batch evaluation completed: ${correlation}`, {
            count: records.length,
            bodyVersionRef: bodyVersionRef,
          });
        }

        return records;
      } catch (error) {
        const correlation = correlationId ? toCorrelationId(correlationId) : undefined;
        console.error(`[CompatibilityService] Batch evaluation failed: ${correlation}`, error);
        throw error;
      }
    },

    getHistory(
      bodyVersionRef?: string,
      substrateRef?: string,
      options = {}
    ): readonly CompatibilityRecord[] {
      const { tenantId, workspaceId, from, to } = options;
      
      let records = registry.listRecords();

      // Filter by body version
      if (bodyVersionRef) {
        records = records.filter(record => record.bodyVersionRef === bodyVersionRef);
      }

      // Filter by substrate ref
      if (substrateRef) {
        records = records.filter(record => record.substrateRef === substrateRef);
      }

      // Filter by tenant
      if (tenantId) {
        records = records.filter(record => record.tenantId === tenantId);
      }

      // Filter by workspace
      if (workspaceId) {
        records = records.filter(record => record.workspaceId === workspaceId);
      }

      // Filter by time range
      if (from || to) {
        const range: { from?: string; to?: string } = {};
        if (from) range.from = from;
        if (to) range.to = to;
        records = registry.listRecordsByTimeRange(range);
      }

      return records;
    },

    getLatest(
      bodyVersionRef: string,
      substrateRef: string
    ): CompatibilityRecord | undefined {
      return registry.getLatestRecord(bodyVersionRef, substrateRef);
    },

    getStats(): {
      totalRecords: number;
      recordsByVerdict: Record<string, number>;
    } {
      const totalRecords = registry.getRecordCount();
      const recordsByVerdict: Record<string, number> = {};

      // Count records by verdict
      registry.listRecords().forEach(record => {
        recordsByVerdict[record.verdict] = (recordsByVerdict[record.verdict] || 0) + 1;
      });

      return {
        totalRecords,
        recordsByVerdict,
      };
    },
  };
}