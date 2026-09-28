/**
 * RuntimeEvent taxonomy tests (Work Order A010 gates 3, 4, 7):
 * constructors validate strictly; structural guards accept well-formed
 * events and reject every malformed variant; the kind adjacency table
 * is closed and terminal-aware.
 */

import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  RUNTIME_EVENT_KINDS,
  RUNTIME_EVENT_VERSION,
  isRuntimeEvent,
  isRuntimeEventKind,
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeCheckpointRestoredEvent,
  makeRunResultProducedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
  nextRuntimeEventKinds,
} from './events.js';
import { DIGEST_C, DIGEST_D, T1, TENANT_A } from './test-support.js';

const BASE = { runId: 'tenant-a/run-000042', tenantId: TENANT_A, occurredAt: T1 };

describe('RuntimeEvent constructors (gates 3, 4, 7)', () => {
  it('builds frozen, structurally valid events of every kind (positive)', () => {
    const events = [
      makeRunSubmittedEvent({
        ...BASE,
        sequence: 1,
        recordDigest: DIGEST_C,
        jobRef: 'job-7f3a2b',
        seed: 'seed-1234',
      }),
      makeAdmissionDecidedEvent({ ...BASE, sequence: 2, admitted: true, violations: [] }),
      makeStateTransitionedEvent({
        ...BASE,
        sequence: 3,
        from: 'requested',
        to: 'provisioning',
        lifecycleEvent: 'provision-started',
        reason: 'provisioning began',
      }),
      makeWorkloadProgressedEvent({ ...BASE, sequence: 4, step: 1, simulatedElapsedMs: 10 }),
      makeCheckpointRecordedEvent({
        ...BASE,
        sequence: 5,
        checkpointSequence: 1,
        snapshotDigest: DIGEST_C,
        stepIndex: 1,
      }),
      makeCheckpointRestoredEvent({
        ...BASE,
        sequence: 6,
        checkpointSequence: 1,
        snapshotDigest: DIGEST_C,
        restoredStepIndex: 1,
      }),
      makeRunResultProducedEvent({
        ...BASE,
        sequence: 7,
        resultDigest: DIGEST_D,
        trajectoryDigest: DIGEST_C,
        evidenceDigests: [DIGEST_C],
      }),
    ];
    expect(events.length).toBe(RUNTIME_EVENT_KINDS.length);
    for (const event of events) {
      expect(isRuntimeEvent(event)).toBe(true);
      expect(Object.isFrozen(event)).toBe(true);
      expect(event.eventVersion).toBe(RUNTIME_EVENT_VERSION);
      expect(isRuntimeEventKind(event.kind)).toBe(true);
    }
  });

  it('rejects malformed events (negative)', () => {
    expect(() =>
      makeRunSubmittedEvent({ ...BASE, sequence: 0, recordDigest: DIGEST_C, jobRef: 'j', seed: null }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRunSubmittedEvent({ ...BASE, sequence: 1, recordDigest: 'bad', jobRef: 'j', seed: null }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRunSubmittedEvent({ ...BASE, sequence: 1, recordDigest: DIGEST_C, jobRef: 'bad ref!', seed: null }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeAdmissionDecidedEvent({ ...BASE, sequence: 1, admitted: 'yes' as never, violations: [] }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeAdmissionDecidedEvent({ ...BASE, sequence: 1, admitted: true, violations: 'none' as never }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeStateTransitionedEvent({ ...BASE, sequence: 1, from: 'nowhere' as never, to: 'provisioning', lifecycleEvent: 'provision-started' }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeStateTransitionedEvent({ ...BASE, sequence: 1, from: 'requested', to: 'provisioning', lifecycleEvent: 'nope' as never }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeWorkloadProgressedEvent({ ...BASE, sequence: 1, step: 0, simulatedElapsedMs: 1 }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeWorkloadProgressedEvent({ ...BASE, sequence: 1, step: 1, simulatedElapsedMs: -1 }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeCheckpointRecordedEvent({ ...BASE, sequence: 1, checkpointSequence: 1, snapshotDigest: 'x', stepIndex: 1 }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeCheckpointRestoredEvent({ ...BASE, sequence: 1, checkpointSequence: 0, snapshotDigest: DIGEST_C, restoredStepIndex: 1 }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRunResultProducedEvent({ ...BASE, sequence: 1, resultDigest: DIGEST_D, trajectoryDigest: DIGEST_C, evidenceDigests: [] }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRunSubmittedEvent({ ...BASE, sequence: 1, occurredAt: 'yesterday', recordDigest: DIGEST_C, jobRef: 'j', seed: null }),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      makeRunSubmittedEvent({ ...BASE, sequence: 1, runId: 'bad', recordDigest: DIGEST_C, jobRef: 'j', seed: null }),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('structural guard rejects malformed values (negative)', () => {
    expect(isRuntimeEvent(null)).toBe(false);
    expect(isRuntimeEvent('event')).toBe(false);
    expect(isRuntimeEvent([])).toBe(false);
    expect(isRuntimeEvent({ kind: 'run-submitted' })).toBe(false);
    expect(
      isRuntimeEvent({
        ...BASE,
        eventVersion: 99,
        sequence: 1,
        kind: 'run-submitted',
        recordDigest: DIGEST_C,
        jobRef: 'j',
        seed: null,
      }),
    ).toBe(false);
    expect(
      isRuntimeEvent({
        ...BASE,
        eventVersion: RUNTIME_EVENT_VERSION,
        sequence: 1,
        kind: 'not-a-kind',
      }),
    ).toBe(false);
    expect(isRuntimeEventKind('not-a-kind')).toBe(false);
  });

  it('kind adjacency is closed and terminal-aware (positive)', () => {
    expect(nextRuntimeEventKinds('run-submitted')).toEqual([
      'admission-decided',
      'state-transitioned',
    ]);
    expect(nextRuntimeEventKinds('admission-decided')).toEqual(['state-transitioned']);
    expect(nextRuntimeEventKinds('run-result-produced')).toEqual(['state-transitioned']);
    // A state-transitioned event may be followed by lifecycle-bearing
    // kinds; the outcome/cleaned restrictions live in the event log
    // (it can see the transitioned-to state).
    expect(nextRuntimeEventKinds('state-transitioned')).toContain('workload-progressed');
  });

  it('error code sanity for event errors (positive)', () => {
    expect(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT).toBe(
      'ENVIRONMENT_RUNTIME_INVALID_EVENT',
    );
  });
});
