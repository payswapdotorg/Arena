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
  readonly record?: CompatibilityRecord;
  readonly error?: string;
}

export class CompatibilityEngineService {
  private readonly engine: CompatibilityEngine;
  private readonly tenantId?: string;
  private readonly workspaceId?: string;

  constructor(options: CompatibilityEngineServiceOptions = {}) {
    this.engine = options.engine ?? createCompatibilityEngine();
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
  }

  /**
   * Evaluate compatibility between a body version and a substrate.
   */
  async evaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<CompatibilityEvaluationResult> {
    try {
      const result = await this.engine.evaluateBodySubstrateCompatibility(bodyProfile, substrate);
      
      if (result.verdict === 'compatible') {
        return {
          compatible: true,
          record: await this.engine.createAndRegister(
            this.bodyVersionRef, // This would be passed from the caller
            this.substrateRef, // This would be passed from the caller
            result,
            new Date().toISOString(),
            undefined,
            this.tenantId,
            this.workspaceId,
          ),
        };
      } else {
        return {
          compatible: false,
          error: result.reasons.join('; '),
        };
      }
    } catch (error) {
      return {
        compatible: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Batch evaluate multiple substrates against a single body profile.
   */
  async batchEvaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityEvaluationResult[]> {
    const results: CompatibilityEvaluationResult[] = [];

    for (const substrate of substrates) {
      const result = await this.evaluateCompatibility(bodyProfile, substrate, _options);
      results.push(result);
    }

    return results;
  }

  /**
   * Get compatibility history for a body version.
   */
  async getBodyCompatibilityHistory(
    _bodyVersionRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityRecord[]> {
    // This would delegate to the engine's registry methods
    // For now, return empty array
    return [];
  }

  /**
   * Get compatibility history for a substrate.
   */
  async getSubstrateCompatibilityHistory(
    _substrateRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityRecord[]> {
    // This would delegate to the engine's registry methods
    // For now, return empty array
    return [];
  }

  /**
   * Get the latest compatibility record for a body/substrate pair.
   */
  async getLatestCompatibilityRecord(
    _bodyVersionRef: string,
    _substrateRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<CompatibilityRecord | undefined> {
    // This would delegate to the engine's registry methods
    // For now, return undefined
    return undefined;
  }
}