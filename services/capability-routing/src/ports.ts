/**
 * Capability-routing service ports (Work Order C015) — the ONLY things
 * services/capability-routing depends on besides the domain packages
 * (@arena/capability-routing, @arena/capability-graph,
 * @arena/escalation-routing, @arena/job-protocol,
 * @arena/protocol-core). Mirroring the sibling services' ports.ts
 * discipline (services/escalation-routing, services/escalation-api):
 * injected dependencies, no wall-clock reads, no service-to-service
 * imports (boundary rule B2 — hosts wire the real read surfaces; the
 * reference fabric wires in-memory ones + structural-mirror adapters).
 *
 *   - Clock                      — time is INJECTED (lock rule 17);
 *   - CapabilityGraphSource      — the A004 graph source;
 *   - ExpertCandidateDirectory   — C002 RoutingCandidate views (+ C005
 *                                  performance-profile digests);
 *   - BodyListingCatalog         — C014 capability-body listing views;
 *   - ToolCandidateCatalog       — C008 tool-gap/tool-specification views;
 *   - KnowledgeRecordCatalog     — C008 knowledge-tier lattice views;
 *   - ArtifactOfferCatalog       — A032 marketplace offer + entitlement views;
 *   - ResourceDecisionLog        — the append-only per-demand history.
 *
 * HOST CONTRACT (every catalog): ports must only return candidates of
 * the demand tenant or the reserved global `public` scope (lock rule
 * 11). The ENGINE double-guards this — a cross-tenant candidate is
 * ELIMINATED ('cross-tenant'), never routed (defense in depth against
 * a misconfigured host).
 *
 * THE SEAM (C001/C002/C021 consumers): the service exposes
 * `routeCrossResource` as the capability-routing port; port contracts
 * of other surfaces are consumers — architecture questions, not edits.
 */

import type { CapabilityGraph } from '@arena/capability-graph';
import type {
  ArtifactCandidateView,
  BodyCandidateView,
  ExpertCandidateView,
  KnowledgeCandidateView,
  ResourceDecisionRecord,
  ToolCandidateView,
} from '@arena/capability-routing';

/** Injected time source (epoch milliseconds). */
export interface Clock {
  now(): number;
}

/** The A004 capability graph source (host-wired). */
export interface CapabilityGraphSource {
  load(): Promise<CapabilityGraph>;
}

/** The C002/C005 expert read surface (host-wired; tenant-scoped). */
export interface ExpertCandidateDirectory {
  listExpertCandidates(tenantId: string): Promise<readonly ExpertCandidateView[]>;
}

/** The C014 capability-body listing read surface (host-wired; tenant-scoped). */
export interface BodyListingCatalog {
  listBodyCandidates(tenantId: string): Promise<readonly BodyCandidateView[]>;
}

/** The C008 tool-gap / tool-specification read surface (host-wired; tenant-scoped). */
export interface ToolCandidateCatalog {
  listToolCandidates(tenantId: string): Promise<readonly ToolCandidateView[]>;
}

/** The C008 knowledge-tier read surface (host-wired; tenant-scoped). */
export interface KnowledgeRecordCatalog {
  listKnowledgeCandidates(tenantId: string): Promise<readonly KnowledgeCandidateView[]>;
}

/** The A032 marketplace offer read surface (host-wired; tenant-scoped). */
export interface ArtifactOfferCatalog {
  listArtifactCandidates(tenantId: string): Promise<readonly ArtifactCandidateView[]>;
}

/** Persistence port for the append-only routing decision history (keyed by demandId). */
export interface ResourceDecisionLog {
  /** Append one decision record; throws on duplicate digest. */
  append(record: ResourceDecisionRecord): Promise<void>;
  /** The decision history of one demand, in append order. */
  list(demandId: string, tenantId: string): Promise<readonly ResourceDecisionRecord[]>;
}

/**
 * The seam-compatible routing decision (closed vocabulary, mirrors the
 * C002 RoutingDecision shape): a matched composition summary or a typed
 * no-match reason. The FULL ResourceMatch verdict + per-candidate
 * causes are preserved in the append-only decision history — nothing is
 * lost at the seam.
 */
export const CAPABILITY_NO_MATCH_REASONS = Object.freeze([
  'no-capable-resource',
  'budget-below-floor',
  'class-not-allowed',
  'routing-unavailable',
] as const);
export type CapabilityNoMatchReason = (typeof CAPABILITY_NO_MATCH_REASONS)[number];

export type CapabilityRoutingDecision =
  | {
      readonly outcome: 'matched';
      /** class:ref pairs of the matched composition (or the single class head). */
      readonly components: readonly string[];
    }
  | { readonly outcome: 'no-match'; readonly reason: CapabilityNoMatchReason };
