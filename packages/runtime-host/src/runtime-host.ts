/**
 * The RuntimeHostApi — the FROZEN composition-root interface (Work
 * Order P002; issue #154; ADR-P001-07).
 *
 * This is the contract P003's wave-2 dispatch binds real HTTP/MCP/
 * webhook transport onto, and the contract the acceptance battery
 * (tests/runtime-host) exercises. The IMPLEMENTATION lives in
 * services/runtime-host (the composition-root service); this interface
 * package carries only pure data and types (A015 law: no I/O here).
 *
 *   construct → start → (serve) → stop
 *
 *   - `start` applies the versioned durable migrations from zero (or
 *     no-ops when already applied), runs the restart-recovery sweep
 *     (leases reclaimed, due jobs re-driven, terminal jobs untouched)
 *     and reports health;
 *   - the served surface is tenant-gated and lens-stamped
 *     (ADR-P001-02) — cross-tenant and cross-lens access fail closed;
 *   - `stop` is idempotent and leaves durable state consistent (a hard
 *     kill between any two statements loses nothing: the stores are
 *     append-only and every replay is deterministic).
 */

import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import type { JobDefinition, JobRecord } from '@arena/job-protocol';
import type { RuntimeHostState } from './lifecycle.js';
import type { RuntimeHostHealth } from './health.js';
import type {
  HostEscalationsSurface,
  JobRunnerSurface,
} from './surfaces.js';
import type { JobKindRegistration } from './jobs.js';

/** The durable job submission surface the host serves. */
export interface HostJobsSurface {
  /**
   * Submit a job by REGISTERED kind name (ADR-P001-01: every job
   * executes through the one shared runner). The definition is resolved
   * from the host's registry — callers cannot smuggle ad-hoc
   * definitions across the host boundary.
   */
  submitByKind(input: {
    readonly kindName: string;
    readonly input: unknown;
    readonly correlationId: CorrelationId;
    readonly idempotencyKey: IdempotencyKey;
    readonly actor: { readonly type: string; readonly tenant: string; readonly principalId: string };
  }): Promise<JobRecord>;
  /** Addressability path 1: look a job up by job id. */
  get(jobId: string): Promise<JobRecord | undefined>;
  /** Addressability path 2: look jobs up by correlation id. */
  findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]>;
  /** The registered job-kind definitions (frozen registry view). */
  readonly registeredKinds: readonly { readonly definition: JobDefinition }[];
}

/** The result of a successful host start (pure data). */
export interface RuntimeHostStartResult {
  readonly state: RuntimeHostState;
  /** Migrations applied by this start (empty when the store was current). */
  readonly migrationsApplied: readonly { readonly version: number; readonly name: string }[];
  /** The restart-recovery sweep verdict (restarts resume, never duplicate). */
  readonly recovery: RuntimeHostRecoveryReport;
}

/** The restart-recovery sweep report (P002 acceptance criterion c). */
export interface RuntimeHostRecoveryReport {
  /** Jobs found in non-terminal states at start (claimed/queued). */
  readonly nonTerminalJobs: number;
  /**
   * Running jobs whose lease was orphaned by the killed process and got
   * reclaimed by the sweep (re-queued; the protocol's retry policy
   * decides the next attempt — never a duplicated transition).
   */
  readonly reclaimedLeases: number;
  /** Terminal jobs left untouched (proof the runner never re-executes them). */
  readonly terminalJobsUntouched: number;
}

/** The runtime host handle — what the composition root returns. */
export interface RuntimeHostApi {
  /** The current lifecycle state (pure snapshot). */
  readonly state: RuntimeHostState;

  /**
   * Start the host: apply migrations, run the recovery sweep, flip to
   * `started`. Idempotent for a started host (returns the previous
   * result data); fails closed (state `failed`) when persistence is
   * unavailable — never a partially-started host.
   */
  start(): Promise<RuntimeHostStartResult>;

  /** Stop the host (idempotent; durable state stays consistent). */
  stop(): Promise<void>;

  /** Health & readiness snapshot (fail-closed aggregate; ADR-P001-07 §7). */
  health(): Promise<RuntimeHostHealth>;

  /** The tenant-gated escalation lifecycle surface (P003 binds here). */
  readonly escalations: HostEscalationsSurface;

  /** The shared durable job runner surface (ADR-P001-01). */
  readonly jobs: HostJobsSurface;

  /** The underlying runner surface (host-internal wiring/tests). */
  readonly runner: JobRunnerSurface;

  /** The registered job kinds (definition + executor registry view). */
  readonly jobKinds: readonly JobKindRegistration[];
}
