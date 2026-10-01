/**
 * Product-truth + lifecycle state classification for the Expert Workbench
 * (Work Order B009; issue #81; apps/web/src/expert).
 *
 * EVERY datum this surface renders carries its canonical state
 * classification (the B003 product-truth taxonomy — 11 CanonicalStateKind
 * terms), rendered through an INJECTIVE treatment map: the ten kinds the
 * B001 design system badges get their own TruthBadge kind, and the two
 * honesty-critical kinds B001 has no badge for — `pending` and `unknown` —
 * get their own DISTINCT expert marks, because the product truth ("unknown
 * / pending is rendered as unknown/pending — never guessed") forbids
 * collapsing them into any badgeable kind. No two different canonical
 * kinds can ever render as the same UI kind on this surface.
 *
 * This module ALSO classifies the STRUCTURAL lifecycle states the
 * workbench surfaces — the A005 case lifecycle, the task states canonical
 * case records carry, the A010 run states and the trajectory step kinds
 * (A011 entry kinds ∪ the reference corpus's simplified run-step
 * vocabulary). Structural states are rendered VERBATIM from the canonical
 * record with an honest `recognized` flag; anything the closed
 * vocabularies do not contain classifies as UNKNOWN — rendered as
 * unknown, never guessed, never silently coerced into a nearby state.
 */

import {
  CASE_STATUSES,
  isCaseStatus,
} from '../../../../packages/capability-case/src/index.js';
import { RUN_STATES, isRunState } from '../../../../packages/environment-runtime/src/index.js';
import {
  TRAJECTORY_ENTRY_KINDS,
  TRAJECTORY_OUTCOMES,
  isTrajectoryOutcome,
} from '../../../../packages/trajectory/src/index.js';
import {
  classifyState,
  canonicalStateDescriptor,
} from '../../../../packages/role-context/src/index.js';
import type { CanonicalStateKind } from '../../../../packages/role-context/src/index.js';
import type { StateKind } from '@arena/ui-platform';

// ---------------------------------------------------------------------------
// Product-truth treatments (injective; distinct pending/unknown marks)
// ---------------------------------------------------------------------------

/** The UI truth treatment of one canonical kind (a badge kind, or the expert surface's own pending/unknown mark). */
export type ExpertTruthTreatment = StateKind | 'pending' | 'unknown';

/**
 * Canonical kind -> UI treatment. `pending` and `unknown` are deliberately
 * NOT mapped onto any B001 badge kind: they render through the expert
 * surface's own distinct marks with their canonical labels.
 */
export const EXPERT_KIND_TREATMENT: Readonly<
  Record<CanonicalStateKind, ExpertTruthTreatment>
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
export function truthTreatment(kind: CanonicalStateKind): ExpertTruthTreatment {
  return EXPERT_KIND_TREATMENT[kind];
}

/**
 * Classify a canonical datum (B003 total classifier) and resolve its UI
 * treatment. Anything unclassifiable is `unknown` — rendered as unknown,
 * never guessed (fail honest).
 */
export function classifyDatum(datum: unknown): {
  readonly kind: CanonicalStateKind;
  readonly treatment: ExpertTruthTreatment;
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

/** True iff the treatment is one of B001's ten badge kinds (vs. the expert surface's pending/unknown marks). */
export function isBadgeTreatment(treatment: ExpertTruthTreatment): treatment is StateKind {
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

// ---------------------------------------------------------------------------
// Structural lifecycle states (rendered verbatim; unknown never guessed)
// ---------------------------------------------------------------------------

/** One structural lifecycle state as carried by a canonical record (verbatim value + honest recognition). */
export interface StructuralState {
  /** The state value EXACTLY as the canonical record carries it. */
  readonly value: string;
  /** True iff the value is inside the closed canonical vocabulary for this state. */
  readonly recognized: boolean;
}

/** The closed A005 capability-case lifecycle vocabulary (single source of truth). */
export const CASE_LIFECYCLE_STATUSES: readonly string[] = Object.freeze([...CASE_STATUSES]);

/** Terminal A005 case statuses (final, immutable-by-transition, forever addressable). */
export const CASE_LIFECYCLE_TERMINAL: readonly string[] = Object.freeze(['resolved', 'superseded']);

/** Classify a case lifecycle value against the A005 vocabulary (verbatim carry; unknown stays unknown). */
export function caseLifecycle(value: unknown): StructuralState {
  return Object.freeze({
    value: typeof value === 'string' ? value : '',
    recognized: isCaseStatus(value),
  });
}

/**
 * The task-state vocabulary canonical case records carry today (the
 * reference corpus's task entries). This is a PRESENTATION recognition
 * set — the state VALUE always renders verbatim from the record; states
 * outside the set render as unknown, never coerced.
 */
export const EXPERT_TASK_STATES = Object.freeze([
  'pending',
  'in-progress',
  'in-review',
  'blocked',
  'completed',
] as const);

export type ExpertTaskState = (typeof EXPERT_TASK_STATES)[number];

/** The closed presentation class of one task state (how the queue groups it). */
export type ExpertTaskStateClass =
  | 'awaiting-expert'
  | 'in-flight'
  | 'blocked'
  | 'done'
  | 'unknown';

const TASK_STATE_CLASSES: Readonly<Record<ExpertTaskState, ExpertTaskStateClass>> =
  Object.freeze({
    pending: 'awaiting-expert',
    'in-progress': 'in-flight',
    'in-review': 'awaiting-expert',
    blocked: 'blocked',
    completed: 'done',
  } as const);

/** Classify a carried task state into its presentation class (unknown for anything unrecognized). */
export function taskStateClass(value: unknown): {
  readonly state: StructuralState;
  readonly class: ExpertTaskStateClass;
} {
  const state: StructuralState = Object.freeze({
    value: typeof value === 'string' ? value : '',
    recognized:
      typeof value === 'string' &&
      (EXPERT_TASK_STATES as readonly string[]).includes(value),
  });
  const cls: ExpertTaskStateClass = state.recognized
    ? TASK_STATE_CLASSES[value as ExpertTaskState]
    : 'unknown';
  return Object.freeze({ state, class: cls });
}

/** True iff the class means the task still needs work (open from the expert lens). */
export function isOpenTaskClass(cls: ExpertTaskStateClass): boolean {
  return cls === 'awaiting-expert' || cls === 'in-flight' || cls === 'blocked';
}

/** The closed A010 run-state vocabulary (requested → … → cleaned; single source of truth). */
export const RUN_STATE_VOCABULARY: readonly string[] = Object.freeze([...RUN_STATES]);

/** Terminal A010 run states (outcome states + the absorbing cleaned state). */
export const RUN_TERMINAL_STATES: readonly string[] = Object.freeze([
  'completed',
  'failed',
  'timed-out',
  'cleaned',
]);

/** Classify a carried run state against the A010 vocabulary (verbatim carry; unknown stays unknown). */
export function runState(value: unknown): StructuralState {
  return Object.freeze({
    value: typeof value === 'string' ? value : '',
    recognized: isRunState(value),
  });
}

/**
 * The trajectory step-kind vocabulary this surface recognizes: the A011
 * trajectory entry kinds (action/observation/checkpoint/error/completion)
 * ∪ the reference corpus's simplified run-step vocabulary
 * (observation/action/tool/result/model-output). Steps outside the set
 * render as unknown step kinds — never guessed into a neighbor.
 */
export const TRAJECTORY_STEP_KINDS: readonly string[] = Object.freeze([
  ...TRAJECTORY_ENTRY_KINDS,
  'tool',
  'result',
  'model-output',
]);

/** Classify one trajectory step's type (verbatim carry; unknown stays unknown). */
export function trajectoryStepKind(value: unknown): StructuralState {
  return Object.freeze({
    value: typeof value === 'string' ? value : '',
    recognized:
      typeof value === 'string' &&
      (TRAJECTORY_STEP_KINDS as readonly string[]).includes(value),
  });
}

/**
 * The trajectory/run outcome vocabulary (A011 TRAJECTORY_OUTCOMES, which
 * mirrors A010 RUN_OUTCOME_STATES exactly: completed | failed | timed-out).
 */
export const TRAJECTORY_OUTCOME_VOCABULARY: readonly string[] = Object.freeze([
  ...TRAJECTORY_OUTCOMES,
]);

/** Classify a carried trajectory outcome (verbatim carry; unknown stays unknown). */
export function trajectoryOutcome(value: unknown): StructuralState {
  return Object.freeze({
    value: typeof value === 'string' ? value : '',
    recognized: isTrajectoryOutcome(value),
  });
}

/**
 * The closed map of trajectory step kinds that ALSO assert a product-truth
 * kind of their own: a `model-output` step is raw model output (unverified
 * by any authority) and is badged as such; every other recognized step
 * kind is recorded run data whose product-truth classification is the
 * replay itself (the timeline renders the simulation/replay badge at the
 * section level — see the workbench views).
 */
export const TRUTH_ASSERTING_STEP_KINDS: Readonly<Record<'model-output', CanonicalStateKind>> =
  Object.freeze({ 'model-output': 'model-output' } as const);

/**
 * True iff the trajectory step kind is one of the truth-asserting kinds
 * (the only steps whose own canonical kind differs from the replay
 * umbrella classification).
 */
export function isTruthAssertingStepKind(step: StructuralState): boolean {
  return (
    step.recognized &&
    Object.prototype.hasOwnProperty.call(TRUTH_ASSERTING_STEP_KINDS, step.value)
  );
}
