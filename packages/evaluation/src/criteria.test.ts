/**
 * EvaluationCriteria tests (Work Order A012 gate 3): content-addressed,
 * versioned, digest-addressed criteria objects — positive AND negative
 * coverage for every constructor/validator.
 */

import { describe, expect, it } from 'vitest';
import {
  AGGREGATION_POLICIES,
  CRITERION_ENTRY_FIELDS,
  EVALUATION_CRITERIA_FIELDS,
  EVALUATION_CRITERIA_VERSION,
  EVALUATION_THRESHOLDS_FIELDS,
  criterionEntryById,
  criterionIdsOf,
  createEvaluationCriteria,
  evaluationCriteriaView,
  isAggregationPolicy,
  isCriterionEntry,
  isEvaluationCriteria,
  isEvaluationCriteriaView,
  recomputeEvaluationCriteriaDigest,
} from './criteria.js';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import {
  DIGEST_A,
  DIGEST_F,
  T0,
  makeCriteriaEntries,
  makeCriteriaInput,
} from './test-support.js';

describe('createEvaluationCriteria (positive)', () => {
  it('creates a validated, deep-frozen, digest-addressed criteria object', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    expect(criteria.recordVersion).toBe(EVALUATION_CRITERIA_VERSION);
    expect(criteria.criteriaId).toBe('criteria-000042');
    expect(criteria.version).toBe('1.0.0');
    expect(criteria.entries).toHaveLength(3);
    expect(criteria.aggregation).toBe('weighted-sum');
    expect(criteria.thresholds).toEqual({ passAt: 0.75 });
    expect(criteria.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(criteria)).toBe(true);
    expect(Object.isFrozen(criteria.entries)).toBe(true);
    expect(Object.isFrozen(criteria.entries[0])).toBe(true);
    expect(Object.isFrozen(criteria.thresholds)).toBe(true);
  });

  it('orders preserved: entries stay in input order (explicit criteria are ordered)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    expect(criteria.entries.map((entry) => entry.criterionId)).toEqual([
      'criterion-001',
      'criterion-002',
      'criterion-003',
    ]);
  });

  it('supports all three aggregation policies (positive)', async () => {
    for (const aggregation of AGGREGATION_POLICIES) {
      const criteria = await createEvaluationCriteria(
        makeCriteriaInput({
          aggregation,
          passAt: aggregation === 'rubric-level' ? 4 : 0.5,
        }),
      );
      expect(criteria.aggregation).toBe(aggregation);
    }
  });
});

describe('content addressing (gate 3 — digest determinism)', () => {
  it('same criteria input ⇒ same digest (positive)', async () => {
    const a = await createEvaluationCriteria(makeCriteriaInput());
    const b = await createEvaluationCriteria(makeCriteriaInput());
    expect(a.digest).toBe(b.digest);
  });

  it('ANY field change ⇒ different digest (positive — mutation means a new object)', async () => {
    const base = await createEvaluationCriteria(makeCriteriaInput());
    const variants: Array<Promise<{ digest: string }>> = [
      createEvaluationCriteria(makeCriteriaInput({ criteriaId: 'criteria-000043' })),
      createEvaluationCriteria(makeCriteriaInput({ version: '1.0.1' })),
      createEvaluationCriteria(makeCriteriaInput({ aggregation: 'pass-threshold', passAt: 0.9 })),
      createEvaluationCriteria(makeCriteriaInput({ passAt: 0.5 })),
      createEvaluationCriteria(makeCriteriaInput({ entryCount: 4 })),
    ];
    for (const variant of variants) {
      const built = await variant;
      expect(built.digest).not.toBe(base.digest);
    }
  });

  it('field-order independence of the input object does not matter — canonical JSON does (positive)', async () => {
    const a = await createEvaluationCriteria(makeCriteriaInput());
    const reordered = {
      aggregation: a.aggregation,
      thresholds: { passAt: a.thresholds.passAt },
      entries: a.entries.map((entry) => ({ ...entry })),
      version: a.version,
      criteriaId: a.criteriaId,
    };
    const b = await createEvaluationCriteria(reordered);
    expect(b.digest).toBe(a.digest);
  });

  it('recomputeEvaluationCriteriaDigest passes and returns the digest (positive)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    await expect(recomputeEvaluationCriteriaDigest(criteria)).resolves.toBe(criteria.digest);
    await expect(recomputeEvaluationCriteriaDigest(criteria, criteria.digest)).resolves.toBe(
      criteria.digest,
    );
  });

  it('recomputeEvaluationCriteriaDigest throws TAMPERED on a mismatching expectation (negative)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    await expect(
      recomputeEvaluationCriteriaDigest(criteria, 'b'.repeat(64)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.TAMPERED }),
    );
  });

  it('recomputeEvaluationCriteriaDigest rejects structurally invalid criteria (negative)', async () => {
    await expect(
      recomputeEvaluationCriteriaDigest({ digest: 'x' } as never),
    ).rejects.toThrowError(/structurally valid/);
  });
});

describe('createEvaluationCriteria validation (negative)', () => {
  it('rejects non-object input', async () => {
    for (const bad of [null, undefined, 42, 'criteria', [1], true]) {
      await expect(createEvaluationCriteria(bad as never)).rejects.toThrowError(
        /expected a plain object/,
      );
    }
  });

  it('rejects missing required fields', async () => {
    const { entries, ...missing } = makeCriteriaInput();
    void entries;
    await expect(createEvaluationCriteria(missing as never)).rejects.toThrowError(
      /missing required field 'entries'/,
    );
  });

  it('rejects unknown fields (strict shape)', async () => {
    const extra = { ...makeCriteriaInput(), surprise: true };
    await expect(createEvaluationCriteria(extra as never)).rejects.toThrowError(
      /unknown field 'surprise'/,
    );
  });

  it('rejects empty entry lists', async () => {
    await expect(
      createEvaluationCriteria({ ...makeCriteriaInput(), entries: [] }),
    ).rejects.toThrowError(/non-empty ordered array/);
  });

  it('rejects duplicate criterion ids (closed within the object)', async () => {
    const first = makeCriteriaEntries(1)[0]!;
    const duplicated = [{ ...first }, { ...first }];
    await expect(
      createEvaluationCriteria({ ...makeCriteriaInput(), entries: duplicated }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.DUPLICATE_CRITERION }),
    );
  });

  it('rejects non-positive weights', async () => {
    const entries = makeCriteriaEntries(1);
    for (const badWeight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1']) {
      await expect(
        createEvaluationCriteria({
          ...makeCriteriaInput(),
          entries: [{ ...entries[0]!, weight: badWeight as number }],
        }),
      ).rejects.toThrowError(EvaluationError);
    }
  });

  it('rejects unknown aggregation policies (closed enum — negative)', async () => {
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        aggregation: 'median-score',
      } as never),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_AGGREGATION }),
    );
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        aggregation: 'weighted-average',
      } as never),
    ).rejects.toThrowError(/must be one of/);
  });

  it('rejects out-of-domain thresholds per policy (negative)', async () => {
    // weighted-sum: passAt must be in (0, 1]
    for (const bad of [0, 1.5, -0.1, Number.NaN]) {
      await expect(
        createEvaluationCriteria(makeCriteriaInput({ passAt: bad })),
      ).rejects.toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.THRESHOLD_OUT_OF_RANGE }),
      );
    }
    // rubric-level: passAt must be an integer level in [1, 5]
    for (const bad of [0, 2.5, 6, -1]) {
      await expect(
        createEvaluationCriteria(makeCriteriaInput({ aggregation: 'rubric-level', passAt: bad })),
      ).rejects.toThrowError(EvaluationError);
    }
    // thresholds must be an object
    await expect(
      createEvaluationCriteria({ ...makeCriteriaInput(), thresholds: 3 as never }),
    ).rejects.toThrowError(/expected a plain object/);
  });

  it('rejects malformed criterion entries (negative)', async () => {
    const entries = makeCriteriaEntries(1);
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        entries: [{ ...entries[0]!, description: '' }],
      }),
    ).rejects.toThrowError(/invalid neutral text/i);
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        entries: [{ ...entries[0]!, targetRef: 'not-a-digest' }],
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_DIGEST }),
    );
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        entries: [{ ...entries[0]!, criterionId: 'BAD-ID' }],
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_IDENTITY }),
    );
    await expect(
      createEvaluationCriteria({
        ...makeCriteriaInput(),
        entries: [{ ...entries[0]!, extraField: 'no' } as never],
      }),
    ).rejects.toThrowError(/unknown field/);
  });

  it('rejects malformed identity fields (negative)', async () => {
    await expect(
      createEvaluationCriteria({ ...makeCriteriaInput(), criteriaId: 'BAD' }),
    ).rejects.toThrowError(/invalid evaluation id/i);
    await expect(
      createEvaluationCriteria({ ...makeCriteriaInput(), version: '1.2' }),
    ).rejects.toThrowError(/invalid evaluation version/i);
  });
});

describe('structural guards (positive + negative)', () => {
  it('isEvaluationCriteriaView / isEvaluationCriteria accept real objects (positive)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    expect(isEvaluationCriteriaView(evaluationCriteriaView(criteria))).toBe(true);
    expect(isEvaluationCriteria(criteria)).toBe(true);
  });

  it('guards reject junk (negative)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    expect(isEvaluationCriteria({ ...criteria, digest: 'x' })).toBe(false);
    expect(isEvaluationCriteria({ ...criteria, recordVersion: 2 })).toBe(false);
    expect(isEvaluationCriteria(null)).toBe(false);
    expect(isEvaluationCriteria(42)).toBe(false);
    expect(isEvaluationCriteriaView(null)).toBe(false);
    // empty entries fail the view guard
    expect(
      isEvaluationCriteriaView({ ...evaluationCriteriaView(criteria), entries: [] }),
    ).toBe(false);
  });

  it('isCriterionEntry accepts and rejects (positive + negative)', () => {
    const entry = makeCriteriaEntries(1)[0]!;
    expect(isCriterionEntry(entry)).toBe(true);
    expect(isCriterionEntry({ ...entry, weight: 0 })).toBe(false);
    expect(isCriterionEntry({ ...entry, criterionId: 'BAD' })).toBe(false);
    expect(isCriterionEntry(null)).toBe(false);
    expect(isCriterionEntry('entry')).toBe(false);
  });

  it('isAggregationPolicy (positive + negative)', () => {
    expect(isAggregationPolicy('weighted-sum')).toBe(true);
    expect(isAggregationPolicy('pass-threshold')).toBe(true);
    expect(isAggregationPolicy('rubric-level')).toBe(true);
    expect(isAggregationPolicy('mean')).toBe(false);
    expect(isAggregationPolicy(42)).toBe(false);
  });
});

describe('field-list constants (positive)', () => {
  it('declares stable field lists for tests + contracts parity', () => {
    expect([...CRITERION_ENTRY_FIELDS]).toEqual(['criterionId', 'weight', 'description', 'targetRef']);
    expect([...EVALUATION_THRESHOLDS_FIELDS]).toEqual(['passAt']);
    expect([...EVALUATION_CRITERIA_FIELDS]).toEqual([
      'recordVersion',
      'criteriaId',
      'version',
      'entries',
      'aggregation',
      'thresholds',
    ]);
  });

  it('criterionIdsOf / criterionEntryById projections (positive)', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    expect(criterionIdsOf(criteria)).toEqual([
      'criterion-001',
      'criterion-002',
      'criterion-003',
    ]);
    expect(criterionEntryById(criteria, 'criterion-002')?.targetRef).toBe(DIGEST_F);
    expect(criterionEntryById(criteria, 'criterion-999')).toBeUndefined();
  });
});

describe('no mutation API (gate 3 negative — criteria are frozen)', () => {
  it('mutating a frozen criteria object throws TypeError; the digest still commits to the original bytes', async () => {
    const criteria = await createEvaluationCriteria(makeCriteriaInput());
    const mutate = criteria as unknown as { aggregation?: string };
    expect(() => {
      mutate['aggregation'] = 'pass-threshold';
    }).toThrowError(TypeError);
    expect(criteria.aggregation).toBe('weighted-sum');
    expect(criteria.digest).toMatch(/^[0-9a-f]{64}$/);
    void DIGEST_A;
    void T0;
  });
});
