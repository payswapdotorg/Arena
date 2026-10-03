/**
 * Replay-surface truth treatments (Work Order B011; issue #87→#86;
 * apps/web/src/replay — the B012 evaluation state-mark posture).
 *
 * The B011 product truths live or die here:
 *
 *   - every user-visible state carries its truth class — the CLOSED
 *     eleven-kind B003 canonical taxonomy (verified-fact, evidence,
 *     expert-judgment, model-output, simulation-replay,
 *     evaluation-result, certification, suggestion-hypothesis,
 *     demo-state, pending, unknown), never one generic "AI result";
 *   - a replayed trajectory step or environment event ALWAYS renders as
 *     SIMULATION-REPLAY — never as a result, never as verified;
 *   - unknown/pending are honesty-critical kinds the B001 badge
 *     vocabulary has no badge for — they get their own DISTINCT marks
 *     here, so they can never collapse into a badgeable kind.
 *
 * The class set + classification come from @arena/replay-ui (which
 * itself projects the canonical B003 classifier); this module maps the
 * classes onto INJECTIVE UI treatments (the ten B001 TruthBadge kinds
 * plus this surface's own pending/unknown marks) — no second truth
 * model, only injective UI treatments.
 */

import type { StateKind } from '@arena/ui-platform';
import type { ReplayTruthClass } from '../../../../packages/replay-ui/src/index.js';

/** The UI truth treatment of one truth class: a B001 badge kind, or this surface's pending/unknown marks. */
export type ReplayTruthTreatment = StateKind | 'pending' | 'unknown';

/**
 * Truth class -> UI treatment. INJECTIVE on the eleven classes: the ten
 * badgeable classes map one-to-one onto the ten B001 badge kinds, and
 * the two honesty-critical classes (`pending`, `unknown`) map onto
 * their own non-badge treatments — deliberately NOT onto any badge.
 */
export const REPLAY_TRUTH_CLASS_TREATMENT: Readonly<
  Record<ReplayTruthClass, ReplayTruthTreatment>
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

/** The distinct UI treatment of one truth class (total; closed vocabulary). */
export function replayTruthClassTreatment(kind: ReplayTruthClass): ReplayTruthTreatment {
  return REPLAY_TRUTH_CLASS_TREATMENT[kind];
}

/** True iff the treatment is one of B001's ten badge kinds (vs. this surface's pending/unknown marks). */
export function isReplayBadgeTreatment(treatment: ReplayTruthTreatment): treatment is StateKind {
  return treatment !== 'pending' && treatment !== 'unknown';
}

/** The replay surface's own distinction note (rendered on every screen). */
export const REPLAY_DISTINCTION_NOTE =
  'Replay is the append-only record of what an agent DID inside a run — simulation-replay truth, never a result. Evaluation results, verification outcomes, certifications and evidence are DISTINCT classes, each rendered under its own mark; none of them collapses into a generic "AI result".';

/** Carried next to the role switcher: a lens is emphasis, never authorization. */
export const REPLAY_ROLE_LENS_NOTE =
  'Role context is a lens — it changes what this surface emphasizes, never what you may read. Requests for a role you were not granted are answered with a truthful denial, never a faked switch.';

/** The truth-class label lookup for list rows and tests (labels stay canonical). */
export function replayTruthLabel(kind: ReplayTruthClass): string {
  switch (kind) {
    case 'verified-fact':
      return 'Verified fact';
    case 'evidence':
      return 'Evidence';
    case 'expert-judgment':
      return 'Expert judgment';
    case 'model-output':
      return 'Model output';
    case 'simulation-replay':
      return 'Simulation replay';
    case 'evaluation-result':
      return 'Evaluation result';
    case 'certification':
      return 'Certification';
    case 'suggestion-hypothesis':
      return 'Suggestion';
    case 'demo-state':
      return 'Demo state';
    case 'pending':
      return 'Pending';
    case 'unknown':
      return 'Unknown';
  }
}
