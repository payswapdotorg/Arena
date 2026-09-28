/**
 * RunStateSnapshot fold tests (Work Order A010 gates 3, 7, 8):
 * the fold re-validates single-run identity, sequence contiguity,
 * monotonic timestamps, lifecycle legality (from-state consistency and
 * transition-table agreement), checkpoint chain integrity — and
 * projects the world position through steps, checkpoints and restores.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  applyRuntimeEvent,
  foldRunEvents,
  initialRunState,
  isRunStateSnapshot,
} from './run-state.js';
import {
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeCheckpointRestoredEvent,
  makeRunResultProducedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
} from './events.js';
import { createRunRecord } from './run-record.js';
import {
  DIGEST_B,
  DIGEST_C,
  DIGEST_D,
  T0,
  T1,
  T2,
  T3,
  TENANT_A,
  makeDeclarationInput,
} from './test-support.js';

const RUN = 'tenant-a/run-000042';

describe('run state fold (gates 3, 7, 8)', () => {
  it('folds a full happy-path stream into the terminal projection (positive)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    const state = foldRunEvents(initialRunState(record), [
      makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
      makeAdmissionDecidedEvent({ ...base, sequence: 2, occurredAt: T0, admitted: true, violations: [] }),
      makeStateTransitionedEvent({ ...base, sequence: 3, occurredAt: T1, from: 'requested', to: 'provisioning', lifecycleEvent: 'provision-started' }),
      makeStateTransitionedEvent({ ...base, sequence: 4, occurredAt: T1, from: 'provisioning', to: 'ready', lifecycleEvent: 'provisioned' }),
      makeStateTransitionedEvent({ ...base, sequence: 5, occurredAt: T2, from: 'ready', to: 'running', lifecycleEvent: 'started' }),
      makeWorkloadProgressedEvent({ ...base, sequence: 6, occurredAt: T2, step: 1, simulatedElapsedMs: 100 }),
      makeWorkloadProgressedEvent({ ...base, sequence: 7, occurredAt: T2, step: 2, simulatedElapsedMs: 200 }),
      makeCheckpointRecordedEvent({ ...base, sequence: 8, occurredAt: T2, checkpointSequence: 1, snapshotDigest: DIGEST_C, stepIndex: 2 }),
      makeWorkloadProgressedEvent({ ...base, sequence: 9, occurredAt: T3, step: 3, simulatedElapsedMs: 300 }),
      makeCheckpointRecordedEvent({ ...base, sequence: 10, occurredAt: T3, checkpointSequence: 2, snapshotDigest: DIGEST_D, stepIndex: 3 }),
      makeCheckpointRestoredEvent({ ...base, sequence: 11, occurredAt: T3, checkpointSequence: 1, snapshotDigest: DIGEST_C, restoredStepIndex: 2 }),
      makeWorkloadProgressedEvent({ ...base, sequence: 12, occurredAt: T3, step: 3, simulatedElapsedMs: 350 }),
      makeStateTransitionedEvent({ ...base, sequence: 13, occurredAt: T3, from: 'running', to: 'completed', lifecycleEvent: 'completed' }),
      makeRunResultProducedEvent({ ...base, sequence: 14, occurredAt: T3, resultDigest: DIGEST_B, trajectoryDigest: DIGEST_C, evidenceDigests: [DIGEST_C, DIGEST_D] }),
      makeStateTransitionedEvent({ ...base, sequence: 15, occurredAt: T3, from: 'completed', to: 'cleaned', lifecycleEvent: 'cleaned' }),
    ]);
    expect(state.status).toBe('cleaned');
    expect(state.transitions).toBe(5);
    expect(state.appliedEvents).toBe(15);
    expect(state.admitted).toBe(true);
    expect(state.worldStep).toBe(3);
    expect(state.checkpoints.length).toBe(2);
    expect(state.restoredToCheckpoint).toBe(1);
    expect(state.resultDigest).toBe(DIGEST_B);
    expect(isRunStateSnapshot(state)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
  });

  it('rejects foreign-run and foreign-tenant events (negative, gate 6)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const initial = initialRunState(record);
    expect(() =>
      applyRuntimeEvent(
        initial,
        makeRunSubmittedEvent({
          runId: 'tenant-b/run-000099',
          tenantId: 'tenant-b',
          sequence: 1,
          occurredAt: T0,
          recordDigest: record.digest,
          jobRef: record.jobRef,
          seed: null,
        }),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects a submitted event pinning a different record digest (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    expect(() =>
      applyRuntimeEvent(
        initialRunState(record),
        makeRunSubmittedEvent({
          runId: record.runId,
          tenantId: record.tenantId,
          sequence: 1,
          occurredAt: T0,
          recordDigest: DIGEST_B,
          jobRef: record.jobRef,
          seed: null,
        }),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects gaps, duplicates and timestamp regressions (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    const first = applyRuntimeEvent(
      initialRunState(record),
      makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
    );
    expect(() =>
      applyRuntimeEvent(
        first,
        makeAdmissionDecidedEvent({ ...base, sequence: 3, occurredAt: T1, admitted: true, violations: [] }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      applyRuntimeEvent(
        first,
        makeAdmissionDecidedEvent({ ...base, sequence: 1, occurredAt: T0, admitted: true, violations: [] }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      applyRuntimeEvent(
        first,
        makeAdmissionDecidedEvent({ ...base, sequence: 2, occurredAt: '2026-01-15T09:29:00.000Z', admitted: true, violations: [] }),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects transition events contradicting the current status (negative, gate 3)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    const first = applyRuntimeEvent(
      initialRunState(record),
      makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
    );
    const error = capture(() =>
      applyRuntimeEvent(
        first,
        makeStateTransitionedEvent({ ...base, sequence: 2, occurredAt: T1, from: 'running', to: 'completed', lifecycleEvent: 'completed' }),
      ),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
  });

  it('rejects transition events disagreeing with the transition table (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    const first = applyRuntimeEvent(
      initialRunState(record),
      makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
    );
    // requested --started--> completed is not a table edge.
    expect(() =>
      applyRuntimeEvent(
        first,
        makeStateTransitionedEvent({ ...base, sequence: 2, occurredAt: T1, from: 'requested', to: 'completed', lifecycleEvent: 'started' }),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects progress/results/checkpoints in wrong states (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    const initial = initialRunState(record);
    expect(() =>
      applyRuntimeEvent(
        initial,
        makeWorkloadProgressedEvent({ ...base, sequence: 1, occurredAt: T0, step: 1, simulatedElapsedMs: 1 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      applyRuntimeEvent(
        initial,
        makeRunResultProducedEvent({ ...base, sequence: 1, occurredAt: T0, resultDigest: DIGEST_B, trajectoryDigest: DIGEST_C, evidenceDigests: [DIGEST_C] }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      applyRuntimeEvent(
        initial,
        makeCheckpointRecordedEvent({ ...base, sequence: 1, occurredAt: T0, checkpointSequence: 1, snapshotDigest: DIGEST_C, stepIndex: 0 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    expect(() => applyRuntimeEvent(initial, null as never)).toThrow(EnvironmentRuntimeError);
    expect(() =>
      applyRuntimeEvent(null as never, makeWorkloadProgressedEvent({ ...base, sequence: 1, occurredAt: T0, step: 1, simulatedElapsedMs: 1 })),
    ).toThrow(EnvironmentRuntimeError);
    expect(isRunStateSnapshot(null)).toBe(false);
  });

  it('rejects non-contiguous steps and checkpoint sequences (negative)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const base = { runId: record.runId, tenantId: record.tenantId };
    let state = foldRunEvents(initialRunState(record), [
      makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
      makeAdmissionDecidedEvent({ ...base, sequence: 2, occurredAt: T0, admitted: true, violations: [] }),
      makeStateTransitionedEvent({ ...base, sequence: 3, occurredAt: T1, from: 'requested', to: 'provisioning', lifecycleEvent: 'provision-started' }),
      makeStateTransitionedEvent({ ...base, sequence: 4, occurredAt: T1, from: 'provisioning', to: 'ready', lifecycleEvent: 'provisioned' }),
      makeStateTransitionedEvent({ ...base, sequence: 5, occurredAt: T1, from: 'ready', to: 'running', lifecycleEvent: 'started' }),
      makeWorkloadProgressedEvent({ ...base, sequence: 6, occurredAt: T2, step: 1, simulatedElapsedMs: 100 }),
    ]);
    expect(state.worldStep).toBe(1);
    // step 3 after step 1 is a gap
    expect(() =>
      applyRuntimeEvent(
        state,
        makeWorkloadProgressedEvent({ ...base, sequence: 7, occurredAt: T2, step: 3, simulatedElapsedMs: 300 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    // elapsed regression
    expect(() =>
      applyRuntimeEvent(
        state,
        makeWorkloadProgressedEvent({ ...base, sequence: 7, occurredAt: T2, step: 2, simulatedElapsedMs: 50 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    state = applyRuntimeEvent(
      state,
      makeCheckpointRecordedEvent({ ...base, sequence: 7, occurredAt: T2, checkpointSequence: 1, snapshotDigest: DIGEST_C, stepIndex: 2 }),
    );
    // checkpoint sequence 3 is a gap
    expect(() =>
      applyRuntimeEvent(
        state,
        makeCheckpointRecordedEvent({ ...base, sequence: 8, occurredAt: T2, checkpointSequence: 3, snapshotDigest: DIGEST_D, stepIndex: 2 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    // restore to an unrecorded checkpoint
    expect(() =>
      applyRuntimeEvent(
        state,
        makeCheckpointRestoredEvent({ ...base, sequence: 8, occurredAt: T2, checkpointSequence: 5, snapshotDigest: DIGEST_C, restoredStepIndex: 2 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
    // restore with a mismatched digest (tamper)
    expect(() =>
      applyRuntimeEvent(
        state,
        makeCheckpointRestoredEvent({ ...base, sequence: 8, occurredAt: T2, checkpointSequence: 1, snapshotDigest: DIGEST_D, restoredStepIndex: 2 }),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });
});

function capture(fn: () => unknown): EnvironmentRuntimeError | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}

void RUN;
void TENANT_A;
