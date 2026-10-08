/**
 * Deterministic demo corpus for the escalation-ops surface (Work Order
 * C021; apps/web/src/escalation-ops). Built from the REAL domain
 * package + reference service over a fixed clock — visibly labelled
 * per the demo labelling contract (demo state is never customer state).
 */

import { EscalationObservabilityService } from '../../../../services/escalation-observability/src/index.js';
import { FakeSourcePorts } from '../../../../services/escalation-observability/src/index.js';
import type { ProjectionJobLogEntry } from '../../../../services/escalation-observability/src/index.js';

/** The fixed demo epoch (deterministic — no wall clock). */
export const ESCALATION_OPS_DEMO_EPOCH_MS = Date.parse('2026-10-01T13:00:00.000Z');
export const ESCALATION_OPS_DEMO_TENANT = 'demo-tenant';

const T = (minutes: number) =>
  new Date(ESCALATION_OPS_DEMO_EPOCH_MS - (120 - minutes) * 60_000).toISOString();

/**
 * Build the deterministic escalation-ops demo runtime: the REAL
 * projection service over the reference fabric with a fixed corpus
 * (two completed escalations with distinct urgency + one breached
 * escalation) and a fixed projection time.
 */
export function buildDemoEscalationOpsRuntime(): {
  readonly service: EscalationObservabilityService;
  readonly at: string;
} {
  const R1 = 'esc_' + '1'.repeat(32);
  const R2 = 'esc_' + '2'.repeat(32);
  const R3 = 'esc_' + '3'.repeat(32);
  const ports = new FakeSourcePorts({
    events: [
      // R1: a happy urgent escalation — all four SLA clocks met.
      { eventType: 'escalation.created', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 1, at: T(0), state: 'created' },
      { eventType: 'escalation.matched', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 2, at: T(10), state: 'offered' },
      { eventType: 'escalation.accepted', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 3, at: T(20), state: 'accepted' },
      { eventType: 'escalation.session.ready', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 4, at: T(25), state: 'session_ready' },
      { eventType: 'escalation.started', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 5, at: T(30), state: 'in_progress' },
      {
        eventType: 'escalation.submitted',
        requestId: R1,
        tenant: ESCALATION_OPS_DEMO_TENANT,
        sequence: 6,
        at: T(60),
        state: 'submitted',
        data: { resultKind: 'Correction', summary: 'demo correction artifact', producedAt: T(60) },
      },
      {
        eventType: 'escalation.validation.updated',
        requestId: R1,
        tenant: ESCALATION_OPS_DEMO_TENANT,
        sequence: 7,
        at: T(70),
        state: 'validating',
        data: { validationStatus: 'pending' },
      },
      {
        eventType: 'escalation.validation.updated',
        requestId: R1,
        tenant: ESCALATION_OPS_DEMO_TENANT,
        sequence: 8,
        at: T(80),
        state: 'result_accepted',
        data: { validationStatus: 'passed' },
      },
      {
        eventType: 'escalation.payment.updated',
        requestId: R1,
        tenant: ESCALATION_OPS_DEMO_TENANT,
        sequence: 9,
        at: T(95),
        state: 'paid',
        data: { paymentState: 'settled', payoutStatus: 'paid' },
      },
      { eventType: 'escalation.completed', requestId: R1, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 10, at: T(110), state: 'closed' },
      // R2: a routine escalation with an expert replacement.
      { eventType: 'escalation.created', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 1, at: T(0), state: 'created' },
      { eventType: 'escalation.matched', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 2, at: T(25), state: 'offered' },
      { eventType: 'escalation.progressed', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 3, at: T(40), state: 'expert_replaced' },
      { eventType: 'escalation.matched', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 4, at: T(55), state: 'offered' },
      { eventType: 'escalation.accepted', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 5, at: T(65), state: 'accepted' },
      { eventType: 'escalation.session.ready', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 6, at: T(70), state: 'session_ready' },
      { eventType: 'escalation.started', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 7, at: T(75), state: 'in_progress' },
      { eventType: 'escalation.submitted', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 8, at: T(95), state: 'submitted' },
      {
        eventType: 'escalation.validation.updated',
        requestId: R2,
        tenant: ESCALATION_OPS_DEMO_TENANT,
        sequence: 9,
        at: T(100),
        state: 'result_accepted',
        data: { validationStatus: 'passed' },
      },
      { eventType: 'escalation.completed', requestId: R2, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 10, at: T(115), state: 'closed' },
      // R3: a critical escalation that timed out unaccepted (breach).
      { eventType: 'escalation.created', requestId: R3, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 1, at: T(0), state: 'created' },
      { eventType: 'escalation.matched', requestId: R3, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 2, at: T(5), state: 'offered' },
      { eventType: 'escalation.failed', requestId: R3, tenant: ESCALATION_OPS_DEMO_TENANT, sequence: 3, at: T(120), state: 'timed_out' },
    ],
    subjects: [
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R1,
        clientAppId: 'demo-app-alpha',
        capabilityNeed: 'sql-analysis',
        urgency: 'urgent',
        requestDeadline: '2026-10-02T09:00:00.000Z',
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R2,
        clientAppId: 'demo-app-beta',
        capabilityNeed: 'sql-analysis',
        urgency: 'routine',
        requestDeadline: '2026-10-03T09:00:00.000Z',
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R3,
        clientAppId: 'demo-app-alpha',
        capabilityNeed: 'pdf-forensics',
        urgency: 'critical',
        requestDeadline: '2026-10-01T12:00:00.000Z',
      },
    ],
    engagements: [
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R1,
        engagementId: 'eng-demo-1',
        urgency: 'urgent',
        requestDeadline: '2026-10-02T09:00:00.000Z',
        offerIssuedAt: T(10),
        acceptedAt: T(20),
        activatedAt: T(30),
        submittedAt: T(60),
        validationVerdictAt: T(80),
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R2,
        engagementId: 'eng-demo-2',
        urgency: 'routine',
        requestDeadline: '2026-10-03T09:00:00.000Z',
        offerIssuedAt: T(25),
        acceptedAt: T(65),
        activatedAt: T(75),
        submittedAt: T(95),
        validationVerdictAt: T(100),
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R3,
        engagementId: 'eng-demo-3',
        urgency: 'critical',
        requestDeadline: '2026-10-01T12:00:00.000Z',
        offerIssuedAt: T(5),
        acceptedAt: null,
        activatedAt: null,
        submittedAt: null,
        validationVerdictAt: null,
      },
    ],
    routing: [
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R1,
        resourceClass: 'expert-human',
        capability: 'sql-analysis',
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R2,
        resourceClass: 'expert-human',
        capability: 'sql-analysis',
      },
      {
        tenant: ESCALATION_OPS_DEMO_TENANT,
        requestId: R3,
        resourceClass: 'expert-human',
        capability: 'pdf-forensics',
      },
    ],
  });
  const service = new EscalationObservabilityService(ports);
  const at = new Date(ESCALATION_OPS_DEMO_EPOCH_MS).toISOString();
  return { service, at };
}

/** The deterministic demo materialization job (idempotent key). */
export const DEMO_MATERIALIZATION_KEY = 'demo-escalation-ops-materialize';

export type { ProjectionJobLogEntry };
