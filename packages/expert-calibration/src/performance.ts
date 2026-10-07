/**
 * The calibration read surface for the C002 routing engine (Work Order
 * C004) — the demonstrated-performance/freshness PROJECTION routing
 * consumes as an input (a PORT, not a write into routing).
 *
 * C002 never reads calibration records directly: it reads this frozen,
 * content-addressed view — the typed drift verdict (never a bare score),
 * the fresh/total sample counts, the last observed time and the
 * in-force flag under the requalification policy. `inForce: false`
 * means the demonstrated-performance evidence must NOT be treated as
 * fresh by routing (the requalification bypass defense: an expired
 * qualification cannot be laundered back into routing inputs).
 *
 * PURE: computed from (latest verdict, latest record, policy, at) — the
 * time is injected, never a clock read.
 */

import { digestCanonical } from '@arena/protocol-core';
import { EXPERT_CALIBRATION_ERROR_CODES, ExpertCalibrationError } from './errors.js';
import {
  deepFreeze,
  expectFields,
  expectNonEmptyString,
  screenFieldNames,
  toCalibrationTimestamp,
} from './shared.js';
import type { CalibrationTimestamp } from './shared.js';
import { isValidityInForce } from './requalification.js';
import type { DriftVerdictKind } from './verdict.js';

/** Wire version of the demonstrated-performance view. */
export const DEMONSTRATED_PERFORMANCE_VERSION = 1 as const;

export interface DemonstratedPerformanceView {
  readonly viewVersion: typeof DEMONSTRATED_PERFORMANCE_VERSION;
  readonly tenant: string;
  readonly expertId: string;
  /** The capability the demonstrated performance is ABOUT. */
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  /** The content-addressed CalibrationProgram the evidence derives from. */
  readonly programDigest: string;
  /** The TYPED drift verdict (never a bare score). */
  readonly verdict: DriftVerdictKind;
  /** The drift-verdict record digest this view projects. */
  readonly verdictDigest: string;
  /** FRESH decided samples (inside the drift policy window). */
  readonly freshSampleCount: number;
  /** Total calibration records folded (append-only history size). */
  readonly totalSampleCount: number;
  /** The most recent observedAt across folded records (null when none). */
  readonly lastObservedAt: CalibrationTimestamp | null;
  /**
   * False when the qualification validity window has lapsed at `asOf` —
   * routing must NOT consume stale demonstrated performance (requalification
   * bypass defense).
   */
  readonly inForce: boolean;
  /** The fixed projection time (determinism anchor — injected). */
  readonly asOf: CalibrationTimestamp;
}

/** A frozen, content-addressed demonstrated-performance view (+ digest). */
export interface DemonstratedPerformance extends DemonstratedPerformanceView {
  readonly digest: string;
}

export interface BuildDemonstratedPerformanceInput {
  readonly tenant: string;
  readonly expertId: string;
  readonly capability: {
    readonly kind: string;
    readonly id: string;
    readonly version: string;
    readonly digest: string;
  };
  readonly programDigest: string;
  readonly verdict: string;
  readonly verdictDigest: string;
  readonly freshSampleCount: number;
  readonly totalSampleCount: number;
  readonly lastObservedAt: string | null;
  /** The qualification validity window the in-force check runs against. */
  readonly qualification: {
    readonly validFrom: string;
    readonly validUntil: string;
  };
  readonly asOf: string;
}

/**
 * Build the frozen, content-addressed demonstrated-performance view the
 * C002 routing engine consumes. PURE: the in-force flag is computed from
 * the injected qualification window + `asOf`. Fails closed on unknown
 * verdict kinds and malformed input.
 */
export async function buildDemonstratedPerformance(
  input: BuildDemonstratedPerformanceInput,
): Promise<DemonstratedPerformance> {
  const record = expectFields(
    input,
    [
      'tenant',
      'expertId',
      'capability',
      'programDigest',
      'verdict',
      'verdictDigest',
      'freshSampleCount',
      'totalSampleCount',
      'lastObservedAt',
      'qualification',
      'asOf',
    ],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT,
    'demonstrated performance',
  );
  const verdict = record['verdict'];
  const verdictKinds: readonly string[] = [
    'calibrated',
    'overconfident',
    'underconfident',
    'insufficient-sample',
    'stale',
  ];
  if (typeof verdict !== 'string' || !verdictKinds.includes(verdict)) {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: `demonstrated performance: verdict must be a closed drift verdict kind, got: ${String(verdict)}`,
      details: { known: verdictKinds },
    });
  }
  for (const field of ['freshSampleCount', 'totalSampleCount']) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
        message: `demonstrated performance: ${field} must be a non-negative integer`,
      });
    }
  }
  const qualification = expectFields(
    record['qualification'],
    ['validFrom', 'validUntil'],
    [],
    EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT,
    'demonstrated performance qualification',
  );
  const asOf = toCalibrationTimestamp(
    typeof record['asOf'] === 'string' ? record['asOf'] : '',
    'demonstrated performance asOf',
  );
  const validFrom = qualification['validFrom'];
  const validUntil = qualification['validUntil'];
  if (typeof validFrom !== 'string' || typeof validUntil !== 'string') {
    throw new ExpertCalibrationError(EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, {
      message: 'demonstrated performance qualification requires validFrom/validUntil',
    });
  }
  const inForce = isValidityInForce(validFrom, validUntil, asOf);
  const lastObservedAtRaw = record['lastObservedAt'];
  const lastObservedAt =
    lastObservedAtRaw === null || lastObservedAtRaw === undefined
      ? null
      : toCalibrationTimestamp(lastObservedAtRaw as string, 'demonstrated performance lastObservedAt');

  const view: DemonstratedPerformanceView = {
    viewVersion: DEMONSTRATED_PERFORMANCE_VERSION,
    tenant: expectNonEmptyString(record['tenant'], 'tenant', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'demonstrated performance'),
    expertId: expectNonEmptyString(record['expertId'], 'expertId', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'demonstrated performance'),
    capability: deepFreeze({ ...(record['capability'] as Record<string, unknown>) }) as DemonstratedPerformanceView['capability'],
    programDigest: expectNonEmptyString(record['programDigest'], 'programDigest', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'demonstrated performance'),
    verdict: verdict as DriftVerdictKind,
    verdictDigest: expectNonEmptyString(record['verdictDigest'], 'verdictDigest', EXPERT_CALIBRATION_ERROR_CODES.INVALID_VERDICT, 'demonstrated performance'),
    freshSampleCount: record['freshSampleCount'] as number,
    totalSampleCount: record['totalSampleCount'] as number,
    lastObservedAt,
    inForce,
    asOf,
  };
  screenFieldNames(view, 'demonstratedPerformance');
  const digest = await digestCanonical({ ...view });
  return deepFreeze({ ...view, digest }) as DemonstratedPerformance;
}

/** The digest-free view (what the digest commits to). */
export function demonstratedPerformanceView(
  view: DemonstratedPerformance,
): DemonstratedPerformanceView {
  const { digest: _digest, ...rest } = view;
  return deepFreeze({ ...rest }) as DemonstratedPerformanceView;
}
