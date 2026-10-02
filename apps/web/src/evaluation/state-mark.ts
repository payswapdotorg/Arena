/**
 * Product-truth state marks for the evaluation/verification/certification
 * and research surfaces (Work Order B012; issue #87;
 * apps/web/src/evaluation — SHARED with apps/web/src/research).
 *
 * The B012 product truths live or die here:
 *
 *   - every user-visible state carries its truth class — the CLOSED
 *     eleven-kind B003 canonical taxonomy (verified-fact, evidence,
 *     expert-judgment, model-output, simulation-replay, evaluation-result,
 *     certification, suggestion-hypothesis, demo-state, pending, unknown),
 *     never one generic "AI result";
 *   - an evaluation result NEVER renders as verified; a certification NEVER
 *     renders as a bare-model claim; verification renders as its own class
 *     with its verifier identity and scope;
 *   - unknown/pending are honesty-critical kinds the B001 badge vocabulary
 *     has no badge for — they get their own DISTINCT marks here (the B007
 *     cockpit state-mark pattern), so they can never collapse into a
 *     badgeable kind.
 *
 * The classification is the CANONICAL B003 classifier (`classifyState`,
 * total and deterministic — anything unclassifiable is `unknown`, never an
 * error, never a silent guess). There is NO second truth model here: this
 * module only projects canonical kinds onto injective UI treatments.
 *
 * INJECTIVITY CONTRACT (tested): the kind -> treatment map is injective —
 * no two different truth classes ever render as the same treatment, so no
 * two product-truth meanings can collapse into one badge on these
 * surfaces. The ten badgeable treatments reuse the frozen B001
 * `TruthBadge` vocabulary (each with its own color, marker shape and
 * label); `pending` and `unknown` render through this surface's own
 * distinct dashed/dotted marks with their canonical labels.
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
// The B012 governing distinctions (carried as frozen data, rendered verbatim)
// ---------------------------------------------------------------------------

/** The persistent, unmistakable distinction of the evaluation surface. */
export const EVALUATION_DISTINCTION_NOTE =
  'Evaluation ≠ Verification ≠ Certification. An evaluation result is a score against explicit criteria; verification establishes evidence support; certification is a scoped claim over a tested composition (Body Version × Substrate × Environment × Runtime × Suite). None of them collapses into the others.';

/** Carried on every evaluation report view: an evaluation result is never a verification claim. */
export const EVALUATION_NOT_VERIFIED_NOTE =
  'This is an evaluation result — a score against an explicit, versioned criteria set under recorded run conditions. It is NOT a verification outcome and carries no evidence-support claim.';

/** Carried on every verification detail view: verification never emits a score. */
export const VERIFICATION_NOT_EVALUATION_NOTE =
  'This is a verification record — it establishes which required evidence exists and supports which claims, with a closed pass | fail | unknown outcome. It NEVER carries a score or graded judgment.';

/** Carried on every certification detail view: certification is composition-scoped, never a bare-model claim. */
export const CERTIFICATION_SCOPE_NOTE =
  'Certification applies to the tested composition — Body Version × Substrate × Environment × Runtime × Certification Suite — never to a model in isolation, never to a marketplace purchase, and never to an expert qualification.';

/** Carried on every research benchmark view (A030 posture: model benchmarks are distinct from body certifications). */
export const RESEARCH_COMPOSITION_SCOPE_NOTE =
  'A benchmark result is a statement about a body version, possessed by a substrate, under an environment and runtime, scored on a named benchmark at a pinned revision — it is NEVER a statement about the model alone.';

/**
 * The truth-class legend rows for the teaching UI: every class, its mark
 * label, and its meaning — the surface's own honesty contract, rendered
 * visibly so no truth class is ever a mystery glyph.
 */
export function truthClassLegend(): readonly TruthClassMark[] {
  return TRUTH_CLASS_MARKS;
}
