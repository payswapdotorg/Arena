/**
 * EscalationApiService — the envelope-wired reference service facade for
 * the Arena expert escalation API (Work Order C001; ES1.0; mirrors the
 * A025 ApiService pattern: injected dependencies, fail-closed error
 * normalization, NO network/HTTP layer — adapters/escalation owns the
 * wire transports).
 *
 * REST-shaped canonical surfaces:
 *   - POST /v1/escalations      → createEscalation (durable request id,
 *     idempotency-key replay / typed conflict);
 *   - GET /v1/escalations/{id}  → getEscalationStatus (idempotent,
 *     tenant-scoped status polling with state, result, validation
 *     status and cost fields per the ES1.0 response).
 *
 * Durability wiring (A015 fabric semantics):
 *   - the dedup index rides @arena/job-protocol's JobSubmissionIdentity
 *     with the scope `escalation-<tenant>` (tenant-isolated key spaces);
 *   - records are correlation-addressable (findByCorrelationId);
 *   - every lifecycle transition appends exactly one webhook event to
 *     the durable at-least-once outbox (eventId = idempotent consumer
 *     key; adapters/escalation drains it);
 *   - timeouts are swept deterministically from the injected clock
 *     (sweepTimeouts → TIMED_OUT + escalation.failed event).
 */

import { toCorrelationId } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import { toJobSubmissionIdentity } from '@arena/job-protocol';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import {
  ESCALATION_ERROR_CODES,
  EscalationError,
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
  EscalationWebhookEvent,
  TransitionContext,
} from '@arena/escalation';
import type { Clock, EscalationStore, RoutingPort, WebhookOutbox } from './ports.js';
import { RoundRobinRoutingStub } from './routing.js';
import type { QualifiedExpertDirectory } from './ports.js';
import { InMemoryEscalationStore, InMemoryWebhookOutbox } from './fabric.js';

export interface EscalationApiServiceConfig {
  readonly clock?: Clock;
  readonly store?: EscalationStore;
  readonly outbox?: WebhookOutbox;
  readonly routing?: RoutingPort;
  readonly directory?: QualifiedExpertDirectory;
}

/** The outcome of POST /v1/escalations (machine-readable tri-state). */
export interface CreateEscalationOutcome {
  readonly outcome: 'created' | 'replay';
  readonly requestId: string;
  readonly duplicate: boolean;
  readonly record: EscalationRecord;
  /** The events appended to the durable outbox by this call. */
  readonly emittedEvents: readonly EscalationWebhookEvent[];
  /** The serialized escalation-response envelope (the wire form). */
  readonly serializedResponse: string;
  readonly response: Envelope<EscalationResponse>;
}

/** A recorded expert action verdict (machine-readable, never a bare boolean). */
export interface ExpertActionRecord {
  readonly requestId: string;
  readonly action: string;
  readonly allowed: true;
  readonly recordedAt: number;
}

/** One entry in the append-only expert action log (attempts included). */
export interface ExpertActionLogEntry {
  readonly requestId: string;
  readonly action: string;
  readonly allowed: boolean;
  readonly recordedAt: number;
}

const ID_EMPOTENCY_SCOPE_PREFIX = 'escalation';

function submissionIdentityFor(tenantId: string, idempotencyKey: string, correlationId: string): JobSubmissionIdentity {
  return toJobSubmissionIdentity({
    idempotencyScope: `${ID_EMPOTENCY_SCOPE_PREFIX}-${tenantId}`,
    idempotencyKey,
    correlationId,
  });
}

export class EscalationApiService {
  readonly clock: Clock;
  readonly store: EscalationStore;
  readonly outbox: WebhookOutbox;
  readonly routing: RoutingPort;
  private readonly expertActions = new Map<string, ExpertActionLogEntry[]>();

  constructor(config: EscalationApiServiceConfig = {}) {
    this.clock = config.clock ?? { now: () => 0 };
    this.store = config.store ?? new InMemoryEscalationStore();
    this.outbox = config.outbox ?? new InMemoryWebhookOutbox();
    this.routing = config.routing ?? new RoundRobinRoutingStub({ directory: config.directory ?? { listQualifiedExperts: async () => [] } });
  }

  // -------------------------------------------------------------------------
  // POST /v1/escalations
  // -------------------------------------------------------------------------

  /** Create an escalation (idempotent on the submission identity). */
  async createEscalation(input: CreateEscalationRequestInput): Promise<CreateEscalationOutcome> {
    if (typeof input !== 'object' || input === null) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: 'escalation submission must be an object',
      });
    }
    // Pre-resolve the submission identity so that a duplicate submission
    // is compared against the ORIGINAL record's server-controlled fields
    // (requestId / createdAt): identical client bodies replay, any client
    // field difference is a typed conflict — never a silent rebind.
    const identity = submissionIdentityFor(input.tenantId, input.idempotencyKey, input.correlationId);
    const existing = await this.store.findByIdempotencyKey(identity);
    const now = existing === undefined ? this.clock.now() : Date.parse(existing.request.createdAt);
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
    await this.store.insert(record);
    const emitted: EscalationWebhookEvent[] = [];
    emitted.push(await this.emitWebhookEvent(record));

    // Reference flow drive: triage → matching → route (stub seam).
    record = applyEscalationTransition(record, 'triaged', { now });
    await this.store.update(record);
    emitted.push(await this.emitWebhookEvent(record));
    record = applyEscalationTransition(record, 'matching', { now });
    await this.store.update(record);
    emitted.push(await this.emitWebhookEvent(record));

    const decision = await this.routing.route(record);
    if (decision.outcome === 'matched') {
      record = applyEscalationTransition(record, 'offered', { now, expertRef: decision.expertRef });
      await this.store.update(record);
      emitted.push(await this.emitWebhookEvent(record));
    }
    // no-match: the escalation STAYS in `matching` — the C002 routing
    // service owns real matching; the stub never silently best-efforts.

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
      emittedEvents: emitted,
      response,
      serializedResponse: JSON.stringify({ ...response.payload }),
    };
  }

  // -------------------------------------------------------------------------
  // GET /v1/escalations/{request_id}
  // -------------------------------------------------------------------------

  /** Idempotent, tenant-scoped status polling. */
  async getEscalationStatus(params: {
    requestId: string;
    tenantId: string;
  }): Promise<{ record: EscalationRecord; response: Envelope<EscalationResponse>; serializedResponse: string }> {
    const record = await this.store.get(params.requestId, params.tenantId);
    if (record === undefined) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `escalation ${params.requestId} not found for tenant ${params.tenantId}`,
        details: { requestId: params.requestId, tenantId: params.tenantId },
      });
    }
    const response = makeEscalationResponse(
      { responseVersion: 1, kind: 'escalation-status', record },
      toCorrelationId(record.request.correlationId),
    );
    return { record, response, serializedResponse: JSON.stringify({ state: record.state }) };
  }

  /** Correlation-addressable listing (lock rule 17). */
  async listByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]> {
    return this.store.findByCorrelationId(tenantId, correlationId);
  }

  // -------------------------------------------------------------------------
  // Lifecycle driving (guarded, webhook-emitting, durable)
  // -------------------------------------------------------------------------

  /**
   * Apply one guarded lifecycle transition by request id (tenant-scoped).
   * Persists the new snapshot and appends exactly one webhook event.
   */
  async advanceLifecycle(
    requestId: string,
    tenantId: string,
    to: EscalationState,
    context: Omit<TransitionContext, 'now' | 'tenantId'> = {},
  ): Promise<EscalationRecord> {
    const record = await this.store.findById(requestId);
    if (record === undefined) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `escalation ${requestId} not found`,
      });
    }
    // The DOMAIN layer enforces the tenant guard — a cross-tenant
    // attempt is a typed ESCALATION_CROSS_TENANT_ACCESS failure.
    const next = applyEscalationTransition(record, to, {
      ...context,
      now: this.clock.now(),
      tenantId,
    });
    await this.store.update(next);
    await this.emitWebhookEvent(next);
    return next;
  }

  /**
   * Timeout sweep — the durable-lifecycle durability path: every
   * non-terminal record past its deadline moves to the EXPLICIT
   * timed_out state and emits escalation.failed. Deterministic from the
   * injected clock; safe to re-run.
   */
  async sweepTimeouts(): Promise<readonly EscalationRecord[]> {
    const now = this.clock.now();
    const timedOut: EscalationRecord[] = [];
    for (const record of await this.store.list()) {
      if (isTerminalEscalationState(record.state)) continue;
      if (Date.parse(record.request.deadline) > now) continue;
      const next = markEscalationTimedOut(record, { now });
      await this.store.update(next);
      await this.emitWebhookEvent(next);
      timedOut.push(next);
    }
    return timedOut;
  }

  /**
   * Record an expert action against the CLOSED permitted-actions
   * vocabulary of the request. Unpermitted actions (including
   * role-escalation shapes) fail closed with a typed error — and the
   * ATTEMPT is recorded on the action log (audit trail).
   */
  async recordExpertAction(
    requestId: string,
    tenantId: string,
    action: string,
  ): Promise<ExpertActionRecord> {
    const record = await this.store.findById(requestId);
    if (record === undefined) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_REQUEST, {
        message: `escalation ${requestId} not found`,
      });
    }
    if (record.request.tenantId !== tenantId) {
      throw new EscalationError(ESCALATION_ERROR_CODES.CROSS_TENANT_ACCESS, {
        message: `escalation ${requestId} belongs to tenant ${record.request.tenantId}; tenant ${tenantId} may not act on it`,
      });
    }
    const permitted = (record.request.permittedActions as readonly string[]).includes(action);
    const now = this.clock.now();
    if (!permitted) {
      // The denial is recorded BEFORE failing closed (audit trail).
      this.appendAction(requestId, action, false, now);
      throw new EscalationError(ESCALATION_ERROR_CODES.UNPERMITTED_ACTION, {
        message: `action ${JSON.stringify(action)} is not in the permitted actions of escalation ${requestId}`,
        details: { requestId, action, permittedActions: record.request.permittedActions },
      });
    }
    const entry = this.appendAction(requestId, action, true, now);
    return { requestId, action, allowed: true, recordedAt: entry.recordedAt };
  }

  /** The recorded action log for one escalation (audit surface). */
  actionLog(requestId: string): readonly ExpertActionLogEntry[] {
    return [...(this.expertActions.get(requestId) ?? [])];
  }

  // -------------------------------------------------------------------------
  // Webhook outbox (durable, at-least-once; drained by the adapter)
  // -------------------------------------------------------------------------

  private async emitWebhookEvent(record: EscalationRecord): Promise<EscalationWebhookEvent> {
    const eventType = lifecycleEventForState(record.state);
    if (eventType === null) {
      throw new EscalationError(ESCALATION_ERROR_CODES.INVALID_EVENT, {
        message: `lifecycle state ${record.state} has no webhook projection`,
      });
    }
    const event = createEscalationWebhookEvent({
      eventType,
      request: record.request,
      sequence: record.history.length,
      now: record.updatedAt,
      state: record.state,
      data: {
        state: record.state,
        ...(record.expertRef !== undefined ? { expertRef: record.expertRef } : {}),
        ...(record.sessionRef !== undefined ? { sessionRef: record.sessionRef } : {}),
        ...(record.result !== undefined ? { resultKind: record.result.kind } : {}),
        ...(record.cost !== undefined ? { cost: record.cost } : {}),
      },
    });
    const envelope = makeEscalationWebhookEventEnvelope(
      event,
      toCorrelationId(record.request.correlationId),
    );
    await this.outbox.append(event, envelope);
    return event;
  }

  private appendAction(requestId: string, action: string, allowed: boolean, at: number): ExpertActionLogEntry {
    const entry = Object.freeze({ requestId, action, allowed, recordedAt: at });
    const existing = this.expertActions.get(requestId) ?? [];
    this.expertActions.set(requestId, [...existing, entry]);
    return entry;
  }
}
