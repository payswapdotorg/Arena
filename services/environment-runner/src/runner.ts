/**
 * EnvironmentRunner (Work Order A010 gate 10) — the in-process
 * REFERENCE runner: a deterministic, seeded-LCG state machine over
 * @arena/environment-runtime with pluggable persistence via injected
 * ports. ZERO external runtime dependencies; NO container or namespace
 * execution — workload execution is SIMULATED deterministically in pure
 * TypeScript (like adapters/models' reference adapters). Real isolation
 * runtimes ship later per deployment tier.
 *
 * Responsibilities (lock rule 16 — the runner owns run EXECUTION):
 *   - consumes job-orchestrator-style command envelopes (kind
 *     'command', versioned environment-runtime schema refs, REQUIRED
 *     idempotency keys — lock rule 17);
 *   - performs ADMISSION (gate 5): the run's declared isolation
 *     envelope must FIT the target environment's A009 bounds;
 *     over-quota / least-privilege violations are logged as
 *     admission-decided events and rejected with typed errors;
 *   - enforces TENANT ISOLATION (gate 6, R29): every command's tenant
 *     must own the run it addresses (run ids are tenant-scoped);
 *   - drives the lifecycle state machine (gate 3) and emits the
 *     enveloped, idempotency-keyed event stream (gates 4, 7);
 *   - simulates deterministic workload execution (seeded LCG — never
 *     Math.random) and ENFORCES TIME LIMITS (wall-clock exhaustion
 *     transitions the run to timed-out);
 *   - takes/restores content-addressed checkpoints (gate 8);
 *   - produces the evidence-addressed RunResult for completed runs
 *     (gate 9, binding A009's RunAddress).
 *
 * Determinism: given the same (clock readings, store state, sink
 * state, envelope-id source), every method returns the same result —
 * the property suite proves it. The engine NEVER sleeps: time limits
 * compare pure simulated-elapsed data against the declared wall clock.
 */

import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import { digestCanonical, toIdempotencyKey } from '@arena/protocol-core';
import type { EnvironmentDefinition, TaskVersionRef } from '@arena/environment-protocol';
import { jobSubmissionKey, toJobSubmissionIdentity } from '@arena/job-protocol';
import {
  applyRuntimeEvent,
  assertSameTenant,
  createRunCheckpoint,
  createRunRecord,
  createRunResult,
  ENVIRONMENT_RUNTIME_ERROR_CODES,
  EnvironmentRuntimeError,
  eventsForRun,
  evaluateAdmission,
  initialRunState,
  makeAdmissionDecidedEvent,
  makeCheckpointRecordedEvent,
  makeCheckpointRestoredEvent,
  makeRunResultProducedEvent,
  makeRunSubmittedEvent,
  makeStateTransitionedEvent,
  makeWorkloadProgressedEvent,
  restoreToCheckpoint,
  runIdKey,
  stepLcg,
  toEnvironmentAdmissionView,
  toRunAddress,
  toRunId,
  toRunTimestamp,
  toTenantId,
  transitionRunState,
} from '@arena/environment-runtime';
import type {
  AdmissionDecision,
  EnvironmentEventLog,
  RunCheckpoint,
  RunLifecycleEvent,
  RunRecord,
  RunStateSnapshot,
  RunResult,
  RuntimeEvent,
} from '@arena/environment-runtime';
import type {
  AdvanceRunCommandPayload,
  CheckpointRunCommandPayload,
  CleanupRunCommandPayload,
  CompleteRunCommandPayload,
  FailRunCommandPayload,
  RestoreRunCommandPayload,
  StartRunCommandPayload,
  SubmitRunCommandPayload,
} from '@arena/environment-runtime';
import { makeRuntimeEventEnvelope } from '@arena/environment-runtime';
import type { Clock, EnvironmentRegistry, EventSink, RunRecordStore } from './ports.js';
import type { RunSubmission } from './ports.js';

/** The idempotency scope qualifying submission keys (lock rule 17). */
const SUBMISSION_IDEMPOTENCY_SCOPE = 'environment-runner';

export interface EnvironmentRunnerDeps {
  readonly clock: Clock;
  readonly environments: EnvironmentRegistry;
  readonly records: RunRecordStore;
  readonly sink: EventSink;
  /** Optional deterministic envelope-id source (tests / demo). */
  readonly newEnvelopeId?: () => string;
}

export interface SubmitRunOutcome {
  readonly record: RunRecord;
  readonly decision: AdmissionDecision;
  readonly state: RunStateSnapshot;
}

export interface CompleteRunOutcome {
  readonly state: RunStateSnapshot;
  readonly result: RunResult;
}

export interface CheckpointRunOutcome {
  readonly state: RunStateSnapshot;
  readonly checkpoint: RunCheckpoint;
}

export class EnvironmentRunner {
  private readonly deps: EnvironmentRunnerDeps;

  constructor(deps: EnvironmentRunnerDeps) {
    this.deps = deps;
  }

  // -----------------------------------------------------------------------
  // Environment registration (admission input)
  // -----------------------------------------------------------------------

  /** Register a content-addressed environment definition (A009). */
  async registerEnvironment(definition: EnvironmentDefinition): Promise<void> {
    await this.deps.environments.register(definition);
  }

  // -----------------------------------------------------------------------
  // Submission + admission (gates 2, 5, 6)
  // -----------------------------------------------------------------------

  /**
   * Submit a run declaration. Idempotent: the same idempotency key with
   * the same record digest returns the EXISTING outcome and executes
   * nothing; a different digest for the same key throws
   * IDENTITY_CONFLICT. Over-quota / least-privilege violations are
   * logged (run-submitted + admission-decided + failed transition) and
   * then rejected with the typed ADMISSION_REJECTED error.
   */
  async submitRun(command: Envelope<SubmitRunCommandPayload>): Promise<SubmitRunOutcome> {
    this.requireCommand(command, 'environment-runtime/submit-run-command');
    const declaration = command.payload.declaration;
    const tenantId = toTenantId(declaration.tenantId);
    const runId = toRunId(`${tenantId}/${declaration.runKey}`);
    // Tenant isolation (gate 6): the run id is scoped by the declared tenant.
    assertSameTenant(runId, tenantId);

    const record = await createRunRecord({
      runId,
      tenantId,
      environment: declaration.environment,
      jobRef: declaration.jobRef,
      initialSnapshotDigest: declaration.initialSnapshotDigest,
      seed: declaration.seed,
      submittedAt: new Date(this.deps.clock.now()).toISOString(),
      resourceEnvelope: declaration.resourceEnvelope,
      networkEnvelope: declaration.networkEnvelope ?? { egress: 'default-deny' },
      filesystemEnvelope: declaration.filesystemEnvelope ?? { writeMode: 'read-only' },
      secretEnvelope: declaration.secretEnvelope ?? { isolation: 'isolation-boundary' },
    });
    const taskVersion = Object.freeze({
      taskId: declaration.taskVersion.taskId,
      version: declaration.taskVersion.version,
    }) as TaskVersionRef;

    // Idempotent submission (lock rule 17), reusing A015's identity machinery.
    const submissionKey = jobSubmissionKey(
      toJobSubmissionIdentity({
        idempotencyScope: SUBMISSION_IDEMPOTENCY_SCOPE,
        idempotencyKey: command.idempotencyKey as IdempotencyKey,
        correlationId: command.correlationId,
      }),
    );
    const existing = await this.deps.records.findByIdempotencyKey(submissionKey);
    if (existing !== undefined) {
      if (existing.record.digest === record.digest) {
        const state = await this.stateOf(existing.record.runId);
        const decision = await this.lastDecisionOf(existing.record.runId, state);
        return { record: existing.record, decision, state };
      }
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.IDENTITY_CONFLICT, {
        message: `idempotency key is already bound to a different run declaration (expected digest ${existing.record.digest}, got ${record.digest})`,
        details: { runId, existingDigest: existing.record.digest, attemptedDigest: record.digest },
      });
    }

    // The target environment must be registered (pinned by digest).
    const definition = await this.deps.environments.findByDigest(record.environment.digest);
    if (definition === undefined) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF,
        {
          message: `unknown environment digest ${record.environment.digest} — register the environment definition before submitting runs against it`,
          details: { digest: record.environment.digest },
        },
      );
    }

    await this.deps.records.insert({ record, taskVersion });
    await this.deps.records.bindSubmissionKey(submissionKey, { record, taskVersion });

    let state = initialRunState(record);
    state = await this.emit(state, command, (sequence, occurredAt) =>
      makeRunSubmittedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        recordDigest: record.digest,
        jobRef: record.jobRef,
        seed: record.seed,
      }),
    );

    // Admission (gate 5): the declared isolation envelope must fit the
    // environment's A009 bounds.
    const admissionView = toEnvironmentAdmissionView({
      resourceLimits: definition.resourceLimits,
      networkPolicy: definition.networkPolicy,
      filesystemPolicy: definition.filesystemPolicy,
      secretPolicy: definition.secretPolicy,
      timeLimits: definition.timeLimits,
    });
    const decision = evaluateAdmission(admissionView, {
      resource: record.resourceEnvelope,
      network: record.networkEnvelope,
      filesystem: record.filesystemEnvelope,
      secret: record.secretEnvelope,
    });
    state = await this.emit(state, command, (sequence, occurredAt) =>
      makeAdmissionDecidedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        admitted: decision.admitted,
        violations: decision.violations,
      }),
    );
    if (!decision.admitted) {
      await this.emit(state, command, (sequence, occurredAt) =>
        makeStateTransitionedEvent({
          runId: record.runId,
          tenantId: record.tenantId,
          sequence,
          occurredAt,
          from: 'requested',
          to: 'failed',
          lifecycleEvent: 'failed',
          reason: `admission rejected: ${decision.violations[0] ?? 'isolation envelope does not fit'}`,
        }),
      );
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED, {
        message: `run admission rejected: the declared isolation envelope does not fit the environment bounds (${decision.violations.length} violation(s)): ${decision.violations.join('; ')}`,
        details: { violations: [...decision.violations] },
      });
    }
    return { record, decision, state };
  }

  // -----------------------------------------------------------------------
  // Lifecycle execution (gates 3, 7, 10)
  // -----------------------------------------------------------------------

  /** Start an admitted run: requested → provisioning → ready → running. */
  async startRun(command: Envelope<StartRunCommandPayload>): Promise<RunStateSnapshot> {
    this.requireCommand(command, 'environment-runtime/start-run-command');
    const { record, state } = await this.resolveRun(command);
    if (state.admitted !== true) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ADMISSION_REJECTED, {
        message: `run ${JSON.stringify(record.runId)} was not admitted — a rejected run can never start`,
        details: { runId: record.runId, admitted: state.admitted },
      });
    }
    if (state.status !== 'requested') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
        message: `start-run requires a requested run, got '${state.status}'`,
        details: { from: state.status, to: 'provisioning' },
      });
    }
    let next = await this.transition(
      command,
      record,
      state,
      'provision-started',
      'reference provisioning',
    );
    // Deterministic simulated startup (seeded LCG; never Math.random),
    // always within the environment's startup budget for the reference
    // runner — provisioning failures are driven explicitly via fail-run.
    const definition = await this.environmentOf(record);
    const startupBudgetMs = definition.timeLimits.startupSeconds * 1000;
    const startupMs = stepLcg(record.seed ?? record.digest, 'startup', 1).intBetween(
      100,
      Math.max(200, startupBudgetMs),
    );
    next = await this.transition(
      command,
      record,
      next,
      'provisioned',
      `startup simulated in ${String(startupMs)}ms`,
    );
    return this.transition(command, record, next, 'started', 'workload execution begins');
  }

  /**
   * Execute ONE deterministic simulated workload step. Wall-clock
   * exhaustion (cumulative simulated elapsed vs the environment's
   * declared bound) transitions the run to timed-out (gate 3).
   */
  async advanceRun(command: Envelope<AdvanceRunCommandPayload>): Promise<RunStateSnapshot> {
    this.requireCommand(command, 'environment-runtime/advance-run-command');
    const { record, state } = await this.resolveRun(command);
    if (state.status !== 'running') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
        message: `advance-run requires a running run, got '${state.status}'`,
        details: { from: state.status, to: 'running' },
      });
    }
    const definition = await this.environmentOf(record);
    const wallClockMs = definition.resourceLimits.wallClockSeconds * 1000;
    const step = state.worldStep + 1;
    const stepMs = stepLcg(record.seed ?? record.digest, 'step', step).intBetween(50, 500);
    const elapsed = state.worldElapsedMs + stepMs;
    if (elapsed > wallClockMs) {
      return this.transition(
        command,
        record,
        state,
        'timed-out',
        `wall clock exhausted: simulated ${String(elapsed)}ms > bound ${String(wallClockMs)}ms`,
      );
    }
    return this.emit(state, command, (sequence, occurredAt) =>
      makeWorkloadProgressedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        step,
        simulatedElapsedMs: elapsed,
        note: `step ${String(step)} simulated ${String(stepMs)}ms`,
      }),
    );
  }

  /** Take a checkpoint of the running world (gate 8). */
  async checkpointRun(
    command: Envelope<CheckpointRunCommandPayload>,
  ): Promise<CheckpointRunOutcome> {
    this.requireCommand(command, 'environment-runtime/checkpoint-run-command');
    const { record, state } = await this.resolveRun(command);
    if (state.status !== 'running') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
        message: `checkpoint-run requires a running run, got '${state.status}'`,
        details: { from: state.status, to: 'checkpointing' },
      });
    }
    let next = await this.transition(
      command,
      record,
      state,
      'checkpoint-started',
      'checkpoint requested',
    );
    const checkpointSequence = state.checkpoints.length + 1;
    // The simulated world state is a pure function of (seed, world
    // step, checkpoint count) — its content address is deterministic.
    const snapshotDigest = await digestCanonical({
      runId: record.runId,
      seed: record.seed ?? record.digest,
      worldStep: state.worldStep,
      checkpoints: state.checkpoints.length,
    });
    const checkpoint = await createRunCheckpoint({
      runId: record.runId,
      tenantId: record.tenantId,
      sequence: checkpointSequence,
      snapshotDigest,
      stepIndex: state.worldStep,
      recordedAt: new Date(this.deps.clock.now()).toISOString(),
    });
    next = await this.emit(next, command, (sequence, occurredAt) =>
      makeCheckpointRecordedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        checkpointSequence,
        snapshotDigest,
        stepIndex: state.worldStep,
      }),
    );
    next = await this.transition(
      command,
      record,
      next,
      'checkpoint-completed',
      `checkpoint #${String(checkpointSequence)} recorded`,
    );
    return { state: next, checkpoint };
  }

  /** Restore the world to a recorded checkpoint of THIS run (gate 8). */
  async restoreRun(command: Envelope<RestoreRunCommandPayload>): Promise<RunStateSnapshot> {
    this.requireCommand(command, 'environment-runtime/restore-run-command');
    const { record, state } = await this.resolveRun(command);
    const ref = command.payload.checkpoint;
    // restoreToCheckpoint rejects foreign runs, unknown sequences and
    // digest mismatches (gate 8 negatives) and requires a running run.
    const restoredStepIndex = restoreToCheckpoint(state, {
      runId: ref.runId,
      sequence: ref.sequence,
      snapshotDigest: ref.snapshotDigest,
    });
    return this.emit(state, command, (sequence, occurredAt) =>
      makeCheckpointRestoredEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        checkpointSequence: ref.sequence,
        snapshotDigest: ref.snapshotDigest,
        restoredStepIndex,
      }),
    );
  }

  /** Complete the run and produce its evidence-addressed RunResult (gate 9). */
  async completeRun(command: Envelope<CompleteRunCommandPayload>): Promise<CompleteRunOutcome> {
    this.requireCommand(command, 'environment-runtime/complete-run-command');
    const { record, state, taskVersion } = await this.resolveRunWithTask(command);
    if (state.status !== 'running') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.ILLEGAL_TRANSITION, {
        message: `complete-run requires a running run, got '${state.status}'`,
        details: { from: state.status, to: 'completed' },
      });
    }
    let next = await this.transition(
      command,
      record,
      state,
      'completed',
      'workload finished',
    );

    // Trajectory: the run's whole event stream so far (deterministic).
    const log = await this.deps.sink.log();
    const trajectory = eventsForRun(log, record.runId).map((envelope) => envelope.payload);
    const trajectoryDigest = await digestCanonical(trajectory);
    const evidenceDigests = [
      trajectoryDigest,
      ...next.checkpoints.map((checkpoint) => checkpoint.snapshotDigest),
    ];
    const result = await createRunResult({
      runId: record.runId,
      tenantId: record.tenantId,
      recordDigest: record.digest,
      finalState: 'completed',
      finishedAt: new Date(this.deps.clock.now()).toISOString(),
      runAddress: toRunAddress({
        taskVersion,
        environmentVersion: {
          namespace: record.environment.namespace,
          name: record.environment.name,
          version: record.environment.version,
          digest: record.environment.digest,
        },
        runId: runIdKey(record.runId),
        initialSnapshotDigest: record.initialSnapshotDigest,
        trajectoryDigest,
        evidenceDigests,
      }),
    });
    next = await this.emit(next, command, (sequence, occurredAt) =>
      makeRunResultProducedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        resultDigest: result.digest,
        trajectoryDigest,
        evidenceDigests,
      }),
    );
    return { state: next, result };
  }

  /** Fail the run with a typed error class (any state that may fail). */
  async failRun(command: Envelope<FailRunCommandPayload>): Promise<RunStateSnapshot> {
    this.requireCommand(command, 'environment-runtime/fail-run-command');
    const { record, state } = await this.resolveRun(command);
    const { errorClass, message } = command.payload;
    if (typeof errorClass !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(errorClass)) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: `fail-run: errorClass must be a neutral identifier, got: ${JSON.stringify(errorClass)}`,
      });
    }
    if (typeof message !== 'string' || message.length === 0) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: 'fail-run: message must be a non-empty string',
      });
    }
    // The FSM decides legality (requested/provisioning/ready/running/
    // checkpointing may fail; terminal states may not).
    transitionRunState(state.status, 'failed');
    return this.transition(command, record, state, 'failed', `${errorClass}: ${message}`);
  }

  /** Clean up a terminal run (completed | failed | timed-out → cleaned). */
  async cleanupRun(command: Envelope<CleanupRunCommandPayload>): Promise<RunStateSnapshot> {
    this.requireCommand(command, 'environment-runtime/cleanup-run-command');
    const { record, state } = await this.resolveRun(command);
    transitionRunState(state.status, 'cleaned');
    return this.transition(command, record, state, 'cleaned', 'run cleaned up');
  }

  // -----------------------------------------------------------------------
  // Queries (no mutation, no events)
  // -----------------------------------------------------------------------

  /** Tenant-scoped run lookup: the submission + the current state. */
  async getRun(
    runId: string,
    tenantId: string,
  ): Promise<{ submission: RunSubmission; state: RunStateSnapshot }> {
    const submission = await this.deps.records.get(runId);
    if (submission === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
        message: `unknown run: ${JSON.stringify(runId)}`,
      });
    }
    assertSameTenant(submission.record.runId, tenantId);
    return { submission, state: await this.stateOf(submission.record.runId) };
  }

  /** The full append-only event log (observability, gate 7). */
  async eventLog(): Promise<EnvironmentEventLog> {
    return this.deps.sink.log();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Resolve the run a command addresses (tenant check included). */
  private async resolveRun(
    command: Envelope<{ runId: string; tenantId: string }>,
  ): Promise<{ record: RunRecord; state: RunStateSnapshot }> {
    const payload = command.payload;
    const runId = toRunId(payload.runId);
    const tenantId = toTenantId(payload.tenantId);
    assertSameTenant(runId, tenantId);
    const submission = await this.deps.records.get(runId);
    if (submission === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
        message: `unknown run: ${JSON.stringify(runId)}`,
      });
    }
    return { record: submission.record, state: await this.stateOf(runId) };
  }

  private async resolveRunWithTask(
    command: Envelope<{ runId: string; tenantId: string }>,
  ): Promise<{ record: RunRecord; state: RunStateSnapshot; taskVersion: TaskVersionRef }> {
    const payload = command.payload;
    const runId = toRunId(payload.runId);
    const tenantId = toTenantId(payload.tenantId);
    assertSameTenant(runId, tenantId);
    const submission = await this.deps.records.get(runId);
    if (submission === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
        message: `unknown run: ${JSON.stringify(runId)}`,
      });
    }
    return {
      record: submission.record,
      state: await this.stateOf(runId),
      taskVersion: submission.taskVersion,
    };
  }

  /** Fold the run's current state from the log (event-sourced truth). */
  private async stateOf(runId: string): Promise<RunStateSnapshot> {
    const submission = await this.deps.records.get(runId);
    if (submission === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_RUN_ID, {
        message: `unknown run: ${JSON.stringify(runId)}`,
      });
    }
    const log = await this.deps.sink.log();
    const events = eventsForRun(log, runId).map((envelope) => envelope.payload);
    return events.reduce<RunStateSnapshot>(
      (acc, event) => applyRuntimeEvent(acc, event),
      initialRunState(submission.record),
    );
  }

  /** The recorded admission decision of a run (idempotent re-submission). */
  private async lastDecisionOf(
    runId: string,
    state: RunStateSnapshot,
  ): Promise<AdmissionDecision> {
    const log = await this.deps.sink.log();
    const decisions = eventsForRun(log, runId)
      .map((envelope) => envelope.payload)
      .filter((event): event is Extract<RuntimeEvent, { kind: 'admission-decided' }> => event.kind === 'admission-decided');
    const last = decisions[decisions.length - 1];
    if (last === undefined) {
      return { admitted: state.admitted ?? false, violations: [] };
    }
    return { admitted: last.admitted, violations: last.violations };
  }

  /** Emit one lifecycle transition event and fold the new state. */
  private async transition(
    command: Envelope<unknown>,
    record: RunRecord,
    state: RunStateSnapshot,
    lifecycleEvent: RunLifecycleEvent,
    reason: string,
  ): Promise<RunStateSnapshot> {
    const from = state.status;
    const to = transitionRunState(from, lifecycleEvent);
    return this.emit(state, command, (sequence, occurredAt) =>
      makeStateTransitionedEvent({
        runId: record.runId,
        tenantId: record.tenantId,
        sequence,
        occurredAt,
        from,
        to,
        lifecycleEvent,
        reason,
      }),
    );
  }

  /** Build + append the enveloped event; fold the next state. */
  private async emit(
    state: RunStateSnapshot,
    command: Envelope<unknown>,
    build: (sequence: number, occurredAt: string) => RuntimeEvent,
  ): Promise<RunStateSnapshot> {
    const sequence = state.appliedEvents + 1;
    const event = build(
      sequence,
      toRunTimestamp(new Date(this.deps.clock.now()).toISOString()),
    );
    const envelope = makeRuntimeEventEnvelope(event, {
      correlationId: command.correlationId as CorrelationId,
      idempotencyKey:
        command.idempotencyKey === null || command.idempotencyKey === undefined
          ? toIdempotencyKey('environment-runner-event')
          : command.idempotencyKey,
      // issuedAt comes from the INJECTED clock, never the wall clock —
      // the engine is deterministic end-to-end (lock rule 17).
      issuedAt: new Date(this.deps.clock.now()).toISOString(),
      ...(this.deps.newEnvelopeId !== undefined ? { id: this.deps.newEnvelopeId() } : {}),
    });
    await this.deps.sink.append(envelope);
    return applyRuntimeEvent(state, event);
  }

  private async environmentOf(record: RunRecord): Promise<EnvironmentDefinition> {
    const definition = await this.deps.environments.findByDigest(record.environment.digest);
    if (definition === undefined) {
      throw new EnvironmentRuntimeError(
        ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_ENVIRONMENT_REF,
        {
          message: `environment ${record.environment.digest} disappeared from the registry`,
        },
      );
    }
    return definition;
  }

  /** Command envelope validation: kind, schema pin, idempotency key. */
  private requireCommand(command: Envelope<unknown>, schemaName: string): void {
    if (typeof command !== 'object' || command === null) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: 'runner commands must be envelope objects',
      });
    }
    if (command.kind !== 'command') {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: `runner commands must be command envelopes, got kind '${String(command.kind)}'`,
      });
    }
    if (command.idempotencyKey === null || command.idempotencyKey === undefined) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: 'runner commands require a non-null idempotency key (architecture-lock rule 17)',
      });
    }
    const expected = `arena:schema/${schemaName}@1.0.0`;
    if (command.schema !== expected) {
      throw new EnvironmentRuntimeError(ENVIRONMENT_RUNTIME_ERROR_CODES.INVALID_EVENT, {
        message: `runner command schema mismatch: expected ${expected}, got ${String(command.schema)}`,
        details: { expected, actual: command.schema },
      });
    }
  }
}
