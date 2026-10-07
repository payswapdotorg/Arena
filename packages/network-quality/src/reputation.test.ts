/**
 * Dimensional reputation record tests (Work Order C020): creation,
 * append-only integrity, provenance addressing, the no-single-global-
 * score law and the single-family aggregate.
 */

import { describe, expect, it } from 'vitest';
import {
  NetworkQualityError,
  NETWORK_QUALITY_ERROR_CODES,
  createReputationRecord,
  verifyReputationRecordDigest,
  recomputeReputationRecordDigest,
  aggregateFamilyOutcomes,
  buildNetworkQualityScore,
  consumeReputationAsGlobalScore,
  applyReputationWeights,
  mutateReputationRecord,
  silentlyAdjustReputation,
} from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const AT = '2026-10-01T00:00:00.000Z';
const LATER = '2026-10-05T00:00:00.000Z';

async function makeRecord(overrides: Record<string, unknown> = {}) {
  return createReputationRecord({
    recordId: 'nq-rep-001',
    tenant: 'tenant-1',
    expertId: 'expert-1',
    family: 'validation-outcome',
    outcome: 'accepted',
    applicability: { taskFamily: 'bug-fix-review' },
    sampleSize: 2,
    observedAt: AT,
    recordedAt: LATER,
    source: { surface: 'escalation-validation', refDigest: DIGEST_A, locator: 'req-1' },
    ...overrides,
  });
}

describe('createReputationRecord', () => {
  it('creates a frozen, content-addressed dimensional record', async () => {
    const record = await makeRecord();
    expect(record.recordVersion).toBe(1);
    expect(record.family).toBe('validation-outcome');
    expect(record.outcome).toBe('accepted');
    expect(record.applicability.taskFamily).toBe('bug-fix-review');
    expect(record.sampleSize).toBe(2);
    expect(record.source.surface).toBe('escalation-validation');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    await expect(verifyReputationRecordDigest(record)).resolves.toBe(true);
  });

  it('fails closed on an unknown family (closed vocabulary)', async () => {
    await expect(makeRecord({ family: 'overall-quality' })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_FAMILY,
    });
  });

  it('fails closed on an outcome outside the family vocabulary', async () => {
    await expect(makeRecord({ outcome: 'excellent' })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_OUTCOME,
    });
  });

  it('fails closed on a (surface → family) mapping violation', async () => {
    await expect(
      makeRecord({ family: 'dispute-outcome', outcome: 'upheld' }),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE,
    });
  });

  it('fails closed when the required applicability context is missing', async () => {
    await expect(makeRecord({ applicability: {} })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    });
  });

  it('fails closed on backdated recording', async () => {
    await expect(makeRecord({ recordedAt: '2026-09-01T00:00:00.000Z' })).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.BACKDATED_RECORD,
    });
  });

  it('fails closed on unknown fields (exact-field validation)', async () => {
    await expect(
      createReputationRecord({
        recordId: 'nq-rep-002',
        tenant: 'tenant-1',
        expertId: 'expert-1',
        family: 'validation-outcome',
        outcome: 'accepted',
        applicability: { taskFamily: 'bug-fix-review' },
        sampleSize: 2,
        observedAt: AT,
        recordedAt: LATER,
        source: { surface: 'escalation-validation', refDigest: DIGEST_A, locator: 'req-1' },
        overallScore: 0.87,
      } as never),
    ).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_RECORD,
    });
  });
});

describe('the no-single-global-score law (structural)', () => {
  it('buildNetworkQualityScore has no happy path', () => {
    expect(() => buildNetworkQualityScore()).toThrowError(NetworkQualityError);
    expect(() => buildNetworkQualityScore()).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED }),
    );
  });

  it('consumeReputationAsGlobalScore has no happy path', () => {
    expect(() => consumeReputationAsGlobalScore()).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED }),
    );
  });

  it('applyReputationWeights has no happy path', () => {
    expect(() => applyReputationWeights()).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.GLOBAL_SCORE_REJECTED }),
    );
  });

  it('silentlyAdjustReputation fails closed (findings propose, never adjust)', () => {
    expect(() => silentlyAdjustReputation()).toThrowError(
      expect.objectContaining({
        code: NETWORK_QUALITY_ERROR_CODES.SILENT_ADJUSTMENT_REJECTED,
      }),
    );
  });

  it('mutateReputationRecord fails closed (append-only)', () => {
    expect(() => mutateReputationRecord()).toThrowError(
      expect.objectContaining({ code: NETWORK_QUALITY_ERROR_CODES.APPEND_ONLY_VIOLATION }),
    );
  });

  it('no record type carries a score field', async () => {
    const record = await makeRecord();
    expect(Object.keys(record).some((key) => key.toLowerCase().includes('score'))).toBe(false);
  });
});

describe('aggregateFamilyOutcomes (the ONLY aggregate)', () => {
  it('folds ONE family into a formula-disclosing aggregate', async () => {
    const first = await makeRecord();
    const second = await createReputationRecord({
      recordId: 'nq-rep-002',
      tenant: 'tenant-1',
      expertId: 'expert-1',
      family: 'validation-outcome',
      outcome: 'rejected',
      applicability: { taskFamily: 'bug-fix-review' },
      sampleSize: 1,
      observedAt: AT,
      recordedAt: LATER,
      source: { surface: 'escalation-validation', refDigest: DIGEST_B, locator: 'req-2' },
    });
    const aggregate = await aggregateFamilyOutcomes([first, second]);
    expect(aggregate.formula).toBe('family-outcome-frequency');
    expect(aggregate.recordCount).toBe(2);
    expect(aggregate.sampleSize).toBe(3);
    expect(aggregate.outcomeCounts['accepted']).toBe(1);
    expect(aggregate.outcomeCounts['rejected']).toBe(1);
    expect(aggregate.limitations.length).toBeGreaterThanOrEqual(2);
  });

  it('fails closed on cross-family aggregation', async () => {
    const first = await makeRecord();
    const other = await createReputationRecord({
      recordId: 'nq-rep-004',
      tenant: 'tenant-1',
      expertId: 'expert-1',
      family: 'conduct-flag',
      outcome: 'flag-raised',
      applicability: { domain: 'software' },
      sampleSize: 1,
      observedAt: AT,
      recordedAt: LATER,
      source: { surface: 'adversarial-evaluation', refDigest: DIGEST_B, locator: 'judg-1' },
    });
    await expect(aggregateFamilyOutcomes([first, other])).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.INVALID_AGGREGATE,
    });
  });

  it('fails closed on cross-expert aggregation', async () => {
    const first = await makeRecord();
    const other = await makeRecord({
      recordId: 'nq-rep-005',
      expertId: 'expert-2',
    });
    await expect(aggregateFamilyOutcomes([first, other])).rejects.toMatchObject({
      code: NETWORK_QUALITY_ERROR_CODES.TENANT_MISMATCH,
    });
  });
});

describe('provenance tampering (append-only integrity)', () => {
  it('a structurally modified record fails digest verification', async () => {
    const record = await makeRecord();
    const tampered = { ...record, outcome: 'rejected' } as typeof record;
    await expect(verifyReputationRecordDigest(tampered)).resolves.toBe(false);
    expect(await recomputeReputationRecordDigest(tampered)).not.toBe(tampered.digest);
  });
});
