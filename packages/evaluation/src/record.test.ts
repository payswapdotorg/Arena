/**
 * EvaluationRecord tests (Work Order A012 gate 4): the append-once
 * result record — aggregate per aggregation policy, per-criterion
 * verdicts, criterion matching, score domains, timestamp bounds, pure
 * replayable construction, frozen-on-creation.
 */

import { describe, expect, it } from 'vitest';
import {
  AGGREGATE_OUTCOMES,
  AGGREGATE_OUTCOME_FIELDS,
  CRITERION_VERDICT_FIELDS,
  EVALUATION_RECORD_FIELDS,
  EVALUATION_RECORD_PROVENANCE_FIELDS,
  EVALUATION_RECORD_VERSION,
  aggregateCriterionVerdicts,
  createEvaluationRecord,
  evaluationRecordView,
  isAggregateOutcome,
  isCriterionVerdict,
  isEvaluationProvenance,
  isEvaluationRecord,
  isEvaluationRecordView,
  recomputeEvaluationRecordDigest,
  replayEvaluationRecord,
} from './record.js';
import { createEvaluationCriteria } from './criteria.js';
import * as evaluationExports from './index.js';
import { EVALUATION_ERROR_CODES, EvaluationError } from './errors.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_C,
  T0,
  T1,
  T5,
  T6,
  makeCriteriaInput,
  makeDescriptorInput,
  makeVerdicts,
} from './test-support.js';

const RECORD_BASE = {
  evaluatorRef: DIGEST_C,
  caseRef: DIGEST_A,
  trajectoryRef: DIGEST_B,
  criteriaRef: '', // bound to the actual criteria digest by recordBase()
  seed: 'seed-1234',
  confidence: 0.85,
  limitations: 'run-level caveat: single trajectory, no repetition',
  startedAt: T0,
  finishedAt: T1,
  provenance: {
    executedBy: 'evaluator-instance-01',
    recordedAt: T1,
    notes: 'executed by the A012 reference fabric',
  },
};

/** Base input with criteriaRef bound to the actual criteria digest. */
function recordBase(criteriaDigest: string) {
  return { ...RECORD_BASE, criteriaRef: criteriaDigest };
}

async function criteria() {
  return createEvaluationCriteria(makeCriteriaInput());
}

describe('aggregateCriterionVerdicts (pure aggregation per policy)', () => {
  it('weighted-sum: normalized weighted mean + outcome label (positive)', async () => {
    const c = await makeCriteriaInput3(); // weights 1,2,3
    const verdicts = makeVerdicts(3, { scores: [1, 0, 0.5] });
    const aggregate = aggregateCriterionVerdicts(c, verdicts);
    // (1*1 + 0*2 + 0.5*3) / 6 = 2.5/6 = 0.416667
    expect(aggregate.score).toBeCloseTo(0.416667, 5);
    expect(aggregate.outcome).toBe('below-criteria'); // passAt 0.75
  });

  it('weighted-sum: meets-criteria above the threshold (positive)', async () => {
    const c = await makeCriteriaInput3();
    const aggregate = aggregateCriterionVerdicts(c, makeVerdicts(3, { scores: [1, 1, 0.5] }));
    // (1 + 2 + 1.5)/6 = 0.75 exactly
    expect(aggregate.score).toBe(0.75);
    expect(aggregate.outcome).toBe('meets-criteria');
  });

  it('pass-threshold: passing fraction + boolean score domain (positive)', async () => {
    const c = await createEvaluationCriteria(
      makeCriteriaInput({ aggregation: 'pass-threshold', passAt: 0.5 }),
    );
    const aggregate = aggregateCriterionVerdicts(c, makeVerdicts(3, { scores: [1, 1, 0] }));
    expect(aggregate.score).toBeCloseTo(0.666667, 5);
    expect(aggregate.outcome).toBe('meets-criteria');
    const low = aggregateCriterionVerdicts(c, makeVerdicts(3, { scores: [0, 0, 1] }));
    expect(low.score).toBeCloseTo(0.333333, 5);
    expect(low.outcome).toBe('below-criteria');
  });

  it('rubric-level: minimum level across criteria (positive)', async () => {
    const c = await createEvaluationCriteria(
      makeCriteriaInput({ aggregation: 'rubric-level', passAt: 4 }),
    );
    const aggregate = aggregateCriterionVerdicts(c, makeVerdicts(3, { scores: [5, 4, 3] }));
    expect(aggregate.score).toBe(3);
    expect(aggregate.outcome).toBe('below-criteria');
    const high = aggregateCriterionVerdicts(c, makeVerdicts(3, { scores: [4, 5, 5] }));
    expect(high.score).toBe(4);
    expect(high.outcome).toBe('meets-criteria');
  });

  it('rejects verdict sets that are not the exact criteria set (negative — CRITERION_MISMATCH)', async () => {
    const c = await makeCriteriaInput3();
    // missing criterion
    expect(() => aggregateCriterionVerdicts(c, makeVerdicts(2, { scores: [1, 1] }))).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.CRITERION_MISMATCH }),
    );
    // unknown criterion at the SAME cardinality (a 1:1 rename, not a length change)
    const renamed = makeVerdicts(3, { scores: [1, 1, 1] }).map((verdict, index) =>
      index === 2 ? { ...verdict, criterionId: 'criterion-999' } : verdict,
    );
    expect(() => aggregateCriterionVerdicts(c, renamed)).toThrowError(
      /verdict for unknown criterion/,
    );
    // missing-criterion message names the gap
    expect(() => aggregateCriterionVerdicts(c, makeVerdicts(2, { scores: [1, 1] }))).toThrowError(
      /does not match criteria set/,
    );
    // duplicate verdict for the same criterion
    const duplicated = [
      ...makeVerdicts(2, { scores: [1, 1] }),
      { criterionId: 'criterion-001', score: 1, judgment: null, notes: null },
    ];
    expect(() => aggregateCriterionVerdicts(c, duplicated)).toThrowError(
      /does not match criteria set/,
    );
  });

  it('rejects score-domain violations per policy (negative — INVALID_VERDICT)', async () => {
    const weighted = await makeCriteriaInput3();
    expect(() =>
      aggregateCriterionVerdicts(weighted, makeVerdicts(3, { scores: [1.2, 0, 0] })),
    ).toThrowError(/weighted-sum scores must be finite numbers in \[0, 1\]/);
    const booleanish = await createEvaluationCriteria(
      makeCriteriaInput({ aggregation: 'pass-threshold', passAt: 0.5 }),
    );
    expect(() =>
      aggregateCriterionVerdicts(booleanish, makeVerdicts(3, { scores: [0.5, 0, 0] })),
    ).toThrowError(/pass-threshold scores must be exactly 0 or 1/);
    const rubric = await createEvaluationCriteria(
      makeCriteriaInput({ aggregation: 'rubric-level', passAt: 4 }),
    );
    expect(() =>
      aggregateCriterionVerdicts(rubric, makeVerdicts(3, { scores: [5, 4, 3.5] })),
    ).toThrowError(/rubric-level scores must be integer levels/);
    expect(() =>
      aggregateCriterionVerdicts(rubric, makeVerdicts(3, { scores: [5, 4, 0] })),
    ).toThrowError(/rubric-level scores must be integer levels/);
  });

  it('rejects structurally invalid criteria (negative)', () => {
    expect(() => aggregateCriterionVerdicts({ digest: 'x' } as never, [])).toThrowError(
      /structurally valid criteria/,
    );
  });
});

async function makeCriteriaInput3() {
  return createEvaluationCriteria(makeCriteriaInput({ entryCount: 3 }));
}

describe('createEvaluationRecord (positive)', () => {
  it('creates a validated, deep-frozen, digest-addressed record with the COMPUTED aggregate', async () => {
    const c = await criteria();
    const record = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 1, 0.75] }) },
      c,
    );
    expect(record.recordVersion).toBe(EVALUATION_RECORD_VERSION);
    expect(record.evaluatorRef).toBe(DIGEST_C);
    expect(record.caseRef).toBe(DIGEST_A);
    expect(record.trajectoryRef).toBe(DIGEST_B);
    expect(record.criteriaRef).toBe(c.digest);
    expect(record.seed).toBe('seed-1234');
    expect(record.verdicts).toHaveLength(3);
    // aggregate computed by the constructor, never caller-supplied:
    // (1*1 + 1*2 + 0.75*3)/6 = 5.25/6 = 0.875
    expect(record.aggregate.score).toBe(0.875);
    expect(record.aggregate.outcome).toBe('meets-criteria');
    expect(record.confidence).toBe(0.85);
    expect(record.startedAt).toBe(T0);
    expect(record.finishedAt).toBe(T1);
    expect(record.provenance.executedBy).toBe('evaluator-instance-01');
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.verdicts)).toBe(true);
    expect(Object.isFrozen(record.aggregate)).toBe(true);
    expect(Object.isFrozen(record.provenance)).toBe(true);
  });

  it('orders verdicts canonically to the criteria order regardless of input order (positive)', async () => {
    const c = await criteria();
    const shuffled = [
      ...makeVerdicts(3, { scores: [0.5, 1, 1] }),
    ].reverse();
    const record = await createEvaluationRecord({ ...recordBase(c.digest), verdicts: shuffled }, c);
    expect(record.verdicts.map((verdict) => verdict.criterionId)).toEqual([
      'criterion-001',
      'criterion-002',
      'criterion-003',
    ]);
  });

  it('supports rubric judgments with judgment labels and notes (positive)', async () => {
    const c = await createEvaluationCriteria(
      makeCriteriaInput({ aggregation: 'rubric-level', passAt: 3 }),
    );
    const record = await createEvaluationRecord(
      {
        ...recordBase(c.digest),
        verdicts: makeVerdicts(3, { scores: [4, 3, 4], judgment: 'solid', notes: 'consistent' }),
      },
      c,
    );
    expect(record.aggregate.score).toBe(3);
    expect(record.aggregate.outcome).toBe('meets-criteria');
    expect(record.verdicts[0]?.judgment).toBe('solid');
    expect(record.verdicts[0]?.notes).toBe('consistent');
  });
});

describe('pure construction / score stability (gate 4 + gate 11)', () => {
  it('identical inputs + identical seed ⇒ identical record digests (positive)', async () => {
    const c = await criteria();
    const input = { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 0.5, 0.25] }) };
    const a = await createEvaluationRecord(input, c);
    const b = await createEvaluationRecord(input, c);
    expect(a.digest).toBe(b.digest);
    expect(a.aggregate).toEqual(b.aggregate);
  });

  it('a different seed ⇒ a different record digest (reproducibility is seed-addressed)', async () => {
    const c = await criteria();
    const a = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 1, 1] }) },
      c,
    );
    const b = await createEvaluationRecord(
      { ...recordBase(c.digest), seed: 'seed-5678', verdicts: makeVerdicts(3, { scores: [1, 1, 1] }) },
      c,
    );
    expect(b.seed).toBe('seed-5678');
    expect(a.digest).not.toBe(b.digest);
  });

  it('replayEvaluationRecord rebuilds byte-identically from the record itself (positive)', async () => {
    const c = await criteria();
    const record = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 0.5, 0.25] }) },
      c,
    );
    const replayed = await replayEvaluationRecord(record, c);
    expect(replayed.digest).toBe(record.digest);
    expect(replayed).toEqual(record);
  });

  it('recomputeEvaluationRecordDigest passes and pins (positive)', async () => {
    const c = await criteria();
    const record = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 1, 1] }) },
      c,
    );
    await expect(recomputeEvaluationRecordDigest(record)).resolves.toBe(record.digest);
    await expect(recomputeEvaluationRecordDigest(record, record.digest)).resolves.toBe(
      record.digest,
    );
    await expect(
      recomputeEvaluationRecordDigest(record, '0'.repeat(64)),
    ).rejects.toThrowError(expect.objectContaining({ code: EVALUATION_ERROR_CODES.TAMPERED }));
  });
});

describe('createEvaluationRecord validation (negative)', () => {
  it('rejects non-object input', async () => {
    const c = await criteria();
    for (const bad of [null, undefined, 42, 'record', [1], true]) {
      await expect(createEvaluationRecord(bad as never, c)).rejects.toThrowError(
        /expected a plain object/,
      );
    }
  });

  it('rejects unknown fields (strict shape)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), aggregate: { score: 1, outcome: 'meets-criteria' } } as never,
        c,
      ),
    ).rejects.toThrowError(/unknown field 'aggregate'/);
  });

  it('rejects empty verdict arrays', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord({ ...recordBase(c.digest), verdicts: [] }, c),
    ).rejects.toThrowError(/non-empty array/);
  });

  it('rejects malformed verdict shapes (negative)', async () => {
    const c = await criteria();
    const verdicts = makeVerdicts(3);
    await expect(
      createEvaluationRecord(
        {
          ...recordBase(c.digest),
          verdicts: verdicts.map((verdict, index) =>
            index === 0 ? { ...verdict, score: Number.NaN } : verdict,
          ),
        },
        c,
      ),
    ).rejects.toThrowError(/score must be a finite number/);
    await expect(
      createEvaluationRecord(
        {
          ...recordBase(c.digest),
          verdicts: verdicts.map((verdict, index) =>
            index === 0 ? { ...verdict, judgment: 5 as unknown as string } : verdict,
          ),
        },
        c,
      ),
    ).rejects.toThrowError(/judgment must be neutral text or null/);
    await expect(
      createEvaluationRecord(
        {
          ...recordBase(c.digest),
          verdicts: verdicts.map((verdict, index) =>
            index === 0 ? { ...verdict, extra: 1 } : verdict,
          ) as never,
        },
        c,
      ),
    ).rejects.toThrowError(/unknown field/);
  });

  it('rejects a criteriaRef that does not bind the supplied criteria object (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        { ...recordBase('f'.repeat(64)), verdicts: makeVerdicts(3) },
        c,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.CRITERION_MISMATCH }),
    );
  });

  it('rejects verdict/criteria set mismatches (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord({ ...recordBase(c.digest), verdicts: makeVerdicts(2) }, c),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.CRITERION_MISMATCH }),
    );
  });

  it('rejects out-of-domain scores per policy (negative)', async () => {
    const c = await criteria(); // weighted-sum
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [2, 0, 0] }) },
        c,
      ),
    ).rejects.toThrowError(/weighted-sum scores/);
  });

  it('rejects confidence out of [0, 1] (negative)', async () => {
    const c = await criteria();
    for (const bad of [-1, 1.5, Number.NaN]) {
      await expect(
        createEvaluationRecord({ ...recordBase(c.digest), verdicts: makeVerdicts(3), confidence: bad }, c),
      ).rejects.toThrowError(/confidence/);
    }
  });

  it('rejects finished-before-started (negative — TIMESTAMP_REGRESSION)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), finishedAt: T5, startedAt: T6 },
        c,
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.TIMESTAMP_REGRESSION }),
    );
  });

  it('rejects malformed timestamps (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), startedAt: 'nope' },
        c,
      ),
    ).rejects.toThrowError(/invalid evaluation timestamp/i);
  });

  it('rejects malformed seed / limitations (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), seed: 42 as unknown as string },
        c,
      ),
    ).rejects.toThrowError(/seed must be a neutral seed string or null/);
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), limitations: 3 as unknown as string },
        c,
      ),
    ).rejects.toThrowError(/limitations must be neutral text or null/);
  });

  it('rejects malformed provenance (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord(
        {
          ...recordBase(c.digest),
          verdicts: makeVerdicts(3),
          provenance: { ...RECORD_BASE.provenance, executedBy: 'BAD AUTHOR' },
        },
        c,
      ),
    ).rejects.toThrowError(/invalid executedBy/i);
    await expect(
      createEvaluationRecord(
        {
          ...recordBase(c.digest),
          verdicts: makeVerdicts(3),
          provenance: { executedBy: 'x', recordedAt: 'nope', notes: null },
        },
        c,
      ),
    ).rejects.toThrowError(/invalid evaluation timestamp/i);
    await expect(
      createEvaluationRecord(
        { ...recordBase(c.digest), verdicts: makeVerdicts(3), provenance: { executedBy: 'x' } as never },
        c,
      ),
    ).rejects.toThrowError(/missing required field/);
  });

  it('rejects structurally invalid criteria (negative)', async () => {
    const c = await criteria();
    await expect(
      createEvaluationRecord({ ...recordBase(c.digest), verdicts: makeVerdicts(3) }, { digest: 'x' } as never),
    ).rejects.toThrowError(/structurally valid criteria/);
  });
});

describe('structural guards (positive + negative)', () => {
  it('isEvaluationRecordView / isEvaluationRecord (positive + negative)', async () => {
    const c = await criteria();
    const record = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3) },
      c,
    );
    expect(isEvaluationRecordView(evaluationRecordView(record))).toBe(true);
    expect(isEvaluationRecord(record)).toBe(true);
    expect(isEvaluationRecord({ ...record, digest: 'x' })).toBe(false);
    expect(isEvaluationRecord({ ...record, recordVersion: 2 })).toBe(false);
    expect(isEvaluationRecord({ ...record, aggregate: { score: 1, outcome: 'perfect' } })).toBe(false);
    expect(isEvaluationRecord(null)).toBe(false);
    expect(isEvaluationRecord(42)).toBe(false);
  });

  it('isCriterionVerdict (positive + negative)', () => {
    const verdict = makeVerdicts(1)[0]!;
    expect(isCriterionVerdict(verdict)).toBe(true);
    expect(isCriterionVerdict({ ...verdict, score: '1' })).toBe(false);
    expect(isCriterionVerdict({ ...verdict, judgment: 3 })).toBe(false);
    expect(isCriterionVerdict(null)).toBe(false);
  });

  it('isAggregateOutcome / isEvaluationProvenance (positive + negative)', () => {
    expect(isAggregateOutcome({ score: 0.5, outcome: 'meets-criteria' })).toBe(true);
    expect(isAggregateOutcome({ score: 0.5, outcome: 'strong' })).toBe(false);
    expect(isAggregateOutcome(null)).toBe(false);
    const provenance = RECORD_BASE.provenance;
    expect(isEvaluationProvenance(provenance)).toBe(true);
    expect(isEvaluationProvenance({ ...provenance, notes: 5 })).toBe(false);
    expect(isEvaluationProvenance(null)).toBe(false);
  });
});

describe('field-list constants (positive)', () => {
  it('declares stable field lists for tests + contracts parity', () => {
    expect([...CRITERION_VERDICT_FIELDS]).toEqual(['criterionId', 'score', 'judgment', 'notes']);
    expect([...AGGREGATE_OUTCOME_FIELDS]).toEqual(['score', 'outcome']);
    expect([...EVALUATION_RECORD_PROVENANCE_FIELDS]).toEqual([
      'executedBy',
      'recordedAt',
      'notes',
    ]);
    expect([...EVALUATION_RECORD_FIELDS]).toEqual([
      'recordVersion',
      'evaluatorRef',
      'caseRef',
      'trajectoryRef',
      'criteriaRef',
      'seed',
      'verdicts',
      'aggregate',
      'confidence',
      'limitations',
      'startedAt',
      'finishedAt',
      'provenance',
    ]);
    expect([...AGGREGATE_OUTCOMES]).toEqual(['meets-criteria', 'below-criteria']);
  });
});

describe('no mutation API (gate 4 negative — records are frozen ON creation)', () => {
  it('mutating a frozen record throws TypeError in strict mode; the digest still commits to the original bytes', async () => {
    const c = await criteria();
    const record = await createEvaluationRecord(
      { ...recordBase(c.digest), verdicts: makeVerdicts(3, { scores: [1, 1, 1] }) },
      c,
    );
    const mutate = record as unknown as { confidence?: number };
    expect(() => {
      mutate['confidence'] = 0.05;
    }).toThrowError(TypeError);
    expect(record.confidence).toBe(0.85);
    await expect(recomputeEvaluationRecordDigest(record)).resolves.toBe(record.digest);
  });

  it('no update/append API exists on the record surface (source-level negative)', () => {
    // The EvaluationRecord is a plain frozen view object — there is no class
    // instance, no prototype methods, and no exported symbol whose name
    // suggests mutation (update/set/patch/append on records).
    const recordExports = Object.keys(evaluationExports).filter((name) =>
      /^(update|set|patch|append|mutate).*(Record|Verdict|Aggregate)/i.test(name),
    );
    expect(recordExports).toEqual([]);
    void makeDescriptorInput;
    void EvaluationError;
  });
});
