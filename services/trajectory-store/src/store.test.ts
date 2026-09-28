/**
 * TrajectoryStore tests — the in-process reference store (Work Order
 * A011 gate 6): idempotent opens, validated appends with chained-digest
 * computation, addressability by id / digest, queries by run ref /
 * body ref / time range, the replay API, and the append-only
 * persistence guarantee (no update/delete APIs — negative tests).
 */

import { describe, expect, it } from 'vitest';
import { verifyTrajectoryRecord } from '@arena/trajectory';
import { TRAJECTORY_ERROR_CODES } from '@arena/trajectory';
import { TrajectoryStore } from './store.js';
import type { TrajectoryRecord } from '@arena/trajectory';
import {
  DIGEST_D,
  T0,
  T1,
  T2,
  T3,
  T6,
  T_OTHER_DAY,
  makeStoreHeaderInput,
  storeActionInput,
  storeCompletionInput,
  storeObservationInput,
} from './test-support.js';

async function openDefault(store: TrajectoryStore): Promise<TrajectoryRecord> {
  return store.open(makeStoreHeaderInput());
}

describe('open — idempotent by trajectory id (gate 6)', () => {
  it('creates the empty trajectory and returns it', async () => {
    const store = new TrajectoryStore();
    const record = await openDefault(store);
    expect(record.header.trajectoryId).toBe('trajectory-000042');
    expect(record.entries).toEqual([]);
    expect(record.chainHead).toBe(record.header.digest);
  });

  it('re-opening with the SAME header returns the same record (idempotent)', async () => {
    const store = new TrajectoryStore();
    const first = await openDefault(store);
    const second = await store.open(makeStoreHeaderInput());
    expect(second).toBe(first);
    const all = await store.list();
    expect(all).toHaveLength(1);
  });

  it('re-opening with a DIFFERENT header is an identity conflict (negative)', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    await expect(
      store.open(makeStoreHeaderInput({ agentBodyRef: 'f'.repeat(64) })),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.IDENTITY_CONFLICT }),
    );
    await expect(
      store.open(makeStoreHeaderInput({ trajectoryId: 'UPPER' })),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
  });

  it('two trajectories with different ids coexist', async () => {
    const store = new TrajectoryStore();
    const a = await store.open(makeStoreHeaderInput({ trajectoryId: 'trajectory-a' }));
    const b = await store.open(makeStoreHeaderInput({ trajectoryId: 'trajectory-b' }));
    expect(a.header.trajectoryId).toBe('trajectory-a');
    expect(b.header.trajectoryId).toBe('trajectory-b');
    expect(await store.list()).toHaveLength(2);
  });
});

describe('append — validation + chained digest computation (gate 6)', () => {
  it('appends through the domain protocol and returns the receipt', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const receipt = await store.append('trajectory-000042', storeActionInput(1, T0, 'build'));
    expect(receipt.sequence).toBe(1);
    expect(receipt.stepDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(receipt.chainHead).toBe(receipt.stepDigest);
    expect(receipt.record.entries).toHaveLength(1);
    await expect(verifyTrajectoryRecord(receipt.record)).resolves.toBe(receipt.chainHead);
  });

  it('the store computes digests; caller-side digest fields are not part of the input', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const first = await store.append('trajectory-000042', storeActionInput(1, T0));
    const second = await store.append('trajectory-000042', storeObservationInput(2, T1));
    expect(second.record.entries[1]?.prevDigest).toBe(first.stepDigest);
    expect(second.chainHead).toBe(second.stepDigest);
  });

  it('unknown trajectory ids fail closed with NOT_FOUND (negative)', async () => {
    const store = new TrajectoryStore();
    await expect(store.append('trajectory-ghost', storeActionInput(1, T0))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.NOT_FOUND }),
    );
  });

  it('domain invariants are enforced at the store boundary (negatives)', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    await expect(store.append('trajectory-000042', storeActionInput(2, T0))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_GAP }),
    );
    const withOne = await store.append('trajectory-000042', storeActionInput(1, T1));
    await expect(store.append('trajectory-000042', storeActionInput(1, T2))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_REGRESSION }),
    );
    await expect(store.append('trajectory-000042', storeActionInput(2, T0))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TIMESTAMP_REGRESSION }),
    );
    await expect(
      store.append('trajectory-000042', {
        sequence: 2,
        kind: 'action',
        payload: { actionId: 'UPPER' },
        occurredAt: T2,
      }),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(withOne.record.entries).toHaveLength(1);
  });

  it('append-after-completion is rejected (gate 6 negative)', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    await store.append('trajectory-000042', storeActionInput(1, T0));
    await store.append('trajectory-000042', storeCompletionInput(2, T1));
    await expect(
      store.append('trajectory-000042', storeActionInput(3, T2)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED }),
    );
  });

  it('idempotency keys: same key + same input replays as no-op; different input conflicts', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const first = await store.append(
      'trajectory-000042',
      storeActionInput(1, T0),
      { idempotencyKey: 'append-key-1' },
    );
    const replayed = await store.append(
      'trajectory-000042',
      storeActionInput(1, T0),
      { idempotencyKey: 'append-key-1' },
    );
    expect(replayed.sequence).toBe(1);
    expect(replayed.stepDigest).toBe(first.stepDigest);
    expect(replayed.record.entries).toHaveLength(1); // no duplicate
    await expect(
      store.append(
        'trajectory-000042',
        storeActionInput(1, T0, 'different-args'),
        { idempotencyKey: 'append-key-1' },
      ),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.IDEMPOTENCY_CONFLICT }),
    );
    // After the replay, the next sequence is still 2.
    const second = await store.append('trajectory-000042', storeObservationInput(2, T1));
    expect(second.record.entries).toHaveLength(2);
  });

  it('an idempotent replay AFTER further appends still returns the current record', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const first = await store.append('trajectory-000042', storeActionInput(1, T0), {
      idempotencyKey: 'append-key-x',
    });
    await store.append('trajectory-000042', storeObservationInput(2, T1));
    await store.append('trajectory-000042', storeCompletionInput(3, T2));
    const replayed = await store.append('trajectory-000042', storeActionInput(1, T0), {
      idempotencyKey: 'append-key-x',
    });
    expect(replayed.stepDigest).toBe(first.stepDigest);
    expect(replayed.record.entries).toHaveLength(3); // current version
    expect(replayed.chainHead).not.toBe(first.chainHead);
  });
});

describe('getById / getByDigest — addressability (gate 6)', () => {
  it('getById returns the latest version', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    await store.append('trajectory-000042', storeActionInput(1, T0));
    await store.append('trajectory-000042', storeObservationInput(2, T1));
    const latest = await store.getById('trajectory-000042');
    expect(latest?.entries).toHaveLength(2);
    expect(await store.getById('trajectory-ghost')).toBeUndefined();
  });

  it('getByDigest returns EVERY historical version (append-only storage)', async () => {
    const store = new TrajectoryStore();
    const empty = await openDefault(store);
    const v1 = await store.append('trajectory-000042', storeActionInput(1, T0));
    const v2 = await store.append('trajectory-000042', storeObservationInput(2, T1));
    const v3 = await store.append('trajectory-000042', storeCompletionInput(3, T2));

    expect(await store.getByDigest(empty.chainHead)).toBe(empty);
    expect(await store.getByDigest(v1.chainHead)).toBe(v1.record);
    expect(await store.getByDigest(v2.chainHead)).toBe(v2.record);
    expect(await store.getByDigest(v3.chainHead)).toBe(v3.record);
    // Header digest addresses the EMPTY version.
    expect((await store.getByDigest(empty.header.digest))?.entries).toEqual([]);
    // Unknown digest → undefined.
    expect(await store.getByDigest('e'.repeat(64))).toBeUndefined();
    // All returned versions verify.
    for (const version of [empty, v1.record, v2.record, v3.record]) {
      await expect(verifyTrajectoryRecord(version)).resolves.toBeDefined();
    }
  });

  it('previously returned versions stay valid after further appends', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const v1 = (await store.append('trajectory-000042', storeActionInput(1, T0))).record;
    await store.append('trajectory-000042', storeObservationInput(2, T1));
    await store.append('trajectory-000042', storeCompletionInput(3, T2));
    expect(v1.entries).toHaveLength(1); // untouched
    expect(await store.getByDigest(v1.chainHead)).toBe(v1);
  });
});

describe('queries — by run ref / body ref / time range (gate 6)', () => {
  async function seed(store: TrajectoryStore): Promise<void> {
    await store.open(
      makeStoreHeaderInput({ trajectoryId: 'trajectory-a', runKey: 'run-a' }),
    );
    await store.open(
      makeStoreHeaderInput({
        trajectoryId: 'trajectory-b',
        runKey: 'run-b',
        agentBodyRef: 'f'.repeat(64),
        startedAt: T_OTHER_DAY,
      }),
    );
    await store.open(
      makeStoreHeaderInput({
        trajectoryId: 'trajectory-c',
        runKey: 'run-a',
        initialSnapshotDigest: '9'.repeat(64),
      }),
    );
  }

  it('findByRunRef matches all four address parts', async () => {
    const store = new TrajectoryStore();
    await seed(store);
    const header = makeStoreHeaderInput({ runKey: 'run-a' });
    const matches = await store.findByRunRef(header.run);
    expect(matches.map((record) => record.header.trajectoryId)).toEqual(['trajectory-a']);
    // A different initial snapshot digest is a different run binding.
    const other = await store.findByRunRef({
      ...header.run,
      initialSnapshotDigest: '9'.repeat(64),
    });
    expect(other.map((record) => record.header.trajectoryId)).toEqual(['trajectory-c']);
    // A different run id matches nothing.
    expect(await store.findByRunRef({ ...header.run, runId: 'tenant-a/run-zzz' })).toEqual([]);
  });

  it('findByBodyRef matches the agent/body digest', async () => {
    const store = new TrajectoryStore();
    await seed(store);
    const mine = await store.findByBodyRef(DIGEST_D);
    expect(mine.map((record) => record.header.trajectoryId).sort()).toEqual([
      'trajectory-a',
      'trajectory-c',
    ]);
    const other = await store.findByBodyRef('f'.repeat(64));
    expect(other.map((record) => record.header.trajectoryId)).toEqual(['trajectory-b']);
    expect(await store.findByBodyRef('0'.repeat(64))).toEqual([]);
  });

  it('findByTimeRange filters inclusively on started-at', async () => {
    const store = new TrajectoryStore();
    await seed(store);
    const all = await store.findByTimeRange({});
    expect(all).toHaveLength(3);
    const january = await store.findByTimeRange({ from: T0, to: T6 });
    expect(january.map((record) => record.header.trajectoryId)).toEqual([
      'trajectory-a',
      'trajectory-c',
    ]);
    const fromT1 = await store.findByTimeRange({ from: T1 });
    expect(fromT1.map((record) => record.header.trajectoryId)).toEqual([
      'trajectory-b',
    ]);
    const toT0 = await store.findByTimeRange({ to: T0 });
    expect(toT0.map((record) => record.header.trajectoryId)).toEqual([
      'trajectory-a',
      'trajectory-c',
    ]);
    await expect(store.findByTimeRange({ from: T6, to: T0 })).rejects.toThrowError(
      /inverted/,
    );
    await expect(store.findByTimeRange({ from: 'not-a-time' })).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_TIMESTAMP }),
    );
  });

  it('list returns every latest version deterministically ordered', async () => {
    const store = new TrajectoryStore();
    await seed(store);
    const all = await store.list();
    expect(all.map((record) => record.header.trajectoryId)).toEqual([
      'trajectory-a',
      'trajectory-c',
      'trajectory-b', // T_OTHER_DAY sorts last
    ]);
    expect(Object.isFrozen(all)).toBe(true);
  });
});

describe('replay — the ordered entry stream (gate 6)', () => {
  it('replays the latest version in appended order', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    for (const [input, at] of [
      [storeActionInput(1, T0), T0],
      [storeObservationInput(2, T1), T1],
      [storeActionInput(3, T2), T2],
      [storeCompletionInput(4, T3), T3],
    ] as const) {
      await store.append('trajectory-000042', input);
      void at;
    }
    const stream = await store.replay('trajectory-000042');
    expect(stream.map((entry) => entry.sequence)).toEqual([1, 2, 3, 4]);
    expect(stream.map((entry) => entry.kind)).toEqual([
      'action',
      'observation',
      'action',
      'completion',
    ]);
    await expect(store.replay('trajectory-ghost')).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.NOT_FOUND }),
    );
  });

  it('replayAt pins the entry stream to a chain-head digest', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    const v1 = await store.append('trajectory-000042', storeActionInput(1, T0));
    await store.append('trajectory-000042', storeObservationInput(2, T1));
    await store.append('trajectory-000042', storeCompletionInput(3, T2));
    const pinned = await store.replayAt(v1.chainHead);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.kind).toBe('action');
    await expect(store.replayAt('e'.repeat(64))).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.NOT_FOUND }),
    );
  });
});

describe('append-only persistence guarantee (gate 6 negatives)', () => {
  it('mutating a returned record throws (deep-frozen domain objects)', async () => {
    const store = new TrajectoryStore();
    const record = await openDefault(store);
    expect(() => {
      (record as unknown as { chainHead: string }).chainHead = 'f'.repeat(64);
    }).toThrowError(TypeError);
    const receipt = await store.append('trajectory-000042', storeActionInput(1, T0));
    expect(() => {
      (receipt.record.entries as unknown as unknown[]).push(receipt.record.entries[0] as never);
    }).toThrowError(TypeError);
    expect(() => {
      (receipt.record.entries[0] as unknown as { sequence: number }).sequence = 99;
    }).toThrowError(TypeError);
  });

  it('the store surface exposes NO update/delete-style methods', async () => {
    const methodNames = Object.getOwnPropertyNames(TrajectoryStore.prototype);
    for (const forbidden of [
      'update',
      'delete',
      'remove',
      'replace',
      'patch',
      'drop',
      'clear',
      'truncate',
      'overwrite',
      'rewrite',
      'editEntry',
      'updateEntry',
      'deleteEntry',
    ]) {
      expect(methodNames, `store must not expose '${forbidden}'`).not.toContain(forbidden);
    }
    for (const expected of [
      'open',
      'append',
      'getById',
      'getByDigest',
      'findByRunRef',
      'findByBodyRef',
      'findByTimeRange',
      'list',
      'replay',
      'replayAt',
    ]) {
      expect(methodNames).toContain(expected);
    }
  });

  it('rejected operations leave the stored state untouched', async () => {
    const store = new TrajectoryStore();
    await openDefault(store);
    await store.append('trajectory-000042', storeActionInput(1, T0));
    const before = await store.getById('trajectory-000042');
    const attempts = [
      store.append('trajectory-000042', storeActionInput(3, T1)), // gap
      store.append('trajectory-ghost', storeActionInput(1, T0)), // unknown id
      store.open(makeStoreHeaderInput({ agentBodyRef: 'f'.repeat(64) })), // conflict
    ];
    for (const attempt of attempts) {
      await expect(attempt).rejects.toThrowError();
    }
    const after = await store.getById('trajectory-000042');
    expect(after).toBe(before);
    expect(await store.list()).toHaveLength(1);
  });
});
