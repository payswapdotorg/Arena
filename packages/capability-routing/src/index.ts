/**
 * @arena/capability-routing — the cross-resource capability-demand
 * compiler and ResourceMatch composition engine (Work Order C015;
 * issue #121; spec/human-escalation-work-items.md C015 row; spec/
 * expert-escalation-api.md ES1.0 "Routing" generalized beyond experts).
 *
 * Pure TypeScript; runtime dependencies are the merged domain packages
 * @arena/protocol-core (canonical JSON + sha256 digests — never
 * reimplemented), @arena/capability-graph (A004 taxonomy queries) and
 * @arena/escalation-routing (the C002 DemandProfile compiler + expert
 * routing engine — composed, never forked: the expert facet is
 * DELEGATED to compileDemandProfile/routeEscalation). Zero service
 * imports, zero model/provider surface (lock rule 10).
 *
 * Core objects:
 *   - CrossResourceDemand — the versioned, content-addressed
 *     generalization of the C002 DemandProfile across the five resource
 *     classes (expert / body / tool / knowledge / artifact), with typed
 *     closed outcomes (compilable / under-specified-with-reasons /
 *     not-derivable — never a bare boolean);
 *   - RESOLUTION_POLICY — the versioned escalation-mode → resource-class
 *     mapping (TOOL_GAP → tool+artifact; KNOWLEDGE → knowledge;
 *     SOLVE/CORRECT/UNBLOCK/REVIEW/TEACH → expert+body; EVALUATE →
 *     artifact+expert) — no silent coercion between classes, ever;
 *   - catalog candidate views — the routing-side DATA views per class
 *     (expert: C002 candidate + C005 performance-profile digest; body:
 *     C014 listing state/substrate/pricing; tool: C008 availability;
 *     knowledge: C008 tier/scope/rights; artifact: A032 offer state +
 *     entitlement) — qualification/performance evidence is INPUT to
 *     ranking, NEVER an access grant (lock rules 9/35);
 *   - ResourceMatch — the deterministic, content-addressed cross-resource
 *     verdict with the closed outcome vocabulary (matched / no-match /
 *     blocked-by-coi / blocked-by-privacy / budget-infeasible /
 *     deadline-infeasible / incompatible-substrate / class-not-allowed)
 *     and TYPED COMPOSITIONS across classes (fail-closed on over-cap
 *     composition budgets);
 *   - ResourceDecisionRecord — the append-only, digest-chained decision
 *     history per demand (supersession by append — the house pattern).
 *
 * The reference SERVICE (injected catalog ports + durable idempotent
 * routing jobs on the A015 fabric) lives in services/capability-routing
 * (@arena/capability-routing-service).
 */

export * from './errors.js';
export * from './policy.js';
export * from './demand.js';
export * from './catalog.js';
export * from './engine.js';
export * from './history.js';

import { CAPABILITY_ROUTING_ERROR_CODES } from './errors.js';

/** Version of this package's protocol surface. */
export const CAPABILITY_ROUTING_VERSION = 1 as const;

/** The capability-routing error codes this build understands. */
export const SUPPORTED_CAPABILITY_ROUTING_ERROR_CODES: readonly string[] = Object.freeze(
  Object.values(CAPABILITY_ROUTING_ERROR_CODES),
);
