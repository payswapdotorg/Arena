/**
 * Product-truth state marks for the operations surface (Work Order B014;
 * apps/web/src/operations — the cockpit/expert/evaluation state-mark
 * pattern).
 *
 * The B014 product truths live or die here:
 *
 *   - every user-visible state carries its truth class — the CLOSED
 *     eleven-kind B003 canonical taxonomy (verified-fact, evidence,
 *     expert-judgment, model-output, simulation-replay, evaluation-result,
 *     certification, suggestion-hypothesis, demo-state, pending, unknown),
 *     never one generic "AI result";
 *   - a job's lifecycle state renders as the verified fact of a
 *     control-plane job record — never an optimistic completion; an
 *     unreadable record renders `unknown`, a distinct truthful state,
 *     never a guess and never a silent success;
 *   - an SLO verdict is an evaluation result — a MEASUREMENT bound to its
 *     window, never a promise; an SLO without data renders "no data",
 *     never a fabricated number;
 *   - an audit record is EVIDENCE — append-only, digest-chained, and
 *     attributed to its actor; no editable-history affordance exists;
 *   - a capacity posture is a fail-closed verified fact: exhaustion and
 *     disabled states render explicitly and NEVER silently degrade to
 *     "unlimited" — and no billable fallback exists anywhere in the type
 *     system.
 *
 * The classification is the CANONICAL B003 classifier (`classifyState`,
 * total and deterministic — anything unclassifiable is `unknown`, never an
 * error, never a silent guess). There is NO second truth model here: this
 * module only projects canonical kinds onto injective UI treatments.
 *
 * INJECTIVITY CONTRACT (tested): the kind -> treatment map is injective —
 * no two different truth classes ever render as the same treatment, so no
 * two product-truth meanings can collapse into one badge on this surface.
 * The ten badgeable treatments reuse the frozen B001 `TruthBadge`
 * vocabulary (each with its own color, marker shape and label); `pending`
 * and `unknown` render through this surface's own DISTINCT dashed/dotted
 * marks with their canonical labels — they can never collapse into a
 * badgeable kind.
 */

import {
  canonicalStateDescriptor,
  classifyState,
} from '../../../../packages/role-context/src/index.js';
import type { CanonicalStateKind } from '../../../../packages/role-context/src/index.js';
import type { StateKind } from '@arena/ui-platform';

/** A truth class: exactly the closed B003 canonical state taxonomy (11 kinds). */
export type TruthClass = CanonicalStateKind;

/**
 * The UI truth treatment of one truth class: one of B001's ten badge
 * kinds, or this surface's own `pending`/`unknown` marks.
 */
export type TruthTreatment = StateKind | 'pending' | 'unknown';

/**
 * Truth class -> UI treatment. INJECTIVE on the eleven classes: the ten
 * badgeable classes map one-to-one onto the ten B001 badge kinds, and the
 * two honesty-critical classes (`pending`, `unknown`) map onto their own
 * non-badge treatments — deliberately NOT onto any badge kind.
 */
export const TRUTH_CLASS_TREATMENT: Readonly<Record<TruthClass, TruthTreatment>> =
  Object.freeze({
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

/** The distinct UI treatment of one truth class (total; closed vocabulary). */
export function truthClassTreatment(kind: TruthClass): TruthTreatment {
  return TRUTH_CLASS_TREATMENT[kind];
}

/** True iff the treatment is one of B001's ten badge kinds (vs. this surface's pending/unknown marks). */
export function isBadgeTreatment(treatment: TruthTreatment): treatment is StateKind {
  return treatment !== 'pending' && treatment !== 'unknown';
}

/** One truth-class mark: the class, its treatment, and its canonical label + meaning. */
export interface TruthClassMark {
  readonly truthClass: TruthClass;
  readonly treatment: TruthTreatment;
  /** The canonical human label (always rendered — meaning never rests on color alone). */
  readonly label: string;
  /** The canonical one-line product-truth meaning (tooltips / teaching UI). */
  readonly meaning: string;
}

/**
 * The eleven truth-class marks, in canonical order. Every mark is distinct
 * on EVERY channel (treatment, label, meaning): the mark SET is injective
 * over the class set — no two classes share a mark.
 */
export const TRUTH_CLASS_MARKS: readonly TruthClassMark[] = Object.freeze(
  (Object.keys(TRUTH_CLASS_TREATMENT) as readonly TruthClass[]).map((kind) => {
    const descriptor = canonicalStateDescriptor(kind);
    return Object.freeze({
      truthClass: kind,
      treatment: TRUTH_CLASS_TREATMENT[kind],
      label: descriptor.label,
      meaning: descriptor.meaning,
    } satisfies TruthClassMark);
  }),
);

/** The distinct mark of one truth class (throws on a foreign kind — closed set). */
export function truthClassMark(kind: TruthClass): TruthClassMark {
  const mark = TRUTH_CLASS_MARKS.find((candidate) => candidate.truthClass === kind);
  if (mark === undefined) {
    throw new Error(`no truth-class mark for ${JSON.stringify(kind)} (closed B003 taxonomy)`);
  }
  return mark;
}

/** The outcome of classifying one truth carrier (a datum carrying a `stateKind`, or a bare kind string). */
export interface TruthClassification {
  readonly truthClass: TruthClass;
  readonly treatment: TruthTreatment;
  readonly label: string;
  readonly meaning: string;
}

/**
 * Classify a truth carrier through the TOTAL canonical B003 classifier and
 * resolve its mark. Anything unclassifiable is `unknown` — rendered as
 * unknown, never guessed (fail honest).
 */
export function classifyTruthCarrier(datum: unknown): TruthClassification {
  const kind = classifyState(datum);
  const descriptor = canonicalStateDescriptor(kind);
  return Object.freeze({
    truthClass: kind,
    treatment: TRUTH_CLASS_TREATMENT[kind],
    label: descriptor.label,
    meaning: descriptor.meaning,
  } satisfies TruthClassification);
}

// ---------------------------------------------------------------------------
// The B014 governing distinctions (carried as frozen data, rendered verbatim)
// ---------------------------------------------------------------------------

/** SLOs are measurements, not promises — carried on every SLO view. */
export const OPERATIONS_SLO_MEASUREMENT_NOTE =
  'SLOs are measurements, not promises: every verdict is a measured evaluation over an explicit window with a minimum sample count. An SLO without data renders "no data" — never a fabricated number, never a pass.';

/** The fail-closed free-tier guarantee — carried on every capacity view. */
export const OPERATIONS_NO_BILLABLE_FALLBACK_NOTE =
  'Free-tier capacity fails closed: an exhausted or disabled provider never silently degrades to "unlimited" and never switches to a billable path. The exhaustion policy has exactly one inhabitant — fail-closed — and no alternate route is representable.';

/** The append-only audit guarantee — carried on every audit view. */
export const OPERATIONS_AUDIT_APPEND_ONLY_NOTE =
  'Audit records are append-only evidence: sequenced, digest-chained and tamper-evident, attributed to their actor and correlation id. History is never edited, removed or re-sorted here.';

/** The honest job-lifecycle guarantee — carried on every jobs view. */
export const OPERATIONS_JOB_HONESTY_NOTE =
  'Jobs render their actual lifecycle state (queued / running / succeeded / failed / cancelled) as recorded facts of the control-plane job record — never an optimistic completion. An unreadable record renders unknown, a distinct truthful state.';

/**
 * The truth-class legend rows for the teaching UI: every class, its mark
 * label, and its meaning — the surface's own honesty contract, rendered
 * visibly so no truth class is ever a mystery glyph.
 */
export function truthClassLegend(): readonly TruthClassMark[] {
  return TRUTH_CLASS_MARKS;
}
