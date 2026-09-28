/**
 * EnvironmentEventLog tests (Work Order A010 gate 7; R33):
 *   - positive: append-only growth, per-run contiguity, first-event
 *     rule, kind adjacency, monotonic timestamps, verification by
 *     replay, tenant/run/state queries;
 *   - negative: sequence gaps/duplicates/regressions, out-of-order
 *     kinds, first-event violations, post-cleaned appends,
 *     post-outcome appends, tenant/run contradictions.
 */

import { describe, expect, it } from 'vitest';
import { newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import { ENVIRONMENT_RUNTIME_ERROR_CODES, EnvironmentRuntimeError } from './errors.js';
import {
  appendRuntimeEventEnvelope,
  createEnvironmentEventLog,
  eventsEnteringState,
  eventsForRun,
  eventsForTenant,
  isEnvironmentEventLog,
  loggedRunIds,
  verifyEnvironmentEventLog,
} from './event-log.js';
import { makeRuntimeEventEnvelope } from './envelopes.js';
import {
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
} from './events.js';
import { DIGEST_C, T1, T2, T3, TENANT_A } from './test-support.js';

const RUN = 'tenant-a/run-000042';
const CORR = newCorrelationId();
const IDEM = toIdempotencyKey('idem-run-42');

function envelop(sequence: number, build: (sequence: number) => Parameters<typeof makeRuntimeEventEnvelope>[0]) {
  return makeRuntimeEventEnvelope(build(sequence), {
    correlationId: CORR,
    idempotencyKey: IDEM,
  });
}

function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`missing fixture at ${String(index)}`);
  return value;
}

function happyStream() {
  const base = { runId: RUN, tenantId: TENANT_A };
  return [
    envelop(1, (sequence) =>
      makeRunSubmittedEvent({ ...base, sequence, occurredAt: T1, recordDigest: DIGEST_C, jobRef: 'job-7f3a2b', seed: 'seed-1' }),
    ),
    envelop(2, (sequence) =>
      makeAdmissionDecidedEvent({ ...base, sequence, occurredAt: T1, admitted: true, violations: [] }),
    ),
    envelop(3, (sequence) =>
      makeStateTransitionedEvent({ ...base, sequence, occurredAt: T2, from: 'requested', to: 'provisioning', lifecycleEvent: 'provision-started' }),
    ),
    envelop(4, (sequence) =>
      makeStateTransitionedEvent({ ...base, sequence, occurredAt: T2, from: 'provisioning', to: 'ready', lifecycleEvent: 'provisioned' }),
    ),
    envelop(5, (sequence) =>
      makeStateTransitionedEvent({ ...base, sequence, occurredAt: T2, from: 'ready', to: 'running', lifecycleEvent: 'started' }),
    ),
    envelop(6, (sequence) =>
      makeWorkloadProgressedEvent({ ...base, sequence, occurredAt: T3, step: 1, simulatedElapsedMs: 100 }),
    ),
  ];
}

describe('EnvironmentEventLog (gate 7)', () => {
  it('appends enveloped events and grows append-only (positive)', () => {
    let log = createEnvironmentEventLog();
    expect(isEnvironmentEventLog(log)).toBe(true);
    for (const envelope of happyStream()) {
      const before = log.entries.length;
      log = appendRuntimeEventEnvelope(log, envelope);
      expect(log.entries.length).toBe(before + 1);
      expect(Object.isFrozen(log)).toBe(true);
      // The input log is never modified (append returns a new log).
    }
    verifyEnvironmentEventLog(log);
    expect(log.entries.length).toBe(6);
    // Every entry is an idempotency-keyed event envelope (gate 4).
    for (const entry of log.entries) {
      expect(entry.kind).toBe('event');
      expect(entry.idempotencyKey).toBe(IDEM);
      expect(entry.correlationId).toBe(CORR);
    }
  });

  it('queries by run, tenant and state (positive, gate 7)', () => {
    let log = createEnvironmentEventLog();
    for (const envelope of happyStream()) {
      log = appendRuntimeEventEnvelope(log, envelope);
    }
    const other = envelop(1, (sequence) =>
      makeRunSubmittedEvent({
        runId: 'tenant-b/run-000099',
        tenantId: 'tenant-b',
        sequence,
        occurredAt: T1,
        recordDigest: DIGEST_C,
        jobRef: 'job-2',
        seed: null,
      }),
    );
    log = appendRuntimeEventEnvelope(log, other);
    expect(eventsForRun(log, RUN).length).toBe(6);
    expect(eventsForTenant(log, TENANT_A).length).toBe(6);
    expect(eventsForTenant(log, 'tenant-b').length).toBe(1);
    expect(eventsEnteringState(log, 'running').length).toBe(1);
    expect(eventsEnteringState(log, 'cleaned').length).toBe(0);
    expect(loggedRunIds(log)).toEqual([RUN, 'tenant-b/run-000099']);
    expect(() => eventsForRun(log, 'bad id')).toThrow(EnvironmentRuntimeError);
  });

  it('rejects sequence gaps, duplicates and regressions (negative)', () => {
    const stream = happyStream();
    const two = stream.slice(0, 2).reduce(appendRuntimeEventEnvelope, createEnvironmentEventLog());
    expect(() =>
      appendRuntimeEventEnvelope(
        two,
        envelop(4, (sequence) =>
          makeStateTransitionedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T2,
            from: 'requested',
            to: 'provisioning',
            lifecycleEvent: 'provision-started',
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);

    const withThree = stream.slice(0, 3).reduce(appendRuntimeEventEnvelope, createEnvironmentEventLog());
    expect(() =>
      appendRuntimeEventEnvelope(
        withThree,
        envelop(3, (sequence) =>
          makeStateTransitionedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T2,
            from: 'requested',
            to: 'provisioning',
            lifecycleEvent: 'provision-started',
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects a non-submitted first event (negative)', () => {
    expect(() =>
      appendRuntimeEventEnvelope(
        createEnvironmentEventLog(),
        envelop(1, (sequence) =>
          makeWorkloadProgressedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T1,
            step: 1,
            simulatedElapsedMs: 1,
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects out-of-order kinds (negative)', () => {
    const one = appendRuntimeEventEnvelope(
      createEnvironmentEventLog(),
      at(happyStream(), 0),
    );
    // workload-progressed directly after run-submitted (no admission,
    // no transitions) is out of order.
    expect(() =>
      appendRuntimeEventEnvelope(
        one,
        envelop(2, (sequence) =>
          makeWorkloadProgressedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T1,
            step: 1,
            simulatedElapsedMs: 1,
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects regressing timestamps (negative)', () => {
    const stream = happyStream();
    const log = stream.slice(0, 3).reduce(appendRuntimeEventEnvelope, createEnvironmentEventLog());
    expect(() =>
      appendRuntimeEventEnvelope(
        log,
        envelop(4, (sequence) =>
          makeStateTransitionedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: '2026-01-15T09:29:59.000Z',
            from: 'provisioning',
            to: 'ready',
            lifecycleEvent: 'provisioned',
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
  });

  it('rejects appends after an outcome state except result/cleanup (negative)', () => {
    const completed = [
      ...happyStream(),
      envelop(7, (sequence) =>
        makeStateTransitionedEvent({
          runId: RUN,
          tenantId: TENANT_A,
          sequence,
          occurredAt: T3,
          from: 'running',
          to: 'completed',
          lifecycleEvent: 'completed',
        }),
      ),
    ];
    const log = completed.reduce(appendRuntimeEventEnvelope, createEnvironmentEventLog());
    // workload progress after completion is rejected...
    expect(() =>
      appendRuntimeEventEnvelope(
        log,
        envelop(8, (sequence) =>
          makeWorkloadProgressedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T3,
            step: 2,
            simulatedElapsedMs: 200,
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
    // ...and nothing may follow cleanup.
    const cleaned = appendRuntimeEventEnvelope(
      log,
      envelop(8, (sequence) =>
        makeStateTransitionedEvent({
          runId: RUN,
          tenantId: TENANT_A,
          sequence,
          occurredAt: T3,
          from: 'completed',
          to: 'cleaned',
          lifecycleEvent: 'cleaned',
        }),
      ),
    );
    expect(() =>
      appendRuntimeEventEnvelope(
        cleaned,
        envelop(9, (sequence) =>
          makeCheckpointRecordedEvent({
            runId: RUN,
            tenantId: TENANT_A,
            sequence,
            occurredAt: T3,
            checkpointSequence: 1,
            snapshotDigest: DIGEST_C,
            stepIndex: 1,
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
    verifyEnvironmentEventLog(cleaned);
  });

  it('rejects events whose tenant contradicts the run id, and non-event envelopes (negative)', () => {
    expect(() =>
      appendRuntimeEventEnvelope(
        createEnvironmentEventLog(),
        envelop(1, (sequence) =>
          makeRunSubmittedEvent({
            runId: RUN,
            tenantId: 'tenant-b',
            sequence,
            occurredAt: T1,
            recordDigest: DIGEST_C,
            jobRef: 'job-1',
            seed: null,
          }),
        ),
      ),
    ).toThrow(EnvironmentRuntimeError);
    const commandLike = {
      ...at(happyStream(), 0),
      kind: 'command' as const,
    };
    expect(() =>
      appendRuntimeEventEnvelope(createEnvironmentEventLog(), commandLike),
    ).toThrow(EnvironmentRuntimeError);
    expect(() =>
      appendRuntimeEventEnvelope(createEnvironmentEventLog(), null as never),
    ).toThrow(EnvironmentRuntimeError);
    expect(() => verifyEnvironmentEventLog(null as never)).toThrow(EnvironmentRuntimeError);
    expect(isEnvironmentEventLog({ entries: 'nope' })).toBe(false);
  });

  it('error codes are the closed taxonomy (positive)', () => {
    expect(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_GAP).toBe(
      'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_GAP',
    );
    expect(ENVIRONMENT_RUNTIME_ERROR_CODES.EVENT_SEQUENCE_DUPLICATE).toBe(
      'ENVIRONMENT_RUNTIME_EVENT_SEQUENCE_DUPLICATE',
    );
  });
});
