/**
 * Environment-runner ports (Work Order A010 gate 10) — the ONLY things
 * services/environment-runner depends on besides @arena/protocol-core,
 * @arena/environment-protocol, @arena/job-protocol and
 * @arena/environment-runtime (service → domain + protocol layering,
 * enforced by pnpm boundary).
 *
 * The reference runner is a deterministic in-process state machine over
 * @arena/environment-runtime; ALL effects beyond pure decisions go
 * through these ports (mirroring services/job-orchestrator):
 *
 *   - Clock                — time is INJECTED (the engine never sleeps
 *                            and never reads a wall clock; lock rule 17);
 *   - EnvironmentRegistry  — the registered, content-addressed
 *                            environment definitions (A009) the runner
 *                            admits runs against;
 *   - RunRecordStore       — persistence for run submissions (record +
 *                            task-version context) with the idempotent
 *                            submission index (lock rule 17);
 *   - EventSink            — where EnvironmentEventLog appends go
 *                            (per-run ordering is enforced by the
 *                            protocol's log).
 *
 * Authority boundary (lock rule 16 — one responsibility, one
 * authority): the runner OWNS run lifecycle execution only — admission
 * (gate 5), the lifecycle state machine, time-limit enforcement,
 * deterministic workload simulation, checkpoints/restore, event
 * emission and RunResult production. It NEVER judges domain outcomes
 * beyond the simulated trajectory, and it never grants access: the
 * tenant on every command is CHECKED against the run's owning tenant
 * (R29) but authenticated elsewhere.
 */

import type { Envelope } from '@arena/protocol-core';
import type { EnvironmentDefinition, TaskVersionRef } from '@arena/environment-protocol';
import type { EnvironmentEventLog, RunRecord, RuntimeEvent } from '@arena/environment-runtime';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** Registered environment definitions keyed by content digest (A009). */
export interface EnvironmentRegistry {
  register(definition: EnvironmentDefinition): Promise<void>;
  findByDigest(digest: string): Promise<EnvironmentDefinition | undefined>;
}

/** A submitted run: the content-addressed record + its task-version context. */
export interface RunSubmission {
  readonly record: RunRecord;
  readonly taskVersion: TaskVersionRef;
}

/** Persistence port for run submissions (all lookups the runner needs). */
export interface RunRecordStore {
  /** Persist a NEW submission; throws on duplicate run id. */
  insert(submission: RunSubmission): Promise<void>;
  /** Look up a submission by tenant-scoped run id. */
  get(runId: string): Promise<RunSubmission | undefined>;
  /** Resolve an idempotent submission (lock rule 17 dedup path). */
  findByIdempotencyKey(submissionKey: string): Promise<RunSubmission | undefined>;
  /**
   * Bind a submission key to a submission; throws IDENTITY_CONFLICT
   * when the key is already bound to a DIFFERENT record digest (lock
   * rule 17: conflicting re-submissions are rejected).
   */
  bindSubmissionKey(submissionKey: string, submission: RunSubmission): Promise<void>;
  /** All submissions (state projections / scans). */
  list(): Promise<readonly RunSubmission[]>;
}

/** Append port for the EnvironmentEventLog (per-run ordering validated here). */
export interface EventSink {
  append(envelope: Envelope<RuntimeEvent>): Promise<void>;
  /** The full, append-only log snapshot. */
  log(): Promise<EnvironmentEventLog>;
}
