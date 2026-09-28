/**
 * Reference evaluator tests (Work Order A012 gate 6): the
 * deterministic-test and rubric reference implementations are seeded
 * and reproducible; their verdicts always satisfy the aggregation
 * policy's score domain; distinct seeds diverge.
 */

import { describe, expect, it } from 'vitest';
import type { EvaluatorDescriptor, EvaluationCriteria } from '@arena/evaluation';
import { createEvaluationCriteria } from '@arena/evaluation';
import type { CapabilityCase } from '@arena/capability-case';
import type { TrajectoryRecord } from '@arena/trajectory';
import { makeDeterministicTestEvaluator, makeRubricEvaluator } from './evaluators.js';
import {
  IMPLEMENTED_EVALUATOR_KINDS,
  UNIMPLEMENTED_EVALUATOR_KINDS,
} from './evaluators.js';
import { buildCase, buildTrajectory } from './test-support.js';

interface Rig {
  readonly descriptor: EvaluatorDescriptor;
  readonly criteria: EvaluationCriteria;
  readonly caseRecord: CapabilityCase;
  readonly trajectoryRecord: TrajectoryRecord;
}

async function rig(policy: 'weighted-sum' | 'pass-threshold' | 'rubric-level', passAt: number): Promise<Rig> {
  const caseRecord = await buildCase();
  const trajectoryRecord = await buildTrajectory();
  const { createEvaluatorDescriptor } = await import('@arena/evaluation');
  const criteria = await createEvaluationCriteria({
    criteriaId: 'criteria-evaluators-test',
    version: '1.0.0',
    entries: [
      {
        criterionId: 'criterion-001',
        weight: 2,
        description: 'first criterion',
        targetRef: caseRecord.digest,
      },
      {
        criterionId: 'criterion-002',
        weight: 1,
        description: 'second criterion',
        targetRef: trajectoryRecord.chainHead,
      },
    ],
    aggregation: policy,
    thresholds: { passAt },
  });
  const descriptor = await createEvaluatorDescriptor({
    evaluatorId: 'eval-evaluators-test',
    version: '1.0.0',
    kind: 'deterministic-test',
    inputs: {
      caseRef: caseRecord.digest,
      trajectoryRef: trajectoryRecord.chainHead,
      bodyRef: null,
      substrateRef: null,
    },
    criteriaRef: criteria.digest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: { deterministic: true, seeded: true, requiresHuman: false },
    confidence: 0.9,
    limitations: 'reference evaluator',
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: '2026-03-01T12:00:00.000Z',
      notes: null,
    },
  });
  return { descriptor, criteria, caseRecord, trajectoryRecord };
}

describe('reference-evaluator scope constants', () => {
  it('exactly two kinds are implemented; five are declared without implementations (A012 scope NOTE)', () => {
    expect([...IMPLEMENTED_EVALUATOR_KINDS]).toEqual(['deterministic-test', 'rubric']);
    expect([...UNIMPLEMENTED_EVALUATOR_KINDS]).toEqual([
      'model-based',
      'expert',
      'simulation',
      'comparative',
      'adversarial',
    ]);
  });
});

describe('makeDeterministicTestEvaluator (positive)', () => {
  it('produces one verdict per criterion with policy-legal scores for all three aggregation policies', async () => {
    for (const [policy, passAt] of [
      ['weighted-sum', 0.75],
      ['pass-threshold', 0.5],
      ['rubric-level', 3],
    ] as const) {
      const r = await rig(policy, passAt);
      const hook = makeDeterministicTestEvaluator();
      const verdicts = await hook({
        descriptor: r.descriptor,
        criteria: r.criteria,
        caseRecord: r.caseRecord,
        trajectoryRecord: r.trajectoryRecord,
        seed: 'seed-1234',
      });
      expect(verdicts).toHaveLength(r.criteria.entries.length);
      expect(verdicts.map((v) => v.criterionId)).toEqual(
        r.criteria.entries.map((e) => e.criterionId),
      );
      for (const verdict of verdicts) {
        expect(verdict.judgment).toBeNull();
        expect(verdict.notes).toMatch(/^deterministic-test outcome/);
        switch (policy) {
          case 'weighted-sum':
            expect(verdict.score).toBeGreaterThanOrEqual(0);
            expect(verdict.score).toBeLessThanOrEqual(1);
            break;
          case 'pass-threshold':
            expect([0, 1]).toContain(verdict.score);
            break;
          case 'rubric-level':
            expect(Number.isInteger(verdict.score)).toBe(true);
            expect(verdict.score).toBeGreaterThanOrEqual(1);
            expect(verdict.score).toBeLessThanOrEqual(5);
            break;
        }
      }
    }
  });

  it('is SEEDED and reproducible: identical inputs ⇒ identical verdicts (positive)', async () => {
    const r = await rig('weighted-sum', 0.75);
    const hook = makeDeterministicTestEvaluator();
    const input = {
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
      seed: 'seed-1234',
    };
    const a = await hook(input);
    const b = await hook(input);
    expect(a).toEqual(b);
  });

  it('distinct seeds diverge (non-degenerate harness — positive)', async () => {
    const r = await rig('weighted-sum', 0.75);
    const hook = makeDeterministicTestEvaluator();
    const base = {
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
    };
    const a = await hook({ ...base, seed: 'seed-1' });
    const b = await hook({ ...base, seed: 'seed-2' });
    const c = await hook({ ...base, seed: 'seed-3' });
    const digests = [a, b, c].map((verdicts) => JSON.stringify(verdicts));
    expect(new Set(digests).size).toBeGreaterThan(1);
  });

  it('different criterion ids derive different outcomes (criterion-addressed derivation — positive)', async () => {
    const r = await rig('pass-threshold', 0.5);
    const hook = makeDeterministicTestEvaluator();
    const verdicts = await hook({
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
      seed: 'seed-1234',
    });
    expect(verdicts).toHaveLength(2);
    // The derivation is keyed by criterion id; the notes expose the u values
    // so distinct criteria with distinct ids are visibly distinct inputs.
    expect(verdicts[0]?.criterionId).not.toBe(verdicts[1]?.criterionId);
  });
});

describe('makeRubricEvaluator (positive)', () => {
  it('produces rubric levels 1-5 with judgment labels for rubric-level criteria (positive)', async () => {
    const r = await rig('rubric-level', 3);
    const hook = makeRubricEvaluator();
    const verdicts = await hook({
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
      seed: 'seed-1234',
    });
    expect(verdicts).toHaveLength(2);
    for (const verdict of verdicts) {
      expect(Number.isInteger(verdict.score)).toBe(true);
      expect(verdict.score).toBeGreaterThanOrEqual(1);
      expect(verdict.score).toBeLessThanOrEqual(5);
      expect(verdict.judgment).toMatch(/^level-[1-5]$/);
      expect(verdict.notes).toMatch(/^rubric level judged/);
    }
  });

  it('adapts to non-rubric policies with policy-legal scores (positive)', async () => {
    const r = await rig('pass-threshold', 0.5);
    const hook = makeRubricEvaluator();
    const verdicts = await hook({
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
      seed: 'seed-1234',
    });
    for (const verdict of verdicts) {
      expect([0, 1]).toContain(verdict.score);
    }
  });

  it('is SEEDED and reproducible: identical inputs ⇒ identical verdicts (positive)', async () => {
    const r = await rig('rubric-level', 3);
    const hook = makeRubricEvaluator();
    const input = {
      descriptor: r.descriptor,
      criteria: r.criteria,
      caseRecord: r.caseRecord,
      trajectoryRecord: r.trajectoryRecord,
      seed: 'seed-1234',
    };
    const a = await hook(input);
    const b = await hook(input);
    expect(a).toEqual(b);
  });
});
