/**
 * @arena/escalation-observability-service — the C021 reference
 * read/projection service (in-process append-only store + injected dep
 * source ports over the @arena/escalation-observability domain).
 *
 * Public surface:
 *   - EscalationEventSourcePort / EscalationRequestSourcePort (C001) /
 *     EngagementSlaSourcePort (C011) / PaymentStateSourcePort (C010) /
 *     RoutingDecisionSourcePort (C015) (ports.ts — the dep seams);
 *   - EscalationObservabilityService (fabric.ts) — materializeTenantProjections
 *     (durable idempotent job, append-only) + correctMeasuredSlaRecord
 *     (supersession) + the ops query surface (timeline, summaries, SLA
 *     overview, SLO rollups, network health, cross-tenant aggregate
 *     view with small-sample suppression);
 *   - fakes for the five dep source ports (test-support.ts).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './test-support.js';
