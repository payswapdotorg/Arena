/**
 * Record-family tests (Work Order C005): append-only construction, closed
 * dimension/outcome vocabularies, applicability context requirements, the
 * ATTRIBUTION LAW (an evaluator version change can never be recorded as
 * an expert performance change), backdating, masquerade screen and the
 * structural no-single-global-score rejection at the exact-field boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTION_KINDS,
  EXPERT_PERFORMANCE_ERROR_CODES,
  ExpertPerformanceError,
  classifyAttribution,
  createEvidenceRecord,
  mutateEvidenceRecord,
  verifyEvidenceRecordDigest,
} from './index.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const CAPABILITY = Object.freeze({
  kind: 'skill',
  id: 'rust-code-review',
  version: '1.0.0',
  digest: DIGEST_A,
});

function baseInput() {
  return {
    recordId: 'perf-001',
    tenant: 'tenant-1',
    expertId: 'expert-1',
    dimension: 'skill-competency',
    outcome: 'demonstrated',
    applicability: { capability: CAPABILITY },
    sampleSize: 3,
    confidence: null,
    observedAt: '2026-10-01T00:00:00.000Z',
    recordedAt: '2026-10-01T00:10:00.000Z',
    source: { family: 'skill-extraction-outcome', refDigest: DIGEST_B, locator: DIGEST_B },
    attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A },
  };
}

describe('createEvidenceRecord (append-only record family)', () => {
  it('creates a frozen, content-addressed record with all quality-model fields', async () => {
    const record = await createEvidenceRecord(baseInput());
    expect(record.recordVersion).toBe(1);
    expect(record.dimension).toBe('skill-competency');
    expect(record.outcome).toBe('demonstrated');
    expect(record.sampleSize).toBe(3);
    expect(record.attribution.kind).toBe('expert-change');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    await expect(verifyEvidenceRecordDigest(record)).resolves.toBe(true);
  });

  it('rejects unknown dimensions and outcomes (closed vocabularies)', async () => {
    await expect(
      createEvidenceRecord({ ...baseInput(), dimension: 'overall-rating' }),
    ).rejects.toThrow(ExpertPerformanceError);
    await expect(
      createEvidenceRecord({ ...baseInput(), outcome: 'excellent' }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('rejects a missing applicability context required by the dimension', async () => {
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        applicability: { domain: 'software' },
      }),
    ).rejects.toThrow(ExpertPerformanceError);
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        dimension: 'task-family-outcome',
        outcome: 'completed',
        applicability: {},
      }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('rejects backdated recording (recordedAt before observedAt)', async () => {
    await expect(
      createEvidenceRecord({ ...baseInput(), recordedAt: '2026-09-30T00:00:00.000Z' }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('rejects sample sizes below one and confidence outside [0, 1]', async () => {
    await expect(createEvidenceRecord({ ...baseInput(), sampleSize: 0 })).rejects.toThrow(
      ExpertPerformanceError,
    );
    await expect(createEvidenceRecord({ ...baseInput(), confidence: 1.5 })).rejects.toThrow(
      ExpertPerformanceError,
    );
  });

  it('rejects unknown source families and malformed provenance digests', async () => {
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        source: { family: 'gut-feeling', refDigest: DIGEST_B, locator: DIGEST_B },
      }),
    ).rejects.toThrow(ExpertPerformanceError);
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        source: { family: 'skill-extraction-outcome', refDigest: 'nothex', locator: 'x' },
      }),
    ).rejects.toThrow(ExpertPerformanceError);
  });

  it('rejects a smuggled score-shaped extra field (no-single-global-score, exact-field boundary)', async () => {
    const smuggled = {
      ...baseInput(),
      globalScore: 0.87,
    } as unknown as ReturnType<typeof baseInput>;
    await expect(createEvidenceRecord(smuggled)).rejects.toThrow(ExpertPerformanceError);
    try {
      await createEvidenceRecord(smuggled);
      expect.unreachable('smuggled global score must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.INVALID_RECORD,
      );
    }
  });

  it('rejects authority-shaped field names (lock rule 9 — data, never authorization)', async () => {
    const masquerade = {
      ...baseInput(),
      attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A, clearance: 'high' },
    } as unknown as ReturnType<typeof baseInput>;
    await expect(createEvidenceRecord(masquerade)).rejects.toThrow(ExpertPerformanceError);
  });
});

describe('the attribution law (LE1.0 vocabulary; spec/learning.md)', () => {
  it('classifies an evaluator version change as evaluator-change (forced)', () => {
    expect(
      classifyAttribution({
        declaredKind: 'expert-change',
        evaluatorVersion: DIGEST_B,
        priorEvaluatorVersion: DIGEST_A,
      }),
    ).toBe('evaluator-change');
    expect(
      classifyAttribution({
        declaredKind: 'expert-change',
        evaluatorVersion: DIGEST_A,
        priorEvaluatorVersion: DIGEST_A,
      }),
    ).toBe('expert-change');
    expect(
      classifyAttribution({
        declaredKind: 'measurement-variance',
        evaluatorVersion: null,
        priorEvaluatorVersion: null,
      }),
    ).toBe('measurement-variance');
  });

  it('rejects expert-change attribution under a CHANGED evaluator version digest', async () => {
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        priorEvaluatorVersion: DIGEST_B,
        attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A },
      }),
    ).rejects.toThrow(ExpertPerformanceError);
    try {
      await createEvidenceRecord({
        ...baseInput(),
        priorEvaluatorVersion: DIGEST_B,
        attribution: { kind: 'expert-change', evaluatorVersion: DIGEST_A },
      });
      expect.unreachable('the attribution law must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.ATTRIBUTION_VIOLATION,
      );
    }
  });

  it('accepts evaluator-change attribution under a changed evaluator version', async () => {
    const record = await createEvidenceRecord({
      ...baseInput(),
      priorEvaluatorVersion: DIGEST_B,
      attribution: { kind: 'evaluator-change', evaluatorVersion: DIGEST_A },
    });
    expect(record.attribution.kind).toBe('evaluator-change');
  });

  it('rejects attribution kinds outside the closed LE1.0 vocabulary', async () => {
    await expect(
      createEvidenceRecord({
        ...baseInput(),
        attribution: { kind: 'mood-change', evaluatorVersion: null },
      }),
    ).rejects.toThrow(ExpertPerformanceError);
  });
});

describe('append-only invariant', () => {
  it('has no update/delete path — mutateEvidenceRecord always fails closed', () => {
    expect(() => mutateEvidenceRecord()).toThrow(ExpertPerformanceError);
    try {
      mutateEvidenceRecord();
      expect.unreachable('mutation must fail closed');
    } catch (error) {
      expect((error as ExpertPerformanceError).code).toBe(
        EXPERT_PERFORMANCE_ERROR_CODES.APPEND_ONLY_VIOLATION,
      );
    }
  });

  it('a structural change to a stored record breaks its digest (tamper detection)', async () => {
    const record = await createEvidenceRecord(baseInput());
    const tampered = { ...record, outcome: 'improved' } as typeof record;
    await expect(verifyEvidenceRecordDigest(tampered)).resolves.toBe(false);
  });

  it('exposes the closed attribution vocabulary', () => {
    expect([...ATTRIBUTION_KINDS]).toEqual([
      'expert-change',
      'evaluator-change',
      'measurement-variance',
    ]);
  });
});
