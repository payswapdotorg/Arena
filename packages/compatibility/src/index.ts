/**
 * @arena/compatibility — Body/Substrate compatibility engine (Work Order A022;
 * requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Binds Body versions to compatible Cognitive Substrates and produces honest,
 * reproducible compatibility verdicts. Deterministic evaluation with closed
 * verdict vocabulary, append-only record lineage, tenant/workspace scoping.
 *
 * Core surface:
 *   - Compatibility evaluation over BodyVersion requirements × Substrate capabilities
 *   - Typed compatibility verdicts (compatible / incompatible-with-reasons / unknown-with-structured-causes)
 *   - Append-only CompatibilityRecord lineage
 *   - CompatibilityRegistry for record management
 *   - Tenant/workspace scoped queries
 *   - Deep-frozen records, fail-closed errors
 */

export * from './shared.js';
export * from './errors.js';
export * from './evaluator.js';
export * from './registry.js';

import { digestCanonical } from '@arena/protocol-core';
import { toContentDigest } from '@arena/agent-body';
import { COMPATIBILITY_ERROR_CODES } from './errors.js';
import {
  CompatibilityRegistry,
  createCompatibilityRegistry,
} from './registry.js';
import {
  evaluateBodySubstrateCompatibility,
  isCompatible,
} from './evaluator.js';
import type {
  SubstrateCompatibilityProfile,
  CognitiveSubstrate,
  CompatibilityRecord,
} from './shared.js';

/** Version of this package's protocol surface. */
export const COMPATIBILITY_PROTOCOL_VERSION = '1.0.0';

/** The compatibility error codes this build understands. */
export const SUPPORTED_COMPATIBILITY_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(COMPATIBILITY_ERROR_CODES),
);

/** The compatibility verdict vocabulary (closed, never scores). */
export const COMPATIBILITY_VERDICT_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  compatible: 'Body requirements fully satisfied by substrate capabilities',
  'incompatible-with-reasons': 'Body requirements not satisfied; specific reasons provided',
  'unknown-with-structured-causes': 'Evaluation inconclusive due to missing dependencies or test suites',
});

/** The compatibility record schema registry. */
export const COMPATIBILITY_SCHEMA_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  CompatibilityRecord: '1.0.0',
  CompatibilityResult: '1.0.0',
});

/** Options for one evaluation-and-record command. */
export interface EvaluateAndRecordOptions {
  /** Fixed evaluated-at (ISO-8601 UTC); defaults to the run clock. */
  readonly evaluatedAt?: string;
  /** Tenant scoping for the record (optional). */
  readonly tenantId?: string;
  /** Workspace scoping for the record (optional). */
  readonly workspaceId?: string;
  /** Parent record digest for lineage (optional). */
  readonly parentDigest?: string;
}

/**
 * CompatibilityEngine — the main compatibility evaluation orchestrator.
 * Combines evaluation logic with record management.
 */
export class CompatibilityEngine {
  readonly registry: CompatibilityRegistry;

  constructor(registry?: CompatibilityRegistry) {
    this.registry = registry ?? createCompatibilityRegistry();
  }

  /**
   * Evaluate compatibility and create a record.
   *
   * The record digest is the sha256 content digest over the canonical
   * serialization of the digest-free record view (content-addressed
   * lineage, reproducible for identical inputs).
   */
  async evaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    options: EvaluateAndRecordOptions = {},
  ): Promise<CompatibilityRecord> {
    const { evaluatedAt = new Date().toISOString(), tenantId, workspaceId, parentDigest } = options;

    // Evaluate compatibility
    const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

    // Build the digest-free record view and derive the content digest
    const view: Record<string, unknown> = {
      recordVersion: 1,
      bodyVersionRef,
      substrateRef: substrate.integrity.contentDigest,
      evaluatedAt,
      verdict: result.verdict,
      reasons: result.reasons,
      details: result.details,
      ...(parentDigest !== undefined ? { parentDigest } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
    const recordDigest = toContentDigest(await digestCanonical(view));

    const record: CompatibilityRecord = {
      recordVersion: 1,
      recordDigest,
      bodyVersionRef,
      substrateRef: substrate.integrity.contentDigest,
      evaluatedAt,
      verdict: result.verdict,
      reasons: result.reasons,
      details: result.details,
      ...(parentDigest !== undefined ? { parentDigest } : {}),
      ...(tenantId !== undefined ? { tenantId } : {}),
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };

    return this.registry.register(record);
  }

  /**
   * Batch evaluate and record multiple substrates.
   */
  async batchEvaluateAndRecord(
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly CognitiveSubstrate[],
    options: EvaluateAndRecordOptions = {},
  ): Promise<readonly CompatibilityRecord[]> {
    const { evaluatedAt, tenantId, workspaceId, parentDigest } = options;
    const records: CompatibilityRecord[] = [];

    for (const substrate of substrates) {
      const record = await this.evaluateAndRecord(bodyVersionRef, bodyProfile, substrate, {
        ...(evaluatedAt !== undefined ? { evaluatedAt } : {}),
        ...(tenantId !== undefined ? { tenantId } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
        ...(parentDigest !== undefined ? { parentDigest } : {}),
      });
      records.push(record);
    }

    return records;
  }

  /**
   * Get compatibility history for a body version.
   */
  getBodyHistory(bodyVersionRef: string): readonly CompatibilityRecord[] {
    return this.registry.getBodyCompatibilityHistory(bodyVersionRef);
  }

  /**
   * Get compatibility history for a substrate.
   */
  getSubstrateHistory(substrateRef: string): readonly CompatibilityRecord[] {
    return this.registry.getSubstrateCompatibilityHistory(substrateRef);
  }

  /**
   * Get latest compatibility result for a body/substrate pair.
   */
  getLatestCompatibility(bodyVersionRef: string, substrateRef: string): CompatibilityRecord | undefined {
    return this.registry.getLatestRecord(bodyVersionRef, substrateRef);
  }

  /**
   * Check if a substrate is compatible with a body profile.
   */
  async isCompatible(
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
  ): Promise<boolean> {
    return isCompatible(bodyProfile, substrate);
  }
}

/**
 * Create a fresh compatibility engine.
 */
export function createCompatibilityEngine(engineRegistry?: CompatibilityRegistry): CompatibilityEngine {
  return new CompatibilityEngine(engineRegistry);
}
