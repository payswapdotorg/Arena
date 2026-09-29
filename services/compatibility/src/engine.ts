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
  CompatibilityResult 
} from '@arena/compatibility';
import { 
  CompatibilityRegistry 
} from './registry.js';
import { 
  SubstrateCompatibilityProfile,
  CognitiveSubstrate 
} from '@arena/agent-body';
import { CompatibilityError } from '@arena/compatibility';

/** Compatibility engine service options */
export interface CompatibilityEngineServiceOptions {
  /** Custom registry */
  registry?: CompatibilityRegistry;
  /** Custom engine */
  engine?: CompatibilityEngine;
}

/** Compatibility engine service interface */
export interface CompatibilityEngineService {
  /** Evaluate compatibility and create a record */
  evaluateAndRecord(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options: {
      evaluatedAt?: string;
      tenantId?: string;
      workspaceId?: string;
      parentDigest?: string;
    }
  ): Promise<import('@arena/compatibility').CompatibilityRecord>;

  /** Batch evaluate and record multiple substrates */
  batchEvaluateAndRecord(
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options: {
      evaluatedAt?: string;
      tenantId?: string;
      workspaceId?: string;
    }
  ): Promise<readonly import('@arena/compatibility').CompatibilityRecord[]>;

  /** Get compatibility history for a body version */
  getBodyHistory(bodyVersionRef: string): readonly import('@arena/compatibility').CompatibilityRecord[];

  /** Get compatibility history for a substrate */
  getSubstrateHistory(substrateRef: string): readonly import('@arena/compatibility').CompatibilityRecord[];

  /** Get latest compatibility result */
  getLatestCompatibility(bodyVersionRef: string, substrateRef: string): import('@arena/compatibility').CompatibilityRecord | undefined;

  /** Check if a substrate is compatible */
  isCompatible(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
  ): Promise<boolean>;

  /** Get the underlying engine */
  getEngine(): CompatibilityEngine;

  /** Get the underlying registry */
  getRegistry(): CompatibilityRegistry;
}

/** Create a compatibility engine service */
export function createCompatibilityEngineService(
  options: CompatibilityEngineServiceOptions = {}
): CompatibilityEngineService {
  const {
    registry,
    engine = createCompatibilityEngine(registry),
  } = options;

  return {
    async evaluateAndRecord(bodyProfile, substrate, options = {}) {
      try {
        return await engine.evaluateAndRecord(bodyProfile, substrate, options);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error;
        }
        throw new CompatibilityError('EVALUATION_ERROR', {
          message: 'compatibility evaluation failed',
          details: { error: error instanceof Error ? error.message : error },
        });
      }
    },

    async batchEvaluateAndRecord(bodyProfile, substrates, options = {}) {
      try {
        return await engine.batchEvaluateAndRecord(bodyProfile, substrates, options);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error;
        }
        throw new CompatibilityError('EVALUATION_ERROR', {
          message: 'batch compatibility evaluation failed',
          details: { error: error instanceof Error ? error.message : error },
        });
      }
    },

    getBodyHistory(bodyVersionRef) {
      return engine.registry.getBodyCompatibilityHistory(bodyVersionRef);
    },

    getSubstrateHistory(substrateRef) {
      return engine.registry.getSubstrateCompatibilityHistory(substrateRef);
    },

    getLatestCompatibility(bodyVersionRef, substrateRef) {
      return engine.registry.getLatestRecord(bodyVersionRef, substrateRef);
    },

    async isCompatible(bodyProfile, substrate) {
      try {
        return engine.isCompatible(bodyProfile, substrate);
      } catch (error) {
        if (error instanceof CompatibilityError) {
          throw error;
        }
        throw new CompatibilityError('EVALUATION_ERROR', {
          message: 'compatibility check failed',
          details: { error: error instanceof Error ? error.message : error },
        });
      }
    },

    getEngine() {
      return engine;
    },

    getRegistry() {
      return engine.registry;
    },
  };
}