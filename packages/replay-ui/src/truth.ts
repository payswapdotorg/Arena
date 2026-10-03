/**
 * Replay-surface truth classes (Work Order B011; issue #86;
 * packages/replay-ui — the pure view-model layer).
 *
 * THE governing product truth of this surface:
 *
 *   - REPLAY IS OBSERVATIONAL. A replayed trajectory step is
 *     SIMULATION-REPLAY — the record of what an agent DID inside a run —
 *     and NEVER a "result". Nothing on the replay surface may render a
 *     replayed step, a projected environment event or a linked artifact
 *     under one generic "AI result" badge.
 *
 *   - Every user-visible state carries its truth class from the CLOSED
 *     B003 canonical taxonomy (verified-fact, evidence, expert-judgment,
 *     model-output, simulation-replay, evaluation-result, certification,
 *     suggestion-hypothesis, demo-state, pending, unknown). The mapping
 *     here is a PROJECTION of canonical kinds, never a second truth
 *     model: `classifyState` stays the one total classifier, and this
 *     module only fixes the deterministic datum->class assignment for
 *     the replay surface's own datum kinds.
 *
 *   - Honesty-critical classes (`pending`, `unknown`) are first-class:
 *     an in-flight run with no completion entry renders as PENDING; a
 *     malformed or truncated payload renders as UNKNOWN — neither is
 *     ever silently upgraded to a badgeable kind.
 */

import {
  canonicalStateDescriptor,
  classifyState,
} from '@arena/role-context';
import type { CanonicalStateKind } from '@arena/role-context';

/** A truth class on the replay surface: exactly the closed B003 taxonomy. */
export type ReplayTruthClass = CanonicalStateKind;

/**
 * The truth class of every replayed trajectory step (and every projected
 * environment event): SIMULATION-REPLAY, never "result". This constant is
 * the single source the views key their step marks off.
 */
export const REPLAY_STEP_TRUTH_CLASS: ReplayTruthClass = 'simulation-replay';

/** The truth class of an append-only evidence address (a content digest). */
export const EVIDENCE_ADDRESS_TRUTH_CLASS: ReplayTruthClass = 'evidence';

/** The truth class of a linked evaluation record (a score, never a verdict). */
export const EVALUATION_LINK_TRUTH_CLASS: ReplayTruthClass = 'evaluation-result';

/** The truth class of a pending (in-flight, no completion entry) trajectory. */
export const PENDING_TRUTH_CLASS: ReplayTruthClass = 'pending';

/** The truth class of anything unreadable, malformed or truncated. */
export const UNKNOWN_TRUTH_CLASS: ReplayTruthClass = 'unknown';

/** The truth class of a decided verification outcome (pass | fail — facts about what the verifier decided). */
export const DECIDED_VERIFICATION_TRUTH_CLASS: ReplayTruthClass = 'verified-fact';

/**
 * One truth-class mark: the class, its canonical label and its canonical
 * one-line meaning (rendered verbatim — meaning never rests on colour
 * alone). Labels/meanings come from the B003 canonical descriptors by
 * reference, never re-transcribed.
 */
export interface ReplayTruthMark {
  readonly truthClass: ReplayTruthClass;
  readonly label: string;
  readonly meaning: string;
}

/** The canonical mark of one truth class (throws on a foreign kind — closed set). */
export function replayTruthMark(kind: ReplayTruthClass): ReplayTruthMark {
  const descriptor = canonicalStateDescriptor(kind);
  return Object.freeze({ truthClass: kind, label: descriptor.label, meaning: descriptor.meaning });
}

/**
 * Classify one truth carrier through the TOTAL canonical B003 classifier.
 * Anything unclassifiable is `unknown` — rendered as unknown, never
 * guessed (fail honest).
 */
export function classifyReplayTruthCarrier(datum: unknown): {
  readonly truthClass: ReplayTruthClass;
  readonly label: string;
  readonly meaning: string;
} {
  const kind = classifyState(datum);
  const descriptor = canonicalStateDescriptor(kind);
  return Object.freeze({
    truthClass: kind,
    label: descriptor.label,
    meaning: descriptor.meaning,
  });
}

// ---------------------------------------------------------------------------
// The B011 governing distinctions (carried as frozen data, rendered verbatim)
// ---------------------------------------------------------------------------

/**
 * The persistent, unmistakable observational contract of this surface,
 * rendered on EVERY replay screen: the viewer never issues world-changing
 * actions and there is no "re-run against live" affordance anywhere.
 */
export const REPLAY_OBSERVATIONAL_NOTE =
  'Replay is observational only — no live-world mutation. This viewer reads append-only records; it never re-runs, edits or issues actions against any environment.';

/** Carried on every timeline: a replayed step is simulation-replay, never a result. */
export const REPLAY_NOT_RESULT_NOTE =
  'A replayed trajectory step is SIMULATION-REPLAY — the append-only record of what the agent did inside the run. It is never a verified fact, never an evaluation outcome, and never a generic "AI result".';

/** Carried on the pending state: pending is honest, not an error. */
export const REPLAY_PENDING_NOTE =
  'No completion entry exists yet, so the run is still in flight or was truncated after the fact — the final outcome is PENDING, never guessed.';

/** Carried on degraded states: unknown data stays unknown. */
export const REPLAY_DEGRADED_NOTE =
  'Parts of this payload failed structural validation and render as UNKNOWN — degraded records are shown honestly, never silently repaired and never guessed.';
