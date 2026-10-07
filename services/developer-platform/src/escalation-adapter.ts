/**
 * The HOST-SIDE adapter from the C001 escalation-api reference service
 * onto the developer-platform EscalationPort (Work Order C017).
 *
 * This module declares the structural compatibility ONLY through the
 * port's own shape and the @arena/escalation DOMAIN types — it imports
 * NO other service (boundary rule B2); hosts pass an
 * already-constructed escalation-api service instance (structurally
 * satisfying the parameter shape). It lives in the SERVICE package as
 * the documented wiring seam hosts import or copy.
 */

import type { EscalationRecord, EscalationWebhookEvent } from '@arena/escalation';

import type { EscalationPort, WebhookEventView } from './ports.js';

/** The structural shape of services/escalation-api's EscalationApiService that the port needs. */
export interface EscalationApiServiceShape {
  createEscalation(input: unknown): Promise<{
    requestId: string;
    record: EscalationRecord;
    emittedEvents: readonly EscalationWebhookEvent[];
  }>;
  getEscalationStatus(params: {
    requestId: string;
    tenantId: string;
  }): Promise<{ record: EscalationRecord }>;
  readonly store: {
    list(): Promise<readonly EscalationRecord[]>;
  };
  readonly outbox: {
    listAll(): Promise<
      readonly {
        eventId: string;
        requestId: string;
        tenantId: string;
        sequence: number;
        createdAt: number;
        payload: string;
      }[]
    >;
  };
}

/**
 * Adapt an escalation-api service instance onto the developer-platform
 * EscalationPort. Webhook event views are PROJECTIONS of the durable
 * outbox rows (the serialized event envelope carries the eventType).
 */
export function adaptEscalationApiService(api: EscalationApiServiceShape): EscalationPort {
  return {
    async createEscalation(input) {
      const outcome = await api.createEscalation(input);
      return {
        requestId: outcome.requestId,
        record: outcome.record,
        emittedEvents: outcome.emittedEvents,
      };
    },
    async getEscalationStatus(params) {
      const outcome = await api.getEscalationStatus(params);
      return { record: outcome.record };
    },
    async listRecentEscalations(tenantId: string) {
      const records = await api.store.list();
      return records.filter((record) => record.request.tenantId === tenantId);
    },
    async listRecentWebhookEvents(tenantId: string) {
      const deliveries = await api.outbox.listAll();
      const views: WebhookEventView[] = [];
      for (const delivery of deliveries) {
        if (delivery.tenantId !== tenantId) continue;
        let eventType = 'escalation.progressed';
        try {
          const parsed = JSON.parse(delivery.payload) as { eventType?: unknown };
          if (typeof parsed.eventType === 'string') eventType = parsed.eventType;
        } catch {
          // The payload is the durable serialized envelope; a parse
          // failure surfaces the conservative default projection.
        }
        views.push({
          eventId: delivery.eventId,
          eventType,
          requestId: delivery.requestId,
          tenantId: delivery.tenantId,
          sequence: delivery.sequence,
          createdAt: delivery.createdAt,
        });
      }
      return views;
    },
  };
}
