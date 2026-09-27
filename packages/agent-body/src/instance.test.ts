/**
 * AgentInstance tests: append-only lifecycle, event-stream invariants,
 * terminal-state finality (gate 7: mutating a terminated instance throws),
 * strict wire parsing and freeze.
 */

import { describe, expect, it } from 'vitest';
import { AgentBodyError } from './errors.js';
import { AGENT_BODY_ERROR_CODES } from './errors.js';
import {
  appendAgentInstanceEvent,
  completeAgentInstance,
  createAgentInstance,
  failAgentInstance,
  isAgentInstance,
  isTerminatedAgentInstance,
  parseAgentInstance,
  resumeAgentInstance,
  startAgentInstance,
  suspendAgentInstance,
  terminateAgentInstance,
} from './instance.js';
import { DIGEST_A, TIMESTAMP, TIMESTAMP_LATER } from './test-support.js';

const ENVIRONMENT = {
  environmentId: 'env-standard',
  environmentVersion: '3.2.0',
  instanceId: 'env-inst-0001',
  snapshotDigest: '5'.repeat(64),
} as const;

function makeInstance() {
  return createAgentInstance({
    possessionDigest: DIGEST_A,
    environment: ENVIRONMENT,
    instanceId: 'agent-inst-0001',
    createdAt: TIMESTAMP,
  });
}

describe('AgentInstance creation (positive)', () => {
  it('carries instance id, possession digest, environment instance, runtime state, event stream, termination status (spec AB1.0)', () => {
    const instance = makeInstance();
    expect(instance.instanceId).toBe('agent-inst-0001');
    expect(instance.possessionDigest).toBe(DIGEST_A);
    expect(instance.environment.environmentId).toBe('env-standard');
    expect(instance.runtimeState).toBe('initialized');
    expect(instance.events).toHaveLength(1);
    expect(instance.events[0]?.kind).toBe('instance-created');
    expect(instance.events[0]?.sequence).toBe(1);
    expect(instance.termination).toBeNull();
    expect(isAgentInstance(instance)).toBe(true);
    expect(isTerminatedAgentInstance(instance)).toBe(false);
  });

  it('mints a UUIDv4 instance id when absent', () => {
    const instance = createAgentInstance({
      possessionDigest: DIGEST_A,
      environment: ENVIRONMENT,
    });
    expect(instance.instanceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('is deeply frozen', () => {
    const instance = makeInstance();
    expect(Object.isFrozen(instance)).toBe(true);
    expect(Object.isFrozen(instance.events)).toBe(true);
    expect(Object.isFrozen(instance.events[0])).toBe(true);
    expect(Object.isFrozen(instance.environment)).toBe(true);
    expect(() => {
      (instance as unknown as Record<string, unknown>)['runtimeState'] = 'running';
    }).toThrow(TypeError);
  });
});

describe('lifecycle transitions (positive, append-only)', () => {
  it('initialized → running → suspended → running', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    expect(started.runtimeState).toBe('running');
    expect(started.events.map((event) => event.kind)).toEqual(['instance-created', 'started']);
    const suspended = suspendAgentInstance(started, TIMESTAMP_LATER);
    expect(suspended.runtimeState).toBe('suspended');
    const resumed = resumeAgentInstance(suspended, TIMESTAMP_LATER);
    expect(resumed.runtimeState).toBe('running');
    expect(resumed.events).toHaveLength(4);
    expect(resumed.events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(makeInstance().events).toHaveLength(1); // pure: inputs untouched
  });

  it('appends observations, actions, escalations and errors with payloads', () => {
    let instance = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    instance = appendAgentInstanceEvent(instance, {
      kind: 'observation',
      occurredAt: TIMESTAMP_LATER,
      payload: { note: 'blueprint parsed', sheets: 12 },
    });
    instance = appendAgentInstanceEvent(instance, {
      kind: 'error',
      occurredAt: TIMESTAMP_LATER,
      payload: { message: 'load case missing' },
    });
    expect(instance.events).toHaveLength(4);
    expect(instance.events[2]?.payload).toEqual({ note: 'blueprint parsed', sheets: 12 });
    expect(instance.runtimeState).toBe('running');
  });

  it('terminal transitions append the terminated event and freeze the status', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const completed = completeAgentInstance(started, {
      reason: 'task finished',
      terminatedAt: TIMESTAMP_LATER,
    });
    expect(completed.termination).toEqual({
      status: 'completed',
      terminatedAt: TIMESTAMP_LATER,
      reason: 'task finished',
    });
    expect(completed.runtimeState).toBe('running'); // state stays as-is; termination is the final word
    expect(completed.events[completed.events.length - 1]?.kind).toBe('terminated');
    expect(completed.events[completed.events.length - 1]?.payload).toEqual({
      status: 'completed',
      reason: 'task finished',
    });
    expect(isTerminatedAgentInstance(completed)).toBe(true);
    const failed = failAgentInstance(started, { reason: 'error budget exhausted' });
    expect(failed.termination?.status).toBe('failed');
    const terminated = terminateAgentInstance(started, { reason: 'operator request' });
    expect(terminated.termination?.status).toBe('terminated');
    expect(started.termination).toBeNull(); // pure: input untouched
  });
});

describe('lifecycle guards (negative — state machine + terminal finality)', () => {
  it('start requires the initialized state', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    expect(() => startAgentInstance(started)).toThrow(/cannot start from state running/);
  });

  it('suspend requires running; resume requires suspended', () => {
    expect(() => suspendAgentInstance(makeInstance())).toThrow(/cannot suspend from state initialized/);
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    expect(() => resumeAgentInstance(started)).toThrow(/cannot resume from state running/);
  });

  it('GATE 7: every mutation attempt on a TERMINATED instance throws INSTANCE_TERMINATED', () => {
    const completed = completeAgentInstance(makeInstance(), { reason: 'done' });
    const expectTerminated = (error: unknown): void => {
      expect(error).toBeInstanceOf(AgentBodyError);
      expect((error as AgentBodyError).code).toBe(AGENT_BODY_ERROR_CODES.INSTANCE_TERMINATED);
    };
    expectTerminated(capture(() => startAgentInstance(completed)));
    expectTerminated(capture(() => suspendAgentInstance(completed)));
    expectTerminated(capture(() => resumeAgentInstance(completed)));
    expectTerminated(
      capture(() =>
        appendAgentInstanceEvent(completed, { kind: 'observation', occurredAt: TIMESTAMP_LATER }),
      ),
    );
    expectTerminated(capture(() => completeAgentInstance(completed, { reason: 'again' })));
    expectTerminated(capture(() => failAgentInstance(completed, { reason: 'again' })));
    expectTerminated(capture(() => terminateAgentInstance(completed, { reason: 'again' })));
  });

  it('GATE 7: in-place mutation of a terminated instance throws (frozen)', () => {
    const completed = completeAgentInstance(makeInstance(), { reason: 'done' });
    expect(() => {
      (completed.termination as unknown as Record<string, unknown>)['status'] = 'completed';
    }).toThrow(TypeError);
    expect(() => {
      (completed as unknown as Record<string, unknown>)['termination'] = null;
    }).toThrow(TypeError);
    expect(completed.termination?.status).toBe('completed');
  });

  it('termination requires a non-empty reason; empty is rejected', () => {
    expect(() => completeAgentInstance(makeInstance(), { reason: '' })).toThrow(/non-empty reason/);
  });

  it('appendable events are limited to the open kinds', () => {
    const instance = makeInstance();
    for (const kind of ['instance-created', 'started', 'state-changed', 'terminated']) {
      expect(() =>
        appendAgentInstanceEvent(instance, { kind, occurredAt: TIMESTAMP_LATER }),
      ).toThrow(/not appendable/);
    }
  });

  it('event payloads must be plain JSON and neutral', () => {
    const instance = makeInstance();
    expect(() =>
      appendAgentInstanceEvent(instance, {
        kind: 'observation',
        occurredAt: TIMESTAMP_LATER,
        payload: { when: new Date() },
      }),
    ).toThrow(/plain JSON/);
    expect(() =>
      appendAgentInstanceEvent(instance, {
        kind: 'observation',
        occurredAt: TIMESTAMP_LATER,
        payload: { apiKey: 'x' },
      }),
    ).toThrow(/credential-shaped field/);
    expect(() =>
      appendAgentInstanceEvent(instance, {
        kind: 'observation',
        occurredAt: TIMESTAMP_LATER,
        payload: { model: 'gpt-4o-mini' },
      }),
    ).toThrow(/provider brand name/);
  });

  it('event timestamps must be monotonic non-decreasing', () => {
    const instance = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    expect(() =>
      appendAgentInstanceEvent(instance, { kind: 'observation', occurredAt: TIMESTAMP }),
    ).toThrow(/monotonically non-decreasing/);
  });
});

describe('strict wire parsing (append-only invariants on the wire form)', () => {
  it('round-trips a live instance', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const parsed = parseAgentInstance(JSON.parse(JSON.stringify(started)));
    expect(parsed).toEqual(started);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('round-trips a terminated instance', () => {
    const completed = completeAgentInstance(startAgentInstance(makeInstance(), TIMESTAMP_LATER), {
      reason: 'done',
      terminatedAt: TIMESTAMP_LATER,
    });
    expect(parseAgentInstance(JSON.parse(JSON.stringify(completed)))).toEqual(completed);
  });

  it('rejects a sequence gap (non-append-only stream)', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const gapped = JSON.parse(JSON.stringify(started)) as { events: { sequence: number }[] };
    gapped.events[1] = { ...gapped.events[1]!, sequence: 5 };
    expect(() => parseAgentInstance(gapped)).toThrow(/contiguous from 1/);
  });

  it('rejects non-monotonic timestamps', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const reordered = JSON.parse(JSON.stringify(started)) as {
      events: { occurredAt: string }[];
    };
    reordered.events[1] = { ...reordered.events[1]!, occurredAt: '2026-01-15T08:00:00.000Z' };
    expect(() => parseAgentInstance(reordered)).toThrow(/monotonically non-decreasing/);
  });

  it('rejects a terminated event without a termination status (and vice versa)', () => {
    const completed = completeAgentInstance(makeInstance(), { reason: 'done' });
    const noTermination = JSON.parse(JSON.stringify(completed)) as Record<string, unknown>;
    noTermination['termination'] = null;
    expect(() => parseAgentInstance(noTermination)).toThrow(
      /requires a non-null termination status/,
    );

    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const withTerminatedEvent = JSON.parse(JSON.stringify(started)) as {
      events: unknown[];
    };
    withTerminatedEvent.events.push({
      sequence: 3,
      kind: 'terminated',
      occurredAt: TIMESTAMP_LATER,
      payload: { status: 'failed', reason: 'x' },
    });
    expect(() => parseAgentInstance(withTerminatedEvent)).toThrow(
      /requires a non-null termination status/,
    );
  });

  it('rejects a terminated event whose payload disagrees with the termination', () => {
    const completed = completeAgentInstance(makeInstance(), { reason: 'done' });
    const mismatched = JSON.parse(JSON.stringify(completed)) as {
      termination: { reason: string };
    };
    mismatched.termination.reason = 'different reason';
    expect(() => parseAgentInstance(mismatched)).toThrow(/must carry the termination status/);
  });

  it('rejects a stream that does not start with instance-created', () => {
    const started = startAgentInstance(makeInstance(), TIMESTAMP_LATER);
    const swapped = JSON.parse(JSON.stringify(started)) as { events: { kind: string }[] };
    swapped.events[0] = { ...swapped.events[0]!, kind: 'observation' };
    expect(() => parseAgentInstance(swapped)).toThrow(/unique first event/);
  });

  it('rejects structurally invalid instances and malformed creation inputs', () => {
    expect(() => parseAgentInstance({})).toThrow(/structurally valid/);
    expect(() => parseAgentInstance('nope')).toThrow(/structurally valid/);
    expect(() =>
      createAgentInstance({
        possessionDigest: 'not-a-digest',
        environment: ENVIRONMENT,
      }),
    ).toThrow(/content digest/);
    expect(() =>
      createAgentInstance({
        possessionDigest: DIGEST_A,
        environment: { ...ENVIRONMENT, environmentId: 'BAD' },
      }),
    ).toThrow(/environment/);
    expect(() =>
      createAgentInstance({
        possessionDigest: DIGEST_A,
        environment: ENVIRONMENT,
        instanceId: '###',
      }),
    ).toThrow(/instance id/);
  });
});

function capture(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return new Error('expected action to throw');
}
