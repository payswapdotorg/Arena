/**
 * The injected PORTS of the escalation-observability reference service
 * (Work Order C021; issue #127; spec/service-boundaries.md).
 *
 * The service NEVER writes into another surface's state: every input
 * arrives by RESOLVING records through the PUBLIC read ports declared
 * here — the C001 escalation event stream, the C011 engagement SLA
 * clocks, the C010 payment-state refs and the C015 routing decisions.
 * The ports are data-in seams; the real fabrics implement them, tests
 * inject fakes (test-support.ts).
 *
 * PROJECTION DISCIPLINE: a resolve call returns dep record data ONLY
 * when it exists AND belongs to the requested tenant — a fabricated or
 * cross-tenant lookup resolves to null and the materialization fails
 * closed. Observability data is DATA, never an access grant (lock
 * rules 9/35): there is deliberately NO port method that grants,
 * implies or records a permission.
 */

import type { EscalationWebhookEvent } from '@arena/escalation';

/** The C001 seam: the escalation webhook event stream (public read). */
export interface EscalationEventSourcePort {
  /** All events of one tenant (optionally narrowed to one escalation). */
  listEscalationEvents(lookup: {
    readonly tenant: string;
    readonly requestId?: string;
  }): Promise<readonly EscalationWebhookEvent[]>;
}

/** The C001 request-subject data the timeline projection carries. */
export interface EscalationRequestSubjectData {
  readonly requestId: string;
  readonly clientAppId: string | null;
  readonly capabilityNeed: string | null;
  readonly urgency: string | null;
  readonly requestDeadline: string | null;
}

/** The C001 seam: the escalation request subject fields. */
export interface EscalationRequestSourcePort {
  resolveRequestSubject(lookup: {
    readonly tenant: string;
    readonly requestId: string;
  }): Promise<EscalationRequestSubjectData | null>;
}

/** The C011 seam: the engagement SLA clock inputs + milestones. */
export interface EngagementSlaSourceData {
  readonly engagementId: string;
  readonly urgency: string;
  readonly requestDeadline: string;
  readonly offerIssuedAt: string;
  readonly acceptedAt: string | null;
  readonly activatedAt: string | null;
  readonly submittedAt: string | null;
  readonly validationVerdictAt: string | null;
}

/** The C011 seam: engagement records + SLA milestones (public read). */
export interface EngagementSlaSourcePort {
  resolveEngagementSla(lookup: {
    readonly tenant: string;
    readonly requestId: string;
  }): Promise<EngagementSlaSourceData | null>;
}

/** The C010 seam: payment-state refs (opaque refs — C010 owns money truth). */
export interface PaymentStateSourcePort {
  resolvePaymentState(lookup: {
    readonly tenant: string;
    readonly requestId: string;
  }): Promise<{ readonly paymentState: string } | null>;
}

/** The C015 seam: routing decisions feeding per-resource-class rollups. */
export interface RoutingDecisionSourcePort {
  resolveRoutingDecision(lookup: {
    readonly tenant: string;
    readonly requestId: string;
  }): Promise<{ readonly resourceClass: string; readonly capability: string } | null>;
}

/** The full injected source-port set (one per merged dep surface). */
export interface EscalationObservabilitySourcePorts {
  readonly events: EscalationEventSourcePort;
  readonly requests: EscalationRequestSourcePort;
  readonly engagement: EngagementSlaSourcePort;
  readonly payments: PaymentStateSourcePort;
  readonly routing: RoutingDecisionSourcePort;
}
