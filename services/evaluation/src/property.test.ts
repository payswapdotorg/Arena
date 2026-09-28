/**
 * Determinism property tests for the reference fabric (Work Order
 * A012 gate 11) — seeded LCG (test-support's TestLcg — Numerical
 * Recipes constants; no Math.random, no wall-clock reads).
 *
 * Invariants:
 *   P1 registry idempotency — repeated registration of the same
 *      LCG-generated descriptor never grows the registry and always
 *      returns the identical binding;
 *   P2 fabric score stability — repeated evaluate() runs with the
 *      same refs + seed + fixed timestamps produce the identical
 *      record digest (the quality-model rerun requirement), and
 *      ledger size stays bounded by distinct records;
 *   P3 conflicts stay consistent — the same identity under different
 *      bytes always conflicts, never silently overwrites;
 *   P4 different seeds diverge through the whole fabric.
 */

import { describe, expect, it } from 'vitest';
import { createEvaluatorDescriptor } from '@arena/evaluation';
import { EVALUATION_ERROR_CODES } from '@arena/evaluation';
import { EvaluationFabric } from './fabric.js';
import { makeDeterministicTestEvaluator } from './evaluators.js';
import {
  TestLcg,
  buildCase,
  buildCriteria,
  buildDescriptorInput,
  buildTrajectory,
} from './test-support.js';

const SEEDS = [1, 42, 20260926, 777, 314159];
const T1 = '2026-03-01T12:00:01.000Z';
const T2 = '2026-03-01T12:00:02.000Z';

async function randomDescriptor(seed: number, caseDigest: string, trajectoryDigest: string, criteriaDigest: string) {
  const rng = new TestLcg(seed);
  const kinds = ['deterministic-test', 'rubric', 'model-based', 'expert', 'simulation', 'comparative', 'adversarial'] as const;
  const kind = kinds[rng.int(7)] as (typeof kinds)[number];
  const human = kind === 'expert';
  return createEvaluatorDescriptor({
    evaluatorId: `eval-prop-${String(seed)}`,
    version: `${1 + rng.int(3)}.${rng.int(5)}.${rng.int(7)}`,
    kind,
    inputs: {
      caseRef: caseDigest,
      trajectoryRef: trajectoryDigest,
      bodyRef: rng.bool() ? 'b'.repeat(64) : null,
      substrateRef: rng.bool() ? 'c'.repeat(64) : null,
    },
    criteriaRef: criteriaDigest,
    outputSchema: { namespace: 'evaluation', name: 'evaluation-record', version: '1.0.0' },
    reproducibility: {
      deterministic: !human,
      seeded: rng.bool(),
      requiresHuman: human,
    },
    confidence: Math.round(rng.next() * 100) / 100,
    limitations: `property-generated evaluator ${String(seed)}`,
    provenance: {
      authoredBy: 'arena-reference-fabric',
      submittedAt: T1,
      notes: null,
    },
  });
}

describe('property: registry idempotency under repeated registration (P1)', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: registering the same descriptor many times keeps the registry at one entry and the identical binding`, async () => {
      const caseRecord = await buildCase();
      const trajectoryRecord = await buildTrajectory();
      const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
      const descriptor = await randomDescriptor(
        seed,
        caseRecord.digest,
        trajectoryRecord.chainHead,
        criteria.digest,
      );
      const fabric = new EvaluationFabric();
      const hook = makeDeterministicTestEvaluator();
      const first = fabric.registry.registerEvaluator(descriptor, hook);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const again = fabric.registry.registerEvaluator(descriptor, makeDeterministicTestEvaluator());
        expect(again).toBe(first);
      }
      expect(fabric.registry.listEvaluators()).toHaveLength(1);
      expect(fabric.registry.getEvaluator(descriptor.digest)).toBe(first);
      // criteria behave the same
      const storedCriteria = fabric.registry.registerCriteria(criteria);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect(fabric.registry.registerCriteria(criteria)).toBe(storedCriteria);
      }
      expect(fabric.registry.listCriteria()).toHaveLength(1);
    });
  }
});

describe('property: fabric score stability under rerun (P2 — quality model)', () => {
  for (const seed of SEEDS) {
    it(`seed ${String(seed)}: repeated evaluate() with identical refs + seed + fixed timestamps ⇒ identical record digests`, async () => {
      const caseRecord = await buildCase();
      const trajectoryRecord = await buildTrajectory();
      const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
      const descriptor = await buildDescriptorInput(
        caseRecord.digest,
        trajectoryRecord.chainHead,
        criteria.digest,
        { evaluatorId: `eval-stability-${String(seed)}`, kind: 'deterministic-test' },
      );
      const fabric = new EvaluationFabric();
      fabric.registry.registerCriteria(criteria);
      fabric.registry.registerEvaluator(descriptor, makeDeterministicTestEvaluator());
      const options = { seed: `seed-${String(seed)}`, startedAt: T1, finishedAt: T2 };
      const digests: string[] = [];
      for (let run = 0; run < 3; run += 1) {
        const record = await fabric.evaluate(descriptor.digest, caseRecord, trajectoryRecord, options);
        digests.push(record.digest);
      }
      expect(new Set(digests).size).toBe(1);
      expect(fabric.listRecords()).toHaveLength(1); // content-addressed dedup
    });
  }
});

describe('property: identity conflicts never silently overwrite (P3)', () => {
  for (const seed of SEEDS.slice(0, 3)) {
    it(`seed ${String(seed)}: same identity + different bytes always conflicts, registry stays at one entry`, async () => {
      const caseRecord = await buildCase();
      const trajectoryRecord = await buildTrajectory();
      const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
      const a = await randomDescriptor(seed, caseRecord.digest, trajectoryRecord.chainHead, criteria.digest);
      const b = await randomDescriptor(seed, caseRecord.digest, trajectoryRecord.chainHead, criteria.digest);
      // same LCG stream ⇒ same identity; force different bytes via confidence
      const mutatedInput = {
        evaluatorId: a.evaluatorId,
        version: a.version,
        kind: a.kind,
        inputs: { ...a.inputs },
        criteriaRef: a.criteriaRef,
        outputSchema: { ...a.outputSchema },
        reproducibility: { ...a.reproducibility },
        confidence: (a.confidence + 0.01) % 1,
        limitations: a.limitations,
        provenance: { ...a.provenance },
      };
      const bMutated = await createEvaluatorDescriptor(mutatedInput);
      void b;
      const fabric = new EvaluationFabric();
      fabric.registry.registerEvaluator(a, makeDeterministicTestEvaluator());
      expect(() =>
        fabric.registry.registerEvaluator(bMutated, makeDeterministicTestEvaluator()),
      ).toThrowError(
        expect.objectContaining({ code: EVALUATION_ERROR_CODES.IDENTITY_CONFLICT }),
      );
      expect(fabric.registry.listEvaluators()).toHaveLength(1);
      expect(fabric.registry.getEvaluator(a.digest)?.descriptor.digest).toBe(a.digest);
    });
  }
});

describe('property: different seeds diverge through the whole fabric (P4)', () => {
  it('distinct run seeds produce distinct records (non-degenerate harness)', async () => {
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    const descriptor = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
    );
    const fabric = new EvaluationFabric();
    fabric.registry.registerCriteria(criteria);
    fabric.registry.registerEvaluator(descriptor, makeDeterministicTestEvaluator());
    const digests: string[] = [];
    for (const seed of ['alpha', 'beta', 'gamma', 'delta']) {
      const record = await fabric.evaluate(descriptor.digest, caseRecord, trajectoryRecord, {
        seed,
        startedAt: T1,
        finishedAt: T2,
      });
      digests.push(record.digest);
    }
    expect(new Set(digests).size).toBe(digests.length);
    expect(fabric.listRecords()).toHaveLength(digests.length);
  });
});
