/**
 * @arena/compatibility-fabric — the A022 compatibility evaluation engine
 * (Work Order A022; requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Enhanced compatibility engine with tenant/workspace scoping and error handling.
 * Wraps the core @arena/compatibility engine with service-layer features.
 */

import {
  CompatibilityEngine,
  createCompatibilityEngine,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  type CompatibilityResult,
  type CompatibilityRecord,
} from '@arena/compatibility';

export interface CompatibilityEngineServiceOptions {
  readonly engine?: CompatibilityEngine;
  readonly tenantId?: string;
  readonly workspaceId?: string;
}

export interface CompatibilityEvaluationOptions {
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface CompatibilityEvaluationResult {
  readonly compatible: boolean;
  readonly verdict?: string;
  readonly reasons?: readonly string[];
  readonly details?: Record<string, unknown>;
  readonly record?: CompatibilityRecord;
}

/**
 * Compatibility evaluation engine with service-layer features.
 */
export class CompatibilityEngineService {
  private readonly engine: CompatibilityEngine;
  private readonly tenantId: string | undefined;
  private readonly workspaceId: string | undefined;

  constructor(options: CompatibilityEngineServiceOptions = {}) {
    this.engine = options.engine ?? createCompatibilityEngine();
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
  }

  /**
   * Evaluate compatibility with enhanced error handling.
   */
  async evaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options?: CompatibilityEvaluationOptions,
  ): Promise<CompatibilityEvaluationResult> {
    try {
      const compatible = await this.engine.isCompatible(bodyProfile, substrate);
      return {
        compatible,
        verdict: compatible ? 'compatible' : 'incompatible-with-reasons',
      };
    } catch (error) {
      return {
        compatible: false,
        verdict: 'incompatible-with-reasons',
        reasons: error instanceof Error ? [error.message] : ['Unknown error'],
      };
    }
  }

  /**
   * Evaluate compatibility and create a record.
   */
  async evaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options: {
      evaluatedAt: string;
      tenantId?: string;
      workspaceId?: string;
      parentDigest?: string;
    },
  ): Promise<CompatibilityRecord> {
    return this.engine.evaluateAndRecord(
      bodyVersionRef,
      bodyProfile,
      substrate,
      options,
    );
  }

  /**
   * Batch evaluate compatibility.
   */
  async batchEvaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options: {
      evaluatedAt: string;
      tenantId?: string;
      workspaceId?: string;
      parentDigest?: string;
    },
  ): Promise<readonly CompatibilityRecord[]> {
    const records: CompatibilityRecord[] = [];

    for (const substrate of substrates) {
      const record = await this.engine.evaluateAndRecord(
        bodyVersionRef,
        bodyProfile,
        substrate,
        options,
      );
      records.push(record);
    }

    return records;
  }

  /**
   * Get compatibility history.
   */
  getHistory(options?: {
    bodyVersionRef?: string;
    substrateRef?: string;
    tenantId?: string;
    workspaceId?: string;
    from?: string;
    to?: string;
  }): readonly CompatibilityRecord[] {
    // This would delegate to a registry in a full implementation
    // For now, return empty array
    return [];
  }

  /**
   * Get latest compatibility result.
   */
  getLatest(
    bodyVersionRef: string,
    substrateRef: string,
  ): CompatibilityRecord | undefined {
    // This would delegate to a registry in a full implementation
    // For now, return undefined
    return undefined;
  }

  /**
   * Get service statistics.
   */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
  } {
    // This would query a registry in a full implementation
    // For now, return empty stats
    return {
      totalRecords: 0,
      recordsByVerdict: {},
    };
  }
}