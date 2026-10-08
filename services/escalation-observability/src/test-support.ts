/**
 * Fakes for the five dep source ports of the escalation-observability
 * reference service (Work Order C021; issue #127). Tests inject these;
 * the real fabrics implement the port interfaces.
 */

import { createEscalationWebhookEvent } from '@arena/escalation';
import type { EscalationWebhookEvent } from '@arena/escalation';

import type {
  EngagementSlaSourceData,
  EscalationObservabilitySourcePorts,
  EscalationRequestSubjectData,
} from './ports.js';

export interface FakeEventSpec {
  readonly eventType: string;
  readonly requestId: string;
  readonly tenant: string;
  readonly sequence: number;
  readonly at: string;
  readonly state?: Parameters<typeof createEscalationWebhookEvent>[0]['state'];
  readonly data?: Parameters<typeof createEscalationWebhookEvent>[0]['data'];
}

export interface FakeEngagementSpec extends EngagementSlaSourceData {
  readonly tenant: string;
  readonly requestId: string;
}

export interface FakeRequestSubjectSpec extends EscalationRequestSubjectData {
  readonly tenant: string;
}

/** Build a C001 webhook event for a fake event port. */
export function fakeEvent(spec: FakeEventSpec): EscalationWebhookEvent {
  return createEscalationWebhookEvent({
    eventType: spec.eventType,
    request: {
      requestId: spec.requestId,
      tenantId: spec.tenant,
      correlationId: `corr-${spec.requestId}`,
    } as unknown as Parameters<typeof createEscalationWebhookEvent>[0]['request'],
    sequence: spec.sequence,
    now: spec.at,
    ...(spec.state !== undefined && spec.state !== null ? { state: spec.state } : {}),
    ...(spec.data !== undefined ? { data: spec.data } : {}),
  });
}

/** The in-memory fake of the full port set. */
export class FakeSourcePorts implements EscalationObservabilitySourcePorts {
  readonly events: {
    listEscalationEvents(lookup: {
      readonly tenant: string;
      readonly requestId?: string;
    }): Promise<readonly EscalationWebhookEvent[]>;
  };
  readonly requests: {
    resolveRequestSubject(lookup: {
      readonly tenant: string;
      readonly requestId: string;
    }): Promise<EscalationRequestSubjectData | null>;
  };
  readonly engagement: {
    resolveEngagementSla(lookup: {
      readonly tenant: string;
      readonly requestId: string;
    }): Promise<EngagementSlaSourceData | null>;
  };
  readonly payments: {
    resolvePaymentState(lookup: {
      readonly tenant: string;
      readonly requestId: string;
    }): Promise<{ readonly paymentState: string } | null>;
  };
  readonly routing: {
    resolveRoutingDecision(lookup: {
      readonly tenant: string;
      readonly requestId: string;
    }): Promise<{ readonly resourceClass: string; readonly capability: string } | null>;
  };

  private readonly eventList: EscalationWebhookEvent[] = [];
  private readonly subjects = new Map<string, EscalationRequestSubjectData>();
  private readonly engagements = new Map<string, EngagementSlaSourceData>();
  private readonly paymentStates = new Map<string, string>();
  private readonly routingDecisions = new Map<
    string,
    { resourceClass: string; capability: string }
  >();

  constructor(
    specs: {
      readonly events?: readonly FakeEventSpec[];
      readonly subjects?: readonly FakeRequestSubjectSpec[];
      readonly engagements?: readonly FakeEngagementSpec[];
      readonly payments?: readonly { tenant: string; requestId: string; paymentState: string }[];
      readonly routing?: readonly {
        tenant: string;
        requestId: string;
        resourceClass: string;
        capability: string;
      }[];
    } = {},
  ) {
    for (const spec of specs.events ?? []) this.eventList.push(fakeEvent(spec));
    for (const spec of specs.subjects ?? []) {
      this.subjects.set(`${spec.tenant}:${spec.requestId}`, {
        requestId: spec.requestId,
        clientAppId: spec.clientAppId,
        capabilityNeed: spec.capabilityNeed,
        urgency: spec.urgency,
        requestDeadline: spec.requestDeadline,
      });
    }
    for (const spec of specs.engagements ?? []) {
      this.engagements.set(`${spec.tenant}:${spec.requestId}`, {
        engagementId: spec.engagementId,
        urgency: spec.urgency,
        requestDeadline: spec.requestDeadline,
        offerIssuedAt: spec.offerIssuedAt,
        acceptedAt: spec.acceptedAt,
        activatedAt: spec.activatedAt,
        submittedAt: spec.submittedAt,
        validationVerdictAt: spec.validationVerdictAt,
      });
    }
    for (const spec of specs.payments ?? []) {
      this.paymentStates.set(`${spec.tenant}:${spec.requestId}`, spec.paymentState);
    }
    for (const spec of specs.routing ?? []) {
      this.routingDecisions.set(`${spec.tenant}:${spec.requestId}`, {
        resourceClass: spec.resourceClass,
        capability: spec.capability,
      });
    }

    this.events = {
      listEscalationEvents: async (lookup) => {
        if (lookup.requestId !== undefined) {
          return this.eventList.filter(
            (event) =>
              event.tenantId === lookup.tenant && event.requestId === lookup.requestId,
          );
        }
        return this.eventList.filter((event) => event.tenantId === lookup.tenant);
      },
    };
    this.requests = {
      resolveRequestSubject: async (lookup) =>
        this.subjects.get(`${lookup.tenant}:${lookup.requestId}`) ?? null,
    };
    this.engagement = {
      resolveEngagementSla: async (lookup) =>
        this.engagements.get(`${lookup.tenant}:${lookup.requestId}`) ?? null,
    };
    this.payments = {
      resolvePaymentState: async (lookup) => {
        const paymentState = this.paymentStates.get(
          `${lookup.tenant}:${lookup.requestId}`,
        );
        return paymentState === undefined ? null : { paymentState };
      },
    };
    this.routing = {
      resolveRoutingDecision: async (lookup) =>
        this.routingDecisions.get(`${lookup.tenant}:${lookup.requestId}`) ?? null,
    };
    Object.freeze(this);
  }
}

/** Convenience: build the full port set from specs. */
export function createFakeSourcePorts(specs: ConstructorParameters<typeof FakeSourcePorts>[0]) {
  return new FakeSourcePorts(specs);
}
