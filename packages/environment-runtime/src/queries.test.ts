/**
 * Pure query tests (Work Order A010 gate 7; R33): run-state snapshots
 * from the log, runs-in-state, checkpoint chain access, admission
 * decision trails — mirroring capability-graph's total-function query
 * conventions.
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  admissionDecisionsOf,
  checkpointsOf,
  eventsForTenant,
  latestCheckpointOf,
  runStateOf,
  runStatesSnapshot,
  runsInState,
} from './queries.js';
import { appendRuntimeEventEnvelope, createEnvironmentEventLog, eventsForRun } from './event-log.js';
import { makeRuntimeEventEnvelope } from './envelopes.js';
import {
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
} from './events.js';
import { createRunRecord } from './run-record.js';
import { DIGEST_C, DIGEST_D, T0, T1, T2, TENANT_A, makeDeclarationInput } from './test-support.js';

const IDEM = toIdempotencyKey('idem-queries');

describe('pure queries over the event log (gate 7)', () => {
  it('projects run states, runs-in-state and per-run views (positive)', async () => {
    const recordA = await createRunRecord(makeDeclarationInput({ runKey: 'run-000042' }));
    const recordB = await createRunRecord(
      makeDeclarationInput({ runKey: 'run-000043', seed: 'seed-2' }),
    );
    const correlation = newCorrelationId();
    const envelop = (event: Parameters<typeof makeRuntimeEventEnvelope>[0]) =>
      makeRuntimeEventEnvelope(event, { correlationId: correlation, idempotencyKey: IDEM });

    let log = createEnvironmentEventLog();
    for (const record of [recordA, recordB]) {
      const base = { runId: record.runId, tenantId: record.tenantId };
      log = appendRuntimeEventEnvelope(
        log,
        envelop(
          makeRunSubmittedEvent({ ...base, sequence: 1, occurredAt: T0, recordDigest: record.digest, jobRef: record.jobRef, seed: record.seed }),
        ),
      );
      log = appendRuntimeEventEnvelope(
        log,
        envelop(
          makeAdmissionDecidedEvent({ ...base, sequence: 2, occurredAt: T0, admitted: true, violations: ['stale-check'] }),
        ),
      );
      log = appendRuntimeEventEnvelope(
        log,
        envelop(
          makeStateTransitionedEvent({ ...base, sequence: 3, occurredAt: T1, from: 'requested', to: 'provisioning', lifecycleEvent: 'provision-started' }),
        ),
      );
    }
    // run A continues to running + a checkpoint; run B stays provisioning.
    const a = { runId: recordA.runId, tenantId: recordA.tenantId };
    log = appendRuntimeEventEnvelope(
      log,
      envelop(makeStateTransitionedEvent({ ...a, sequence: 4, occurredAt: T1, from: 'provisioning', to: 'ready', lifecycleEvent: 'provisioned' })),
    );
    log = appendRuntimeEventEnvelope(
      log,
      envelop(makeStateTransitionedEvent({ ...a, sequence: 5, occurredAt: T2, from: 'ready', to: 'running', lifecycleEvent: 'started' })),
    );
    log = appendRuntimeEventEnvelope(
      log,
      envelop(makeWorkloadProgressedEvent({ ...a, sequence: 6, occurredAt: T2, step: 1, simulatedElapsedMs: 100 })),
    );
    log = appendRuntimeEventEnvelope(
      log,
      envelop(makeCheckpointRecordedEvent({ ...a, sequence: 7, occurredAt: T2, checkpointSequence: 1, snapshotDigest: DIGEST_C, stepIndex: 1 })),
    );

    const byId = new Map([
      [recordA.runId, recordA],
      [recordB.runId, recordB],
    ]);
    const snapshots = runStatesSnapshot(log, (runId) => byId.get(runId));
    expect(snapshots.get(recordA.runId)?.status).toBe('running');
    expect(snapshots.get(recordB.runId)?.status).toBe('provisioning');
    expect(runsInState(log, (runId) => byId.get(runId), 'running')).toEqual([recordA.runId]);
    expect(runsInState(log, (runId) => byId.get(runId), 'provisioning')).toEqual([recordB.runId]);
    expect(() => runsInState(log, (runId) => byId.get(runId), 'hovering')).toThrow();

    const stateA = runStateOf(log, recordA);
    expect(stateA.worldStep).toBe(1);
    expect(checkpointsOf(stateA).length).toBe(1);
    expect(latestCheckpointOf(stateA)?.snapshotDigest).toBe(DIGEST_C);
    expect(latestCheckpointOf(runStateOf(log, recordB))).toBeUndefined();

    expect(eventsForRun(log, recordA.runId).length).toBe(7);
    expect(eventsForRun(log, recordB.runId).length).toBe(3);
    expect(eventsForTenant(log, TENANT_A).length).toBe(10);

    const decisions = admissionDecisionsOf(log, recordA.runId);
    expect(decisions.length).toBe(1);
    expect(decisions[0]).toMatchObject({ admitted: true, sequence: 2 });

    // A missing record resolver fails closed.
    expect(() => runStatesSnapshot(log, () => undefined)).toThrow();
  });

  it('queries are pure: the log is never mutated (positive)', async () => {
    const record = await createRunRecord(makeDeclarationInput());
    const correlation = newCorrelationId();
    let log = createEnvironmentEventLog();
    log = appendRuntimeEventEnvelope(
      log,
      makeRuntimeEventEnvelope(
        makeRunSubmittedEvent({
          runId: record.runId,
          tenantId: record.tenantId,
          sequence: 1,
          occurredAt: T0,
          recordDigest: record.digest,
          jobRef: record.jobRef,
          seed: record.seed,
        }),
        { correlationId: correlation, idempotencyKey: IDEM },
      ),
    );
    const before = log.entries.length;
    const snapshot = runStateOf(log, record);
    expect(snapshot.status).toBe('requested');
    expect(log.entries.length).toBe(before);
    void DIGEST_D;
    void T1;
  });
});
