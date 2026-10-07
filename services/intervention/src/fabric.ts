/**
 * In-memory reference fabric for the intervention service (Work Order
 * C007) — the services-layer house pattern (A013/A015/C001/C006):
 * injected ports with an in-process, zero-external-dependency
 * reference implementation. Hosts swap the fabric for real persistence
 * (adapters/*, never here).
 *
 *   - InMemoryInterventionStore — tenant-scoped intervention records
 *     with an idempotency-key index (duplicate begins return the SAME
 *     record — no re-transition of the C001 lifecycle);
 *   - InMemoryTrajectoryPort — the A011 seam over plain
 *     @arena/trajectory records;
 *   - InMemoryEscalationEventSink — collects the webhook events the
 *     service emits (hosts wire the C001 webhook delivery adapter);
 *   - StubValidationHandoff — *** THE C009 VALIDATION SEAM STUB ***
 *     clearly labelled: deterministic routing of SUBMITTED payloads
 *     onto the A012 evaluation fabric or the A013 verification fabric
 *     per a declared mode policy. The full adjudication/revision/
 *     replacement engine is Work Order C009 — NOT shipped here.
 */

import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import type { ExpertSessionRecord } from '@arena/expert-session';
import type { TrajectoryRecord } from '@arena/trajectory';
import type {
  EscalationEventSink,
  EscalationPort,
  InterventionRecord,
  InterventionStore,
  SessionPort,
  TrajectoryPort,
  ValidationFabric,
  ValidationHandoffCommand,
  ValidationHandoffPort,
  ValidationHandoffReceipt,
} from './ports.js';

// ---------------------------------------------------------------------------
// C001 escalation seam (in-process reference)
// ---------------------------------------------------------------------------

export class InMemoryEscalationPort implements EscalationPort {
  private readonly byRequestId = new Map<string, EscalationRecord>();

  async seed(record: EscalationRecord): Promise<void> {
    this.byRequestId.set(record.request.requestId, record);
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    const record = this.byRequestId.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return record;
  }

  async findById(requestId: string): Promise<EscalationRecord | undefined> {
    return this.byRequestId.get(requestId);
  }

  async update(record: EscalationRecord): Promise<void> {
    if (!this.byRequestId.has(record.request.requestId)) {
      throw new Error(`unknown escalation request id: ${record.request.requestId}`);
    }
    this.byRequestId.set(record.request.requestId, record);
  }
}

// ---------------------------------------------------------------------------
// C006 expert-session seam (in-process reference)
// ---------------------------------------------------------------------------

export class InMemorySessionPort implements SessionPort {
  private readonly bySessionId = new Map<string, ExpertSessionRecord>();

  async seed(record: ExpertSessionRecord): Promise<void> {
    this.bySessionId.set(record.capsule.sessionId, record);
  }

  async get(sessionId: string, tenantId: string): Promise<ExpertSessionRecord | undefined> {
    // TENANT SCOPING: a session is only visible to its owning tenant.
    const record = this.bySessionId.get(sessionId);
    if (record === undefined || record.capsule.escalationRef.tenantId !== tenantId) {
      return undefined;
    }
    return record;
  }

  async findById(sessionId: string): Promise<ExpertSessionRecord | undefined> {
    return this.bySessionId.get(sessionId);
  }

  async update(record: ExpertSessionRecord): Promise<void> {
    if (!this.bySessionId.has(record.capsule.sessionId)) {
      throw new Error(`unknown expert session id: ${record.capsule.sessionId}`);
    }
    this.bySessionId.set(record.capsule.sessionId, record);
  }
}

// ---------------------------------------------------------------------------
// Intervention store (durable + idempotent on the reference fabric)
// ---------------------------------------------------------------------------

export class InMemoryInterventionStore implements InterventionStore {
  private readonly byInterventionId = new Map<string, InterventionRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async insert(record: InterventionRecord): Promise<void> {
    if (this.byInterventionId.has(record.interventionId)) {
      throw new Error(`duplicate intervention id: ${record.interventionId}`);
    }
    const key = `${record.tenantId}:${record.idempotencyKey}`;
    if (this.byIdempotencyKey.has(key)) {
      throw new Error(`duplicate intervention idempotency key: ${key}`);
    }
    this.byInterventionId.set(record.interventionId, record);
    this.byIdempotencyKey.set(key, record.interventionId);
  }

  async update(record: InterventionRecord): Promise<void> {
    if (!this.byInterventionId.has(record.interventionId)) {
      throw new Error(`unknown intervention id: ${record.interventionId}`);
    }
    this.byInterventionId.set(record.interventionId, record);
  }

  async get(interventionId: string, tenantId: string): Promise<InterventionRecord | undefined> {
    // TENANT SCOPING: an intervention is only visible to its owning tenant.
    const record = this.byInterventionId.get(interventionId);
    if (record === undefined || record.tenantId !== tenantId) return undefined;
    return record;
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    tenantId: string,
  ): Promise<InterventionRecord | undefined> {
    const interventionId = this.byIdempotencyKey.get(`${tenantId}:${idempotencyKey}`);
    if (interventionId === undefined) return undefined;
    return this.byInterventionId.get(interventionId);
  }

  async list(): Promise<readonly InterventionRecord[]> {
    return [...this.byInterventionId.values()];
  }
}

// ---------------------------------------------------------------------------
// A011 trajectory seam
// ---------------------------------------------------------------------------

export class InMemoryTrajectoryPort implements TrajectoryPort {
  private readonly byTrajectoryId = new Map<string, TrajectoryRecord>();

  async save(record: TrajectoryRecord): Promise<void> {
    this.byTrajectoryId.set(record.header.trajectoryId, record);
  }

  async get(trajectoryId: string): Promise<TrajectoryRecord | undefined> {
    return this.byTrajectoryId.get(trajectoryId);
  }
}

// ---------------------------------------------------------------------------
// Webhook event sink
// ---------------------------------------------------------------------------

export class InMemoryEscalationEventSink implements EscalationEventSink {
  readonly events: EscalationWebhookEvent[] = [];

  async emit(event: EscalationWebhookEvent): Promise<void> {
    this.events.push(event);
  }

  /** Events of one type, in emission order (test surface). */
  ofType(eventType: string): readonly EscalationWebhookEvent[] {
    return this.events.filter((event) => event.eventType === eventType);
  }
}

// ---------------------------------------------------------------------------
// *** THE C009 VALIDATION SEAM — DETERMINISTIC REFERENCE STUB ***
// ---------------------------------------------------------------------------

/**
 * *** STUB — Work Order C009 (not yet dispatched) ***
 *
 * Deterministic routing of SUBMITTED payloads onto the validation
 * fabrics. The routing policy declared here (the "validation
 * condition") is a REFERENCE POLICY ONLY:
 *
 *   - modes whose per-mode contract is an evaluative critique
 *     (review, evaluate) route onto the A012 EVALUATION fabric;
 *   - every other mode routes onto the A013 VERIFICATION fabric.
 *
 * The real C009 engine will derive the routing from the request's
 * DECLARED validation condition and own adjudication, revision and
 * expert replacement. Replace this stub by injecting a real
 * ValidationHandoffPort — no service code changes are needed.
 */
export const STUB_VALIDATION_CONDITION_SOURCE = 'c009-stub-mode-policy';
export const STUB_VALIDATION_CONDITION_POLICY =
  'review-and-evaluate-route-to-a012-evaluation-fabric';

const EVALUATIVE_MODES: readonly string[] = Object.freeze(['review', 'evaluate']);

export class StubValidationHandoff implements ValidationHandoffPort {
  async route(command: ValidationHandoffCommand): Promise<ValidationHandoffReceipt> {
    const routedTo: ValidationFabric = EVALUATIVE_MODES.includes(command.mode)
      ? 'evaluation-fabric'
      : 'verification-fabric';
    return Object.freeze({
      handoffVersion: 1,
      receiptId: `vh-${command.requestId}-${command.mode}`,
      status: 'routed',
      routedTo,
      validationCondition: Object.freeze({
        source: STUB_VALIDATION_CONDITION_SOURCE,
        policy: STUB_VALIDATION_CONDITION_POLICY,
      }),
      stub: true,
    });
  }
}
