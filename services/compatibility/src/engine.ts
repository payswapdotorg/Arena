/**
 * @arena/compatibility-fabric — the A022 compatibility evaluation engine service
 * (Work Order A022; requirements R2, R20; spec AB1.0; architecture-lock rules 2, 3, 4).
 *
 * Service-layer evaluation wrapper: tenant/workspace scoping, error handling,
 * record persistence through the real @arena/compatibility evaluator + registry.
 */

import {
  CompatibilityRegistry,
  createCompatibilityRegistry,
  evaluateBodySubstrateCompatibility,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  type CompatibilityRecord,
  type CompatibilityResult,
} from '@arena/compatibility';
import { createHash } from 'node:crypto';

export interface CompatibilityEngineServiceOptions {
  readonly registry?: CompatibilityRegistry;
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

/** Deterministic content digest over the record's identity fields (sha256 hex — satisfies isContentDigest). */
function computeRecordDigest(
  bodyVersionRef: string,
  substrateRef: string,
  result: CompatibilityResult,
  evaluatedAt: string,
  parentDigest: string | undefined,
  tenantId: string | undefined,
  workspaceId: string | undefined,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      recordVersion: 1,
      bodyVersionRef,
      substrateRef,
      verdict: result.verdict,
      reasons: result.reasons,
      evaluatedAt,
      parentDigest: parentDigest ?? null,
      tenantId: tenantId ?? null,
      workspaceId: workspaceId ?? null,
    }))
    .digest('hex');
}

export class CompatibilityEngineService {
  private readonly registry: CompatibilityRegistry;
  private readonly tenantId: string | undefined;
  private readonly workspaceId: string | undefined;

  constructor(options: CompatibilityEngineServiceOptions = {}) {
    this.registry = options.registry ?? createCompatibilityRegistry();
    this.tenantId = options.tenantId;
    this.workspaceId = options.workspaceId;
  }

  /**
   * Evaluate compatibility between a body version and a substrate, recording the verdict.
   */
  async evaluateCompatibility(
    bodyVersionRef: string,
    substrateRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrate: CognitiveSubstrate,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<CompatibilityEvaluationResult> {
    try {
      const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);

      if (result.verdict === 'compatible') {
        const evaluatedAt = new Date().toISOString();
        const record: CompatibilityRecord = {
          recordVersion: 1,
          recordDigest: computeRecordDigest(
            bodyVersionRef,
            substrateRef,
            result,
            evaluatedAt,
            undefined,
            this.tenantId,
            this.workspaceId,
          ),
          bodyVersionRef,
          substrateRef,
          evaluatedAt,
          verdict: result.verdict,
          reasons: result.reasons,
          details: result.details,
          ...(this.tenantId !== undefined ? { tenantId: this.tenantId } : {}),
          ...(this.workspaceId !== undefined ? { workspaceId: this.workspaceId } : {}),
        };
        return { compatible: true, record: this.registry.register(record) };
      }
      return {
        compatible: false,
        error: result.reasons.join('; '),
      };
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
    bodyVersionRef: string,
    bodyProfile: SubstrateCompatibilityProfile,
    substrates: readonly {
      substrate: CognitiveSubstrate;
      substrateRef: string;
    }[],
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityEvaluationResult[]> {
    const results: CompatibilityEvaluationResult[] = [];

    for (const { substrate, substrateRef } of substrates) {
      const result = await this.evaluateCompatibility(
        bodyVersionRef,
        substrateRef,
        bodyProfile,
        substrate,
        _options,
      );
      results.push(result);
    }

    return results;
  }

  /**
   * Get compatibility history for a body version.
   */
  async getBodyCompatibilityHistory(
    bodyVersionRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityRecord[]> {
    return this.registry.listRecordsByBody(bodyVersionRef);
  }

  /**
   * Get compatibility history for a substrate.
   */
  async getSubstrateCompatibilityHistory(
    substrateRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<readonly CompatibilityRecord[]> {
    return this.registry.listRecordsBySubstrate(substrateRef);
  }

  /**
   * Get the latest compatibility record for a body/substrate pair.
   */
  async getLatestCompatibilityRecord(
    bodyVersionRef: string,
    substrateRef: string,
    _options: CompatibilityEvaluationOptions = {},
  ): Promise<CompatibilityRecord | undefined> {
    return this.registry.getLatestRecord(bodyVersionRef, substrateRef);
  }
}
