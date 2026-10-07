/**
 * The human-data reference fabric (Work Order C012) — the in-process
 * wiring hosts and tests use to run the REAL service end-to-end
 * (the A015-era fabric conventions: reference stores are in-process Maps;
 * deployment-tier persistence is host-wired, never assumed here):
 *
 *   - FixedClock            — deterministic injected time;
 *   - InMemoryCommissionStore — tenant-scoped commission persistence;
 *   - ReferenceEscalationPort — THE C001 SEAM implementation: compiles are
 *     built through the C001 domain functions (createEscalationRequest +
 *     createEscalationRecord) and held in-process; idempotent per item key;
 *   - ScriptedDeliverableSource — THE C006/C009 SEAM implementation: the
 *     host scripts the accepted sources (results, adjudication outcomes,
 *     consent statements, replay traces) the service collects;
 *   - RecordingEventSink   — collects the commission.* events (assertions).
 */

import {
  createEscalationRecord,
  createEscalationRequest,
} from '@arena/escalation';
import type { CreateEscalationRequestInput, EscalationRecord } from '@arena/escalation';
import type { HumanDataCommission } from '@arena/human-data';
import type {
  AcceptedDeliverableSource,
  Clock,
  CommissionStore,
  DeliverableSourcePort,
  EscalationPort,
  HumanDataEvent,
  HumanDataEventSink,
} from './ports.js';

/** Deterministic injected time (never a wall-clock read). */
export class FixedClock implements Clock {
  private readonly atMs: number;

  constructor(atMs: number) {
    this.atMs = atMs;
  }

  now(): number {
    return this.atMs;
  }
}

/** In-memory tenant-scoped commission persistence (reference fabric). */
export class InMemoryCommissionStore implements CommissionStore {
  private readonly commissions = new Map<string, HumanDataCommission>();

  async insert(commission: HumanDataCommission): Promise<void> {
    if (this.commissions.has(commission.commissionId)) {
      throw new Error(`duplicate commission id: ${commission.commissionId}`);
    }
    this.commissions.set(commission.commissionId, commission);
  }

  async update(commission: HumanDataCommission): Promise<void> {
    this.commissions.set(commission.commissionId, commission);
  }

  async get(commissionId: string, tenantId: string): Promise<HumanDataCommission | undefined> {
    const stored = this.commissions.get(commissionId);
    if (stored === undefined || stored.tenantId !== tenantId) return undefined;
    return stored;
  }

  async list(tenantId: string): Promise<readonly HumanDataCommission[]> {
    return [...this.commissions.values()].filter((commission) => commission.tenantId === tenantId);
  }
}

/**
 * THE C001 SEAM (reference implementation): builds REAL escalation records
 * through the C001 domain functions and holds them in-process. Idempotent
 * per item idempotency key — a re-created input replays the original
 * request id (the C001 idempotency contract).
 */
export class ReferenceEscalationPort implements EscalationPort {
  private readonly records = new Map<string, EscalationRecord>();
  private readonly byIdempotencyKey = new Map<string, string>();

  async create(input: CreateEscalationRequestInput): Promise<{ readonly requestId: string }> {
    const replayed = this.byIdIdempotencyKey(input.idempotencyKey);
    if (replayed !== undefined) {
      return { requestId: replayed };
    }
    const request = await createEscalationRequest(input);
    const record = createEscalationRecord(request, input.now);
    this.records.set(request.requestId, record);
    this.byIdempotencyKey.set(input.idempotencyKey, request.requestId);
    return { requestId: request.requestId };
  }

  async get(requestId: string, tenantId: string): Promise<EscalationRecord | undefined> {
    const record = this.records.get(requestId);
    if (record === undefined || record.request.tenantId !== tenantId) return undefined;
    return record;
  }

  /** Test/demo seam: drive an escalation record to SUBMITTED (accepted sources follow). */
  async submitResult(
    requestId: string,
    result: EscalationRecord['result'],
  ): Promise<EscalationRecord | undefined> {
    const record = this.records.get(requestId);
    if (record === undefined || result === undefined) return undefined;
    const submitted: EscalationRecord = Object.freeze({
      ...record,
      state: 'submitted',
      result,
      validationStatus: 'passed',
      updatedAt: new Date(record.updatedAt).toISOString(),
    });
    this.records.set(requestId, submitted);
    return submitted;
  }

  private byIdIdempotencyKey(key: string): string | undefined {
    return this.byIdempotencyKey.get(key);
  }
}

/** THE C006/C009 SEAM (scripted by the host/demo/test). */
export class ScriptedDeliverableSource implements DeliverableSourcePort {
  private readonly sources = new Map<string, AcceptedDeliverableSource>();

  script(requestId: string, source: AcceptedDeliverableSource): void {
    this.sources.set(requestId, source);
  }

  async collect(requestId: string, tenantId: string): Promise<AcceptedDeliverableSource | undefined> {
    const source = this.sources.get(requestId);
    if (source === undefined) return undefined;
    if (source.adjudication.tenantId !== tenantId) return undefined;
    return source;
  }
}

/** Collects the commission.* events (assertions / observability). */
export class RecordingEventSink implements HumanDataEventSink {
  readonly events: HumanDataEvent[] = [];

  async emit(event: HumanDataEvent): Promise<void> {
    this.events.push(event);
  }
}

/** The wired reference fabric: every port on the REAL domain functions. */
export interface HumanDataReferenceFabric {
  readonly clock: FixedClock;
  readonly store: InMemoryCommissionStore;
  readonly escalations: ReferenceEscalationPort;
  readonly sources: ScriptedDeliverableSource;
  readonly events: RecordingEventSink;
}

export function createHumanDataReferenceFabric(atMs: number): HumanDataReferenceFabric {
  const clock = new FixedClock(atMs);
  const store = new InMemoryCommissionStore();
  const escalations = new ReferenceEscalationPort();
  const sources = new ScriptedDeliverableSource();
  const events = new RecordingEventSink();
  return Object.freeze({ clock, store, escalations, sources, events });
}
