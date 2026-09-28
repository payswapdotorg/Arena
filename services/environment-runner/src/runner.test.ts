/**
 * Reference runner tests (Work Order A010 gate 10; gates 2-9 exercised
 * end-to-end through the service): happy-path lifecycle, admission
 * (fit + rejection), tenant isolation, idempotent submission, time-limit
 * enforcement, checkpoint/restore, RunResult production, wrong-status
 * rejections and command-envelope validation.
 */

import { describe, expect, it } from 'vitest';
import { createEnvironmentDefinition } from '@arena/environment-protocol';
import type { EnvironmentDefinition } from '@arena/environment-protocol';
import { newCorrelationId, toIdempotencyKey } from '@arena/protocol-core';
import {
  ENVIRONMENT_RUNTIME_ERROR_CODES,
  EnvironmentRuntimeError,
  eventsForRun,
  makeAdvanceRunCommand,
  makeCheckpointRunCommand,
  makeCleanupRunCommand,
  makeCompleteRunCommand,
  makeFailRunCommand,
  makeRestoreRunCommand,
  makeStartRunCommand,
  makeSubmitRunCommand,
  stepLcg,
  verifyEnvironmentEventLog,
} from '@arena/environment-runtime';
import type { Envelope } from '@arena/protocol-core';
import { EnvironmentRunner } from './runner.js';
import {
  InMemoryEnvironmentRegistry,
  InMemoryEventSink,
  InMemoryRunRecordStore,
  ManualClock,
} from './in-memory.js';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const START_MS = Date.parse('2026-01-15T09:30:00.000Z');

async function makeDefinition(
  overrides: {
    cpuMillis?: number;
    memoryMiB?: number;
    wallClockSeconds?: number;
  } = {},
): Promise<EnvironmentDefinition> {
  return createEnvironmentDefinition({
    identity: { namespace: 'tenant-a', name: 'engineering-sandbox' },
    version: '1.2.0',
    image: { imageKind: 'content-addressed-image', digest: DIGEST_A, buildDigest: null },
    initialState: {
      snapshot: { snapshotId: 'snapshot-initial', digest: DIGEST_B },
      snapshotSupport: 'supported',
    },
    seedPolicy: {
      reproducibility: {
        mode: 'nondeterministic',
        capture: {
          seed: 'the run seed drives the LCG step derivation',
          versions: 'environment-runtime 1.0.0',
          externalInputs: 'none - the reference simulation is closed',
          timingContext: 'injected manual clock',
        },
      },
      seed: 'demo-seed-42',
      seedAlgorithm: 'lcg-32',
      reseedPolicy: 'forbidden',
    },
    actionSurface: { actions: [{ actionId: 'compile' }] },
    observationSurface: { observations: [{ observationId: 'build-log', channel: 'stdout' }] },
    resourceLimits: {
      cpuMillis: overrides.cpuMillis ?? 4000,
      memoryMiB: overrides.memoryMiB ?? 1024,
      wallClockSeconds: overrides.wallClockSeconds ?? 30,
    },
    networkPolicy: {
      egress: 'default-deny',
      allows: [{ host: 'packages.example.org', port: 443, protocol: 'https' }],
    },
    filesystemPolicy: {
      writeMode: 'declared-mounts-only',
      mounts: [
        { mountPath: '/workspace', access: 'read-write', source: 'workspace' },
        { mountPath: '/run/secrets', access: 'read-only', source: 'initial-state' },
      ],
    },
    secretPolicy: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        { secretId: 'registry-credentials', mountPath: '/run/secrets/registry', mechanism: 'file-mount' },
      ],
    },
    timeLimits: {
      startupSeconds: Math.min(10, overrides.wallClockSeconds ?? 30),
      cleanupGraceSeconds: Math.min(5, overrides.wallClockSeconds ?? 30),
      deadlineBehavior: 'hard-stop',
    },
    resetSemantics: { mode: 'recreate', checkpoint: null, cleanup: 'retain-evidence' },
    checkpointSemantics: { supported: true, triggers: ['manual'], retention: 10 },
    evidenceOutputs: {
      outputs: [
        {
          outputId: 'trajectory',
          kind: 'trajectory',
          addressing: 'content-addressed',
          description: 'the run event stream',
        },
      ],
    },
    evaluationHooks: {
      evaluators: [
        {
          hookId: 'evaluator-trajectory',
          role: 'evaluator',
          phase: 'post-run',
          invocationSchema: 'arena:schema/environment-runtime/run-result@1.0.0',
        },
      ],
      verifiers: [
        {
          hookId: 'verifier-evidence',
          role: 'verifier',
          phase: 'on-evidence',
          invocationSchema: 'arena:schema/environment-runtime/run-result@1.0.0',
        },
      ],
    },
  });
}

function declarationInput(
  overrides: { runKey?: string; cpuMillis?: number; wallClockSeconds?: number } = {},
) {
  return {
    runKey: overrides.runKey ?? 'run-000042',
    tenantId: 'tenant-a',
    environment: {
      namespace: 'tenant-a',
      name: 'engineering-sandbox',
      version: '1.2.0',
      digest: 'digest-placeholder',
    },
    jobRef: 'job-7f3a2b',
    taskVersion: { taskId: 'task-build-website', version: '2.1.0' },
    initialSnapshotDigest: DIGEST_B,
    seed: 'demo-seed-42',
    resourceEnvelope: {
      cpuMillis: overrides.cpuMillis ?? 2000,
      memoryMiB: 512,
      wallClockSeconds: overrides.wallClockSeconds ?? 20,
    },
    networkEnvelope: {
      egress: 'default-deny',
      allows: [{ host: 'packages.example.org', port: 443, protocol: 'https' }],
    },
    filesystemEnvelope: {
      writeMode: 'declared-mounts-only',
      mounts: [{ mountPath: '/workspace/src', access: 'read-write', source: 'workspace' }],
    },
    secretEnvelope: {
      isolation: 'isolation-boundary',
      injectionPoints: [
        { secretId: 'registry-credentials', mountPath: '/run/secrets/registry', mechanism: 'file-mount' },
      ],
    },
  };
}

interface Harness {
  readonly runner: EnvironmentRunner;
  readonly clock: ManualClock;
  readonly definition: EnvironmentDefinition;
  command(): { correlationId: ReturnType<typeof newCorrelationId>; idempotencyKey: ReturnType<typeof toIdempotencyKey> };
}

async function makeHarness(
  definitionOverrides: { cpuMillis?: number; memoryMiB?: number; wallClockSeconds?: number } = {},
): Promise<Harness> {
  const definition = await makeDefinition(definitionOverrides);
  const clock = new ManualClock(START_MS);
  const runner = new EnvironmentRunner({
    clock,
    environments: new InMemoryEnvironmentRegistry(),
    records: new InMemoryRunRecordStore(),
    sink: new InMemoryEventSink(),
  });
  await runner.registerEnvironment(definition);
  let counter = 0;
  return {
    runner,
    clock,
    definition,
    command: () => {
      counter += 1;
      return {
        correlationId: newCorrelationId(),
        idempotencyKey: toIdempotencyKey(`test-${String(counter)}`),
      };
    },
  };
}

function declarationFor(
  definition: EnvironmentDefinition,
  overrides: { runKey?: string; cpuMillis?: number; wallClockSeconds?: number } = {},
) {
  const declaration = declarationInput(overrides);
  declaration.environment.digest = definition.digest;
  return declaration;
}

describe('reference runner — happy path (gates 2-9 end-to-end)', () => {
  it('drives a full deterministic run to a verified RunResult and cleanup', async () => {
    const { runner, clock, definition, command } = await makeHarness();
    const ctx = command();
    const submitted = await runner.submitRun(
      makeSubmitRunCommand({ declaration: declarationFor(definition) }, ctx),
    );
    expect(submitted.record.runId).toBe('tenant-a/run-000042');
    expect(submitted.decision.admitted).toBe(true);
    expect(submitted.state.status).toBe('requested');

    const target = { runId: 'tenant-a/run-000042', tenantId: 'tenant-a' };
    const lifeCtx = () => ({
      correlationId: ctx.correlationId,
      idempotencyKey: toIdempotencyKey('life'),
    });

    let state = await runner.startRun(makeStartRunCommand(target, lifeCtx()));
    expect(state.status).toBe('running');
    expect(state.admitted).toBe(true);

    state = await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
    expect(state.worldStep).toBe(1);
    const expectedMs = stepLcg('demo-seed-42', 'step', 1).intBetween(50, 500);
    expect(state.worldElapsedMs).toBe(expectedMs);

    const { checkpoint } = await runner.checkpointRun(makeCheckpointRunCommand(target, lifeCtx()));
    expect(checkpoint.sequence).toBe(1);
    expect(checkpoint.stepIndex).toBe(1);

    state = await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
    expect(state.worldStep).toBe(2);
    expect(state.checkpoints.length).toBe(1);

    state = await runner.restoreRun(
      makeRestoreRunCommand(
        { ...target, checkpoint: { runId: target.runId, sequence: 1, snapshotDigest: checkpoint.snapshotDigest } },
        lifeCtx(),
      ),
    );
    expect(state.worldStep).toBe(1);
    expect(state.restoredToCheckpoint).toBe(1);

    state = await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
    expect(state.worldStep).toBe(2); // same step re-derived deterministically

    const { state: completed, result } = await runner.completeRun(
      makeCompleteRunCommand(target, lifeCtx()),
    );
    expect(completed.status).toBe('completed');
    expect(completed.resultDigest).toBe(result.digest);
    expect(result.runAddress.taskVersion.taskId).toBe('task-build-website');
    expect(result.runAddress.runId).toBe('run-000042');
    expect(result.runAddress.initialSnapshotDigest).toBe(DIGEST_B);
    expect(result.runAddress.evidenceDigests.length).toBe(2); // trajectory + checkpoint
    expect(result.runAddress.environmentVersion.digest).toBe(definition.digest);

    state = await runner.cleanupRun(makeCleanupRunCommand(target, lifeCtx()));
    expect(state.status).toBe('cleaned');

    // The whole stream verifies by replay (gate 7) and is enveloped +
    // idempotency-keyed (gate 4).
    const log = await runner.eventLog();
    verifyEnvironmentEventLog(log);
    const runEvents = eventsForRun(log, 'tenant-a/run-000042');
    expect(runEvents.length).toBeGreaterThan(10);
    for (const [index, envelope] of runEvents.entries()) {
      expect(envelope.kind).toBe('event');
      // The first two events ride the submission's idempotency key;
      // the lifecycle events ride the lifecycle key (gate 4).
      const expectedKey =
        index < 2 ? ctx.idempotencyKey : toIdempotencyKey('life');
      expect(envelope.idempotencyKey).toBe(expectedKey);
      expect(envelope.correlationId).toBe(ctx.correlationId);
    }
    clock.advance(1);
  });
});

describe('admission (gate 5)', () => {
  it('rejects over-quota submissions with typed errors and logs the rejection', async () => {
    const { runner, definition, command } = await makeHarness();
    const error = await capture(async () =>
      runner.submitRun(
        makeSubmitRunCommand(
          { declaration: declarationFor(definition, { runKey: 'run-000099', cpuMillis: 9999 }) },
          command(),
        ),
      ),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED);
    expect((error?.details as { violations: string[] }).violations.length).toBe(1);

    // Observability (gate 7): the rejected run IS in the log with the
    // decision + failed transition, and is queryable.
    const log = await runner.eventLog();
    const events = eventsForRun(log, 'tenant-a/run-000099');
    expect(events.length).toBe(3);
    expect(events[0]?.payload.kind).toBe('run-submitted');
    expect(events[1]?.payload.kind).toBe('admission-decided');
    expect(events[2]?.payload.kind).toBe('state-transitioned');
    const { state } = await runner.getRun('tenant-a/run-000099', 'tenant-a');
    expect(state.status).toBe('failed');
    // A rejected run can never start.
    const startError = await capture(() =>
      runner.startRun(
        makeStartRunCommand(
          { runId: 'tenant-a/run-000099', tenantId: 'tenant-a' },
          command(),
        ),
      ),
    );
    expect(startError?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED);
  });

  it('rejects submissions against unregistered environments (negative)', async () => {
    const { runner, command } = await makeHarness();
    const declaration = declarationInput();
    const error = await capture(() =>
      runner.submitRun(makeSubmitRunCommand({ declaration }, command())),
    );
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF);
  });
});

describe('idempotent submission (lock rule 17)', () => {
  it('returns the SAME record for duplicate submissions; conflicts reject', async () => {
    const { runner, definition, command } = await makeHarness();
    const ctx = command();
    const declaration = declarationFor(definition);
    const first = await runner.submitRun(makeSubmitRunCommand({ declaration }, ctx));
    const second = await runner.submitRun(makeSubmitRunCommand({ declaration }, ctx));
    expect(second.record.digest).toBe(first.record.digest);
    expect(second.record.runId).toBe(first.record.runId);
    // No duplicate events were emitted.
    const log = await runner.eventLog();
    expect(eventsForRun(log, first.record.runId).length).toBe(2);

    // Same idempotency key, different content ⇒ IDENTITY_CONFLICT.
    const conflict = await capture(() =>
      runner.submitRun(
        makeSubmitRunCommand(
          { declaration: { ...declaration, jobRef: 'job-different' } },
          ctx,
        ),
      ),
    );
    expect(conflict?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.IDENTITY_CONFLICT);
  });
});

describe('tenant isolation (gate 6, R29)', () => {
  it('rejects cross-tenant run references (negative)', async () => {
    const { runner, definition, command } = await makeHarness();
    await runner.submitRun(
      makeSubmitRunCommand({ declaration: declarationFor(definition) }, command()),
    );
    const error = await capture(() => runner.getRun('tenant-a/run-000042', 'tenant-b'));
    expect(error?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION);

    const commandError = await capture(() =>
      runner.startRun(
        makeStartRunCommand(
          { runId: 'tenant-a/run-000042', tenantId: 'tenant-b' },
          command(),
        ),
      ),
    );
    expect(commandError?.code).toBe(
      ENVIRONMENT_RUNTIME_ERROR_CODES.TENANT_ISOLATION_VIOLATION,
    );
    // The owning tenant may still act.
    await expect(
      runner.getRun('tenant-a/run-000042', 'tenant-a'),
    ).resolves.toBeTruthy();
  });
});

describe('time-limit enforcement (gate 3)', () => {
  it('transitions to timed-out when the wall clock is exhausted', async () => {
    const { runner, definition, command } = await makeHarness({ wallClockSeconds: 1 });
    await runner.submitRun(
      makeSubmitRunCommand(
        { declaration: declarationFor(definition, { cpuMillis: 1000, wallClockSeconds: 1 }) },
        command(),
      ),
    );
    const target = { runId: 'tenant-a/run-000042', tenantId: 'tenant-a' };
    const lifeCtx = () => ({
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('life-timeout'),
    });
    await runner.startRun(makeStartRunCommand(target, lifeCtx()));
    let state = await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
    // Keep advancing until the 1000ms wall clock is exhausted (LCG
    // steps are 50..500ms, so this terminates quickly).
    let guard = 0;
    while (state.status === 'running' && guard < 50) {
      state = await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
      guard += 1;
    }
    expect(state.status).toBe('timed-out');
    // Completion is now illegal; cleanup is the only exit.
    const completeError = await capture(() =>
      runner.completeRun(makeCompleteRunCommand(target, lifeCtx())),
    );
    expect(completeError?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
    state = await runner.cleanupRun(makeCleanupRunCommand(target, lifeCtx()));
    expect(state.status).toBe('cleaned');
  });
});

describe('lifecycle legality (gate 3) + command validation', () => {
  it('rejects wrong-status commands with ILLEGAL_TRANSITION carrying from/to', async () => {
    const { runner, definition, command } = await makeHarness();
    await runner.submitRun(
      makeSubmitRunCommand({ declaration: declarationFor(definition) }, command()),
    );
    const target = { runId: 'tenant-a/run-000042', tenantId: 'tenant-a' };
    const lifeCtx = () => ({
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('life-status'),
    });

    // advance on a requested run
    const advanceError = await capture(() =>
      runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx())),
    );
    expect(advanceError?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
    expect(advanceError?.details).toMatchObject({ from: 'requested', to: 'running' });

    // cleanup on a requested run (only outcome states may clean)
    const cleanupError = await capture(() =>
      runner.cleanupRun(makeCleanupRunCommand(target, lifeCtx())),
    );
    expect(cleanupError?.details).toMatchObject({ from: 'requested', to: 'cleaned' });

    await runner.startRun(makeStartRunCommand(target, lifeCtx()));
    // start on a running run
    const startError = await capture(() =>
      runner.startRun(makeStartRunCommand(target, lifeCtx())),
    );
    expect(startError?.details).toMatchObject({ from: 'running', to: 'provisioning' });

    // restore with no recorded checkpoints
    const restoreError = await capture(() =>
      runner.restoreRun(
        makeRestoreRunCommand(
          { ...target, checkpoint: { runId: target.runId, sequence: 1, snapshotDigest: DIGEST_B } },
          lifeCtx(),
        ),
      ),
    );
    expect(restoreError?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);

    // fail from running, then terminal finality
    let state = await runner.failRun(
      makeFailRunCommand(
        { ...target, errorClass: 'workload-error', message: 'boom' },
        lifeCtx(),
      ),
    );
    expect(state.status).toBe('failed');
    const refail = await capture(() =>
      runner.failRun(
        makeFailRunCommand(
          { ...target, errorClass: 'workload-error', message: 'again' },
          lifeCtx(),
        ),
      ),
    );
    expect(refail?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION);
    state = await runner.cleanupRun(makeCleanupRunCommand(target, lifeCtx()));
    expect(state.status).toBe('cleaned');
  });

  it('rejects malformed command envelopes (negative)', async () => {
    const { runner, definition, command } = await makeHarness();
    const ctx = command();
    const submit = makeSubmitRunCommand({ declaration: declarationFor(definition) }, ctx);
    // Wrong kind.
    const wrongKind = { ...submit, kind: 'event' as const };
    await expect(runner.submitRun(wrongKind)).rejects.toThrow(EnvironmentRuntimeError);
    // Wrong schema pin.
    const wrongSchema = { ...submit, schema: 'arena:schema/environment-runtime/start-run-command@1.0.0' };
    await expect(runner.submitRun(wrongSchema)).rejects.toThrow(EnvironmentRuntimeError);
    // Null idempotency key.
    const noIdem = { ...submit, idempotencyKey: null };
    await expect(runner.submitRun(noIdem)).rejects.toThrow(EnvironmentRuntimeError);
    // Not an envelope.
    await expect(runner.submitRun(null as never)).rejects.toThrow(EnvironmentRuntimeError);
  });

  it('validates fail-run payloads (negative)', async () => {
    const { runner, definition, command } = await makeHarness();
    await runner.submitRun(
      makeSubmitRunCommand({ declaration: declarationFor(definition) }, command()),
    );
    const target = { runId: 'tenant-a/run-000042', tenantId: 'tenant-a' };
    const bad = {
      kind: 'command' as const,
      v: 1 as const,
      schema: 'arena:schema/environment-runtime/fail-run-command@1.0.0',
      id: '00000000-0000-4000-8000-000000000000',
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('bad-fail'),
      issuedAt: new Date().toISOString(),
      payload: { runId: target.runId, tenantId: target.tenantId, errorClass: 'Bad Class', message: 'x' },
    } as unknown as Envelope<never>;
    await expect(runner.failRun(bad)).rejects.toThrow(EnvironmentRuntimeError);
    void definition;
  });
});

describe('checkpoint restore negatives (gate 8)', () => {
  it('rejects foreign-run checkpoints and digest mismatches through the runner', async () => {
    const { runner, definition, command } = await makeHarness();
    await runner.submitRun(
      makeSubmitRunCommand({ declaration: declarationFor(definition) }, command()),
    );
    const target = { runId: 'tenant-a/run-000042', tenantId: 'tenant-a' };
    const lifeCtx = () => ({
      correlationId: newCorrelationId(),
      idempotencyKey: toIdempotencyKey('life-cp'),
    });
    await runner.startRun(makeStartRunCommand(target, lifeCtx()));
    await runner.advanceRun(makeAdvanceRunCommand(target, lifeCtx()));
    const { checkpoint } = await runner.checkpointRun(
      makeCheckpointRunCommand(target, lifeCtx()),
    );

    const foreign = await capture(() =>
      runner.restoreRun(
        makeRestoreRunCommand(
          {
            ...target,
            checkpoint: { runId: 'tenant-b/run-000042', sequence: 1, snapshotDigest: checkpoint.snapshotDigest },
          },
          lifeCtx(),
        ),
      ),
    );
    expect(foreign?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);

    const tampered = await capture(() =>
      runner.restoreRun(
        makeRestoreRunCommand(
          {
            ...target,
            checkpoint: { runId: target.runId, sequence: 1, snapshotDigest: 'f'.repeat(64) },
          },
          lifeCtx(),
        ),
      ),
    );
    expect(tampered?.code).toBe(ENVIRONMENT_RUNTIME_ERROR_CODES.CHECKPOINT_REJECTED);
  });
});

async function capture(fn: () => Promise<unknown>): Promise<EnvironmentRuntimeError | undefined> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof EnvironmentRuntimeError) return error;
  }
  return undefined;
}
