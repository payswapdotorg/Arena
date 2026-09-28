/**
 * TrajectoryEntry tests — typed payloads per kind, ordering invariants
 * (contiguous strictly-increasing sequences, monotonic timestamps,
 * completion finality) and the CHAINED digest design: entry N commits to
 * entry N-1's stepDigest; mutating history changes every subsequent
 * digest. Positive AND negative paths (Work Order A011 gates 3, 11).
 */

import { describe, expect, it } from 'vitest';
import { digestCanonical } from '@arena/protocol-core';
import {
  OBSERVATION_CHANNELS,
  TRAJECTORY_ENTRY_KINDS,
  TRAJECTORY_OUTCOMES,
  computeTrajectoryStepDigest,
  createTrajectoryEntry,
  isTrajectoryEntry,
  isTrajectoryEntryKind,
  isTrajectoryEntryPayload,
  isTrajectoryEntryView,
  toTrajectoryEntryPayload,
  trajectoryEntryView,
  verifyTrajectoryEntry,
} from './entry.js';
import type {
  CreateTrajectoryEntryInput,
  TrajectoryChainTail,
  TrajectoryEntry,
} from './entry.js';
import { TRAJECTORY_ERROR_CODES } from './errors.js';
import { toContentDigest } from './shared.js';
import {
  DIGEST_A,
  DIGEST_B,
  DIGEST_F,
  T0,
  T1,
  T2,
  T3,
  makeActionInput,
  makeCheckpointInput,
  makeCompletionInput,
  makeErrorInput,
  makeObservationInput,
} from './test-support.js';

const EMPTY_TAIL: TrajectoryChainTail = Object.freeze({
  anchorDigest: toContentDigest(DIGEST_A, 'entry test anchor'),
  lastSequence: 0,
  lastOccurredAt: null,
  completed: false,
});

function tailAfter(entry: TrajectoryEntry): TrajectoryChainTail {
  return Object.freeze({
    anchorDigest: entry.stepDigest,
    lastSequence: entry.sequence,
    lastOccurredAt: entry.occurredAt,
    completed: entry.kind === 'completion',
  });
}

describe('closed vocabulary', () => {
  it('exposes exactly the five entry kinds', () => {
    expect([...TRAJECTORY_ENTRY_KINDS]).toEqual([
      'action',
      'observation',
      'checkpoint',
      'error',
      'completion',
    ]);
    expect(isTrajectoryEntryKind('action')).toBe(true);
    expect(isTrajectoryEntryKind('observation')).toBe(true);
    expect(isTrajectoryEntryKind('checkpoint')).toBe(true);
    expect(isTrajectoryEntryKind('error')).toBe(true);
    expect(isTrajectoryEntryKind('completion')).toBe(true);
    expect(isTrajectoryEntryKind('thought')).toBe(false);
    expect(isTrajectoryEntryKind(3)).toBe(false);
  });

  it('mirrors A009 observation channels and A010 outcome states', () => {
    expect([...OBSERVATION_CHANNELS]).toEqual([
      'stdout',
      'stderr',
      'files',
      'events',
      'metrics',
      'state-dump',
    ]);
    expect([...TRAJECTORY_OUTCOMES]).toEqual(['completed', 'failed', 'timed-out']);
  });
});

describe('typed payloads (gate 3)', () => {
  it('action: actionId + canonical JSON input, frozen', () => {
    const payload = toTrajectoryEntryPayload('action', {
      actionId: 'shell-exec',
      input: { command: 'make', args: ['test'] },
    });
    expect(payload).toEqual({
      actionId: 'shell-exec',
      input: { command: 'make', args: ['test'] },
    });
    expect(Object.isFrozen(payload)).toBe(true);
    expect(Object.isFrozen((payload as { input: object }).input)).toBe(true);
  });

  it('action: input is optional (null default)', () => {
    expect(toTrajectoryEntryPayload('action', { actionId: 'noop' })).toEqual({
      actionId: 'noop',
      input: null,
    });
  });

  it('action: rejects bad ids, non-object input and non-canonical input', () => {
    expect(() => toTrajectoryEntryPayload('action', { actionId: 'BAD' })).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_IDENTITY }),
    );
    expect(() =>
      toTrajectoryEntryPayload('action', { actionId: 'x', input: ['array'] }),
    ).toThrowError(/plain JSON object/);
    expect(() =>
      toTrajectoryEntryPayload('action', { actionId: 'x', input: { fn: () => 1 } }),
    ).toThrowError(/canonical-JSON serializable/);
    expect(() =>
      toTrajectoryEntryPayload('action', { actionId: 'x', input: { n: BigInt(1) } }),
    ).toThrowError(/canonical-JSON serializable/);
  });

  it('observation: observationId + closed channel + content', () => {
    const payload = toTrajectoryEntryPayload('observation', {
      observationId: 'stdout-tail',
      channel: 'stdout',
      content: 'ok',
    });
    expect(payload).toEqual({ observationId: 'stdout-tail', channel: 'stdout', content: 'ok' });
    expect(() =>
      toTrajectoryEntryPayload('observation', { observationId: 'x', channel: 'carrier-pigeon', content: 'ok' }),
    ).toThrowError(/channel must be one of/);
    expect(() =>
      toTrajectoryEntryPayload('observation', { observationId: 'x', channel: 'stdout', content: '' }),
    ).toThrowError(/neutral text/);
  });

  it('checkpoint: checkpointId + snapshot digest (A010-shaped refs)', () => {
    const payload = toTrajectoryEntryPayload('checkpoint', {
      checkpointId: 'cp-0001',
      snapshotDigest: DIGEST_F,
    });
    expect(payload).toEqual({ checkpointId: 'cp-0001', snapshotDigest: DIGEST_F });
    expect(() =>
      toTrajectoryEntryPayload('checkpoint', { checkpointId: 'cp-0001', snapshotDigest: 'nope' }),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
  });

  it('error: uppercase code + message', () => {
    const payload = toTrajectoryEntryPayload('error', {
      code: 'WORKLOAD_STEP_FAILED',
      message: 'retrying',
    });
    expect(payload).toEqual({ code: 'WORKLOAD_STEP_FAILED', message: 'retrying' });
    expect(() =>
      toTrajectoryEntryPayload('error', { code: 'lowercase', message: 'x' }),
    ).toThrowError(/uppercase code charset/);
  });

  it('completion: outcome + evidence digests (empty allowed)', () => {
    expect(
      toTrajectoryEntryPayload('completion', { outcome: 'completed', evidenceDigests: [DIGEST_A] }),
    ).toEqual({ outcome: 'completed', evidenceDigests: [DIGEST_A] });
    expect(toTrajectoryEntryPayload('completion', { outcome: 'failed' })).toEqual({
      outcome: 'failed',
      evidenceDigests: [],
    });
    expect(() =>
      toTrajectoryEntryPayload('completion', { outcome: 'cancelled' }),
    ).toThrowError(/outcome must be one of/);
    expect(() =>
      toTrajectoryEntryPayload('completion', { outcome: 'completed', evidenceDigests: ['x'] }),
    ).toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_DIGEST }),
    );
  });

  it('isTrajectoryEntryPayload discriminates per kind', () => {
    expect(isTrajectoryEntryPayload('action', { actionId: 'x', input: null })).toBe(true);
    expect(isTrajectoryEntryPayload('observation', { actionId: 'x', input: null })).toBe(false);
    expect(isTrajectoryEntryPayload('error', { code: 'X', message: 'y' })).toBe(true);
    expect(isTrajectoryEntryPayload('checkpoint', { code: 'X', message: 'y' })).toBe(false);
  });
});

describe('createTrajectoryEntry (positive paths)', () => {
  it('creates a chain-linked, digest-addressed, deep-frozen entry', async () => {
    const entry = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    expect(entry.sequence).toBe(1);
    expect(entry.kind).toBe('action');
    expect(entry.prevDigest).toBe(DIGEST_A); // anchored to the header digest
    expect(entry.stepDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(entry)).toBe(true);
    expect(Object.isFrozen(entry.payload)).toBe(true);
  });

  it('the stepDigest is exactly sha256(canonical({ ...view, prevDigest }))', async () => {
    const entry = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    const expected = await digestCanonical({ ...trajectoryEntryView(entry), prevDigest: DIGEST_A });
    expect(entry.stepDigest).toBe(expected);
    expect(await computeTrajectoryStepDigest(trajectoryEntryView(entry), DIGEST_A)).toBe(expected);
  });

  it('same input + same anchor ⇒ same stepDigest (determinism)', async () => {
    const a = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    const b = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    expect(a.stepDigest).toBe(b.stepDigest);
  });

  it('every kind appends against the previous stepDigest', async () => {
    const first = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    const second = await createTrajectoryEntry(tailAfter(first), makeObservationInput(2, T1));
    expect(second.prevDigest).toBe(first.stepDigest);
    const third = await createTrajectoryEntry(tailAfter(second), makeErrorInput(3, T2));
    expect(third.prevDigest).toBe(second.stepDigest);
    const fourth = await createTrajectoryEntry(tailAfter(third), makeCheckpointInput(4, T2));
    expect(fourth.prevDigest).toBe(third.stepDigest);
    expect(fourth.occurredAt).toBe(T2); // equal timestamps are legal (non-decreasing)
    const fifth = await createTrajectoryEntry(tailAfter(fourth), makeCompletionInput(5, T3));
    expect(fifth.prevDigest).toBe(fourth.stepDigest);
  });
});

describe('createTrajectoryEntry (negative paths — ordering invariants)', () => {
  it('rejects a sequence GAP with SEQUENCE_GAP (gate 3 negative test)', async () => {
    await expect(
      createTrajectoryEntry(EMPTY_TAIL, makeActionInput(2, T0)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_GAP }),
    );
    const first = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    await expect(
      createTrajectoryEntry(tailAfter(first), makeActionInput(3, T1)),
    ).rejects.toThrowError(/leaves a gap/);
  });

  it('rejects duplicate / regressed sequences with SEQUENCE_REGRESSION', async () => {
    await expect(
      createTrajectoryEntry(EMPTY_TAIL, makeActionInput(0, T0)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_ENTRY }),
    );
    const first = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    await expect(
      createTrajectoryEntry(tailAfter(first), makeActionInput(1, T1)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.SEQUENCE_REGRESSION }),
    );
    await expect(
      createTrajectoryEntry(tailAfter(first), makeActionInput(2, T1)).then((second) =>
        createTrajectoryEntry(tailAfter(second), makeActionInput(1, T2)),
      ),
    ).rejects.toThrowError(/duplicates or regresses/);
  });

  it('rejects timestamp regressions with TIMESTAMP_REGRESSION', async () => {
    const first = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T1));
    await expect(
      createTrajectoryEntry(tailAfter(first), makeActionInput(2, T0)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TIMESTAMP_REGRESSION }),
    );
  });

  it('rejects ANY append after a completion entry (completion finality)', async () => {
    const completed = await createTrajectoryEntry(EMPTY_TAIL, makeCompletionInput(1, T0));
    expect(tailAfter(completed).completed).toBe(true);
    await expect(
      createTrajectoryEntry(tailAfter(completed), makeActionInput(2, T1)),
    ).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.ALREADY_COMPLETED }),
    );
    await expect(
      createTrajectoryEntry(tailAfter(completed), makeCompletionInput(2, T1)),
    ).rejects.toThrowError(/frozen by its completion entry/);
  });

  it('rejects unknown kinds, malformed shapes and unknown fields', async () => {
    await expect(
      createTrajectoryEntry(EMPTY_TAIL, {
        sequence: 1,
        kind: 'daydream',
        payload: {},
        occurredAt: T0,
      } as never),
    ).rejects.toThrowError(/kind must be one of/);
    await expect(
      createTrajectoryEntry(EMPTY_TAIL, {
        sequence: 1,
        kind: 'action',
        payload: { actionId: 'x' },
        occurredAt: T0,
        rogue: true,
      } as never),
    ).rejects.toThrowError(/unknown field 'rogue'/);
    await expect(
      createTrajectoryEntry(EMPTY_TAIL, {
        sequence: 1.5,
        kind: 'action',
        payload: { actionId: 'x' },
        occurredAt: T0,
      } as never),
    ).rejects.toThrowError(/positive integer/);
  });
});

describe('chained digest tamper-evidence (gate 3 test)', () => {
  it('mutating a historical entry changes EVERY subsequent stepDigest', async () => {
    // Build a 4-entry chain.
    const e1 = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    const e2 = await createTrajectoryEntry(tailAfter(e1), makeObservationInput(2, T1));
    const e3 = await createTrajectoryEntry(tailAfter(e2), makeActionInput(3, T2));
    const e4 = await createTrajectoryEntry(tailAfter(e3), makeCompletionInput(4, T3));

    // Rebuild with entry 1's action input mutated.
    const tamperedInput: CreateTrajectoryEntryInput = {
      sequence: 1,
      kind: 'action',
      payload: { actionId: 'shell-exec', input: { command: 'make', args: ['lint'] } },
      occurredAt: T0,
    };
    const t1 = await createTrajectoryEntry(EMPTY_TAIL, tamperedInput);
    const t2 = await createTrajectoryEntry(tailAfter(t1), makeObservationInput(2, T1));
    const t3 = await createTrajectoryEntry(tailAfter(t2), makeActionInput(3, T2));
    const t4 = await createTrajectoryEntry(tailAfter(t3), makeCompletionInput(4, T3));

    expect(t1.stepDigest).not.toBe(e1.stepDigest); // the mutation point…
    expect(t2.stepDigest).not.toBe(e2.stepDigest); // …and every subsequent digest
    expect(t3.stepDigest).not.toBe(e3.stepDigest);
    expect(t4.stepDigest).not.toBe(e4.stepDigest);
    // The tamper is also a CHAIN break: e2 no longer chains onto t1.
    await expect(verifyTrajectoryEntry(e2, t1.stepDigest)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.TAMPERED }),
    );
  });

  it('verifyTrajectoryEntry recomputes and confirms, or throws TAMPERED', async () => {
    const entry = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    await expect(verifyTrajectoryEntry(entry, DIGEST_A)).resolves.toBe(entry.stepDigest);
    // Forged stepDigest:
    await expect(
      verifyTrajectoryEntry({ ...entry, stepDigest: toContentDigest(DIGEST_B, 'forged') }),
    ).rejects.toThrowError(/stepDigest mismatch/);
    // Forged prevDigest (chain break):
    await expect(verifyTrajectoryEntry(entry, DIGEST_B)).rejects.toThrowError(
      /does not match the chain predecessor/,
    );
    await expect(verifyTrajectoryEntry(null as never)).rejects.toThrowError(
      expect.objectContaining({ code: TRAJECTORY_ERROR_CODES.INVALID_ENTRY }),
    );
  });
});

describe('structural predicates', () => {
  it('isTrajectoryEntryView / isTrajectoryEntry discriminate', async () => {
    const entry = await createTrajectoryEntry(EMPTY_TAIL, makeActionInput(1, T0));
    expect(isTrajectoryEntryView(trajectoryEntryView(entry))).toBe(true);
    expect(isTrajectoryEntry(entry)).toBe(true);
    expect(isTrajectoryEntry(trajectoryEntryView(entry))).toBe(false); // no chain fields
    expect(isTrajectoryEntry(null)).toBe(false);
    expect(isTrajectoryEntryView({ ...trajectoryEntryView(entry), sequence: 0 })).toBe(false);
    expect(isTrajectoryEntry({ ...entry, kind: 'daydream' as never })).toBe(false);
  });
});
