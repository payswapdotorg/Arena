/**
 * Product-truth state marks for the cockpit (Work Order B007; issue #78;
 * apps/web/src/cockpit).
 *
 * The cockpit surfaces canonical data classified through the B003
 * product-truth taxonomy (`classifyState` — 11 CanonicalStateKind terms).
 * The B001 design system renders ten of those kinds with its closed
 * TruthBadge vocabulary; the two honesty-critical kinds B001 has no badge
 * for — `pending` and `unknown` — get their own DISTINCT cockpit marks,
 * because the product truth ("unknown/pending is rendered as
 * unknown/pending — never guessed") forbids collapsing them into any
 * badgeable kind.
 *
 * The mapping below is INJECTIVE on the ten shared kinds: no two different
 * canonical kinds ever render as the same UI kind, so no two product-truth
 * meanings can collapse into one badge on this surface.
 */

import {
  classifyState,
  canonicalStateDescriptor,
} from '../../../../packages/role-context/src/index.js';
import type { CanonicalStateKind } from '../../../../packages/role-context/src/index.js';
import type { StateKind } from '@arena/ui-platform';

/** The UI truth treatment of one canonical kind (a badge kind, or the cockpit's own pending/unknown mark). */
export type CockpitTruthTreatment = StateKind | 'pending' | 'unknown';

/**
 * Canonical kind -> UI treatment. `pending` and `unknown` are deliberately
 * NOT mapped onto any B001 badge kind: they render through the cockpit's
 * own distinct marks with their canonical labels.
 */
export const CANONICAL_KIND_TREATMENT: Readonly<
  Record<CanonicalStateKind, CockpitTruthTreatment>
> = Object.freeze({
  'verified-fact': 'verified',
  evidence: 'evidence',
  'expert-judgment': 'expert-judgment',
  'model-output': 'model-output',
  'simulation-replay': 'simulation',
  'evaluation-result': 'evaluation',
  certification: 'certification',
  'suggestion-hypothesis': 'suggestion',
  'demo-state': 'demo',
  pending: 'pending',
  unknown: 'unknown',
} as const);

/** The distinct UI treatment of a canonical kind (total; closed vocabulary). */
export function truthTreatment(kind: CanonicalStateKind): CockpitTruthTreatment {
  return CANONICAL_KIND_TREATMENT[kind];
}

/**
 * Classify a canonical datum (B003 total classifier) and resolve its UI
 * treatment. Anything unclassifiable is `unknown` — rendered as unknown,
 * never guessed (fail honest).
 */
export function classifyDatum(datum: unknown): {
  readonly kind: CanonicalStateKind;
  readonly treatment: CockpitTruthTreatment;
  readonly label: string;
  readonly meaning: string;
} {
  const kind = classifyState(datum);
  const descriptor = canonicalStateDescriptor(kind);
  return Object.freeze({
    kind,
    treatment: truthTreatment(kind),
    label: descriptor.label,
    meaning: descriptor.meaning,
  });
}

/** True iff the treatment is one of B001's ten badge kinds (vs. the cockpit's pending/unknown marks). */
export function isBadgeTreatment(treatment: CockpitTruthTreatment): treatment is StateKind {
  return treatment !== 'pending' && treatment !== 'unknown';
}

/**
 * The B006 demo product-truth label -> canonical kind. `suggestion` (the
 * demo vocabulary's term) maps onto B003's `suggestion-hypothesis` — the
 * same meaning, one canonical home.
 */
export const DEMO_LABEL_TO_CANONICAL_KIND: Readonly<
  Record<
    | 'verified-fact'
    | 'evidence'
    | 'expert-judgment'
    | 'model-output'
    | 'simulation-replay'
    | 'evaluation-result'
    | 'certification'
    | 'suggestion',
    CanonicalStateKind
  >
> = Object.freeze({
  'verified-fact': 'verified-fact',
  evidence: 'evidence',
  'expert-judgment': 'expert-judgment',
  'model-output': 'model-output',
  'simulation-replay': 'simulation-replay',
  'evaluation-result': 'evaluation-result',
  certification: 'certification',
  suggestion: 'suggestion-hypothesis',
} as const);
