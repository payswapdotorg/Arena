/**
 * Cross-resource demand profile (Work Order C015; issue #121) — the
 * resource-class-aware generalization of the C002 DemandProfile
 * (@arena/escalation-routing) over the A004 capability graph.
 *
 * The compiler turns ONE capability-demand view into a structured,
 * versioned CrossResourceDemandProfile carrying a typed facet per
 * requested resource class:
 *
 *   - expert facet    — the human-expert need, DELEGATED to the C002
 *                       compiler (compose, never fork: the embedded
 *                       DemandProfile is compiled by
 *                       @arena/escalation-routing itself, and its digest
 *                       is committed to by this profile's digest);
 *   - body facet      — the Agent-Body need (substrate/environment
 *                       compatibility constraints, checked by the engine
 *                       against C014 substrate data through candidate
 *                       views);
 *   - tool facet      — the tool need (required tool identifiers; an
 *                       empty set means gap-driven discovery over C008
 *                       tool-gap/tool-specification candidates);
 *   - knowledge facet — the scoped-knowledge need (minimum C008 tier,
 *                        required scope);
 *   - artifact facet  — the marketplace-artifact need (A032 kinds:
 *                        dataset / evaluation-suite / environment).
 *
 * Typed CLOSED outcomes — never a bare boolean:
 *   - `compilable`               → the profile (content-addressed,
 *                                   deep-frozen);
 *   - `under-specified`          → closed reason list + the unresolved
 *                                   inputs;
 *   - `not-derivable`            → the graph itself cannot answer.
 *
 * Pure + deterministic: identical (demand view, graph, evaluatedAt)
 * triples ALWAYS compile to the same digest. No clock reads —
 * `evaluatedAt` is injected (architecture-lock rule 17). QUALIFICATION
 * AND PERFORMANCE EVIDENCE ARE DATA, NEVER ACCESS GRANTS (lock rules
 * 9/35): the profile describes a DEMAND and grants nothing.
 */

import { digestCanonical } from '@arena/protocol-core';
import type { CapabilityGraph } from '@arena/capability-graph';
import { isCapabilityGraph } from '@arena/capability-graph';
import { compileDemandProfile } from '@arena/escalation-routing';
import type {
  DemandProfile,
  DemandProfileView,
  RoutingDemandInput,
} from '@arena/escalation-routing';
import { isEscalationMode, isResourceClass } from './policy.js';
import type { ResourceClass } from './policy.js';
import { CAPABILITY_ROUTING_ERROR_CODES, CapabilityRoutingError } from './errors.js';

/** Wire version of the cross-resource demand profile shape. */
export const CROSS_RESOURCE_DEMAND_VERSION = 1 as const;

/** The C008 reusable knowledge tiers (closed, ranked). */
export const KNOWLEDGE_TIERS = Object.freeze([
  'scoped-reusable-knowledge',
  'candidate-domain-rule',
  'verified-domain-constraint',
] as const);
export type KnowledgeTier = (typeof KNOWLEDGE_TIERS)[number];

/** The C008 knowledge scope kinds (closed, ranked by widening). */
export const KNOWLEDGE_SCOPE_KINDS = Object.freeze([
  'task',
  'case',
  'domain',
  'jurisdiction',
] as const);
export type KnowledgeScopeKind = (typeof KNOWLEDGE_SCOPE_KINDS)[number];

/** The A032 marketplace artifact kinds (closed). */
export const ARTIFACT_KINDS = Object.freeze([
  'dataset',
  'evaluation-suite',
  'environment',
] as const);
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * CLOSED under-specification vocabulary (the caller can repair these by
 * fixing the demand view).
 */
export const CROSS_UNDER_SPECIFIED_REASONS = Object.freeze([
  'resource-class-missing',
  'escalation-mode-invalid',
  'expert-demand-under-specified',
  'expert-demand-not-derivable',
  'body-substrate-malformed',
  'tool-demand-malformed',
  'artifact-kind-invalid',
  'knowledge-tier-invalid',
  'knowledge-scope-invalid',
  'locale-malformed',
  'budget-malformed',
  'deadline-malformed',
] as const);
export type CrossUnderSpecifiedReason = (typeof CROSS_UNDER_SPECIFIED_REASONS)[number];

/**
 * CLOSED not-derivable vocabulary (the capability graph cannot answer).
 */
export const CROSS_NOT_DERIVABLE_REASONS = Object.freeze([
  'graph-missing',
  'graph-lookup-failed',
] as const);
export type CrossNotDerivableReason = (typeof CROSS_NOT_DERIVABLE_REASONS)[number];

const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const TENANT_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const SUBSTRATE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const TOOL_ID_PATTERN = /^[a-z][a-z0-9-]{0,127}$/;

/** The demand-side view of one cross-resource capability demand. */
export interface CrossResourceDemandInput {
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly capabilityNeed: string;
  /** Required capability dot-paths (consumed by the expert facet's C002 compilation). */
  readonly requiredCapabilities: readonly string[];
  readonly locale: string;
  readonly preferredLocales?: readonly string[];
  readonly jurisdictions?: readonly string[];
  readonly budget: { readonly amountMinorUnits: number; readonly currency: string };
  readonly deadline: string;
  readonly createdAt: string;
  readonly urgency: string;
  readonly privacyPolicy: {
    readonly dataClassification: string;
    readonly pii: string;
  };
  readonly escalationModes: readonly string[];
  /** Human-expert need facet (present ⇒ experts are requested). */
  readonly expert?: {
    /**
     * Require C005 dimensional performance evidence on expert candidates
     * (INPUT to ranking — never an access grant).
     */
    readonly performanceEvidenceRequired?: boolean;
  };
  /** Agent-Body need facet (present ⇒ Bodies are requested). */
  readonly body?: {
    /** The substrate the demand must run on (C014 compatibility input). */
    readonly requiredSubstrate?: string;
    /** Environment identifiers the composition must satisfy. */
    readonly environmentRequirements?: readonly string[];
  };
  /** Tool need facet (present ⇒ tools are requested). */
  readonly tool?: {
    /** Required tool identifiers (C008 tool-gap/tool-specification space). */
    readonly requiredToolIds?: readonly string[];
  };
  /** Scoped-knowledge need facet (present ⇒ knowledge is requested). */
  readonly knowledge?: {
    /** The minimum C008 reusable tier that satisfies the demand. */
    readonly minimumTier?: KnowledgeTier;
    /** The minimum scope the knowledge must cover. */
    readonly requiredScopeKind?: KnowledgeScopeKind;
  };
  /** Marketplace-artifact need facet (present ⇒ artifacts are requested). */
  readonly artifact?: {
    /** The A032 artifact kinds that satisfy the demand (all when empty). */
    readonly artifactKinds?: readonly string[];
    /**
     * Require an active entitlement/grant on artifact candidates
     * (default true — fail-closed availability check).
     */
    readonly entitlementRequired?: boolean;
  };
}

/** The typed per-class facet set of a compiled demand (digest-committed). */
export interface DemandFacets {
  readonly expert?: {
    readonly performanceEvidenceRequired: boolean;
    /** The C002 DemandProfile digest (compose, never fork). */
    readonly profileDigest: string;
  };
  readonly body?: {
    readonly requiredSubstrate?: string;
    readonly environmentRequirements: readonly string[];
  };
  readonly tool?: {
    readonly requiredToolIds: readonly string[];
  };
  readonly knowledge?: {
    readonly minimumTier: KnowledgeTier;
    readonly requiredScopeKind?: KnowledgeScopeKind;
  };
  readonly artifact?: {
    readonly artifactKinds: readonly string[];
    readonly entitlementRequired: boolean;
  };
}

/** The digest-free view — exactly what the profile digest commits to. */
export interface CrossResourceDemandView {
  readonly profileVersion: typeof CROSS_RESOURCE_DEMAND_VERSION;
  readonly tenantId: string;
  readonly clientAppId: string;
  readonly capabilityNeed: string;
  readonly escalationModes: readonly string[];
  /** The requested resource classes, canonical order, non-empty. */
  readonly requestedClasses: readonly ResourceClass[];
  readonly facets: DemandFacets;
  readonly locales: readonly string[];
  readonly budget: { readonly amountMinorUnits: number; readonly currency: string };
  readonly deadlineMs: number;
  readonly createdAtMs: number;
  readonly urgency: string;
  readonly privacyPolicy: { readonly dataClassification: string; readonly pii: string };
  readonly evaluatedAt: string;
}

/**
 * A frozen, content-addressed cross-resource demand profile: view +
 * digest (+ the full embedded C002 profile when experts are requested —
 * engine input, not digest-committed: its OWN digest is).
 */
export interface CrossResourceDemand extends CrossResourceDemandView {
  /** The embedded C002 DemandProfile (present iff the expert facet is). */
  readonly expertProfile?: DemandProfile;
  readonly digest: string;
}

/** The typed compiler outcome (never a bare boolean). */
export type CrossDemandCompilationResult =
  | { readonly outcome: 'compilable'; readonly profile: CrossResourceDemand }
  | {
      readonly outcome: 'under-specified';
      readonly reasons: readonly CrossUnderSpecifiedReason[];
      /** The concrete unresolved inputs, in input order (machine-readable). */
      readonly unresolved: readonly string[];
    }
  | { readonly outcome: 'not-derivable'; readonly reason: CrossNotDerivableReason };

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * Compile one cross-resource demand view into a typed
 * CrossResourceDemandProfile over the injected A004 capability graph.
 * Deterministic: identical inputs compile to identical digests. Never
 * throws for semantic mismatches — every failure is a TYPED closed
 * outcome.
 */
export async function compileCrossResourceDemand(
  input: CrossResourceDemandInput,
  graph: CapabilityGraph | null,
  options: { readonly evaluatedAt: string },
): Promise<CrossDemandCompilationResult> {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_DEMAND_INPUT, {
      message: 'cross-resource demand input must be an object',
    });
  }

  const reasons: CrossUnderSpecifiedReason[] = [];
  const unresolved: string[] = [];

  // --- escalation modes (closed vocabulary) --------------------------------
  if (!Array.isArray(input.escalationModes) || input.escalationModes.length === 0) {
    reasons.push('escalation-mode-invalid');
    unresolved.push(JSON.stringify(input.escalationModes ?? null));
  } else {
    for (const mode of input.escalationModes) {
      if (!isEscalationMode(mode)) {
        reasons.push('escalation-mode-invalid');
        unresolved.push(String(mode));
      }
    }
  }

  // --- locales ---------------------------------------------------------------
  const locales: string[] = [];
  if (typeof input.locale !== 'string' || !LOCALE_PATTERN.test(input.locale)) {
    reasons.push('locale-malformed');
    unresolved.push(String(input.locale));
  } else {
    locales.push(input.locale);
  }
  for (const preferred of input.preferredLocales ?? []) {
    if (typeof preferred !== 'string' || !LOCALE_PATTERN.test(preferred)) {
      reasons.push('locale-malformed');
      unresolved.push(String(preferred));
      continue;
    }
    if (!locales.includes(preferred)) locales.push(preferred);
  }

  // --- budget -----------------------------------------------------------------
  if (
    typeof input.budget?.amountMinorUnits !== 'number' ||
    !Number.isInteger(input.budget.amountMinorUnits) ||
    input.budget.amountMinorUnits < 0 ||
    input.budget.amountMinorUnits > Number.MAX_SAFE_INTEGER ||
    typeof input.budget?.currency !== 'string' ||
    !CURRENCY_PATTERN.test(input.budget.currency)
  ) {
    reasons.push('budget-malformed');
  }

  // --- deadline ------------------------------------------------------------------
  const deadlineMs = typeof input.deadline === 'string' ? Date.parse(input.deadline) : Number.NaN;
  if (!Number.isFinite(deadlineMs)) {
    reasons.push('deadline-malformed');
    unresolved.push(String(input.deadline));
  }

  // --- per-class facets ------------------------------------------------------------
  const facetExpert = input.expert !== undefined;
  const facetBody = input.body !== undefined;
  const facetTool = input.tool !== undefined;
  const facetKnowledge = input.knowledge !== undefined;
  const facetArtifact = input.artifact !== undefined;
  if (!facetExpert && !facetBody && !facetTool && !facetKnowledge && !facetArtifact) {
    reasons.push('resource-class-missing');
    unresolved.push('no resource-class facet requested');
  }

  // body substrate/environment requirements
  let bodySubstrate: string | undefined;
  let bodyEnvironments: readonly string[] = Object.freeze([]);
  if (facetBody) {
    const substrate = input.body?.requiredSubstrate;
    if (substrate !== undefined) {
      if (typeof substrate !== 'string' || !SUBSTRATE_PATTERN.test(substrate)) {
        reasons.push('body-substrate-malformed');
        unresolved.push(String(substrate));
      } else {
        bodySubstrate = substrate;
      }
    }
    const environments = input.body?.environmentRequirements;
    if (environments !== undefined) {
      if (
        !Array.isArray(environments) ||
        !environments.every((entry) => typeof entry === 'string' && SUBSTRATE_PATTERN.test(entry))
      ) {
        reasons.push('body-substrate-malformed');
        unresolved.push(JSON.stringify(environments));
      } else {
        bodyEnvironments = Object.freeze([...(environments as readonly string[])]);
      }
    }
  }

  // tool identifiers
  let requiredToolIds: readonly string[] = Object.freeze([]);
  if (facetTool) {
    const toolIds = input.tool?.requiredToolIds;
    if (toolIds !== undefined) {
      if (
        !Array.isArray(toolIds) ||
        !toolIds.every((entry) => typeof entry === 'string' && TOOL_ID_PATTERN.test(entry))
      ) {
        reasons.push('tool-demand-malformed');
        unresolved.push(JSON.stringify(toolIds));
      } else {
        requiredToolIds = Object.freeze([...(toolIds as readonly string[])]);
      }
    }
  }

  // knowledge tier + scope
  let minimumTier: KnowledgeTier = 'scoped-reusable-knowledge';
  let requiredScopeKind: KnowledgeScopeKind | undefined;
  if (facetKnowledge) {
    const tier = input.knowledge?.minimumTier;
    if (
      tier !== undefined &&
      (typeof tier !== 'string' || !(KNOWLEDGE_TIERS as readonly string[]).includes(tier))
    ) {
      reasons.push('knowledge-tier-invalid');
      unresolved.push(String(tier));
    } else if (tier !== undefined) {
      minimumTier = tier;
    }
    const scope = input.knowledge?.requiredScopeKind;
    if (
      scope !== undefined &&
      (typeof scope !== 'string' || !(KNOWLEDGE_SCOPE_KINDS as readonly string[]).includes(scope))
    ) {
      reasons.push('knowledge-scope-invalid');
      unresolved.push(String(scope));
    } else if (scope !== undefined) {
      requiredScopeKind = scope;
    }
  }

  // artifact kinds
  let artifactKinds: readonly string[] = Object.freeze([]);
  if (facetArtifact) {
    const kinds = input.artifact?.artifactKinds;
    if (kinds !== undefined) {
      if (
        !Array.isArray(kinds) ||
        kinds.length === 0 ||
        !kinds.every((entry) => typeof entry === 'string' && (ARTIFACT_KINDS as readonly string[]).includes(entry))
      ) {
        reasons.push('artifact-kind-invalid');
        unresolved.push(JSON.stringify(kinds));
      } else {
        artifactKinds = Object.freeze([...(kinds as readonly string[])]);
      }
    }
  }

  // --- expert facet delegation (C002 — compose, never fork) --------------------
  let expertProfile: DemandProfile | undefined;
  if (facetExpert) {
    if (!isCapabilityGraph(graph)) {
      return { outcome: 'not-derivable', reason: 'graph-missing' };
    }
    const routingInput: RoutingDemandInput = {
      tenantId: input.tenantId,
      clientAppId: input.clientAppId,
      capabilityNeed: input.capabilityNeed,
      requiredCapabilities: input.requiredCapabilities,
      ...(input.preferredLocales !== undefined ? { preferredLocales: input.preferredLocales } : {}),
      ...(input.jurisdictions !== undefined ? { jurisdictions: input.jurisdictions } : {}),
      locale: input.locale,
      budget: input.budget,
      deadline: input.deadline,
      createdAt: input.createdAt,
      urgency: input.urgency,
      privacyPolicy: input.privacyPolicy,
      escalationModes: input.escalationModes,
    };
    const delegated = await compileDemandProfile(routingInput, graph, {
      evaluatedAt: options.evaluatedAt,
    });
    if (delegated.outcome === 'under-specified') {
      reasons.push('expert-demand-under-specified');
      unresolved.push(...delegated.unresolved);
    } else if (delegated.outcome === 'not-derivable') {
      return { outcome: 'not-derivable', reason: 'graph-lookup-failed' };
    } else {
      expertProfile = delegated.profile;
    }
  }

  if (reasons.length > 0) {
    return {
      outcome: 'under-specified',
      reasons: Object.freeze([...reasons]),
      unresolved: Object.freeze([...unresolved]),
    };
  }

  const requestedClasses: ResourceClass[] = [];
  if (facetExpert) requestedClasses.push('expert');
  if (facetBody) requestedClasses.push('body');
  if (facetTool) requestedClasses.push('tool');
  if (facetKnowledge) requestedClasses.push('knowledge');
  if (facetArtifact) requestedClasses.push('artifact');

  const facets: DemandFacets = Object.freeze({
    ...(facetExpert
      ? {
          expert: Object.freeze({
            performanceEvidenceRequired: input.expert?.performanceEvidenceRequired === true,
            profileDigest: (expertProfile as DemandProfile).digest,
          }),
        }
      : {}),
    ...(facetBody
      ? {
          body: Object.freeze({
            ...(bodySubstrate !== undefined ? { requiredSubstrate: bodySubstrate } : {}),
            environmentRequirements: bodyEnvironments,
          }),
        }
      : {}),
    ...(facetTool ? { tool: Object.freeze({ requiredToolIds }) } : {}),
    ...(facetKnowledge
      ? {
          knowledge: Object.freeze({
            minimumTier,
            ...(requiredScopeKind !== undefined ? { requiredScopeKind } : {}),
          }),
        }
      : {}),
    ...(facetArtifact
      ? {
          artifact: Object.freeze({
            artifactKinds,
            entitlementRequired: input.artifact?.entitlementRequired !== false,
          }),
        }
      : {}),
  });

  const view: CrossResourceDemandView = {
    profileVersion: CROSS_RESOURCE_DEMAND_VERSION,
    tenantId: input.tenantId,
    clientAppId: input.clientAppId,
    capabilityNeed: input.capabilityNeed,
    escalationModes: Object.freeze([...(input.escalationModes as readonly string[])]),
    requestedClasses: Object.freeze([...requestedClasses]),
    facets,
    locales: Object.freeze([...locales]),
    budget: Object.freeze({
      amountMinorUnits: input.budget.amountMinorUnits,
      currency: input.budget.currency,
    }),
    deadlineMs,
    createdAtMs: Date.parse(input.createdAt),
    urgency: input.urgency,
    privacyPolicy: Object.freeze({
      dataClassification: input.privacyPolicy.dataClassification,
      pii: input.privacyPolicy.pii,
    }),
    evaluatedAt: options.evaluatedAt,
  };

  const digest = await digestCanonical(view);
  const profile: CrossResourceDemand = Object.freeze({
    ...view,
    ...(expertProfile !== undefined ? { expertProfile } : {}),
    digest,
  });
  return { outcome: 'compilable', profile };
}

/** Structural (non-throwing) guard for a CrossResourceDemand-shaped value. */
export function isCrossResourceDemand(value: unknown): value is CrossResourceDemand {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['profileVersion'] === CROSS_RESOURCE_DEMAND_VERSION &&
    typeof candidate['tenantId'] === 'string' &&
    TENANT_ID_PATTERN.test(candidate['tenantId']) &&
    typeof candidate['capabilityNeed'] === 'string' &&
    Array.isArray(candidate['requestedClasses']) &&
    (candidate['requestedClasses'] as unknown[]).every(isResourceClass) &&
    (candidate['requestedClasses'] as unknown[]).length > 0 &&
    typeof candidate['digest'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['digest'])
  );
}

/** The digest-free view of a profile (what the digest commits to). */
export function crossResourceDemandView(profile: CrossResourceDemand): CrossResourceDemandView {
  const { digest: _digest, expertProfile: _expertProfile, ...view } = profile;
  return view;
}

/**
 * Recompute the profile digest over the digest-free view and compare.
 * Throws CAPABILITY_ROUTING_TAMPERED on any mismatch.
 */
export async function recomputeCrossResourceDemandDigest(
  profile: CrossResourceDemand,
  expectedDigest?: string,
): Promise<string> {
  if (!isCrossResourceDemand(profile)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.INVALID_PROFILE, {
      message: 'profile digest recomputation requires a structurally valid cross-resource demand',
    });
  }
  const actual = await digestCanonical(crossResourceDemandView(profile));
  if (actual !== profile.digest || (expectedDigest !== undefined && actual !== expectedDigest)) {
    throw new CapabilityRoutingError(CAPABILITY_ROUTING_ERROR_CODES.TAMPERED, {
      message: `cross-resource demand digest mismatch: expected ${expectedDigest ?? profile.digest}, got ${actual}`,
      details: {
        capabilityNeed: profile.capabilityNeed,
        expected: expectedDigest ?? profile.digest,
        actual,
      },
    });
  }
  return actual;
}

/** The embedded C002 expert demand view (present iff experts requested). */
export function embeddedExpertProfileView(
  profile: CrossResourceDemand,
): DemandProfileView | null {
  return profile.expertProfile !== undefined
    ? ((): DemandProfileView => {
        const { digest: _digest, ...view } = profile.expertProfile as DemandProfile;
        return view;
      })()
    : null;
}
