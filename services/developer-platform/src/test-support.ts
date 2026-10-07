/**
 * Test support (Work Order C017) — the reference fabric wiring for the
 * developer-platform service suites: a FAKE escalation port built over
 * the REAL @arena/escalation domain factories (genuine domain-level
 * integration: real requests, real lifecycle, real webhook events),
 * mirroring the C001 service's reference-flow drive.
 */

import {
  applyEscalationTransition,
  createEscalationRecord,
  createEscalationRequest,
  lifecycleEventForState,
} from '@arena/escalation';
import type {
  CreateEscalationRequestInput,
  EscalationRecord,
  EscalationWebhookEvent,
} from '@arena/escalation';
import { createNodeSecretHasher } from '@arena/developer-platform';
import type { SecretHasher, SecretMaterialGenerator } from '@arena/developer-platform';

/** Deterministic sequential material (test-only; NEVER production). */
export class SequentialMaterial implements SecretMaterialGenerator {
  private counter = 0;
  constructor(private readonly prefix = 'a1b2c3d4e5f6') {}
  /** Deterministic 32 bytes (64 lowercase hex chars): prefix + counter + padding. */
  bytes32Hex(): string {
    this.counter += 1;
    const suffix = String(this.counter).padStart(6, '0');
    return `${this.prefix}${suffix}${'0'.repeat(64 - this.prefix.length - suffix.length)}`;
  }
}

/** Deterministic hasher for tests (same sha256 algorithm as production). */
export const deterministicHasher: SecretHasher = createNodeSecretHasher();

import { FixedClock, InMemoryDeveloperKeyStore } from './fabric.js';
import type { EscalationPort, WebhookEventView } from './ports.js';
import { DeveloperPlatformService } from './service.js';

/** A deterministic fake of the C001 seam over the real escalation domain. */
export class FakeEscalationPort implements EscalationPort {
  readonly records: EscalationRecord[] = [];
  readonly webhookEvents: { event: EscalationWebhookEvent; at: number }[] = [];

  async createEscalation(input: CreateEscalationRequestInput): Promise<{
    requestId: string;
    record: EscalationRecord;
    emittedEvents: readonly EscalationWebhookEvent[];
  }> {
    const request = await createEscalationRequest(input as never);
    const nowMs = Date.parse(request.createdAt);
    let record = createEscalationRecord(request, nowMs);
    this.records.push(record);
    const emitted: EscalationWebhookEvent[] = [];
    const createdEvent = this.projectEvent(record, nowMs);
    emitted.push(createdEvent);
    this.webhookEvents.push({ event: createdEvent, at: nowMs });
    // Reference-flow drive (mirrors the C001 service): triage → matching.
    record = applyEscalationTransition(record, 'triaged', { now: nowMs });
    this.records[this.records.length - 1] = record;
    const triagedEvent = this.projectEvent(record, nowMs);
    emitted.push(triagedEvent);
    this.webhookEvents.push({ event: triagedEvent, at: nowMs });
    return { requestId: request.requestId, record, emittedEvents: emitted };
  }

  async getEscalationStatus(params: {
    requestId: string;
    tenantId: string;
  }): Promise<{ record: EscalationRecord }> {
    const record = this.records.find(
      (candidate) =>
        candidate.request.requestId === params.requestId &&
        candidate.request.tenantId === params.tenantId,
    );
    if (record === undefined) {
      throw new Error(`escalation ${params.requestId} not found for tenant ${params.tenantId}`);
    }
    return { record };
  }

  async listRecentEscalations(tenantId: string): Promise<readonly EscalationRecord[]> {
    return this.records.filter((record) => record.request.tenantId === tenantId);
  }

  async listRecentWebhookEvents(tenantId: string): Promise<readonly WebhookEventView[]> {
    return this.webhookEvents
      .filter(({ event }) => event.tenantId === tenantId)
      .map(({ event, at }, index) => ({
        eventId: event.eventId,
        eventType: event.eventType,
        requestId: event.requestId,
        tenantId: event.tenantId,
        sequence: index + 1,
        createdAt: at,
      }));
  }

  private projectEvent(record: EscalationRecord, at: number): EscalationWebhookEvent {
    const eventType = lifecycleEventForState(record.state);
    if (eventType === null) {
      throw new Error(`state ${record.state} has no webhook projection`);
    }
    return {
      eventVersion: 1,
      eventId: `evt_${record.request.requestId.slice(4)}${record.history.length
        .toString(16)
        .padStart(2, '0')}` as never,
      eventType,
      requestId: record.request.requestId,
      tenantId: record.request.tenantId,
      correlationId: record.request.correlationId,
      sequence: record.history.length,
      occurredAt: record.updatedAt,
      state: record.state,
      data: { state: record.state },
    };
  }
}

export interface ServiceFabric {
  readonly service: DeveloperPlatformService;
  readonly clock: FixedClock;
  readonly escalation: FakeEscalationPort;
  readonly hasher: SecretHasher;
  readonly material: SecretMaterialGenerator;
}

/** A fresh service on the reference fabric with a fixed clock. */
export function referenceService(
  atMs = Date.parse('2026-10-07T12:00:00.000Z'),
): ServiceFabric {
  const clock = new FixedClock(atMs);
  const escalation = new FakeEscalationPort();
  const service = new DeveloperPlatformService({
    clock,
    store: new InMemoryDeveloperKeyStore(),
    escalation,
    hasher: deterministicHasher,
    material: new SequentialMaterial(),
  });
  return { service, clock, escalation, hasher: deterministicHasher, material: new SequentialMaterial() };
}

/** Register an app + issue a key in one step (the happy-path fixture). */
export async function registeredAppWithKey(
  fabric: ServiceFabric,
  options: {
    readonly tenantId?: string;
    readonly environment?: 'live' | 'sandbox';
    readonly scopes?: readonly string[];
  } = {},
): Promise<{ clientAppId: string; keyId: string; secret: string }> {
  const tenantId = options.tenantId ?? 'tenant-alpha';
  const environment = options.environment ?? 'live';
  const app = await fabric.service.registerClientApp({
    tenantId,
    displayName: 'Epoch — AI build planning',
    environment,
  });
  const issuance = await fabric.service.issueKey({
    tenantId,
    clientAppId: app.clientAppId,
    environment,
    scopes:
      options.scopes ??
      (environment === 'live'
        ? ['escalations:create', 'escalations:read', 'observability:read']
        : ['sandbox:run', 'escalations:read', 'observability:read']),
    label: `${environment} key`,
  });
  return { clientAppId: app.clientAppId, keyId: issuance.record.keyId, secret: issuance.secret };
}

/** A valid ES1.0 create input for LIVE escalation tests. */
export function validLiveEscalationInput(
  tenantId: string,
  clientAppId: string,
  now: number,
): Record<string, unknown> {
  return {
    clientAppId,
    tenantId,
    sourceWorkflowRef: 'workflow-42',
    sourceRunRef: 'run-2026-10-07-001',
    capabilityNeed: 'boq-estimation.quantity-takeoff',
    escalationModes: ['solve'],
    urgency: 'priority',
    now,
    deadlineInMs: 3_600_000,
    budget: { amountMinorUnits: 25_000, currency: 'USD' },
    expertRequirements: { requiredCapabilities: ['boq-estimation.quantity-takeoff'] },
    locale: 'en',
    desiredOutputSchema: { type: 'object' },
    contextReferences: [],
    environmentSessionPolicy: { sessionMode: 'bounded-replica', sanitization: 'strict' },
    privacyPolicy: { dataClassification: 'confidential', pii: 'redact' },
    permittedActions: ['read-context', 'propose-patch'],
    learningPermissions: {
      allowKnowledgeCapture: true,
      allowToolGapSignals: true,
      allowArtifactReuse: false,
      requireApproval: true,
    },
    retentionPolicy: { retentionMs: 2_592_000_000, disposition: 'purge' },
    idempotencyKey: 'idem-0001',
    correlationId: 'corr-0001',
  };
}
