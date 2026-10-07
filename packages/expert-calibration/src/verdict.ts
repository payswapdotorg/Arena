/**
 * The typed drift-verdict engine (Work Order C004; spec/learning.md LE1.0
 * "Calibration" — "Where outcomes can later be observed, compare
 * predicted confidence/score with outcomes and preserve applicability
 * context"; spec/quality-model.md "uncertainty/calibration").
 *
 * A drift verdict is TYPED —
 *
 *   calibrated / overconfident / underconfident / insufficient-sample /
 *   stale
 *
 * — NEVER a bare score. Derivation is PURE over (records, policy,
 * evaluatedAt): no hidden state, no clock reads (`evaluatedAt` is
 * injected), deterministic seeded ordering (records are folded in
 * (observedAt, calibrationId) order regardless of input order, so the
 * same record SET always yields the same verdict).
 *
 * Precedence (deterministic, closed):
 *   1. FRESH decided records (outcome correct|incorrect, observed within
 *      freshnessWindowDays of evaluatedAt) >= minimumSample → the bias
 *      comparison over the fresh decided set;
 *   2. else fresh-decided === 0 while records exist → `stale`
 *      (all observed evidence aged out);
 *   3. else → `insufficient-sample` (some fresh evidence, below floor).
 *
 * Bias comparison: bias = meanPredictedConfidence − observedRate over
 * the fresh decided set. |bias| <= tolerance → `calibrated`;
 * bias > tolerance → `overconfident` (the expert predicted success more
 * often than observed); bias < −tolerance → `underconfident`.
 *
 * CALIBRATION IS DATA, NEVER AUTHORIZATION (lock rules 9/35):
 * `consumeCalibrationAsAuthorization` exists ONLY to fail closed — it
 * ALWAYS throws — so a calibration verdict consumed as an access grant
 * has no happy path at all (adversarial minimum, work order C004).
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectFiniteNumber,
  expectNonEmptyString,
  expectNumberInRange,
  toCalibrationContentDigest,
  toCalibrationId,
  toCalibrationNeutralText,
  toCalibrationTimestamp,
} from './shared.js';
import type { CalibrationId, CalibrationNeutralText, CalibrationTimestamp } from './shared.js';
import { screenFieldNames } from './shared.js';
import type { CalibrationRecord, CalibrationRecordView } from './record.js';

// ---------------------------------------------------------------------------
// Closed vocabulary
// ---------------------------------------------------------------------------

/** The CLOSED drift-verdict vocabulary — never a bare score. */
export const DRIFT_VERDICTS = Object.freeze([
  'calibrated',
  'overconfident',
  'underconfident',
  'insufficient-sample',
  'stale',
] as const);

export type DriftVerdictKind = (typeof DRIFT_VERDICTS)[number];

export function isDriftVerdictKind(value: unknown): value is DriftVerdictKind {
  return typeof value === 'string' && (DRIFT_VERDICTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// The drift policy (pure data)
// ---------------------------------------------------------------------------

/** Wire version of the drift-policy shape. */
export const DRIFT_POLICY_VERSION = 1 as const;

/**
 * The drift policy embedded in the content-addressed CalibrationProgram:
 * the minimum FRESH decided sample before a bias comparison is honest,
 * the |bias| tolerance band, and the outcome freshness window.
 */
export interface DriftPolicyView {
  readonly policyVersion: typeof DRIFT_POLICY_VERSION;
  /** Minimum FRESH decided (correct|incorrect) records (>= 1). */
  readonly minimumSample: number;
  /** |bias| <= tolerance ⇒ calibrated (0 <= tolerance < 1). */
  readonly tolerance: number;
  /** Outcomes older than this (days, >= 1) are NOT fresh. */
  readonly freshnessWindowDays: number;
}

export interface CreateDriftPolicyInput {
  readonly minimumSample: number;
  readonly tolerance: number;
  readonly freshnessWindowDays: number;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Create a validated, deep-frozen drift policy (typed errors on bad input). */
export function createDriftPolicy(input: CreateDriftPolicyInput): DriftPolicyView {
  const record = expectFields(
    input,
    ['minimumSample', 'tolerance', 'freshnessWindowDays'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY,
    'drift policy',
  );
  if (!isPositiveInteger(record['minimumSample'])) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: `drift policy: minimumSample must be an integer >= 1, got ${String(record['minimumSample'])}`,
    });
  }
  const tolerance = expectNumberInRange(
    record['tolerance'],
    'tolerance',
    0,
    1,
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY,
    'drift policy',
  );
  if (tolerance >= 1) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: 'drift policy: tolerance must be < 1 (a tolerance of 1+ admits any bias)',
    });
  }
  if (!isPositiveInteger(record['freshnessWindowDays'])) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_POLICY, {
      message: `drift policy: freshnessWindowDays must be an integer >= 1, got ${String(record['freshnessWindowDays'])}`,
    });
  }
  return deepFreeze({
    policyVersion: DRIFT_POLICY_VERSION,
    minimumSample: record['minimumSample'],
    tolerance,
    freshnessWindowDays: record['freshnessWindowDays'],
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** True iff an observed outcome is fresh at `evaluatedAt` (PURE). */
export function isOutcomeFresh(observedAt: string, evaluatedAt: string, freshnessWindowDays: number): boolean {
  const observedMs = Date.parse(observedAt);
  const evaluatedMs = Date.parse(evaluatedAt);
  if (Number.isNaN(observedMs) || Number.isNaN(evaluatedMs)) return false;
  const ageMs = evaluatedMs - observedMs;
  return ageMs >= 0 && ageMs <= freshnessWindowDays * DAY_MS;
}

// ---------------------------------------------------------------------------
// The verdict derivation (PURE)
// ---------------------------------------------------------------------------

/** The pure drift comparison (the typed verdict + its evidence counts). */
export interface DriftVerdict {
  readonly verdict: DriftVerdictKind;
  /** Total records folded (append-only history size). */
  readonly recordCount: number;
  /** Decided (correct|incorrect) records in the window. */
  readonly freshDecidedCount: number;
  /** Decided records aged out of the window. */
  readonly staleDecidedCount: number;
  /** Inconclusive records (never folded into the bias). */
  readonly inconclusiveCount: number;
  /** meanPredictedConfidence − observedRate over fresh decided (null when none). */
  readonly bias: number | null;
  /** The policy tolerance the bias was compared against (null when no comparison). */
  readonly tolerance: number | null;
}

/**
 * Derive the TYPED drift verdict for one expert's calibration records
 * under one policy at one evaluation time. PURE and deterministic: the
 * records are folded in seeded (observedAt, calibrationId) order, so the
 * same record SET yields the same verdict regardless of input order.
 * Requires structurally valid records — malformed input fails closed.
 */
export function deriveDriftVerdict(
  records: readonly CalibrationRecordView[],
  policy: DriftPolicyView,
  evaluatedAt: string,
): DriftVerdict {
  const at = toCalibrationTimestamp(evaluatedAt, 'drift verdict evaluatedAt');
  const ordered = [...records].sort((a, b) =>
    a.observedAt === b.observedAt
      ? a.calibrationId < b.calibrationId
        ? -1
        : 1
      : a.observedAt < b.observedAt
        ? -1
        : 1,
  );
  let freshDecidedCount = 0;
  let staleDecidedCount = 0;
  let inconclusiveCount = 0;
  let confidenceSum = 0;
  let observedRateSum = 0;
  for (const record of ordered) {
    if (record.observed.outcome === 'inconclusive') {
      inconclusiveCount += 1;
      continue;
    }
    if (!isOutcomeFresh(record.observedAt, at, policy.freshnessWindowDays)) {
      staleDecidedCount += 1;
      continue;
    }
    freshDecidedCount += 1;
    confidenceSum += record.predicted.confidence;
    observedRateSum += record.observed.outcome === 'correct' ? 1 : 0;
  }

  if (freshDecidedCount >= policy.minimumSample) {
    const meanConfidence = confidenceSum / freshDecidedCount;
    const observedRate = observedRateSum / freshDecidedCount;
    const bias = meanConfidence - observedRate;
    const verdict: DriftVerdictKind =
      Math.abs(bias) <= policy.tolerance
        ? 'calibrated'
        : bias > policy.tolerance
          ? 'overconfident'
          : 'underconfident';
    return deepFreeze({
      verdict,
      recordCount: ordered.length,
      freshDecidedCount,
      staleDecidedCount,
      inconclusiveCount,
      bias,
      tolerance: policy.tolerance,
    });
  }
  if (freshDecidedCount === 0 && ordered.length > 0) {
    return deepFreeze({
      verdict: 'stale',
      recordCount: ordered.length,
      freshDecidedCount,
      staleDecidedCount,
      inconclusiveCount,
      bias: null,
      tolerance: null,
    });
  }
  return deepFreeze({
    verdict: 'insufficient-sample',
    recordCount: ordered.length,
    freshDecidedCount,
    staleDecidedCount,
    inconclusiveCount,
    bias: null,
    tolerance: null,
  });
}

// ---------------------------------------------------------------------------
// The content-addressed verdict record (append-only history)
// ---------------------------------------------------------------------------

/** Wire version of the drift-verdict-record shape. */
export const DRIFT_VERDICT_RECORD_VERSION = 1 as const;

export interface DriftVerdictRecordView {
  readonly recordVersion: typeof DRIFT_VERDICT_RECORD_VERSION;
  readonly verdictId: CalibrationId;
  readonly tenant: string;
  readonly expertId: string;
  /** The content-addressed CalibrationProgram the verdict was derived under. */
  readonly programDigest: string;
  /** The closed verdict kind — NEVER a bare score. */
  readonly verdict: DriftVerdictKind;
  readonly recordCount: number;
  readonly freshDecidedCount: number;
  readonly staleDecidedCount: number;
  readonly inconclusiveCount: number;
  readonly bias: number | null;
  readonly tolerance: number | null;
  /** The record digests the verdict folded, deterministically sorted. */
  readonly foldedRecordDigests: readonly string[];
  /** The fixed evaluation time (determinism anchor — injected, never a clock read). */
  readonly evaluatedAt: CalibrationTimestamp;
  readonly rationale: CalibrationNeutralText | null;
}

/** A frozen, content-addressed drift-verdict record: view + digest. */
export interface DriftVerdictRecord extends DriftVerdictRecordView {
  readonly digest: string;
}

export interface CreateDriftVerdictRecordInput {
  readonly verdictId: string;
  readonly tenant: string;
  readonly expertId: string;
  readonly programDigest: string;
  readonly verdict: string;
  readonly recordCount: number;
  readonly freshDecidedCount: number;
  readonly staleDecidedCount: number;
  readonly inconclusiveCount: number;
  readonly bias: number | null;
  readonly tolerance: number | null;
  readonly foldedRecordDigests: readonly string[];
  readonly evaluatedAt: string;
  readonly rationale?: string | null;
}

/**
 * Create a validated, deep-frozen, content-addressed drift-verdict record
 * from a derived verdict. Rejects unknown verdict kinds, malformed counts
 * and authority-shaped fields (masquerade screen) with typed errors.
 */
export async function createDriftVerdictRecord(
  input: CreateDriftVerdictRecordInput,
): Promise<DriftVerdictRecord> {
  const record = expectFields(
    input,
    [
      'verdictId',
      'tenant',
      'expertId',
      'programDigest',
      'verdict',
      'recordCount',
      'freshDecidedCount',
      'staleDecidedCount',
      'inconclusiveCount',
      'bias',
      'tolerance',
      'foldedRecordDigests',
      'evaluatedAt',
    ],
    ['rationale'],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT,
    'drift verdict record',
  );
  const verdict = record['verdict'];
  if (!isDriftVerdictKind(verdict)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: `drift verdict record: verdict must be one of [${DRIFT_VERDICTS.join(', ')}], got: ${String(verdict)}`,
      details: { known: [...DRIFT_VERDICTS] },
    });
  }
  for (const field of ['recordCount', 'freshDecidedCount', 'staleDecidedCount', 'inconclusiveCount']) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
        message: `drift verdict record: ${field} must be a non-negative integer`,
      });
    }
  }
  const bias =
    record['bias'] === null
      ? null
      : expectFiniteNumber(record['bias'], 'bias', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'drift verdict record');
  const tolerance =
    record['tolerance'] === null
      ? null
      : expectFiniteNumber(record['tolerance'], 'tolerance', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'drift verdict record');
  const rawFolded = record['foldedRecordDigests'];
  if (!Array.isArray(rawFolded) || !rawFolded.every((entry) => typeof entry === 'string')) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'drift verdict record: foldedRecordDigests must be an array of content digests',
    });
  }
  const foldedRecordDigests = [...rawFolded].sort((a, b) => (a < b ? -1 : 1)).map((entry) =>
    toCalibrationContentDigest(entry, 'foldedRecordDigests entry'),
  );

  const rationaleRaw = record['rationale'];
  const rationale =
    rationaleRaw === undefined || rationaleRaw === null
      ? null
      : toCalibrationNeutralText(rationaleRaw as string, 'drift verdict record rationale');

  const view: DriftVerdictRecordView = {
    recordVersion: DRIFT_VERDICT_RECORD_VERSION,
    verdictId: toCalibrationId(
      typeof record['verdictId'] === 'string' ? record['verdictId'] : '',
      'drift verdict record verdictId',
    ),
    tenant: expectNonEmptyString(record['tenant'], 'tenant', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'drift verdict record'),
    expertId: expectNonEmptyString(record['expertId'], 'expertId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'drift verdict record'),
    programDigest: toCalibrationContentDigest(
      typeof record['programDigest'] === 'string' ? record['programDigest'] : '',
      'drift verdict record programDigest',
    ),
    verdict,
    recordCount: record['recordCount'] as number,
    freshDecidedCount: record['freshDecidedCount'] as number,
    staleDecidedCount: record['staleDecidedCount'] as number,
    inconclusiveCount: record['inconclusiveCount'] as number,
    bias,
    tolerance,
    foldedRecordDigests: Object.freeze([...foldedRecordDigests]),
    evaluatedAt: toCalibrationTimestamp(
      typeof record['evaluatedAt'] === 'string' ? record['evaluatedAt'] : '',
      'drift verdict record evaluatedAt',
    ),
    rationale,
  };
  screenFieldNames(view, 'driftVerdictRecord');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as DriftVerdictRecord;
}

// ---------------------------------------------------------------------------
// Masquerade defense (lock rule 9 — fail closed, ALWAYS)
// ---------------------------------------------------------------------------

/**
 * The adversarial boundary: consuming ANY calibration output (verdict,
 * record, program digest) as an AUTHORIZATION fails closed. This
 * function has no happy path — it exists so a routing/authorization
 * consumer that mistakenly threads calibration data into a permission
 * decision gets a typed, loud, auditable failure instead of silent
 * elevation. CALIBRATION IS EVIDENCE, NEVER A GRANT (lock rules 9/35).
 */
export function consumeCalibrationAsAuthorization(
  value: unknown,
  context: string,
): never {
  throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.MASQUERADE_REJECTED, {
    message: `${context}: calibration data (${JSON.stringify(
      value === null || value === undefined ? String(value) : (value as { verdict?: unknown; digest?: unknown })['verdict'] ?? (value as { digest?: unknown })['digest'] ?? 'record',
    )}) was consumed as an authorization — calibration is measurement DATA, never an access grant (lock rules 9/35; fail closed)`,
    details: { surface: 'calibration-as-authorization' },
  });
}

// ---------------------------------------------------------------------------
// Summary (pure diagnostic — never a capability claim)
// ---------------------------------------------------------------------------

/** The pure calibration diagnostic over a record set (LE1.0 comparison). */
export interface CalibrationDiagnostic {
  readonly recordCount: number;
  readonly correctCount: number;
  readonly incorrectCount: number;
  readonly inconclusiveCount: number;
  /** Mean predicted confidence over decided records (null when none). */
  readonly meanPredictedConfidence: number | null;
  /** Observed correct rate over decided records (null when none). */
  readonly observedCorrectRate: number | null;
  /** Brier score over decided records (confidence vs 1/0 outcome). */
  readonly brierScore: number | null;
}

/**
 * Summarize predicted confidence against observed outcomes (PURE). A
 * calibration diagnostic, never a capability claim — the typed verdict
 * (`deriveDriftVerdict`) is the consumable surface, this is the audit
 * view.
 */
export function summarizeCalibrationRecords(
  records: readonly CalibrationRecordView[],
): CalibrationDiagnostic {
  let correctCount = 0;
  let incorrectCount = 0;
  let inconclusiveCount = 0;
  let confidenceSum = 0;
  let brierSum = 0;
  for (const record of records) {
    if (record.observed.outcome === 'inconclusive') {
      inconclusiveCount += 1;
      continue;
    }
    if (record.observed.outcome === 'correct') correctCount += 1;
    else incorrectCount += 1;
    confidenceSum += record.predicted.confidence;
    const outcome = record.observed.outcome === 'correct' ? 1 : 0;
    brierSum += (record.predicted.confidence - outcome) ** 2;
  }
  const decided = correctCount + incorrectCount;
  return deepFreeze({
    recordCount: records.length,
    correctCount,
    incorrectCount,
    inconclusiveCount,
    meanPredictedConfidence: decided === 0 ? null : confidenceSum / decided,
    observedCorrectRate: decided === 0 ? null : correctCount / decided,
    brierScore: decided === 0 ? null : brierSum / decided,
  });
}

// Re-exported for the convenience of verdict consumers.
export type { CalibrationRecord, CalibrationRecordView };
