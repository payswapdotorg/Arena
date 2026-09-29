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
  createCompatibilityRegistry 
} from './registry.js';
import { 
  CompatibilityEngine, 
  createCompatibilityEngine,
  CompatibilityResult 
} from './engine.js';
import { 
  SubstrateCompatibilityProfile,
  CognitiveSubstrate 
} from '@arena/agent-body';
import { 
  SubstrateRegistry 
} from '@arena/model-substrate';
import { 
  toCorrelationId, 
  toIdempotencyKey 
} from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';

/** Compatibility service options */
export interface CompatibilityServiceOptions {
  /** Custom registry (creates fresh if not provided) */
  registry?: CompatibilityRegistry;
  /** Custom engine (creates fresh if not provided) */
  engine?: CompatibilityEngine;
  /** Substrate registry for capability validation */
  substrateRegistry?: SubstrateRegistry;
}

/** Compatibility service interface */
export interface CompatibilityService {
  /** Evaluate compatibility and create a record */
  evaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options: {
      correlationId: string;
      idempotencyKey: string;
      tenantId?: string;
      workspaceId?: string;
      parentDigest?: string;
    }
  ): Promise<import('../packages/compatibility/src/shared.js').CompatibilityRecord>;

  /** Batch evaluate compatibility for multiple substrates */
  batchEvaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options: {
      correlationId: string;
      idempotencyKey: string;
      tenantId?: string;
      workspaceId?: string;
    }
  ): Promise<readonly import('../packages/compatibility/src/shared.js').CompatibilityRecord[]>;

  /** Get compatibility history for a body version */
  getBodyHistory(
    bodyVersionRef: string,
    tenantId?: string,
    workspaceId?: string
  ): Promise<readonly import('../packages/compatibility/src/shared.js').CompatibilityRecord[]>;

  /** Get compatibility history for a substrate */
  getSubstrateHistory(
    substrateRef: string,
    tenantId?: string,
    workspaceId?: string
  ): Promise<readonly import('../packages/compatibility/src/shared.js').CompatibilityRecord[]>;

  /** Get latest compatibility result */
  getLatestCompatibility(
    bodyVersionRef: string,
    substrateRef: string,
    tenantId?: string,
    workspaceId?: string
  ): Promise<import('../packages/compatibility/src/shared.js').CompatibilityRecord | undefined>;

  /** Check if a substrate is compatible */
  checkCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    correlationId: string
  ): Promise<boolean>;

  /** Get service statistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    registry: CompatibilityRegistry;
  };
}

/** Create a compatibility service */
export function createCompatibilityService(
  options: CompatibilityServiceOptions = {}
): CompatibilityService {
  const {
    registry = createCompatibilityRegistry(),
    engine = createCompatibilityEngine(registry),
    substrateRegistry,
  } = options;

  return {
    async evaluateCompatibility(
      bodyProfile,
      substrate,
      { correlationId, idempotencyKey, tenantId, workspaceId, parentDigest }
    ) {
      // Validate correlation and idempotency keys
      const correlation: CorrelationId = toCorrelationId(correlationId);
      const idempotency: IdempotencyKey = toIdempotencyKey(idempotencyKey);

      // Evaluate compatibility
      const result = await engine.evaluateAndRecord(
        bodyProfile,
        substrate,
        {
          evaluatedAt: new Date().toISOString(),
          tenantId,
          workspaceId,
          parentDigest,
        }
      );

      return result;
    },

    async batchEvaluateCompatibility(
      bodyProfile,
      substrates,
      { correlationId, idempotencyKey, tenantId, workspaceId }
    ) {
      // Validate correlation and idempotency keys
      const correlation: CorrelationId = toCorrelationId(correlationId);
      const idempotency: IdempotencyKey = toIdempotencyKey(idempotencyKey);

      // Batch evaluate compatibility
      const records = await engine.batchEvaluateAndRecord(
        bodyProfile,
        substrates,
        {
          evaluatedAt: new Date().toISOString(),
          tenantId,
          workspaceId,
        }
      );

      return records;
    },

    async getBodyHistory(bodyVersionRef, tenantId, workspaceId) {
      let records = registry.listRecordsByBody(bodyVersionRef);

      // Filter by tenant if provided
      if (tenantId !== undefined) {
        records = records.filter(record => (record as any).tenantId === tenantId);
      }

      // Filter by workspace if provided
      if (workspaceId !== undefined) {
        records = records.filter(record => (record as any).workspaceId === workspaceId);
      }

      return records;
    },

    async getSubstrateHistory(substrateRef, tenantId, workspaceId) {
      let records = registry.listRecordsBySubstrate(substrateRef);

      // Filter by tenant if provided
      if (tenantId !== undefined) {
        records = records.filter(record => (record as any).tenantId === tenantId);
      }

      // Filter by workspace if provided
      if (workspaceId !== undefined) {
        records = records.filter(record => (record as any).workspaceId === workspaceId);
      }

      return records;
    },

    async getLatestCompatibility(bodyVersionRef, substrateRef, tenantId, workspaceId) {
      let records = registry.listRecordsByBody(bodyVersionRef).filter(
        record => record.substrateRef === substrateRef
      );

      // Filter by tenant if provided
      if (tenantId !== undefined) {
        records = records.filter(record => (record as any).tenantId === tenantId);
      }

      // Filter by workspace if provided
      if (workspaceId !== undefined) {
        records = records.filter(record => (record as any).workspaceId === workspaceId);
      }

      // Return the most recent record
      if (records.length === 0) return undefined;
      return records[records.length - 1];
    },

    async checkCompatibility(bodyProfile, substrate, correlationId) {
      const correlation: CorrelationId = toCorrelationId(correlationId);
      return engine.isCompatible(bodyProfile, substrate);
    },

    getStats() {
      const records = registry.listRecords();
      const recordsByVerdict = records.reduce((acc, record) => {
        acc[record.verdict] = (acc[record.verdict] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return {
        totalRecords: records.length,
        recordsByVerdict,
        registry,
      };
    },
  };
}