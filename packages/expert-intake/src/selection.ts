/**
 * Next-item selection by expected information value (Work Order C003;
 * spec/capability-case.md "Active learning": "Arena may select the next
 * case/task based on expected information value, but the selection
 * rationale remains inspectable").
 *
 * Deterministic given identical inputs: the same (catalog, transcript,
 * selection seed) triple ALWAYS selects the same next item with the same
 * scored rationale — the active-learning law made machine-auditable. The
 * score is a sum of named components (novelty, routing criticality,
 * coverage gap, stage ordering, answer entropy, seed jitter) each
 * recorded per candidate in the rationale, with a stable tie-break
 * (highest score, then lexicographic item id) so there are no hidden
 * orderings.
 *
 * The seed jitter is the ONLY non-uniform input and is a pure FNV-1a
 * hash of (seed, itemId) — reproducible, never a clock or RNG read.
 */

import { deterministicUnitInterval } from './shared.js';
import { EXPERT_INTAKE_ERROR_CODES, ExpertIntakeError } from './errors.js';
import type { InterviewItem } from './items.js';

// ---------------------------------------------------------------------------
// Component weights (declared constants — inspectable by construction)
// ---------------------------------------------------------------------------

export const SELECTION_COMPONENTS = Object.freeze([
  'novelty',
  'routingCriticality',
  'coverageGap',
  'stageOrder',
  'answerEntropy',
  'seedJitter',
] as const);
export type SelectionComponent = (typeof SELECTION_COMPONENTS)[number];

/**
 * ES1.0 routing-input criticality: items feeding HARD routing blockers
 * (privacy clearance, locale, availability) score higher than enriching
 * items (scenario color), because an unanswered blocker eliminates the
 * expert from routing regardless of capability depth.
 */
export const ROUTING_CRITICALITY_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  privacy: 6,
  locale: 5,
  jurisdiction: 5,
  availability: 4,
  capability: 3,
  evidence: 3,
  experience: 2,
  tool: 2,
  scenario: 1,
});

/**
 * Stage ordering — probes before evidence requests before scenarios: a
 * proficiency declaration raises the information value of the evidence
 * request that backs it (adaptive sequencing without hidden state).
 */
const STAGE_ORDER_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'capability-probe': 3,
  'experience-probe': 2,
  'evidence-request': 1,
  'scenario-item': 0,
});

/**
 * Answer entropy — the (fixed, schema-declared) spread of the expected
 * answer space. Closed enums carry more decision information per answer
 * than bounded integers; free text carries the least structurally usable
 * information (it is declaration color, not routing input).
 */
const ANSWER_ENTROPY_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'proficiency-selection': 3,
  'privacy-consent': 3,
  'jurisdiction-declaration': 2,
  'locale-declaration': 2,
  'availability-window': 2,
  'years-experience': 1,
  'evidence-pointer': 1,
  'scenario-response': 0,
});

/** The maximum jitter contribution (bounded so it can only break ties-in-spirit, never dominate). */
export const MAX_SEED_JITTER = 0.5;

// ---------------------------------------------------------------------------
// The inspectable rationale
// ---------------------------------------------------------------------------

/** One scored candidate — the full, per-component breakdown. */
export interface SelectionCandidateScore {
  readonly itemId: string;
  readonly kind: string;
  readonly routingInput: string;
  readonly score: number;
  readonly components: Readonly<Record<SelectionComponent, number>>;
  /** False when the item was already asked (ineligible for selection). */
  readonly eligible: boolean;
}

/** The selection rationale — inspectable, digest-free, no clock reads. */
export interface SelectionRationale {
  readonly selectionSeed: string;
  readonly chosenItemId: string | null;
  readonly tieBreakRule: 'highest-score-then-item-id';
  readonly scored: readonly SelectionCandidateScore[];
}

export interface TranscriptProbe {
  readonly itemId: string;
  /** Whether the item already carries a declared answer. */
  readonly answered: boolean;
}

// ---------------------------------------------------------------------------
// The selector
// ---------------------------------------------------------------------------

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Select the next interview item by expected information value over the
 * catalog minus the already-asked items. Returns the chosen item plus
 * the full scored rationale; returns rationale with chosenItemId null
 * when every catalog item has been asked (interview exhausted).
 *
 * Deterministic: identical (catalog, transcript, seed) ⇒ identical choice.
 */
export function selectNextItem(
  catalog: readonly InterviewItem[],
  transcript: readonly TranscriptProbe[],
  selectionSeed: string,
): { readonly item: InterviewItem | null; readonly rationale: SelectionRationale } {
  if (catalog.length === 0) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ITEM, {
      message: 'item selection requires a non-empty interview catalog',
    });
  }
  const asked = new Set(transcript.map((entry) => entry.itemId));
  // Coverage: a target is covered when ANY answered item points at it.
  const answeredTargets = new Set<string>();
  for (const entry of transcript) {
    if (!entry.answered) continue;
    const askedItem = catalog.find((item) => item.itemId === entry.itemId);
    if (askedItem === undefined || askedItem.target === undefined) continue;
    answeredTargets.add(`${askedItem.target.kind}:${askedItem.target.id}@${askedItem.target.version}`);
  }

  const scored: SelectionCandidateScore[] = catalog.map((item) => {
    const isAsked = asked.has(item.itemId);
    const coverageGap =
      item.target !== undefined && !answeredTargets.has(`${item.target.kind}:${item.target.id}@${item.target.version}`)
        ? 1
        : 0;
    const components: Record<SelectionComponent, number> = {
      novelty: isAsked ? 0 : 1,
      routingCriticality: ROUTING_CRITICALITY_WEIGHTS[item.routingInput] ?? 0,
      coverageGap,
      stageOrder: STAGE_ORDER_WEIGHTS[item.kind] ?? 0,
      answerEntropy: ANSWER_ENTROPY_WEIGHTS[item.expected.answerKind] ?? 0,
      seedJitter: round3(deterministicUnitInterval(`${selectionSeed}::${item.itemId}`) * MAX_SEED_JITTER),
    };
    const score = round3(
      components.novelty + components.routingCriticality + components.coverageGap + components.stageOrder +
        components.answerEntropy + components.seedJitter,
    );
    return Object.freeze({
      itemId: item.itemId,
      kind: item.kind,
      routingInput: item.routingInput,
      score,
      components: Object.freeze({ ...components }),
      eligible: !isAsked,
    });
  });

  const eligible = scored.filter((candidate) => candidate.eligible);
  let chosen: SelectionCandidateScore | null = null;
  for (const candidate of eligible) {
    if (
      chosen === null ||
      candidate.score > chosen.score ||
      (candidate.score === chosen.score && candidate.itemId < chosen.itemId)
    ) {
      chosen = candidate;
    }
  }

  const item = chosen === null ? null : (catalog.find((entry) => entry.itemId === chosen?.itemId) ?? null);
  if (chosen !== null && item === null) {
    throw new ExpertIntakeError(EXPERT_INTAKE_ERROR_CODES.INVALID_ITEM, {
      message: `selected item ${chosen.itemId} is absent from the catalog (integrity failure)`,
      details: { itemId: chosen.itemId },
    });
  }

  const rationale: SelectionRationale = Object.freeze({
    selectionSeed,
    chosenItemId: chosen === null ? null : chosen.itemId,
    tieBreakRule: 'highest-score-then-item-id',
    scored: Object.freeze([...scored]),
  });
  return { item, rationale };
}
