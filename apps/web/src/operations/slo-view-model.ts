/**
 * SLO view-models (Work Order B014; apps/web/src/operations).
 * Pure projection layer — no React, no I/O.
 *
 * Projects A035 SLO objects (`SloDefinition` + `SloEvaluation`, read
 * server-side through the package's PUBLIC API) into the renderable SLO
 * board rows. The B014 SLO truths enforced HERE, by construction:
 *
 *   - SLOs are MEASUREMENTS, not promises: every row carries its target
 *     AND its window (label + bounds) AND its measured values — a verdict
 *     without its window is a degraded view, never a bare claim;
 *   - an SLO without data renders "no data" — the row's posture becomes
 *     `no-data` with the fail-closed note; NO number is fabricated to
 *     fill the space and `no-data` NEVER renders as a pass;
 *   - the verdict vocabulary is the CLOSED A035 set (met / at-risk /
 *     breached / no-data), projected verbatim — no string munging, no
 *     invented states — plus this surface's own `unknown` when no
 *     evaluation can be read;
 *   - the error budget renders as measured burn (consumed / remaining /
 *     exhausted), derived — never hand-set;
 *   - malformed definitions or evaluations degrade TRUTHFULLY: named
 *     unknown fields, unknown truth class, no thrown render.
 */

import { isSloDefinition, isSloVerdict } from '../../../../packages/observability/src/index.js';
import type { SloDefinition, SloVerdict } from '../../../../packages/observability/src/index.js';

/** Version of the SLO view surface (bump on breaking changes). */
export const SLO_VIEW_VERSION = 1 as const;

/** The SLO posture: a real measurement, or the honest no-data state. */
export type SloPosture = 'measured' | 'no-data';

/** The verdict view: the closed A035 vocabulary plus this surface's honest `unknown`. */
export type SloVerdictView = SloVerdict | 'unknown';

/** The measured values of one SLO row (present only when a real evaluation was read). */
export interface SloMeasuredView {
  readonly achievedRatio: number | undefined;
  readonly sampleCount: number;
  readonly goodCount: number;
  readonly badCount: number;
  readonly windowStart: number;
  readonly windowEnd: number;
  readonly budgetConsumedRatio: number;
  readonly budgetRemainingRatio: number;
  readonly budgetExhausted: boolean;
}

/** One SLO board row: the declared target + the measurement (or the honest no-data posture). */
export interface SloRowView {
  readonly viewVersion: typeof SLO_VIEW_VERSION;
  readonly sloId: string | undefined;
  readonly name: string | undefined;
  readonly service: string | undefined;
  readonly sliKind: string | undefined;
  readonly metricName: string | undefined;
  readonly thresholdMs: number | undefined;
  readonly targetRatio: number | undefined;
  readonly windowMs: number | undefined;
  /** Human window label ('1h', '24h', or raw ms) — a verdict is meaningless without its window. */
  readonly windowLabel: string | undefined;
  readonly minSampleCount: number | undefined;
  readonly posture: SloPosture;
  readonly verdict: SloVerdictView;
  readonly measured: SloMeasuredView | null;
  /** The fail-closed note carried whenever the posture is no-data (never a pass). */
  readonly noDataNote: string | undefined;
  /** Truth class: a readable definition's evaluation is an evaluation result; anything else is unknown. */
  readonly truthClass: 'evaluation-result' | 'unknown';
  readonly unknownFields: readonly string[];
  /** True iff the definition was structurally readable. */
  readonly readable: boolean;
}

const NO_DATA_NOTE = 'No data is not good news: below the minimum sample count the verdict is no-data and the error budget is reported exhausted (fail-closed). Missing telemetry is an incident, not a pass.';
const MISSING_EVALUATION_NOTE =
  'No evaluation is recorded in this posture — the declared target renders as declared, and nothing is fabricated to fill the measurement.';

/**
 * The human label of one window length (1h / 24h for the catalog windows,
 * raw ms otherwise). Windows render with every verdict — an SLO number
 * without its window is meaningless.
 */
export function sloWindowLabel(windowMs: number | undefined): string | undefined {
  if (windowMs === undefined) return undefined;
  if (windowMs === 3_600_000) return '1h';
  if (windowMs === 86_400_000) return '24h';
  return `${String(windowMs)}ms`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

/** Structurally read one A035 evaluation (the fields the row renders). */
function readEvaluation(value: unknown): {
  evaluation: Record<string, unknown>;
  verdict: SloVerdict;
} | undefined {
  if (!isRecord(value)) return undefined;
  const verdict = value['verdict'];
  if (!isSloVerdict(verdict)) return undefined;
  return { evaluation: value, verdict };
}

/** The projection input: the A035 objects (or malformed stand-ins) to project. */
export interface SloRowProjectionInput {
  readonly definition: unknown;
  readonly evaluation?: unknown;
}

/**
 * Project one A035 definition + evaluation into the SLO board row.
 * Malformed inputs degrade truthfully: a bad definition yields an unknown
 * row; a missing or malformed evaluation yields the no-data posture with
 * the honest note — never a fabricated number, never a thrown render.
 */
export function toSloRowView(input: SloRowProjectionInput): SloRowView {
  const unknownFields: string[] = [];
  const definitionOk = isSloDefinition(input.definition);
  if (!definitionOk) unknownFields.push('SLO definition (structurally unreadable)');
  const definition: SloDefinition | undefined = definitionOk
    ? (input.definition as SloDefinition)
    : undefined;

  const evaluationRead =
    input.evaluation !== undefined ? readEvaluation(input.evaluation) : undefined;
  const evaluation: Record<string, unknown> | undefined = evaluationRead?.evaluation;
  if (input.evaluation !== undefined && evaluationRead === undefined) {
    unknownFields.push('SLO evaluation (structurally unreadable)');
  }

  // An evaluation whose sloId does not match its definition is a wiring
  // error, not a measurement of THIS SLO — rendered as unreadable.
  const evaluationSloId = evaluation?.['sloId'];
  if (evaluation !== undefined && definition !== undefined && evaluationSloId !== definition.sloId) {
    unknownFields.push('SLO evaluation (sloId mismatch — not a measurement of this SLO)');
  }
  const evaluationUsable =
    evaluationRead !== undefined &&
    evaluation !== undefined &&
    definition !== undefined &&
    evaluation['sloId'] === definition.sloId;

  const verdict: SloVerdictView = evaluationUsable ? evaluationRead.verdict : 'unknown';
  const posture: SloPosture =
    evaluationUsable && evaluationRead?.verdict !== 'no-data' ? 'measured' : 'no-data';

  let measured: SloMeasuredView | null = null;
  if (posture === 'measured' && evaluationUsable && evaluation !== undefined) {
    const budgetRaw = evaluation['errorBudget'];
    const budget = isRecord(budgetRaw) ? budgetRaw : undefined;
    const sampleCount = readNonNegativeInt(evaluation['sampleCount']) ?? 0;
    measured = Object.freeze({
      achievedRatio: verdict === 'no-data' ? undefined : readNumber(evaluation['achievedRatio']),
      sampleCount,
      goodCount: readNonNegativeInt(evaluation['goodCount']) ?? 0,
      badCount: readNonNegativeInt(evaluation['badCount']) ?? 0,
      windowStart: readNonNegativeInt(evaluation['windowStart']) ?? 0,
      windowEnd: readNonNegativeInt(evaluation['windowEnd']) ?? 0,
      budgetConsumedRatio: budget !== undefined ? readNumber(budget['consumedRatio']) ?? 0 : 0,
      budgetRemainingRatio: budget !== undefined ? readNumber(budget['remainingRatio']) ?? 0 : 0,
      budgetExhausted:
        budget !== undefined ? budget['exhausted'] === true || verdict === 'no-data' : false,
    } satisfies SloMeasuredView);
  }

  const noDataNote =
    posture === 'no-data'
      ? evaluationUsable && evaluation !== undefined
        ? `${NO_DATA_NOTE} ${String(readNonNegativeInt(evaluation['sampleCount']) ?? 0)} of at least ${String(definition?.minSampleCount)} samples in window.`
        : MISSING_EVALUATION_NOTE
      : undefined;

  return Object.freeze({
    viewVersion: SLO_VIEW_VERSION,
    sloId: definition?.sloId,
    name: definition?.name,
    service: definition?.service,
    sliKind: definition?.sli.kind,
    metricName: definition?.sli.metricName,
    thresholdMs: definition?.sli.thresholdMs ?? undefined,
    targetRatio: definition?.targetRatio,
    windowMs: definition?.windowMs,
    windowLabel: sloWindowLabel(definition?.windowMs),
    minSampleCount: definition?.minSampleCount,
    posture,
    verdict,
    measured,
    noDataNote,
    truthClass: definitionOk ? ('evaluation-result' as const) : ('unknown' as const),
    unknownFields: Object.freeze([...new Set(unknownFields)]),
    readable: definitionOk,
  } satisfies SloRowView);
}

/** Count rows per verdict view (the board summary — closed vocabulary, deterministic order). */
export function sloVerdictCounts(rows: readonly SloRowView[]): Readonly<Record<SloVerdictView, number>> {
  const counts: Record<SloVerdictView, number> = {
    met: 0,
    'at-risk': 0,
    breached: 0,
    'no-data': 0,
    unknown: 0,
  };
  for (const row of rows) {
    counts[row.verdict] += 1;
  }
  return Object.freeze(counts);
}
