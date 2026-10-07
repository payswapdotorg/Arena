/**
 * @arena/expert-engagement-service — the C011 reference service
 * (in-memory append-only stores + injected C001/C002/C010 ports + durable
 * idempotent SLA-evaluation jobs on the A015 fabric seam, over the
 * @arena/expert-engagement domain).
 *
 * Public surface:
 *   - EscalationLifecyclePort / RoutingShortlistPort / CommercialOfferPort
 *     (ports.ts — the C001/C002/C010 seams);
 *   - EngagementStore / AvailabilityDeclarationStore / SlaBreachStore /
 *     SlaEvaluationJobPort (ports.ts — persistence + the A015 seam);
 *   - ExpertEngagementService / createExpertEngagementService (fabric.ts)
 *     — offer issue/accept/decline/expire/withdraw/replace/activate/
 *     complete wired to the C001 lifecycle and C002 shortlists through
 *     injected ports; availability declarations + the ES1.0 routing-input
 *     projection; SLA clock evaluation as a durable idempotent job;
 *   - in-memory fakes for every port (test-support.ts).
 */

export * from './ports.js';
export * from './fabric.js';
export * from './test-support.js';
