/**
 * TEST-ONLY reference engines for the runtime-host composition root
 * (Work Order P002; issue #154).
 *
 * The host core (./host.ts) takes its composed service engines INJECTED
 * through the frozen package's structural surfaces (`EscalationLifecycleSurface`
 * / `JobRunnerSurface`) — boundary law B2: a service may never import
 * another service. The REAL engine classes (services/escalation-api's
 * EscalationApiService, services/job-orchestrator's JobOrchestrator) are
 * wired at the composition site (deploy/runtime/src/composition.ts for
 * production; tests/runtime-host for the acceptance battery — which PINS
 * the real-classes parity this file can only approximate).
 *
 * These reference engines let the composition root's OWN unit tests run
 * with no database and no service imports: they are thin, honest
 * protocol/domain-driven twins of the real engines —
 *
 *   - ReferenceEscalationsEngine: the C001 create/replay/advance/list/
 *     status/sweep/action-log flow over the DURABLE escalation store +
 *     webhook outbox, built directly on @arena/escalation's domain
 *     functions (create → triaged → matching, no routing: no-match
 *     stays `matching`, exactly the real service's no-match posture);
 *   - ReferenceJobRunnerEngine: the A015 orchestrator's public flow over
 *     the DURABLE job store + event sink, built directly on
 *     @arena/job-protocol's pure transition functions and emitting the
 *     same domain-event envelopes + consequential-mutation audit events.
 *
 * EVIDENCE CLASS DISCLOSURE: this is reference fabric, NOT the real
 * service engine. Every acceptance claim about the REAL engines is
 * produced by tests/runtime-host against the real classes (embedded
 * real Postgres + live Neon). NOT exported from the package index
 * (A033 hygiene: test-support stays private to its package).
 */

import { toCorrelationId } from '@arena/protocol-core';
import type { Envelope, IdempotencyKey } from '@arena/protocol-core';
import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
  createEscalationWebhookEvent,
  escalationConflictError,
  isTerminalEscalationState,
  lifecycleEventForState,
  makeEscalationResponse,
  makeEscalationWebhookEventEnvelope,
  markEscalationTimedOut,
  resolveEscalationIdempotency,
} from '@arena/escalation';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationResponse,
  EscalationState,
  TransitionContext,
} from '@arena/escalation';
import {
  cancelJob,
  claimJob,
  completeJob,
  createJobRecord,
  failJob,
  makeJobEventEnvelope,
  makeMutationAuditedEvent,
  progressJob,
  resolveIdempotentSubmission,
  timeoutJob,
  toJobSubmissionIdentity,
} from '@arena/job-protocol';
import type { JobEvent, JobRecord, PrincipalRef } from '@arena/job-protocol';
import type {
  EscalationCreateOutcome,
  EscalationLifecycleSurface,
  JobRunnerSurface,
  SubmitJobInputJson,
} from '@arena/runtime-host';
import type {
  EscalationStorePort,
  EventSinkPort,
  JobStorePort,
  WebhookOutboxPort,
} from '@arena/runtime-host';
import type { Clock } from '@arena/persistence';

// ---------------------------------------------------------------------------
// The escalation-submission fixture (the C001 test-support twin)
// ---------------------------------------------------------------------------

/** A valid ES1.0 create-escalation input (the validCreateInput twin). */
export function referenceCreateInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    clientAppId: 'epoch-app',
    tenantId: 'tenant-alpha',
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    taskRef: 'task-7',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: {
      requiredCapabilities: ['boq-estimation.quantity-takeoff'],
      preferredLocales: ['en-GH'],
    },
    locale: 'en',
    desiredOutputSchema: {
      type: 'object',
      required: ['total'],
      properties: { total: { type: 'number' } },
    },
    contextReferences: [{ kind: 'task-ref', ref: 'task-7' }],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch', 'signal-tool-gap'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ReferenceEscalationsEngine (the C001 flow over the durable ports)
// ---------------------------------------------------------------------------

export interface ReferenceEscalationsEngineConfig {
  readonly clock: Clock;
  readonly store: EscalationStorePort;
  readonly outbox: WebhookOutboxPort;
}

/** One entry in the in-memory reference action log (audit trail). */
interface ReferenceActionLogEntry {
  readonly requestId: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly recordedAt: number;
}

/**
 * The reference escalation lifecycle engine: the C001 create/replay/
 * advance/list/status/sweep/action-log flow, built directly on the
 * domain package over the DURABLE store + outbox. No routing — a fresh
 * escalation settles in `matching` (the real service's no-match
 * posture; the real routing service is composed at the composition
 * site).
 */
export class ReferenceEscalationsEngine implements EscalationLifecycleSurface {
  private readonly config: ReferenceEscalationsEngineConfig;
  private readonly actionLogs = new Map<string, ReferenceActionLogEntry[]>();

  constructor(config: ReferenceEscalationsEngineConfig) {
    this.config = config;
  }

  async createEscalation(input: CreateEscalationRequestInput): Promise<EscalationCreateOutcome> {
    const { clock, store } = this.config;
    const identity = toJobSubmissionIdentity({
      idempotencyScope: `escalation-${input.tenantId}`,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    const existing = await store.findByIdempotencyKey(identity);
    const now = existing === undefined ? clock.now() : Date.parse(existing.request.createdAt);
    const requestId = existing === undefined ? input.requestId : existing.request.requestId;
    const request = await createEscalationRequest({
      ...input,
      now,
      ...(requestId !== undefined ? { requestId } : {}),
    });
    const resolution = resolveEscalationIdempotency(request, existing);
    if (resolution.outcome === 'conflict') {
      throw escalationConflictError(resolution);
    }
    if (resolution.outcome === 'replay') {
      const response = makeEscalationResponse(
        {
          responseVersion: 1,
          kind: 'escalation-replayed',
          requestId: resolution.originalRequestId,
          correlationId: resolution.record.request.correlationId,
          duplicate: true,
        },
        toCorrelationId(resolution.record.request.correlationId),
      );
      return {
        outcome: 'replay',
        requestId: resolution.originalRequestId,
        duplicate: true,
        record: resolution.record,
        emittedEvents: [],
        response,
        serializedResponse: JSON.stringify({ ...response.payload }),
      };
    }
    let record = createEscalationRecord(request, now);
    await store.insert(record);
    await this.emitWebhookEvent(record);
    // Reference flow drive (the C001 reference arc, minus routing):
    // created → triaged → matching.
    record = applyEscalationTransition(record, 'triaged', { now, tenantId: input.tenantId });
    await store.update(record);
    await this.emitWebhookEvent(record);
    record = applyEscalationTransition(record, 'matching', { now, tenantId: input.tenantId });
    await store.update(record);
    await this.emitWebhookEvent(record);
    const response = makeEscalationResponse(
      {
        responseVersion: 1,
        kind: 'escalation-created',
        requestId: record.request.requestId,
        correlationId: record.request.correlationId,
        duplicate: false,
      },
      toCorrelationId(record.request.correlationId),
    );
    return {
      outcome: 'created',
      requestId: record.request.requestId,
      duplicate: false,
      record,
      emittedEvents: [],
      response,
      serializedResponse: JSON.stringify({ ...response.payload }),
    };
  }

  async getEscalationStatus(params: {
    requestId: string;
    tenantId: string;
  }): Promise<{
    record: EscalationRecord;
    response: Envelope<EscalationResponse>;
    serializedResponse: string;
  }> {
    const record = await this.config.store.get(params.requestId, params.tenantId);
    if (record === undefined) {
      throw new ReferenceEngineError(
        'REFERENCE_ESCALATION_NOT_FOUND',
        `escalation ${params.requestId} not found for tenant ${params.tenantId}`,
      );
    }
    const response = makeEscalationResponse(
      { responseVersion: 1, kind: 'escalation-status', record },
      toCorrelationId(record.request.correlationId),
    );
    return { record, response, serializedResponse: JSON.stringify({ state: record.state }) };
  }

  async listByCorrelationId(
    tenantId: string,
    correlationId: string,
  ): Promise<readonly EscalationRecord[]> {
    return this.config.store.findByCorrelationId(tenantId, correlationId);
  }

  async advanceLifecycle(
    requestId: string,
    tenantId: string,
    to: EscalationState,
    context: Omit<TransitionContext, 'now' | 'tenantId'> = {},
  ): Promise<EscalationRecord> {
    const record = await this.config.store.findById(requestId);
    if (record === undefined) {
      throw new ReferenceEngineError(
        'REFERENCE_ESCALATION_NOT_FOUND',
        `escalation ${requestId} not found`,
      );
    }
    // The DOMAIN layer enforces the tenant guard — a cross-tenant
    // attempt is a typed ESCALATION_CROSS_TENANT_ACCESS failure.
    const next = applyEscalationTransition(record, to, {
      ...context,
      now: this.config.clock.now(),
      tenantId,
    });
    await this.config.store.update(next);
    await this.emitWebhookEvent(next);
    return next;
  }

  async sweepTimeouts(): Promise<readonly EscalationRecord[]> {
    const now = this.config.clock.now();
    const timedOut: EscalationRecord[] = [];
    for (const record of await this.config.store.list()) {
      if (isTerminalEscalationState(record.state)) continue;
      if (Date.parse(record.request.deadline) > now) continue;
      const next = markEscalationTimedOut(record, { now });
      await this.config.store.update(next);
      await this.emitWebhookEvent(next);
      timedOut.push(next);
    }
    return Object.freeze(timedOut);
  }

  async recordExpertAction(
    requestId: string,
    tenantId: string,
    action: string,
  ): Promise<{ requestId: string; action: string; allowed: true; recordedAt: number }> {
    const record = await this.config.store.findById(requestId);
    if (record === undefined) {
      throw new ReferenceEngineError(
        'REFERENCE_ESCALATION_NOT_FOUND',
        `escalation ${requestId} not found`,
      );
    }
    if (record.request.tenantId !== tenantId) {
      throw new ReferenceEngineError(
        'REFERENCE_CROSS_TENANT_ACCESS',
        `escalation ${requestId} belongs to tenant ${record.request.tenantId}; tenant ${tenantId} may not act on it`,
      );
    }
    const permitted = (record.request.permittedActions as readonly string[]).includes(action);
    const now = this.config.clock.now();
    const entry = Object.freeze({
      requestId,
      action,
      allowed: permitted,
      recordedAt: now,
    });
    const existing = this.actionLogs.get(requestId) ?? [];
    this.actionLogs.set(requestId, [...existing, entry]);
    if (!permitted) {
      throw new ReferenceEngineError(
        'REFERENCE_UNPERMITTED_ACTION',
        `action ${JSON.stringify(action)} is not in the permitted actions of escalation ${requestId}`,
      );
    }
    return { requestId, action, allowed: true, recordedAt: now };
  }

  actionLog(requestId: string): readonly ReferenceActionLogEntry[] {
    return [...(this.actionLogs.get(requestId) ?? [])];
  }

  private async emitWebhookEvent(record: EscalationRecord): Promise<void> {
    const eventType = lifecycleEventForState(record.state);
    if (eventType === null) return;
    const event = createEscalationWebhookEvent({
      eventType,
      request: record.request,
      sequence: record.history.length,
      now: record.updatedAt,
      state: record.state,
      data: { state: record.state },
    });
    const envelope = makeEscalationWebhookEventEnvelope(
      event,
      toCorrelationId(record.request.correlationId),
    );
    await this.config.outbox.append(event, envelope);
  }
}

// ---------------------------------------------------------------------------
// ReferenceJobRunnerEngine (the A015 orchestrator flow over the durable ports)
// ---------------------------------------------------------------------------

export interface ReferenceJobRunnerEngineConfig {
  readonly clock: Clock;
  readonly store: JobStorePort;
  readonly sink: EventSinkPort;
}

/**
 * The reference shared job runner: the A015 orchestrator's public flow
 * over the DURABLE job store + event sink, built directly on the
 * protocol's pure transition functions and emitting the same
 * domain-event envelopes + consequential-mutation audit events.
 */
export class ReferenceJobRunnerEngine implements JobRunnerSurface {
  private readonly config: ReferenceJobRunnerEngineConfig;

  constructor(config: ReferenceJobRunnerEngineConfig) {
    this.config = config;
  }

  async get(jobId: string): Promise<JobRecord | undefined> {
    return this.config.store.get(jobId);
  }

  async findByCorrelationId(correlationId: string): Promise<readonly JobRecord[]> {
    return this.config.store.findByCorrelationId(correlationId);
  }

  async retryDue(): Promise<readonly JobRecord[]> {
    const now = this.config.clock.now();
    const records = await this.config.store.list();
    return Object.freeze(
      records.filter(
        (record) =>
          record.status === 'queued' &&
          record.nextRetryAt !== undefined &&
          Date.parse(record.nextRetryAt) <= now,
      ),
    );
  }

  async submit(input: SubmitJobInputJson): Promise<JobRecord> {
    const atIso = this.isoNow();
    const identity = toJobSubmissionIdentity({
      idempotencyScope: input.definition.idempotency.scope,
      idempotencyKey: input.idempotencyKey,
      correlationId: input.correlationId,
    });
    const existing = await this.config.store.findByIdempotencyKey(identity);
    const resolution = resolveIdempotentSubmission(existing, input.definition.digest);
    if (resolution.outcome === 'idempotent-hit') {
      return resolution.record;
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
      submittedAt: atIso,
    });
    await this.config.store.insert(record);
    await this.emitMutation(record, 'job.submit', input.actor, atIso);
    return record;
  }

  async claim(input: { jobId: string; actor: SubmitJobInputJson['actor'] }): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const atIso = this.isoNow();
    const next = claimJob(record, { at: atIso });
    await this.config.store.update(next);
    await this.emitMutation(next, 'job.claim', input.actor, atIso);
    return next;
  }

  async progress(input: {
    jobId: string;
    actor: SubmitJobInputJson['actor'];
    percent?: number;
    note?: string;
  }): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const atIso = this.isoNow();
    const next = progressJob(record, {
      at: atIso,
      ...(input.percent !== undefined ? { percent: input.percent } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    await this.config.store.update(next);
    await this.emitMutation(next, 'job.progress', input.actor, atIso);
    return next;
  }

  async complete(input: {
    jobId: string;
    actor: SubmitJobInputJson['actor'];
    result: unknown;
  }): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const atIso = this.isoNow();
    const next = completeJob(record, { at: atIso, result: input.result });
    await this.config.store.update(next);
    await this.emitMutation(next, 'job.complete', input.actor, atIso);
    return next;
  }

  async fail(input: {
    jobId: string;
    actor: SubmitJobInputJson['actor'];
    errorClass: string;
    message: string;
  }): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const atIso = this.isoNow();
    const next = failJob(record, {
      at: atIso,
      errorClass: input.errorClass,
      message: input.message,
    });
    await this.config.store.update(next);
    await this.emitMutation(next, 'job.fail', input.actor, atIso);
    return next;
  }

  async cancel(input: {
    jobId: string;
    actor: SubmitJobInputJson['actor'];
    reason: string;
  }): Promise<JobRecord> {
    const record = await this.require(input.jobId);
    const atIso = this.isoNow();
    const next = cancelJob(record, { at: atIso, reason: input.reason });
    await this.config.store.update(next);
    await this.emitMutation(next, 'job.cancel', input.actor, atIso);
    return next;
  }

  async timeoutDue(): Promise<readonly JobRecord[]> {
    const nowMs = this.config.clock.now();
    const atIso = this.isoNow();
    const records = await this.config.store.list();
    const due = records.filter(
      (record) =>
        record.status === 'running' &&
        record.timeoutAt !== undefined &&
        Date.parse(record.timeoutAt) <= nowMs,
    );
    const updated: JobRecord[] = [];
    for (const record of due) {
      const next = timeoutJob(record, { at: atIso });
      await this.config.store.update(next);
      await this.emitMutation(next, 'job.timeout', SYSTEM_ACTOR, atIso);
      updated.push(next);
    }
    return Object.freeze(updated);
  }

  private async require(jobId: string): Promise<JobRecord> {
    const record = await this.config.store.get(jobId);
    if (record === undefined) {
      throw new ReferenceEngineError('REFERENCE_JOB_NOT_FOUND', `job ${jobId} does not exist`);
    }
    return record;
  }

  private isoNow(): string {
    return new Date(this.config.clock.now()).toISOString();
  }

  /**
   * Emit the domain event a transition appended (the record's LAST
   * event) in a versioned envelope, then append the audit event — the
   * same emission discipline the real orchestrator applies.
   */
  private async emitMutation(
    record: JobRecord,
    mutation: string,
    actor: SubmitJobInputJson['actor'],
    atIso: string,
  ): Promise<void> {
    const event = record.events[record.events.length - 1];
    if (event === undefined) {
      throw new ReferenceEngineError(
        'REFERENCE_JOB_NO_EVENT',
        `job ${record.jobId} has no event to emit for mutation ${mutation}`,
      );
    }
    const envelope = this.wrapEvent(event, record, atIso);
    await this.config.sink.appendJobEvent(envelope);
    const lastAudit = this.config.sink.lastAuditRecord();
    const auditEvent = makeMutationAuditedEvent({
      sequence: (lastAudit?.sequence ?? 0) + 1,
      occurredAt: atIso,
      jobId: record.jobId,
      mutation,
      actor: actor as PrincipalRef,
      correlationId: record.correlationId,
      envelopeId: envelope.id,
    });
    const auditEnvelope = this.wrapEvent(auditEvent, record, atIso);
    await this.config.sink.appendAuditEvent(auditEnvelope);
  }

  private wrapEvent<T extends JobEvent>(
    event: T,
    record: JobRecord,
    atIso: string,
  ): Envelope<T> {
    return makeJobEventEnvelope(event, {
      correlationId: record.correlationId,
      idempotencyKey: record.idempotencyKey as IdempotencyKey,
      id: newEnvelopeId(),
      issuedAt: atIso,
    }) as Envelope<T>;
  }
}

/** Actor recorded for runner-driven mutations (timeout sweeps). */
const SYSTEM_ACTOR: PrincipalRef = Object.freeze({
  type: 'service',
  tenant: 'arena',
  principalId: 'reference-job-runner',
});

function newEnvelopeId(): string {
  return globalThis.crypto.randomUUID();
}

/** A typed reference-engine error (machine-readable). */
export class ReferenceEngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ReferenceEngineError';
    this.code = code;
  }
}
