/**
 * JobOrchestrator (Work Order A015 gate 8) — a deterministic, in-process
 * state machine over @arena/job-protocol, with pluggable persistence via
 * injected ports (Clock / JobStore / EventSink). In-memory implementations
 * ship in in-memory.ts for tests. ZERO external infrastructure.
 *
 * Decision logic is PURE: given the same (clock reading, store state, sink
 * state, envelope-id source), every method returns the same result —
 * proven by the seeded-LCG property suite (property.test.ts). The engine
 * never sleeps: retry backoff and timeouts are computed as pure data and
 * compared against the injected clock (architecture-lock rule 17).
 *
 * AUTHORITY BOUNDARY (architecture-lock rule 16 — one responsibility, one
 * authority): the orchestrator OWNS orchestration only:
 *   - lifecycle state transitions (submit/claim/progress/complete/fail/
 *     cancel/timeout) via the protocol's pure functions;
 *   - idempotent submission dedup (same identity + same definition digest
 *     ⇒ the SAME record; different digest ⇒ JOB_IDENTITY_CONFLICT);
 *   - retry/timeout scheduling from the definition's declared policies;
 *   - domain-event emission and the consequential-mutation audit chain.
 * It NEVER judges domain outcomes: `complete()` records whatever result an
 * executor reports verbatim; input-schema validation belongs to the domain
 * that owns the schema (the definition only REFERENCES it); actor identity
 * is recorded in audit events, never verified (granting access is another
 * authority's responsibility). Services communicate only through versioned
 * contracts (spec/service-boundaries.md).
 */

import type { CorrelationId, Envelope, IdempotencyKey } from '@arena/protocol-core';
import type { JobDefinition, JobEvent, JobRecord, PrincipalRef } from '@arena/job-protocol';
import {
  claimJob,
  cancelJob,
  completeJob,
  createJobRecord,
  failJob,
  isJobRecord,
  JobError,
  JOB_ERROR_CODES,
  makeJobEventEnvelope,
  makeMutationAuditedEvent,
  progressJob,
  resolveIdempotentSubmission,
  timeoutJob,
  toJobSubmissionIdentity,
} from '@arena/job-protocol';
import type { Clock, EventSink, JobStore } from './ports.js';

export interface JobOrchestratorDeps {
  readonly clock: Clock;
  readonly store: JobStore;
  readonly sink: EventSink;
  /**
   * Optional deterministic envelope-id source. The default is
   * crypto.randomUUID(); tests inject an LCG-driven factory to make whole
   * runs byte-deterministic (the three ports above stay the only required
   * injections).
   */
  readonly newEnvelopeId?: () => string;
}

export interface SubmitJobInput {
  readonly definition: JobDefinition;
  readonly input: unknown;
  readonly correlationId: CorrelationId;
  readonly idempotencyKey: IdempotencyKey;
  readonly jobId?: string;
  readonly actor: PrincipalRef | { type: string; tenant: string; principalId: string };
}

export interface JobMutationInput {
  readonly jobId: string;
  readonly actor: PrincipalRef | { type: string; tenant: string; principalId: string };
}

export interface CompleteJobInput extends JobMutationInput {
  readonly result: unknown;
}

export interface FailJobInput extends JobMutationInput {
  readonly errorClass: string;
  readonly message: string;
}

export interface CancelJobInput extends JobMutationInput {
  readonly reason: string;
}

export interface ProgressJobInput extends JobMutationInput {
  readonly percent?: number;
  readonly note?: string;
}

export class JobOrchestrator {
  private readonly deps: JobOrchestratorDeps;

  constructor(deps: JobOrchestratorDeps) {
    this.deps = deps;
  }

  // -----------------------------------------------------------------------
  // Queries (no mutation, no audit events)
  // -----------------------------------------------------------------------

  /** Addressability path 1: look a job up by job id. */
  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.deps.store.get(jobId);
  }

  /** Addressability path 2: look jobs up by correlation id. */
  async findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]> {
    return this.deps.store.findByCorrelationId(correlationId);
  }

  /**
   * Jobs whose retry backoff has elapsed (queued + nextRetryAt <= now).
   * A PURE QUERY: the jobs are already queued — claim() respects the
   * backoff gate — so no mutation happens and no audit event is emitted.
   */
  async retryDue(): Promise<readonly JobRecord[]> {
    const now = this.deps.clock.now();
    const records = await this.deps.store.list();
    return Object.freeze(
      records.filter(
        (record) =>
          record.status === 'queued' &&
          record.nextRetryAt !== undefined &&
          Date.parse(record.nextRetryAt) <= now,
      ),
    );
  }

  // -----------------------------------------------------------------------
  // Consequential mutations (each emits a domain event + an audit event)
  // -----------------------------------------------------------------------

  /**
   * Submit a job (R26 + R27). Idempotent: submitting the same
   * (idempotency scope, idempotency key, correlation id) with the SAME
   * definition digest returns the EXISTING record and executes nothing;
   * with a DIFFERENT definition digest it throws JOB_IDENTITY_CONFLICT.
   */
  async submit(input: SubmitJobInput): Promise<JobRecord> {
    const at = this.clockIso();
    const identity = toJobSubmissionIdentity({
      idempotencyScope: input.definition.idempotency.scope,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    const existing = await this.deps.store.findByIdempotencyKey(identity);
    const resolution = resolveIdempotentSubmission(existing, input.definition.digest);
    if (resolution.outcome === 'idempotent-hit') {
      return resolution.record; // the SAME record — no duplicate execution
    }

    const record = createJobRecord({
      definitionDigest: input.definition.digest,
      kind: {
        namespace: input.definition.kind.namespace,
        name: input.definition.kind.name,
        version: input.definition.kind.version,
      },
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      idempotencyScope: input.definition.idempotency.scope,
      input: input.input,
      policy: {
        timeoutMs: input.definition.timeout.timeoutMs,
        retry: input.definition.retry,
      },
      ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
      submittedAt: at,
    });
    await this.deps.store.insert(record);
    await this.emitMutation(record, 'job.submit', input.actor, at);
    return record;
  }

  /** Claim (start the next attempt of) a queued job: queued → running. */
  async claim(input: JobMutationInput): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const at = this.clockIso();
    const next = claimJob(record, { at });
    await this.deps.store.update(next);
    await this.emitMutation(next, 'job.claim', input.actor, at);
    return next;
  }

  /** Report progress on a running job (observability; R33). */
  async progress(input: ProgressJobInput): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const at = this.clockIso();
    const next = progressJob(record, {
      at,
      ...(input.percent !== undefined ? { percent: input.percent } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    await this.deps.store.update(next);
    await this.emitMutation(next, 'job.progress', input.actor, at);
    return next;
  }

  /**
   * Complete a running job. The result is recorded VERBATIM — the
   * orchestrator never judges domain outcomes (lock rule 16).
   */
  async complete(input: CompleteJobInput): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const at = this.clockIso();
    const next = completeJob(record, { at, result: input.result });
    await this.deps.store.update(next);
    await this.emitMutation(next, 'job.complete', input.actor, at);
    return next;
  }

  /** Fail the current attempt; the retry policy decides requeue vs terminal. */
  async fail(input: FailJobInput): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const at = this.clockIso();
    const next = failJob(record, {
      at,
      errorClass: input.errorClass,
      message: input.message,
    });
    await this.deps.store.update(next);
    await this.emitMutation(next, 'job.fail', input.actor, at);
    return next;
  }

  /** Cancel a queued or running job (terminal, final). */
  async cancel(input: CancelJobInput): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const at = this.clockIso();
    const next = cancelJob(record, { at, reason: input.reason });
    await this.deps.store.update(next);
    await this.emitMutation(next, 'job.cancel', input.actor, at);
    return next;
  }

  /**
   * Timeout sweep: marks every running job whose attempt deadline has
   * passed as timed-out (the timeout policy decides requeue vs terminal
   * failure with kind 'timeout'). Deterministic: driven purely by the
   * injected clock — no timers, no sleeps.
   */
  async timeoutDue(): Promise<readonly JobRecord[]> {
    const nowMs = this.deps.clock.now();
    const at = this.clockIso();
    const records = await this.deps.store.list();
    const due = records.filter(
      (record) =>
        record.status === 'running' &&
        record.timeoutAt !== undefined &&
        Date.parse(record.timeoutAt) <= nowMs,
    );
    const updated: JobRecord[] = [];
    for (const record of due) {
      const next = timeoutJob(record, { at });
      await this.deps.store.update(next);
      await this.emitMutation(next, 'job.timeout', SYSTEM_ACTOR, at);
      updated.push(next);
    }
    return Object.freeze(updated);
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async require(jobId: string): Promise<JobRecord> {
    const record = await this.deps.store.get(jobId);
    if (record === undefined || !isJobRecord(record)) {
      throw new JobError(JOB_ERROR_CODES.INVALID_RECORD, {
        message: `job ${jobId} does not exist`,
        details: { jobId },
      });
    }
    return record;
  }

  private clockIso(): string {
    return new Date(this.deps.clock.now()).toISOString();
  }

  private newEnvelopeId(): string {
    return this.deps.newEnvelopeId?.() ?? globalThis.crypto.randomUUID();
  }

  /**
   * Emit the domain event a transition appended (the LAST event of the
   * record) inside a versioned envelope, then append the
   * consequential-mutation audit event to the tamper-evident chain —
   * naming the actor, the mutation, the job id, the correlation id and
   * the envelope id of the domain event it audits (R28).
   */
  private async emitMutation(
    record: JobRecord,
    mutation: string,
    actor: PrincipalRef | { type: string; tenant: string; principalId: string },
    atIso: string,
  ): Promise<void> {
    const event = record.events[record.events.length - 1];
    if (event === undefined) {
      throw new JobError(JOB_ERROR_CODES.INVALID_EVENT, {
        message: `job ${record.jobId} has no event to emit for mutation ${mutation}`,
      });
    }
    const envelope = this.wrapEvent(event, record, atIso);
    await this.deps.sink.appendJobEvent(envelope);

    const lastAudit = this.deps.sink.lastAuditRecord();
    const auditEvent = makeMutationAuditedEvent({
      sequence: (lastAudit?.sequence ?? 0) + 1,
      occurredAt: atIso,
      jobId: record.jobId,
      mutation,
      actor,
      correlationId: record.correlationId,
      envelopeId: envelope.id,
    });
    const auditEnvelope = this.wrapEvent(auditEvent, record, atIso);
    await this.deps.sink.appendAuditEvent(auditEnvelope);
  }

  private wrapEvent<T extends JobEvent>(
    event: T,
    record: JobRecord,
    atIso: string,
  ): Envelope<T> {
    return makeJobEventEnvelope(event, {
      correlationId: record.correlationId,
      idempotencyKey: record.idempotencyKey,
      id: this.newEnvelopeId(),
      issuedAt: atIso,
    }) as Envelope<T>;
  }
}

/** Actor recorded for orchestrator-driven mutations (timeout sweeps). */
const SYSTEM_ACTOR: PrincipalRef = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'job-orchestrator',
});
