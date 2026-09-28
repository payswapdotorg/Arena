/**
 * EvaluatorRegistry tests (Work Order A012 gate 6): idempotent
 * registration by digest, identity-conflict negatives, lookups and
 * queries.
 */

import { describe, expect, it } from 'vitest';
import { createEvaluationCriteria } from '@arena/evaluation';
import { EVALUATION_ERROR_CODES } from '@arena/evaluation';
import { EvaluatorRegistry } from './registry.js';
import { makeDeterministicTestEvaluator } from './evaluators.js';
import {
  buildCase,
  buildCriteria,
  buildDescriptorInput,
  buildTrajectory,
} from './test-support.js';

const IDENTITY_CONFLICT = expect.objectContaining({
  code: EVALUATION_ERROR_CODES.IDENTITY_CONFLICT,
});

describe('EvaluatorRegistry — evaluator registration (positive + negative)', () => {
  it('registers evaluators and resolves them by digest (positive)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const descriptor = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
    );
    const hook = makeDeterministicTestEvaluator();
    const registration = registry.registerEvaluator(descriptor, hook);
    expect(registration.descriptor).toBe(descriptor);
    expect(registration.hook).toBe(hook);
    expect(registry.getEvaluator(descriptor.digest)?.descriptor).toBe(descriptor);
    expect(registry.listEvaluators()).toHaveLength(1);
  });

  it('re-registering the SAME descriptor is idempotent — the first hook binding wins (positive)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const descriptor = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
    );
    const firstHook = makeDeterministicTestEvaluator();
    const first = registry.registerEvaluator(descriptor, firstHook);
    const second = registry.registerEvaluator(descriptor, makeDeterministicTestEvaluator());
    expect(second).toBe(first);
    expect(registry.getEvaluator(descriptor.digest)?.hook).toBe(firstHook);
    expect(registry.listEvaluators()).toHaveLength(1);
  });

  it('registering a DIFFERENT digest under the same id+version is an identity conflict (negative — gate 6)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const a = await buildDescriptorInput(caseRecord.digest, trajectoryRecord.chainHead, criteria.digest, {
      confidence: 0.9,
    });
    const b = await buildDescriptorInput(caseRecord.digest, trajectoryRecord.chainHead, criteria.digest, {
      confidence: 0.4, // same id+version, different bytes
    });
    registry.registerEvaluator(a, makeDeterministicTestEvaluator());
    expect(() => registry.registerEvaluator(b, makeDeterministicTestEvaluator())).toThrowError(
      IDENTITY_CONFLICT,
    );
    expect(() => registry.registerEvaluator(b, makeDeterministicTestEvaluator())).toThrowError(
      /requires a new version/,
    );
    // the original registration is untouched
    expect(registry.listEvaluators()).toHaveLength(1);
  });

  it('the same evaluator id under a NEW version registers cleanly (positive — versioning is the sanctioned path)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const v1 = await buildDescriptorInput(caseRecord.digest, trajectoryRecord.chainHead, criteria.digest, {
      version: '1.0.0',
    });
    const v2 = await buildDescriptorInput(caseRecord.digest, trajectoryRecord.chainHead, criteria.digest, {
      version: '1.1.0',
      confidence: 0.7,
    });
    registry.registerEvaluator(v1, makeDeterministicTestEvaluator());
    registry.registerEvaluator(v2, makeDeterministicTestEvaluator());
    expect(registry.listEvaluators()).toHaveLength(2);
  });

  it('rejects structurally invalid descriptors (negative)', async () => {
    const registry = new EvaluatorRegistry();
    expect(() => registry.registerEvaluator({ digest: 'x' } as never, () => [])).toThrowError(
      /structurally valid evaluator descriptor/,
    );
  });

  it('unknown digest lookups return undefined (negative)', () => {
    const registry = new EvaluatorRegistry();
    expect(registry.getEvaluator('0'.repeat(64))).toBeUndefined();
    expect(registry.getCriteria('0'.repeat(64))).toBeUndefined();
  });
});

describe('EvaluatorRegistry — queries by kind and case (gate 6)', () => {
  it('lists evaluators by kind and by pinned case digest (positive)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const deterministic = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-a', kind: 'deterministic-test' },
    );
    const rubric = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-b', kind: 'rubric', confidence: 0.8 },
    );
    const foreignCase = await buildDescriptorInput(
      'f'.repeat(64),
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-c', kind: 'model-based', deterministic: false, seeded: false },
    );
    registry.registerEvaluator(deterministic, makeDeterministicTestEvaluator());
    registry.registerEvaluator(rubric, makeDeterministicTestEvaluator());
    registry.registerEvaluator(foreignCase, makeDeterministicTestEvaluator());

    expect(registry.listEvaluatorsByKind('deterministic-test').map((d) => d.evaluatorId)).toEqual([
      'eval-a',
    ]);
    expect(registry.listEvaluatorsByKind('rubric').map((d) => d.evaluatorId)).toEqual(['eval-b']);
    expect(registry.listEvaluatorsByKind('adversarial')).toEqual([]);
    expect(registry.listEvaluatorsByCase(caseRecord.digest)).toHaveLength(2);
    expect(registry.listEvaluatorsByCase('f'.repeat(64))).toHaveLength(1);
    expect(registry.listEvaluatorsByCase('9'.repeat(64))).toEqual([]);
  });
});

describe('EvaluatorRegistry — criteria registration (positive + negative)', () => {
  it('registers criteria and resolves by digest; idempotent (positive)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const stored = registry.registerCriteria(criteria);
    expect(stored).toBe(criteria);
    expect(registry.getCriteria(criteria.digest)).toBe(criteria);
    expect(registry.registerCriteria(criteria)).toBe(criteria);
    expect(registry.listCriteria()).toHaveLength(1);
  });

  it('re-registering the same criteriaId+version with different bytes is a conflict (negative)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const a = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const b = await createEvaluationCriteria({
      criteriaId: 'criteria-invoice-reconciliation',
      version: '1.0.0',
      entries: [
        {
          criterionId: 'criterion-001',
          weight: 3, // different content, same identity
          description: 'credit notes are netted against partially paid invoices',
          targetRef: caseRecord.digest,
        },
      ],
      aggregation: 'weighted-sum',
      thresholds: { passAt: 0.75 },
    });
    registry.registerCriteria(a);
    expect(() => registry.registerCriteria(b)).toThrowError(IDENTITY_CONFLICT);
    expect(() => registry.registerCriteria(b)).toThrowError(/changing content requires a new version/);
    expect(registry.listCriteria()).toHaveLength(1);
  });

  it('a new version of the same criteria id registers cleanly (positive)', async () => {
    const registry = new EvaluatorRegistry();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const v1 = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const v2 = await createEvaluationCriteria({
      criteriaId: 'criteria-invoice-reconciliation',
      version: '1.1.0',
      entries: v1.entries.map((entry) => ({ ...entry })),
      aggregation: 'pass-threshold',
      thresholds: { passAt: 0.5 },
    });
    registry.registerCriteria(v1);
    registry.registerCriteria(v2);
    expect(registry.listCriteria()).toHaveLength(2);
  });
});
