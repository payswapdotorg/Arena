/**
 * The cross-resource matching engine (Work Order C015; issue #121; spec/
 * expert-escalation-api.md ES1.0 "Routing" generalized per resource
 * class). Pure, deterministic typed ResourceMatch decisions over the
 * closed resource-class vocabulary plus TYPED COMPOSITIONS across
 * classes.
 *
 * Pipeline per class (the filter ORDER is part of the contract —
 * unit-tested):
 *
 *   policy gate   — a requested class no demand mode allows is NEVER
 *                   coerced into another class: typed
 *                   `class-not-allowed` (the no-silent-coercion law);
 *
 *   expert        — DELEGATED to the C002 engine (compose, never fork:
 *                   routeEscalation over the embedded DemandProfile),
 *                   then the optional C005 performance-evidence gate
 *                   (INPUT to ranking — never an access grant);
 *
 *   body          — tenant scope → listing state → substrate/
 *                   environment compatibility (C014 data) → budget
 *                   (fail-closed: unpriced listings never pass);
 *
 *   tool          — tenant scope → availability → required-tool set;
 *
 *   knowledge     — tenant scope → tier → validation → rights → scope
 *                   (the C008 no-silent-promotion wall, read-side);
 *
 *   artifact      — tenant scope/visibility → offer state (stale/
 *                   delisted candidates are EXCLUDED with reasons) →
 *                   artifact kind → entitlement (fail-closed default) →
 *                   budget.
 *
 * Survivors are ranked deterministically per class (typed score data,
 * lexicographic ref tie-break). When a demand requests MULTIPLE classes
 * a typed composition is built from each class head; the composition is
 * feasible only when every requested class matched AND the combined
 * cost is within the budget cap — a budget-infeasible composition FAILS
 * CLOSED (never a partial or over-cap match). Identical inputs always
 * produce identical digests.
 */

import { digestCanonical } from '@arena/protocol-core';
import { routeEscalation } from '@arena/escalation-routing';
import type { RoutingVerdict } from '@arena/escalation-routing';
import { CAPABILITY_ROUTING_ERROR_CODES, CapabilityRoutingError } from './errors.js';
import type { CrossResourceDemand } from './demand.js';
import {
  RESOLUTION_POLICY_VERSION,
  RESOURCE_CLASSES,
  allowedResourceClasses,
} from './policy.js';
import type { ResourceClass } from './policy.js';
import type {
  ArtifactCandidateView,
  BodyCandidateView,
  ExpertCandidateView,
  KnowledgeCandidateView,
  ToolCandidateView,
} from './catalog.js';

/** Wire version of the ResourceMatch verdict shape. */
export const RESOURCE_MATCH_VERSION = 1 as const;

/**
 * The CLOSED elimination vocabulary (no silent best-effort — every
 * eliminated candidate carries exactly one reason; the C002 expert
 * reasons are carried verbatim).
 */
export const ELIMINATION_REASONS = Object.freeze([
  // class-level
  'class-not-allowed-for-mode',
  'catalog-unavailable',
  // expert (C002, verbatim)
  'cross-tenant',
  'blocked-by-coi',
  'blocked-by-privacy',
  'qualification-missing',
  'tools-unsupported',
  'locale-uncovered',
  'jurisdiction-uncovered',
  'budget-infeasible',
  'deadline-infeasible',
  'unavailable',
  // expert + C005 evidence gate
  'performance-evidence-missing',
  // body
  'listing-not-published',
  'incompatible-substrate',
  // knowledge
  'tier-insufficient',
  'validation-missing',
  'rights-missing',
  'scope-insufficient',
  // artifact
  'offer-delisted',
  'entitlement-missing',
  'artifact-kind-unwanted',
] as const);
export type EliminationReason = (typeof ELIMINATION_REASONS)[number];

/** The closed ResourceMatch outcome vocabulary (machine-readable decisions). */
export const RESOURCE_MATCH_OUTCOMES = Object.freeze([
  'matched',
  'no-match',
  'blocked-by-coi',
  'blocked-by-privacy',
  'budget-infeasible',
  'deadline-infeasible',
  'incompatible-substrate',
  'class-not-allowed',
] as const);
export type ResourceMatchOutcome = (typeof RESOURCE_MATCH_OUTCOMES)[number];

/** Why one candidate (or class — empty ref) did not survive. */
export interface EliminationCause {
  readonly resourceClass: ResourceClass;
  /** The candidate ref ('' for class-level causes). */
  readonly ref: string;
  readonly reason: EliminationReason;
}

/** The deterministic ranking score of one survivor (typed data per class). */
export type ComponentScore =
  | {
      readonly class: 'expert';
      readonly taskFit: number;
      readonly completionRatio: number;
      readonly localeMatch: number;
      readonly evidenceDepth: number;
    }
  | { readonly class: 'body'; readonly certificationDepth: number; readonly evidenceDepth: number }
  | { readonly class: 'tool'; readonly operationCount: number }
  | {
      readonly class: 'knowledge';
      readonly tierRank: number;
      readonly validationRank: number;
      readonly evidenceDepth: number;
    }
  | { readonly class: 'artifact'; readonly entitlementRank: number; readonly costMinorUnits: number };

/** One ranked survivor of a class pipeline. */
export interface RankedComponent {
  readonly resourceClass: ResourceClass;
  readonly ref: string;
  readonly rank: number;
  readonly score: ComponentScore;
  readonly costMinorUnits: number;
  readonly currency: string;
}

/** The per-class routing result. */
export interface ClassRoutingResult {
  readonly resourceClass: ResourceClass;
  readonly allowedByPolicy: boolean;
  readonly outcome: 'matched' | 'no-match' | 'class-not-allowed';
  readonly shortlist: readonly RankedComponent[];
}

/** One component of a typed cross-resource composition. */
export interface CompositionComponent {
  readonly resourceClass: ResourceClass;
  readonly ref: string;
  readonly rank: number;
  readonly costMinorUnits: number;
}

/** A typed composition across matched classes (budget-feasible by construction). */
export interface ResourceComposition {
  readonly components: readonly CompositionComponent[];
  readonly totalCostMinorUnits: number;
  readonly currency: string;
}

/** The digest-free view — exactly what the match digest commits to. */
export interface ResourceMatchView {
  readonly matchVersion: typeof RESOURCE_MATCH_VERSION;
  readonly requestId: string;
  readonly tenantId: string;
  readonly demandDigest: string;
  readonly policyVersion: typeof RESOLUTION_POLICY_VERSION;
  readonly evaluatedAt: string;
  readonly outcome: ResourceMatchOutcome;
  /** EVERY eliminated candidate/class + its closed reason — the machine-readable negative space. */
  readonly causes: readonly EliminationCause[];
  readonly classes: readonly ClassRoutingResult[];
  readonly composition: ResourceComposition | null;
}

/** A frozen, content-addressed ResourceMatch verdict: view + digest. */
export interface ResourceMatch extends ResourceMatchView {
  readonly digest: string;
}

/** The injected per-class catalogs (plain DATA — ports live in the service). */
export interface ResourceCatalogs {
  readonly experts?: readonly ExpertCandidateView[];
  readonly bodies?: readonly BodyCandidateView[];
  readonly tools?: readonly ToolCandidateView[];
  readonly knowledge?: readonly KnowledgeCandidateView[];
  readonly artifacts?: readonly ArtifactCandidateView[];
}

// ---------------------------------------------------------------------------
// Rank helpers (pure, deterministic)
// ---------------------------------------------------------------------------

const KNOWLEDGE_TIER_RANK: Readonly<Record<string, number>> = Object.freeze({
  'scoped-reusable-knowledge': 1,
  'candidate-domain-rule': 2,
  'verified-domain-constraint': 3,
});

const KNOWLEDGE_SCOPE_RANK: Readonly<Record<string, number>> = Object.freeze({
  task: 1,
  case: 2,
  domain: 3,
  jurisdiction: 4,
});

function classOrder(resourceClass: ResourceClass): number {
  return RESOURCE_CLASSES.indexOf(resourceClass);
}

function compareCauses(a: EliminationCause, b: EliminationCause): number {
  const classDelta = classOrder(a.resourceClass) - classOrder(b.resourceClass);
  if (classDelta !== 0) return classDelta;
  if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
  if (a.reason !== b.reason) return a.reason < b.reason ? -1 : 1;
  return 0;
}

function compareComponents(
  a: { readonly resourceClass: ResourceClass; readonly ref: string },
  b: { readonly resourceClass: ResourceClass; readonly ref: string },
): number {
  const classDelta = classOrder(a.resourceClass) - classOrder(b.resourceClass);
  if (classDelta !== 0) return classDelta;
  if (a.ref !== b.ref) return a.ref < b.ref ? -1 : 1;
  return 0;
}

function compareScore(
  a: { readonly resourceClass: ResourceClass; readonly ref: string; readonly score: ComponentScore },
  b: { readonly resourceClass: ResourceClass; readonly ref: string; readonly score: ComponentScore },
): number {
  if (a.resourceClass !== b.resourceClass) return compareComponents(a, b);
  switch (a.score.class) {
    case 'expert': {
      const other = b.score as Extract<ComponentScore, { class: 'expert' }>;
      if (a.score.taskFit !== other.taskFit) return other.taskFit - a.score.taskFit;
      if (a.score.completionRatio !== other.completionRatio) {
        return other.completionRatio - a.score.completionRatio;
      }
      if (a.score.localeMatch !== other.localeMatch) return other.localeMatch - a.score.localeMatch;
      if (a.score.evidenceDepth !== other.evidenceDepth) {
        return other.evidenceDepth - a.score.evidenceDepth;
      }
      return 0;
    }
    case 'body': {
      const other = b.score as Extract<ComponentScore, { class: 'body' }>;
      if (a.score.certificationDepth !== other.certificationDepth) {
        return other.certificationDepth - a.score.certificationDepth;
      }
      if (a.score.evidenceDepth !== other.evidenceDepth) {
        return other.evidenceDepth - a.score.evidenceDepth;
      }
      return 0;
    }
    case 'tool': {
      const other = b.score as Extract<ComponentScore, { class: 'tool' }>;
      if (a.score.operationCount !== other.operationCount) {
        return other.operationCount - a.score.operationCount;
      }
      return 0;
    }
    case 'knowledge': {
      const other = b.score as Extract<ComponentScore, { class: 'knowledge' }>;
      if (a.score.tierRank !== other.tierRank) return other.tierRank - a.score.tierRank;
      if (a.score.validationRank !== other.validationRank) {
        return other.validationRank - a.score.validationRank;
      }
      if (a.score.evidenceDepth !== other.evidenceDepth) {
        return other.evidenceDepth - a.score.evidenceDepth;
      }
      return 0;
    }
    case 'artifact': {
      const other = b.score as Extract<ComponentScore, { class: 'artifact' }>;
      if (a.score.entitlementRank !== other.entitlementRank) {
        return other.entitlementRank - a.score.entitlementRank;
      }
      if (a.score.costMinorUnits !== other.costMinorUnits) {
        return a.score.costMinorUnits - other.costMinorUnits;
      }
      return 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Per-class pipelines (filter ORDER is the contract)
// ---------------------------------------------------------------------------

interface Survivor {
  readonly resourceClass: ResourceClass;
  readonly ref: string;
  readonly score: ComponentScore;
  readonly costMinorUnits: number;
  readonly currency: string;
}

/** Eliminate one Agent-Body candidate; the first failing reason wins. */
function eliminateBody(
  profile: CrossResourceDemand,
  candidate: BodyCandidateView,
): EliminationReason | null {
  // 1. tenant scope (lock rule 11 — cross-tenant ELIMINATED, never routed).
  if (candidate.tenantId !== profile.tenantId && candidate.tenantId !== 'public') {
    return 'cross-tenant';
  }
  // 2. listing state — only published listings are procurable.
  if (candidate.state !== 'published') return 'listing-not-published';
  // 3. substrate / environment compatibility (C014 compatibility data).
  const requiredSubstrate = profile.facets.body?.requiredSubstrate;
  if (requiredSubstrate !== undefined) {
    if (
      candidate.substrateCompatibility === null ||
      candidate.substrateCompatibility.substrateId !== requiredSubstrate
    ) {
      return 'incompatible-substrate';
    }
  }
  for (const environmentId of profile.facets.body?.environmentRequirements ?? []) {
    if (
      candidate.substrateCompatibility === null ||
      !candidate.substrateCompatibility.environmentIds.includes(environmentId)
    ) {
      return 'incompatible-substrate';
    }
  }
  // 4. budget (fail-closed: unpriced listings never pass a procurement demand).
  if (
    candidate.pricing === null ||
    candidate.pricing.currency !== profile.budget.currency ||
    candidate.pricing.amountMinorUnits > profile.budget.amountMinorUnits
  ) {
    return 'budget-infeasible';
  }
  return null;
}

/** Eliminate one tool candidate; the first failing reason wins. */
function eliminateTool(
  profile: CrossResourceDemand,
  candidate: ToolCandidateView,
): EliminationReason | null {
  if (candidate.tenantId !== profile.tenantId && candidate.tenantId !== 'public') {
    return 'cross-tenant';
  }
  if (candidate.availability !== 'available') return 'unavailable';
  const requiredToolIds = profile.facets.tool?.requiredToolIds ?? [];
  if (requiredToolIds.length > 0 && !requiredToolIds.includes(candidate.toolId)) {
    return 'tools-unsupported';
  }
  return null;
}

/** Eliminate one knowledge candidate; the first failing reason wins. */
function eliminateKnowledge(
  profile: CrossResourceDemand,
  candidate: KnowledgeCandidateView,
): EliminationReason | null {
  if (candidate.tenantId !== profile.tenantId && candidate.tenantId !== 'public') {
    return 'cross-tenant';
  }
  const minimumTier = profile.facets.knowledge?.minimumTier ?? 'scoped-reusable-knowledge';
  if (
    (KNOWLEDGE_TIER_RANK[candidate.tier] ?? 0) < (KNOWLEDGE_TIER_RANK[minimumTier] ?? 0)
  ) {
    return 'tier-insufficient';
  }
  if (minimumTier === 'verified-domain-constraint' && candidate.validationState !== 'validated') {
    return 'validation-missing';
  }
  if (!candidate.rightsPresent) return 'rights-missing';
  const requiredScope = profile.facets.knowledge?.requiredScopeKind;
  if (
    requiredScope !== undefined &&
    (KNOWLEDGE_SCOPE_RANK[candidate.scopeKind] ?? 0) < (KNOWLEDGE_SCOPE_RANK[requiredScope] ?? 0)
  ) {
    return 'scope-insufficient';
  }
  return null;
}

/** Eliminate one marketplace-artifact candidate; the first failing reason wins. */
function eliminateArtifact(
  profile: CrossResourceDemand,
  candidate: ArtifactCandidateView,
): EliminationReason | null {
  // 1. tenant scope / visibility (A032 addressability semantics).
  if (
    candidate.visibility === 'tenant-internal' &&
    candidate.tenantId !== profile.tenantId
  ) {
    return 'cross-tenant';
  }
  // 2. offer state — stale/delisted candidates are EXCLUDED with reasons.
  if (candidate.state !== 'registered') return 'offer-delisted';
  // 3. artifact kind (an empty demand facet accepts every kind).
  const wantedKinds = profile.facets.artifact?.artifactKinds ?? [];
  if (wantedKinds.length > 0 && !wantedKinds.includes(candidate.artifactKind)) {
    return 'artifact-kind-unwanted';
  }
  // 4. entitlement (fail-closed default: an active grant is required).
  if ((profile.facets.artifact?.entitlementRequired ?? true) === true) {
    if (candidate.entitlementState !== 'active') return 'entitlement-missing';
  }
  // 5. budget (null price ⇒ open/granted listing, cost 0).
  if (
    candidate.price !== null &&
    (candidate.price.currency !== profile.budget.currency ||
      candidate.price.amountMinorUnits > profile.budget.amountMinorUnits)
  ) {
    return 'budget-infeasible';
  }
  return null;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** Classify the no-survivor outcome from the closed cause set. */
function classifyNoMatch(causes: readonly EliminationCause[]): ResourceMatchOutcome {
  const reasons = new Set(causes.map((cause) => cause.reason));
  if (reasons.size === 0) return 'no-match';
  if (reasons.size === 1 && reasons.has('blocked-by-coi')) return 'blocked-by-coi';
  if (reasons.size === 1 && reasons.has('blocked-by-privacy')) return 'blocked-by-privacy';
  if (reasons.size === 1 && reasons.has('incompatible-substrate')) {
    return 'incompatible-substrate';
  }
  if (reasons.size === 1 && reasons.has('budget-infeasible')) return 'budget-infeasible';
  // Availability-shaped causes (deadline, unavailability, broken catalog
  // ports) compress to the closed deadline-infeasible outcome — the C002
  // mapping of routing-unavailability.
  if (
    [...reasons].every((reason) =>
      ['deadline-infeasible', 'unavailable', 'catalog-unavailable'].includes(reason),
    )
  ) {
    return 'deadline-infeasible';
  }
  // Everything else — including delisted offers and missing entitlements
  // mixed with other causes — is the honest no-match.
  return 'no-match';
}

/**
 * Match one compiled cross-resource demand over the injected catalogs.
 * Deterministic: identical inputs ⇒ identical match digests, independent
 * of candidate input order. Never throws for routing semantics —
 * failures are typed outcomes; only structurally invalid inputs throw.
 */
export async function matchResources(
  profile: CrossResourceDemand,
  catalogs: ResourceCatalogs,
  options: {
    readonly requestId: string;
    readonly evaluatedAt: string;
    /** Classes whose catalog port FAILED (fail-closed: no candidates are read). */
    readonly unavailableCatalogs?: readonly ResourceClass[];
  },
): Promise<ResourceMatch> {
  if (typeof options.requestId !== 'string' || options.requestId.length === 0) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_DEMAND_INPUT, {
      message: 'matchResources requires a requestId',
    });
  }
  if (typeof options.evaluatedAt !== 'string' || !Number.isFinite(Date.parse(options.evaluatedAt))) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_DEMAND_INPUT, {
      message: `evaluatedAt must be a parseable timestamp: ${JSON.stringify(options.evaluatedAt)}`,
    });
  }

  const causes: EliminationCause[] = [];
  const classes: ClassRoutingResult[] = [];
  const survivors: Survivor[] = [];
  const unavailable = new Set(options.unavailableCatalogs ?? []);
  const allowed = allowedResourceClasses(profile.escalationModes);

  for (const resourceClass of profile.requestedClasses) {
    // --- policy gate (no silent coercion between classes) ------------------
    if (!(allowed as readonly string[]).includes(resourceClass)) {
      causes.push(
        Object.freeze({ resourceClass, ref: '', reason: 'class-not-allowed-for-mode' }),
      );
      classes.push(
        Object.freeze({
          resourceClass,
          allowedByPolicy: false,
          outcome: 'class-not-allowed',
          shortlist: Object.freeze([]),
        }),
      );
      continue;
    }

    // --- fail-closed catalog gate ------------------------------------------
    if (unavailable.has(resourceClass)) {
      causes.push(Object.freeze({ resourceClass, ref: '', reason: 'catalog-unavailable' }));
      classes.push(
        Object.freeze({
          resourceClass,
          allowedByPolicy: true,
          outcome: 'no-match',
          shortlist: Object.freeze([]),
        }),
      );
      continue;
    }

    if (resourceClass === 'expert') {
      // --- DELEGATED to the C002 engine (compose, never fork) ---------------
      const verdict: RoutingVerdict = await routeEscalation(
        profile.expertProfile as NonNullable<CrossResourceDemand['expertProfile']>,
        (catalogs.experts ?? []).map((view) => view.candidate),
        { requestId: options.requestId, evaluatedAt: options.evaluatedAt },
      );
      for (const cause of verdict.causes) {
        causes.push(
          Object.freeze({ resourceClass: 'expert', ref: cause.expertId, reason: cause.reason }),
        );
      }
      const byExpertId = new Map(
        (catalogs.experts ?? []).map((view) => [view.candidate.expertId, view] as const),
      );
      let expertSurvivors: Survivor[] = (verdict.shortlist ?? []).map((ranked) => ({
        resourceClass: 'expert' as const,
        ref: ranked.expertId,
        score: {
          class: 'expert' as const,
          taskFit: ranked.score.taskFit,
          completionRatio: ranked.score.completionRatio,
          localeMatch: ranked.score.localeMatch,
          evidenceDepth: ranked.score.evidenceDepth,
        },
        costMinorUnits:
          byExpertId.get(ranked.expertId)?.candidate.rateCard.engagementRateMinorUnits ?? 0,
        currency: byExpertId.get(ranked.expertId)?.candidate.rateCard.currency ?? '',
      }));
      // --- C005 performance-evidence gate (INPUT to ranking, never a grant) --
      if (profile.facets.expert?.performanceEvidenceRequired === true) {
        const gated: Survivor[] = [];
        for (const survivor of expertSurvivors) {
          const view = byExpertId.get(survivor.ref);
          if (view === undefined || view.performanceProfileDigest === null) {
            causes.push(
              Object.freeze({
                resourceClass: 'expert',
                ref: survivor.ref,
                reason: 'performance-evidence-missing',
              }),
            );
            continue;
          }
          gated.push(survivor);
        }
        expertSurvivors = gated;
      }
      survivors.push(...expertSurvivors);
      classes.push(
        Object.freeze({
          resourceClass,
          allowedByPolicy: true,
          outcome: expertSurvivors.length > 0 ? 'matched' : 'no-match',
          shortlist: Object.freeze([]), // filled after ranking below
        }),
      );
      continue;
    }

    // --- own pipelines (body / tool / knowledge / artifact) ------------------
    const classSurvivors: Survivor[] = [];
    const classCauses: EliminationCause[] = [];
    if (resourceClass === 'body') {
      const candidates = [...(catalogs.bodies ?? [])].sort((a, b) =>
        a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0,
      );
      for (const candidate of candidates) {
        const reason = eliminateBody(profile, candidate);
        if (reason !== null) {
          classCauses.push({ resourceClass, ref: candidate.listingId, reason });
          continue;
        }
        classSurvivors.push({
          resourceClass,
          ref: candidate.listingId,
          score: {
            class: 'body',
            certificationDepth: candidate.certificationRecordDigests.length,
            evidenceDepth: candidate.capabilityEvidenceRefs.length,
          },
          costMinorUnits: candidate.pricing?.amountMinorUnits ?? 0,
          currency: candidate.pricing?.currency ?? profile.budget.currency,
        });
      }
    } else if (resourceClass === 'tool') {
      const candidates = [...(catalogs.tools ?? [])].sort((a, b) =>
        a.toolId < b.toolId ? -1 : a.toolId > b.toolId ? 1 : 0,
      );
      for (const candidate of candidates) {
        const reason = eliminateTool(profile, candidate);
        if (reason !== null) {
          classCauses.push({ resourceClass, ref: candidate.toolId, reason });
          continue;
        }
        classSurvivors.push({
          resourceClass,
          ref: candidate.toolId,
          score: { class: 'tool', operationCount: candidate.operations.length },
          costMinorUnits: 0,
          currency: profile.budget.currency,
        });
      }
    } else if (resourceClass === 'knowledge') {
      const candidates = [...(catalogs.knowledge ?? [])].sort((a, b) =>
        a.recordId < b.recordId ? -1 : a.recordId > b.recordId ? 1 : 0,
      );
      for (const candidate of candidates) {
        const reason = eliminateKnowledge(profile, candidate);
        if (reason !== null) {
          classCauses.push({ resourceClass, ref: candidate.recordId, reason });
          continue;
        }
        classSurvivors.push({
          resourceClass,
          ref: candidate.recordId,
          score: {
            class: 'knowledge',
            tierRank: KNOWLEDGE_TIER_RANK[candidate.tier] ?? 0,
            validationRank: candidate.validationState === 'validated' ? 1 : 0,
            evidenceDepth: candidate.evidenceRefs.length,
          },
          costMinorUnits: 0,
          currency: profile.budget.currency,
        });
      }
    } else {
      const candidates = [...(catalogs.artifacts ?? [])].sort((a, b) =>
        a.offerId < b.offerId ? -1 : a.offerId > b.offerId ? 1 : 0,
      );
      for (const candidate of candidates) {
        const reason = eliminateArtifact(profile, candidate);
        if (reason !== null) {
          classCauses.push({ resourceClass, ref: candidate.offerId, reason });
          continue;
        }
        classSurvivors.push({
          resourceClass,
          ref: candidate.offerId,
          score: {
            class: 'artifact',
            entitlementRank: candidate.entitlementState === 'active' ? 1 : 0,
            costMinorUnits: candidate.price?.amountMinorUnits ?? 0,
          },
          costMinorUnits: candidate.price?.amountMinorUnits ?? 0,
          currency: candidate.price?.currency ?? profile.budget.currency,
        });
      }
    }
    causes.push(...classCauses);
    survivors.push(...classSurvivors);
    classes.push(
      Object.freeze({
        resourceClass,
        allowedByPolicy: true,
        outcome: classSurvivors.length > 0 ? 'matched' : 'no-match',
        shortlist: Object.freeze([]),
      }),
    );
  }

  // --- deterministic ranking (per class, then ref tie-break) ----------------
  survivors.sort((a, b) => {
    const scoreDelta = compareScore(a, b);
    if (scoreDelta !== 0) return scoreDelta;
    return compareComponents(a, b);
  });
  const rankedByClass = new Map<ResourceClass, RankedComponent[]>();
  for (const survivor of survivors) {
    const list = rankedByClass.get(survivor.resourceClass) ?? [];
    list.push(
      Object.freeze({
        resourceClass: survivor.resourceClass,
        ref: survivor.ref,
        rank: list.length + 1,
        score: Object.freeze(survivor.score),
        costMinorUnits: survivor.costMinorUnits,
        currency: survivor.currency,
      }),
    );
    rankedByClass.set(survivor.resourceClass, list);
  }
  const finalizedClasses = classes.map((result) =>
    Object.freeze({
      ...result,
      shortlist: Object.freeze([...(rankedByClass.get(result.resourceClass) ?? [])]),
    }),
  );

  // --- typed composition (multi-class demands only) ---------------------------
  const requestedClasses = profile.requestedClasses;
  const matchedClasses = finalizedClasses.filter((result) => result.outcome === 'matched');
  const allMatched =
    matchedClasses.length === requestedClasses.length && requestedClasses.length > 0;
  let composition: ResourceComposition | null = null;
  let outcome: ResourceMatchOutcome;

  if (
    finalizedClasses.length > 0 &&
    finalizedClasses.every((result) => result.outcome === 'class-not-allowed')
  ) {
    outcome = 'class-not-allowed';
  } else if (allMatched && requestedClasses.length === 1) {
    outcome = 'matched';
  } else if (allMatched && requestedClasses.length > 1) {
    // FAIL CLOSED: a composition is feasible only within the budget cap.
    const components: CompositionComponent[] = [];
    let total = 0;
    let currencyMismatch = false;
    for (const result of finalizedClasses) {
      const head = result.shortlist[0];
      if (head === undefined) continue;
      components.push(
        Object.freeze({
          resourceClass: head.resourceClass,
          ref: head.ref,
          rank: head.rank,
          costMinorUnits: head.costMinorUnits,
        }),
      );
      total += head.costMinorUnits;
      if (head.currency !== profile.budget.currency) currencyMismatch = true;
    }
    if (currencyMismatch || total > profile.budget.amountMinorUnits) {
      outcome = 'budget-infeasible';
    } else {
      composition = Object.freeze({
        components: Object.freeze(components),
        totalCostMinorUnits: total,
        currency: profile.budget.currency,
      });
      outcome = 'matched';
    }
  } else if (matchedClasses.length > 0) {
    // Partial class match on a multi-class demand — visible in class
    // results, NEVER silently delivered as the verdict (all-or-nothing).
    outcome = 'no-match';
  } else {
    outcome = classifyNoMatch(causes);
  }

  causes.sort(compareCauses);
  const view: ResourceMatchView = {
    matchVersion: RESOURCE_MATCH_VERSION,
    requestId: options.requestId,
    tenantId: profile.tenantId,
    demandDigest: profile.digest,
    policyVersion: RESOLUTION_POLICY_VERSION,
    evaluatedAt: options.evaluatedAt,
    outcome,
    causes: Object.freeze([...causes]),
    classes: Object.freeze(finalizedClasses),
    composition,
  };
  const digest = await digestCanonical(view);
  return Object.freeze({ ...view, digest }) as ResourceMatch;
}

/** Every elimination cause of a match (the machine-readable negative space). */
export function resourceMatchCauses(match: ResourceMatch): readonly EliminationCause[] {
  return Object.freeze([...(match.causes ?? [])]);
}

/** Structural (non-throwing) guard for a ResourceMatch verdict. */
export function isResourceMatch(value: unknown): value is ResourceMatch {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['matchVersion'] === RESOURCE_MATCH_VERSION &&
    typeof candidate['requestId'] === 'string' &&
    typeof candidate['tenantId'] === 'string' &&
    typeof candidate['demandDigest'] === 'string' &&
    typeof candidate['evaluatedAt'] === 'string' &&
    (RESOURCE_MATCH_OUTCOMES as readonly string[]).includes(String(candidate['outcome'])) &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a match (what the digest commits to). */
export function resourceMatchView(match: ResourceMatch): ResourceMatchView {
  const { digest: _digest, ...view } = match;
  return view;
}

/**
 * Recompute the match digest over the digest-free view and compare.
 * Throws CAPABILITY_ROUTING_TAMPERED on any mismatch.
 */
export async function recomputeResourceMatchDigest(
  match: ResourceMatch,
  expectedDigest?: string,
): Promise<string> {
  if (!isResourceMatch(match)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_MATCH, {
      message: 'match digest recomputation requires a structurally valid ResourceMatch',
    });
  }
  const actual = await digestCanonical(resourceMatchView(match));
  if (actual !== match.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
      message: `resource match digest mismatch: expected ${expectedDigest ?? match.digest}, got ${actual}`,
      details: {
        requestId: match.requestId,
        outcome: match.outcome,
        expected: expectedDigest ?? match.digest,
        actual,
      },
    });
  }
  return actual;
}
