/**
 * @arena/escalation-routing-service — the Arena escalation routing
 * reference service (Work Order C002; issue #76).
 *
 * Public surface:
 *   - ports.ts   — Clock, RoutingCandidateDirectory, CapabilityGraphSource,
 *                  RoutingDecisionLog + the C001 routing-seam decision types;
 *   - jobs.ts    — durable routing jobs over the A015 submission identity;
 *   - fabric.ts  — in-memory reference implementations (FixedClock, static
 *                  sources, decision log, job store);
 *   - service.ts — EscalationRoutingService (the RoutingPort replacement).
 */

export * from './ports.js';
export * from './jobs.js';
export * from './fabric.js';
export * from './service.js';
