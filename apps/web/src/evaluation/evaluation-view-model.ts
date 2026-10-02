/**
 * Evaluation report view-models (Work Order B012; issue #87;
 * apps/web/src/evaluation). Pure projection layer — no React, no I/O.
 *
 * Projects the canonical A012 objects (`EvaluationRecord`,
 * `EvaluationCriteria`, `EvaluatorDescriptor` — read server-side through
 * the package's PUBLIC API) into the renderable report view. The B012
 * product truths enforced HERE, by construction:
 *
 *   - every view carries `truthClass: 'evaluation-result'` and the
 *     honest not-verified note — an evaluation result NEVER renders as
 *     verified (that is a different truth class, owned by verification);
 *   - scores/metrics always carry their SUITE identity (criteria set +
 *     aggregation policy + pass bar + evaluator identity) — a floating
 *     score with no suite is a degraded view, never a guessed one;
 *   - run conditions (seed, determinism, timestamps, executor) render
 *     with every report, because "scored S" is meaningless without
 *     "under which conditions";
 *   - malformed payloads degrade TRUTHFULLY: missing pieces render as
 *     unknown fields with their names listed — nothing is fabricated to
 *     fill the space.
 */

import {
  isEvaluationCriteria,
  isEvaluationRecord,
  isEvaluatorDescriptor,
} from '../../../../packages/evaluation/src/index.js';
import type {
  AggregateOutcome,
  AggregationPolicy,
  EvaluationCriteria,
  EvaluationRecord,
  EvaluatorDescriptor,
} from '../../../../packages/evaluation/src/index.js';
import { EVALUATION_NOT_VERIFIED_NOTE } from './state-mark.js';

/** Version of the evaluation report view surface (bump on breaking changes). */
export const EVALUATION_VIEW_VERSION = 1 as const;

/** The suite identity every score is bound to (criteria set + evaluator). */
export interface EvaluationSuiteIdentity {
  readonly criteriaId: string | undefined;
  readonly criteriaVersion: string | undefined;
  readonly criteriaRef: string | undefined;
  readonly aggregation: AggregationPolicy | undefined;
  readonly passAt: number | undefined;
  readonly evaluatorId: string | undefined;
  readonly evaluatorVersion: string | undefined;
  readonly evaluatorKind: string | undefined;
  readonly evaluatorRef: string | undefined;
}

/** One scored metric: the criterion, its weight, its score, its judgment. */
export interface EvaluationMetricView {
  readonly criterionId: string | undefined;
  readonly description: string | undefined;
  readonly weight: number | undefined;
  readonly score: number | undefined;
  readonly judgment: string | undefined;
  readonly notes: string | undefined;
  /**
   * Per-criterion pass against the suite's pass bar, when the aggregation
   * policy gives that meaning (pass-threshold). Null for policies whose
   * bar applies only at the aggregate (weighted-sum) or whose scores are
   * levels, not passes (rubric-level) — rendered Unknown, never guessed.
   */
  readonly meetsThreshold: boolean | null;
}

/** The recorded run conditions a score is meaningless without. */
export interface EvaluationRunConditions {
  readonly seed: string | undefined;
  readonly deterministic: boolean | undefined;
  readonly seeded: boolean | undefined;
  readonly requiresHuman: boolean | undefined;
  readonly startedAt: string | undefined;
  readonly finishedAt: string | undefined;
  readonly executedBy: string | undefined;
  readonly recordedAt: string | undefined;
}

/** The subjects the report judged (digest refs to the sibling objects). */
export interface EvaluationSubjectRefs {
  readonly caseRef: string | undefined;
  readonly trajectoryRef: string | undefined;
  readonly bodyRef: string | undefined;
  readonly substrateRef: string | undefined;
}

/** The fully-renderable evaluation report view (positive OR truthfully degraded). */
export interface EvaluationReportView {
  readonly viewVersion: typeof EVALUATION_VIEW_VERSION;
  /** Stable display id (the route id in demo mode; the digest otherwise). */
  readonly reportId: string;
  /** The append-once record digest (null only when the payload was unreadable). */
  readonly digest: string | null;
  /** ALWAYS 'evaluation-result' — an evaluation result is never a verification claim. */
  readonly truthClass: 'evaluation-result';
  /** The aggregate outcome (score + meets/below-criteria), when readable. */
  readonly aggregate: { readonly score: number; readonly outcome: AggregateOutcome['outcome'] } | null;
  readonly confidence: number | undefined;
  readonly limitations: string | undefined;
  readonly suite: EvaluationSuiteIdentity;
  readonly metrics: readonly EvaluationMetricView[];
  readonly runConditions: EvaluationRunConditions;
  readonly subjects: EvaluationSubjectRefs;
  /** The honest not-verified framing, carried as data and rendered verbatim. */
  readonly notVerifiedNote: string;
  /** Payload pieces that were missing/unreadable — rendered as unknown, by name. */
  readonly unknownFields: readonly string[];
  /** True iff the A012 record itself was structurally readable. */
  readonly readable: boolean;
}

/** The projection input: the A012 objects (or malformed stand-ins) to project. */
export interface EvaluationReportProjectionInput {
  readonly record: unknown;
  readonly criteria?: unknown;
  readonly descriptor?: unknown;
  /** Stable display id override (demo route ids); defaults to the record digest. */
  readonly reportId?: string;
}

function unknownIf(condition: boolean, name: string, sink: string[]): void {
  if (condition) sink.push(name);
}

/**
 * Project the A012 objects into the evaluation report view. The record is
 * guarded structurally (`isEvaluationRecord`): a malformed record yields a
 * DEGRADED but complete view (every suite/run field unknown, the record
 * digest null) — never a fabricated report and never a thrown render.
 */
export function toEvaluationReportView(
  input: EvaluationReportProjectionInput,
): EvaluationReportView {
  const unknownFields: string[] = [];

  const recordOk = isEvaluationRecord(input.record);
  unknownIf(!recordOk, 'evaluation record (structurally unreadable)', unknownFields);
  const record: EvaluationRecord | undefined = recordOk
    ? (input.record as EvaluationRecord)
    : undefined;

  const criteriaOk = input.criteria !== undefined && isEvaluationCriteria(input.criteria);
  unknownIf(!criteriaOk, 'criteria set', unknownFields);
  const criteria = criteriaOk ? (input.criteria as EvaluationCriteria) : undefined;

  const descriptorOk =
    input.descriptor !== undefined && isEvaluatorDescriptor(input.descriptor);
  unknownIf(!descriptorOk, 'evaluator descriptor', unknownFields);
  const descriptor: EvaluatorDescriptor | undefined = descriptorOk
    ? (input.descriptor as EvaluatorDescriptor)
    : undefined;

  // Suite identity: criteria + evaluator halves degrade independently.
  const suite: EvaluationSuiteIdentity = Object.freeze({
    criteriaId: criteria?.criteriaId,
    criteriaVersion: criteria?.version,
    criteriaRef: criteria?.digest ?? record?.criteriaRef,
    aggregation: criteria?.aggregation,
    passAt: criteria?.thresholds.passAt,
    evaluatorId: descriptor?.evaluatorId,
    evaluatorVersion: descriptor?.version,
    evaluatorKind: descriptor?.kind,
    evaluatorRef: descriptor?.digest ?? record?.evaluatorRef,
  });
  if (criteria === undefined && record === undefined) {
    unknownFields.push('suite identity');
  }

  // Metrics: one row per record verdict, joined to the criteria entry by
  // criterion id. A verdict without its criteria entry renders with
  // weight/description unknown — the score alone is still honest.
  const metrics: EvaluationMetricView[] = [];
  if (record !== undefined) {
    for (const verdict of record.verdicts) {
      const entry = criteria?.entries.find(
        (candidate) => candidate.criterionId === verdict.criterionId,
      );
      const metricUnknown: string[] = [];
      unknownIf(entry === undefined, `criteria entry ${String(verdict.criterionId)}`, metricUnknown);
      unknownFields.push(...metricUnknown);
      metrics.push(
        Object.freeze({
          criterionId: verdict.criterionId,
          description: entry?.description,
          weight: entry?.weight,
          score: verdict.score,
          judgment: verdict.judgment ?? undefined,
          notes: verdict.notes ?? undefined,
          meetsThreshold: perCriterionPass(criteria?.aggregation, verdict.score, criteria?.thresholds.passAt),
        } satisfies EvaluationMetricView),
      );
    }
  }
  if (record === undefined) unknownFields.push('metric rows');

  const aggregate: EvaluationReportView['aggregate'] =
    record !== undefined
      ? Object.freeze({
          score: record.aggregate.score,
          outcome: record.aggregate.outcome,
        })
      : null;

  const runConditions: EvaluationRunConditions = Object.freeze({
    seed: record?.seed ?? undefined,
    deterministic: descriptor?.reproducibility.deterministic,
    seeded: descriptor?.reproducibility.seeded,
    requiresHuman: descriptor?.reproducibility.requiresHuman,
    startedAt: record?.startedAt,
    finishedAt: record?.finishedAt,
    executedBy: record?.provenance.executedBy,
    recordedAt: record?.provenance.recordedAt,
  });

  const subjects: EvaluationSubjectRefs = Object.freeze({
    caseRef: record?.caseRef ?? descriptor?.inputs.caseRef,
    trajectoryRef: record?.trajectoryRef ?? descriptor?.inputs.trajectoryRef,
    bodyRef: descriptor?.inputs.bodyRef ?? undefined,
    substrateRef: descriptor?.inputs.substrateRef ?? undefined,
  });

  return Object.freeze({
    viewVersion: EVALUATION_VIEW_VERSION,
    reportId: input.reportId ?? record?.digest ?? 'unknown-report',
    digest: record?.digest ?? null,
    truthClass: 'evaluation-result',
    aggregate,
    confidence: record?.confidence,
    limitations: record?.limitations ?? descriptor?.limitations ?? undefined,
    suite: Object.freeze(suite),
    metrics: Object.freeze(metrics),
    runConditions: Object.freeze(runConditions),
    subjects: Object.freeze(subjects),
    notVerifiedNote: EVALUATION_NOT_VERIFIED_NOTE,
    unknownFields: Object.freeze(dedup(unknownFields)),
    readable: recordOk,
  } satisfies EvaluationReportView);
}

/**
 * Per-criterion threshold semantics: only the pass-threshold policy gives
 * the pass bar per-criterion meaning (score >= passAt). Weighted-sum bars
 * the AGGREGATE; rubric-level scores are levels, not passes. Anything
 * underdetermined is null — rendered Unknown, never guessed.
 */
function perCriterionPass(
  aggregation: AggregationPolicy | undefined,
  score: number,
  passAt: number | undefined,
): boolean | null {
  if (aggregation === undefined || passAt === undefined) return null;
  if (aggregation === 'pass-threshold') return score >= passAt;
  return null;
}

/** Deterministic dedup (preserves first-seen order) for the unknown-field lists. */
function dedup(items: readonly string[]): string[] {
  return [...new Set(items)];
}
