/**
 * Canonical state classification — the product-truth taxonomy (Work Order
 * B003; docs/LLM-ARCHITECT-HANDOFF.md §7 "Product truth vocabulary";
 * spec/post-v1-work-items.md "Product truth requirement").
 *
 * Every user-visible state must indicate whether it is a verified fact,
 * evidence, expert judgment, model output, simulation/replay, evaluation
 * result, certification, suggestion/hypothesis, demo state, pending or
 * unknown. The UI CANNOT collapse these into one generic "AI result",
 * "verified", "score" or "success" badge — so this module ships:
 *
 *   - the closed CanonicalStateKind union (11 kinds);
 *   - classifyState: a TOTAL, deterministic classifier — anything it cannot
 *     classify is 'unknown', never an error, never a silent guess;
 *   - the distinctStateKinds contract: every kind maps to its own display
 *     group (the grouping function is the IDENTITY on kinds), so the ONLY
 *     permitted display equivalence is kind identity. `areStateKindsDisplayEquivalent`
 *     returns true iff the two kinds are the SAME kind — the function the UI
 *     uses to decide whether two states may share a badge.
 *
 * Handoff §7 ground rules encoded as guidance:
 *   - a purchased artifact is not automatically certified;
 *   - a model is not automatically a professional;
 *   - a replay is not a live-world mutation;
 *   - demo state is never customer-authoritative state;
 *   - a role is not permission.
 */

import { ROLE_CONTEXT_ERROR_CODES, RoleContextError } from '../errors.js';
import { CANONICAL_STATE_KINDS } from '../shared.js';
import type { CanonicalStateKind } from '../shared.js';

export const CANONICAL_STATE_RECORD_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

/** One product-truth kind: id, human label, meaning and UI guidance. */
export interface CanonicalStateDescriptor {
  readonly recordVersion: typeof CANONICAL_STATE_RECORD_VERSION;
  readonly kind: CanonicalStateKind;
  readonly label: string;
  readonly meaning: string;
  readonly guidance: string;
}

/**
 * The full descriptor set, RC1.0/handoff §7 verbatim semantics. Deterministic
 * order = CANONICAL_STATE_KINDS order.
 */
const DESCRIPTOR_DATA: readonly Omit<CanonicalStateDescriptor, 'recordVersion'>[] = [
    {
      kind: 'verified-fact',
      label: 'Verified fact',
      meaning: 'A claim checked against an authoritative source by the verification authority.',
      guidance: 'Display as established truth only with its verification provenance.',
    },
    {
      kind: 'evidence',
      label: 'Evidence',
      meaning: 'An artifact that supports or challenges a claim without deciding it.',
      guidance: 'Display as support material; never present evidence as proof.',
    },
    {
      kind: 'expert-judgment',
      label: 'Expert judgment',
      meaning: 'A qualified human professional opinion, attributed to the expert.',
      guidance: 'A model is not automatically a professional; always attribute the expert.',
    },
    {
      kind: 'model-output',
      label: 'Model output',
      meaning: 'Raw output produced by a model; unverified by any authority.',
      guidance: 'Never display model output as verified fact or expert judgment.',
    },
    {
      kind: 'simulation-replay',
      label: 'Simulation / Replay',
      meaning: 'An observational replay of recorded execution; not a live-world mutation.',
      guidance: 'A replay is not a live-world mutation; mark replay views as observational.',
    },
    {
      kind: 'evaluation-result',
      label: 'Evaluation result',
      meaning: 'A measured outcome of running an evaluator against a target.',
      guidance: 'Scoped to the tested composition; never generalize beyond the run.',
    },
    {
      kind: 'certification',
      label: 'Certification',
      meaning: 'A certification claim over the tested composition (Body Version × substrate × config).',
      guidance: 'A purchased artifact is not automatically certified.',
    },
    {
      kind: 'suggestion-hypothesis',
      label: 'Suggestion / Hypothesis',
      meaning: 'A proposal or conjecture awaiting validation.',
      guidance: 'Display as tentative; never as a finding or a result.',
    },
    {
      kind: 'demo-state',
      label: 'Demo state',
      meaning: 'Deterministic demonstration state, not customer-authoritative state.',
      guidance: 'Demo state is never customer-authoritative state; label it visibly.',
    },
    {
      kind: 'pending',
      label: 'Pending',
      meaning: 'A decision or process that is in flight and not yet resolvable.',
      guidance: 'Display as unresolved; do not guess the outcome.',
    },
    {
      kind: 'unknown',
      label: 'Unknown',
      meaning: 'The state cannot be classified with the information available.',
      guidance: 'Fail honest: display unknown rather than collapsing into another badge.',
    },
];

export const CANONICAL_STATE_DESCRIPTORS: readonly CanonicalStateDescriptor[] = Object.freeze(
  DESCRIPTOR_DATA.map((descriptor) =>
    Object.freeze({ recordVersion: CANONICAL_STATE_RECORD_VERSION, ...descriptor }),
  ),
);

// ---------------------------------------------------------------------------
// Classification (total, deterministic)
// ---------------------------------------------------------------------------

/**
 * Classify a state carrier: an object with a `stateKind` field, or a bare
 * kind string. TOTAL and deterministic — an absent/invalid/foreign value
 * classifies as 'unknown' (fail honest), never throws, never guesses a
 * more specific kind.
 */
export function classifyState(candidate: unknown): CanonicalStateKind {
  let raw: unknown;
  if (typeof candidate === 'string') {
    raw = candidate;
  } else if (typeof candidate === 'object' && candidate !== null) {
    raw = (candidate as Record<string, unknown>)['stateKind'];
  } else {
    raw = undefined;
  }
  if (typeof raw === 'string' && (CANONICAL_STATE_KINDS as readonly string[]).includes(raw)) {
    return raw as CanonicalStateKind;
  }
  return 'unknown';
}

/** Strict converter: throws ROLE_CONTEXT_INVALID_STATE for unknown kinds. */
export function toCanonicalStateKind(value: string): CanonicalStateKind {
  if (
    typeof value === 'string' &&
    (CANONICAL_STATE_KINDS as readonly string[]).includes(value)
  ) {
    return value as CanonicalStateKind;
  }
  throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_STATE, {
    message: `unknown canonical state kind: ${JSON.stringify(value)} (known: ${CANONICAL_STATE_KINDS.join(', ')})`,
    details: { known: [...CANONICAL_STATE_KINDS] },
  });
}

/** The descriptor for one kind (throws on unknown kind — closed set). */
export function canonicalStateDescriptor(kind: CanonicalStateKind): CanonicalStateDescriptor {
  const descriptor = CANONICAL_STATE_DESCRIPTORS.find((entry) => entry.kind === kind);
  if (descriptor === undefined) {
    throw new RoleContextError(ROLE_CONTEXT_ERROR_CODES.INVALID_STATE, {
      message: `no descriptor for canonical state kind: ${JSON.stringify(kind)}`,
      details: { known: [...CANONICAL_STATE_KINDS] },
    });
  }
  return descriptor;
}

/** The human label for one kind ('unknown' for anything unclassifiable). */
export function canonicalStateLabel(candidate: unknown): string {
  return canonicalStateDescriptor(classifyState(candidate)).label;
}

// ---------------------------------------------------------------------------
// distinctStateKinds contract (the UI may never collapse kinds)
// ---------------------------------------------------------------------------

/**
 * The distinct-kinds contract: EVERY kind is display-distinct from every
 * other kind. The UI may only share a badge between two states when their
 * kinds are IDENTICAL — see areStateKindsDisplayEquivalent.
 */
export const DISTINCT_STATE_KINDS: readonly CanonicalStateKind[] = CANONICAL_STATE_KINDS;

/**
 * The display group of a kind. INJECTIVE by construction (each kind is its
 * own group): two states share a display group iff they have the same kind.
 * This is the function the UI uses to group badges — because it is injective,
 * no two different product-truth kinds can ever collapse into one badge.
 */
export function stateKindDisplayGroup(kind: CanonicalStateKind): CanonicalStateKind {
  return toCanonicalStateKind(kind);
}

/**
 * True iff two state kinds may be displayed as equivalent: ONLY when they
 * are the SAME kind. Any cross-kind pair (e.g. model-output vs
 * verified-fact, certification vs purchased artifact, demo-state vs live
 * state) is NOT display-equivalent.
 */
export function areStateKindsDisplayEquivalent(
  a: CanonicalStateKind,
  b: CanonicalStateKind,
): boolean {
  return classifyState(a) === classifyState(b);
}

/**
 * Count states by kind, deterministically ordered by CANONICAL_STATE_KINDS.
 * Keys are only kinds with count > 0 (compact, canonical-JSON friendly).
 */
export function countStateKinds(
  candidates: readonly unknown[],
): Readonly<Record<CanonicalStateKind, number>> {
  const counts = new Map<CanonicalStateKind, number>();
  for (const candidate of candidates) {
    const kind = classifyState(candidate);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const result: Partial<Record<CanonicalStateKind, number>> = {};
  for (const kind of CANONICAL_STATE_KINDS) {
    const count = counts.get(kind);
    if (count !== undefined) result[kind] = count;
  }
  return result as Readonly<Record<CanonicalStateKind, number>>;
}
