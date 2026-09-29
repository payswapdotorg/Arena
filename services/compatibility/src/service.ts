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
  evaluateBodySubstrateCompatibility,
  type SubstrateCompatibilityProfile,
  type CognitiveSubstrate,
  type CompatibilityRecord,
  type CompatibilityResult,
} from '@arena/compatibility';
import {
  toIdempotencyKey
} from '@arena/protocol-core';
import { createHash } from 'node:crypto';

/** Service configuration */
export interface CompatibilityServiceConfig {
  readonly registry?: CompatibilityRegistry;
  readonly tenantId?: string;
  readonly workspaceId?: string;
}

/** History query filter */
export interface CompatibilityHistoryFilter {
  readonly bodyVersionRef?: string;
  readonly substrateRef?: string;
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

  /** Get compatibility history (optionally filtered by body version or substrate) */
  getHistory(filter?: CompatibilityHistoryFilter): readonly CompatibilityRecord[];

  /** Get compatibility history for a body version */
  getBodyCompatibilityHistory(
    bodyVersionRef: string,
    options?: {
      correlationId?: string;
    }
  ): readonly CompatibilityRecord[];

  /** Get compatibility history for a substrate */
  getSubstrateCompatibilityHistory(
    substrateRef: string,
    options?: {
      correlationId?: string;
    }
  ): readonly CompatibilityRecord[];

  /** Get the latest compatibility record for a body/substrate pair */
  getLatestCompatibilityRecord(
    bodyVersionRef: string,
    substrateRef: string,
    options?: {
      correlationId?: string;
    }
  ): CompatibilityRecord | undefined;

  /** Alias for getLatestCompatibilityRecord */
  getLatest(
    bodyVersionRef: string,
    substrateRef: string,
  ): CompatibilityRecord | undefined;

  /** Get service statistics */
  getStatistics(options?: {
    correlationId?: string;
  }): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  };

  /** Alias for getStatistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  };
}

/** Deterministic content digest over the record's identity fields (sha256 hex — satisfies isContentDigest). */
function computeRecordDigest(
  bodyVersionRef: string,
  substrateRef: string,
  result: CompatibilityResult,
  evaluatedAt: string,
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
      tenantId: tenantId ?? null,
      workspaceId: workspaceId ?? null,
    }))
    .digest('hex');
}

/** Compatibility service implementation */
export class CompatibilityServiceImpl implements CompatibilityService {
  private readonly registry: CompatibilityRegistry;
  private readonly tenantId: string | undefined;
  private readonly workspaceId: string | undefined;

  constructor(config: CompatibilityServiceConfig = {}) {
    this.registry = config.registry ?? createCompatibilityRegistry();
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
    // Fail-closed idempotency-key validation when one is provided
    if (options.idempotencyKey !== undefined) {
      toIdempotencyKey(options.idempotencyKey);
    }

    try {
      const result = await evaluateBodySubstrateCompatibility(bodyProfile, substrate);
      const evaluatedAt = new Date().toISOString();
      const substrateRef = this.getSubstrateRef(substrate);

      const record: CompatibilityRecord = {
        recordVersion: 1,
        recordDigest: computeRecordDigest(
          bodyVersionRef,
          substrateRef,
          result,
          evaluatedAt,
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
      return this.registry.register(record);
    } catch (error) {
      throw new Error(`Compatibility evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {
        cause: error,
      });
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
    if (options.idempotencyKey !== undefined) {
      toIdempotencyKey(options.idempotencyKey);
    }

    const records: CompatibilityRecord[] = [];

    for (const substrate of substrates) {
      try {
        const record = await this.evaluateAndRecord(
          bodyVersionRef,
          bodyProfile,
          substrate,
          { ...(options.correlationId !== undefined ? { correlationId: options.correlationId } : {}) },
        );
        records.push(record);
      } catch (error) {
        // Record the failure as an incompatible verdict (fail-closed, never silently dropped)
        const evaluatedAt = new Date().toISOString();
        const substrateRef = this.getSubstrateRef(substrate);
        const failureResult: CompatibilityResult = {
          verdict: 'incompatible-with-reasons',
          reasons: [error instanceof Error ? error.message : 'Unknown error'],
          details: { error: true },
        };
        const record: CompatibilityRecord = {
          recordVersion: 1,
          recordDigest: computeRecordDigest(
            bodyVersionRef,
            substrateRef,
            failureResult,
            evaluatedAt,
            this.tenantId,
            this.workspaceId,
          ),
          bodyVersionRef,
          substrateRef,
          evaluatedAt,
          verdict: failureResult.verdict,
          reasons: failureResult.reasons,
          details: failureResult.details,
          ...(this.tenantId !== undefined ? { tenantId: this.tenantId } : {}),
          ...(this.workspaceId !== undefined ? { workspaceId: this.workspaceId } : {}),
        };
        records.push(record);
      }
    }

    return records;
  }

  /** Get compatibility history (optionally filtered) */
  getHistory(filter: CompatibilityHistoryFilter = {}): readonly CompatibilityRecord[] {
    let records: readonly CompatibilityRecord[] = this.registry.listRecords();
    if (filter.bodyVersionRef !== undefined) {
      records = records.filter((record) => record.bodyVersionRef === filter.bodyVersionRef);
    }
    if (filter.substrateRef !== undefined) {
      records = records.filter((record) => record.substrateRef === filter.substrateRef);
    }
    return records;
  }

  /** Get compatibility history for a body version */
  getBodyCompatibilityHistory(
    bodyVersionRef: string,
    _options: {
      correlationId?: string;
    } = {},
  ): readonly CompatibilityRecord[] {
    return this.registry.listRecordsByBody(bodyVersionRef);
  }

  /** Get compatibility history for a substrate */
  getSubstrateCompatibilityHistory(
    substrateRef: string,
    _options: {
      correlationId?: string;
    } = {},
  ): readonly CompatibilityRecord[] {
    return this.registry.listRecordsBySubstrate(substrateRef);
  }

  /** Get the latest compatibility record */
  getLatestCompatibilityRecord(
    bodyVersionRef: string,
    substrateRef: string,
    _options: {
      correlationId?: string;
    } = {},
  ): CompatibilityRecord | undefined {
    return this.registry.getLatestRecord(bodyVersionRef, substrateRef);
  }

  /** Alias for getLatestCompatibilityRecord */
  getLatest(
    bodyVersionRef: string,
    substrateRef: string,
  ): CompatibilityRecord | undefined {
    return this.getLatestCompatibilityRecord(bodyVersionRef, substrateRef);
  }

  /** Get service statistics */
  getStatistics(
    _options: {
      correlationId?: string;
    } = {},
  ): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  } {
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

  /** Alias for getStatistics */
  getStats(): {
    totalRecords: number;
    recordsByVerdict: Record<string, number>;
    recordsByTenant: Record<string, number>;
    recordsByWorkspace: Record<string, number>;
  } {
    return this.getStatistics();
  }

  /** The substrate reference is the substrate's content digest (content-addressed identity) */
  private getSubstrateRef(substrate: CognitiveSubstrate): string {
    return substrate.integrity.contentDigest;
  }
}

/** Create a compatibility service */
export function createCompatibilityService(
  config: CompatibilityServiceConfig = {},
): CompatibilityService {
  return new CompatibilityServiceImpl(config);
}
