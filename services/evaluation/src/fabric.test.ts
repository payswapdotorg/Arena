/**
 * EvaluationFabric tests (Work Order A012 gate 6): the runner's pure
 * orchestration end-to-end against REAL A005/A011 objects — happy
 * path, input-contract negatives, seed contract, idempotency
 * (replay + conflict), record ledger queries, and score stability
 * through the whole fabric.
 */

import { describe, expect, it } from 'vitest';
import { EVALUATION_ERROR_CODES, recomputeEvaluationRecordDigest } from '@arena/evaluation';
import { makeRunEvaluationCommand, makeEvaluationRecordedEvent } from '@arena/evaluation';
import { serializeEnvelope, toCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { appendTrajectoryEntry, openTrajectory } from '@arena/trajectory';
import { EvaluationFabric } from './fabric.js';
import { makeDeterministicTestEvaluator } from './evaluators.js';
import {
  T1,
  T2,
  T3,
  T_OTHER_DAY,
  buildCase,
  buildCriteria,
  buildDescriptorInput,
  buildFabric,
  buildTrajectory,
} from './test-support.js';

const CORR = toCorrelationId('corr-a012-fabric-0001');
const IDEM = toIdempotencyKey('idem-a012-fabric-0001');

describe('EvaluationFabric.evaluate — happy path (positive)', () => {
  it('runs a seeded deterministic-test evaluation end-to-end against REAL case + trajectory objects', async () => {
    const { fabric, caseRecord, trajectoryRecord, criteria, deterministicEvaluator } =
      await buildFabric();
    const record = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(record.evaluatorRef).toBe(deterministicEvaluator.digest);
    expect(record.caseRef).toBe(caseRecord.digest);
    expect(record.trajectoryRef).toBe(trajectoryRecord.chainHead);
    expect(record.criteriaRef).toBe(criteria.digest);
    expect(record.seed).toBe('seed-1234');
    expect(record.verdicts).toHaveLength(criteria.entries.length);
    expect(record.aggregate.outcome === 'meets-criteria' || record.aggregate.outcome === 'below-criteria').toBe(true);
    expect(record.confidence).toBe(deterministicEvaluator.confidence);
    expect(record.provenance.executedBy).toBe(deterministicEvaluator.evaluatorId);
    expect(Object.isFrozen(record)).toBe(true);
    await expect(recomputeEvaluationRecordDigest(record)).resolves.toBe(record.digest);
    // the record is in the ledger
    expect(fabric.getRecord(record.digest)?.digest).toBe(record.digest);
  });

  it('runs the rubric evaluator too (both reference implementations wired)', async () => {
    const { fabric, caseRecord, trajectoryRecord, rubricEvaluator } = await buildFabric();
    const record = await fabric.evaluate(rubricEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-5678',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(record.evaluatorRef).toBe(rubricEvaluator.digest);
    expect(record.provenance.executedBy).toBe(rubricEvaluator.evaluatorId);
  });

  it('round-trips the gate-5 envelope wiring around a real run (command → evaluate → event)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const command = makeRunEvaluationCommand(
      {
        evaluatorRef: deterministicEvaluator.digest,
        caseRef: caseRecord.digest,
        trajectoryRef: trajectoryRecord.chainHead,
        seed: 'seed-1234',
      },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(serializeEnvelope(command)).toContain('run-evaluation-command');
    const record = await fabric.evaluate(
      command.payload.evaluatorRef,
      caseRecord,
      trajectoryRecord,
      {
        seed: command.payload.seed,
        ...(command.idempotencyKey !== null ? { idempotencyKey: command.idempotencyKey } : {}),
        startedAt: T1,
        finishedAt: T2,
      },
    );
    const event = makeEvaluationRecordedEvent(
      { record },
      { correlationId: CORR, idempotencyKey: IDEM },
    );
    expect(event.kind).toBe('event');
    expect(event.payload.record.digest).toBe(record.digest);
    expect(event.idempotencyKey).toBe(IDEM);
  });
});

describe('EvaluationFabric.evaluate — ref resolution negatives', () => {
  it('unknown evaluator digest ⇒ EVALUATION_NOT_FOUND', async () => {
    const { fabric, caseRecord, trajectoryRecord } = await buildFabric();
    await expect(
      fabric.evaluate('0'.repeat(64), caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.NOT_FOUND }),
    );
    await expect(
      fabric.evaluate('0'.repeat(64), caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(/no evaluator registered/);
  });

  it("missing criteria for the descriptor's criteriaRef ⇒ EVALUATION_NOT_FOUND", async () => {
    const fabric = new EvaluationFabric();
    const caseRecord = await buildCase();
    const trajectoryRecord = await buildTrajectory();
    const criteria = await buildCriteria(caseRecord.digest, trajectoryRecord.chainHead);
    // register the EVALUATOR but not the criteria
    const descriptor = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
    );
    fabric.registry.registerEvaluator(descriptor, makeDeterministicTestEvaluator());
    await expect(
      fabric.evaluate(descriptor.digest, caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(/no criteria registered/);
  });
});

describe('EvaluationFabric.evaluate — input-contract negatives (digest bindings to the REAL packages)', () => {
  it('a structurally invalid case object is rejected', async () => {
    const { fabric, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, { digest: 'x' } as never, trajectoryRecord, {
        seed: 'seed-1234',
      }),
    ).rejects.toThrowError(/not a structurally valid A005 CapabilityCase/);
  });

  it('a structurally invalid trajectory object is rejected', async () => {
    const { fabric, caseRecord, deterministicEvaluator } = await buildFabric();
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, caseRecord, { chainHead: 'x' } as never, {
        seed: 'seed-1234',
      }),
    ).rejects.toThrowError(/not a structurally valid A011 TrajectoryRecord/);
  });

  it('a case digest that does not match the pinned caseRef is rejected (INVALID_INPUT_CONTRACT)', async () => {
    const { fabric, trajectoryRecord } = await buildFabric();
    void fabric;
    const otherCase = await buildCase();
    const fresh = new EvaluationFabric();
    // criteria + evaluator pin case digest 'f'.repeat(64); the fed case is the REAL one
    const criteria = await buildCriteria('f'.repeat(64), trajectoryRecord.chainHead);
    const forgedDescriptor = await buildDescriptorInput(
      'f'.repeat(64),
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-forged-case' },
    );
    fresh.registry.registerCriteria(criteria);
    fresh.registry.registerEvaluator(forgedDescriptor, makeDeterministicTestEvaluator());
    await expect(
      fresh.evaluate(forgedDescriptor.digest, otherCase, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT }),
    );
    await expect(
      fresh.evaluate(forgedDescriptor.digest, otherCase, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(/pins case digest/);
  });

  it('a trajectory that does not match the pinned trajectoryRef is rejected', async () => {
    const { fabric, caseRecord, deterministicEvaluator } = await buildFabric();
    const otherTrajectory = await openTrajectory({
      trajectoryId: 'trajectory-other',
      run: {
        taskVersion: { taskId: 'task-other', version: '1.0.0' },
        environmentVersion: {
          namespace: 'tenant-a',
          name: 'erp-close-sandbox',
          version: '1.4.0',
          digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        },
        runId: 'tenant-a/run-other',
        initialSnapshotDigest: '2'.repeat(64),
        runRecordDigest: '3'.repeat(64),
      },
      agentBodyRef: '4'.repeat(64),
      substrateRef: '5'.repeat(64),
      startedAt: T1,
      seed: 'seed-1234',
    });
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, caseRecord, otherTrajectory, {
        seed: 'seed-1234',
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_INPUT_CONTRACT }),
    );
  });

  it('a body-ref pin that contradicts the trajectory header is rejected', async () => {
    const { fabric, caseRecord, trajectoryRecord, criteria } = await buildFabric();
    const pinned = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-body-pin', bodyRef: '9'.repeat(64) },
    );
    fabric.registry.registerEvaluator(pinned, makeDeterministicTestEvaluator());
    await expect(
      fabric.evaluate(pinned.digest, caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(/pins body digest/);
  });

  it('a substrate-ref pin that contradicts the trajectory header is rejected', async () => {
    const { fabric, caseRecord, trajectoryRecord, criteria } = await buildFabric();
    const pinned = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-substrate-pin', substrateRef: '9'.repeat(64) },
    );
    fabric.registry.registerEvaluator(pinned, makeDeterministicTestEvaluator());
    await expect(
      fabric.evaluate(pinned.digest, caseRecord, trajectoryRecord, { seed: 'seed-1234' }),
    ).rejects.toThrowError(/pins substrate digest/);
  });
});

describe('EvaluationFabric.evaluate — seed contract (negative)', () => {
  it('a SEEDED evaluator without a run seed is rejected (INVALID_REPRODUCIBILITY)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {}),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_REPRODUCIBILITY }),
    );
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {}),
    ).rejects.toThrowError(/requires a run seed/);
  });

  it('an UNSEEDED evaluator runs fine without a seed (positive)', async () => {
    const { fabric, caseRecord, trajectoryRecord, criteria } = await buildFabric();
    const unseeded = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryRecord.chainHead,
      criteria.digest,
      { evaluatorId: 'eval-unseeded', seeded: false },
    );
    fabric.registry.registerEvaluator(unseeded, makeDeterministicTestEvaluator());
    const record = await fabric.evaluate(unseeded.digest, caseRecord, trajectoryRecord, {
      startedAt: T1,
      finishedAt: T2,
    });
    expect(record.seed).toBeNull();
  });
});

describe('EvaluationFabric.evaluate — idempotency (architecture-lock rule 17)', () => {
  it('the same key + the same command replays the SAME record (positive)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const options = {
      idempotencyKey: 'idem-replay-1',
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    };
    const first = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, options);
    const second = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, options);
    expect(second.digest).toBe(first.digest);
    expect(second).toBe(first);
    expect(fabric.listRecords()).toHaveLength(1);
  });

  it('the same key + a DIFFERENT command is an IDEMPOTENCY_CONFLICT (negative)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      idempotencyKey: 'idem-conflict-1',
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    await expect(
      fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
        idempotencyKey: 'idem-conflict-1',
        seed: 'seed-5678', // different command tuple under the same key
        startedAt: T1,
        finishedAt: T2,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.IDEMPOTENCY_CONFLICT }),
    );
    // the original run is untouched
    expect(fabric.listRecords()).toHaveLength(1);
  });

  it('different keys may run the same command and produce the same content-addressed record (positive)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const base = { seed: 'seed-1234', startedAt: T1, finishedAt: T2 };
    const a = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      ...base,
      idempotencyKey: 'idem-a',
    });
    const b = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      ...base,
      idempotencyKey: 'idem-b',
    });
    expect(b.digest).toBe(a.digest); // content-addressed: identical command ⇒ identical record
    expect(fabric.listRecords()).toHaveLength(1); // ledger dedups by digest
  });
});

describe('EvaluationFabric — score stability through the whole fabric (gate 11)', () => {
  it('same evaluator + case + trajectory + seed ⇒ identical record digests across independent runs', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const a = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    const b = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(b.digest).toBe(a.digest);
    expect(b.aggregate).toEqual(a.aggregate);
  });

  it('a different seed ⇒ a different record (reruns are seed-addressed)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const a = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    const b = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-5678',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(b.digest).not.toBe(a.digest);
    expect(fabric.listRecords()).toHaveLength(2);
  });
});

describe('EvaluationFabric — record ledger queries (gate 6)', () => {
  it('queries by case, by trajectory, by digest and by time range (positive)', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator, rubricEvaluator } =
      await buildFabric();
    await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    await fabric.evaluate(rubricEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-5678',
      startedAt: T2,
      finishedAt: T3,
    });

    expect(fabric.listRecordsByCase(caseRecord.digest)).toHaveLength(2);
    expect(fabric.listRecordsByTrajectory(trajectoryRecord.chainHead)).toHaveLength(2);
    expect(fabric.listRecordsByCase('9'.repeat(64))).toEqual([]);
    expect(fabric.listRecordsByTrajectory('9'.repeat(64))).toEqual([]);

    const onlyEarly = fabric.listRecordsByTimeRange({ from: T1, to: T2 });
    expect(onlyEarly).toHaveLength(1);
    expect(onlyEarly[0]?.finishedAt).toBe(T2);
    const all = fabric.listRecordsByTimeRange({ from: T1, to: T3 });
    expect(all).toHaveLength(2);
    const none = fabric.listRecordsByTimeRange({ from: T_OTHER_DAY, to: T_OTHER_DAY });
    expect(none).toEqual([]);
    // one-sided ranges
    expect(fabric.listRecordsByTimeRange({ to: T2 })).toHaveLength(1);
    expect(fabric.listRecordsByTimeRange({ from: T3 })).toHaveLength(1);
  });

  it('invalid time-range bounds are rejected (negative)', () => {
    const fabric = new EvaluationFabric();
    expect(() => fabric.listRecordsByTimeRange({ from: 'nope' })).toThrowError(
      expect.objectContaining({ code: EVALUATION_ERROR_CODES.INVALID_TIMESTAMP }),
    );
    expect(() => fabric.listRecordsByTimeRange({ to: 'nope' })).toThrowError(/invalid 'to'/);
  });

  it('records for distinct trajectories stay separate (index isolation)', async () => {
    const fabric = new EvaluationFabric();
    const caseRecord = await buildCase();
    const trajectoryA = await buildTrajectory();
    let trajectoryB = await openTrajectory({
      trajectoryId: 'trajectory-b',
      run: {
        taskVersion: { taskId: 'task-monthly-close', version: '2.1.0' },
        environmentVersion: {
          namespace: 'tenant-a',
          name: 'erp-close-sandbox',
          version: '1.4.0',
          digest: 'e1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        },
        runId: 'tenant-a/run-b',
        initialSnapshotDigest: '2'.repeat(64),
        runRecordDigest: '3'.repeat(64),
      },
      agentBodyRef: '4'.repeat(64),
      substrateRef: '5'.repeat(64),
      startedAt: T1,
      seed: 'seed-1234',
    });
    trajectoryB = await appendTrajectoryEntry(trajectoryB, {
      sequence: 1,
      kind: 'completion',
      payload: { outcome: 'completed', evidenceDigests: [] },
      occurredAt: T2,
    });
    const criteriaA = await buildCriteria(caseRecord.digest, trajectoryA.chainHead, 'criteria-traj-a');
    const criteriaB = await buildCriteria(caseRecord.digest, trajectoryB.chainHead, 'criteria-traj-b');
    const evalA = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryA.chainHead,
      criteriaA.digest,
      { evaluatorId: 'eval-traj-a' },
    );
    const evalB = await buildDescriptorInput(
      caseRecord.digest,
      trajectoryB.chainHead,
      criteriaB.digest,
      { evaluatorId: 'eval-traj-b' },
    );
    fabric.registry.registerCriteria(criteriaA);
    fabric.registry.registerCriteria(criteriaB);
    fabric.registry.registerEvaluator(evalA, makeDeterministicTestEvaluator());
    fabric.registry.registerEvaluator(evalB, makeDeterministicTestEvaluator());
    await fabric.evaluate(evalA.digest, caseRecord, trajectoryA, {
      seed: 'seed-1',
      startedAt: T1,
      finishedAt: T2,
    });
    await fabric.evaluate(evalB.digest, caseRecord, trajectoryB, {
      seed: 'seed-2',
      startedAt: T1,
      finishedAt: T2,
    });
    expect(fabric.listRecordsByTrajectory(trajectoryA.chainHead)).toHaveLength(1);
    expect(fabric.listRecordsByTrajectory(trajectoryB.chainHead)).toHaveLength(1);
    expect(fabric.listRecordsByCase(caseRecord.digest)).toHaveLength(2);
    expect(fabric.listRecords()).toHaveLength(2);
  });
});

describe('EvaluationFabric — no mutation surface on stored records (negative)', () => {
  it('mutating a ledger record throws TypeError; the ledger keeps the original bytes', async () => {
    const { fabric, caseRecord, trajectoryRecord, deterministicEvaluator } = await buildFabric();
    const record = await fabric.evaluate(deterministicEvaluator.digest, caseRecord, trajectoryRecord, {
      seed: 'seed-1234',
      startedAt: T1,
      finishedAt: T2,
    });
    const mutate = record as unknown as { confidence?: number };
    expect(() => {
      mutate['confidence'] = 0.05;
    }).toThrowError(TypeError);
    expect(fabric.getRecord(record.digest)?.confidence).toBe(record.confidence);
  });
});
