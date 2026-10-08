/**
 * The append-only FEEDBACK RECORD (Work Order C022): which interventions
 * produced which improvements with what measured lift — feeding future
 * selection by EXPECTED INFORMATION VALUE with an INSPECTABLE RATIONALE
 * (the CC1.0 active-learning law: prefer the next intervention that is
 * expected to teach the most, not merely the one that scored highest).
 *
 *   - FeedbackRecord — the append-only, content-addressed record of one
 *     compilation→gate outcome: the intervention class, the candidate
 *     refs, the gate verdict kind, the measured lift and the run record
 *     it came from. Records are never mutated or rewritten;
 *   - rankByExpectedInformationValue — the DETERMINISTIC selection
 *     ranking over a candidate set given the feedback history: an
 *     UNEXPLORED intervention class (no prior feedback) ranks highest
 *     (maximum information), a class with high prior lift VARIANCE
 *     (unstable improvements — the honest uncertainty signal) ranks
 *     next, a class with many consistent prior rejections ranks lowest
 *     (low expected information). Every rank carries a machine-derived
 *     RATIONALE string (inspectable, no silent weights).
 */

import { digestCanonical } from '@arena/protocol-core';
import {
  deepFreeze,
  isContentDigest,
  isLearningTimestamp,
  isNeutralId,
  toContentDigest,
  toLearningTimestamp,
  toNeutralId,
} from '@arena/learning';
import type { ContentDigest, LearningTimestamp, NeutralId } from '@arena/learning';
import type { InterventionSurface } from '@arena/learning';
import { CAPABILITY_LEARNING_ERROR_CODES, CapabilityLearningError } from './errors.js';
import type { AdoptionGateVerdictKind, MeasuredLift } from './gate.js';
import { isAdoptionGateVerdictKind } from './gate.js';

/** Wire version of the feedback-record shape. */
export const FEEDBACK_RECORD_VERSION = 1 as const;

/** The digest-free feedback record view — exactly what the digest commits to. */
export interface FeedbackRecordView {
  readonly recordVersion: typeof FEEDBACK_RECORD_VERSION;
  readonly feedbackId: NeutralId;
  readonly tenantId: NeutralId;
  /** Which LE1.0 intervention class produced this outcome. */
  readonly interventionClass: InterventionSurface;
  /** The program digest the outcome belongs to. */
  readonly programRef: ContentDigest;
  /** The candidate digests the program compiled. */
  readonly candidateRefs: readonly ContentDigest[];
  /** The adoption-gate verdict kind (adopted / rejected / unknown). */
  readonly gateVerdict: AdoptionGateVerdictKind;
  /** The measured lift per declared outcome metric (empty when unmeasured). */
  readonly measuredLift: readonly MeasuredLift[];
  /** The A020 run record digest the outcome was computed over. */
  readonly runRecordRef: ContentDigest;
  readonly recordedAt: LearningTimestamp;
}

/** A frozen, content-addressed feedback record: the view plus its sha256 digest. */
export interface FeedbackRecord extends FeedbackRecordView {
  readonly digest: ContentDigest;
}

/** Stable field list for the feedback record view. */
export const FEEDBACK_RECORD_FIELDS = Object.freeze([
  'recordVersion',
  'feedbackId',
  'tenantId',
  'interventionClass',
  'programRef',
  'candidateRefs',
  'gateVerdict',
  'measuredLift',
  'runRecordRef',
  'recordedAt',
] as const);

/** Structural (non-throwing) check for the digest-free feedback view. */
export function isFeedbackRecordView(value: unknown): value is FeedbackRecordView {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate['recordVersion'] === FEEDBACK_RECORD_VERSION &&
    isNeutralId(candidate['feedbackId']) &&
    isNeutralId(candidate['tenantId']) &&
    typeof candidate['interventionClass'] === 'string' &&
    isContentDigest(candidate['programRef']) &&
    Array.isArray(candidate['candidateRefs']) &&
    (candidate['candidateRefs'] as unknown[]).every((entry) => isContentDigest(entry)) &&
    isAdoptionGateVerdictKind(candidate['gateVerdict']) &&
    Array.isArray(candidate['measuredLift']) &&
    isContentDigest(candidate['runRecordRef']) &&
    isLearningTimestamp(candidate['recordedAt'])
  );
}

/** Structural (non-throwing) check for the full feedback record. */
export function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  if (!isFeedbackRecordView(value)) return false;
  return isContentDigest((value as unknown as Record<string, unknown>)['digest']);
}

export interface CreateFeedbackRecordInput {
  readonly feedbackId: string;
  readonly tenantId: string;
  readonly interventionClass: string;
  readonly programRef: string;
  readonly candidateRefs: readonly string[];
  readonly gateVerdict: string;
  readonly measuredLift: readonly MeasuredLift[];
  readonly runRecordRef: string;
  readonly recordedAt: string;
}

/** Create a validated, deep-frozen, content-addressed feedback record (append-only). */
export async function createFeedbackRecord(
  input: CreateFeedbackRecordInput,
): Promise<FeedbackRecord> {
  if (typeof input !== 'object' || input === null) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_FEEDBACK, {
      message: 'feedback record input must be an object',
    });
  }
  if (typeof input.feedbackId !== 'string' || input.feedbackId.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_FEEDBACK, {
      message: 'feedback record: feedbackId must be a non-empty string',
    });
  }
  if (!isAdoptionGateVerdictKind(input.gateVerdict)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_FEEDBACK, {
      message: `feedback record: gateVerdict must be one of [adopted-with-evidence, rejected-with-reasons, unknown-insufficient-sample], got: ${JSON.stringify(input.gateVerdict)}`,
    });
  }
  if (!Array.isArray(input.candidateRefs) || input.candidateRefs.length === 0) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_FEEDBACK, {
      message: 'feedback record: at least one candidate ref is required (which interventions produced this outcome)',
    });
  }
  if (!Array.isArray(input.measuredLift)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_FEEDBACK, {
      message: 'feedback record: measuredLift must be an array (possibly empty when unmeasured)',
    });
  }

  const view: FeedbackRecordView = {
    recordVersion: FEEDBACK_RECORD_VERSION,
    feedbackId: toNeutralId(input.feedbackId, 'feedback record feedbackId'),
    tenantId: toNeutralId(input.tenantId, 'feedback record tenantId'),
    interventionClass: input.interventionClass as InterventionSurface,
    programRef: toContentDigest(input.programRef, 'feedback record programRef'),
    candidateRefs: Object.freeze(
      input.candidateRefs.map((entry, index) =>
        toContentDigest(entry, `feedback record candidateRefs[${String(index)}]`),
      ),
    ),
    gateVerdict: input.gateVerdict,
    measuredLift: Object.freeze(
      input.measuredLift.map((entry) => Object.freeze({ ...entry })),
    ),
    runRecordRef: toContentDigest(input.runRecordRef, 'feedback record runRecordRef'),
    recordedAt: toLearningTimestamp(input.recordedAt, 'feedback record recordedAt'),
  };
  const digest = toContentDigest(await digestCanonical(view), 'feedback record digest');
  return deepFreeze({ ...view, digest }) as FeedbackRecord;
}

// ---------------------------------------------------------------------------
// Expected-information-value selection (CC1.0 active-learning law)
// ---------------------------------------------------------------------------

/** One ranked selection candidate with its inspectable rationale. */
export interface ExpectedInformationValueRank {
  readonly tenantId: string;
  readonly interventionClass: InterventionSurface;
  /** Deterministic expected-information-value score (higher = more information expected). */
  readonly expectedInformationValue: number;
  /** Machine-derived INSPECTABLE rationale (no silent weights). */
  readonly rationale: string;
}

/** Weights of the EIV formula (disclosed, frozen, test-asserted). */
export const EIV_WEIGHTS = Object.freeze({
  /** Unexplored class bonus (no prior feedback for this class in this tenant). */
  unexploredClass: 50,
  /** Per-unit weight of the prior lift variance (instability = open question). */
  priorLiftVariance: 100,
  /** Per-unit weight of the prior adoption rate (diminishing returns once adopted). */
  priorAdoptionRate: -25,
} as const);

function varianceOf(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const squared = values.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return squared / values.length;
}

/**
 * Rank candidate (tenant, intervention-class) selections by EXPECTED
 * INFORMATION VALUE given the append-only feedback history — the CC1.0
 * active-learning law. DETERMINISTIC: same history + same candidates ⇒
 * same ranking (ties broken by tenantId then class, both ascending).
 *
 * EIV = unexploredClass·[no prior feedback]
 *     + priorLiftVariance·variance(prior |delta|)
 *     + priorAdoptionRate·(adopted / total)
 *
 * The rationale string discloses every term — the ranking is never a
 * silent score.
 */
export function rankByExpectedInformationValue(
  history: readonly FeedbackRecord[],
  selections: readonly { tenantId: string; interventionClass: InterventionSurface }[],
): readonly ExpectedInformationValueRank[] {
  if (!Array.isArray(history) || !Array.isArray(selections)) {
    throw new CapabilityLearningError(CAPABILITY_LEARNING_ERROR_CODES.INVALID_INPUT, {
      message: 'EIV ranking requires arrays (history, selections)',
    });
  }
  const ranks: ExpectedInformationValueRank[] = selections.map((selection) => {
    const prior = history.filter(
      (entry) =>
        (entry.tenantId as string) === selection.tenantId &&
        entry.interventionClass === selection.interventionClass,
    );
    const deltas = prior.flatMap((entry) =>
      (entry.measuredLift as readonly MeasuredLift[]).map((lift) => Math.abs(lift.delta)),
    );
    const liftVariance = varianceOf(deltas);
    const adopted = prior.filter((entry) => entry.gateVerdict === 'adopted-with-evidence').length;
    const adoptionRate = prior.length === 0 ? 0 : adopted / prior.length;
    const unexplored = prior.length === 0;
    const score =
      (unexplored ? EIV_WEIGHTS.unexploredClass : 0) +
      EIV_WEIGHTS.priorLiftVariance * liftVariance +
      EIV_WEIGHTS.priorAdoptionRate * adoptionRate;
    const rationale =
      `class ${JSON.stringify(selection.interventionClass)} of tenant ${JSON.stringify(selection.tenantId)}: ` +
      (unexplored
        ? `no prior feedback — maximum expected information (+${String(EIV_WEIGHTS.unexploredClass)})`
        : `${String(prior.length)} prior outcome(s), ${String(adopted)} adopted (rate ${adoptionRate.toFixed(3)}), prior lift variance ${liftVariance.toFixed(4)}`) +
      ` ⇒ EIV ${score.toFixed(4)}`;
    return deepFreeze({
      tenantId: selection.tenantId,
      interventionClass: selection.interventionClass,
      expectedInformationValue: score,
      rationale,
    }) as ExpectedInformationValueRank;
  });
  return Object.freeze(
    ranks.sort(
      (a, b) =>
        b.expectedInformationValue - a.expectedInformationValue ||
        a.tenantId.localeCompare(b.tenantId) ||
        (a.interventionClass as string).localeCompare(b.interventionClass as string),
    ),
  );
}
