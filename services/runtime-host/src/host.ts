/**
 * The durable host runtime core (Work Order P002; issue #154;
 * ADR-P001-01/02/07) — the REAL implementation of @arena/runtime-host's
 * frozen `RuntimeHostApi`, with the composed SERVICE ENGINES INJECTED
 * through the frozen package's structural surfaces.
 *
 * Why engines are injected (boundary law B2): a service may never import
 * another service — services communicate only through versioned
 * contracts. The REAL engine classes (services/escalation-api's
 * EscalationApiService, services/job-orchestrator's JobOrchestrator)
 * satisfy the frozen structural surfaces (`EscalationLifecycleSurface`,
 * `JobRunnerSurface`) exactly, and are wired in at the COMPOSITION SITE —
 * deploy/runtime/src/composition.ts (the M1-designated wiring point) for
 * production, tests/runtime-host for the acceptance battery. That parity
 * (real classes over the durable ports, through this host core) is
 * pinned by the battery's composition suite.
 *
 * What THIS module owns (ADR-P001-07 — the host is the single
 * composition root for persistence, lifecycle, jobs and tenant policy):
 *   - persistence: the durable port set over ONE shared SqlTransport
 *     (./durable.ts — versioned migrations 0001-0005, the named runtime
 *     statement set), built here (or shared with the engines via
 *     `durable` — one DurableEventSink keeps the audit cache singular);
 *   - escalation surface: tenant-gated, lens-stamped reads/writes over
 *     the durable store (ADR-P001-02: the lens is derived from the
 *     tenant at write time and enforced at read time — cross-lens reads
 *     fail closed) plus the host-level recording of accepted outcomes
 *     (retries return the RECORDED outcome — deterministic replay);
 *   - jobs: the registered host job kinds (ADR-P001-01/06) executed
 *     through the injected shared runner with host-side claiming
 *     semantics (lease stamp → execute → complete/fail; expired-lease
 *     reclaim at start; terminally-failed jobs parked in the
 *     dead-letter lot);
 *   - lifecycle (the frozen state machine): construct → start → serve →
 *     stop. `start` applies migrations from zero (no-op when current),
 *     hydrates the audit-chain tail, runs the restart-recovery sweep and
 *     flips to `started`; `stop` is idempotent; durable state stays
 *     consistent (a hard kill between any two statements loses nothing —
 *     the stores are append-only and every replay is deterministic).
 *
 * The clock is INJECTED (A015 law). The host never sleeps.
 */

import { toCorrelationId } from '@arena/protocol-core';
import type { CorrelationId, IdempotencyKey } from '@arena/protocol-core';
import { makeEscalationResponse } from '@arena/escalation';
import { isTerminalJobRecord, toJobSubmissionIdentity } from '@arena/job-protocol';
import type { JobRecord } from '@arena/job-protocol';
import { SystemClock } from '@arena/persistence';
import type { Clock } from '@arena/persistence';
import {
  bindSqlMigrations,
  createNeonHttpSqlTransport,
  NeonControlPlaneRepository,
  NeonMigrationRunner,
  readNeonConfigFromEnv,
} from '@arena/hosted-neon-postgres';
import type { SqlTransport } from '@arena/hosted-neon-postgres';
import {
  capacityStatusToComponentState,
  createRuntimeJobKindRegistrations,
  findRegistrationForRecord,
  aggregateReadiness,
  isRuntimeJobKindName,
  lensForTenant,
  registrationKey,
  transitionRuntimeHost,
} from '@arena/runtime-host';
import type {
  EscalationCreateOutcome,
  EscalationLifecycleSurface,
  HostEscalationsSurface,
  HostJobsSurface,
  JobKindRegistration,
  JobRunnerSurface,
  LensStampedStatus,
  RecordedIdempotencyOutcome,
  RuntimeHostApi,
  RuntimeHostHealth,
  RuntimeHostRecoveryReport,
  RuntimeHostStartResult,
  RuntimeHostState,
  SubmitJobInputJson,
} from '@arena/runtime-host';
import type { ProjectionStateStorePort, TruthLens } from '@arena/runtime-host';
import {
  createDurableRuntimeComponents,
} from './durable.js';
import type { DurableRuntimeComponents } from './durable.js';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * The composed service engines, injected through the frozen package's
 * STRUCTURAL surfaces (boundary law B2: this service never imports
 * another service). The REAL classes satisfy them exactly:
 *
 *   - escalations: services/escalation-api's EscalationApiService
 *     (over the durable escalation store + webhook outbox + routing);
 *   - runner: services/job-orchestrator's JobOrchestrator (over the
 *     durable job store + event sink) — the ONE shared durable job
 *     runner (ADR-P001-01).
 *
 * deploy/runtime/src/composition.ts is the production composition site;
 * tests/runtime-host pins the parity against the real classes.
 */
export interface RuntimeHostEngines {
  readonly escalations: EscalationLifecycleSurface;
  readonly runner: JobRunnerSurface;
}

/** Options for `createRuntimeHost` (all infrastructure is injected). */
export interface RuntimeHostServiceOptions {
  /**
   * The composed service engines (REQUIRED). The host is the composition
   * root for persistence and policy; service instances are injected at
   * the composition site.
   */
  readonly engines: RuntimeHostEngines;
  /** Env source (DATABASE_URL / NEON_CONNECTION_STRING); defaults to process.env. */
  readonly env?: Record<string, string | undefined>;
  /**
   * Injected SqlTransport — the ONLY infrastructure touchpoint. Overrides
   * env discovery (the acceptance battery injects an embedded real
   * Postgres transport; production composes the Neon HTTP driver).
   */
  readonly transport?: SqlTransport;
  /** Injected clock (A015 law; SystemClock default). */
  readonly clock?: Clock;
  /**
   * Pre-built durable components, SHARED with the engines (the
   * composition site builds them once and hands the same DurableEventSink
   * to both the orchestrator and the host, keeping the audit-chain cache
   * singular). Built fresh from the transport/env when omitted.
   */
  readonly durable?: DurableRuntimeComponents;
  /** Claim-lease duration for host-side job claiming (default 60s). */
  readonly leaseDurationMs?: number;
  /** The host instance identity recorded on leases (default 'arena-runtime-host'). */
  readonly hostInstanceId?: string;
}

const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_HOST_INSTANCE_ID = 'arena-runtime-host';

// ---------------------------------------------------------------------------
// The composition root implementation
// ---------------------------------------------------------------------------

/**
 * The composed host's full API — the FROZEN `RuntimeHostApi` (the
 * contract P003 binds transport onto; packages/runtime-host, untouched)
 * plus the host-internal surfaces the composition root itself serves:
 * job claiming with leases, dead-letter operations, recorded-outcome
 * lookup, the audit-chain view, lens inspection and the mounted
 * projection checkpoint store. Every addition is ADDITIVE — a
 * `RuntimeHostService` IS-A `RuntimeHostApi` (structural superset), so
 * the frozen interface stays exactly what M1 froze and P003 binds.
 */
export interface RuntimeHostService extends RuntimeHostApi {
  /** Claim a queued job AND stamp the execution lease (host claiming). */
  claimWithLease(input: {
    readonly jobId: string;
    readonly actor: SubmitJobInputJson['actor'];
  }): Promise<JobRecord>;
  /** Execute one claimed job through its REGISTERED executor. */
  executeClaimed(input: {
    readonly jobId: string;
    readonly actor: SubmitJobInputJson['actor'];
  }): Promise<JobRecord>;
  /** The dead-letter lot (operator surface, ADR-P001-01). */
  deadLetters(): Promise<readonly { jobId: string; reason: string }[]>;
  /** The recorded idempotency outcome for a submission (deterministic replay). */
  recordedOutcome(identity: {
    readonly idempotencyScope: string;
    readonly idempotencyKey: IdempotencyKey;
    readonly correlationId: CorrelationId;
  }): Promise<RecordedIdempotencyOutcome | undefined>;
  /** The durable audit chain (verification / evidence surface). */
  auditRecords(): Promise<readonly unknown[]>;
  /** The lens a record was persisted under (evidence surface). */
  lensOf(requestId: string): Promise<TruthLens | null>;
  /** The mounted projection checkpoint store (ADR-P001-06 seam). */
  readonly projectionStore: ProjectionStateStorePort;
}

/** A typed host-boundary error (machine-readable, never a bare boolean). */
export class RuntimeHostError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RuntimeHostError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

/**
 * Construct the durable host runtime core. Async because the job-kind
 * registry is content-addressed (definition digests).
 *
 * The host starts in the `constructed` state; `start()` applies
 * migrations, hydrates the audit tail and runs the recovery sweep.
 * Without a usable transport the host still constructs, but `start()`
 * fails closed (state `failed` — never a partially-started host).
 */
export async function createRuntimeHost(
  options: RuntimeHostServiceOptions,
): Promise<RuntimeHostService> {
  const clock = options.clock ?? new SystemClock();
  // Resolve the ONE shared transport: injected, or discovered from env.
  // Null means DISABLED (no usable DATABASE_URL / NEON_CONNECTION_STRING).
  const envConfig = readNeonConfigFromEnv(options.env ?? process.env);
  const transport: SqlTransport | null =
    options.transport !== undefined
      ? options.transport
      : envConfig !== null
        ? createNeonHttpSqlTransport(envConfig.connectionString)
        : null;
  // The durable components: shared with the engines when provided (the
  // composition site's singular-audit-cache discipline), else built here.
  const durable: DurableRuntimeComponents =
    options.durable ??
    createDurableRuntimeComponents({
      ...(transport !== null ? { transport } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      clock,
    });
  // The capacity probe rides the SAME transport (health reflects the
  // persistence the host actually serves through).
  const migrationRunner =
    transport !== null
      ? new NeonMigrationRunner({ transport, clock })
      : options.env !== undefined
        ? new NeonMigrationRunner({ env: options.env, clock })
        : new NeonMigrationRunner({ clock });
  const probeRepo =
    transport !== null
      ? new NeonControlPlaneRepository({ transport, clock })
      : options.env !== undefined
        ? new NeonControlPlaneRepository({ env: options.env, clock })
        : new NeonControlPlaneRepository({ clock });

  const jobKinds = await createRuntimeJobKindRegistrations();

  return new RuntimeHostServiceImpl({
    clock,
    transport,
    migrationRunner,
    probeRepo,
    durable,
    engines: options.engines,
    jobKinds,
    leaseDurationMs: options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS,
    hostInstanceId: options.hostInstanceId ?? DEFAULT_HOST_INSTANCE_ID,
  });
}

interface RuntimeHostImplDeps {
  readonly clock: Clock;
  readonly transport: SqlTransport | null;
  readonly migrationRunner: NeonMigrationRunner;
  readonly probeRepo: NeonControlPlaneRepository;
  readonly durable: DurableRuntimeComponents;
  readonly engines: RuntimeHostEngines;
  readonly jobKinds: readonly JobKindRegistration[];
  readonly leaseDurationMs: number;
  readonly hostInstanceId: string;
}

class RuntimeHostServiceImpl implements RuntimeHostService {
  private readonly deps: RuntimeHostImplDeps;
  private currentState: RuntimeHostState = 'constructed';
  private startResult: RuntimeHostStartResult | null = null;

  readonly escalations: HostEscalationsSurface;
  readonly jobs: HostJobsSurface;
  readonly runner: JobRunnerSurface;
  readonly jobKinds: readonly JobKindRegistration[];

  constructor(deps: RuntimeHostImplDeps) {
    this.deps = deps;
    this.jobKinds = deps.jobKinds;
    const engines = deps.engines;
    this.escalations = {
      create: (tenantId, input) => this.createEscalation(tenantId, input),
      status: (tenantId, requestId) => this.escalationStatus(tenantId, requestId),
      listByCorrelationId: (tenantId, correlationId) =>
        engines.escalations.listByCorrelationId(tenantId, correlationId),
      advance: (tenantId, requestId, to, context) =>
        engines.escalations.advanceLifecycle(requestId, tenantId, to, context),
    };
    this.jobs = {
      submitByKind: (input) => this.submitByKind(input),
      get: (jobId) => engines.runner.get(jobId),
      findByCorrelationId: (correlationId) =>
        engines.runner.findByCorrelationId(correlationId),
      registeredKinds: Object.freeze(
        deps.jobKinds.map((registration) => ({ definition: registration.definition })),
      ),
    };
    this.runner = {
      get: (jobId) => engines.runner.get(jobId),
      findByCorrelationId: (correlationId) =>
        engines.runner.findByCorrelationId(correlationId),
      retryDue: () => engines.runner.retryDue(),
      submit: (input: SubmitJobInputJson) => engines.runner.submit(input),
      claim: (input) => engines.runner.claim(input),
      progress: (input) => engines.runner.progress(input),
      complete: (input) => engines.runner.complete(input),
      fail: (input) => engines.runner.fail(input),
      cancel: (input) => engines.runner.cancel(input),
      timeoutDue: () => engines.runner.timeoutDue(),
    };
  }

  get state(): RuntimeHostState {
    return this.currentState;
  }

  // -- lifecycle ------------------------------------------------------------

  async start(): Promise<RuntimeHostStartResult> {
    if (this.currentState === 'started') {
      // Idempotent start: the previous result data (its migration and
      // recovery counts belong to THAT start).
      const previous = this.startResult;
      if (previous !== null) return previous;
    }
    // The frozen lifecycle machine: only a `constructed` host starts;
    // `failed` is terminal (a start failure is a failed host — construct
    // a new composition; the durable state resumes from the stores).
    if (this.currentState !== 'constructed') {
      throw new RuntimeHostError(
        'RUNTIME_INVALID_TRANSITION',
        `start() is unavailable in state "${this.currentState}" (failed/stopped hosts are terminal; construct a new composition)`,
        { state: this.currentState },
      );
    }
    this.currentState = transitionRuntimeHost(this.currentState, 'starting');
    try {
      // 1) Persistence must be configured (fail closed BEFORE anything else).
      const transport = this.requireTransport();

      // 2) Apply the versioned migrations from zero (no-op when current).
      const run = await this.deps.migrationRunner.run(bindSqlMigrations(transport));
      const migrationsApplied = run.applied.map((entry) => ({
        version: entry.version,
        name: entry.name,
      }));

      // 3) Hydrate the audit-chain tail (before ANY mutation flows).
      await this.deps.durable.eventSink.hydrate();

      // 4) Restart-recovery sweep (P002 acceptance criterion c).
      const recovery = await this.recoverySweep();

      this.startResult = { state: 'started', migrationsApplied, recovery };
      this.currentState = transitionRuntimeHost('starting', 'started');
      return this.startResult;
    } catch (cause) {
      const reason =
        cause instanceof Error ? cause.message : `unknown start failure: ${String(cause)}`;
      this.currentState = transitionRuntimeHost('starting', 'failed', reason);
      throw cause;
    }
  }

  async stop(): Promise<void> {
    // Idempotent: stopping/stopped are stable.
    if (this.currentState === 'stopping' || this.currentState === 'stopped') return;
    if (this.currentState === 'started') {
      this.currentState = transitionRuntimeHost('started', 'stopping');
      // Durable state is already consistent (append-only stores; nothing
      // to flush) — stopping is a pure lifecycle flip.
      this.currentState = transitionRuntimeHost('stopping', 'stopped');
      return;
    }
    // constructed / starting / failed hosts stop trivially (they never
    // served; `stopped` is terminal-stable, so the machine has no edge —
    // recording it directly is the honest degenerate case).
    this.currentState = 'stopped';
  }

  async health(): Promise<RuntimeHostHealth> {
    const checkedAt = this.deps.clock.now();
    // The FT2.0 posture: the probe NEVER throws — a failing transport
    // reports DEGRADED; a missing configuration reports DISABLED.
    const capacity = await this.deps.probeRepo.capacityProbe();
    const persistenceState = capacityStatusToComponentState(capacity.status);
    const serving = this.currentState === 'started';
    const components = [
      {
        component: 'persistence' as const,
        state: persistenceState,
        reasons: capacity.reasons,
        checkedAt,
      },
      {
        component: 'job-runner' as const,
        state: serving ? ('ready' as const) : ('disabled' as const),
        reasons: serving ? [] : [{ code: `host-state-${this.currentState}` }],
        checkedAt,
      },
      {
        component: 'escalation-lifecycle' as const,
        state: serving ? ('ready' as const) : ('disabled' as const),
        reasons: serving ? [] : [{ code: `host-state-${this.currentState}` }],
        checkedAt,
      },
    ];
    return Object.freeze({
      state: this.currentState,
      capacity,
      components: Object.freeze(components),
      ready: aggregateReadiness(this.currentState, components, capacity.status),
      checkedAt,
    });
  }

  // -- host-internal surfaces (started-gated, tenant-gated) ----------------

  private assertStartedSurface(): void {
    if (this.currentState !== 'started') {
      throw new RuntimeHostError(
        'RUNTIME_NOT_STARTED',
        `the host runtime surface is unavailable in state "${this.currentState}" (fail closed)`,
        { state: this.currentState },
      );
    }
  }

  private requireTransport(): SqlTransport {
    const transport = this.deps.transport;
    if (transport === null || transport === undefined) {
      throw new RuntimeHostError(
        'RUNTIME_PERSISTENCE_DISABLED',
        'the host runtime cannot start: no persistence transport is configured (DATABASE_URL / NEON_CONNECTION_STRING absent or unusable; fail closed — never a partially-started host)',
        { envVarNames: ['DATABASE_URL', 'NEON_CONNECTION_STRING'] },
      );
    }
    return transport;
  }

  private async createEscalation(
    tenantId: string,
    input: Parameters<EscalationLifecycleSurface['createEscalation']>[0],
  ): Promise<EscalationCreateOutcome> {
    this.assertStartedSurface();
    if (input.tenantId !== tenantId) {
      throw new RuntimeHostError(
        'RUNTIME_CROSS_TENANT_ACCESS',
        `escalation submission carries tenant ${JSON.stringify(input.tenantId)} and may not be created through tenant ${JSON.stringify(tenantId)} (fail closed)`,
        { submittedTenant: input.tenantId, callerTenant: tenantId },
      );
    }
    const outcome = await this.deps.engines.escalations.createEscalation(input);
    // Record the accepted outcome (P002 acceptance criterion d): retries
    // return the RECORDED outcome — first write wins; a hard kill between
    // the store insert and this record is healed by the next replay (the
    // recorded view then derives from the replayed record — deterministic
    // from that point on).
    const identity = toJobSubmissionIdentity({
      idempotencyScope: `escalation-${tenantId}`,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    const existing = await this.deps.durable.idempotencyStore.find(identity);
    if (existing === undefined) {
      const recorded: RecordedIdempotencyOutcome = Object.freeze({
        idempotencyScope: identity.idempotencyScope,
        idempotencyKey: identity.idempotencyKey,
        correlationId: identity.correlationId,
        outcome: Object.freeze({
          kind: outcome.outcome,
          requestId: outcome.requestId,
          state: outcome.record.state,
          serializedResponse: outcome.serializedResponse,
        }),
        recordedAt: this.deps.clock.now(),
      });
      await this.deps.durable.idempotencyStore.record(recorded);
    }
    return outcome;
  }

  private async escalationStatus(
    tenantId: string,
    requestId: string,
  ): Promise<LensStampedStatus> {
    this.assertStartedSurface();
    const lens = lensForTenant(tenantId);
    // Read through the lens guard: a cross-lens read fails closed
    // (ADR-P001-02 rule 2); a cross-tenant read is simply not found.
    const record = await this.deps.durable.escalationStore.getByLens(requestId, tenantId, lens);
    if (record === undefined) {
      throw new RuntimeHostError(
        'RUNTIME_ESCALATION_NOT_FOUND',
        `escalation ${requestId} not found for tenant ${tenantId} (tenant-scoped, lens ${lens})`,
        { requestId, tenantId, lens },
      );
    }
    const response = makeEscalationResponse(
      { responseVersion: 1, kind: 'escalation-status', record },
      toCorrelationId(record.request.correlationId),
    );
    return Object.freeze({
      record,
      response,
      serializedResponse: JSON.stringify({ state: record.state }),
      lens,
    });
  }

  // -- host-internal job execution (claim/lease/dead-letter) ---------------

  private async submitByKind(input: {
    readonly kindName: string;
    readonly input: unknown;
    readonly correlationId: CorrelationId;
    readonly idempotencyKey: IdempotencyKey;
    readonly actor: SubmitJobInputJson['actor'];
  }): Promise<JobRecord> {
    this.assertStartedSurface();
    if (!isRuntimeJobKindName(input.kindName)) {
      throw new RuntimeHostError(
        'RUNTIME_UNKNOWN_JOB_KIND',
        `job kind ${JSON.stringify(input.kindName)} is not registered on this host (the registry is closed; ADR-P001-01)`,
        { kindName: input.kindName, registered: this.deps.jobKinds.map(registrationKey) },
      );
    }
    const registration = this.deps.jobKinds.find(
      (candidate) => candidate.definition.kind.name === input.kindName,
    );
    if (registration === undefined) {
      throw new RuntimeHostError(
        'RUNTIME_UNKNOWN_JOB_KIND',
        `job kind ${JSON.stringify(input.kindName)} failed registry resolution`,
        { kindName: input.kindName },
      );
    }
    return this.runner.submit({
      definition: registration.definition,
      input: input.input,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor,
    });
  }

  /**
   * Claim a queued job AND stamp the execution lease (host claiming
   * semantics, ADR-P001-01): queued → running + lease(owner, expiry).
   * A hard kill after this point leaves an orphaned lease that the next
   * start's recovery sweep reclaims.
   */
  async claimWithLease(input: {
    readonly jobId: string;
    readonly actor: SubmitJobInputJson['actor'];
  }): Promise<JobRecord> {
    this.assertStartedSurface();
    const claimed = await this.runner.claim(input);
    await this.deps.durable.jobStore.stampLease(
      claimed.jobId,
      this.deps.hostInstanceId,
      this.deps.clock.now() + this.deps.leaseDurationMs,
    );
    return claimed;
  }

  /**
   * Execute one claimed job through its REGISTERED executor and record
   * the outcome VERBATIM (the runner never judges domain outcomes):
   * complete on success; fail (retry policy decides requeue vs terminal)
   * on a throwing executor; a terminally-failed job is parked in the
   * dead-letter lot.
   */
  async executeClaimed(input: {
    readonly jobId: string;
    readonly actor: SubmitJobInputJson['actor'];
  }): Promise<JobRecord> {
    this.assertStartedSurface();
    const current = await this.runner.get(input.jobId);
    if (current === undefined) {
      throw new RuntimeHostError('RUNTIME_JOB_NOT_FOUND', `job ${input.jobId} does not exist`, {
        jobId: input.jobId,
      });
    }
    const registration = findRegistrationForRecord(this.deps.jobKinds, current);
    if (registration === undefined) {
      throw new RuntimeHostError(
        'RUNTIME_UNKNOWN_JOB_KIND',
        `job ${input.jobId} carries kind ${current.kind.namespace}/${current.kind.name}@${current.kind.version} which is not registered on this host`,
        { jobId: input.jobId, kind: current.kind },
      );
    }
    try {
      const result = await registration.executor(current.input, {
        jobId: current.jobId,
        attempt: current.attempts,
        clockNow: this.deps.clock.now(),
      });
      return await this.runner.complete({ jobId: current.jobId, actor: input.actor, result });
    } catch (cause) {
      const errorClass =
        cause instanceof Error ? `executor-${toErrorClass(cause.name)}` : 'executor-threw';
      const message =
        cause instanceof Error && cause.message.length > 0
          ? cause.message
          : 'the registered executor threw without a message';
      const failed = await this.runner.fail({
        jobId: current.jobId,
        actor: input.actor,
        errorClass,
        message,
      });
      if (isTerminalJobRecord(failed)) {
        // Poison job: park in the dead-letter lot (operator surface).
        await this.deps.durable.jobStore.markDeadLetter(
          failed.jobId,
          `terminal-failure:${errorClass}`,
        );
      }
      return failed;
    }
  }

  /** The dead-letter lot (operator surface, ADR-P001-01). */
  async deadLetters(): Promise<readonly { jobId: string; reason: string }[]> {
    this.assertStartedSurface();
    return this.deps.durable.jobStore.listDeadLetters();
  }

  /** The recorded idempotency outcome for a submission (deterministic replay). */
  async recordedOutcome(identity: {
    readonly idempotencyScope: string;
    readonly idempotencyKey: IdempotencyKey;
    readonly correlationId: CorrelationId;
  }): Promise<RecordedIdempotencyOutcome | undefined> {
    this.assertStartedSurface();
    return this.deps.durable.idempotencyStore.find(
      toJobSubmissionIdentity({
        idempotencyScope: identity.idempotencyScope,
        idempotencyKey: identity.idempotencyKey,
        correlationId: identity.correlationId,
      }),
    );
  }

  /** The durable audit chain (verification / evidence surface). */
  async auditRecords(): Promise<readonly unknown[]> {
    this.assertStartedSurface();
    return this.deps.durable.eventSink.auditRecords();
  }

  /** The lens a record was persisted under (evidence surface). */
  async lensOf(requestId: string): Promise<TruthLens | null> {
    this.assertStartedSurface();
    return this.deps.durable.escalationStore.lensOf(requestId);
  }

  /** The mounted projection checkpoint store (ADR-P001-06 seam). */
  get projectionStore(): ProjectionStateStorePort {
    return this.deps.durable.projectionStore;
  }

  // -- restart recovery -----------------------------------------------------

  private async recoverySweep(): Promise<RuntimeHostRecoveryReport> {
    const now = this.deps.clock.now();
    const jobs = await this.deps.durable.jobStore.list();
    const nonTerminalJobs = jobs.filter((job) => !isTerminalJobRecord(job)).length;
    const terminalJobsUntouched = jobs.length - nonTerminalJobs;
    // Reclaim leases orphaned by a killed process (running + expired).
    const reclaimed = await this.deps.durable.jobStore.clearExpiredLeases(now);
    // Advance overdue running jobs through the protocol's timeout policy
    // (requeue with backoff or terminal failure — never a duplicated
    // transition; the append-only guards make every replay deterministic).
    await this.runner.timeoutDue();
    return Object.freeze({
      nonTerminalJobs,
      reclaimedLeases: reclaimed.length,
      terminalJobsUntouched,
    });
  }
}

function toErrorClass(name: string): string {
  const normalized = name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase();
  return normalized.length > 0 ? normalized : 'error';
}
