/**
 * @arena/compatibility-fabric — compatibility engine service wrapper
 * (Work Order A022; requirements R2, R20; spec AB1.0).
 *
 * Wraps the core compatibility engine with service-layer features:
 * - Registry integration
 * - Error handling
 * - Tenant/workspace scoping
 * - Correlation and idempotency
 */

import { 
  CompatibilityEngine, 
  createCompatibilityEngine,
  type CompatibilityResult,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  CompatibilityError,
  type CompatibilityErrorCode,
  type CompatibilityRecord
} from '@arena/compatibility';
import { 
  type ServiceCompatibilityRegistry 
} from './registry.js';

/** Compatibility engine service options */
export interface CompatibilityEngineServiceOptions {
  /** Custom registry */
  registry?: ServiceCompatibilityRegistry;
  /** Custom engine */
  engine?: CompatibilityEngine;
  /** Tenant ID */
  tenantId?: string;
  /** Workspace ID */
  workspaceId?: string;
}

/**
 * Compatibility engine service with enhanced error handling and logging.
 */
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
   * Evaluate compatibility with enhanced error handling.
   */
  async evaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<boolean> {
    try {
      return await this.engine.isCompatible(bodyProfile, substrate);
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw error; // Re-throw known errors
      }
      
      // Wrap unknown errors
      throw new CompatibilityError('EVALUATION_ERROR' as CompatibilityErrorCode, {
        message: 'Compatibility evaluation failed',
        details: { 
          originalError: error instanceof Error ? error.message : 'Unknown error',
          bodyProfile: {
            requiredModalities: bodyProfile.requiredModalities,
            requiredToolCalling: bodyProfile.requiredToolCalling,
          },
          substrate: {
            modelFamily: substrate.modelFamily,
            modelId: substrate.modelId,
            modalityProfile: substrate.modalityProfile,
          },
        },
      });
    }
  }

  /**
   * Evaluate compatibility and create a record.
   */
  async evaluateAndRecord(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<CompatibilityRecord> {
    try {
      const result = await this.engine.evaluateAndRecord(bodyProfile, substrate, {
        evaluatedAt: new Date().toISOString(),
        tenantId: this.tenantId,
        workspaceId: this.workspaceId,
      });

      return result;
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw error; // Re-throw known errors
      }
      
      // Wrap unknown errors
      throw new CompatibilityError('EVALUATION_ERROR' as CompatibilityErrorCode, {
        message: 'Compatibility evaluation and record creation failed',
        details: { 
          originalError: error instanceof Error ? error.message : 'Unknown error',
          bodyProfile: {
            requiredModalities: bodyProfile.requiredModalities,
            requiredToolCalling: bodyProfile.requiredToolCalling,
          },
          substrate: {
            modelFamily: substrate.modelFamily,
            modelId: substrate.modelId,
            modalityProfile: substrate.modalityProfile,
          },
        },
      });
    }
  }

  /**
   * Batch evaluate compatibility.
   */
  async batchEvaluateCompatibility(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<readonly boolean[]> {
    try {
      return await Promise.all(
        substrates.map(substrate => 
          this.evaluateCompatibility(bodyProfile, substrate, options)
        )
      );
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw error; // Re-throw known errors
      }
      
      // Wrap unknown errors
      throw new CompatibilityError('EVALUATION_ERROR' as CompatibilityErrorCode, {
        message: 'Batch compatibility evaluation failed',
        details: { 
          originalError: error instanceof Error ? error.message : 'Unknown error',
          substrateCount: substrates.length,
        },
      });
    }
  }

  /**
   * Batch evaluate compatibility and create records.
   */
  async batchEvaluateAndRecord(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options?: {
      correlationId?: string;
      idempotencyKey?: string;
    }
  ): Promise<readonly CompatibilityRecord[]> {
    try {
      return await this.engine.batchEvaluateAndRecord(bodyProfile, substrates, {
        evaluatedAt: new Date().toISOString(),
        tenantId: this.tenantId,
        workspaceId: this.workspaceId,
      });
    } catch (error) {
      if (error instanceof CompatibilityError) {
        throw error; // Re-throw known errors
      }
      
      // Wrap unknown errors
      throw new CompatibilityError('EVALUATION_ERROR' as CompatibilityErrorCode, {
        message: 'Batch compatibility evaluation and record creation failed',
        details: { 
          originalError: error instanceof Error ? error.message : 'Unknown error',
          substrateCount: substrates.length,
        },
      });
    }
  }

  /**
   * Get compatibility history for a body version.
   */
  getBodyHistory(bodyVersionRef: string): readonly CompatibilityRecord[] {
    return this.engine.getBodyHistory(bodyVersionRef);
  }

  /**
   * Get compatibility history for a substrate.
   */
  getSubstrateHistory(substrateRef: string): readonly CompatibilityRecord[] {
    return this.engine.getSubstrateHistory(substrateRef);
  }

  /**
   * Get latest compatibility result.
   */
  getLatestCompatibility(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined {
    return this.engine.getLatestCompatibility(bodyVersionRef, substrateRef);
  }
}

/**
 * Create a compatibility engine service.
 */
export function createCompatibilityEngineService(
  options: CompatibilityEngineServiceOptions = {}
): CompatibilityEngineService {
  return new CompatibilityEngineService(options);
}