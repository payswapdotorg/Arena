/**
 * @arena/escalation-routing — the capability-demand compiler and expert
 * routing engine (Work Order C002; issue #76; spec/expert-escalation-api.md
 * ES1.0 "Routing").
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests — never
 * reimplemented), @arena/capability-graph (A004 taxonomy queries) and
 * @arena/expert-qualification (A007 shared view types). Zero service
 * imports, zero model/provider surface (lock rule 10).
 *
 * Core objects:
 *   - DemandProfile — the versioned, content-addressed compilation of an
 *     escalation request's capability need over the A004 graph (typed
 *     closed outcomes: compilable / under-specified-with-reasons /
 *     not-derivable — never a bare boolean);
 *   - RoutingCandidate — the routing-side expert view (qualification
 *     entries are DATA, INPUT to ranking — NEVER an access grant, lock
 *     rule 9);
 *   - RoutingVerdict — the deterministic, content-addressed routing
 *     decision with the closed outcome vocabulary (matched / no-match /
 *     blocked-by-COI / blocked-by-privacy / budget-infeasible /
 *     deadline-infeasible / locale-uncovered) and per-candidate
 *     machine-readable elimination causes;
 *   - RoutingDecisionRecord — the append-only, digest-chained decision
 *     history per escalation (supersession by append — the house
 *     pattern).
 */

export * from './errors.js';
export * from './demand-profile.js';
export * from './candidate.js';
export * from './engine.js';
export * from './history.js';

import { ESCALATION_ROUTING_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const ESCALATION_ROUTING_VERSION = 1 as const;

/** The escalation-routing error codes this build understands. */
export const SUPPORTED_ESCALATION_ROUTING_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(ESCALATION_ROUTING_ERROR_CODES),
);
