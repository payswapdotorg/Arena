/**
 * The human-data reference service (Work Order C012; issue #118) — the
 * commission lifecycle as durable idempotent jobs on the reference fabric:
 *
 *   DRAFT → SUBMITTED → IN_PRODUCTION → ASSEMBLING → DELIVERED
 *   with ABANDONED and FAILED as explicit terminal states.
 *
 *   - submitCommission compiles the commission to ES1.0 EscalationRequests
 *     (the C001 public seam in @arena/human-data) and creates each through
 *     the injected EscalationPort. IDEMPOTENT: re-submitting a submitted
 *     commission REPLAYS the current record; the per-item idempotency keys
 *     are deterministic, so the C001 host replays the original escalations;
 *   - trackProduction projects the live escalation states feeding the
 *     commission (the studio dashboard's read model);
 *   - assembleCommission collects deliverable sources from the injected
 *     DeliverableSourcePort (C009-ACCEPTED outcomes + EES1.0 consent),
 *     derives the rights-gated deliverables, evaluates the commission's
 *     acceptance criteria through the C009 seam verdicts (the ratio of
 *     ACCEPTED items — never self-certified), assembles the versioned
 *     immutable dataset bundle over the A014 vocabulary and delivers it;
 *     below-threshold acceptance is the typed FAILED outcome (honest, not
 *     an error), and every wall (consent, tenant, validation gate, replay
 *     law, tamper) fails closed with the typed @arena/human-data errors;
 *   - every lifecycle step emits a commission.* event through the injected
 *     sink (idempotent consumer key = eventId).
 *
 * Fail-closed error discipline: unknown failures are normalized through
 * normalizeToHumanDataError; tenant mismatches are typed
 * HUMAN_DATA_CROSS_TENANT; nothing is ever silently swallowed.
 */

import { toIdempotencyKey } from '@arena/protocol-core';
import {
  HUMAN_DATA_ERROR_CODES,
  HumanDataError,
  advanceCommission,
  assembleHumanDataset,
  compileCommissionEscalations,
  createHumanDataCommission,
  deriveDeliverable,
  normalizeToHumanDataError,
  toIsoTimestamp,
} from '@arena/human-data';
import type {
  CreateHumanDataCommissionInput,
  DeliverableRecord,
  HumanDataCommission,
} from '@arena/human-data';
import type { DatasetManifest } from '@arena/datasets';
import type {
  Clock,
  CommissionStore,
  DeliverableSourcePort,
  EscalationPort,
  HumanDataEvent,
  HumanDataEventSink,
  HumanDataEventType,
} from './ports.js';

export interface HumanDataServiceConfig {
  readonly clock: Clock;
  readonly store: CommissionStore;
  readonly escalations: EscalationPort;
  readonly sources: DeliverableSourcePort;
  readonly events?: HumanDataEventSink;
}

/** One live escalation feeding a commission (the dashboard projection). */
export interface ProductionProjectionRow {
  readonly requestId: string;
  readonly state: string;
  readonly validationStatus?: string;
  readonly updatedAt: string;
}

export interface ProductionProjection {
  readonly commission: HumanDataCommission;
  readonly rows: readonly ProductionProjectionRow[];
  /** Escalations the port could not read (fail-closed, honestly surfaced). */
  readonly unreadable: readonly string[];
}

export type AssembleCommissionResult =
  | {
      readonly outcome: 'delivered';
      readonly commission: HumanDataCommission;
      /** The assembled manifest (null on idempotent replay — resolve via the bundleRef through the host's A014 resolver). */
      readonly manifest: DatasetManifest | null;
      readonly deliverables: readonly DeliverableRecord[];
    }
  | {
      readonly outcome: 'failed';
      readonly commission: HumanDataCommission;
      readonly acceptedCount: number;
      readonly quantity: number;
      readonly minAcceptedRatio: number;
    };

export class HumanDataService {
  private readonly clock: Clock;
  private readonly store: CommissionStore;
  private readonly escalations: EscalationPort;
  private readonly sources: DeliverableSourcePort;
  private readonly events: HumanDataEventSink | undefined;

  constructor(config: HumanDataServiceConfig) {
    this.clock = config.clock;
    this.store = config.store;
    this.escalations = config.escalations;
    this.sources = config.sources;
    this.events = config.events;
  }

  // -------------------------------------------------------------------------
  // DRAFT
  // -------------------------------------------------------------------------

  /** Create a DRAFT commission (persisted; the customer's declaration). */
  async createCommission(input: CreateHumanDataCommissionInput): Promise<HumanDataCommission> {
    const commission = await createHumanDataCommission(input);
    await this.store.insert(commission);
    await this.emit('commission.created', commission);
    return commission;
  }

  // -------------------------------------------------------------------------
  // SUBMITTED → IN_PRODUCTION
  // -------------------------------------------------------------------------

  /**
   * Submit a draft commission: compile + create every escalation through
   * the injected C001 port. IDEMPOTENT — a commission already past draft
   * replays its current record (the deterministic item keys make the C001
   * host replay the original escalations).
   */
  async submitCommission(params: {
    readonly commissionId: string;
    readonly tenantId: string;
  }): Promise<HumanDataCommission> {
    const commission = await this.requireCommission(params.commissionId, params.tenantId);
    if (commission.state === 'abandoned' || commission.state === 'failed') {
      // Terminal commissions never re-enter production (typed lifecycle).
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_STATE, {
        message: `commission ${commission.commissionId} is ${JSON.stringify(commission.state)} — a terminal commission cannot be submitted`,
        details: { state: commission.state },
      });
    }
    if (commission.state !== 'draft') {
      // Idempotent replay: the escalations were already created.
      return commission;
    }
    try {
      const compiled = await compileCommissionEscalations(commission, { now: this.clock.now() });
      const requestIds: string[] = [];
      for (const item of compiled) {
        // The C001 host deduplicates on the deterministic item key; the
        // returned request id is recorded whatever the host replayed.
        toIdempotencyKey(item.input.idempotencyKey);
        const created = await this.escalations.create(item.input);
        requestIds.push(created.requestId);
      }
      const submitted = await advanceCommission(commission, 'submitted', {
        submittedAt: toIsoTimestamp(this.clock.now()),
      });
      const inProduction = await advanceCommission(submitted, 'in_production', {
        escalationRequestIds: Object.freeze(requestIds),
      });
      await this.store.update(inProduction);
      await this.emit('commission.submitted', inProduction, {
        escalationRequestIds: Object.freeze([...requestIds]),
      });
      return inProduction;
    } catch (error) {
      throw normalizeToHumanDataError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Production tracking (the dashboard read model)
  // -------------------------------------------------------------------------

  /** Project the live escalation states feeding the commission (C001 reads). */
  async trackProduction(params: {
    readonly commissionId: string;
    readonly tenantId: string;
  }): Promise<ProductionProjection> {
    const commission = await this.requireCommission(params.commissionId, params.tenantId);
    const ids = commission.escalationRequestIds ?? [];
    const rows: ProductionProjectionRow[] = [];
    const unreadable: string[] = [];
    for (const requestId of ids) {
      const record = await this.escalations.get(requestId, commission.tenantId);
      if (record === undefined) {
        unreadable.push(requestId);
        continue;
      }
      rows.push(
        Object.freeze({
          requestId,
          state: record.state,
          ...(record.validationStatus !== undefined
            ? { validationStatus: record.validationStatus }
            : {}),
          updatedAt: record.updatedAt,
        }),
      );
    }
    return Object.freeze({
      commission,
      rows: Object.freeze(rows),
      unreadable: Object.freeze(unreadable),
    });
  }

  // -------------------------------------------------------------------------
  // ASSEMBLING → DELIVERED
  // -------------------------------------------------------------------------

  /**
   * Assemble (and deliver) the commissioned dataset: collect the C009
   * accepted sources, derive the rights-gated deliverables, evaluate the
   * acceptance criteria (ACCEPTED ratio ≥ minAcceptedRatio), assemble the
   * immutable bundle. Below-threshold acceptance is the typed FAILED
   * outcome (an honest terminal state, not an exception).
   */
  async assembleCommission(params: {
    readonly commissionId: string;
    readonly tenantId: string;
  }): Promise<AssembleCommissionResult> {
    let commission = await this.requireCommission(params.commissionId, params.tenantId);
    if (commission.state === 'delivered') {
      // Idempotent replay: the bundle was already delivered — the manifest
      // is resolved through the host's A014 resolver via the recorded
      // bundleRef (never fabricated here).
      return { outcome: 'delivered', commission, manifest: null, deliverables: [] };
    }
    if (commission.state !== 'in_production') {
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.INVALID_STATE, {
        message: `commission ${commission.commissionId} is ${JSON.stringify(commission.state)} — assembly requires in_production (the studio lifecycle is typed and closed)`,
        details: { state: commission.state },
      });
    }
    try {
      commission = await advanceCommission(commission, 'assembling');
      await this.store.update(commission);
      await this.emit('commission.assembling', commission);

      const ids = commission.escalationRequestIds ?? [];
      const deliverables: DeliverableRecord[] = [];
      let acceptedCount = 0;
      for (const requestId of ids) {
        const source = await this.sources.collect(requestId, commission.tenantId);
        if (source === undefined) continue; // not yet ACCEPTED — honestly uncounted
        acceptedCount += 1;
        deliverables.push(
          await deriveDeliverable({
            commission,
            result: source.result,
            adjudication: source.adjudication,
            consent: source.consent,
            ...(source.demonstrationTrace !== undefined
              ? { demonstrationTrace: source.demonstrationTrace }
              : {}),
            ...(source.originalSnapshot !== undefined
              ? { originalSnapshot: source.originalSnapshot }
              : {}),
            now: this.clock.now(),
          }),
        );
      }

      const ratio = commission.quantity === 0 ? 0 : acceptedCount / commission.quantity;
      if (deliverables.length === 0 || ratio < commission.acceptanceCriteria.minAcceptedRatio) {
        const failed = await advanceCommission(commission, 'failed');
        await this.store.update(failed);
        await this.emit('commission.failed', failed, {
          acceptedCount,
          quantity: commission.quantity,
          minAcceptedRatio: commission.acceptanceCriteria.minAcceptedRatio,
        });
        return {
          outcome: 'failed',
          commission: failed,
          acceptedCount,
          quantity: commission.quantity,
          minAcceptedRatio: commission.acceptanceCriteria.minAcceptedRatio,
        };
      }

      const assembly = await assembleHumanDataset({
        commission,
        deliverables,
        now: this.clock.now(),
      });
      const delivered = await advanceCommission(commission, 'delivered', {
        deliveredAt: toIsoTimestamp(this.clock.now()),
        bundleRef: Object.freeze({
          version: assembly.manifest.identity.version,
          manifestDigest: assembly.manifest.digest,
        }),
      });
      await this.store.update(delivered);
      await this.emit('commission.delivered', delivered, {
        bundleRef: delivered.bundleRef,
        deliverableCount: assembly.deliverableCount,
      });
      return {
        outcome: 'delivered',
        commission: delivered,
        manifest: assembly.manifest,
        deliverables: Object.freeze(deliverables),
      };
    } catch (error) {
      throw normalizeToHumanDataError(error);
    }
  }

  // -------------------------------------------------------------------------
  // Terminal + reads
  // -------------------------------------------------------------------------

  /** Abandon a commission (explicit terminal state; never from delivered). */
  async abandonCommission(params: {
    readonly commissionId: string;
    readonly tenantId: string;
  }): Promise<HumanDataCommission> {
    const commission = await this.requireCommission(params.commissionId, params.tenantId);
    const abandoned = await advanceCommission(commission, 'abandoned');
    await this.store.update(abandoned);
    await this.emit('commission.abandoned', abandoned);
    return abandoned;
  }

  /** Tenant-scoped read (cross-tenant reads fail closed with the typed error). */
  async getCommission(params: {
    readonly commissionId: string;
    readonly tenantId: string;
  }): Promise<HumanDataCommission> {
    return this.requireCommission(params.commissionId, params.tenantId);
  }

  /** The commissions of one tenant (possibly empty — never fabricated). */
  async listCommissions(tenantId: string): Promise<readonly HumanDataCommission[]> {
    return this.store.list(tenantId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async requireCommission(
    commissionId: string,
    tenantId: string,
  ): Promise<HumanDataCommission> {
    const stored = await this.store.get(commissionId, tenantId);
    if (stored === undefined) {
      // Fail closed: unknown OR cross-tenant — indistinguishable by design.
      throw new HumanDataError(HUMAN_DATA_ERROR_CODES.CROSS_TENANT, {
        message: `commission ${JSON.stringify(commissionId)} is not readable for tenant ${JSON.stringify(tenantId)} (unknown or cross-tenant — customer data is never used across tenants)`,
        details: { commissionId, tenantId },
      });
    }
    return stored;
  }

  private async emit(
    eventType: HumanDataEventType,
    commission: HumanDataCommission,
    data?: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (this.events === undefined) return;
    const event: HumanDataEvent = Object.freeze({
      eventVersion: 1,
      eventId: `hdev_${commission.commissionId}_${eventType}`,
      eventType,
      commissionId: commission.commissionId,
      tenantId: commission.tenantId,
      state: commission.state,
      occurredAt: toIsoTimestamp(this.clock.now()),
      ...(data !== undefined ? { data } : {}),
    });
    await this.events.emit(event);
  }
}
