/**
 * Escalation-routing service ports (Work Order C002) — the ONLY things
 * services/escalation-routing depends on besides the domain packages
 * (@arena/escalation, @arena/escalation-routing, @arena/capability-graph,
 * @arena/job-protocol, @arena/protocol-core). Mirroring the sibling
 * services' ports.ts discipline (services/escalation-api, services/
 * job-orchestrator): injected dependencies, no wall-clock reads, no
 * service-to-service imports (boundary rule B2 — hosts wire the real
 * read surfaces; the reference fabric wires in-memory ones).
 *
 *   - Clock        — time is INJECTED (architecture-lock rule 17);
 *   - RoutingCandidateDirectory — the A006/A007 read surface the engine
 *                   routes over (hosts assemble RoutingCandidate views
 *                   from expert-registry profiles + expert-qualification
 *                   records; this service never imports a service);
 *   - CapabilityGraphSource — the A004 capability graph source;
 *   - RoutingDecisionLog — the append-only per-escalation decision
 *                   history persistence port.
 *
 * THE C001 ROUTING SEAM (services/escalation-api RoutingPort): this
 * service implements it STRUCTURALLY. The port types are mirrored here
 * (closed vocabularies byte-equal to C001's) because a service may not
 * import another service (B2) — hoisting the port into packages/
 * escalation is recorded as an architecture question in the PR.
 */

import type { CapabilityGraph } from '@arena/capability-graph';
import type { RoutingCandidate, RoutingDecisionRecord } from '@arena/escalation-routing';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** The A006/A007 expert read surface (host-wired; tenant-scoped). */
export interface RoutingCandidateDirectory {
  /**
   * List routing candidates for one tenant. HOST CONTRACT: the directory
   * must only return experts of the tenant or the reserved global
   * `public` scope (lock rule 11). The ENGINE double-guards this — a
   * cross-tenant candidate is ELIMINATED ('cross-tenant'), never routed
   * (defense in depth against a misconfigured host).
   */
  listRoutingCandidates(tenantId: string): Promise<readonly RoutingCandidate[]>;
}

/** The A004 capability graph source (host-wired). */
export interface CapabilityGraphSource {
  load(): Promise<CapabilityGraph>;
}

/** Persistence port for the append-only routing decision history. records keyed by (requestId). */
export interface RoutingDecisionLog {
  /** Append one decision record; throws on duplicate digest. */
  append(record: RoutingDecisionRecord): Promise<void>;
  /** The decision history of one escalation, in append order. */
  list(requestId: string, tenantId: string): Promise<readonly RoutingDecisionRecord[]>;
}

/**
 * The C001 routing-seam decision vocabulary (byte-equal mirror of
 * services/escalation-api's RoutingPort types — the closed no-match
 * reason list and the matched/no-match union).
 */
export const ROUTING_NO_MATCH_REASONS = Object.freeze([
  'no-qualified-expert',
  'budget-below-floor',
  'locale-uncovered',
  'routing-unavailable',
] as const);
export type RoutingNoMatchReason = (typeof ROUTING_NO_MATCH_REASONS)[number];

/** The C001 routing-seam decision (matched expert ref | typed no-match). */
export type RoutingDecision =
  | { readonly outcome: 'matched'; readonly expertRef: string }
  | { readonly outcome: 'no-match'; readonly reason: RoutingNoMatchReason };

/**
 * The C001 RoutingPort contract, mirrored structurally. An object with
 * `route(request: EscalationRecord): Promise<RoutingDecision>` satisfies
 * it — EscalationRoutingService does, so a host can inject this service
 * wherever the escalation-api accepts a RoutingPort.
 */
export interface RoutingPortLike {
  route(request: import('@arena/escalation').EscalationRecord): Promise<RoutingDecision>;
}
