/**
 * Checkpoint/restore tests (Work Order A010 gate 8; R9):
 *   - positive: content-addressed checkpoints, contiguous sequences,
 *     digest verification, restore returns the recorded world position;
 *   - negative: foreign-run checkpoint refs, unknown sequences, digest
 *     mismatches (tampering), non-running restores, malformed refs.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  createRunCheckpoint,
  isRunCheckpoint,
  isRunCheckpointRef,
  restoreToCheckpoint,
  runCheckpointRef,
  runCheckpointView,
  toRunCheckpointRef,
  verifyRunCheckpoint,
} from './checkpoint.js';
import type { RunCheckpointRef } from './checkpoint.js';
import { createRunRecord } from './run-record.js';
import { initialRunState, applyRuntimeEvent } from './run-state.js';
import { makeAdmissionDecidedEvent, makeCheckpointRecordedEvent, makeRunSubmittedEvent, makeStateTransitionedEvent, makeWorkloadProgressedEvent } from './events.js';
import { DIGEST_C, DIGEST_D, T1, T2, T3, T4, T5, makeDeclarationInput } from './test-support.js';

describe('run checkpoints (gate 8)', () => {
  it('creates content-addressed checkpoints with contiguous sequences (positive)', async () => {
    const a = await createRunCheckpoint({
      runId: 'tenant-a/run-000042',
      tenantId: 'tenant-a',
      sequence: 1,
      snapshotDigest: DIGEST_C,
      stepIndex: 3,
      recordedAt: T1,
    });
    const b = await createRunCheckpoint({
      runId: 'tenant-a/run-000042',
      tenantId: 'tenant-a',
      sequence: 2,
      snapshotDigest: DIGEST_D,
      stepIndex: 6,
      recordedAt: T2,
    });
    expect(a.digest).not.toBe(b.digest);
    expect(isRunCheckpoint(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
    await expect(verifyRunCheckpoint(a)).resolves.toBe(a.digest);
    expect(runCheckpointRef(b)).toEqual({
      runId: 'tenant-a/run-000042',
      sequence: 2,
      snapshotDigest: DIGEST_D,
    });
    expect(runCheckpointView(a).sequence).toBe(1);
    expect(isRunCheckpointRef(runCheckpointRef(a))).toBe(true);
    expect(toRunCheckpointRef({ runId: 'tenant-a/run-000042', sequence: 1, snapshotDigest: DIGEST_C }).sequence).toBe(1);
  });

  it('rejects malformed checkpoints and refs (negative)', async () => {
    await expect(
      createRunCheckpoint({
        runId: 'bad run id',
        tenantId: 'tenant-a',
        sequence: 1,
        snapshotDigest: DIGEST_C,
        stepIndex: 0,
        recordedAt: T1,
      }),
    ).rejects.toThrow(EnvironmentRuntimeError);
    await expect(
      createRunCheckpoint({
        runId: 'tenant-a/run-000042',
        tenantId: 'tenant-a',
        sequence: 0,
        snapshotDigest: DIGEST_C,
        stepIndex: 0,
        recordedAt: T1,
      }),
    ).rejects.toThrow(EnvironmentRuntimeError);
    await expect(
      createRunCheckpoint({
        runId: 'tenant-a/run-000042',
        tenantId: 'tenant-a',
        sequence: 1,
        snapshotDigest: 'nope',
        stepIndex: 0,
        recordedAt: T1,
      }),
    ).rejects.toThrow(EnvironmentRuntimeError);
    expect(() =>
      toRunCheckpointRef({ runId: 'tenant-a/run-000042', sequence: 0, snapshotDigest: DIGEST_C }),
    ).toThrow(EnvironmentRuntimeError);
    expect(isRunCheckpointRef({ runId: 'x', sequence: 1, snapshotDigest: 'y' })).toBe(false);
  });

  it('restores to a recorded checkpoint of the same run (positive)', async () => {
    const { record, state } = await runningRunWithCheckpoints();
    const second = required(state.checkpoints[1]);
    const ref: RunCheckpointRef = {
      runId: record.runId,
      sequence: second.sequence,
      snapshotDigest: second.snapshotDigest,
    } as RunCheckpointRef;
    expect(restoreToCheckpoint(state, ref)).toBe(second.stepIndex);
  });

  it('rejects a FOREIGN run checkpoint (negative, gate 8)', async () => {
    const { record, state } = await runningRunWithCheckpoints();
    const first = required(state.checkpoints[0]);
    const error = capture(() =>
      restoreToCheckpoint(state, {
        runId: 'tenant-b/run-000099',
        sequence: first.sequence,
        snapshotDigest: first.snapshotDigest,
      }),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
    expect(error?.details).toMatchObject({
      refRunId: 'tenant-b/run-000099',
      runId: record.runId,
    });
    // A ref for the same run id but a foreign tenant is equally foreign:
    expect(
      capture(() =>
        restoreToCheckpoint(state, {
          runId: 'tenant-b/run-000042',
          sequence: first.sequence,
          snapshotDigest: first.snapshotDigest,
        }),
      )?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
  });

  it('rejects unknown sequences and digest mismatches (negative, gate 8)', async () => {
    const { record, state } = await runningRunWithCheckpoints();
    const first = required(state.checkpoints[0]);
    expect(
      capture(() =>
        restoreToCheckpoint(state, {
          runId: record.runId,
          sequence: 99,
          snapshotDigest: first.snapshotDigest,
        }),
      )?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
    expect(
      capture(() =>
        restoreToCheckpoint(state, {
          runId: record.runId,
          sequence: first.sequence,
          snapshotDigest: DIGEST_D,
        }),
      )?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
  });

  it('rejects restores outside the running state (negative, gate 3/8)', async () => {
    const { record, state } = await runningRunWithCheckpoints();
    const requested = initialRunState(record);
    const first = required(state.checkpoints[0]);
    expect(
      capture(() =>
        restoreToCheckpoint(requested, {
          runId: record.runId,
          sequence: first.sequence,
          snapshotDigest: first.snapshotDigest,
        }),
      )?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
  });

  it('rejects structurally invalid refs (negative)', async () => {
    const { state } = await runningRunWithCheckpoints();
    expect(capture(() => restoreToCheckpoint(state, null as never))?.code).toBe(
      ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT,
    );
    expect(
      capture(() =>
        restoreToCheckpoint(state, { runId: 'bad', sequence: 1, snapshotDigest: 'x' }),
      )?.code,
    ).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_CHECKPOINT);
  });

  it('detects checkpoint tampering (negative)', async () => {
    const checkpoint = await createRunCheckpoint({
      runId: 'tenant-a/run-000042',
      tenantId: 'tenant-a',
      sequence: 1,
      snapshotDigest: DIGEST_C,
      stepIndex: 2,
      recordedAt: T1,
    });
    const tampered = { ...checkpoint, stepIndex: 5 } as typeof checkpoint;
    await expect(verifyRunCheckpoint(tampered)).rejects.toThrow(EnvironmentRuntimeError);
    await expect(verifyRunCheckpoint(null as never)).rejects.toThrow(EnvironmentRuntimeError);
  });
});

/** A running run with two recorded checkpoints, built through the fold. */
async function runningRunWithCheckpoints(): Promise<{
  record: Awaited<ReturnType<typeof createRunRecord>>;
  state: ReturnType<typeof initialRunState>;
}> {
  const record = await createRunRecord(makeDeclarationInput());
  let state = initialRunState(record);
  const base = { runId: record.runId, tenantId: record.tenantId };
  state = applyRuntimeEvent(
    state,
    makeRunSubmittedEvent({
      ...base,
      sequence: 1,
      occurredAt: T1,
      recordDigest: record.digest,
      jobRef: record.jobRef,
      seed: record.seed,
    }),
  );
  state = applyRuntimeEvent(
    state,
    makeAdmissionDecidedEvent({ ...base, sequence: 2, occurredAt: T1, admitted: true, violations: [] }),
  );
  state = applyRuntimeEvent(
    state,
    makeStateTransitionedEvent({ ...base, sequence: 3, occurredAt: T2, from: 'requested', to: 'provisioning', lifecycleEvent: 'provision-started' }),
  );
  state = applyRuntimeEvent(
    state,
    makeStateTransitionedEvent({ ...base, sequence: 4, occurredAt: T2, from: 'provisioning', to: 'ready', lifecycleEvent: 'provisioned' }),
  );
  state = applyRuntimeEvent(
    state,
    makeStateTransitionedEvent({ ...base, sequence: 5, occurredAt: T3, from: 'ready', to: 'running', lifecycleEvent: 'started' }),
  );
  state = applyRuntimeEvent(
    state,
    makeWorkloadProgressedEvent({ ...base, sequence: 6, occurredAt: T3, step: 1, simulatedElapsedMs: 100 }),
  );
  state = applyRuntimeEvent(
    state,
    makeWorkloadProgressedEvent({ ...base, sequence: 7, occurredAt: T3, step: 2, simulatedElapsedMs: 200 }),
  );
  state = applyRuntimeEvent(
    state,
    makeCheckpointRecordedEvent({ ...base, sequence: 8, occurredAt: T4, checkpointSequence: 1, snapshotDigest: DIGEST_C, stepIndex: 2 }),
  );
  state = applyRuntimeEvent(
    state,
    makeWorkloadProgressedEvent({ ...base, sequence: 9, occurredAt: T4, step: 3, simulatedElapsedMs: 300 }),
  );
  state = applyRuntimeEvent(
    state,
    makeCheckpointRecordedEvent({ ...base, sequence: 10, occurredAt: T5, checkpointSequence: 2, snapshotDigest: DIGEST_D, stepIndex: 3 }),
  );
  expect(state.status).toBe('running');
  expect(state.checkpoints.length).toBe(2);
  return { record, state };
}

function capture(fn: () => unknown): EnvironmentRuntimeError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing fixture');
  return value;
}
