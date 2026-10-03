/**
 * Environment event-stream view-model tests (Work Order B011;
 * packages/replay-ui).
 *
 * Positive: REAL enveloped A010 runtime events project at full fidelity
 * (envelope array, EnvironmentEventLog object and bare-event array all
 * accepted), with step linkage where the event carries it. Negative /
 * honest states: absent stream (no-data), present-but-empty stream
 * (empty), and a corrupt entry (degraded, unknown row) — never a crash.
 */

import { describe, expect, it } from 'vitest';
import {
  createEnvironmentEventLog,
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
  makeRuntimeEventEnvelope,
  appendRuntimeEventEnvelope,
} from '@arena/environment-runtime';
import { toReplayEventStream } from './event-stream.js';

const T0 = '2026-10-01T08:00:00.000Z';
const T1 = '2026-10-01T08:01:00.000Z';
const T2 = '2026-10-01T08:02:00.000Z';
const DIGEST_A = '1111111111111111111111111111111111111111111111111111111111111111';
const DIGEST_B = '2222222222222222222222222222222222222222222222222222222222222222';
const RUN_ID = 'arena-demo/event-stream-test';
const TENANT = 'arena-demo';

function envelopedEvents() {
  const submitted = makeRunSubmittedEvent({
    sequence: 1,
    occurredAt: T0,
    runId: RUN_ID,
    tenantId: TENANT,
    recordDigest: DIGEST_A,
    jobRef: 'job-payments-reliability',
    seed: 'seed-event-stream',
  });
  const admission = makeAdmissionDecidedEvent({
    sequence: 2,
    occurredAt: T0,
    runId: RUN_ID,
    tenantId: TENANT,
    admitted: true,
    violations: [],
  });
  const transition = makeStateTransitionedEvent({
    sequence: 3,
    occurredAt: T0,
    runId: RUN_ID,
    tenantId: TENANT,
    from: 'requested',
    to: 'provisioning',
    lifecycleEvent: 'provision-started',
  });
  const workload = makeWorkloadProgressedEvent({
    sequence: 4,
    occurredAt: T1,
    runId: RUN_ID,
    tenantId: TENANT,
    step: 2,
    simulatedElapsedMs: 3400,
  });
  const checkpoint = makeCheckpointRecordedEvent({
    sequence: 5,
    occurredAt: T2,
    runId: RUN_ID,
    tenantId: TENANT,
    checkpointSequence: 1,
    snapshotDigest: DIGEST_B,
    stepIndex: 3,
  });
  return [submitted, admission, transition, workload, checkpoint].map((event, index) =>
    makeRuntimeEventEnvelope(event, {
      correlationId: `corr-${String(index + 1)}` as never,
      idempotencyKey: `idem-${String(index + 1)}` as never,
    }),
  );
}

describe('toReplayEventStream — positive projection of REAL runtime events', () => {
  it('accepts an envelope array and projects every event under simulation-replay', () => {
    const stream = toReplayEventStream(envelopedEvents());
    expect(stream.state).toBe('ready');
    expect(stream.events).toHaveLength(5);
    for (const row of stream.events) {
      expect(row.truthClass).toBe('simulation-replay');
    }
    expect(stream.events.map((row) => row.kind)).toEqual([
      'run-submitted',
      'admission-decided',
      'state-transitioned',
      'workload-progressed',
      'checkpoint-recorded',
    ]);
  });

  it('accepts an EnvironmentEventLog object (the canonical per-run shape)', () => {
    let log = createEnvironmentEventLog();
    for (const envelope of envelopedEvents()) {
      log = appendRuntimeEventEnvelope(log, envelope);
    }
    const stream = toReplayEventStream(log);
    expect(stream.state).toBe('ready');
    expect(stream.events).toHaveLength(5);
  });

  it('summarizes each event kind and links checkpoint/workload events to step indexes', () => {
    const stream = toReplayEventStream(envelopedEvents());
    expect(stream.events[0]?.summary).toContain('run submitted');
    expect(stream.events[0]?.summary).toContain('job-payments-reliability');
    expect(stream.events[1]?.summary).toContain('admission granted');
    expect(stream.events[2]?.summary).toContain('requested → provisioning (provision-started)');
    expect(stream.events[3]?.linkedStep).toBe(2);
    expect(stream.events[3]?.summary).toContain('workload step 2');
    expect(stream.events[4]?.linkedStep).toBe(3);
    expect(stream.events[4]?.summary).toContain('checkpoint 1 recorded at step 3');
  });

  it('carries occurredAt on readable rows (wall-clock, canonical ms-UTC)', () => {
    const stream = toReplayEventStream(envelopedEvents());
    expect(stream.events[0]?.occurredAt).toBe(T0);
    expect(stream.events[3]?.occurredAt).toBe(T1);
  });
});

describe('toReplayEventStream — honest stream states (never collapsed)', () => {
  it('renders no-data when no stream was provided at all', () => {
    for (const payload of [null, undefined, 42, 'garbage', { entries: 'nope' }]) {
      const stream = toReplayEventStream(payload);
      expect(stream.state).toBe('no-data');
      expect(stream.events).toHaveLength(0);
      expect(stream.note).toContain('no data');
    }
  });

  it('renders empty when a stream exists but records zero events (distinct from no-data)', () => {
    const stream = toReplayEventStream([]);
    expect(stream.state).toBe('empty');
    expect(stream.note).toContain('empty');
    expect(stream.note).not.toContain('no data');
  });

  it('degrades (never crashes) when an entry fails the runtime-event guard', () => {
    const envelopes = envelopedEvents();
    const corrupt = [...envelopes.slice(0, 2), { payload: { nonsense: true } }, ...envelopes.slice(2)];
    const stream = toReplayEventStream(corrupt);
    expect(stream.state).toBe('degraded');
    expect(stream.unreadableCount).toBe(1);
    expect(stream.events).toHaveLength(6);
    expect(stream.events[2]?.kind).toBe('unreadable');
    expect(stream.events[2]?.truthClass).toBe('unknown');
    expect(stream.events[3]?.kind).toBe('state-transitioned');
    expect(stream.events[2]?.truthClass).toBe('unknown');
    expect(stream.note).toContain('failed structural validation');
  });

  it('never throws on hostile inputs (total projection)', () => {
    expect(() => toReplayEventStream([null, 42, 'x', { payload: null }])).not.toThrow();
    expect(() => toReplayEventStream({ entries: [null] })).not.toThrow();
  });
});
