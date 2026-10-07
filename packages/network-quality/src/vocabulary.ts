/**
 * The closed network-quality VOCABULARIES (Work Order C020; issue #126).
 *
 * DEVIATION NOTE (no dedicated canonical network-quality spec — recorded as
 * architecture questions in the PR): the vocabularies below are DERIVED from
 * the C020 work-items row (spec/human-escalation-work-items.md), the AE1.0
 * "Raw community signal" guardrail list (spec/adversarial-expert-evaluation.md),
 * FINAL-HANDOFF §7/§18 adversarial cases, spec/security.md laws and
 * spec/quality-model.md ("never a single global score"). They are versioned
 * constants — changing any of them is a new vocabulary version, never an
 * in-place mutation.
 *
 *   - REPUTATION_FAMILIES   — the five dimensional record families of the
 *                             reputation evidence log;
 *   - DISPUTE_STATES        — the dispute state machine;
 *   - DISPUTE_RESOLUTION_OUTCOMES — the typed resolution outcomes;
 *   - COI_KINDS             — declared + derived conflict-of-interest kinds;
 *   - COI_CHECK_VERDICTS    — clear | conflicted-with-reasons |
 *                             unknown-insufficient-data;
 *   - FINDING_KINDS         — anti-gaming + fraud finding kinds;
 *   - ENFORCEMENT_ACTIONS   — HOLD | SUSPEND | INVESTIGATE.
 */

import { NETWORK_QUALITY_ERROR_CODES, NetworkQualityError } from './errors.js';

/** Wire version of the network-quality vocabularies. */
export const NETWORK_QUALITY_VOCABULARY_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Dimensional reputation record families
// ---------------------------------------------------------------------------

/**
 * The five dimensional record families of the reputation evidence log
 * (C020 work order): each reputation evidence record belongs to EXACTLY
 * ONE family; a cross-family record or aggregate is structurally
 * unavailable (the no-single-global-score law, spec/quality-model.md).
 */
export const REPUTATION_FAMILIES = Object.freeze([
  'dispute-outcome',
  'competition-agreement',
  'validation-outcome',
  'coi-record',
  'conduct-flag',
] as const);

export type ReputationFamily = (typeof REPUTATION_FAMILIES)[number];

/** The closed outcome vocabulary per reputation family. */
export const REPUTATION_FAMILY_OUTCOMES: Readonly<Record<ReputationFamily, readonly string[]>> =
  Object.freeze({
    'dispute-outcome': Object.freeze(['upheld', 'partially-upheld', 'dismissed', 'inconclusive']),
    'competition-agreement': Object.freeze([
      'agreed',
      'partial',
      'disagreed',
      'inconclusive',
    ]),
    'validation-outcome': Object.freeze([
      'accepted',
      'accepted-with-revision',
      'rejected',
      'inconclusive',
    ]),
    'coi-record': Object.freeze(['conflict-declared', 'conflict-derived', 'none-declared']),
    'conduct-flag': Object.freeze([
      'flag-raised',
      'flag-substantiated',
      'flag-dismissed',
      'inconclusive',
    ]),
  } as const);

/**
 * The applicability-context fields each family REQUIRES on its records —
 * an evidence record without its applicability context is not admissible.
 */
export const REPUTATION_FAMILY_REQUIRED_CONTEXT: Readonly<
  Record<ReputationFamily, readonly string[]>
> = Object.freeze({
  'dispute-outcome': Object.freeze(['domain']),
  'competition-agreement': Object.freeze(['taskFamily']),
  'validation-outcome': Object.freeze(['taskFamily']),
  'coi-record': Object.freeze(['domain']),
  'conduct-flag': Object.freeze(['domain']),
} as const);

/**
 * The evidence source surfaces reputation records accumulate from (the
 * merged dep public surfaces — structural mirrors of THEIR vocabularies,
 * never writes into their state): C009 adjudication outcomes, C013
 * competition judgments/adjudications, C010 payment audit events, and the
 * C020-owned dispute/COI/enforcement records themselves.
 */
export const REPUTATION_SOURCE_SURFACES = Object.freeze([
  'escalation-validation',
  'adversarial-evaluation',
  'payments',
  'expert-engagement',
  'expert-registry',
  'network-quality',
] as const);

export type ReputationSourceSurface = (typeof REPUTATION_SOURCE_SURFACES)[number];

/**
 * Which families each source surface may feed (closed mapping). An
 * ingestion attempt outside this table fails closed with
 * NETWORK_QUALITY_INVALID_SOURCE — evidence cannot be booked into a
 * family its provenance surface does not speak about.
 */
const SOURCE_SURFACE_FAMILIES_TABLE = {
  'escalation-validation': ['validation-outcome', 'conduct-flag'],
  'adversarial-evaluation': ['competition-agreement', 'conduct-flag'],
  payments: ['conduct-flag'],
  'expert-engagement': ['conduct-flag'],
  'expert-registry': ['conduct-flag'],
  'network-quality': [
    'dispute-outcome',
    'coi-record',
    'conduct-flag',
    'validation-outcome',
    'competition-agreement',
  ],
} as const;

export const SOURCE_SURFACE_FAMILIES: Readonly<
  Record<ReputationSourceSurface, readonly ReputationFamily[]>
> = Object.freeze(SOURCE_SURFACE_FAMILIES_TABLE);

// ---------------------------------------------------------------------------
// The dispute state machine
// ---------------------------------------------------------------------------

/**
 * The dispute lifecycle (C020 work order): OPEN -> UNDER_REVIEW ->
 * RESOLVED-with-typed-outcome, with ESCALATED and WITHDRAWN states.
 * RESOLVED and WITHDRAWN are terminal; every transition appends (lock
 * rule 6) and carries machine-readable reasons.
 */
export const DISPUTE_STATES = Object.freeze([
  'OPEN',
  'UNDER_REVIEW',
  'ESCALATED',
  'RESOLVED',
  'WITHDRAWN',
] as const);

export type DisputeState = (typeof DISPUTE_STATES)[number];

/** The ONLY legal dispute transitions out of each state. */
export const DISPUTE_TRANSITIONS: Readonly<Record<DisputeState, readonly DisputeState[]>> =
  Object.freeze({
    OPEN: Object.freeze(['UNDER_REVIEW', 'ESCALATED', 'WITHDRAWN'] as readonly DisputeState[]),
    UNDER_REVIEW: Object.freeze(['RESOLVED', 'ESCALATED', 'WITHDRAWN'] as readonly DisputeState[]),
    ESCALATED: Object.freeze(['UNDER_REVIEW', 'RESOLVED', 'WITHDRAWN'] as readonly DisputeState[]),
    RESOLVED: Object.freeze([] as readonly DisputeState[]),
    WITHDRAWN: Object.freeze([] as readonly DisputeState[]),
  });

/** The typed resolution outcomes (RESOLVED-with-typed-outcome). */
export const DISPUTE_RESOLUTION_OUTCOMES = Object.freeze([
  'upheld',
  'partially-upheld',
  'dismissed',
  'inconclusive',
] as const);

export type DisputeResolutionOutcome = (typeof DISPUTE_RESOLUTION_OUTCOMES)[number];

/** The machine-readable reason codes a dispute transition may cite (closed). */
export const DISPUTE_TRANSITION_REASONS = Object.freeze([
  'intake-accepted',
  'reviewer-assigned',
  'reviewer-coi-excluded',
  'escalation-requested',
  'additional-evidence-required',
  'resolved-on-evidence',
  'resolved-by-default',
  'withdrawn-by-complainant',
  'superseded',
] as const);

export type DisputeTransitionReason = (typeof DISPUTE_TRANSITION_REASONS)[number];

// ---------------------------------------------------------------------------
// The conflict-of-interest registry
// ---------------------------------------------------------------------------

/**
 * Declared + derived conflict-of-interest kinds (C020 work order): tenant
 * overlap, prior engagement, marketplace interest — plus impersonation
 * declared as a COI-adjacent identity conflict.
 */
export const COI_KINDS = Object.freeze([
  'tenant-overlap',
  'prior-engagement',
  'marketplace-interest',
] as const);

export type CoiKind = (typeof COI_KINDS)[number];

/** Whether a COI record was declared by a party or derived by the system. */
export const COI_ORIGINS = Object.freeze(['declared', 'derived'] as const);
export type CoiOrigin = (typeof COI_ORIGINS)[number];

/** The typed COI-check verdicts exposed as the read port. */
export const COI_CHECK_VERDICTS = Object.freeze([
  'clear',
  'conflicted-with-reasons',
  'unknown-insufficient-data',
] as const);

export type CoiCheckVerdict = (typeof COI_CHECK_VERDICTS)[number];

// ---------------------------------------------------------------------------
// Anti-gaming + fraud findings
// ---------------------------------------------------------------------------

/**
 * The closed finding vocabulary (AE1.0 guardrail mirror + C020 work
 * order): every finding is TYPED, carries evidence refs and
 * machine-readable reasons, and PROPOSES actions — never silently
 * adjusts anything.
 */
export const FINDING_KINDS = Object.freeze([
  // anti-gaming (C013 voting data + engagement/availability signals)
  'self-voting-attempt',
  'duplicate-account-sybil',
  'coordinated-brigading',
  'rate-limit-breach',
  'capacity-gaming',
  // fraud (C010 payment records + identity signals)
  'duplicate-payout-attempt',
  'payout-velocity-anomaly',
  'expert-impersonation',
] as const);

export type FindingKind = (typeof FINDING_KINDS)[number];

/** The finding categories (anti-gaming vs fraud — different ingestion seams). */
export const FINDING_CATEGORIES = Object.freeze(['anti-gaming', 'fraud'] as const);
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** Which category each finding kind belongs to (closed mapping). */
export const FINDING_KIND_CATEGORY: Readonly<Record<FindingKind, FindingCategory>> =
  Object.freeze({
    'self-voting-attempt': 'anti-gaming',
    'duplicate-account-sybil': 'anti-gaming',
    'coordinated-brigading': 'anti-gaming',
    'rate-limit-breach': 'anti-gaming',
    'capacity-gaming': 'anti-gaming',
    'duplicate-payout-attempt': 'fraud',
    'payout-velocity-anomaly': 'fraud',
    'expert-impersonation': 'fraud',
  });

/** The machine-readable severity vocabulary (proposal-relevant, never enforcement). */
export const FINDING_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical'] as const);
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/** The evidence surfaces findings derive from (closed). */
export const FINDING_SOURCE_SURFACES = Object.freeze([
  'adversarial-evaluation',
  'payments',
  'expert-engagement',
  'expert-registry',
] as const);

export type FindingSourceSurface = (typeof FINDING_SOURCE_SURFACES)[number];

// ---------------------------------------------------------------------------
// Enforcement actions (explicit state transitions, never silent drops)
// ---------------------------------------------------------------------------

/**
 * The enforcement-action vocabulary (C020 work order): HOLD / SUSPEND /
 * INVESTIGATE — each an EXPLICIT state transition over an enforcement
 * case with append-only audit history. Network quality NEVER drops,
 * adjusts or revokes anything silently.
 */
export const ENFORCEMENT_ACTIONS = Object.freeze(['HOLD', 'SUSPEND', 'INVESTIGATE'] as const);
export type EnforcementAction = (typeof ENFORCEMENT_ACTIONS)[number];

/** The enforcement-case states. */
export const ENFORCEMENT_CASE_STATES = Object.freeze([
  'OPEN',
  'ACTION_PROPOSED',
  'ACTION_ACTIVE',
  'ACTION_RELEASED',
  'CLOSED',
] as const);

export type EnforcementCaseState = (typeof ENFORCEMENT_CASE_STATES)[number];

// ---------------------------------------------------------------------------
// Validators (fail closed on unknown values)
// ---------------------------------------------------------------------------

export function isReputationFamily(value: unknown): value is ReputationFamily {
  return (
    typeof value === 'string' && (REPUTATION_FAMILIES as readonly string[]).includes(value)
  );
}

export function isDisputeState(value: unknown): value is DisputeState {
  return typeof value === 'string' && (DISPUTE_STATES as readonly string[]).includes(value);
}

export function isDisputeResolutionOutcome(value: unknown): value is DisputeResolutionOutcome {
  return (
    typeof value === 'string' &&
    (DISPUTE_RESOLUTION_OUTCOMES as readonly string[]).includes(value)
  );
}

export function isDisputeTransitionReason(value: unknown): value is DisputeTransitionReason {
  return (
    typeof value === 'string' &&
    (DISPUTE_TRANSITION_REASONS as readonly string[]).includes(value)
  );
}

export function isCoiKind(value: unknown): value is CoiKind {
  return typeof value === 'string' && (COI_KINDS as readonly string[]).includes(value);
}

export function isCoiOrigin(value: unknown): value is CoiOrigin {
  return typeof value === 'string' && (COI_ORIGINS as readonly string[]).includes(value);
}

export function isCoiCheckVerdict(value: unknown): value is CoiCheckVerdict {
  return typeof value === 'string' && (COI_CHECK_VERDICTS as readonly string[]).includes(value);
}

export function isFindingKind(value: unknown): value is FindingKind {
  return typeof value === 'string' && (FINDING_KINDS as readonly string[]).includes(value);
}

export function isFindingSeverity(value: unknown): value is FindingSeverity {
  return typeof value === 'string' && (FINDING_SEVERITIES as readonly string[]).includes(value);
}

export function isEnforcementAction(value: unknown): value is EnforcementAction {
  return (
    typeof value === 'string' && (ENFORCEMENT_ACTIONS as readonly string[]).includes(value)
  );
}

/** Validate + return the closed reputation family (fail closed on unknown). */
export function toReputationFamily(value: unknown, context: string): ReputationFamily {
  if (!isReputationFamily(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_FAMILY, {
      message: `${context}: unknown reputation record family: ${JSON.stringify(String(value))} (closed vocabulary of ${String(REPUTATION_FAMILIES.length)})`,
      details: { known: REPUTATION_FAMILIES },
    });
  }
  return value;
}

/** Validate + return the closed outcome for a family (fail closed). */
export function toReputationFamilyOutcome(
  family: ReputationFamily,
  value: unknown,
  context: string,
): string {
  const known = REPUTATION_FAMILY_OUTCOMES[family];
  if (typeof value !== 'string' || !known.includes(value)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_OUTCOME, {
      message: `${context}: outcome '${String(value)}' is not in the closed vocabulary of reputation family '${family}'`,
      details: { family, known },
    });
  }
  return value;
}

/** Validate the (surface → family) ingestion mapping (fail closed). */
export function toSourceSurfaceFamily(
  surface: unknown,
  family: unknown,
  context: string,
): { surface: ReputationSourceSurface; family: ReputationFamily } {
  if (
    typeof surface !== 'string' ||
    !(REPUTATION_SOURCE_SURFACES as readonly string[]).includes(surface)
  ) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: unknown reputation source surface: ${JSON.stringify(String(surface))}`,
      details: { known: REPUTATION_SOURCE_SURFACES },
    });
  }
  const typedSurface = surface as ReputationSourceSurface;
  const target = toReputationFamily(family, context);
  const allowed = SOURCE_SURFACE_FAMILIES[typedSurface];
  if (!allowed.includes(target)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_SOURCE, {
      message: `${context}: source surface '${typedSurface}' cannot feed reputation family '${target}' (closed mapping)`,
      details: { surface: typedSurface, family: target, allowed },
    });
  }
  return { surface: typedSurface, family: target };
}

/** Validate a dispute transition against the closed transition table. */
export function toDisputeTransition(
  from: DisputeState,
  to: unknown,
  context: string,
): DisputeState {
  if (!isDisputeState(to)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `${context}: unknown dispute state: ${JSON.stringify(String(to))}`,
      details: { known: DISPUTE_STATES },
    });
  }
  if (!DISPUTE_TRANSITIONS[from].includes(to)) {
    throw new NetworkQualityError(NETWORK_QUALITY_ERROR_CODES.INVALID_TRANSITION, {
      message: `${context}: dispute state transition ${from} -> ${to} is not legal (closed transition table)`,
      details: { from, to, legal: DISPUTE_TRANSITIONS[from] },
    });
  }
  return to;
}
