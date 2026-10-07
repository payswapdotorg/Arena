/**
 * In-memory reference fabric for the escalation API service (Work Order
 * C001) — the services-layer house pattern (A013/A015/A025): injected
 * ports with an in-process, zero-external-dependency reference
 * implementation. Hosts swap the fabric for real persistence (Neon/R2/
 * Upstash adapters live in adapters/*, never here).
 *
 *   - InMemoryEscalationStore — tenant-scoped record store whose dedup
 *     index is keyed by the A015 job-protocol submission identity
 *     (scope `escalation-<tenant>` ⇒ tenant-isolated key spaces);
 *   - InMemoryWebhookOutbox — durable, at-least-once delivery records
 *     keyed by eventId (the idempotent consumer key).
 */

import { serializeEnvelope } from '@arena/protocol-core';
import type { Envelope } from '@arena/protocol-core';
import type { JobSubmissionIdentity } from '@arena/job-protocol';
import { jobSubmissionKey } from '@arena/job-protocol';
import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';
import type { EscalationStore, WebhookDeliveryRecord, WebhookOutbox } from './ports.js';

export class InMemoryEscalationStore implements EscalationStore {
  private readonly byRequestId = new Map<string, EscalationRecord>();
  private readonly bySubmissionKey = new Map<string, EscalationRecord>();
  private readonly byCorrelation = new Map<string, EscalationRecord[]>();

  async insert(record: EscalationRecord): Promise<void> {
    const requestId = record.request.requestId;
    if (this.byRequestId.has(requestId)) {
      throw new Error(`duplicate escalation request id: ${requestId}`);
    }
    // Key format matches @arena/job-protocol's jobSubmissionKey with the
    // A015 scope `escalation-<tenant>` — tenant-isolated key spaces.
    const key = `escalation-${record.request.tenantId}:${record.request.idempotencyKey}:${record.request.correlationId}`;
    if (this.bySubmissionKey.has(key)) {
      throw new Error(`duplicate escalation submission key: ${key}`);
    }
    this.byRequestId.set(requestId, record);
    this.bySubmissionKey.set(key, record);
    const correlationKey = `t:${record.request.tenantId}:c:${record.request.correlationId}`;
    const existing = this.byCorrelation.get(correlationKey) ?? [];
    this.byCorrelation.set(correlationKey, [...existing, record]);
  }

  async update(record: EscalationRecord): Promise<void> {
    const requestId = record.request.requestId;
    if (!this.byRequestId.has(requestId)) {
      throw new Error(`unknown escalation request id: ${requestId}`);
    }
    this.byRequestId.set(requestId, record);
    const key = `escalation-${record.request.tenantId}:${record.request.idempotencyKey}:${record.request.correlationId}`;
    this.bySubmissionKey.set(key, record);
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    // TENANT SCOPING: a record is only visible to its owning tenant.
    const record = this.byRequestId.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return record;
  }

  async findById(requestId: string): Promise<EscalationRecord | undefined> {
    return this.byRequestId.get(requestId);
  }

  async findByIdempotencyKey(identity: JobSubmissionIdentity): Promise<EscalationRecord | undefined> {
    return this.bySubmissionKey.get(jobSubmissionKey(identity));
  }

  async findByCorrelationId(tenantId: string, correlationId: string): Promise<readonly EscalationRecord[]> {
    return this.byCorrelation.get(`t:${tenantId}:c:${correlationId}`) ?? [];
  }

  async list(): Promise<readonly EscalationRecord[]> {
    return [...this.byRequestId.values()];
  }
}

export class InMemoryWebhookOutbox implements WebhookOutbox {
  private readonly deliveries = new Map<string, WebhookDeliveryRecord>();

  async append(event: EscalationWebhookEvent, envelope: Envelope<EscalationWebhookEvent>): Promise<void> {
    if (this.deliveries.has(event.eventId)) {
      throw new Error(`duplicate webhook event id: ${event.eventId}`);
    }
    this.deliveries.set(event.eventId, {
      eventId: event.eventId,
      requestId: event.requestId,
      tenantId: event.tenantId,
      sequence: event.sequence,
      payload: serializeEnvelope(envelope),
      createdAt: event.occurredAt ? Date.parse(event.occurredAt) : 0,
      deliveredAt: null,
    });
  }

  async listPending(): Promise<readonly WebhookDeliveryRecord[]> {
    return [...this.deliveries.values()].filter((entry) => entry.deliveredAt === null);
  }

  async listAll(): Promise<readonly WebhookDeliveryRecord[]> {
    return [...this.deliveries.values()];
  }

  async markDelivered(eventId: string, at: number): Promise<void> {
    const entry = this.deliveries.get(eventId);
    if (entry === undefined) return;
    this.deliveries.set(eventId, { ...entry, deliveredAt: at });
  }
}

/** Fixed-clock reference implementation (deterministic tests / replays). */
export class FixedClock {
  constructor(private current: number) {}
  now(): number {
    return this.current;
  }
  advanceTo(ms: number): void {
    this.current = ms;
  }
  advanceBy(ms: number): void {
    this.current += ms;
  }
}
