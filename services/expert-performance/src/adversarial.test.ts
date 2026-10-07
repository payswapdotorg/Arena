/**
 * Adversarial minimum (Work Order C005): evidence replay/duplication
 * inflating a dimension, provenance tampering (fabricated + cross-tenant
 * source digests), cross-tenant profile reads, and the single-score
 * smuggling attempt through the aggregate endpoint / wire boundary.
 */

import { describe, expect, it } from 'vitest';
import { toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  EXPERT_PERFORMANCE_ERROR_CODES,
  ExpertPerformanceError,
  consumeProfileAsGlobalScore,
  makeGetDimensionAggregateQuery,
} from '@arena/expert-performance';
import { ExpertPerformanceService, fakeSourcePorts } from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CAPABILITY = Object.freeze({
  kind: 'skill',
  id: 'rust-code-review',
  version: '1.0.0',
  digest: DIGEST_A,
});
const AT = '2026-10-01T00:00:00.000Z';

function seededService() {
  const fakes = fakeSourcePorts();
  fakes.skillExtraction
    .add('tenant-1', 'expert-1', {
      skill: CAPABILITY,
      outcome: 'demonstrated',
      consistency: 'stable',
      sampleSize: 5,
      observedAt: '2026-09-18T00:00:00.000Z',
      recordDigest: DIGEST_A,
    })
    .add('tenant-1', 'expert-1', {
      skill: CAPABILITY,
      outcome: 'demonstrated',
      consistency: 'stable',
      sampleSize: 5,
      observedAt: '2026-09-19T00:00:00.000Z',
      recordDigest: DIGEST_B,
    })
    .add('tenant-2', 'expert-2', {
      skill: CAPABILITY,
      outcome: 'demonstrated',
      consistency: 'stable',
      sampleSize: 5,
      observedAt: '2026-09-19T00:00:00.000Z',
      recordDigest: DIGEST_B,
    });
  return { service: new ExpertPerformanceService(fakes.ports), fakes };
}

const OPTIONS = { correlationId: 'corr-1', idempotencyKey: toIdempotencyKey('key-1'), at: AT };

describe('evidence replay / duplication inflating a dimension', () => {
  it('rejects booking the SAME source digest twice into one dimension', async () => {
    const { service } = seededService();
    await service.appendEvidence(
      { recordId: 'perf-001', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    await expect(
      service.appendEvidence(
        { recordId: 'perf-002', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
      ),
    ).rejects.toThrow(ExpertPerformanceError);
    try {
      await service.appendEvidence(
        { recordId: 'perf-002', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
        { ...OPTIONS, idempotencyKey: toIdempotencyKey('key-2') },
      );
      expect.unreachable('duplicate evidence must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.DUPLICATE_EVIDENCE,
      );
    }
    const { profile } = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-2', at: AT },
    );
    expect(profile.dimensions['skill-competency'].recordCount).toBe(1);
    expect(profile.dimensions['skill-competency'].totalSampleSize).toBe(5);
  });

  it('the idempotency replay does NOT inflate counts (same key, same payload)', async () => {
    const { service } = seededService();
    await service.appendEvidence(
      { recordId: 'perf-010', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    for (let index = 0; index < 5; index += 1) {
      const replay = await service.appendEvidence(
        { recordId: 'perf-010', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
        OPTIONS,
      );
      expect(replay.replayed).toBe(true);
    }
    const { profile } = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-3', at: AT },
    );
    expect(profile.dimensions['skill-competency'].recordCount).toBe(1);
    expect(service.recordCount()).toBe(1);
  });
});

describe('provenance tampering', () => {
  it('rejects evidence whose source digest no dep port resolves (fabricated provenance)', async () => {
    const { service } = seededService();
    const fabricated = 'f'.repeat(64);
    await expect(
      service.appendEvidence(
        { recordId: 'perf-020', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: fabricated },
        OPTIONS,
      ),
    ).rejects.toThrow(ExpertPerformanceError);
    try {
      await service.appendEvidence(
        { recordId: 'perf-020', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: fabricated },
        OPTIONS,
      );
      expect.unreachable('fabricated provenance must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.PORT_FAILURE,
      );
    }
  });

  it('rejects evidence claiming ANOTHER tenant/expert source digest (cross-tenant provenance)', async () => {
    const { service } = seededService();
    // DIGEST_B exists in the A019 fake, but owned by (tenant-2/expert-2).
    await expect(
      service.appendEvidence(
        { recordId: 'perf-021', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_B },
        OPTIONS,
      ),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('rejects a source ref digest claimed under the WRONG dep family', async () => {
    const { service } = seededService();
    await expect(
      service.appendEvidence(
        { recordId: 'perf-022', tenant: 'tenant-1', expertId: 'expert-1', family: 'expert-match-history', dimension: 'task-family-outcome', refDigest: DIGEST_A },
        OPTIONS,
      ),
    ).rejects.toThrow(ExpertPerformanceError);
  });
});

describe('cross-tenant profile reads', () => {
  it('fails closed on cross-tenant record reads (lock rule 11)', async () => {
    const { service } = seededService();
    await service.appendEvidence(
      { recordId: 'perf-030', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    try {
      await service.getEvidenceRecord({ tenant: 'tenant-2', recordId: 'perf-030' }, { correlationId: 'corr-4' });
      expect.unreachable('cross-tenant record reads must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.TENANT_MISMATCH,
      );
    }
  });

  it('a tenant lens NEVER folds another tenant\'s records (empty profile, no leak)', async () => {
    const { service } = seededService();
    await service.appendEvidence(
      { recordId: 'perf-031', tenant: 'tenant-1', expertId: 'expert-1', family: 'skill-extraction-outcome', dimension: 'skill-competency', refDigest: DIGEST_A },
      OPTIONS,
    );
    const { profile } = await service.getRoutingInput(
      { tenant: 'tenant-2', expertId: 'expert-1' },
      { correlationId: 'corr-5', at: AT },
    );
    expect(profile.dimensions['skill-competency'].recordCount).toBe(0);
    expect(profile.tenant).toBe('tenant-2');
  });
});

describe('single-score smuggling through the aggregate endpoint', () => {
  it('rejects a cross-dimension aggregate query at the wire boundary', () => {
    expect(() =>
      makeGetDimensionAggregateQuery(
        { tenant: 'tenant-1', expertId: 'expert-1', dimension: 'all-dimensions', at: AT },
        { correlationId: toCorrelationId('corr-6') },
      ),
    ).toThrow(ExpertPerformanceError);
    expect(() =>
      makeGetDimensionAggregateQuery(
        { tenant: 'tenant-1', expertId: 'expert-1', dimension: 'overall', at: AT },
        { correlationId: toCorrelationId('corr-7') },
      ),
    ).toThrow(ExpertPerformanceError);
  });

  it('the service has no global-score operation — the domain marker always fails closed', () => {
    expect(() => consumeProfileAsGlobalScore()).toThrow(ExpertPerformanceError);
    expect(Object.keys(EXPERT_PERFORMANCE_ERROR_CODES)).toContain('GLOBAL_SCORE_REJECTED');
  });

  it('ingestion cannot smuggle a score field — the derived record and lenses carry only closed fields', async () => {
    const { service } = seededService();
    const appended = await service.appendEvidence(
      {
        recordId: 'perf-040',
        tenant: 'tenant-1',
        expertId: 'expert-1',
        family: 'skill-extraction-outcome',
        dimension: 'skill-competency',
        refDigest: DIGEST_A,
        globalScore: 0.9,
        overallRating: 'a-plus',
      } as unknown as Parameters<ExpertPerformanceService['appendEvidence']>[0],
      OPTIONS,
    );
    const recordKeys = Object.keys(appended.record);
    expect(recordKeys.some((key) => /score|rating/i.test(key))).toBe(false);
    expect(appended.record.dimension).toBe('skill-competency');
    expect(appended.record.outcome).toBe('demonstrated');
    const { lens } = await service.getRoutingInput(
      { tenant: 'tenant-1', expertId: 'expert-1' },
      { correlationId: 'corr-9', at: AT },
    );
    expect(Object.keys(lens).some((key) => /score|rating/i.test(key))).toBe(false);
    expect(
      lens.dimensions.every((summary) => !/score|rating/i.test(Object.keys(summary).join(' '))),
    ).toBe(true);
  });
});
